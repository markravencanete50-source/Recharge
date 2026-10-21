import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { requestQuota, securityHash, securityRpc } from './auth-security';
import { boundedJson } from './auth-security-policy';
import { businessResponse } from './business-server';

// Guest messages from the company website (rechargestays.co.uk): the booking panel and "Message the team" on each home's page.
// The website's own server forwards each one here, server to server (no browser, so no CORS), with the shared key
// WEBSITE_MESSAGES_KEY (a Worker secret here; RECHARGE_WEBSITE_KEY on the website) in the x-recharge-website-key header. The key is
// checked in constant time before anything is read; then the body, then the quotas; then the database stores it in the Guest inbox
// as a Website conversation (migration 20261026200000). A message carrying a chat key (the guest's browser makes one per chat) is
// its own conversation; the team's replies to it are shown in the guest's chat window, read back through websiteGuestChatRoute
// (20261027100000). Without a chat key it is one conversation per guest email and home, and the team's replies go by email.
// The app keeps only a keyed hash of the chat key, so a chat can be read only by whoever holds it.
// The website treats any 2xx as delivered, so a retried delivery is answered 200 and stored once.
const settings = () => env as unknown as Record<string, string | undefined>;
export const WEBSITE_KEY_HEADER = 'x-recharge-website-key';

// SHA-256 of both sides, compared without stopping at the first difference, so the time taken says nothing about the key.
async function sameSecret(given: string, expected: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD').refine(v => !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v), 'Not a real date');
// The database's own address rule (private.workspace_email_valid), so an address it would refuse is a 400 here, not a 503.
const emailRule = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
// The chat key the guest's browser made: random, URL-safe, 32 to 128 characters.
const chatKey = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid chat');
export const websiteMessageSchema = z.object({
  source: z.literal('website').optional(),
  home: z.object({
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,119}$/, 'Unknown home'),
    hostawayListingId: z.number().int().positive().max(99_999_999_999).nullable().optional(),
    town: z.string().trim().max(80).nullable().optional(),
  }).nullable().optional(),
  name: z.string().trim().min(1, 'Add your name').max(120),
  email: z.string().trim().max(254).email('Add a valid email address').refine(v => emailRule.test(v.toLowerCase()), 'Add a valid email address'),
  phone: z.string().trim().max(40).regex(/^[0-9+().\s-]*$/, 'Check the phone number').nullable().optional(),
  body: z.string().trim().min(1, 'Write your message').max(4000),
  booking: z.object({
    checkin: day, checkout: day,
    guests: z.number().int().min(1).max(50),
    total: z.number().nonnegative().max(1_000_000).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  }).refine(b => b.checkout > b.checkin, 'Check-out is after check-in').nullable().optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
  chat: chatKey.optional(),
});
export type WebsiteMessage = z.infer<typeof websiteMessageSchema>;

const dayText = (iso: string, year: boolean) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
// What the team reads: the booking asked about in one line ("Booking request: 10 Nov to 16 Nov 2026 · 2 guests · quoted £1,073.00"),
// the phone number when given, then the guest's own words.
export function websiteMessageBody(m: WebsiteMessage) {
  const lines: string[] = [];
  if (m.booking) {
    const b = m.booking;
    const total = b.total != null ? ' · quoted ' + new Intl.NumberFormat('en-GB', { style: 'currency', currency: b.currency || 'GBP' }).format(b.total) : '';
    lines.push(`Booking request: ${dayText(b.checkin, false)} to ${dayText(b.checkout, true)} · ${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}${total}`);
  }
  if (m.phone) lines.push(`Phone: ${m.phone}`);
  return lines.length ? `${lines.join('\n')}\n\n${m.body}` : m.body;
}

const tooMany = (retryAfter: number) => { const r = businessResponse({ error: 'Too many messages. Please try again later.' }, 429); r.headers.set('Retry-After', String(retryAfter || 60)); return r; };

export async function websiteGuestMessageRoute(request: Request) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  const expected = settings().WEBSITE_MESSAGES_KEY || '';
  if (expected.length < 32) return businessResponse({ error: 'Website messages are not set up yet' }, 503);
  if (!await sameSecret(request.headers.get(WEBSITE_KEY_HEADER) ?? '', expected)) return businessResponse({ error: 'Not authorised' }, 401);
  try {
    // Every message comes from the website's servers, so this is a ceiling on the website as a whole.
    const perAddress = await requestQuota(request, 'website-message-ip', 1200, 3600);
    if (!perAddress.allowed) return tooMany(perAddress.retryAfter);
    const parsed = websiteMessageSchema.safeParse(await boundedJson(request, 32_768));
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Invalid message', field: parsed.error.issues[0]?.path.join('.') || null }, 400);
    const m = parsed.data, email = m.email.toLowerCase();
    // A chat is a conversation, so it allows more messages than a one-off enquiry; the email limit still caps one guest overall.
    const perEmail = await requestQuota(request, 'website-message-email', m.chat ? 40 : 10, 3600, 'email:' + email);
    if (!perEmail.allowed) return tooMany(perEmail.retryAfter);
    const chat = m.chat ? await securityHash('website-chat', m.chat) : null;
    if (chat) {
      const perChat = await requestQuota(request, 'website-chat-message', 30, 3600, 'chat:' + chat);
      if (!perChat.allowed) return tooMany(perChat.retryAfter);
    }
    const body = websiteMessageBody(m);
    // The same message delivered twice makes the same key, so it is stored once.
    const messageKey = await securityHash('website-message', JSON.stringify([email, m.home?.slug ?? null, m.home?.hostawayListingId ?? null, m.name, body, m.sentAt ?? null, chat]));
    const homeLabel = m.home ? [m.home.town, m.home.slug].filter(Boolean).join(' · ').slice(0, 160) : '';
    const stored = await securityRpc<{ duplicate?: boolean }>('workspace_website_message_ingest', { input: {
      messageKey, name: m.name, email, body, ...(chat ? { chatKey: chat } : {}),
      ...(m.home?.hostawayListingId ? { listingId: String(m.home.hostawayListingId) } : {}),
      ...(homeLabel ? { homeLabel } : {}),
      ...(m.booking ? { checkIn: m.booking.checkin, checkOut: m.booking.checkout } : {}),
    } });
    return businessResponse({ ok: true, duplicate: Boolean(stored?.duplicate) });
  } catch {
    return businessResponse({ error: 'The message could not be stored just now. Please try again.' }, 503);
  }
}

// The guest's own words, without the lines the app added for the team (the booking asked about, the phone number, the home).
export const guestWords = (body: string) => body.replace(/^(?:(?:Booking request|Phone|Home): [^\n]*\n)+\n?/, '');

const readSchema = z.object({ chat: chatKey });
type ChatRead = { found: boolean; messages: { id: string; from: 'guest' | 'team'; body: string; sentAt: string; name?: string | null }[] };

// A chat, read back for the guest's chat window: the website's server asks every few seconds while the window is open, with the
// shared key and the guest's chat key (POST, so the key is never in an address). Unknown chat: an empty list, not an error.
export async function websiteGuestChatRoute(request: Request) {
  if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
  const expected = settings().WEBSITE_MESSAGES_KEY || '';
  if (expected.length < 32) return businessResponse({ error: 'Website messages are not set up yet' }, 503);
  if (!await sameSecret(request.headers.get(WEBSITE_KEY_HEADER) ?? '', expected)) return businessResponse({ error: 'Not authorised' }, 401);
  try {
    const parsed = readSchema.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) return businessResponse({ error: 'Invalid chat' }, 400);
    const chat = await securityHash('website-chat', parsed.data.chat);
    // One open window asks about every five seconds.
    const perChat = await requestQuota(request, 'website-chat-read', 30, 60, 'chat:' + chat);
    if (!perChat.allowed) return tooMany(perChat.retryAfter);
    const read = await securityRpc<ChatRead>('workspace_website_chat_read', { input: { chatKey: chat } });
    const messages = (read?.messages ?? []).map(m => ({ id: m.id, from: m.from, body: m.from === 'guest' ? guestWords(m.body) : m.body, sentAt: m.sentAt, ...(m.from === 'team' ? { name: m.name || null } : {}) }));
    return businessResponse({ ok: true, found: Boolean(read?.found), messages });
  } catch {
    return businessResponse({ error: 'The chat could not be read just now.' }, 503);
  }
}
