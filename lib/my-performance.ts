import type { TeamPerformance } from './management-live';
import type { RotaPlan } from './workspace-teams-policy';
import type { OperationView } from './workflow-forms';

// "My performance" and "My schedule" on a team member's Home: the shaping behind both cards. It reads
// what the database already returns (a non-admin gets only their own row from teamPerformance; every
// team role can read rotaPlan) and keeps ONLY what the person may see. There is no pay data in any
// of it: the bonus is shown as a tier, never as a figure in pounds (BONUS_DISPLAY = 'tier_only').

type Person = TeamPerformance['people'][number];
export const PERFORMANCE_RANGES = ['today', 'week', 'month'] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];
export const RANGE_LABEL: Record<PerformanceRange, string> = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days' };
const RANGE_BACK: Record<PerformanceRange, number> = { today: 0, week: 6, month: 29 };

const addDays = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// The dates a range covers, counted back from today (the UK day).
export function performanceWindow(range: PerformanceRange, today: string): { from: string; to: string } {
  return { from: addDays(today, -RANGE_BACK[range]), to: today };
}

// The row that belongs to this person. Never somebody else's: when the id is known and not in the list
// there is no row; with no id known, a list of exactly one is theirs (the database returns just their own).
export function ownPerson(people: readonly Person[], userId: string | null | undefined): Person | null {
  if (userId) return people.find(p => p.userId === userId) ?? null;
  return people.length === 1 ? people[0] : null;
}

export type Bonus = {
  // 1-based place among the tiers (1 = the first tier), or null when none is reached yet.
  tier: number | null; of: number; label: string;
  // The score that unlocks the next tier, or null at the top (or when no tiers are set).
  nextAt: number | null;
};

// The bonus as a tier. `tier` is the highest threshold the person has reached (a percentage score);
// `percents` are all the thresholds the team's targets set.
export function bonusFor(tier: number | null | undefined, percents: readonly number[]): Bonus {
  const levels = [...new Set(percents)].sort((a, b) => a - b);
  const reached = tier == null ? -1 : levels.indexOf(tier);
  const nextAt = levels.find(level => tier == null || level > tier) ?? null;
  if (!levels.length) return { tier: null, of: 0, label: 'No bonus tiers set', nextAt: null };
  if (tier == null || tier <= 0) return { tier: null, of: levels.length, label: 'No bonus tier yet', nextAt };
  // A threshold that was since removed from the targets still counts as a tier, just not a numbered one.
  if (reached < 0) return { tier: null, of: levels.length, label: 'Bonus tier reached', nextAt };
  return { tier: reached + 1, of: levels.length, label: `Bonus tier ${reached + 1} of ${levels.length}`, nextAt };
}

// Tasks the person finished in the period: work items assigned to them and completed since `fromDay`.
export function workCompleted(work: readonly Pick<OperationView, 'assigneeId' | 'status' | 'updatedAt'>[], userId: string | null | undefined, fromDay: string): number {
  if (!userId) return 0;
  return work.filter(w => w.assigneeId === userId && w.status === 'completed' && (w.updatedAt ?? '').slice(0, 10) >= fromDay).length;
}

export type OwnNumbers = {
  // 0 to 100, or null when there is nothing to score yet.
  score: number | null; onTrack: boolean | null;
  replies: number; repliesGreen: number; repliesGreenPercent: number | null;
  minutes: number; shifts: number;
  // Work finished in the period, plus the daily work logged on Stays shifts.
  tasksDone: number; workCompleted: number;
  daily: { listingChecks: number; pricingDecisions: number; reviewsLogged: number; signOffs: number };
  bonus: Bonus;
};

// One person's numbers for a period. Returns null when the read has no row for them.
export function shapeOwnNumbers(data: Pick<TeamPerformance, 'people' | 'targets'>, userId: string | null | undefined, work: readonly Pick<OperationView, 'assigneeId' | 'status' | 'updatedAt'>[], fromDay: string): OwnNumbers | null {
  const row = ownPerson(data.people, userId);
  if (!row) return null;
  const replies = row.green + row.amber + row.red;
  const daily = { listingChecks: row.listingChecks, pricingDecisions: row.pricingDecisions, reviewsLogged: row.reviewsLogged, signOffs: row.signOffs };
  const done = workCompleted(work, row.userId, fromDay);
  return {
    score: row.score, onTrack: row.onTrack,
    replies, repliesGreen: row.green, repliesGreenPercent: row.percentGreen,
    minutes: row.minutes, shifts: row.shifts,
    tasksDone: done + daily.listingChecks + daily.pricingDecisions + daily.reviewsLogged + daily.signOffs, workCompleted: done,
    daily, bonus: bonusFor(row.bonusTier, data.targets.bonusPercents),
  };
}

// A short sentence for the person: where they stand, with no pay in it.
export function standingLine(n: OwnNumbers): string {
  if (n.score === null) return 'Nothing to score yet in this period.';
  const base = n.onTrack ? `On track with a score of ${n.score}%.` : `Off track with a score of ${n.score}%.`;
  return n.bonus.nextAt !== null && n.bonus.of ? `${base} The next bonus tier starts at ${n.bonus.nextAt}%.` : base;
}

// --- My schedule ------------------------------------------------------------------------------------

export type OwnEvent = { id: string; title: string; kind: string; startsOn: string; endsOn: string; startTime: string | null; endTime: string | null; location: string };
const asText = (v: unknown) => typeof v === 'string' ? v : '';
const asDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
const asTime = (v: unknown) => typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null;

// The team calendar read (section teamEvents) may not exist yet on this database, and its exact shape
// belongs to another package, so this accepts a list or { events: [...] }, either spelling of each field,
// and silently drops anything it cannot read. Only this person's events, and never a cancelled one.
export function ownEvents(data: unknown, userId: string | null | undefined): OwnEvent[] {
  const raw = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { events?: unknown }).events) ? (data as { events: unknown[] }).events : [];
  const out: OwnEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const owner = asText(e.userId ?? e.user_id);
    if (userId && owner && owner !== userId) continue;
    if (e.cancelledAt ?? e.cancelled_at) continue;
    const startsOn = asDay(e.startsOn ?? e.starts_on), title = asText(e.title).trim();
    if (!startsOn || !title) continue;
    out.push({ id: asText(e.id) || `${startsOn}:${title}`, title, kind: asText(e.kind) || 'other', startsOn, endsOn: asDay(e.endsOn ?? e.ends_on) || startsOn,
      startTime: asTime(e.startTime ?? e.start_time), endTime: asTime(e.endTime ?? e.end_time), location: asText(e.location).trim() });
  }
  return out.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

export const SHIFT_LABEL = { early: 'Early', late: 'Late', both: 'Early and late', off: 'Off' } as const;
export const SHIFT_HOURS = { early: '8am to 4pm', late: '3pm to 11pm', both: '8am to 11pm', off: '' } as const;
export type ScheduleDay = { day: string; shift: keyof typeof SHIFT_LABEL | null; hours: string; department: string | null; note: string; events: OwnEvent[]; planned: boolean };

// The next `days` days from `from`: the person's rota for each, and their own events that touch it.
export function scheduleDays(plan: Pick<RotaPlan, 'people'> | null, events: readonly OwnEvent[], userId: string | null | undefined, from: string, days = 7): ScheduleDay[] {
  const people = plan?.people ?? [];
  const me = userId ? people.find(p => p.userId === userId) : people.length === 1 ? people[0] : undefined;
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    const cell = me?.days.find(d => d.day === day) ?? null;
    const shift = cell?.shift ?? null;
    const todays = events.filter(e => e.startsOn <= day && day <= e.endsOn);
    return { day, shift, hours: shift ? SHIFT_HOURS[shift] : '', department: cell?.department ?? null, note: cell?.note ?? '', events: todays, planned: (!!shift && shift !== 'off') || todays.length > 0 };
  });
}
