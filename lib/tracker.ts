import type { Detail } from './work-details';
import { eventLabel } from './oversight-policy';

// The shared tracker: one row and one detail sheet for every section that follows an item through
// steps (purchase orders, licensing, later onboarding). The section adapters build TrackerItems;
// the screens only draw them.
export type TrackerTone = 'good' | 'wait' | 'bad' | 'plain';
export type TrackerStep = { key: string; label: string; state: 'done' | 'current' | 'todo' | 'skipped'; detail?: string; actionKey?: string; checks?: { key: string; label: string; done: boolean }[] };
export type TrackerUpdate = { at: string; by: string | null; what: string | null };
export type TrackerItem<S = unknown> = {
  id: string; section: 'purchases' | 'licensing' | 'onboarding'; source: S;
  propertyId: string | null; address: string; propertyName: string; title: string;
  status: { label: string; tone: TrackerTone }; closed: boolean;
  nextStep: string; nextAction: { label: string; actionKey?: string } | null;
  lastUpdate: TrackerUpdate | null; progress: { done: number; total: number } | null;
  steps: TrackerStep[]; details: Detail[]; workId?: string; version?: number; search: string;
};

// The last change to a work item: any change counts, and the person is known only to staff.
// The person and step come from the newest activity row, which can be later than the item's own
// updated_at (an invoice recorded against a purchase logs activity only), so the time is the later
// of the two. Missing or unreadable times are ignored; created is the last resort.
type Touched = { updatedAt?: string | null; createdAt?: string | null; lastActivityAt?: string | null; updatedBy?: string | null; updatedEvent?: string | null };
export function lastUpdateOf(work: Touched): TrackerUpdate | null {
  const stamps = [work.updatedAt, work.lastActivityAt].filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  const latest = stamps.reduce<string | undefined>((best, t) => (best === undefined || Date.parse(t) > Date.parse(best) ? t : best), undefined);
  const created = work.createdAt && !Number.isNaN(Date.parse(work.createdAt)) ? work.createdAt : undefined;
  const at = latest || created || work.updatedAt || work.createdAt;
  if (!at) return null;
  // Table triggers write `workspace_*` rows (and the reply to a step can still carry one), which say
  // nothing useful, so they read as a plain "Updated".
  const event = work.updatedEvent;
  const what = !event ? null : event.startsWith('workspace_') ? 'Updated' : eventLabel(event);
  return { at, by: work.updatedBy?.trim() || null, what };
}

const ZONE = 'Europe/London';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short' });
const dayNameYear = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const yearOf = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric' });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000);

// "Today 14:05 · Morag Reid", "Yesterday 09:30 · Automatic", "12 Oct, 14:05 · Recharge". Always UK
// time. Owners never see staff names: an owner viewing the stamp reads "Recharge".
export function updateStamp(u: TrackerUpdate | null | undefined, now: Date = new Date(), owner = false): string {
  if (!u) return 'No update yet';
  const when = new Date(u.at);
  const who = owner ? 'Recharge' : u.by?.trim() || 'Automatic';
  if (Number.isNaN(when.getTime())) return who;
  const time = clock.format(when), today = dayKey.format(now), day = dayKey.format(when), ago = daysBetween(today, day);
  const label = ago === 0 ? 'Today ' + time : ago === 1 ? 'Yesterday ' + time
    : (yearOf.format(when) === yearOf.format(now) ? dayName : dayNameYear).format(when) + ', ' + time;
  return `${label} · ${who}`;
}

// The first form this person may use. When there is none, the item waits for someone else.
type FormLike = { key: string; title: string; unavailable?: string };
export function nextActionOf(forms: readonly FormLike[], waitingOn?: string | null): TrackerItem['nextAction'] {
  const form = forms.find(f => !f.unavailable);
  if (form) return { label: form.title, actionKey: form.key };
  return waitingOn ? { label: `Waiting for ${waitingOn}` } : null;
}

// Skipped steps do not count towards the total, so a finished item always reads "n of n".
export function progressOf(steps: readonly Pick<TrackerStep, 'state'>[]): TrackerItem['progress'] {
  const counted = steps.filter(s => s.state !== 'skipped');
  return counted.length ? { done: counted.filter(s => s.state === 'done').length, total: counted.length } : null;
}

// Open items first; among them the earliest current step, then the longest without an update.
// Finished items follow in the same order. Returns a new list.
export function sortTracker<T extends TrackerItem>(items: readonly T[]): T[] {
  const stage = (i: T) => { const n = i.steps.findIndex(s => s.state === 'current'); return n < 0 ? Number.MAX_SAFE_INTEGER : n; };
  const touched = (i: T) => { const t = i.lastUpdate ? Date.parse(i.lastUpdate.at) : NaN; return Number.isNaN(t) ? 0 : t; };
  return [...items].sort((a, b) => Number(a.closed) - Number(b.closed) || stage(a) - stage(b) || touched(a) - touched(b) || a.address.localeCompare(b.address) || a.id.localeCompare(b.id));
}

// The full address, or the property's name when no address is held.
export function addressOf(property: { address?: string | null; name?: string | null } | null | undefined): string {
  return property?.address?.trim() || property?.name?.trim() || '';
}
