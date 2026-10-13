import { monthGrid, monthLabel, shiftMonth } from './calendar-live';

// The shared date picker (mobile/src/CalendarPicker.tsx): the month grid of the team calendar (lib/calendar-live.ts),
// with a single day or a date range chosen on it and an optional count on each day. Dates are ISO days (YYYY-MM-DD).
export { monthLabel, shiftMonth };
export type DateRange = { from: string | null; to: string | null };
export type PickerCell = {
  date: string; day: number; inMonth: boolean; isToday: boolean;
  // A count to show on the day (stays to approve, for example), when the screen gives one and it is above 0.
  count: number | null;
  // Outside the days the screen has data for: shown muted, still pickable.
  muted: boolean;
  selected: boolean; inRange: boolean; rangeStart: boolean; rangeEnd: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
export const addDays = (iso: string, days: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const monthOf = (iso: string) => iso.slice(0, 7);
export const lastDayOf = (month: string) => addDays(shiftMonth(month, 1) + '-01', -1);
export const wholeMonth = (month: string): { from: string; to: string } => ({ from: month + '-01', to: lastDayOf(month) });
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// "1 Oct 2026", and "1 Oct 2026 to 31 Oct 2026" for a range ("from 1 Oct 2026" while only the start is chosen).
export const dayLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const longDayLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
export function rangeLabel(r: DateRange, empty = 'Choose dates'): string {
  if (!r.from) return empty;
  if (!r.to) return `From ${dayLabel(r.from)}`;
  return r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} to ${dayLabel(r.to)}`;
}

// The six weeks shown for a month, each day marked with what the picker needs to draw it.
export function pickerWeeks(month: string, opts: { today: string; value?: DateRange; counts?: Readonly<Record<string, number>>; dataFrom?: string | null; dataTo?: string | null }): PickerCell[][] {
  const { from, to } = opts.value ?? { from: null, to: null };
  const end = to ?? from;
  return monthGrid(month).weeks.map(week => week.map(date => {
    const count = opts.counts?.[date] ?? 0;
    return {
      date, day: Number(date.slice(8)), inMonth: date.startsWith(month), isToday: date === opts.today,
      count: count > 0 ? count : null,
      muted: (!!opts.dataFrom && date < opts.dataFrom) || (!!opts.dataTo && date > opts.dataTo),
      selected: !!from && (date === from || date === end),
      inRange: !!from && !!end && date >= from && date <= end,
      rangeStart: date === from, rangeEnd: !!end && date === end,
    };
  }));
}

// Choosing a day.
//  single: the day, or nothing when the same day is chosen again (when it can be cleared).
//  range: the first click starts a range, the second ends it (an earlier day becomes the start), and a click on a
//         finished range starts a new one.
export function pickDay(value: DateRange, day: string, mode: 'single' | 'range', clearable = true): DateRange {
  if (mode === 'single') return value.from === day && (value.to ?? day) === day && clearable ? { from: null, to: null } : { from: day, to: day };
  if (!value.from || value.to) return { from: day, to: null };
  return day < value.from ? { from: day, to: value.from } : { from: value.from, to: day };
}

// Keyboard: arrows move a day or a week, Page Up and Page Down a month, Home and End to the week's ends.
export function moveFocus(day: string, key: string): string | null {
  switch (key) {
    case 'ArrowLeft': return addDays(day, -1);
    case 'ArrowRight': return addDays(day, 1);
    case 'ArrowUp': return addDays(day, -7);
    case 'ArrowDown': return addDays(day, 7);
    case 'PageUp': return clampToMonth(day, shiftMonth(monthOf(day), -1));
    case 'PageDown': return clampToMonth(day, shiftMonth(monthOf(day), 1));
    case 'Home': return addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
    case 'End': return addDays(day, 6 - ((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
    default: return null;
  }
}
const clampToMonth = (day: string, month: string) => { const last = lastDayOf(month); const same = month + day.slice(7); return same > last ? last : same; };

// What a screen reader says for a day.
export function cellLabel(c: PickerCell, noun = ''): string {
  return [longDayLabel(c.date), c.count ? `${c.count}${noun ? ' ' + noun : ''}` : '', c.isToday ? 'today' : '', c.selected || c.inRange ? 'selected' : ''].filter(Boolean).join(', ');
}
