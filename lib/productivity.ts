import type { Productivity, ProductivityPerson, ShiftChange, Timesheet, TimesheetPerson } from './workspace-teams-policy';
import { dayLabel, londonClock, mondayOf, timesheetRows, type TimesheetRow } from './team-time';
import { DEPARTMENT_LABEL } from './hub';

// The Productivity Tool's sums and labels: hours per person by week (each from its Monday) and by
// month, the team's totals, and how a change to someone's hours reads.
const addDays = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
export const monthLabel = (month: string, style: 'short' | 'long' = 'short') =>
  new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}), timeZone: 'UTC' });
export const monthEnd = (month: string) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
export const moveMonth = (month: string, step: number) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + step, 1); return d.toISOString().slice(0, 7); };
// The weeks (their Mondays) that touch a month.
export function weeksOfMonth(month: string): string[] {
  const out: string[] = [], last = monthEnd(month);
  for (let monday = mondayOf(month + '-01'); monday <= last; monday = addDays(monday, 7)) out.push(monday);
  return out;
}
export const weekLabel = (monday: string) => 'w/c ' + new Date(monday + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// A day with its year, for the clock-in log: "Thu 8 Oct 2026".
export const dayWithYear = (iso: string) => `${dayLabel(iso)} ${iso.slice(0, 4)}`;

export const weekMinutes = (person: ProductivityPerson, monday: string) => person.weeks.find(w => w.start === monday)?.minutes ?? 0;
export const monthMinutes = (person: ProductivityPerson, month: string) => person.months.find(m => m.month === month)?.minutes ?? 0;
export const teamWeek = (data: Productivity, monday: string) => data.people.reduce((sum, p) => sum + weekMinutes(p, monday), 0);
export const teamMonth = (data: Productivity, month: string) => data.people.reduce((sum, p) => sum + monthMinutes(p, month), 0);
// Whole weeks so far in the period, for an average that doesn't count weeks still to come.
export function averageWeek(person: ProductivityPerson, from: string, to: string, today: string) {
  const end = to < today ? to : today;
  if (end < from) return 0;
  const weeks = Math.max(1, Math.ceil((Date.parse(end) - Date.parse(mondayOf(from)) + 86400000) / (7 * 86400000)));
  return Math.round(person.minutes / weeks);
}

// Hours as a compact figure ("38h 30m", "45m", "0h").
export const hoursShort = (minutes: number) => minutes <= 0 ? '0h' : minutes < 60 ? `${minutes}m` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes / 60}h`;
// Signed difference for a change ("+1h 00m", "−30m").
export const minutesDelta = (minutes: number) => (minutes > 0 ? '+' : minutes < 0 ? '−' : '±') + hoursShort(Math.abs(minutes));

const span = (from: string, to: string | null) => `${londonClock(from)}–${to ? londonClock(to) : 'still on shift'}`;
const length = (from: string, to: string | null, now: number) => Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 60000);
const ukDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));
export const CHANGE_KIND = { edit: 'Correction', add: 'Forgotten shift', close: 'Clock-out for a shift left open' } as const;
export const CHANGE_STATUS = { pending: 'Waiting for a super admin', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn', direct: 'Changed by a super admin' } as const;
// How a change reads: the day, the hours before and after, and what it does to the total.
export function describeChange(change: ShiftChange, now = Date.now()) {
  const after = span(change.clockedInAt, change.clockedOutAt);
  const before = change.before ? span(change.before.clockedInAt, change.before.clockedOutAt) : null;
  const delta = length(change.clockedInAt, change.clockedOutAt, now) - (change.before ? length(change.before.clockedInAt, change.before.clockedOutAt, now) : 0);
  const moved = change.before && change.before.department !== change.department ? `${DEPARTMENT_LABEL[change.before.department] ?? change.before.department} → ${DEPARTMENT_LABEL[change.department] ?? change.department}` : null;
  return { day: dayWithYear(ukDay(change.clockedInAt)), before, after, delta, moved };
}

const csvCell = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"` : text; };
// Hours by month (a column per month of the period) or by week (a column per week that starts in
// it), one row per person, in hours to two decimals.
export function productivityCsv(data: Productivity, by: 'month' | 'week', columns: string[]) {
  const head = ['Name', 'Department', ...columns.map(c => by === 'month' ? monthLabel(c, 'long') : weekLabel(c)), 'Total hours', 'Shifts', 'Days worked'];
  const rows: (string | number)[][] = [head];
  for (const person of data.people) {
    const cells = columns.map(c => ((by === 'month' ? monthMinutes(person, c) : weekMinutes(person, c)) / 60).toFixed(2));
    const total = columns.reduce((sum, c) => sum + (by === 'month' ? monthMinutes(person, c) : weekMinutes(person, c)), 0);
    rows.push([person.fullName, person.department ? DEPARTMENT_LABEL[person.department] ?? person.department : '', ...cells, (total / 60).toFixed(2), person.shifts, person.days]);
  }
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- the calendar (one day at a time)
// The weeks (Monday to Sunday) that show a month on a calendar.
export function calendarWeeks(month: string): string[][] {
  return weeksOfMonth(month).map(monday => Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
}
// When each rota shift is planned, in hours of the day (lib/team-time.ts ROTA_HOURS).
export const ROTA_SPAN = { early: [8, 16], late: [15, 23], both: [8, 23] } as const;
// An instant as hours of its UK day (13:30 is 13.5).
export const ukHours = (iso: string) => { const [h, m] = londonClock(iso).split(':').map(Number); return h + m / 60; };

type Sheet = Timesheet;
// stale: shifts with no clock out after 16 hours (they count only up to the limit); they need attention like missed days.
export type DayTotal = { minutes: number; people: number; shifts: number; missed: number; waiting: number; open: number; stale: number };
// Every day of a timesheet: hours, who worked, shifts, planned days with nothing clocked (once
// passed), changes waiting for a super admin, and shifts still running.
export function dayTotals(sheet: Sheet, today: string): Map<string, DayTotal> {
  const days = new Map<string, DayTotal>();
  const at = (day: string) => days.get(day) ?? (days.set(day, { minutes: 0, people: 0, shifts: 0, missed: 0, waiting: 0, open: 0, stale: 0 }), days.get(day)!);
  for (const person of sheet.people) for (const row of timesheetRows(person, today)) {
    const t = at(row.day);
    t.minutes += row.minutes; t.shifts += row.shifts.length; if (row.shifts.length) t.people += 1;
    if (row.missed) t.missed += 1; if (row.open) t.open += 1; if (row.stale) t.stale += 1;
  }
  for (const change of sheet.pending) at(ukDay(change.clockedInAt)).waiting += 1;
  return days;
}
export type DayPerson = { person: TimesheetPerson; row: TimesheetRow | null; waiting: Sheet['pending'] };
const start = (x: DayPerson) => x.row?.shifts[0] ? Date.parse(x.row.shifts[0].clockedInAt) : Infinity;
// Who worked or was planned on a day, earliest clock-in first, then those planned but not clocked.
export function dayPeople(sheet: Sheet, day: string, today: string): DayPerson[] {
  return sheet.people.flatMap(person => {
    const row = timesheetRows(person, today).find(r => r.day === day) ?? null;
    const waiting = sheet.pending.filter(c => c.userId === person.userId && ukDay(c.clockedInAt) === day);
    const working = !!row && (row.shifts.length > 0 || (!!row.planned && row.planned.shift !== 'off'));
    return working || waiting.length ? [{ person, row, waiting }] : [];
  }).sort((a, b) => start(a) - start(b) || a.person.fullName.localeCompare(b.person.fullName));
}

// A day's pauses and overtime in a few words: "Lunch 30m · Break 10m · Overtime 1h 15m".
const PAUSE_WORD = { lunch: 'Lunch', break: 'Break', emergency: 'Emergency' } as const;
type PausedShift = { clockedOutAt: string | null; overtimeFrom?: string | null; pauses?: { kind: keyof typeof PAUSE_WORD; startedAt: string; endedAt: string | null }[] };
export function pauseSummary(shifts: PausedShift[], now = Date.now()) {
  const totals = new Map<keyof typeof PAUSE_WORD, number>();
  let overtime = 0;
  for (const s of shifts) {
    const end = (iso: string | null | undefined) => iso ? Date.parse(iso) : s.clockedOutAt ? Date.parse(s.clockedOutAt) : now;
    for (const x of s.pauses ?? []) totals.set(x.kind, (totals.get(x.kind) ?? 0) + Math.max(0, Math.round((end(x.endedAt) - Date.parse(x.startedAt)) / 60000)));
    if (s.overtimeFrom) overtime += Math.max(0, Math.round((end(null) - Date.parse(s.overtimeFrom)) / 60000));
  }
  const parts = (['lunch', 'break', 'emergency'] as const).filter(k => totals.has(k)).map(k => `${PAUSE_WORD[k]} ${totals.get(k)! ? hoursShort(totals.get(k)!) : 'under 1m'}`);
  if (overtime) parts.push(`Overtime ${hoursShort(overtime)}`);
  return parts.join(' · ');
}
