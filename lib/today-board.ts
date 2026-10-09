// Today / Tomorrow / Overdue for field roles: the person's own cleans, repairs and routine visits
// for a day, in the order they are done, and (for cleaning managers) the team's day by cleaner.
// Pure functions over the schedule and operations reads, so the tests check the same rules the
// Home board uses. Every date is a day in Europe/London.

export type BoardRole = 'cleans' | 'cleaning_manager' | 'ready';
// The roles whose Home opens on the board.
export const boardRole = (role: string): BoardRole | null => role === 'cleans' || role === 'cleaning_manager' || role === 'ready' ? role : null;
export type JobType = 'clean' | 'repair' | 'visit' | 'other';
export type JobAction = 'Start' | 'Continue' | 'Open' | 'Assign';
// A row from the schedule read, or an open operation that falls outside the schedule's dates.
export type BoardRow = {
  workId: string; propertyId: string; propertyName: string; title: string; status: string; dueOn: string | null;
  assigneeId: string | null; assigneeName?: string | null; kind: string | null; data?: Record<string, unknown>;
};
export type BoardGuests = { workId: string; guestsLeaving: number | null; nextArrivalOn: string | null; nextArrivalGuests: number | null };
export type BoardJob = {
  workId: string; propertyId: string; propertyName: string; title: string; type: JobType; status: string; dueOn: string;
  assigneeId: string | null; assigneeName: string | null; done: boolean; redo: boolean;
  // Cleans: guests leaving, and whether the next guests arrive on the same day (a same-day turnover).
  sameDay: boolean; guestsLeaving: number | null; arrivingGuests: number | null; nextArrivalOn: string | null;
};
export type Buckets = { today: BoardJob[]; tomorrow: BoardJob[]; overdue: BoardJob[]; next: BoardJob | null };

const DONE = new Set(['in_review', 'approved', 'completed']);
const GONE = new Set(['cancelled', 'declined']);
const TYPE: Record<string, JobType> = { cleaning: 'clean', maintenance: 'repair', routine_visit: 'visit' };

export const londonDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const shiftDay = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const jobType = (kind: string | null | undefined): JobType => TYPE[kind ?? ''] ?? 'other';
// Submitted cleans, finished visits and closed repairs are done for the person doing them.
export const isDone = (status: string) => DONE.has(status);

// One list from the schedule rows and the open operations: the schedule gives names and dates for
// the weeks around today; the operations add each item's stage and any open item due earlier.
export function boardJobs(schedule: BoardRow[], operations: BoardRow[] = [], guests: BoardGuests[] = []): BoardJob[] {
  const ops = new Map(operations.map(o => [o.workId, o]));
  const seen = new Set(schedule.map(r => r.workId));
  const extra = operations.filter(o => !seen.has(o.workId) && !!o.dueOn && !isDone(o.status) && !GONE.has(o.status));
  const stays = new Map(guests.map(g => [g.workId, g]));
  return [...schedule, ...extra].filter(r => !!r.dueOn && !GONE.has(r.status)).map(r => {
    const op = ops.get(r.workId), data = { ...(r.data ?? {}), ...(op?.data ?? {}) }, type = jobType(r.kind ?? op?.kind);
    const g = stays.get(r.workId), dueOn = r.dueOn!;
    const sameDay = type === 'clean' && (data.sameDayTurnover === true || (!!g?.nextArrivalOn && g.nextArrivalOn === dueOn));
    const status = op?.status ?? r.status;
    return {
      workId: r.workId, propertyId: r.propertyId, propertyName: r.propertyName, title: r.title, type, status, dueOn,
      assigneeId: op ? op.assigneeId : r.assigneeId, assigneeName: r.assigneeName ?? null, done: isDone(status),
      // A clean sent back by the reviewer is to do again.
      redo: type === 'clean' && data.phase === 'assigned' && data.accepted === false,
      sameDay, guestsLeaving: g?.guestsLeaving ?? null, arrivingGuests: sameDay ? g?.nextArrivalGuests ?? null : null, nextArrivalOn: g?.nextArrivalOn ?? null,
    };
  });
}

// Whose jobs the board shows. Cleaners: their own. Ready: their own repairs and visits, and the
// ones at their properties nobody has taken yet. Cleaning managers: every clean they look after.
export function jobsFor(jobs: BoardJob[], role: BoardRole, userId: string) {
  if (role === 'cleaning_manager') return jobs.filter(j => j.type === 'clean');
  if (role === 'ready') return jobs.filter(j => j.assigneeId === userId || (!j.assigneeId && (j.type === 'repair' || j.type === 'visit')));
  return jobs.filter(j => j.assigneeId === userId);
}

// The order a day is worked in: same-day turnovers first (the next guests are on their way), then
// the other cleans, repairs, routine visits; property name breaks ties so the order stays put.
const SLOT: Record<JobType, number> = { clean: 1, repair: 2, visit: 3, other: 4 };
const slot = (j: BoardJob) => j.sameDay ? 0 : SLOT[j.type];
export const orderJobs = (jobs: BoardJob[]) => [...jobs].sort((a, b) => slot(a) - slot(b) || a.propertyName.localeCompare(b.propertyName) || a.workId.localeCompare(b.workId));

export function bucketJobs(jobs: BoardJob[], today: string): Buckets {
  const tomorrow = shiftDay(today, 1);
  const overdue = [...jobs.filter(j => j.dueOn < today && !j.done)].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || slot(a) - slot(b) || a.propertyName.localeCompare(b.propertyName) || a.workId.localeCompare(b.workId));
  const next = [...jobs.filter(j => j.dueOn > today && !j.done)].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || slot(a) - slot(b) || a.propertyName.localeCompare(b.propertyName))[0] ?? null;
  return { today: orderJobs(jobs.filter(j => j.dueOn === today)), tomorrow: orderJobs(jobs.filter(j => j.dueOn === tomorrow)), overdue, next };
}

// The first job of the list still to do.
export const nextUp = (jobs: BoardJob[]) => jobs.find(j => !j.done) ?? null;
export const progressOf = (jobs: BoardJob[]) => ({ done: jobs.filter(j => j.done).length, total: jobs.length });
export const progressLabel = (jobs: BoardJob[], day: 'today' | 'tomorrow') => { const { done, total } = progressOf(jobs); return `${done} of ${total} done ${day}`; };

// The one button on each row.
export function jobAction(job: BoardJob, manager = false): JobAction {
  if (manager) return !job.assigneeId && !job.done ? 'Assign' : 'Open';
  if (job.done) return 'Open';
  if (job.redo || (job.status === 'in_progress' && job.type !== 'repair')) return 'Continue';
  return 'Start';
}

// When the job happens, in words: there are no clock times on jobs, so cleans say which side of
// the guests they fall; overdue jobs say the day they were due.
export function jobWindow(job: BoardJob, today: string) {
  if (job.dueOn < today) return 'Overdue';
  if (job.type === 'clean') return job.sameDay ? 'Before arrival' : 'After checkout';
  if (job.type === 'repair') return 'Booked';
  return 'Any time';
}

// Cleaning managers: the day by cleaner, with the cleans nobody has yet first.
export type CleanerGroup = { assigneeId: string | null; name: string; jobs: BoardJob[] };
export function byCleaner(jobs: BoardJob[]): CleanerGroup[] {
  const groups = new Map<string, CleanerGroup>();
  for (const job of jobs) {
    const key = job.assigneeId ?? '';
    const group = groups.get(key) ?? { assigneeId: job.assigneeId, name: job.assigneeId ? job.assigneeName || 'Cleaner' : 'Not assigned yet', jobs: [] };
    group.jobs.push(job); groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, jobs: orderJobs(g.jobs) }))
    .sort((a, b) => Number(!!a.assigneeId) - Number(!!b.assigneeId) || a.name.localeCompare(b.name) || (a.assigneeId ?? '').localeCompare(b.assigneeId ?? ''));
}
