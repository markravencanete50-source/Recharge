import { CLEAN_FORM_DUE_BY, CLEAN_FORM_WARNING, CLEAN_FORM_ZONE } from './feedback-defaults';
import { openFlagFor, type Flag } from './management-flags';

// Clean forms (client ask B1 and B2): after a clean the cleaner sends the checklist, the photos and a
// report. Until they are in the clean is "Outstanding" after 18:00 UK time on its day, and a "Warning"
// once that day has passed. A warning is also set by the database sweep (data.warning = 'no_form',
// data.formWarningAt) together with a management flag. This file is the pure part: it reads only the
// clean's own fields (the schedule row plus the operation's data), so the screens and the tests share it.
export type FormState = 'submitted' | 'outstanding' | 'warning' | 'not_due';

// What formState needs from a clean. `data` is the operation's data; without it nothing can be said.
export type CleanFormInput = { dueOn?: string | null; status?: string | null; assigneeId?: string | null; data?: Record<string, unknown> | null };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The cut-off as seconds since midnight, from the 'HH:MM' constant (a bad value falls back to 18:00).
export const DUE_SECONDS = (() => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(CLEAN_FORM_DUE_BY);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : 18 * 3600;
})();

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
//  - warning: the database marked it (data.warning = 'no_form'), or the day after the clean has begun;
//  - outstanding: it is the clean's day and the time is past the cut-off (18:00 UK);
//  - not_due: everything else, including a clean nobody is assigned to, a cancelled clean, a clean
//    with no date and a clean whose data is not known.
export function formState(clean: CleanFormInput, now: Date = new Date()): FormState {
  const data = clean.data;
  if (!data || clean.status === 'cancelled') return 'not_due';
  if (formSubmitted(data)) return 'submitted';
  if (data.warning === CLEAN_FORM_WARNING) return 'warning';
  const due = clean.dueOn;
  if (!clean.assigneeId || !due || !DAY.test(due)) return 'not_due';
  const at = ukClock(now);
  if (!at) return 'not_due';
  if (at.day > due) return 'warning';
  if (at.day === due && at.seconds > DUE_SECONDS) return 'outstanding';
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
export const FORM_STATE_LABEL: Record<FormState, string> = { submitted: 'Submitted', outstanding: 'Outstanding', warning: 'Warning', not_due: 'Not due yet' };
export const FORM_STATE_TONE: Record<FormState, 'good' | 'wait' | 'bad' | 'plain'> = { submitted: 'good', outstanding: 'wait', warning: 'bad', not_due: 'plain' };

// One line explaining the state, for the detail sheet.
export function formStateNote(state: FormState, late = false): string {
  if (state === 'submitted') return late ? 'The form came in late, after management was told.' : 'The cleaner has sent the form.';
  if (state === 'outstanding') return `The form was due by ${CLEAN_FORM_DUE_BY} on the day of the clean. It is still not in.`;
  if (state === 'warning') return 'No form was sent for this clean. It is a warning and management has been told.';
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
