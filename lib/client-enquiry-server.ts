import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityHash } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { boundedFormData } from './bounded-form';
import { ENQUIRY_REPLY_TO, enquiryEmailReady, enquirySender } from './integration-policy';
import { integrationSettings } from './integration-server';
import { sendEmail } from './integration-providers';
import { enquiryAnswersSchema, enquiryEmail, enquiryFileType, MAX_ENQUIRY_FILE_BYTES, tokenHash, tokenPattern } from './client-enquiry';
import type { RpcContext } from './workspace-rpc-route';
import type { TeamsAction } from './workspace-teams-policy';

// Client Enquiries on the server: the team's "send the form" (the link and the email), the
// landlord's form (open, upload, submit) without an account, and opening the files they sent.
export const ENQUIRY_BUCKET = 'enquiry-files';
const secretClient = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
};
const tooMany = (retryAfter: number, error = 'Too many tries. Please wait a few minutes.') => { const r = businessResponse({ error }, 429); r.headers.set('Retry-After', String(retryAfter || 60)); return r; };
// The landlord's side of the database, with our own wording passed on (never internal details).
class PublicRefusal extends Error {}
async function publicRpc<T>(input: Record<string, unknown>): Promise<T> {
  const client = secretClient(); if (!client) throw new Error('unconfigured');
  const result = await client.rpc('workspace_enquiry_public', { input });
  if (result.error) {
    if (result.error.code === 'P0002' || result.error.code === '22023') throw new PublicRefusal(result.error.message);
    throw new Error('unavailable');
  }
  return result.data as T;
}

// ---------------------------------------------------------------- the team: send the form
type Invite = Extract<TeamsAction, { action: 'inviteEnquiry' | 'resendEnquiry' }>;
export async function sendEnquiryForm(context: RpcContext, input: Invite) {
  const config = authSecurityConfiguration();
  if (!config) return businessResponse({ error: 'Client enquiries are awaiting configuration' }, 503);
  const settings = integrationSettings();
  // The form's email has its own switch (RESEND_API_KEY set, ENQUIRY_EMAIL_ENABLED not false), apart from the staff notice emails.
  if (input.delivery === 'email' && !enquiryEmailReady(settings)) return businessResponse({ error: 'Email isn’t set up yet. Make the link and send it from your own email.' }, 400);
  const quota = await requestQuota(context.request, 'enquiry-send', 40, 3600, context.account.userId);
  if (!quota.allowed) return tooMany(quota.retryAfter, 'That’s a lot of forms at once. Please wait a little.');
  // The same request always makes the same link, so a retry never sends a second, different one.
  const token = await securityHash('enquiry-link', `${context.account.userId}:${input.requestId}`);
  const link = `${config.origin}/enquiry?t=${token}`;
  const saved = await context.client.rpc('workspace_teams_action', { input: { ...input, tokenHash: await tokenHash(token) } });
  if (saved.error) return databaseFailure(saved.error);
  let enquiry = saved.data as { id: string; emailStatus: string; recipientEmail: string };
  if (input.delivery === 'email' && enquiry.emailStatus === 'pending') {
    const email = enquiryEmail(input.subject, input.body, link);
    let status: 'sent' | 'failed' = 'sent';
    // Sent as ownerrelations@ (a verified sender), replies going to ownerrelations@ and so into Messages. The key makes a retry the same email.
    try { await sendEmail(settings, { to: enquiry.recipientEmail, ...email, from: enquirySender(settings), replyTo: ENQUIRY_REPLY_TO, idempotencyKey: `recharge-enquiry/${context.account.userId}/${input.requestId}` }); } catch { status = 'failed'; }
    const marked = await context.client.rpc('workspace_teams_action', { input: { action: 'markEnquiryEmail', requestId: crypto.randomUUID(), enquiryId: enquiry.id, emailStatus: status } });
    if (!marked.error) enquiry = marked.data;
  }
  return businessResponse({ ok: true, data: { enquiry, link } });
}

// ---------------------------------------------------------------- the team: delete an enquiry
// The database deletes the enquiry (and the property it made) and queues its files; the stored copies are
// removed here straight away and marked removed. Anything left queued (storage was down) stays on record.
export async function deleteEnquiry(context: RpcContext, input: Extract<TeamsAction, { action: 'deleteEnquiry' }>) {
  const result = await context.client.rpc('workspace_teams_action', { input });
  if (result.error) return databaseFailure(result.error);
  const paths = z.array(z.string()).catch([]).parse((result.data as { paths?: unknown })?.paths);
  const storage = secretClient()?.storage.from(ENQUIRY_BUCKET);
  if (paths.length && storage) {
    const removed = await storage.remove(paths).then(r => !r.error, () => false);
    if (removed) await context.client.rpc('workspace_storage_removed', { bucket_name: ENQUIRY_BUCKET, removed: paths }).then(() => undefined, () => undefined);
  }
  return businessResponse({ ok: true, data: result.data });
}

// ---------------------------------------------------------------- the landlord: the form
export type EnquiryFormState = { state: 'open' | 'answered' | 'expired' | 'closed'; id: string; name: string; email: string; files: { id: string; name: string; mime: string; bytes: number }[] } | { state: 'invalid' } | { state: 'unavailable' };
export async function openEnquiryForm(token: string | undefined): Promise<EnquiryFormState> {
  if (!token || !tokenPattern.test(token)) return { state: 'invalid' };
  try { return await publicRpc({ action: 'open', tokenHash: await tokenHash(token) }); }
  catch (error) { return error instanceof PublicRefusal ? { state: 'invalid' } : { state: 'unavailable' }; }
}

const submitSchema = z.object({ token: z.string().regex(tokenPattern), answers: enquiryAnswersSchema }).strict();
export async function enquirySubmitRoute(request: Request) {
  if (!isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const quota = await requestQuota(request, 'enquiry-submit', 20, 3600);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    const parsed = submitSchema.safeParse(await boundedJson(request, 32_768));
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check your answers', field: parsed.error.issues[0]?.path.at(-1) ?? null }, 400);
    // Blank optional answers are left out.
    const answers = Object.fromEntries(Object.entries(parsed.data.answers).filter(([, v]) => v !== '' && v !== undefined));
    await publicRpc({ action: 'submit', tokenHash: await tokenHash(parsed.data.token), answers });
    return businessResponse({ ok: true });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'The form could not be sent just now. Please try again in a minute.' }, 503);
  }
}

// Photos and videos: read with a size cap, checked from their bytes, stored privately, then
// recorded against the form. Removing one forgets it and deletes the stored copy.
export async function enquiryUploadRoute(request: Request) {
  if (!isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  const storage = secretClient()?.storage.from(ENQUIRY_BUCKET);
  if (!storage) return businessResponse({ error: 'Uploads are not available just now. Add a link to your photos instead.' }, 503);
  try {
    const quota = await requestQuota(request, 'enquiry-upload', 60, 3600);
    if (!quota.allowed) return tooMany(quota.retryAfter);
    if (request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json') {
      const input = z.object({ action: z.literal('remove'), token: z.string().regex(tokenPattern), fileId: z.string().uuid() }).strict().safeParse(await boundedJson(request, 1024));
      if (!input.success) return businessResponse({ error: 'Choose a file' }, 400);
      const removed = await publicRpc<{ path: string }>({ action: 'removeFile', tokenHash: await tokenHash(input.data.token), fileId: input.data.fileId });
      await storage.remove([removed.path]).catch(() => undefined);
      return businessResponse({ ok: true });
    }
    // The form's link comes in a header and is checked before the file is read, so nobody without
    // a valid open form can make the site read a large upload.
    const token = request.headers.get('X-Enquiry-Token') ?? '';
    if (!tokenPattern.test(token)) return businessResponse({ error: 'This form link is not valid' }, 400);
    const hash = await tokenHash(token);
    const opened = await publicRpc<{ state: string; id: string }>({ action: 'open', tokenHash: hash });
    if (opened.state !== 'open') return businessResponse({ error: 'This form can’t take more files.' }, 400);
    const form = await boundedFormData(request, MAX_ENQUIRY_FILE_BYTES + 65536);
    if (form === 'too-large') return businessResponse({ error: 'Each file can be up to 25 MB. For longer videos, paste a link below instead.' }, 413);
    if (!form) return businessResponse({ error: 'Choose a photo or video' }, 400);
    if ([...form.keys()].some(k => !['token', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1)) return businessResponse({ error: 'Unexpected upload fields' }, 400);
    const file = form.get('file');
    if ((form.has('token') && form.get('token') !== token) || !(file instanceof Blob) || file.size > MAX_ENQUIRY_FILE_BYTES) return businessResponse({ error: 'Choose a photo or video' }, 400);
    // The type is read from the file's first bytes; the file itself goes to storage as it is.
    const type = enquiryFileType(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
    if (!type) return businessResponse({ error: 'Add photos (JPG, PNG, WebP, HEIC) or videos (MP4, MOV, WebM) up to 25 MB each.' }, 400);
    const fileId = crypto.randomUUID(), path = `enquiries/${opened.id}/${fileId}.${type.ext}`;
    const name = (file instanceof File ? file.name : 'File').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'File';
    const stored = await storage.upload(path, file, { contentType: type.mime, upsert: false, cacheControl: 'private, max-age=0' });
    if (stored.error) return businessResponse({ error: 'The file could not be saved. Please try again.' }, 503);
    try { await publicRpc({ action: 'addFile', tokenHash: hash, file: { id: fileId, path, name, mime: type.mime, bytes: file.size } }); }
    catch (error) { await storage.remove([path]).catch(() => undefined); throw error; }
    return businessResponse({ ok: true, data: { id: fileId, name, mime: type.mime, bytes: file.size } });
  } catch (error) {
    if (error instanceof PublicRefusal) return businessResponse({ error: error.message }, 400);
    return businessResponse({ error: 'Uploads are not available just now. Add a link to your photos instead.' }, 503);
  }
}

// ---------------------------------------------------------------- the team: open a file
export async function enquiryFilesRoute(request: Request, native = false) {
  if (native && !isNativeRequest(request)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method !== 'GET') return businessResponse({ error: 'Method not allowed' }, 405);
    const parsed = z.object({ enquiryId: z.string().uuid(), fileId: z.string().uuid() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return businessResponse({ error: 'Choose a file' }, 400);
    const file = await session.client.rpc('workspace_client_enquiry_file', { target: parsed.data.enquiryId, file: parsed.data.fileId });
    if (file.error) return databaseFailure(file.error);
    const storage = secretClient()?.storage.from(ENQUIRY_BUCKET);
    if (!storage) return businessResponse({ error: 'Files are awaiting configuration' }, 503);
    const signed = await storage.createSignedUrl(String(file.data.path), 600, String(file.data.mime) === 'image/heic' ? { download: String(file.data.name) } : undefined);
    if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The file could not be opened just now' }, 503);
    return businessResponse({ data: { url: signed.data.signedUrl, name: file.data.name, mime: file.data.mime } });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Files are temporarily unavailable' }, 503); }
}
