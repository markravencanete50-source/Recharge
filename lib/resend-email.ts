import { env } from 'cloudflare:workers';
import { MAIL_DOMAIN, type Mailbox } from './email-inbound-policy';
import { GUEST_ADDRESS, GUEST_FROM, OWNER_ADDRESS, OWNER_FROM, isMailboxAddress } from './integration-policy';

// Resend, for the two mailboxes. The key and the webhook signing secret are Worker Secrets (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
const settings = () => env as unknown as Record<string, string | undefined>;
const API = 'https://api.resend.com';
export const resendConfigured = () => Boolean(settings().RESEND_API_KEY);
// Replies written in Messages go out by email only when this is `true` (a Worker Secret, off by default), like HOSTAWAY_REPLIES_ENABLED.
export const emailRepliesEnabled = () => resendConfigured() && String(settings().EMAIL_REPLIES_ENABLED || '') === 'true';

export class ResendError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ResendError'; }
}
const auth = () => ({ Authorization: `Bearer ${settings().RESEND_API_KEY}` });
async function resend(path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, { ...init, headers: { ...auth(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json() as { message?: string }; detail = String(body.message || '').slice(0, 160); } catch { /* none */ }
    throw new ResendError(detail || `Resend answered ${response.status}`, response.status);
  }
  return response;
}
export function resendErrorMessage(error: unknown) {
  if (error instanceof ResendError) {
    if (error.status === 401 || error.status === 403) return 'Resend rejected the saved key. Replace RESEND_API_KEY with a fresh one.';
    if (error.status === 429) return 'Resend is limiting requests. Please try again in a minute.';
    return `Resend would not send it (${error.message}).`;
  }
  return 'Resend could not be reached. Please try again.';
}

/** A received email (headers, text, html, attachment list), fetched fresh: the webhook carries only metadata. */
export async function fetchReceivedEmail(id: string): Promise<unknown> {
  return (await resend(`/emails/receiving/${encodeURIComponent(id)}`)).json();
}
/** One attachment's bytes: Resend gives a short download link, which is fetched (at most `limit` bytes). */
export async function fetchReceivedAttachment(emailId: string, attachmentId: string, limit: number): Promise<Uint8Array | null> {
  // An attachment Resend no longer has is skipped (the email still comes in); any other failure is retried with the whole email.
  const found = await resend(`/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`).catch(error => { if (error instanceof ResendError && (error.status === 404 || error.status === 410)) return null; throw error; });
  if (!found) return null;
  const meta = await found.json() as { download_url?: string; size?: number };
  if (!meta.download_url || !/^https:\/\//.test(meta.download_url) || (typeof meta.size === 'number' && meta.size > limit)) return null;
  const response = await fetch(meta.download_url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.length;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

// The Message-ID is made from the request (or outbox row) id, so a retried send goes out under the same one.
export const newMessageId = (seed: string) => `${seed}@${MAIL_DOMAIN}`;
/**
 * Sends one email as a mailbox, with In-Reply-To and References so the other person's mail app threads it. The idempotency key makes a
 * retried call the same email. Returns the Message-ID it went out under (set by us), and Resend's own id.
 */
export async function sendMailboxEmail(mailbox: Mailbox, email: { to: string; subject: string; text: string; inReplyTo?: string | null; references?: string[]; idempotencyKey: string }) {
  const messageId = newMessageId(email.idempotencyKey.split('/').pop()!);
  const wrap = (id: string) => id.startsWith('<') ? id : `<${id}>`;
  const headers: Record<string, string> = { 'Message-ID': `<${messageId}>` };
  if (email.inReplyTo) headers['In-Reply-To'] = wrap(email.inReplyTo);
  if (email.references?.length) headers.References = email.references.map(wrap).join(' ');
  // The two mailboxes never mix: a guest email goes out from guestrelations@, an owner email from ownerrelations@, and neither is ever sent to our own mailbox.
  const address = mailbox === 'guest' ? GUEST_ADDRESS : OWNER_ADDRESS, from = mailbox === 'guest' ? GUEST_FROM : OWNER_FROM;
  if (isMailboxAddress(email.to)) throw new ResendError('Not sent: the address is one of our own mailboxes', 400);
  const response = await resend('/emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': email.idempotencyKey },
    body: JSON.stringify({ from, to: [email.to], reply_to: address, subject: email.subject, text: email.text, headers }),
  });
  const result = await response.json() as { id?: string };
  if (typeof result.id !== 'string' || !result.id) throw new ResendError('Resend gave no id', 502);
  return { resendId: result.id, messageId };
}
