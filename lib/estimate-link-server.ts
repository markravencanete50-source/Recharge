import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityHash } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { ENQUIRY_REPLY_TO, enquiryEmailReady, enquirySender } from './integration-policy';
import { integrationSettings } from './integration-server';
import { sendEmail } from './integration-providers';
import { tokenHash } from './client-enquiry';
import { ESTIMATE_LINK_PATH, autoRequestId, estimateDecisionSchema, estimateEmail, estimateLinkActionSchema, estimateTokenPattern } from './estimate-link';
import type { RpcContext } from './workspace-rpc-route';

// The estimate, emailed with a private link (migration 20261019520000). After a publish the server makes the link and
// emails it from ownerrelations@ (replies to ownerrelations@, so into Messages, Clients); the team can email it again or
// copy a link to send by hand. The client opens it without an account and decides; the database records the decision.

type Issued = { id: string; send: boolean; delivery: 'email' | 'link'; emailStatus: string; to: string | null; name: string; propertyName: string; estimate: Record<string, unknown>; estimateDelivery: unknown };
type Context = Pick<RpcContext, 'client' | 'account'>;

// One link per request: the token comes from who asked and the request, so a retry is the same link and the same email.
export async function issueEstimateLink(context: Context, input: { propertyId: string; requestId: string; delivery: 'email' | 'link' }) {
  const config = authSecurityConfiguration();
  if (!config) return { error: 'Estimate links are awaiting configuration', status: 503 } as const;
  const settings = integrationSettings();
  if (input.delivery === 'email' && !enquiryEmailReady(settings)) return { error: 'Email isn’t set up yet. Copy the link and send it from your own email.', status: 400 } as const;
  const token = await securityHash('estimate-link', `${context.account.userId}:${input.requestId}`);
  const link = `${config.origin}${ESTIMATE_LINK_PATH}?t=${token}`;
  const issued = await context.client.rpc('workspace_estimate_link_action', { input: { action: 'issue', requestId: input.requestId, propertyId: input.propertyId, tokenHash: await tokenHash(token), delivery: input.delivery } });
  if (issued.error) return { failure: issued.error } as const;
  const state = issued.data as Issued;
  let estimateDelivery = state.estimateDelivery, emailStatus = state.emailStatus;
  if (state.send && state.to) {
    const email = estimateEmail({ name: state.name, propertyName: state.propertyName, estimate: state.estimate, link });
    let status: 'sent' | 'failed' = 'sent';
    try { await sendEmail(settings, { to: state.to, ...email, from: enquirySender(settings), replyTo: ENQUIRY_REPLY_TO, idempotencyKey: `recharge-estimate/${context.account.userId}/${input.requestId}` }); } catch { status = 'failed'; }
    const marked = await context.client.rpc('workspace_estimate_link_action', { input: { action: 'markEmail', requestId: input.requestId, emailStatus: status } });
    emailStatus = status;
    if (!marked.error) estimateDelivery = (marked.data as { estimateDelivery: unknown }).estimateDelivery;
  }
  return { link, emailStatus, estimateDelivery } as const;
}

// After a successful publishEstimate: email it when email is set up and the enquiry has an address. Never fails the publish.
export async function emailPublishedEstimate(context: Context, publishRequestId: string, journey: unknown) {
  try {
    const j = z.object({ propertyId: z.string().uuid(), estimateDelivery: z.object({ to: z.string().email().nullable() }).passthrough().nullable() }).passthrough().safeParse(journey);
    if (!j.success || !j.data.estimateDelivery?.to || !enquiryEmailReady(integrationSettings())) return journey;
    const sent = await issueEstimateLink(context, { propertyId: j.data.propertyId, requestId: await autoRequestId(publishRequestId), delivery: 'email' });
    return 'estimateDelivery' in sent ? { ...(journey as object), estimateDelivery: sent.estimateDelivery } : journey;
  } catch { return journey; }
}

// The team's "Resend the estimate" and "Copy link".
export async function estimateLinkRoute(request: Request, native = false) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  if (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const quota = await requestQuota(request, 'estimate-link', 40, 3600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'That’s a lot of estimate links at once. Please wait a little.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const parsed = estimateLinkActionSchema.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) return businessResponse({ error: 'Choose the estimate' }, 400);
    const result = await issueEstimateLink(session, { propertyId: parsed.data.propertyId, requestId: parsed.data.requestId, delivery: parsed.data.action === 'email' ? 'email' : 'link' });
    if ('failure' in result) return databaseFailure(result.failure!);
    if ('error' in result) return businessResponse({ error: result.error }, result.status);
    if (parsed.data.action === 'email' && result.emailStatus === 'failed') return businessResponse({ error: 'The email could not be sent just now. Try again, or copy the link and send it yourself.', data: { estimateDelivery: result.estimateDelivery } }, 502);
    return businessResponse({ ok: true, data: { link: result.link, emailStatus: result.emailStatus, estimateDelivery: result.estimateDelivery } });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Estimate links are temporarily unavailable' }, 503); }
}

// ---------------------------------------------------------------- the client: the page and the decision
const secretClient = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
};
class PublicRefusal extends Error {}
async function publicRpc<T>(input: Record<string, unknown>): Promise<T> {
  const client = secretClient(); if (!client) throw new Error('unconfigured');
  const result = await client.rpc('workspace_estimate_public', { input });
  if (result.error) {
    if (result.error.code === 'P0002' || result.error.code === '22023') throw new PublicRefusal(result.error.message);
    throw new Error('unavailable');
  }
  return result.data as T;
}

export type EstimatePageState =
  | { state: 'open' | 'expired' | 'declined' | 'proceeding' | 'withdrawn'; propertyName: string; name: string; estimate: Record<string, unknown>; stage: string; followUpOn: string | null; feedback: string }
  | { state: 'invalid' } | { state: 'unavailable' };
export async function openEstimatePage(token: string | undefined): Promise<EstimatePageState> {
  if (!token || !estimateTokenPattern.test(token)) return { state: 'invalid' };
  try { return await publicRpc({ action: 'open', tokenHash: await tokenHash(token) }); }
  catch (error) { return error instanceof PublicRefusal ? { state: 'invalid' } : { state: 'unavailable' }; }
}

export async function estimateDecideRoute(request: Request) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  if (!isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const quota = await requestQuota(request, 'estimate-decide', 20, 3600);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many tries. Please wait a few minutes.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const parsed = estimateDecisionSchema.safeParse(await boundedJson(request, 16_384));
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check your answer', field: parsed.error.issues[0]?.path.at(-1) ?? null }, 400);
    const { token, ...answer } = parsed.data;
    const result = await publicRpc<EstimatePageState>({ action: 'decide', tokenHash: await tokenHash(token), decision: answer.decision, feedback: answer.feedback.trim(), followUpOn: answer.decision === 'review' ? answer.followUpOn : null });
    return businessResponse({ ok: true, data: result });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'Your answer could not be sent just now. Please try again in a minute.' }, 503);
  }
}
