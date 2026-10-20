import { csvCell } from './analytics-export';
import { DEPARTMENT_LABEL } from './hub';
import type { RotaPlan, Timesheet, TimesheetPerson } from './workspace-teams-policy';

// Who works when: the rota by date, the daily timesheet of hours clocked, and the times of day the
// app shows (always UK time, like the dates).
export const FREQUENCY_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', as_needed: 'As needed' } as const;
export const ROTA_LABEL = { early: 'Early', late: 'Late', both: 'Early and late', off: 'Off' } as const;
export const ROTA_HOURS = { early: '8am–4pm', late: '3pm–11pm', both: '8am–11pm', off: '' } as const;

const addDays = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const mondayOf = (iso: string) => addDays(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
export const weekOf = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const shiftWeek = (monday: string, weeks: number) => addDays(monday, weeks * 7);
export const dayLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// The time of an instant in the UK, as HH:MM.
export const londonClock = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date(iso));
// The instant a UK date and time stands for (BST or GMT as it was that day), as an ISO string.
export function londonInstant(day: string, clock: string): string {
  const [y, m, d] = day.split('-').map(Number), [h, min] = clock.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (shown - guess)).toISOString();
}
export const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

// One person's day on the rota: what was planned, read for the grid.
export function rotaCell(person: RotaPlan['people'][number], day: string) {
  return person.days.find(d => d.day === day) ?? null;
}

// Each day of a timesheet, with what stands out: a planned day with nothing clocked (once it has
// passed), hours with nothing planned, shifts still open or changed by an admin, and shifts left open past the limit
// (stale: they did not clock out; lib/shift-hours.ts).
export type TimesheetRow = TimesheetPerson['days'][number] & { missed: boolean; unplanned: boolean; open: boolean; stale: boolean; edited: boolean };
export function timesheetRows(person: TimesheetPerson, today: string): TimesheetRow[] {
  return person.days.map(d => {
    const working = !!d.planned && d.planned.shift !== 'off';
    return { ...d, missed: working && !d.shifts.length && d.day < today, unplanned: !!d.shifts.length && !working,
      open: d.shifts.some(s => !s.clockedOutAt && !s.stale), stale: d.shifts.some(s => s.stale), edited: d.shifts.some(s => s.edited) };
  });
}
export function timesheetSummary(person: TimesheetPerson, today: string) {
  const rows = timesheetRows(person, today);
  return { minutes: person.totalMinutes, daysWorked: rows.filter(r => r.shifts.length).length, plannedDays: rows.filter(r => r.planned && r.planned.shift !== 'off').length, missed: rows.filter(r => r.missed).length, notClockedOut: new Set(rows.flatMap(r => r.shifts.filter(s => s.stale).map(s => s.id))).size };
}

// The timesheet as a spreadsheet: one row per shift (or per planned day with nothing clocked).
export function timesheetCsv(sheet: Timesheet) {
  const rows: (string | number)[][] = [['Name', 'Department', 'Date', 'Planned', 'Clocked in', 'Clocked out', 'Hours', 'Changed by an admin']];
  for (const person of sheet.people) {
    for (const d of person.days) {
      const planned = d.planned ? ROTA_LABEL[d.planned.shift] : '';
      if (!d.shifts.length) rows.push([person.fullName, DEPARTMENT_LABEL[(d.planned ? d.planned.department : person.department) ?? ''] ?? '', d.day, planned, '', '', 0, '']);
      for (const s of d.shifts) rows.push([person.fullName, DEPARTMENT_LABEL[s.department] ?? s.department, d.day, planned, londonClock(s.clockedInAt), s.clockedOutAt ? londonClock(s.clockedOutAt) : s.stale ? 'Did not clock out (counted up to 16h until corrected)' : 'Still on shift',
        (s.minutes / 60).toFixed(2), s.edited ? s.editNote || 'Yes' : '']);
    }
    rows.push([person.fullName, 'Total', sheet.from + ' to ' + sheet.to, '', '', '', (person.totalMinutes / 60).toFixed(2), '']);
  }
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
