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
  z.object({ section: z.literal('savedReplies') }).strict(),
]);
const replyFields = {
  title: z.string().trim().min(2, 'Give the reply a short title').max(80, 'Keep the title to 80 characters'),
  body: z.string().trim().min(2, 'Write the reply').max(2000, 'Saved replies can be up to 2,000 characters'),
  audience: z.enum(['guest', 'owner', 'all']),
};
export const chatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('startDirect'), userId: uuid }).strict(),
  z.object({ action: z.literal('startGroup'), title: z.string().trim().min(2).max(80), userIds: z.array(uuid).min(1).max(50), propertyId: uuid.optional(), workId: uuid.optional() }).strict(),
  z.object({ action: z.literal('startOwner'), ownerId: uuid.optional() }).strict(),
  z.object({ action: z.literal('send'), requestId: uuid, conversationId: uuid, body: z.string().trim().min(1, 'Write a message').max(4000, 'Messages can be up to 4,000 characters') }).strict(),
  z.object({ action: z.literal('markRead'), conversationId: uuid }).strict(),
  // The team conversation for a property, or for one job there.
  z.object({ action: z.literal('startProperty'), propertyId: uuid, workId: uuid.optional() }).strict(),
  // Saved replies: a new one, or a change to one (with the version it was read at).
  z.object({ action: z.literal('saveReply'), replyId: uuid.optional(), version: z.number().int().positive().optional(), ...replyFields }).strict(),
  z.object({ action: z.literal('deleteReply'), replyId: uuid, version: z.number().int().positive() }).strict(),
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

// The guest inbox (and saved replies) are for team members with the guest communication tool;
// admins hold every tool.
export const hasGuestInbox = (account: { role: string; modules: readonly string[] }) => account.role !== 'client' && account.role !== 'cleans' && account.modules.includes('guest-communication');

// Saved replies: short answers the team inserts into a reply to guests or owners, then edits.
export const SAVED_AUDIENCES = ['guest', 'owner', 'all'] as const;
export const SAVED_AUDIENCE_LABEL: Record<(typeof SAVED_AUDIENCES)[number], string> = { guest: 'Guests', owner: 'Owners', all: 'Guests and owners' };
export const savedReplySchema = z.object({ id: uuid, title: z.string(), body: z.string(), audience: z.enum(SAVED_AUDIENCES), version: z.number(), updatedAt: z.string(), updatedBy: z.string().nullable() });
export type SavedReply = z.infer<typeof savedReplySchema>;
export const savedRepliesSchema = z.object({ canEdit: z.boolean(), replies: z.array(savedReplySchema) });
export const repliesFor = (replies: SavedReply[], audience: 'guest' | 'owner') => replies.filter(r => r.audience === audience || r.audience === 'all');
// {guest} becomes the first name of the person being written to and {property} the property.
export function fillReply(body: string, fill: { name?: string | null; property?: string | null }) {
  const first = (fill.name ?? '').replace(/^Recharge · /, '').trim().split(/\s+/)[0] ?? '';
  const property = (fill.property ?? '').trim();
  return body.replace(/\{\s*(guest|owner|name)\s*\}/gi, first || 'there').replace(/\{\s*property\s*\}/gi, property || 'the property');
}
