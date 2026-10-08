import { z } from 'zod';

// Chat requests. The database decides who may see or join each conversation.
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const chatReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('list') }).strict(),
  z.object({ section: z.literal('unread') }).strict(),
  z.object({ section: z.literal('people') }).strict(),
  z.object({ section: z.literal('messages'), conversationId: uuid, before: z.string().datetime({ offset: true }).optional() }).strict(),
  z.object({ section: z.literal('clientRelations'), from: day, to: day }).strict(),
]);
export const chatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('startDirect'), userId: uuid }).strict(),
  z.object({ action: z.literal('startGroup'), title: z.string().trim().min(2).max(80), userIds: z.array(uuid).min(1).max(50), propertyId: uuid.optional(), workId: uuid.optional() }).strict(),
  z.object({ action: z.literal('startOwner'), ownerId: uuid.optional() }).strict(),
  z.object({ action: z.literal('send'), requestId: uuid, conversationId: uuid, body: z.string().trim().min(1, 'Write a message').max(4000, 'Messages can be up to 4,000 characters') }).strict(),
  z.object({ action: z.literal('markRead'), conversationId: uuid }).strict(),
]);
export type ChatAction = z.infer<typeof chatActionSchema>;

export const conversationSchema = z.object({
  id: uuid, kind: z.enum(['direct', 'group', 'owner']), title: z.string(), subtitle: z.string().nullable(), propertyId: uuid.nullable(), workId: uuid.nullable(),
  propertyName: z.string().nullable(), lastMessageAt: z.string(), unread: z.number(),
  last: z.object({ body: z.string(), authorName: z.string(), at: z.string() }).nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const messageSchema = z.object({ id: uuid, body: z.string(), at: z.string(), mine: z.boolean(), authorName: z.string(), fromOwner: z.boolean() });
export type ChatMessage = z.infer<typeof messageSchema>;
export const threadSchema = z.object({ conversation: conversationSchema, messages: z.array(messageSchema) });
export const chatPeopleSchema = z.object({ team: z.array(z.object({ userId: uuid, fullName: z.string(), role: z.string() })), owners: z.array(z.object({ userId: uuid, fullName: z.string(), role: z.string() })) });

// When a message was sent, in words: a time today, a weekday this week, otherwise a date.
export function chatTime(iso: string, now = new Date()) {
  const at = new Date(iso);
  const opts = { timeZone: 'Europe/London' } as const;
  const sameDay = at.toLocaleDateString('en-GB', opts) === now.toLocaleDateString('en-GB', opts);
  if (sameDay) return at.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - at.getTime() < 6 * 86400000) return at.toLocaleDateString('en-GB', { ...opts, weekday: 'short' });
  return at.toLocaleDateString('en-GB', { ...opts, day: 'numeric', month: 'short' });
}
