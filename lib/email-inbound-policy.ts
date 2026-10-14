// Email through Resend: what is checked before anything is stored. Pure functions, no network and no database.
// guestrelations@ and ownerrelations@rechargegroup.co.uk stay at Fasthosts; each keeps a copy and forwards one to the same name on a
// subdomain Resend receives for (in.rechargegroup.co.uk). Resend posts a signed webhook; the Worker verifies it before reading it.

export const MAIL_DOMAIN = 'rechargegroup.co.uk';
export const GUEST_MAILBOX = `guestrelations@${MAIL_DOMAIN}`;
export const OWNER_MAILBOX = `ownerrelations@${MAIL_DOMAIN}`;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_TEXT = 5000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export type Mailbox = 'guest' | 'owner';

// ---------------------------------------------------------------- signature (Svix, which Resend uses for webhooks)
const base64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
function sameBytes(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** True only for a webhook signed with this secret, recently, over exactly this body. Any malformed input is a refusal. */
export async function verifyWebhookSignature(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const { id, timestamp, signature } = headers;
    if (!secret || !id || !timestamp || !signature || !/^\d{9,12}$/.test(timestamp)) return false;
    if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey('raw', base64(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
    // The header lists "v1,<signature>" entries separated by spaces (several while a secret is being rotated).
    return signature.split(' ').some(part => {
      const [version, value] = part.split(',');
      return version === 'v1' && Boolean(value) && sameBytes(value, expected);
    });
  } catch { return false; }
}

// ---------------------------------------------------------------- who it was sent to
export function parseAddress(value: unknown): { address: string; name: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>$/) ?? value.trim().match(/^()([^<>\s]+)$/);
  if (!match) return null;
  const address = match[2].toLowerCase();
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address) || address.length > 320) return null;
  return { address, name: (match[1] ?? '').trim().slice(0, 120) };
}
/** Which of our two mailboxes an email was addressed to (the same name on the domain or any subdomain of it). */
export function mailboxFor(recipients: unknown): Mailbox | null {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  for (const entry of list) {
    const parsed = parseAddress(entry);
    if (!parsed) continue;
    const [local, domain] = parsed.address.split('@');
    if (domain !== MAIL_DOMAIN && !domain.endsWith('.' + MAIL_DOMAIN)) continue;
    if (local === 'guestrelations') return 'guest';
    if (local === 'ownerrelations') return 'owner';
  }
  return null;
}

// ---------------------------------------------------------------- spam and failed authentication
const headerValues = (headers: Record<string, unknown>, name: string) => {
  const out: string[] = [];
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string') out.push(v);
  return out;
};
/**
 * Keep or drop. Dropped: a message the mail host marked as spam, a DMARC failure, a DKIM failure, or a message with no authentication
 * result at all (so nothing vouches for the sender). A forwarded message normally fails SPF (Fasthosts' server is not the sender's),
 * so an SPF failure alone is not a reason; DKIM and DMARC are what a forward keeps.
 */
export function authenticationVerdict(headers: unknown, allowUnverified = false): { keep: true } | { keep: false; reason: string } {
  const h = (headers && typeof headers === 'object' ? headers : {}) as Record<string, unknown>;
  for (const flag of headerValues(h, 'x-spam-flag')) if (/^\s*yes/i.test(flag)) return { keep: false, reason: 'marked as spam' };
  for (const status of headerValues(h, 'x-spam-status')) if (/^\s*yes/i.test(status)) return { keep: false, reason: 'marked as spam' };
  for (const level of headerValues(h, 'x-spam-level')) if (/\*{6,}/.test(level)) return { keep: false, reason: 'marked as spam' };
  const results = headerValues(h, 'authentication-results').join(' ; ').toLowerCase();
  // allowUnverified (a Worker setting, for a mail path that carries no authentication header) keeps such a message; explicit failures and spam are still dropped.
  if (!results) return allowUnverified ? { keep: true } : { keep: false, reason: 'no authentication result' };
  if (/\bdmarc=(fail|permerror)\b/.test(results)) return { keep: false, reason: 'dmarc fail' };
  if (/\bdkim=(fail|permerror)\b/.test(results)) return { keep: false, reason: 'dkim fail' };
  // Nothing at all vouches for the sender: no DKIM pass and no DMARC pass.
  if (!allowUnverified && !/\b(dkim|dmarc)=pass\b/.test(results)) return { keep: false, reason: 'sender not authenticated' };
  return { keep: true };
}

// ---------------------------------------------------------------- text
const htmlText = (html: string) => html
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** The new text of an email: plain text (or the HTML turned to text), without the quoted earlier message, capped at 5,000 characters. */
export function messageText(text: unknown, html: unknown) {
  let value = typeof text === 'string' && text.trim() ? text : typeof html === 'string' ? htmlText(html) : '';
  value = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const lines = value.split('\n'), kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(On .{5,200} wrote:|-{2,}\s*Original Message\s*-{2,}|_{10,}|From:\s.+@.+)\s*$/i.test(line) && kept.some(l => l.trim())) break;
    // Gmail and others wrap a long "On <date>, <name> <address> wrote:" over two or three lines.
    if (/^\s*On\s/i.test(line) && kept.some(l => l.trim()) && [1, 2].some(n => /^\s*On .{5,300} wrote:\s*$/i.test(lines.slice(i, i + n + 1).join(' ')))) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line.replace(/[ \t]+$/g, ''));
  }
  return kept.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}
/** The Message-IDs in a References header, oldest first. */
export const messageIds = (value: unknown) => typeof value === 'string' ? (value.match(/<[^<>\s]{1,300}>/g) ?? []).slice(-50) : [];

// ---------------------------------------------------------------- attachments: type and size from the bytes
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
export function attachmentType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length < 12 || bytes.length > MAX_ATTACHMENT_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { mime: 'image/png', ext: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}
export const safeFilename = (name: unknown) => String(typeof name === 'string' ? name : 'attachment').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'attachment';

// ---------------------------------------------------------------- what Resend sends
export type ReceivedEmail = {
  id: string; from: { address: string; name: string }; to: unknown; subject: string; text: string; messageId: string | null; inReplyTo: string | null;
  references: string[]; headers: Record<string, unknown>; receivedAt: string | null; attachments: { id: string; filename: string }[];
};
const first = (headers: Record<string, unknown>, name: string) => headerValues(headers, name)[0] ?? null;
/** Resend's "received email" (field names read defensively), as the Worker uses it. Null when it is not usable. */
export function readReceivedEmail(id: string, data: unknown): ReceivedEmail | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const headers = d.headers && typeof d.headers === 'object' && !Array.isArray(d.headers) ? d.headers as Record<string, unknown>
    : Array.isArray(d.headers) ? Object.fromEntries((d.headers as { name?: string; value?: string }[]).filter(h => h?.name).map(h => [String(h.name), h.value])) : {};
  const from = parseAddress(d.from) ?? parseAddress(first(headers, 'from'));
  if (!from) return null;
  const attachments = Array.isArray(d.attachments) ? (d.attachments as Record<string, unknown>[]).filter(a => a && typeof a.id === 'string').map(a => ({ id: String(a.id), filename: safeFilename(a.filename) })) : [];
  const date = typeof d.created_at === 'string' && !Number.isNaN(Date.parse(d.created_at)) ? new Date(d.created_at).toISOString() : null;
  return {
    id, from, to: d.to, subject: String(typeof d.subject === 'string' ? d.subject : first(headers, 'subject') ?? '').slice(0, 300),
    text: messageText(d.text, d.html),
    messageId: (typeof d.message_id === 'string' ? d.message_id : first(headers, 'message-id')) || null,
    inReplyTo: first(headers, 'in-reply-to'), references: messageIds(first(headers, 'references')), headers, receivedAt: date, attachments,
  };
}
