import { z } from 'zod';
import { REFLECTION_MIN_CHARS, REFLECTIONS_WINDOW_DAYS, reflectionRequired } from './feedback-defaults';

// The end-of-day reflection (client ask A7). People in some roles must write one before they can clock out.
// Everything here is pure: shaping what the `reflection` and `reflections` reads send back, checking what
// a person typed, and building the saveReflection and markReflectionsReviewed actions. The database has
// the last word; these checks only spare the person a round trip.

export const REFLECTION_NOTE_MAX = 2000;
export const REFLECTION_ITEMS_MAX = 100;
const ITEM_KIND_MAX = 40, ITEM_REF_MAX = 80, ITEM_LABEL_MAX = 200;
export const REVIEW_IDS_MAX = 100;

// Whether this role has to write a reflection before clocking out (cleaners and admins do not).
export const needsReflection = (role: string | null | undefined): boolean => reflectionRequired(role);

// What the database says when a clock-out is refused for want of a reflection.
export const REFLECTION_REFUSAL = 'Fill in your end-of-day reflection before clocking out';
export const isReflectionRefusal = (text: unknown): boolean => typeof text === 'string' && /end-of-day reflection/i.test(text);

export const REFLECTION_COPY = {
  title: 'End-of-day reflection',
  subtitle: 'A few words on today before you finish',
  intro: 'Look back over your day. Say what went well or what did not, then clock out.',
  wentWell: 'What went well today',
  wentWellHint: 'A win, something that worked, someone who helped',
  notWell: 'What did not go so well',
  notWellHint: 'A problem, a delay, something to change',
  feedback: 'Feedback for management (optional)',
  feedbackHint: 'Ideas, blockers, anything you want us to know',
  doneTitle: 'What you got done today',
  doneNone: 'Nothing is recorded as finished yet today. You can still write your reflection.',
  save: 'Save reflection',
  saveAndClockOut: 'Save and clock out',
  saved: 'Reflection saved',
  savedAndOut: 'Reflection saved, clocked out',
  needed: 'Write your end-of-day reflection to clock out.',
  tooShort: `Say what went well or what did not, in at least ${REFLECTION_MIN_CHARS} characters.`,
  tooLong: `Keep each box to ${REFLECTION_NOTE_MAX} characters or fewer.`,
  alreadySaved: 'You have already saved today’s reflection. You can change it and save again.',
  reviewTitle: 'Reflections',
  reviewIntro: 'What the team said about their day. Mark them as read once you have looked.',
  reviewEmpty: 'No reflections in this period.',
  markRead: 'Mark as read',
  markAllRead: 'Mark all as read',
  read: 'Read',
  unread: 'Not read yet',
} as const;

const count = z.coerce.number().int().min(0).catch(0).default(0);
const text = z.string().catch('').default('');
const nullableText = z.string().nullable().catch(null).default(null);

export const reflectionItemSchema = z.object({ kind: z.string().catch('item').default('item'), ref: z.string().nullable().catch(null).default(null), label: text });
export type ReflectionItem = z.infer<typeof reflectionItemSchema>;
// A list of items where one malformed entry is dropped instead of losing the whole list.
const itemList = z.array(z.unknown()).catch([]).default([]).transform(list => list.flatMap(entry => {
  const parsed = reflectionItemSchema.safeParse(entry);
  return parsed.success ? [parsed.data] : [];
}));

export const daySummarySchema = z.object({
  day: nullableText, ticketsTouched: count, ticketsCompleted: count, todosDone: count, guestReplies: count,
  items: itemList,
});
export type DaySummary = z.infer<typeof daySummarySchema>;

// A summary with every number present, whatever the database sent (older databases may lack fields).
export function shapeSummary(raw: unknown): DaySummary {
  const parsed = daySummarySchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  const summary = parsed.success ? parsed.data : daySummarySchema.parse({});
  return { ...summary, items: summary.items.filter(item => item.label.trim().length > 0) };
}

const reflectionViewSchema = z.object({
  id: text, shiftId: nullableText, userId: nullableText, fullName: nullableText, role: nullableText, department: nullableText,
  day: text, wentWell: text, notWell: text, feedback: text, completed: itemList,
  summary: z.unknown().optional(), createdAt: nullableText, updatedAt: nullableText, reviewedAt: nullableText, reviewedByName: nullableText,
  version: z.coerce.number().int().catch(1).default(1),
});
export type ReflectionView = Omit<z.infer<typeof reflectionViewSchema>, 'summary'> & { summary: DaySummary };

function shapeView(raw: unknown): ReflectionView | null {
  const parsed = reflectionViewSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  if (!parsed.success || !parsed.data.id) return null;
  return { ...parsed.data, summary: shapeSummary(parsed.data.summary) };
}

// The `reflection` read: your own day, the saved reflection if there is one, and whether you still owe one.
export type OwnReflection = {
  required: boolean; day: string | null; shift: { id: string; department: string | null; clockedInAt: string | null } | null;
  summary: DaySummary; reflection: ReflectionView | null; missing: boolean;
};
export function shapeOwnReflection(raw: unknown): OwnReflection {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shift = data.shift && typeof data.shift === 'object' ? data.shift as Record<string, unknown> : null;
  const reflection = shapeView(data.reflection);
  const shiftId = shift && typeof shift.id === 'string' && shift.id ? shift.id : null;
  return {
    required: data.required === true,
    day: typeof data.day === 'string' ? data.day : null,
    shift: shiftId ? { id: shiftId, department: typeof shift!.department === 'string' ? shift!.department : null, clockedInAt: typeof shift!.clockedInAt === 'string' ? shift!.clockedInAt : null } : null,
    summary: shapeSummary(data.summary),
    reflection,
    missing: data.missing === true,
  };
}

// The `reflections` read (admins): newest day first.
export type ReflectionList = { from: string | null; to: string | null; unreviewed: number; items: ReflectionView[] };
export function shapeReflections(raw: unknown): ReflectionList {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : []).map(shapeView).filter((v): v is ReflectionView => v !== null);
  const unread = items.filter(v => !v.reviewedAt).length;
  const reported = Number(data.unreviewed);
  return { from: typeof data.from === 'string' ? data.from : null, to: typeof data.to === 'string' ? data.to : null, unreviewed: Number.isFinite(reported) && reported >= 0 ? Math.floor(reported) : unread, items };
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// "3 tickets touched, 2 completed, 4 to-dos done, 5 guest replies".
export function summaryLine(summary: DaySummary): string {
  return [
    `${plural(summary.ticketsTouched, 'ticket')} touched`,
    `${summary.ticketsCompleted} completed`,
    `${plural(summary.todosDone, 'to-do')} done`,
    plural(summary.guestReplies, 'guest reply', 'guest replies'),
  ].join(', ');
}

// The four counts as label and value pairs, for the sheet's tiles.
export function summaryFigures(summary: DaySummary): { label: string; value: number }[] {
  return [
    { label: 'Tickets touched', value: summary.ticketsTouched },
    { label: 'Tickets completed', value: summary.ticketsCompleted },
    { label: 'To-dos done', value: summary.todosDone },
    { label: 'Guest replies', value: summary.guestReplies },
  ];
}

export type ReflectionDraft = { wentWell: string; notWell: string; feedback: string };

// One of "went well" and "not so well" needs a few real words; no box can pass the database's limit.
export function validateReflection(draft: ReflectionDraft): { ok: true } | { ok: false; error: string } {
  const wentWell = draft.wentWell.trim(), notWell = draft.notWell.trim(), feedback = draft.feedback.trim();
  if (wentWell.length > REFLECTION_NOTE_MAX || notWell.length > REFLECTION_NOTE_MAX || feedback.length > REFLECTION_NOTE_MAX) return { ok: false, error: REFLECTION_COPY.tooLong };
  if (wentWell.length < REFLECTION_MIN_CHARS && notWell.length < REFLECTION_MIN_CHARS) return { ok: false, error: REFLECTION_COPY.tooShort };
  return { ok: true };
}

// The completed list the action sends: trimmed, unique by kind and ref (or label), and inside the caps.
export function completedForAction(items: readonly ReflectionItem[]): { kind: string; ref?: string | null; label: string }[] {
  const seen = new Set<string>(), out: { kind: string; ref?: string | null; label: string }[] = [];
  for (const item of items) {
    const label = item.label.trim().slice(0, ITEM_LABEL_MAX), kind = item.kind.trim().slice(0, ITEM_KIND_MAX);
    if (!label || !kind) continue;
    const ref = item.ref?.trim().slice(0, ITEM_REF_MAX) || null;
    const key = `${kind}:${ref ?? label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref ? { kind, ref, label } : { kind, label });
    if (out.length >= REFLECTION_ITEMS_MAX) break;
  }
  return out;
}

export function buildSaveReflection(input: ReflectionDraft & { requestId: string; shiftId?: string | null; completed?: readonly ReflectionItem[] }) {
  return {
    action: 'saveReflection' as const,
    requestId: input.requestId,
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    wentWell: input.wentWell.trim(),
    notWell: input.notWell.trim(),
    feedback: input.feedback.trim(),
    completed: completedForAction(input.completed ?? []),
  };
}

export function buildMarkReviewed(requestId: string, ids: readonly string[]) {
  return { action: 'markReflectionsReviewed' as const, requestId, ids: [...new Set(ids.filter(Boolean))].slice(0, REVIEW_IDS_MAX) };
}

// The dates an admin reads: today and the days before it, never more than the database allows at once.
export function reflectionWindow(today: string, days: number): { from: string; to: string } {
  const span = Math.min(Math.max(1, Math.floor(days)), REFLECTIONS_WINDOW_DAYS);
  const from = new Date(Date.parse(today + 'T12:00:00Z') - (span - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to: today };
}
