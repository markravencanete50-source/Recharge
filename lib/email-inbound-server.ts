import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { authSecurityConfiguration, securityRpc } from './auth-security';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, attachmentType, authenticationVerdict, mailboxFor, readReceivedEmail, safeFilename, verifyWebhookSignature, type Mailbox,
} from './email-inbound-policy';
import { fetchReceivedAttachment, fetchReceivedEmail, resendConfigured, sendMailboxEmail, resendErrorMessage } from './resend-email';

export const EMAIL_BUCKET = 'email-files';
const settings = () => env as unknown as Record<string, string | undefined>;
const storage = () => {
  const config = authSecurityConfiguration();
  return config ? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(EMAIL_BUCKET) : null;
};

const eventSchema = z.object({ type: z.string(), data: z.object({ email_id: z.string().min(1).max(200) }).passthrough() }).passthrough();

// ---------------------------------------------------------------- Resend's webhook: email.received
// Refused unless it carries a valid signature over exactly this body, made with RESEND_WEBHOOK_SECRET. The body only says which email
// arrived; the email itself is fetched from Resend with the API key. A message is stored once however many times Resend delivers it.
export async function resendWebhookRoute(request: Request) {
  const secret = settings().RESEND_WEBHOOK_SECRET || '';
  if (secret.length < 16 || !resendConfigured()) return businessResponse({ error: 'Email is not set up yet' }, 503);
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  // Read the body exactly once, as text: the signature covers these bytes.
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 262_144) return businessResponse({ error: 'Too large' }, 413);
  const body = await request.text();
  if (body.length > 262_144) return businessResponse({ error: 'Too large' }, 413);
  const signed = await verifyWebhookSignature(secret, { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') }, body);
  if (!signed) return businessResponse({ error: 'Not authorised' }, 401);
  let event: z.infer<typeof eventSchema>;
  try { event = eventSchema.parse(JSON.parse(body)); } catch { return businessResponse({ error: 'Unreadable event' }, 400); }
  // Other events (sent, delivered, bounced) are acknowledged so Resend stops retrying them.
  if (event.type !== 'email.received') return businessResponse({ ok: true, ignored: true });
  try { return businessResponse({ ok: true, ...await storeReceivedEmail(event.data.email_id) }); }
  catch (error) {
    console.error('Inbound email failed; Resend will retry:', error instanceof Error ? error.message : 'unknown');
    return businessResponse({ error: 'Could not store the email; it will be retried' }, 503);
  }
}

async function dropped(emailId: string, mailbox: Mailbox, from: string | null, reason: string) {
  await securityRpc('workspace_email_drop', { input: { emailId, mailbox, reason, ...(from ? { from } : {}) } });
  return { stored: false, dropped: reason };
}

// Fetches one received email, checks it, stores its attachments, and hands it to the database.
export async function storeReceivedEmail(emailId: string) {
  const email = readReceivedEmail(emailId, await fetchReceivedEmail(emailId));
  if (!email) return dropped(emailId, 'guest', null, 'unreadable email');
  const mailbox = mailboxFor(email.to);
  if (!mailbox) return dropped(emailId, 'guest', email.from.address, 'not addressed to a Recharge mailbox');
  // Spam and failed SPF/DKIM/DMARC are dropped without keeping their content.
  const verdict = authenticationVerdict(email.headers, settings().EMAIL_ALLOW_UNVERIFIED === 'true');
  if (!verdict.keep) return dropped(emailId, mailbox, email.from.address, verdict.reason);
  // Never reply to ourselves or to a bounce.
  if (/^(mailer-daemon|postmaster)@/.test(email.from.address) || /@(?:in\.)?rechargegroup\.co\.uk$/.test(email.from.address)) return dropped(emailId, mailbox, email.from.address, 'from our own domain or a bounce');
  const attachments = await keepAttachments(email, mailbox);
  const input = {
    emailId, from: email.from.address, ...(email.from.name ? { fromName: email.from.name } : {}), subject: email.subject, text: email.text,
    ...(email.receivedAt ? { receivedAt: email.receivedAt } : {}), ...(email.messageId ? { messageId: email.messageId } : {}),
    ...(email.inReplyTo ? { inReplyTo: email.inReplyTo } : {}), ...(email.references.length ? { references: email.references } : {}), attachments,
  };
  const result = await securityRpc<Record<string, unknown>>(mailbox === 'guest' ? 'workspace_email_guest_ingest' : 'workspace_email_owner_ingest', { input });
  return { stored: Boolean(result?.stored), duplicate: Boolean(result?.duplicate), mailbox };
}

// Attachments: the type comes from the bytes (never the name or the declared type), at most 10 of up to 10 MB, in a private bucket.
async function keepAttachments(email: NonNullable<ReturnType<typeof readReceivedEmail>>, mailbox: Mailbox) {
  const bucket = storage();
  const kept: { path: string; filename: string; mime: string; bytes: number }[] = [];
  if (!bucket) return kept;
  const month = new Date().toISOString().slice(0, 7);
  for (const attachment of email.attachments.slice(0, MAX_ATTACHMENTS)) {
    const bytes = await fetchReceivedAttachment(email.id, attachment.id, MAX_ATTACHMENT_BYTES);
    const type = bytes && attachmentType(bytes);
    if (!bytes || !type) continue;
    const path = `${mailbox}/${month}/${email.id.replace(/[^A-Za-z0-9_-]/g, '')}/${attachment.id.replace(/[^A-Za-z0-9_-]/g, '')}.${type.ext}`;
    const stored = await bucket.upload(path, bytes, { contentType: type.mime, upsert: true, cacheControl: 'private, max-age=0' });
    if (stored.error) throw new Error('Attachment could not be stored');
    kept.push({ path, filename: safeFilename(attachment.filename), mime: type.mime, bytes: bytes.length });
  }
  return kept;
}

// ---------------------------------------------------------------- opening attachments: GET ?ids=a,b (short signed links, for people the database allows)
const idsSchema = z.object({ ids: z.string().max(60 * 37).transform(v => v.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).min(1).max(60)) }).strict();
export async function emailFilesRoute(request: Request, native = false) {
  const unavailable = () => businessResponse({ error: 'Attachments are not available just now' }, 503);
  if (native && !isNativeRequest(request)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method !== 'GET') return businessResponse({ error: 'Method not allowed' }, 405);
    const parsed = idsSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return businessResponse({ error: 'Choose files' }, 400);
    const found = await session.client.rpc('workspace_email_files', { ids: [...new Set(parsed.data.ids)] });
    if (found.error) return databaseFailure(found.error);
    const files = z.array(z.object({ id: z.string(), path: z.string(), filename: z.string(), mime: z.string(), bytes: z.number() })).parse(found.data);
    if (!files.length) return businessResponse({ data: {} });
    const bucket = storage();
    if (!bucket) return unavailable();
    const signed = await bucket.createSignedUrls(files.map(f => f.path), 3600);
    if (signed.error || !signed.data) return unavailable();
    const urls = new Map(signed.data.filter(s => s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]));
    return businessResponse({ data: Object.fromEntries(files.filter(f => urls.has(f.path)).map(f => [f.id, { url: urls.get(f.path), mime: f.mime, name: f.filename, bytes: f.bytes }])) });
  } catch (error) { return viewAsFailure(error) ?? unavailable(); }
}

// ---------------------------------------------------------------- replies to owners who wrote by email (every minute, from the schedule)
const rowSchema = z.object({ id: z.string().uuid(), to: z.string(), subject: z.string(), body: z.string(), inReplyTo: z.string().nullable(), references: z.array(z.string()) });
export async function runEmailOutbox() {
  const { emailRepliesEnabled } = await import('./resend-email');
  if (!emailRepliesEnabled()) return { sent: 0 };
  const rows = z.array(rowSchema).parse(await securityRpc<unknown>('workspace_email_outbox_claim', { max_rows: 10 }));
  let sent = 0;
  for (const row of rows) {
    try {
      const out = await sendMailboxEmail('owner', { to: row.to, subject: row.subject, text: row.body, inReplyTo: row.inReplyTo, references: row.references, idempotencyKey: `recharge-owner-email/${row.id}` });
      await securityRpc('workspace_email_outbox_result', { input: { id: row.id, ok: true, messageId: out.messageId } });
      sent++;
    } catch (error) {
      await securityRpc('workspace_email_outbox_result', { input: { id: row.id, ok: false, error: resendErrorMessage(error) } }).catch(() => undefined);
    }
  }
  return { sent };
}
