import type { OwnerStay } from './owner-policy';

// Owner reports from confirmed stays: earnings count when a stay checks out (the payout follows the
// stay), occupancy counts the nights booked inside the month.
const DAY = 86400000;
const day = (iso: string) => Date.parse(iso + 'T00:00:00Z');
export const addMonths = (month: string, step: number) => { const d = new Date(month + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + step); return d.toISOString().slice(0, 7); };
export const monthStart = (month: string) => month + '-01';
export const monthEnd = (month: string) => new Date(day(addMonths(month, 1) + '-01') - DAY).toISOString().slice(0, 10);
export const daysInMonth = (month: string) => Math.round((day(addMonths(month, 1) + '-01') - day(month + '-01')) / DAY);
export const monthName = (month: string, long = true) => new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' });
// Nights of a stay between two dates (the end date not included).
export function nightsBetween(stay: Pick<OwnerStay, 'checkIn' | 'checkOut'>, from: string, toExclusive: string) {
  return Math.max(0, Math.round((Math.min(day(stay.checkOut), day(toExclusive)) - Math.max(day(stay.checkIn), day(from))) / DAY));
}
export const checksOutIn = (stay: Pick<OwnerStay, 'checkOut'>, month: string) => stay.checkOut.slice(0, 7) === month;

export type MonthStats = { earningsMinor: number; nights: number; available: number; occupancy: number | null; averageNightlyMinor: number | null; stays: number };
export function monthStats(stays: readonly OwnerStay[], month: string, propertyCount: number): MonthStats {
  const from = monthStart(month), to = addMonths(month, 1) + '-01';
  const paid = stays.filter(s => checksOutIn(s, month));
  const earningsMinor = paid.reduce((n, s) => n + (s.payoutMinor ?? 0), 0);
  // The average nightly rate uses only stays with a recorded payout, so a missing payout never drags it down.
  const priced = paid.filter(s => s.payoutMinor !== null && s.nights > 0), pricedNights = priced.reduce((n, s) => n + s.nights, 0);
  const nights = stays.reduce((n, s) => n + nightsBetween(s, from, to), 0), available = propertyCount * daysInMonth(month);
  return {
    earningsMinor, nights, available, stays: paid.length,
    occupancy: available ? Math.min(1, nights / available) : null,
    averageNightlyMinor: pricedNights ? Math.round(priced.reduce((n, s) => n + (s.payoutMinor ?? 0), 0) / pricedNights) : null,
  };
}
// Earnings for each of the months ending with `last`, oldest first.
export function monthlyEarnings(stays: readonly OwnerStay[], last: string, count = 12) {
  return Array.from({ length: count }, (_, i) => addMonths(last, i - count + 1)).map(month => ({ month, earningsMinor: stays.filter(s => checksOutIn(s, month)).reduce((n, s) => n + (s.payoutMinor ?? 0), 0) }));
}
// Per property for a month: earnings, nights booked and occupancy.
export function propertyMonth(stays: readonly OwnerStay[], properties: readonly { propertyId: string; propertyName: string }[], month: string) {
  return properties.map(p => {
    const mine = stays.filter(s => s.propertyId === p.propertyId), stats = monthStats(mine, month, 1);
    return { propertyId: p.propertyId, name: p.propertyName, earningsMinor: stats.earningsMinor, nights: stats.nights, occupancy: stats.occupancy ?? 0, bookings: mine.filter(s => nightsBetween(s, monthStart(month), addMonths(month, 1) + '-01') > 0).length };
  });
}
export const CHANNEL_LABEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other' };
