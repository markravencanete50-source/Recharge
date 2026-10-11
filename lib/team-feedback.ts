import { z } from 'zod';

// Team feedback: admins and the Stays team send it under their own name, and only super admins
// read it (their Feedback inbox), mark it seen or done, and reply.
export const FEEDBACK_CATEGORIES = ['idea', 'problem', 'praise', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ['new', 'seen', 'done'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const CATEGORY_LABEL: Record<FeedbackCategory, string> = { idea: 'Idea', problem: 'Problem', praise: 'Praise', other: 'Other' };
export const CATEGORY_ICON: Record<FeedbackCategory, string> = { idea: 'zap', problem: 'alert-triangle', praise: 'heart', other: 'message-square' };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'New', seen: 'Seen', done: 'Done' };
// Who may send feedback; super admins receive it.
export const FEEDBACK_SENDERS = ['admin', 'stays'] as const;
export const canSendFeedback = (role: string) => (FEEDBACK_SENDERS as readonly string[]).includes(role);
export const FEEDBACK_ROLES = ['super_admin', ...FEEDBACK_SENDERS] as const;

export const feedbackItemSchema = z.object({
  id: z.string().uuid(), category: z.enum(FEEDBACK_CATEGORIES), message: z.string(), status: z.enum(FEEDBACK_STATUSES), createdAt: z.string(), version: z.number().int().positive(),
  sentBy: z.string().uuid(), senderRole: z.string(), senderName: z.string().nullable(),
  reply: z.string(), repliedAt: z.string().nullable(), repliedByName: z.string().nullable(),
  handledAt: z.string().nullable(), handledByName: z.string().nullable(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;
export const feedbackSchema = z.object({ inbox: z.boolean(), canSend: z.boolean(), items: z.array(feedbackItemSchema) });
export type Feedback = z.infer<typeof feedbackSchema>;

// The inbox counts, and its filters (new, seen, done, or everything).
export function feedbackCounts(items: readonly Pick<FeedbackItem, 'status'>[]) {
  return { new: items.filter(i => i.status === 'new').length, seen: items.filter(i => i.status === 'seen').length, done: items.filter(i => i.status === 'done').length, all: items.length };
}
