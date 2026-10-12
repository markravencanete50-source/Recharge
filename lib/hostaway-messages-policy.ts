import { z } from 'zod';
import { syncChannel, type SyncChannel } from './hostaway-sync-policy';

// How Hostaway's conversations and messages map onto the Guest inbox, for lib/hostaway-sync.ts and the
// database function workspace_hostaway_messages_ingest. Pure, so it is unit-tested against sample payloads.
// Every Hostaway field name is read here and only here (the lists in `first(...)` and FIELDS).

type Raw = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const first = (...values: unknown[]) => values.map(text).find(Boolean) ?? '';
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const day = /^\d{4}-\d{2}-\d{2}$/;

// Messages in these states were never delivered to the guest.
const NOT_SENT = ['scheduled', 'failed', 'cancelled', 'canceled'];
// Hostaway sends times as "YYYY-MM-DD HH:MM:SS" with no zone; that is UTC.
const FIELDS = { activity: ['messageReceivedOn', 'messageSentOn'], messageTime: ['date', 'insertedOn'] } as const;

export type SyncConversation = {
  id: string; listingId: string; reservationId: string; guestName: string; checkIn: string | null; checkOut: string | null;
  channel: SyncChannel;
  // The latest-activity text as Hostaway gave it, compared as text by the database (no zone to get wrong).
  marker: string;
  // The same moment as an ISO time, when it could be read: newest first, and old conversations skipped.
  activityAt: string | null;
};
export type SyncMessage = { id: string; incoming: boolean; body: string; sentAt: string };

// "2026-10-12 09:30:00" (UTC), "2026-10-12T09:30:00Z", "2026-10-12T10:30:00+01:00" or "2026-10-12" -> ISO UTC.
export function hostawayTime(value: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text(value));
  if (!m) return null;
  const zone = !m[3] ? 'Z' : m[3].toUpperCase() === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const time = m[2] ? (m[2].length === 5 ? m[2] + ':00' : m[2]) : '00:00:00';
  const at = new Date(`${m[1]}T${time}${zone}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function syncConversation(raw: unknown): SyncConversation | null {
  const c = object(raw), stay = object(c.Reservation ?? c.reservation);
  const id = first(c.id, c.conversationId);
  if (!id) return null;
  const guestName = first(c.recipientName, c.guestName, stay.guestName, [first(stay.guestFirstName), first(stay.guestLastName)].filter(Boolean).join(' ')).slice(0, 120);
  const date = (...values: unknown[]) => { const d = first(...values).slice(0, 10); return day.test(d) ? d : null; };
  const channelName = first(stay.channelName, c.channelName);
  const times = FIELDS.activity.map(k => c[k]);
  const latest = times.map(hostawayTime).filter((t): t is string => t !== null).sort().pop() ?? null;
  return {
    id,
    listingId: first(c.listingMapId, c.listingId, stay.listingMapId),
    reservationId: first(c.reservationId, stay.id),
    guestName,
    checkIn: date(c.arrivalDate, stay.arrivalDate), checkOut: date(c.departureDate, stay.departureDate),
    channel: channelName ? syncChannel(channelName) : 'other',
    marker: times.some(t => text(t)) ? times.map(text).join('|').slice(0, 100) : '',
    activityAt: latest,
  };
}

export function syncMessage(raw: unknown): SyncMessage | null {
  const m = object(raw);
  const id = first(m.id);
  const state = first(m.status).toLowerCase();
  const sentAt = FIELDS.messageTime.map(k => hostawayTime(m[k])).find(Boolean) ?? null;
  if (!id || !sentAt || NOT_SENT.includes(state)) return null;
  const photos = Array.isArray(m.imagesUrls) ? m.imagesUrls.length > 0 : Boolean(first(m.imagesUrls));
  const body = first(m.body).slice(0, 5000) || (photos ? '(Photo)' : '');
  if (!body) return null;
  const flag = m.isIncoming;
  return { id, incoming: flag === true || flag === 1 || flag === '1' || (typeof flag === 'string' && flag.toLowerCase() === 'true'), body, sentAt };
}

// Hostaway's unified webhook for a new message: only the conversation id is used. The messages are
// always fetched fresh from the Hostaway API, so a forged body can't write anything.
const messageWebhookSchema = z.object({
  object: z.string().max(100).optional(),
  event: z.string().max(100).optional(),
  data: z.object({ id: z.union([z.string().min(1).max(100), z.number().int().positive()]).optional(), conversationId: z.union([z.string().min(1).max(100), z.number().int().positive()]).optional() }).passthrough(),
}).passthrough();
export function webhookConversationId(body: unknown) {
  const parsed = messageWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const kind = `${parsed.data.object ?? ''} ${parsed.data.event ?? ''}`.toLowerCase();
  if (!kind.includes('message') && !kind.includes('conversation')) return null;
  const { id, conversationId } = parsed.data.data;
  // A message event names its conversation; an event about the conversation itself carries its id.
  const found = conversationId ?? (kind.includes('message') ? undefined : id);
  return found === undefined ? null : String(found);
}
