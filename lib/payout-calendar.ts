import { bulkPayoutPlan, filterPayouts, payoutDates, type PayoutRow } from './accounts-live';

// The calendar on Accounts -> Reconciliation -> Platform stays (mobile/src/PayoutStays.tsx), which replaced a row of
// about 30 day chips. The rows passed in are the ones in view after the search, the platform and the status: each day
// shows how many of them check in that day, a day chosen narrows the list to it, and the day's "Approve these N" works on
// that day only. "Approve all N" keeps working on the whole filtered set, whatever day is chosen.
type Row = Pick<PayoutRow, 'checkIn' | 'settledMinor' | 'reservationId' | 'version' | 'state' | 'expectedMinor' | 'receivedMinor'>;

// Stays per check-in day.
export function payoutDayCounts(rows: readonly Pick<PayoutRow, 'checkIn'>[]): Record<string, number> {
  return Object.fromEntries(payoutDates([...rows]).map(d => [d.date, d.count]));
}

// The first and last check-in days there is data for (days outside are shown muted).
export function payoutDataBounds(rows: readonly Pick<PayoutRow, 'checkIn'>[]): { from: string | null; to: string | null } {
  const days = rows.map(r => r.checkIn).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

// The month the calendar opens on: the chosen day's, else the first day with a stay, else the period's.
export function payoutCalendarMonth(day: string | null, rows: readonly Pick<PayoutRow, 'checkIn'>[], period: string | null): string {
  return (day ?? payoutDataBounds(rows).from ?? (period ? period + '-01' : new Date().toISOString())).slice(0, 7);
}

// Choosing a day: the same day again clears it; a day with nothing on it in view clears it too.
export function togglePayoutDay(current: string | null, day: string | null, counts: Readonly<Record<string, number>>): string | null {
  if (!day || day === current) return null;
  return counts[day] ? day : null;
}

// What the list and the two approve buttons work on.
export function payoutCalendarScope<T extends Row>(inView: T[], day: string | null) {
  const list = day ? filterPayouts(inView, 'all', [day]) : inView;
  return {
    list,
    // "Approve these N" for the chosen day, with the stays held back counted like Approve all does.
    day: day ? bulkPayoutPlan(list, false) : null,
    // "Approve all N" for everything in view.
    all: bulkPayoutPlan(inView, false),
  };
}
