import { z } from 'zod';
import { TEAM_EVENT_KINDS, type RotaPlan } from './workspace-teams-policy';
import { londonClock, ROTA_HOURS, ROTA_LABEL } from './team-time';

// The live calendar: what the shared schedule holds for each day (cleans, arrivals and departures,
// repairs, routine visits, inspections, other dated work and, for admins and accounts, payment
// runs), which team each entry belongs to, and the six-week month grid it is drawn on.
const uuid = z.string().uuid();
export const calendarScheduleSchema = z.object({
  work: z.array(z.object({
    workId: uuid, propertyId: uuid, propertyName: z.string(), moduleId: z.string().nullable().default(null), title: z.string(), status: z.string(),
    dueOn: z.string().nullable(), dueTime: z.string().nullable().default(null), endTime: z.string().nullable().default(null), assigneeId: z.string().nullable(), assigneeName: z.string().nullable(), kind: z.string().nullable(), version: z.number(),
  })),
  stays: z.array(z.object({ reservationId: z.string(), propertyId: z.string(), propertyName: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), channel: z.string().nullable().optional(),
    // The guest's name, for staff other than cleaners: from the guest conversation that carries the stay's booking code
    // (migration 20261014330000 dropped the match on dates, which could name a stay after an enquiry). Null or missing otherwise.
    guestName: z.string().nullable().optional() })),
  // Each clean's checkout time and the next guests' arrival (migration 20261021500000): times and counts, never names.
  cleanGuests: z.array(z.object({ workId: uuid, guestsLeaving: z.number().nullable().optional(), nextArrivalOn: z.string().nullable(), nextArrivalGuests: z.number().nullable().optional(),
    checkoutTime: z.string().nullable().optional(), nextArrivalTime: z.string().nullable().optional() })).optional(),
  payments: z.array(z.object({
    statementId: uuid, propertyId: uuid, propertyName: z.string(), period: z.string(), status: z.enum(['draft', 'issued', 'paid']), payoutMinor: z.number(),
    date: z.string(), issuedAt: z.string().nullable(), paidAt: z.string().nullable(), reference: z.string().nullable(),
  })).default([]),
});
export type CalendarSchedule = z.infer<typeof calendarScheduleSchema>;
export type CalendarWork = CalendarSchedule['work'][number];
export type CalendarStay = CalendarSchedule['stays'][number];
export type CalendarPayment = CalendarSchedule['payments'][number];

export const ENTRY_KINDS = ['check-out', 'clean', 'check-in', 'repair', 'routine', 'inspection', 'work', 'payment'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const KIND_LABEL: Record<EntryKind, string> = { 'check-out': 'Departure', clean: 'Clean', 'check-in': 'Arrival', repair: 'Reactive maintenance', routine: 'Preventative maintenance', inspection: 'Inspection', work: 'Task', payment: 'Payment run' };
const PLURAL: Record<EntryKind, string> = { 'check-out': 'departures', clean: 'cleans', 'check-in': 'arrivals', repair: 'repairs', routine: 'routine visits', inspection: 'inspections', work: 'tasks', payment: 'payment runs' };
export const kindCount = (kind: EntryKind, n: number) => `${n} ${n === 1 ? KIND_LABEL[kind].toLowerCase() : PLURAL[kind]}`;
// The same colours as the calendar in the design, each with a lighter shade for dark mode.
export const KIND_COLOUR: Record<EntryKind, { light: string; dark: string }> = {
  clean: { light: '#1D6470', dark: '#8CCFD8' },
  'check-in': { light: '#3F6A2A', dark: '#B7DA92' },
  'check-out': { light: '#875A1C', dark: '#E8C27D' },
  inspection: { light: '#3B5866', dark: '#A9C6D2' },
  repair: { light: '#9A4426', dark: '#F2AE8C' },
  routine: { light: '#635D1C', dark: '#D9CF85' },
  payment: { light: '#6B4768', dark: '#D9B5D5' },
  work: { light: '#1F5F55', dark: '#8FD3C2' },
};

export const TEAMS = ['stays', 'ready', 'cleans', 'accounts'] as const;
export type Team = (typeof TEAMS)[number];
export const TEAM_LABEL: Record<Team, string> = { stays: 'Stays', ready: 'Ready', cleans: 'Cleans', accounts: 'Accounts' };
const CLEANS_MODULES = ['cleaning-schedule', 'cleaner-performance', 'clean-client-database', 'cleaner-database', 'clean-property-onboarding', 'clean-reporting'];
const READY_MODULES = ['ready-schedule', 'safety-maintenance', 'purchase-order', 'maintenance-reporting', 'stays-maintenance-reporting', 'client-property-maintenance', 'property-furnishing-board', 'new-property-inspection-board', 'routine-bin-garden-board', 'purchase-order-requests', 'client-purchase-order-quotes'];
const ACCOUNTS_MODULES = ['cleans-invoices', 'maintenance-reconciliation', 'onboarding-invoices', 'purchase-order-invoices', 'purchase-order-accounts', 'owner-statements'];
// Which team a piece of work belongs to: by its kind first, then by the tool it came from.
export function teamOf(moduleId: string | null, kind: string | null): Team {
  if (kind && /_invoice$/.test(kind)) return 'accounts';
  if (kind === 'cleaning' || kind === 'cleaning_setup' || kind === 'cleaning_complaint' || kind === 'cleaner_management_review') return 'cleans';
  if (kind === 'maintenance' || kind === 'routine_visit' || kind === 'inspection' || kind === 'purchase' || kind === 'purchase_delivery' || kind === 'garden_setup' || kind === 'furnishing_quote') return 'ready';
  if (moduleId && ACCOUNTS_MODULES.includes(moduleId)) return 'accounts';
  if (moduleId && CLEANS_MODULES.includes(moduleId)) return 'cleans';
  if (moduleId && READY_MODULES.includes(moduleId)) return 'ready';
  return 'stays';
}
// The teams a role can filter by. One team needs no filter.
export function calendarTeamsFor(role: string): Team[] {
  if (role === 'admin' || role === 'super_admin' || role === 'accounts') return ['stays', 'ready', 'cleans', 'accounts'];
  if (role === 'stays') return ['stays', 'ready', 'cleans'];
  if (role === 'cleaning_manager') return ['cleans', 'stays'];
  if (role === 'ready') return ['ready', 'stays'];
  if (role === 'cleans') return ['cleans'];
  return [];
}
// Admins and cleaning managers can look at one person's day.
export const canPickPerson = (role: string) => role === 'admin' || role === 'super_admin' || role === 'cleaning_manager';

export type CalendarEntry = {
  id: string; date: string; time: string | null; endTime: string | null; kind: EntryKind; team: Team; title: string; propertyId: string; propertyName: string;
  personId: string | null; personName: string | null; status: string | null;
  work?: CalendarWork; stay?: CalendarStay; payments?: CalendarPayment[];
};
const workKind = (kind: string | null): EntryKind => kind === 'cleaning' ? 'clean' : kind === 'maintenance' ? 'repair' : kind === 'routine_visit' ? 'routine' : kind === 'inspection' ? 'inspection' : 'work';

// Every entry in the schedule: work on its due day, each stay's arrival and departure, and one
// payment run per day for the statements on it. Within a day, entries without a time come first,
// then the timed ones in time order.
export function calendarEntries(s: CalendarSchedule): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const w of s.work) {
    if (!w.dueOn) continue;
    out.push({ id: 'w:' + w.workId, date: w.dueOn, time: w.dueTime, endTime: w.endTime, kind: workKind(w.kind), team: teamOf(w.moduleId, w.kind), title: w.title, propertyId: w.propertyId, propertyName: w.propertyName,
      personId: w.assigneeId, personName: w.assigneeName, status: w.status, work: w });
  }
  for (const stay of s.stays) {
    const base = { team: 'stays' as const, time: null, endTime: null, propertyId: stay.propertyId, propertyName: stay.propertyName, personId: null, personName: null, status: null, stay };
    out.push({ ...base, id: 'in:' + stay.reservationId, date: stay.checkIn, kind: 'check-in', title: 'Guests arrive' });
    out.push({ ...base, id: 'out:' + stay.reservationId, date: stay.checkOut, kind: 'check-out', title: 'Guests leave' });
  }
  const runs = new Map<string, CalendarPayment[]>();
  for (const pay of s.payments) runs.set(pay.date, [...(runs.get(pay.date) ?? []), pay]);
  for (const [date, payments] of runs) {
    const one = payments.length === 1 ? payments[0] : null;
    out.push({ id: 'pay:' + date, date, time: null, endTime: null, kind: 'payment', team: 'accounts', title: 'Owner payment run', propertyId: one?.propertyId ?? '', propertyName: one ? one.propertyName : `${payments.length} properties`,
      personId: null, personName: null, status: null, payments });
  }
  const order = (k: EntryKind) => ENTRY_KINDS.indexOf(k);
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || order(a.kind) - order(b.kind) || a.propertyName.localeCompare(b.propertyName) || a.id.localeCompare(b.id));
}

// "10:00–12:00", "10:00", or null for any time that day.
export const timeRange = (start: string | null | undefined, end?: string | null) => start ? (end ? `${start}–${end}` : start) : null;

// A team filter keeps that team's entries; a person shows only the work assigned to them.
export function filterEntries(entries: CalendarEntry[], team: Team | 'all', person: string | null) {
  return entries.filter(e => (team === 'all' || e.team === team) && (!person || e.personId === person));
}
// People with work in the schedule, for the person picker.
export function calendarPeople(entries: CalendarEntry[]) {
  return Array.from(new Map(entries.filter(e => e.personId).map(e => [e.personId!, e.personName || 'Team member'])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
}
export function paymentSummary(payments: CalendarPayment[]) {
  const n = (status: CalendarPayment['status']) => payments.filter(x => x.status === status).length;
  return [[n('paid'), 'paid'], [n('issued'), 'issued'], [n('draft'), 'to issue']].filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · ');
}

const shift = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
// The month grid: six weeks from the Monday on or before the 1st (42 days, inside the 62-day limit).
export function monthGrid(month: string) {
  const first = month + '-01';
  const start = shift(first, -((new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => shift(start, w * 7 + d)));
  return { from: start, to: weeks[5][6], weeks };
}
export function shiftMonth(month: string, step: number) {
  const d = new Date(month + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (month: string) => new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const periodLabel = (period: string) => new Date(period + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------------------------------------------------------------------------------------------------
// The team calendar (client ask A9): guest names on stays, the changeovers view, team events and where
// each person is, a month grid with counts per day, a week, and booking bars per property. Everything
// below is pure and add-only: nothing above changes.

export type TeamEventKind = (typeof TEAM_EVENT_KINDS)[number];
export const TEAM_EVENT_LABEL: Record<TeamEventKind, string> = { absence: 'Absence', meeting: 'Meeting', away: 'Away', training: 'Training', other: 'Other' };
export const TEAM_EVENT_COLOUR = { light: '#4F5D7A', dark: '#B3BFD8' };

// What the teamEvents read answers: { from, to, canEditAll, events: [...] }. Tolerant of an empty location or time.
export const teamEventsSchema = z.object({
  from: z.string(), to: z.string(), canEditAll: z.boolean().default(false),
  events: z.array(z.object({
    id: uuid, userId: uuid, fullName: z.string().nullable().default(null), role: z.string().default(''), kind: z.enum(TEAM_EVENT_KINDS), title: z.string(),
    startsOn: z.string(), endsOn: z.string(), startTime: z.string().nullable().default(null), endTime: z.string().nullable().default(null),
    location: z.string().nullable().default(''), mine: z.boolean().default(false), version: z.number().default(1),
    // Who last added, changed or cancelled it and when (migration 20261014300000); `added` is true while nobody has changed it since.
    editedById: z.string().nullable().default(null), editedBy: z.string().nullable().default(null), editedAt: z.string().nullable().default(null), added: z.boolean().nullable().default(null),
  })).default([]),
});
export type TeamEvents = z.infer<typeof teamEventsSchema>;
export type TeamEvent = TeamEvents['events'][number];

const dayGap = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);
export const shortDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- Stays with guest names ----
// Nights between arrival and departure.
export const stayNights = (s: Pick<CalendarStay, 'checkIn' | 'checkOut'>) => Math.max(0, dayGap(s.checkIn, s.checkOut));
// The guest's name when the schedule carries one (staff other than cleaners), else ''.
export const guestNameOf = (s: Pick<CalendarStay, 'guestName'>) => (s.guestName ?? '').trim();
// "Maria Lopez", or "Guest stay" when no name is known.
export const stayLabel = (s: Pick<CalendarStay, 'guestName'>) => guestNameOf(s) || 'Guest stay';
// "12 Oct to 15 Oct".
export const stayDates = (s: Pick<CalendarStay, 'checkIn' | 'checkOut'>) => `${shortDay(s.checkIn)} to ${shortDay(s.checkOut)}`;
// "12 Oct to 15 Oct · 3 nights · 2 guests".
export function stayDetail(s: Pick<CalendarStay, 'checkIn' | 'checkOut' | 'guests'>) {
  const n = stayNights(s);
  return [stayDates(s), `${n} ${n === 1 ? 'night' : 'nights'}`, s.guests ? `${s.guests} ${s.guests === 1 ? 'guest' : 'guests'}` : ''].filter(Boolean).join(' · ');
}
// The title of a calendar entry. A stay's arrival and departure carry the guest's name when there is one;
// everything else keeps the title it already has.
export function entryTitle(e: Pick<CalendarEntry, 'kind' | 'title' | 'stay'>) {
  const name = e.stay ? guestNameOf(e.stay) : '';
  if (!name) return e.title;
  return e.kind === 'check-in' ? `${name} arrives` : e.kind === 'check-out' ? `${name} leaves` : e.title;
}

// ---- Filters ----
// A property filter on entries ('' or null keeps everything).
export const filterProperty = (entries: CalendarEntry[], propertyId: string | null) => propertyId ? entries.filter(e => e.propertyId === propertyId) : entries;
// The properties that have something in the schedule, for the property filter.
export function calendarProperties(s: CalendarSchedule): [string, string][] {
  const list = new Map<string, string>();
  for (const w of s.work) list.set(w.propertyId, w.propertyName);
  for (const stay of s.stays) list.set(stay.propertyId, stay.propertyName);
  return Array.from(list.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}
// The schedule for one property ('' or null keeps everything).
export const scheduleFor = (s: CalendarSchedule, propertyId: string | null): CalendarSchedule => propertyId
  ? { work: s.work.filter(w => w.propertyId === propertyId), stays: s.stays.filter(x => x.propertyId === propertyId), payments: s.payments.filter(x => x.propertyId === propertyId) }
  : s;

// ---- Changeovers ----
export type CleanState = 'none' | 'unassigned' | 'assigned' | 'in_progress' | 'review' | 'done';
export const CLEAN_STATE_LABEL: Record<CleanState, string> = { none: 'No clean booked', unassigned: 'Needs a cleaner', assigned: 'Cleaner booked', in_progress: 'Clean under way', review: 'Clean in review', done: 'Clean done' };
export const CLEAN_STATE_TONE: Record<CleanState, 'good' | 'wait' | 'bad' | 'plain'> = { none: 'bad', unassigned: 'wait', assigned: 'plain', in_progress: 'plain', review: 'wait', done: 'good' };
// Where a clean stands, from its status and whether anyone is assigned.
export function cleanStateOf(w: Pick<CalendarWork, 'status' | 'assigneeId'> | null): CleanState {
  if (!w) return 'none';
  if (w.status === 'completed' || w.status === 'done') return 'done';
  if (w.status === 'in_review' || w.status === 'submitted' || w.status === 'awaiting_review') return 'review';
  if (w.status === 'in_progress' || w.status === 'started') return 'in_progress';
  return w.assigneeId ? 'assigned' : 'unassigned';
}
export type Changeover = {
  day: string; propertyId: string; propertyName: string;
  out: CalendarStay; next: CalendarStay | null; sameDay: boolean; gapDays: number | null;
  clean: CalendarWork | null; cleanState: CleanState;
};
const livePhase = (status: string) => status !== 'cancelled' && status !== 'declined';
// Every departure on `day`, with the next arrival at the same property (the same day or later, from the
// stays in the schedule) and the clean booked for it: the clean due that day, else the first due before
// that next arrival (or the day after when none is booked). Same-day changeovers come first, then by
// the clean's time and the property name.
export function changeoversFor(day: string, schedule: CalendarSchedule): Changeover[] {
  const out: Changeover[] = [];
  for (const leaving of schedule.stays) {
    if (leaving.checkOut !== day) continue;
    const next = schedule.stays
      .filter(x => x.propertyId === leaving.propertyId && x.reservationId !== leaving.reservationId && x.checkIn >= day)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut))[0] ?? null;
    const limit = next ? next.checkIn : shift(day, 1);
    const clean = schedule.work
      .filter(w => w.kind === 'cleaning' && w.propertyId === leaving.propertyId && w.dueOn && w.dueOn >= day && w.dueOn <= limit && livePhase(w.status))
      .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!) || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.workId.localeCompare(b.workId))[0] ?? null;
    out.push({ day, propertyId: leaving.propertyId, propertyName: leaving.propertyName, out: leaving, next, sameDay: !!next && next.checkIn === day,
      gapDays: next ? dayGap(day, next.checkIn) : null, clean, cleanState: cleanStateOf(clean) });
  }
  return out.sort((a, b) => Number(b.sameDay) - Number(a.sameDay) || (a.clean?.dueTime ?? '99:99').localeCompare(b.clean?.dueTime ?? '99:99') || a.propertyName.localeCompare(b.propertyName) || a.out.reservationId.localeCompare(b.out.reservationId));
}
// The changeovers on each day from `from` to `to` (inclusive), oldest day first.
export function changeoversBetween(from: string, to: string, schedule: CalendarSchedule): Changeover[] {
  const days = Array.from(new Set(schedule.stays.map(x => x.checkOut).filter(d => d >= from && d <= to))).sort();
  return days.flatMap(d => changeoversFor(d, schedule));
}

// ---- Team events and where each person is ----
// The events that touch `day`, whole-day ones first, then by start time and name. A person narrows it to theirs.
export function eventsOn(day: string, events: readonly TeamEvent[], person: string | null = null): TeamEvent[] {
  return events
    .filter(e => e.startsOn <= day && day <= e.endsOn && (!person || e.userId === person))
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || (a.fullName ?? '').localeCompare(b.fullName ?? '') || a.id.localeCompare(b.id));
}
// An event that fills `day`: it has no start time, or `day` is a middle day of a longer one.
export const eventIsAllDay = (e: Pick<TeamEvent, 'startTime' | 'startsOn' | 'endsOn'>, day: string) => !e.startTime || (day > e.startsOn && day < e.endsOn);
// "10:00 to 11:15", "from 10:00", "until 16:00" or null for a whole day.
export function eventClock(e: Pick<TeamEvent, 'startTime' | 'endTime' | 'startsOn' | 'endsOn'>, day: string) {
  if (eventIsAllDay(e, day)) return null;
  if (e.startsOn === e.endsOn) return e.endTime ? `${e.startTime} to ${e.endTime}` : `from ${e.startTime}`;
  return day === e.startsOn ? `from ${e.startTime}` : e.endTime ? `until ${e.endTime}` : null;
}
// "Mon 2 Nov to Fri 6 Nov", or "Mon 2 Nov" for one day.
export const eventDates = (e: Pick<TeamEvent, 'startsOn' | 'endsOn'>) => e.startsOn === e.endsOn ? weekdayDay(e.startsOn) : `${weekdayDay(e.startsOn)} to ${weekdayDay(e.endsOn)}`;
// Who last edited a team event and when, in UK time: { label: 'Last changed', who: 'Sam Reid', when: 'Tue 13 Oct at 14:05',
// text: 'Last changed by Sam Reid on Tue 13 Oct at 14:05' }. 'Added' while nobody has changed it since. Null when the database does not say.
export function eventEdited(e: Pick<TeamEvent, 'editedById' | 'editedBy' | 'editedAt' | 'added'>, myId: string | null | undefined) {
  if (!e.editedAt || Number.isNaN(Date.parse(e.editedAt))) return null;
  const label = e.added ? 'Added' : 'Last changed', mine = !!e.editedById && e.editedById === myId;
  const who = mine ? 'You' : e.editedBy || 'A team member';
  const when = `${weekdayDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(e.editedAt)))} at ${londonClock(e.editedAt)}`;
  return { label, who, when, text: `${label} by ${mine ? 'you' : e.editedBy || 'a team member'} on ${when}` };
}

export type PersonStatus = 'working' | 'away' | 'off' | 'unplanned';
export type PersonDay = {
  userId: string; fullName: string; role: string; department: string | null;
  shift: 'early' | 'late' | 'both' | 'off' | null; hours: string; note: string; events: TeamEvent[]; status: PersonStatus; label: string;
};
const STATUS_ORDER: PersonStatus[] = ['working', 'away', 'off', 'unplanned'];
// Where everyone is on `day`: the rota shift planned for them and their team events. A person with an
// absence or time away that fills the day is away, whatever the rota says (the shift stays visible so a
// clash can be seen). People who only appear in events are listed too. Working first, then away, off and
// not planned, each by name.
export function whoIsWhere(day: string, rota: Pick<RotaPlan, 'people'> | null, events: readonly TeamEvent[]): PersonDay[] {
  const todays = eventsOn(day, events);
  const people = new Map<string, { fullName: string; role: string; department: string | null; shift: PersonDay['shift']; note: string }>();
  for (const person of rota?.people ?? []) {
    const cell = person.days.find(d => d.day === day) ?? null;
    people.set(person.userId, { fullName: person.fullName, role: person.role, department: person.department, shift: cell?.shift ?? null, note: cell?.note ?? '' });
  }
  for (const e of todays) if (!people.has(e.userId)) people.set(e.userId, { fullName: e.fullName ?? 'Team member', role: e.role, department: null, shift: null, note: '' });
  const out: PersonDay[] = [];
  for (const [userId, info] of people) {
    const mine = todays.filter(e => e.userId === userId);
    const away = mine.find(e => (e.kind === 'absence' || e.kind === 'away') && eventIsAllDay(e, day));
    const status: PersonStatus = away ? 'away' : info.shift === 'off' ? 'off' : info.shift ? 'working' : 'unplanned';
    const hours = info.shift && info.shift !== 'off' ? ROTA_HOURS[info.shift].replace('–', ' to ') : '';
    const label = away ? `${TEAM_EVENT_LABEL[away.kind]}: ${away.title}`
      : status === 'off' ? (info.note ? `Off: ${info.note}` : 'Off')
      : status === 'working' ? `${ROTA_LABEL[info.shift!]} shift${hours ? ` (${hours})` : ''}`
      : 'Not on the rota';
    out.push({ userId, fullName: info.fullName, role: info.role, department: info.department, shift: info.shift, hours, note: info.note, events: mine, status, label });
  }
  return out.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.fullName.localeCompare(b.fullName) || a.userId.localeCompare(b.userId));
}
// The same for each day of a week: one row per person with a cell per day.
export function whoIsWhereWeek(days: readonly string[], rota: Pick<RotaPlan, 'people'> | null, events: readonly TeamEvent[]) {
  const perDay = days.map(day => new Map(whoIsWhere(day, rota, events).map(cell => [cell.userId, cell] as const)));
  const people = new Map<string, PersonDay>();
  for (const day of perDay) for (const [userId, cell] of day) if (!people.has(userId)) people.set(userId, cell);
  const rows = Array.from(people.values()).map(who => ({
    userId: who.userId, fullName: who.fullName, role: who.role,
    // A cell for every day, so columns line up with the days: a day with nothing planned is "not on the rota".
    days: perDay.map((day): PersonDay => day.get(who.userId) ?? { ...who, shift: null, hours: '', note: '', events: [], status: 'unplanned', label: 'Not on the rota' }),
  }));
  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.userId.localeCompare(b.userId));
}
// People who have a team event or a shift in the data, for the person filter.
export function teamPeople(rota: Pick<RotaPlan, 'people'> | null, events: readonly TeamEvent[]): [string, string][] {
  const list = new Map<string, string>();
  for (const person of rota?.people ?? []) list.set(person.userId, person.fullName || 'Team member');
  for (const e of events) if (!list.has(e.userId)) list.set(e.userId, e.fullName || 'Team member');
  return Array.from(list.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

// ---- Month and week grids with counts per day ----
export type DayCounts = { date: string; inMonth: boolean; counts: Partial<Record<EntryKind | 'event', number>>; total: number };
function countsOn(date: string, byDate: Map<string, CalendarEntry[]>, events: readonly TeamEvent[]): Pick<DayCounts, 'counts' | 'total'> {
  const counts: DayCounts['counts'] = {};
  let total = 0;
  for (const e of byDate.get(date) ?? []) { const n = e.kind === 'payment' ? e.payments?.length ?? 1 : 1; counts[e.kind] = (counts[e.kind] ?? 0) + n; total += n; }
  const n = events.filter(e => e.startsOn <= date && date <= e.endsOn).length;
  if (n) { counts.event = n; total += n; }
  return { counts, total };
}
const byDay = (entries: readonly CalendarEntry[]) => { const map = new Map<string, CalendarEntry[]>(); for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]); return map; };
// Hostaway style month grid: the six weeks of monthGrid, each day with how many of each kind of entry
// (and team events, which count on every day they span) it holds. Days of the neighbouring months are
// counted too and flagged inMonth: false.
export function monthCounts(month: string, entries: readonly CalendarEntry[], events: readonly TeamEvent[] = []) {
  const grid = monthGrid(month), map = byDay(entries);
  return { from: grid.from, to: grid.to, weeks: grid.weeks.map(days => days.map((date): DayCounts => ({ date, inMonth: date.startsWith(month), ...countsOn(date, map, events) }))) };
}
// The Monday on or before a day, and the seven days from it.
export const weekStart = (day: string) => shift(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => shift(weekStart(day), i));
export const shiftWeekDay = (day: string, weeks: number) => shift(day, weeks * 7);
// "12 to 18 Oct 2026" (or "28 Sep to 4 Oct 2026").
export function weekRangeLabel(day: string) {
  const days = weekDays(day), first = days[0], last = days[6];
  const part = (iso: string, month: boolean) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', month ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
  return `${part(first, first.slice(0, 7) !== last.slice(0, 7))} to ${part(last, true)} ${last.slice(0, 4)}`;
}
// The seven days of the week holding `day`, with counts, as one row of the month grid.
export function weekCounts(day: string, entries: readonly CalendarEntry[], events: readonly TeamEvent[] = []) {
  const days = weekDays(day), map = byDay(entries);
  return { from: days[0], to: days[6], days: days.map((date): DayCounts => ({ date, inMonth: date.slice(0, 7) === day.slice(0, 7), ...countsOn(date, map, events) })) };
}

// ---- Booking bars per property across a run of days ----
export type TimelineBar = {
  reservationId: string; label: string; guestName: string; channel: string | null; checkIn: string; checkOut: string; nights: number;
  startCol: number; span: number; fromBefore: boolean; toAfter: boolean; stay: CalendarStay;
};
export type TimelineMark = { col: number; kind: EntryKind; title: string; workId: string; status: string };
export type TimelineRow = { propertyId: string; propertyName: string; bars: TimelineBar[]; marks: TimelineMark[] };
// One row per property that has a booking or a clean or repair in `days`. A booking's bar covers the
// nights it holds (arrival night to the night before departure), so a departure and an arrival on the
// same day sit side by side and never overlap. A stay with no nights still shows one column. Bars that
// start before or end after the days shown are flagged fromBefore / toAfter.
export function timelineRows(days: readonly string[], schedule: CalendarSchedule): TimelineRow[] {
  if (!days.length) return [];
  const first = days[0], last = days[days.length - 1];
  const rows = new Map<string, TimelineRow>();
  const row = (propertyId: string, propertyName: string) => { let r = rows.get(propertyId); if (!r) { r = { propertyId, propertyName, bars: [], marks: [] }; rows.set(propertyId, r); } return r; };
  for (const stay of schedule.stays) {
    const nights = stayNights(stay), lastNight = nights ? shift(stay.checkOut, -1) : stay.checkIn;
    if (lastNight < first || stay.checkIn > last) continue;
    const startCol = Math.max(0, dayGap(first, stay.checkIn)), endCol = Math.min(days.length - 1, dayGap(first, lastNight));
    row(stay.propertyId, stay.propertyName).bars.push({ reservationId: stay.reservationId, label: stayLabel(stay), guestName: guestNameOf(stay), channel: stay.channel ?? null,
      checkIn: stay.checkIn, checkOut: stay.checkOut, nights, startCol, span: endCol - startCol + 1, fromBefore: stay.checkIn < first, toAfter: lastNight > last, stay });
  }
  for (const w of schedule.work) {
    if (!w.dueOn || w.dueOn < first || w.dueOn > last || !livePhase(w.status)) continue;
    const kind = workKind(w.kind);
    if (kind !== 'clean' && kind !== 'repair' && kind !== 'routine') continue;
    row(w.propertyId, w.propertyName).marks.push({ col: dayGap(first, w.dueOn), kind, title: w.title, workId: w.workId, status: w.status });
  }
  for (const r of rows.values()) { r.bars.sort((a, b) => a.startCol - b.startCol || a.reservationId.localeCompare(b.reservationId)); r.marks.sort((a, b) => a.col - b.col || a.workId.localeCompare(b.workId)); }
  return Array.from(rows.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.propertyId.localeCompare(b.propertyId));
}
