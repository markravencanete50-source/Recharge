import { z } from 'zod';
import { REPORT_REASONS, attachmentSchema, type ReportReason } from './workspace-chat-policy';

// Reporting and blocking in Messages, and the admins' Reported messages view. Anyone in a
// conversation can report a message that is not theirs; admins and super admins remove the
// message (hidden for everyone) or dismiss the report. Blocking is one person's choice and only
// ever hides things for them (see the handover).
export { REPORT_REASONS, type ReportReason };
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  offensive: 'Offensive or abusive', harassment: 'Harassment', media: 'Inappropriate photo or video', spam: 'Spam', other: 'Something else',
};
export const REPORT_REASON_ICON: Record<ReportReason, string> = { offensive: 'alert-octagon', harassment: 'user-x', media: 'image', spam: 'slash', other: 'flag' };
export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { open: 'Open', actioned: 'Message removed', dismissed: 'Dismissed' };

// What people read.
export const REPORT_THANKS = 'Thanks. An admin will review this.';
export const REMOVED_LABEL = 'Removed by an admin';
export const BLOCKED_LABEL = 'Message from someone you blocked';

// Guest and client messages can be reported too (Messages > Guests and Clients). An admin hides one in the app rather than
// removing it: it stays wherever it came from, and guests and email senders cannot be blocked.
export const REPORT_SOURCES = ['chat', 'guest_message', 'guest_email', 'client_email'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const REPORT_SOURCE_LABEL: Record<ReportSource, string> = { chat: 'Team chat', guest_message: 'Guest message', guest_email: 'Guest email', client_email: 'Client email' };
export const HIDDEN_LABEL = 'Hidden by an admin';
export const HIDE_EXPLAINED = 'This hides the message for the team in Recharge, shown as “Hidden by an admin”. It cannot delete it from Airbnb, Booking.com or the sender’s mailbox.';
export const isInboxReport = (r: Pick<ChatReport, 'source'>) => r.source !== 'chat';
// "Message removed" for Team chat, "Hidden in the app" for a guest or client message.
export const reportStatusLabel = (r: Pick<ChatReport, 'source' | 'status'>) => r.status === 'actioned' && isInboxReport(r) ? 'Hidden in the app' : REPORT_STATUS_LABEL[r.status];

// Admins and super admins review reports (the database checks it again).
export const MODERATOR_ROLES = ['admin', 'super_admin'] as const;
export const canModerateChat = (role: string) => (MODERATOR_ROLES as readonly string[]).includes(role);

export const chatReportSchema = z.object({
  id: z.string().uuid(), status: z.enum(REPORT_STATUSES), reason: z.enum(REPORT_REASONS), note: z.string(), createdAt: z.string(), version: z.number().int().positive(),
  // Team chat, or a guest or client message: then the sender has no account (authorId is null), and openId opens the
  // conversation in Messages ("guest:<id>" or "email:<id>").
  source: z.enum(REPORT_SOURCES).default('chat'), openId: z.string().nullable().default(null), propertyName: z.string().nullable().default(null),
  messageId: z.string().uuid(), conversationId: z.string().uuid(), conversation: z.string().nullable(),
  body: z.string(), sentAt: z.string(), removed: z.boolean(), removedAt: z.string().nullable(),
  // Photos and videos in the message; their files can be opened while the report is open.
  attachmentCount: z.number().int().min(0), attachments: z.array(attachmentSchema).default([]),
  authorId: z.string().uuid().nullable(), authorName: z.string().nullable(), authorRole: z.string().nullable(),
  reporterId: z.string().uuid(), reporterName: z.string().nullable(),
  handledAt: z.string().nullable(), handledByName: z.string().nullable(),
  // How many reports this message has had, and how many its sender has had in all.
  sameMessageReports: z.number().int().min(1), authorReports: z.number().int().min(1),
});
export type ChatReport = z.infer<typeof chatReportSchema>;
export const chatReportsSchema = z.object({ open: z.number().int().min(0), items: z.array(chatReportSchema) });
export type ChatReports = z.infer<typeof chatReportsSchema>;

// The list's counts, and its filters (open, actioned, dismissed, or everything).
export function reportCounts(items: readonly Pick<ChatReport, 'status'>[]) {
  return { open: items.filter(i => i.status === 'open').length, actioned: items.filter(i => i.status === 'actioned').length, dismissed: items.filter(i => i.status === 'dismissed').length, all: items.length };
}
// "2 photos", "1 video", "1 photo and 1 video" for the report cards (when the files themselves are
// no longer listed, only how many there were).
export function attachmentSummary(items: readonly { kind: string }[], count = items.length) {
  if (!count) return '';
  if (!items.length) return count === 1 ? '1 photo or video' : `${count} photos or videos`;
  const videos = items.filter(i => i.kind === 'video').length, photos = items.length - videos;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [photos ? part(photos, 'photo') : '', videos ? part(videos, 'video') : ''].filter(Boolean).join(' and ');
}
