import { CLEAN_FORM_DUE_BY, CLEAN_FORM_ESCALATE_AT, CLEAN_FORM_WARNING, CLEAN_FORM_ZONE } from './feedback-defaults';
import { openFlagFor, type Flag } from './management-flags';

// Clean forms (client ask B1 and B2, client answer 8): after a clean the cleaner sends the checklist, the
// photos and a report. Until they are in, the clean is "Unsubmitted" after 18:00 UK time on its day (the
// database sweep sets data.unsubmittedAt and reminds the cleaner), and a "Warning" from 09:00 the next day
// (the sweep sets data.warning = 'no_form' and data.formWarningAt and flags it for management). This file is the pure part: it reads only the
// clean's own fields (the schedule row plus the operation's data), so the screens and the tests share it.
export type FormState = 'submitted' | 'outstanding' | 'warning' | 'not_due';

// What formState needs from a clean. `data` is the operation's data; without it nothing can be said.
export type CleanFormInput = { dueOn?: string | null; status?: string | null; assigneeId?: string | null; data?: Record<string, unknown> | null };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// An 'HH:MM' constant as seconds since midnight (a bad value falls back to the given hour).
const seconds = (clock: string, fallbackHour: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : fallbackHour * 3600;
};
// The cut-off on the clean day, and the time on the next day when management is told.
export const DUE_SECONDS = seconds(CLEAN_FORM_DUE_BY, 18);
export const ESCALATE_SECONDS = seconds(CLEAN_FORM_ESCALATE_AT, 9);
// The calendar day after a YYYY-MM-DD day.
const nextDay = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: CLEAN_FORM_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

// The UK calendar day and the seconds since UK midnight at an instant. The zone database handles
// the clocks going forward and back, so 18:00 means 18:00 on the wall in both seasons.
export function ukClock(now: Date): { day: string; seconds: number } | null {
  if (Number.isNaN(now.getTime())) return null;
  const parts = Object.fromEntries(clock.formatToParts(now).map(x => [x.type, x.value]));
  const hour = Number(parts.hour) % 24;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, seconds: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second) };
}

// A form is in once the cleaner has submitted the clean: it moved to review (or was accepted), or it
// carries the cleaner's report. A clean that was sent back for another go keeps its first report.
export function formSubmitted(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return data.phase === 'review' || data.phase === 'accepted' || typeof data.submittedBy === 'string' || !!text(data.report);
}

// The clean's form state at `now`:
//  - submitted: the form is in (even if it came late);
//  - warning: the database marked it (data.warning = 'no_form'), or it is 09:00 UK the day after the clean or later;
//  - outstanding ("Unsubmitted"): the database reminded the cleaner (data.unsubmittedAt), or the time is past the
//    cut-off (18:00 UK) on the clean's day, or before 09:00 the next day;
//  - not_due: everything else, including a clean nobody is assigned to, a cancelled clean, a clean
//    with no date and a clean whose data is not known.
export function formState(clean: CleanFormInput, now: Date = new Date()): FormState {
  const data = clean.data;
  if (!data || clean.status === 'cancelled') return 'not_due';
  if (formSubmitted(data)) return 'submitted';
  if (data.warning === CLEAN_FORM_WARNING) return 'warning';
  const due = clean.dueOn;
  if (!clean.assigneeId || !due || !DAY.test(due)) return typeof data.unsubmittedAt === 'string' ? 'outstanding' : 'not_due';
  const at = ukClock(now);
  if (!at) return 'not_due';
  const next = nextDay(due);
  if (at.day > next || (at.day === next && at.seconds >= ESCALATE_SECONDS)) return 'warning';
  if (at.day === next || (at.day === due && at.seconds > DUE_SECONDS) || typeof data.unsubmittedAt === 'string') return 'outstanding';
  return 'not_due';
}

export const isMissing = (state: FormState): boolean => state === 'outstanding' || state === 'warning';

// A form that came in after the database had already warned about it. It still counts as submitted.
export const submittedLate = (clean: Pick<CleanFormInput, 'data'>): boolean => formSubmitted(clean.data) && clean.data?.warning === CLEAN_FORM_WARNING;

// Which forms are in. A clean has three parts: the checklist, the photos and the written report; the
// property check is an extra the cleaner may fill in.
export type FormsIn = { checklist: boolean; checks: number; photos: number; report: boolean; propertyCheck: boolean; count: number; expected: 3 };
export function formsIn(data: Record<string, unknown> | null | undefined): FormsIn {
  const submitted = formSubmitted(data);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);
  const checks = submitted ? (list(data?.checks).length || list(data?.checklist).length) : 0;
  const photos = Array.isArray(data?.photoIds) ? (data!.photoIds as unknown[]).length : 0;
  const report = !!text(data?.report);
  const checklist = submitted && checks > 0;
  const propertyCheck = !!data?.condition && typeof data.condition === 'object';
  return { checklist, checks, photos, report, propertyCheck, count: Number(checklist) + Number(photos > 0) + Number(report), expected: 3 };
}

// "Checklist · 6 photos · Report", or "Nothing in yet".
export function formsText(forms: FormsIn): string {
  const parts = [forms.checklist ? 'Checklist' : '', forms.photos ? `${forms.photos} ${forms.photos === 1 ? 'photo' : 'photos'}` : '', forms.report ? 'Report' : '', forms.propertyCheck ? 'Property check' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing in yet';
}

// The words for each state. The tone is the app's colour language: good, wait, bad, plain.
export const FORM_STATE_LABEL: Record<FormState, string> = { submitted: 'Submitted', outstanding: 'Unsubmitted', warning: 'Warning', not_due: 'Not due yet' };
export const FORM_STATE_TONE: Record<FormState, 'good' | 'wait' | 'bad' | 'plain'> = { submitted: 'good', outstanding: 'wait', warning: 'bad', not_due: 'plain' };

// One line explaining the state, for the detail sheet.
export function formStateNote(state: FormState, late = false): string {
  if (state === 'submitted') return late ? 'The form came in late, after management was told.' : 'The cleaner has sent the form.';
  if (state === 'outstanding') return `The form was due by ${CLEAN_FORM_DUE_BY} on the day of the clean and the cleaner has been reminded. If it is not in by ${CLEAN_FORM_ESCALATE_AT} the next day, management is told.`;
  if (state === 'warning') return 'No form was sent for this clean. It is a warning and management has been told. The cleaner\'s invoice for it cannot be approved until the form is in.';
  return `The form is due by ${CLEAN_FORM_DUE_BY} on the day of the clean.`;
}

// "Sent to management" for a warning clean that management holds a flag for. Flags come from the
// `flags` read, which an older server (or a person who cannot see the flag) does not answer, so no
// flags just means no line. The caller shows the line next to the Warning tag.
export function managementLine(state: FormState, flags: readonly Flag[] | null | undefined, workId: string): 'Sent to management' | null {
  if (state !== 'warning' || !flags?.length) return null;
  return openFlagFor(flags, { workId }) ? 'Sent to management' : null;
}

// Counts for a day, or for everything given. Cancelled cleans are not cleans; `missing` is the
// outstanding and the warning ones together, which is what the Outstanding forms filter lists.
export type FormCounts = Record<FormState, number> & { total: number; missing: number };
const empty = (): FormCounts => ({ submitted: 0, outstanding: 0, warning: 0, not_due: 0, total: 0, missing: 0 });
function add(counts: FormCounts, state: FormState) {
  counts[state] += 1; counts.total += 1;
  if (isMissing(state)) counts.missing += 1;
}
export function countForms(cleans: readonly CleanFormInput[], now: Date = new Date()): FormCounts {
  const counts = empty();
  for (const c of cleans) if (c.status !== 'cancelled') add(counts, formState(c, now));
  return counts;
}
// Counts keyed by the clean's day. Cleans with no day are left out.
export function countFormsByDay(cleans: readonly CleanFormInput[], now: Date = new Date()): Record<string, FormCounts> {
  const days: Record<string, FormCounts> = {};
  for (const c of cleans) if (c.dueOn && c.status !== 'cancelled') add(days[c.dueOn] ??= empty(), formState(c, now));
  return days;
}

// What happens next on a clean, and whether the person looking can do it (shown in the primary colour).
export type CleanNext = { label: string; mine: boolean };
export function cleanNext(clean: CleanFormInput & { data: Record<string, unknown> }, viewer: { manager: boolean; userId?: string | null }): CleanNext | null {
  if (clean.status === 'cancelled' || clean.status === 'completed') return null;
  const phase = text(clean.data.phase), assignee = clean.assigneeId ?? null;
  if (phase === 'accepted') return null;
  if (phase === 'review') return viewer.manager && assignee !== viewer.userId ? { label: 'Check the form and guest feedback', mine: true } : { label: 'Waiting for the cleaning manager to review', mine: false };
  if (!assignee) return viewer.manager ? { label: 'Assign a cleaner', mine: true } : { label: 'Waiting for a cleaner to be assigned', mine: false };
  const redo = clean.data.accepted === false;
  if (assignee === viewer.userId && !viewer.manager) return { label: redo ? 'Clean it again and send the form' : 'Send your form', mine: true };
  return { label: redo ? 'Waiting for the cleaner to redo it' : 'Waiting for the cleaner to send the form', mine: false };
}

// Accepting a clean means the team checked the cleaner's form and the guest is happy. Rejecting goes to
// management as a complaint and needs no tick. Returns what still stops the review being saved.
export type ReviewDraft = { accepted: boolean | null; formChecked: boolean; guestFeedback: string; reviewNote: string };
export function reviewBlockers(draft: ReviewDraft): string[] {
  const out: string[] = [];
  if (draft.accepted === null) out.push('Choose Accept or Reject.');
  if (draft.accepted === true && !draft.formChecked) out.push('Tick that the form is checked and the guest is happy.');
  if (draft.guestFeedback.trim().length < 5) out.push('Add what the guest said (a few words).');
  if (draft.reviewNote.trim().length < 5) out.push('Add your review (a few words).');
  return out;
}
export const FORM_CHECKED_LABEL = 'Form checked and guest happy';
export const REJECT_NOTE = 'A rejection goes to management as a complaint. The cleaner is told and can respond before management decides.';
