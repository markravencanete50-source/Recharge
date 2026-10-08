import { z } from 'zod';

// The live calendar: what the shared schedule holds for each day (cleans, arrivals and departures,
// repairs, routine visits, inspections, other dated work and, for admins and accounts, payment
// runs), which team each entry belongs to, and the six-week month grid it is drawn on.
const uuid = z.string().uuid();
export const calendarScheduleSchema = z.object({
  work: z.array(z.object({
    workId: uuid, propertyId: uuid, propertyName: z.string(), moduleId: z.string().nullable().default(null), title: z.string(), status: z.string(),
    dueOn: z.string().nullable(), assigneeId: z.string().nullable(), assigneeName: z.string().nullable(), kind: z.string().nullable(), version: z.number(),
  })),
  stays: z.array(z.object({ reservationId: z.string(), propertyId: z.string(), propertyName: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), channel: z.string().nullable().optional() })),
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
export const KIND_LABEL: Record<EntryKind, string> = { 'check-out': 'Departure', clean: 'Clean', 'check-in': 'Arrival', repair: 'Repair', routine: 'Routine visit', inspection: 'Inspection', work: 'Task', payment: 'Payment run' };
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
  id: string; date: string; kind: EntryKind; team: Team; title: string; propertyId: string; propertyName: string;
  personId: string | null; personName: string | null; status: string | null;
  work?: CalendarWork; stay?: CalendarStay; payments?: CalendarPayment[];
};
const workKind = (kind: string | null): EntryKind => kind === 'cleaning' ? 'clean' : kind === 'maintenance' ? 'repair' : kind === 'routine_visit' ? 'routine' : kind === 'inspection' ? 'inspection' : 'work';

// Every entry in the schedule: work on its due day, each stay's arrival and departure, and one
// payment run per day for the statements on it.
export function calendarEntries(s: CalendarSchedule): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const w of s.work) {
    if (!w.dueOn) continue;
    out.push({ id: 'w:' + w.workId, date: w.dueOn, kind: workKind(w.kind), team: teamOf(w.moduleId, w.kind), title: w.title, propertyId: w.propertyId, propertyName: w.propertyName,
      personId: w.assigneeId, personName: w.assigneeName, status: w.status, work: w });
  }
  for (const stay of s.stays) {
    const base = { team: 'stays' as const, propertyId: stay.propertyId, propertyName: stay.propertyName, personId: null, personName: null, status: null, stay };
    out.push({ ...base, id: 'in:' + stay.reservationId, date: stay.checkIn, kind: 'check-in', title: 'Guests arrive' });
    out.push({ ...base, id: 'out:' + stay.reservationId, date: stay.checkOut, kind: 'check-out', title: 'Guests leave' });
  }
  const runs = new Map<string, CalendarPayment[]>();
  for (const pay of s.payments) runs.set(pay.date, [...(runs.get(pay.date) ?? []), pay]);
  for (const [date, payments] of runs) {
    const one = payments.length === 1 ? payments[0] : null;
    out.push({ id: 'pay:' + date, date, kind: 'payment', team: 'accounts', title: 'Owner payment run', propertyId: one?.propertyId ?? '', propertyName: one ? one.propertyName : `${payments.length} properties`,
      personId: null, personName: null, status: null, payments });
  }
  const order = (k: EntryKind) => ENTRY_KINDS.indexOf(k);
  return out.sort((a, b) => a.date.localeCompare(b.date) || order(a.kind) - order(b.kind) || a.propertyName.localeCompare(b.propertyName) || a.id.localeCompare(b.id));
}

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
