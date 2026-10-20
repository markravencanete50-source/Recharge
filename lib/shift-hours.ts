import { londonClock, londonInstant } from './team-time';

// How a shift's hours count, the one rule the timesheet, the Productivity Tool, VA pay, team performance and the
// reports share (the database has the same rule: private.workspace_shift_counted_end and
// private.workspace_shift_counted_minutes, migration 20261025600000).
//  * A period (a day, a week, a month) counts only the part of a shift inside it, in UK time. A day never holds
//    more than 24 hours for anyone.
//  * A shift with no clock out counts up to now while it is under 16 hours old. After 16 hours it is no longer
//    "on shift": it "did not clock out", and counts up to 16 hours after the clock in, never more, until a manager
//    corrects it. That is the safer rule for pay: nobody is paid for hours past the limit that may not have been
//    worked, and nobody loses the shift entirely either.
//  * A corrected or added shift lasts at most 24 hours; over 16 hours needs an explicit "yes, that is right".
export const OPEN_SHIFT_LIMIT_HOURS = 16;
export const LONG_SHIFT_HOURS = 16;
export const MAX_SHIFT_HOURS = 24;
const HOUR = 3600000;
export const NOT_CLOCKED_OUT = 'Did not clock out';
export const COUNTED_UNTIL_CORRECTED = `Counted up to ${OPEN_SHIFT_LIMIT_HOURS}h until corrected`;
export const LONG_SHIFT_QUESTION = `This shift is over ${LONG_SHIFT_HOURS} hours. Is that right?`;

export type ShiftTimes = { clockedInAt: string; clockedOutAt: string | null };
// Unpaid time inside a shift (a pause still running has no end).
export type UnpaidSpan = { startedAt: string; endedAt: string | null };
export type Window = { from: number; to: number };

// Open for longer than the limit: they did not clock out.
export const isStaleOpen = (s: ShiftTimes, now = Date.now()) => !s.clockedOutAt && now - Date.parse(s.clockedInAt) > OPEN_SHIFT_LIMIT_HOURS * HOUR;
export type ShiftState = 'closed' | 'on_shift' | 'not_clocked_out';
export const shiftState = (s: ShiftTimes, now = Date.now()): ShiftState => s.clockedOutAt ? 'closed' : isStaleOpen(s, now) ? 'not_clocked_out' : 'on_shift';
// Where the counted hours stop: the clock out, else now, but never past the limit.
export function countedEnd(s: ShiftTimes, now = Date.now()) {
  const start = Date.parse(s.clockedInAt);
  return s.clockedOutAt ? Date.parse(s.clockedOutAt) : Math.max(start, Math.min(now, start + OPEN_SHIFT_LIMIT_HOURS * HOUR));
}
// Minutes counted inside a window (all of the shift with no window), less the unpaid pauses inside it. Not rounded.
export function countedMinutes(s: ShiftTimes, window: Window | null = null, now = Date.now(), unpaid: UnpaidSpan[] = []) {
  const start = Math.max(Date.parse(s.clockedInAt), window ? window.from : -Infinity);
  const end = Math.min(countedEnd(s, now), window ? window.to : Infinity);
  if (end <= start) return 0;
  const off = unpaid.reduce((sum, x) => {
    const a = Math.max(Date.parse(x.startedAt), start), b = Math.min(x.endedAt ? Date.parse(x.endedAt) : end, end);
    return sum + Math.max(0, b - a);
  }, 0);
  return Math.max(0, (end - start - off) / 60000);
}

// A UK day (YYYY-MM-DD) as an instant window: midnight to midnight, BST or GMT as it was.
const nextDay = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
export const ukDayWindow = (day: string): Window => ({ from: Date.parse(londonInstant(day, '00:00')), to: Date.parse(londonInstant(nextDay(day), '00:00')) });
// A period of whole UK days, first to last inclusive.
export const ukPeriodWindow = (first: string, last: string): Window => ({ from: ukDayWindow(first).from, to: ukDayWindow(last).to });
export const ukDayOf = (iso: string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));
// The UK days a shift's counted hours touch.
export function shiftDays(s: ShiftTimes, now = Date.now()) {
  const out: string[] = [], last = ukDayOf(Math.max(Date.parse(s.clockedInAt), countedEnd(s, now) - 1));
  for (let d = ukDayOf(s.clockedInAt); d <= last; d = nextDay(d)) out.push(d);
  return out;
}
// Rounded minutes counted on one UK day, and on each day of a shift.
export const dayMinutes = (s: ShiftTimes, day: string, now = Date.now(), unpaid: UnpaidSpan[] = []) => Math.round(countedMinutes(s, ukDayWindow(day), now, unpaid));
// Where a shift sits on a day's timeline, in hours of that day (0 to 24).
export function dayHours(s: ShiftTimes, day: string, now = Date.now()) {
  const w = ukDayWindow(day), length = (w.to - w.from) / HOUR;
  const from = Math.max(0, (Date.parse(s.clockedInAt) - w.from) / HOUR), to = Math.min(length, (countedEnd(s, now) - w.from) / HOUR);
  return { from: Math.min(from, 24), to: Math.max(Math.min(to, 24), Math.min(from, 24)) };
}

// --- Words -------------------------------------------------------------------------------------------------------
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
const STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
// "15 Oct 2026, 14:56" (UK time).
export const fullStamp = (iso: string) => `${STAMP.format(new Date(iso))}, ${londonClock(iso)}`;
// "Thu 08:39".
export const dayClock = (iso: string) => `${WEEKDAY.format(new Date(iso))} ${londonClock(iso)}`;
// A shift's span: "08:39 - 16:00" within one day, "Thu 08:39 - Fri 02:10" across days, "08:39 - now" while on
// shift, "Thu 08:39 - did not clock out" once past the limit.
export function shiftSpan(s: ShiftTimes, now = Date.now()) {
  const state = shiftState(s, now);
  if (state === 'not_clocked_out') return `${dayClock(s.clockedInAt)} - did not clock out`;
  if (state === 'on_shift') return ukDayOf(s.clockedInAt) === ukDayOf(now) ? `${londonClock(s.clockedInAt)} - now` : `${dayClock(s.clockedInAt)} - now`;
  return ukDayOf(s.clockedInAt) === ukDayOf(s.clockedOutAt!) ? `${londonClock(s.clockedInAt)} - ${londonClock(s.clockedOutAt!)}` : `${dayClock(s.clockedInAt)} - ${dayClock(s.clockedOutAt!)}`;
}
// The clock in and clock out cells: with the weekday when the shift crosses midnight.
export function shiftEnds(s: ShiftTimes, now = Date.now()) {
  const crosses = !!s.clockedOutAt && ukDayOf(s.clockedInAt) !== ukDayOf(s.clockedOutAt);
  const state = shiftState(s, now);
  return {
    in: crosses || state === 'not_clocked_out' ? dayClock(s.clockedInAt) : londonClock(s.clockedInAt),
    out: state === 'closed' ? (crosses ? dayClock(s.clockedOutAt!) : londonClock(s.clockedOutAt!)) : state === 'on_shift' ? 'On shift' : NOT_CLOCKED_OUT,
    state,
  };
}

// --- Correcting or adding a shift ----------------------------------------------------------------------------------
// Each end has its own UK date and time. Clock out must be after clock in, both in the past; over 16 hours needs the
// explicit "yes"; over 24 hours is refused. An open shift (no clock out) is allowed only when `open` is true.
export type ShiftCheck = { error: string | null; needsConfirm: boolean; minutes: number | null };
export function checkShiftTimes(i: { clockedInAt: string | null; clockedOutAt: string | null; confirmedLong?: boolean; open?: boolean; now?: number }): ShiftCheck {
  const now = i.now ?? Date.now();
  if (!i.clockedInAt || Number.isNaN(Date.parse(i.clockedInAt))) return { error: 'Choose the date and time they clocked in.', needsConfirm: false, minutes: null };
  const start = Date.parse(i.clockedInAt);
  if (start > now) return { error: 'Clock in cannot be in the future.', needsConfirm: false, minutes: null };
  if (!i.clockedOutAt) return i.open ? { error: null, needsConfirm: false, minutes: null } : { error: 'Choose the date and time they clocked out.', needsConfirm: false, minutes: null };
  const end = Date.parse(i.clockedOutAt);
  if (Number.isNaN(end)) return { error: 'Choose the date and time they clocked out.', needsConfirm: false, minutes: null };
  if (end <= start) return { error: 'Clock out must be after clock in.', needsConfirm: false, minutes: null };
  if (end > now) return { error: 'Clock out cannot be in the future.', needsConfirm: false, minutes: null };
  const minutes = Math.round((end - start) / 60000);
  if (minutes > MAX_SHIFT_HOURS * 60) return { error: `A shift lasts at most ${MAX_SHIFT_HOURS} hours.`, needsConfirm: false, minutes };
  if (minutes > LONG_SHIFT_HOURS * 60 && !i.confirmedLong) return { error: LONG_SHIFT_QUESTION, needsConfirm: true, minutes };
  return { error: null, needsConfirm: false, minutes };
}
