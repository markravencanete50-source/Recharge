import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityHash, securityRpc } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessResponse } from './business-server';
import { tokenHash } from './client-enquiry';
import { fetchHostawayConversations, hostawayReplyErrorMessage, sendHostawayConversationMessage } from './hostaway';
import { syncConversation, type SyncConversation } from './hostaway-messages-policy';
import { hostawayRepliesEnabled } from './guest-reply-server';
import { emailRepliesEnabled, resendErrorMessage, sendMailboxEmail } from './resend-email';
import { STAY_SURVEY_PATH, firstNameOf, stayReasonQuestion, staySurveyEmail, surveyAnswerSchema, surveyTokenPattern } from './stay-reason';

// Why guests stay (migration 20261021800000). Two jobs the Worker runs every 15 minutes (worker/index.ts), and the
// guest's survey page. The database decides who is due, takes each stay once (so two workers never both send) and keeps
// the outcome; this file only sends. Nothing is sent while a switch is off (the database finds nothing due), and nothing
// at all unless the existing send paths are switched on: Hostaway replies (HOSTAWAY_REPLIES_ENABLED with the sync on)
// for the question, guest email (RESEND_API_KEY with EMAIL_REPLIES_ENABLED) for the survey.

const MAX_PER_RUN = 10;
const uuid = z.string().uuid();
const questionsDue = z.object({ switchedOff: z.boolean(), stays: z.array(z.object({
  reservationId: uuid, hostawayReservationId: z.string(), conversationId: z.string().nullable(), firstName: z.string().nullable(), propertyName: z.string(), checkIn: z.string(),
})) });
const surveysDue = z.object({ switchedOff: z.boolean(), stays: z.array(z.object({
  reservationId: uuid, email: z.string().email(), firstName: z.string().nullable(), propertyName: z.string(), checkIn: z.string(), checkOut: z.string(),
})) });
const claimed = z.object({ send: z.boolean() });

/** The pre-arrival question, through the Guest inbox's own Hostaway send (one message per stay). */
export async function runStayReasonQuestions(): Promise<{ sent: number; failed: number } | null> {
  if (!hostawayRepliesEnabled()) return null;
  const due = questionsDue.parse(await securityRpc('workspace_stay_reason_questions_due', {}));
  if (due.switchedOff || !due.stays.length) return { sent: 0, failed: 0 };
  let conversations: SyncConversation[] | null = null, sent = 0, failed = 0;
  for (const stay of due.stays.slice(0, MAX_PER_RUN)) {
    let conversationId = stay.conversationId, firstName = stay.firstName;
    // Not in the Guest inbox yet: the stay's conversation among Hostaway's newest (read once a run). Not found: the next run tries again.
    if (!conversationId) {
      if (!conversations) {
        try { conversations = (await fetchHostawayConversations(1)).map(syncConversation).filter((c): c is SyncConversation => c !== null); }
        catch { conversations = []; }
      }
      const found = conversations.find(c => c.reservationId === stay.hostawayReservationId);
      if (!found) continue;
      conversationId = found.id; firstName = firstName || firstNameOf(found.guestName) || null;
    }
    const body = stayReasonQuestion({ firstName, propertyName: stay.propertyName, checkIn: stay.checkIn });
    const claim = claimed.parse(await securityRpc('workspace_stay_reason_question_claim', { input: { reservationId: stay.reservationId, conversationId, body } }));
    if (!claim.send) continue;
    let messageId: string | null = null, failure = '';
    try { messageId = await sendHostawayConversationMessage(conversationId, body); } catch (error) { failure = hostawayReplyErrorMessage(error); }
    if (failure) failed++; else sent++;
    // A send that could not be recorded stays "sending" and is never sent again.
    await securityRpc('workspace_stay_reason_question_result', { input: { reservationId: stay.reservationId, ok: !failure, ...(messageId ? { messageId: messageId.slice(0, 100) } : {}), ...(failure ? { error: failure } : {}) } }).catch(() => undefined);
  }
  return { sent, failed };
}

/** The stay's own link: an HMAC of the stay with the server's secret, so only the server can make it. */
export async function staySurveyLink(reservationId: string) {
  const config = authSecurityConfiguration();
  if (!config) return null;
  const token = await securityHash('stay-survey', reservationId);
  return { token, hash: await tokenHash(token), link: `${config.origin}${STAY_SURVEY_PATH}?t=${token}` };
}

/** The survey the day after a direct stay, from guestrelations@ (never ownerrelations@). */
export async function runStaySurveys(): Promise<{ sent: number; failed: number } | null> {
  if (!emailRepliesEnabled() || !authSecurityConfiguration()) return null;
  const due = surveysDue.parse(await securityRpc('workspace_stay_surveys_due', {}));
  if (due.switchedOff || !due.stays.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const stay of due.stays.slice(0, MAX_PER_RUN)) {
    const made = await staySurveyLink(stay.reservationId);
    if (!made) break;
    const claim = claimed.parse(await securityRpc('workspace_stay_survey_claim', { input: { reservationId: stay.reservationId, tokenHash: made.hash } }));
    if (!claim.send) continue;
    const email = staySurveyEmail({ firstName: stay.firstName, propertyName: stay.propertyName, link: made.link });
    let failure = '';
    try { await sendMailboxEmail('guest', { to: stay.email, ...email, idempotencyKey: `recharge-stay-survey/${stay.reservationId}` }); }
    catch (error) { failure = resendErrorMessage(error); }
    if (failure) failed++; else sent++;
    await securityRpc('workspace_stay_survey_result', { input: { reservationId: stay.reservationId, ok: !failure, ...(failure ? { error: failure.slice(0, 300) } : {}) } }).catch(() => undefined);
  }
  return { sent, failed };
}

// ---------------------------------------------------------------- the guest's page: no account, the link is the key
const secretClient = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
};
class PublicRefusal extends Error {}
async function publicRpc<T>(input: Record<string, unknown>): Promise<T> {
  const client = secretClient(); if (!client) throw new Error('unconfigured');
  const result = await client.rpc('workspace_stay_survey_public', { input });
  if (result.error) {
    if (result.error.code === 'P0002' || result.error.code === '22023') throw new PublicRefusal(result.error.message);
    throw new Error('unavailable');
  }
  return result.data as T;
}
// Only the property name and the stay dates, never anything else about the stay or the guest.
export type SurveyPageState = { state: 'open' | 'thanks'; propertyName: string; checkIn: string; checkOut: string } | { state: 'expired' | 'invalid' | 'unavailable' };
export async function openStaySurvey(token: string | undefined): Promise<SurveyPageState> {
  if (!token || !surveyTokenPattern.test(token)) return { state: 'invalid' };
  try { return await publicRpc({ action: 'open', tokenHash: await tokenHash(token) }); }
  catch (error) { return error instanceof PublicRefusal ? { state: 'invalid' } : { state: 'unavailable' }; }
}

export async function staySurveyAnswerRoute(request: Request) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  if (!isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const quota = await requestQuota(request, 'stay-survey', 30, 3600);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many tries. Please wait a few minutes.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const parsed = surveyAnswerSchema.safeParse(await boundedJson(request, 8192));
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check your answer' }, 400);
    const { token, rating, reason, comment } = parsed.data;
    const result = await publicRpc<SurveyPageState>({ action: 'answer', tokenHash: await tokenHash(token), rating: rating ?? null, reason: reason ?? null, comment: comment?.trim() || null });
    return businessResponse({ ok: true, data: result });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'Your answer could not be sent just now. Please try again in a minute.' }, 503);
  }
}
