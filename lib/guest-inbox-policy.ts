import { z } from 'zod';

// The guest inbox: conversations with guests from Airbnb, Booking.com, Vrbo and direct. Hostaway
// fills it by itself (guest messages and the team's replies sent there) and, when switched on
// (HOSTAWAY_REPLIES_ENABLED), delivers replies written here. Messages from elsewhere, such as email,
// are logged by hand, and a reply can be recorded here, so reply times count either way.
// GUEST_CHANNELS is everything a stored conversation may carry, so a WhatsApp thread logged earlier still
// opens and keeps its label. OFFERED_CHANNELS is what a person can pick in the app: WhatsApp is not offered.
// The database decides who sees each conversation.
const uuid = z.string().uuid();
export const GUEST_CHANNELS = ['airbnb', 'booking_com', 'vrbo', 'direct', 'whatsapp', 'email', 'other'] as const;
export type GuestChannel = (typeof GUEST_CHANNELS)[number];
export const OFFERED_CHANNELS = GUEST_CHANNELS.filter(channel => channel !== 'whatsapp');
export const CHANNEL_LABEL: Record<GuestChannel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', whatsapp: 'WhatsApp', email: 'Email', other: 'Other' };
export const INBOX_FILTERS = ['waiting', 'open', 'done', 'all'] as const;
export const inboxReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('list'), status: z.enum(INBOX_FILTERS).default('waiting') }).strict(),
  z.object({ section: z.literal('thread'), threadId: uuid }).strict(),
]);
const when = z.string().datetime({ offset: true }).optional();
const body = z.string().trim().max(5000, 'Messages can be up to 5,000 characters');
export const inboxActionSchema = z.discriminatedUnion('action', [
  // A guest message received outside Recharge: into an existing conversation, or a new one.
  z.object({ action: z.literal('logMessage'), requestId: uuid, threadId: uuid.optional(), propertyId: uuid.optional(), channel: z.enum(GUEST_CHANNELS).optional(),
    guestName: z.string().trim().max(120).optional(), reservationRef: z.string().trim().max(100).optional(), body: body.min(1, 'Add the guest’s message'), sentAt: when }).strict(),
  // The team's reply; empty when it was sent on the platform and only the time is recorded.
  z.object({ action: z.literal('reply'), requestId: uuid, threadId: uuid, body: body.default(''), sentAt: when }).strict(),
  // A reply delivered to the guest through Hostaway (Hostaway conversations only, and only while sending is switched on).
  z.object({ action: z.literal('sendReply'), requestId: uuid, threadId: uuid, body: body.min(1, 'Write the reply') }).strict(),
  z.object({ action: z.literal('setStatus'), requestId: uuid, threadId: uuid, status: z.enum(['open', 'done']) }).strict(),
  z.object({ action: z.literal('editThread'), requestId: uuid, threadId: uuid, propertyId: uuid.nullable(), guestName: z.string().trim().min(1, 'Add the guest’s name').max(120), reservationRef: z.string().trim().max(100).default('') }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'logMessage' && !value.threadId && (!value.channel || !value.guestName)) context.addIssue({ code: 'custom', message: 'Add the guest’s name and where the message came from' });
});
export type InboxAction = z.infer<typeof inboxActionSchema>;

export const guestThreadSchema = z.object({
  id: uuid, source: z.string(), channel: z.enum(GUEST_CHANNELS), guestName: z.string().nullable(), propertyId: uuid.nullable(), propertyName: z.string().nullable(),
  reservationRef: z.string().nullable(), checkIn: z.string().nullable(), checkOut: z.string().nullable(), status: z.enum(['open', 'done']),
  lastMessageAt: z.string().nullable(), preview: z.string().nullable(), lastFrom: z.enum(['guest', 'team']).nullable(), waitingSince: z.string().nullable(), messages: z.number(),
  // The reader replied or logged a message here, or looks after the property (the Mine chip).
  mine: z.boolean().default(false),
});
export type GuestThread = z.infer<typeof guestThreadSchema>;
const targets = z.object({ greenMinutes: z.number(), amberMinutes: z.number() });
// canSend: replies written here are delivered to the guest through Hostaway (decided by the server, not the database).
export const inboxListSchema = z.object({ threads: z.array(guestThreadSchema), waiting: z.number(), targets, connected: z.boolean(), canSend: z.boolean().default(false) });
// files: attachments kept from an email (open them through /api/workspace/email-files).
export const guestFileSchema = z.object({ id: uuid, filename: z.string(), mime: z.string(), bytes: z.number() });
export const guestMessageSchema = z.object({ id: uuid, direction: z.enum(['guest', 'team']), body: z.string().nullable(), sentAt: z.string(), delivery: z.string().nullable(), author: z.string().nullable(), files: z.array(guestFileSchema).default([]) });
export const inboxThreadSchema = z.object({ thread: guestThreadSchema, targets, messages: z.array(guestMessageSchema), canSend: z.boolean().default(false) });

// How long a guest has been waiting, graded like reply times: green, amber, then red.
export function waitGrade(since: string | null, t: { greenMinutes: number; amberMinutes: number }, now = Date.now()) {
  if (!since) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  return { minutes, grade: minutes <= t.greenMinutes ? 'green' as const : minutes <= t.amberMinutes ? 'amber' as const : 'red' as const };
}
export function waitLabel(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} days`;
}
