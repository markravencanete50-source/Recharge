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
  // Who is in a conversation (a group's members, a channel's team), with photos and who is online.
  z.object({ section: z.literal('members'), conversationId: uuid }).strict(),
  // The people you have blocked.
  z.object({ section: z.literal('blocks') }).strict(),
]);
// Reporting a message: why, and an optional note for the admins who review it.
export const REPORT_REASONS = ['offensive', 'harassment', 'media', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const MAX_REPORT_NOTE = 500;
// Where a reported guest or client message lives: a guest conversation, or an email to client relations.
export const INBOX_REPORT_SOURCES = ['guest', 'client_email'] as const;
export type InboxReportSource = (typeof INBOX_REPORT_SOURCES)[number];
// Reactions, one per person per message; tapping yours again takes it off.
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '✅'] as const;
// Photos and a video in a message: up to 5 photos (15 MB each) and 1 video (50 MB).
export const MAX_CHAT_PHOTOS = 5, MAX_CHAT_VIDEOS = 1, MAX_CHAT_PHOTO_BYTES = 15 * 1024 * 1024, MAX_CHAT_VIDEO_BYTES = 50 * 1024 * 1024;
export const CHAT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const CHAT_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
// Voice notes (Alex, on a phone: "like WhatsApp"; migration 20261021100000): one on its own, up to 5 minutes and 10 MB. Safari
// (and every iPhone browser) records AAC in MP4; the others record Opus, which an iPhone does not play, so the app turns it
// into WAV (16 kHz mono, about 1.9 MB a minute) before sending. Every note then plays everywhere, iPhones included.
export const CHAT_AUDIO_TYPES = ['audio/mp4', 'audio/wav'] as const;
export const MAX_CHAT_AUDIO_BYTES = 10 * 1024 * 1024, MAX_VOICE_MS = 5 * 60_000;
const chatFileSchema = z.object({ name: z.string().max(200).default(''), mime: z.enum([...CHAT_PHOTO_TYPES, ...CHAT_VIDEO_TYPES, ...CHAT_AUDIO_TYPES]), bytes: z.number().int().min(1).max(MAX_CHAT_VIDEO_BYTES),
  width: z.number().int().min(1).max(20000).optional(), height: z.number().int().min(1).max(20000).optional(),
  // A voice note's length in milliseconds (the database allows a few seconds over the 5 minutes for the recorder to stop).
  durationMs: z.number().int().min(1).max(MAX_VOICE_MS + 5000).optional() }).strict();
const isAudio = (mime: string) => (CHAT_AUDIO_TYPES as readonly string[]).includes(mime);
// "0:42": a voice note's length, rounded to the second (as the database writes it). With floor, the running timer while recording.
export function voiceLength(ms: number, floor = false) {
  const s = floor ? Math.max(0, Math.floor(ms / 1000)) : Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// What a voice note reads as in the list, in previews and in pop-ups (private.chat_attachment_label).
export const voiceLabel = (ms: number) => `🎤 Voice note (${voiceLength(ms)})`;
// The length in a preview that is a voice note's label ("0:42"), or null.
export const voicePreviewLength = (preview: string) => /^🎤 Voice note \((\d+:\d{2})\)$/.exec(preview.trim())?.[1] ?? null;
// What is wrong with a set of files for one message, or null when they can be sent.
export function chatFilesProblem(files: readonly { mime: string; bytes: number }[]) {
  const photos = files.filter(f => f.mime.startsWith('image/')), videos = files.filter(f => f.mime.startsWith('video/')), voice = files.filter(f => isAudio(f.mime));
  if (voice.length && files.length > 1) return 'Send a voice note on its own.';
  if (voice.some(f => f.bytes > MAX_CHAT_AUDIO_BYTES)) return 'Voice notes can be up to 10 MB.';
  if (voice.length) return null;
  if (files.some(f => !(CHAT_PHOTO_TYPES as readonly string[]).includes(f.mime) && !(CHAT_VIDEO_TYPES as readonly string[]).includes(f.mime))) return 'Add photos (JPG, PNG, WebP, GIF) or a video (MP4, MOV, WebM).';
  if (photos.length > MAX_CHAT_PHOTOS) return `Send up to ${MAX_CHAT_PHOTOS} photos at a time.`;
  if (videos.length > MAX_CHAT_VIDEOS) return 'Send 1 video at a time.';
  if (photos.some(f => f.bytes > MAX_CHAT_PHOTO_BYTES)) return 'Photos can be up to 15 MB each.';
  if (videos.some(f => f.bytes > MAX_CHAT_VIDEO_BYTES)) return 'Videos can be up to 50 MB.';
  return null;
}
const replyFields = {
  title: z.string().trim().min(2, 'Give the reply a short title').max(80, 'Keep the title to 80 characters'),
  body: z.string().trim().min(2, 'Write the reply').max(2000, 'Saved replies can be up to 2,000 characters'),
  audience: z.enum(['guest', 'owner', 'all']),
};
export const chatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('startDirect'), userId: uuid }).strict(),
  z.object({ action: z.literal('startGroup'), title: z.string().trim().min(2, 'Give the group a name of 2 to 80 characters').max(80).optional(), userIds: z.array(uuid).min(1).max(50), propertyId: uuid.optional(), workId: uuid.optional() }).strict(),
  z.object({ action: z.literal('startOwner'), ownerId: uuid.optional() }).strict(),
  z.object({ action: z.literal('send'), requestId: uuid, conversationId: uuid, body: z.string().trim().max(4000, 'Messages can be up to 4,000 characters'),
    // Files uploaded for this message with prepareFiles (words, photos or both).
    attachments: z.array(uuid).max(MAX_CHAT_PHOTOS + MAX_CHAT_VIDEOS).optional() }).strict(),
  z.object({ action: z.literal('markRead'), conversationId: uuid }).strict(),
  // Makes the team channels (Everyone and each department) the first time anyone opens Messages.
  z.object({ action: z.literal('openTeams') }).strict(),
  // The team conversation for a property, or for one job there.
  z.object({ action: z.literal('startProperty'), propertyId: uuid, workId: uuid.optional() }).strict(),
  // Saved replies: a new one, or a change to one (with the version it was read at).
  z.object({ action: z.literal('saveReply'), replyId: uuid.optional(), version: z.number().int().positive().optional(), ...replyFields }).strict(),
  z.object({ action: z.literal('deleteReply'), replyId: uuid, version: z.number().int().positive() }).strict(),
  // The app is open (every minute while in view), for who is online.
  z.object({ action: z.literal('heartbeat') }).strict(),
  z.object({ action: z.literal('react'), messageId: uuid, emoji: z.enum(REACTIONS) }).strict(),
  // Safety: report a message that is not yours (one open report per message), and block or
  // unblock a person. Blocking hides their messages from you; it changes nothing for anyone else.
  z.object({ action: z.literal('reportMessage'), requestId: uuid, messageId: uuid, reason: z.enum(REPORT_REASONS), note: z.string().trim().max(MAX_REPORT_NOTE, `Keep the note to ${MAX_REPORT_NOTE} characters`).optional() }).strict(),
  // A message from a guest (Messages > Guests) or from someone emailing client relations (Clients) is reported the same way.
  z.object({ action: z.literal('reportInboxMessage'), requestId: uuid, source: z.enum(INBOX_REPORT_SOURCES), messageId: uuid, reason: z.enum(REPORT_REASONS), note: z.string().trim().max(MAX_REPORT_NOTE, `Keep the note to ${MAX_REPORT_NOTE} characters`).optional() }).strict(),
  z.object({ action: z.literal('blockUser'), userId: uuid }).strict(),
  z.object({ action: z.literal('unblockUser'), userId: uuid }).strict(),
  // One-off upload links for photos and a video, sent straight to storage; discardFiles lets go of
  // ones taken out before sending.
  z.object({ action: z.literal('prepareFiles'), conversationId: uuid, files: z.array(chatFileSchema).min(1).max(MAX_CHAT_PHOTOS + MAX_CHAT_VIDEOS) }).strict(),
  z.object({ action: z.literal('discardFiles'), ids: z.array(uuid).min(1).max(MAX_CHAT_PHOTOS + MAX_CHAT_VIDEOS) }).strict(),
  // Groups: anyone in one adds people or renames it; whoever started it (or an admin) removes
  // people; anyone leaves (removes themselves).
  z.object({ action: z.literal('addMembers'), conversationId: uuid, userIds: z.array(uuid).min(1).max(50) }).strict(),
  z.object({ action: z.literal('removeMember'), conversationId: uuid, userId: uuid }).strict(),
  z.object({ action: z.literal('renameGroup'), conversationId: uuid, title: z.string().trim().min(2, 'Give the group a name of 2 to 80 characters').max(80).optional() }).strict(),
  // The team closes or reopens an owner conversation (the Clients tab's Closed filter); a new message reopens it.
  z.object({ action: z.literal('closeConversation'), conversationId: uuid, closed: z.boolean() }).strict(),
// A message is words, photos or a video, or any of them together; never nothing.
]).superRefine((input, ctx) => { if (input.action === 'send' && !input.body && !input.attachments?.length) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write a message' }); });
export type ChatAction = z.infer<typeof chatActionSchema>;

// Team channels: Everyone, and one for each department, always listed first and in this order.
export const CHANNEL_ORDER = ['all', 'management', 'guest_relations', 'client_relations', 'cleaning', 'ready', 'accounts'] as const;
export const channelSchema = z.enum(CHANNEL_ORDER);
const seenSchema = z.string().nullable().default(null);
const peerSchema = z.object({ userId: uuid, photo: z.string().nullable().default(null), seenAt: seenSchema });
export const conversationSchema = z.object({
  id: uuid, kind: z.enum(['direct', 'group', 'owner']), department: channelSchema.nullable().default(null), title: z.string(), subtitle: z.string().nullable(), propertyId: uuid.nullable(), workId: uuid.nullable(),
  propertyName: z.string().nullable(), lastMessageAt: z.string(), unread: z.number(),
  last: z.object({ body: z.string(), authorName: z.string(), at: z.string(), fromOwner: z.boolean().optional(), kind: z.enum(['text', 'event']).default('text') }).nullable(),
  // The other person in a direct message (or the owner, for the team): their photo and when they were last in.
  peer: peerSchema.nullable().default(null),
  // False for a group with no name of its own (it is called after its people).
  named: z.boolean().default(true),
  // For the inbox chips: the reader's own conversation (a member, has written, or looks after the
  // owner's property) and the properties it is about.
  mine: z.boolean().optional(), propertyIds: z.array(uuid).default([]),
  // An owner conversation the team has closed (the team's view only; migration 20261015320000).
  closed: z.boolean().default(false),
});
export type Conversation = z.infer<typeof conversationSchema>;
// The channels first, in their fixed order, then everything else as the list gave it (newest first).
export function channelsFirst<T extends { department: (typeof CHANNEL_ORDER)[number] | null }>(items: readonly T[]): T[] {
  const rank = (c: T) => c.department ? CHANNEL_ORDER.indexOf(c.department) : CHANNEL_ORDER.length;
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i).map(x => x.item);
}
export const attachmentSchema = z.object({ id: uuid, kind: z.enum(['image', 'video', 'audio']), mime: z.string(), name: z.string(), bytes: z.number(), width: z.number().nullable().default(null), height: z.number().nullable().default(null),
  // A voice note's length (migration 20261021100000); empty for photos and videos.
  durationMs: z.number().nullable().default(null) });
export type ChatAttachment = z.infer<typeof attachmentSchema>;
export const reactionSchema = z.object({ emoji: z.string(), count: z.number(), mine: z.boolean(), names: z.array(z.string()) });
export type ChatReaction = z.infer<typeof reactionSchema>;
export const messageSchema = z.object({ id: uuid, body: z.string(), at: z.string(), mine: z.boolean(), authorName: z.string(), // Only owner conversations have an owner to compare with, so older replies may leave this empty.
  fromOwner: z.boolean().nullish().transform(v => v ?? false),
  authorId: uuid.optional(), authorPhoto: z.string().nullable().default(null),
  // An "event" is a line about the group ("added Alex"), shown in the middle.
  kind: z.enum(['text', 'event']).default('text'), attachments: z.array(attachmentSchema).default([]), reactions: z.array(reactionSchema).default([]),
  // Removed by an admin (for everyone), or written by someone you blocked (for you). Either way the words, photos and reactions are withheld.
  removed: z.boolean().default(false), blocked: z.boolean().default(false) });
export type ChatMessage = z.infer<typeof messageSchema>;
export const threadSchema = z.object({ conversation: conversationSchema, messages: z.array(messageSchema) });
const personSchema = z.object({ userId: uuid, fullName: z.string(), role: z.string(), photo: z.string().nullable().default(null), seenAt: seenSchema });
export const chatPeopleSchema = z.object({ team: z.array(personSchema), owners: z.array(personSchema) });
export const membersSchema = z.object({ kind: z.enum(['direct', 'group', 'owner']), department: channelSchema.nullable(), title: z.string().nullable(), canAdd: z.boolean(), canRemove: z.boolean(),
  members: z.array(personSchema.extend({ about: z.string().default(''), you: z.boolean(), creator: z.boolean() })) });
export type ChatMembers = z.infer<typeof membersSchema>;
// The people you have blocked, newest first.
export const blockedPersonSchema = z.object({ userId: uuid, fullName: z.string(), role: z.string(), photo: z.string().nullable().default(null), blockedAt: z.string() });
export type BlockedPerson = z.infer<typeof blockedPersonSchema>;
export const blockedPeopleSchema = z.array(blockedPersonSchema);
export const reportedSchema = z.object({ reported: z.literal(true), reportId: uuid, authorId: uuid, blocked: z.boolean() });
export const inboxReportedSchema = z.object({ reported: z.literal(true), reportId: uuid });
export const preparedFilesSchema = z.object({ files: z.array(z.object({ id: uuid, path: z.string(), mime: z.string(), uploadUrl: z.string().url() })) });
export const chatFileLinksSchema = z.record(z.string(), z.object({ url: z.string().url(), mime: z.string(), name: z.string(), kind: z.enum(['image', 'video', 'audio']) }));

// Who is online: in the app within the last couple of minutes (the app checks in every minute).
export const ONLINE_MS = 150_000;
export type Presence = 'online' | 'recent' | 'away' | 'unknown';
export function presenceOf(seenAt: string | null | undefined, now = Date.now()): Presence {
  if (!seenAt) return 'unknown';
  const ago = now - Date.parse(seenAt);
  return ago < ONLINE_MS ? 'online' : ago < 3600_000 ? 'recent' : 'away';
}
// "Online", "Active 5m ago", "Active 3h ago", "Active yesterday", "Active 2 Oct"; empty when never seen.
export function presenceLabel(seenAt: string | null | undefined, now = Date.now()) {
  if (!seenAt) return '';
  const ago = Math.max(0, now - Date.parse(seenAt));
  if (ago < ONLINE_MS) return 'Online';
  if (ago < 3600_000) return `Active ${Math.max(1, Math.round(ago / 60_000))}m ago`;
  if (ago < 24 * 3600_000) return `Active ${Math.round(ago / 3600_000)}h ago`;
  if (ago < 48 * 3600_000) return 'Active yesterday';
  return 'Active ' + new Date(seenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

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
// admins hold every tool. Owners, cleaners and Ready (maintenance) never use guest messaging, whatever
// tools they hold (client answer 12; the database's private.workspace_guest_messaging_role, migration
// 20261014310000, has the same list and decides).
export const GUEST_MESSAGING_BLOCKED_ROLES = ['client', 'cleans', 'ready'] as const;
export const hasGuestInbox = (account: { role: string; modules: readonly string[] }) =>
  !(GUEST_MESSAGING_BLOCKED_ROLES as readonly string[]).includes(account.role) && account.modules.includes('guest-communication');

// The tabs of Messages (round 5): Guests for the guest inbox, Clients for the people who answer owners (or anyone who
// already has an owner conversation), and Team for everyone on the team. Never an Updates tab. Owners get no tabs:
// their Messages is their one conversation with Recharge.
// Lee, 14 October: every email has its own tab, so the order is Guests, Clients, Guest emails, Client emails, Team. Guests and
// Clients keep the platform (Airbnb, Booking.com, Vrbo, direct) and app conversations; Guest emails is guestrelations@ and Client
// emails is ownerrelations@ (for admins, super admins and Stays; the database lets in the client relations and management rota).
export type MessagesTab = 'guests' | 'clients' | 'guestEmails' | 'clientEmails' | 'team';
export function messageTabs(account: { role: string; modules: readonly string[] }, hasOwnerConversation = false): MessagesTab[] {
  if (account.role === 'client') return [];
  const answersOwners = ['admin', 'super_admin', 'stays'].includes(account.role), clients = answersOwners || hasOwnerConversation, guests = hasGuestInbox(account);
  return [...(guests ? ['guests' as const] : []), ...(clients ? ['clients' as const] : []), ...(guests ? ['guestEmails' as const] : []), ...(answersOwners ? ['clientEmails' as const] : []), 'team'];
}

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
