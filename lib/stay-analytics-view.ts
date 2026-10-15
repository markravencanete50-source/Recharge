import { z } from 'zod';

// Reports > Guests & stays (Alex, via Lee: "analytics on each stay, average number of guests etc"). The database works every
// figure out from what Hostaway already sends (workspace_stay_analytics, migration 20261021600000); this file reads the
// answer, names things in plain words, picks the dates and says how much of each figure is known. Aggregates only: nothing
// here holds a guest's name, a booking reference or a stay.

export const STAY_CHANNELS = ['airbnb', 'booking_com', 'vrbo', 'direct', 'other'] as const;
export type StayChannel = (typeof STAY_CHANNELS)[number];
export const STAY_CHANNEL_LABEL: Record<StayChannel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other channel' };
export const stayChannelName = (channel: string) => STAY_CHANNEL_LABEL[channel as StayChannel] ?? 'Other channel';
export const STAYS_SECTION = 'stayAnalytics';
export const STAYS_MAX_DAYS = 366;
export const STAYS_INTRO = 'Confirmed stays with nights in these dates, from the bookings Hostaway sends. Owner stays are left out. Figures are totals and averages only; no guest is named.';
export const STAYS_NOTES = [
  'Only what the booking channel passes to Hostaway is known. Some channels do not send children, infants, pets or the guest’s country, so those figures are worked out from the stays where they are known.',
  'A stay with nights in two months is counted in both months.',
  'Days booked ahead count from the day the guest booked to the day they arrive. For a booking added to Hostaway later, it can read short.',
  'Repeat guests are not shown: Recharge keeps nothing about a guest that could link two stays.',
  'Why guests stay is not asked yet.',
];

// --- What the database answers ----------------------------------------------------------------------

const count = z.number().int().nonnegative();
const average = z.number().nullable();
const mixPart = z.object({ known: count, total: count, stays: count });
const bucket = z.object({ bucket: z.string(), stays: count });
export const stayAnalyticsSchema = z.object({
  from: z.string(), to: z.string(), propertyId: z.string().uuid().nullable(), channel: z.string().nullable(),
  stays: count, nights: count, averageNights: average,
  guests: z.object({ known: count, total: count, average }),
  mix: z.object({ adults: mixPart, children: mixPart, infants: mixPart, pets: mixPart }),
  lengths: z.array(bucket),
  arrivalDays: z.array(z.object({ day: z.number().int().min(1).max(7), stays: count })),
  leadTime: z.object({ known: count, averageDays: average, buckets: z.array(bucket) }),
  channels: z.array(z.object({ channel: z.string(), stays: count })),
  countries: z.object({ known: count, others: count, top: z.array(z.object({ country: z.string(), stays: count })) }),
  byMonth: z.array(z.object({ month: z.string(), stays: count, nights: count, averageNights: average, guestsKnown: count, averageGuests: average, leadKnown: count, averageLeadDays: average })),
  byProperty: z.array(z.object({
    propertyId: z.string().uuid(), propertyName: z.string(), stays: count, nights: count, averageNights: average, guestsKnown: count, averageGuests: average,
    leadKnown: count, averageLeadDays: average, childrenKnown: count, childrenStays: count, petsKnown: count, petsStays: count,
  })),
});
export type StayAnalytics = z.infer<typeof stayAnalyticsSchema>;

// --- Dates --------------------------------------------------------------------------------------------

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const shift = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export type StayRange = { from: string; to: string };
// This calendar month, first to last day (bookings ahead count too).
export function thisMonth(today: string): StayRange {
  const [y, m] = today.split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
}
// What the dates are compared with: whole months compare with the same number of whole months just before (this month
// with last month); any other dates with the same number of days just before.
export function comparisonRange(range: StayRange): StayRange {
  const [fy, fm, fd] = range.from.split('-').map(Number), [ty, tm, td] = range.to.split('-').map(Number);
  if (fd === 1 && td === lastDayOf(ty, tm)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1)), end = new Date(Date.UTC(fy, fm - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const n = days(range.from, range.to);
  return { from: shift(range.from, -n), to: shift(range.from, -1) };
}
export function stayRangeError(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose the first and last day.';
  if (to < from) return 'The last day must be on or after the first day.';
  return days(from, to) > STAYS_MAX_DAYS ? `Choose up to ${STAYS_MAX_DAYS} days.` : '';
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const stayMonthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
// "October 2026", "1 to 14 October 2026" or "1 September to 31 October 2026".
export function stayRangeLabel(range: StayRange): string {
  const [fy, fm, fd] = range.from.split('-').map(Number), [ty, tm, td] = range.to.split('-').map(Number);
  if (fy === ty && fm === tm && fd === 1 && td === lastDayOf(ty, tm)) return `${MONTHS[fm - 1]} ${fy}`;
  const start = `${fd} ${MONTHS[fm - 1]}${fy === ty ? '' : ' ' + fy}`;
  return fy === ty && fm === tm ? `${fd} to ${td} ${MONTHS[tm - 1]} ${ty}` : `${start} to ${td} ${MONTHS[tm - 1]} ${ty}`;
}

// --- Words --------------------------------------------------------------------------------------------

export const percent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 100) : null;
// "Not known for 25% of stays", or '' when every stay has it (or there are no stays).
export function notKnownLine(known: number, stays: number): string {
  if (stays <= 0 || known >= stays) return '';
  const missing = 100 - (percent(known, stays) ?? 0);
  return known === 0 ? 'Not known for any of these stays' : `Not known for ${Math.max(1, missing)}% of stays`;
}
export const oneDecimal = (n: number | null) => n === null ? 'Not known' : (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });
export const plainDays = (n: number | null) => n === null ? 'Not known' : `${Math.round(n)} ${Math.round(n) === 1 ? 'day' : 'days'}`;
// "2 more than last month", "the same as last month", or '' with nothing to compare.
export function compareLine(now: number | null, before: number | null, unit: string, label = 'last month', decimals = 0): string {
  if (now === null || before === null) return '';
  const f = 10 ** decimals, diff = Math.round((now - before) * f) / f;
  if (diff === 0) return `The same as ${label}`;
  return `${Math.abs(diff).toLocaleString('en-GB', { maximumFractionDigits: decimals })} ${unit} ${diff > 0 ? 'more' : 'fewer'} than ${label}`;
}
// What the comparison is called: "last month" for this month against last month, else the dates.
export function comparisonLabel(range: StayRange, today: string): string {
  const now = thisMonth(today), before = comparisonRange(now);
  if (range.from === now.from && range.to === now.to) return 'last month';
  const c = comparisonRange(range);
  return c.from === before.from && c.to === before.to ? 'last month' : stayRangeLabel(c);
}

export const LENGTH_LABEL: Record<string, string> = { '1': '1 night', '2-3': '2 to 3 nights', '4-6': '4 to 6 nights', '7-13': '1 to 2 weeks', '14+': '2 weeks or more' };
export const LEAD_LABEL: Record<string, string> = { '0-6': 'Under a week ahead', '7-29': '1 to 4 weeks ahead', '30-89': '1 to 3 months ahead', '90-179': '3 to 6 months ahead', '180+': '6 months or more ahead' };
export const DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const arrivalDayName = (isoDay: number) => DAY_NAME[isoDay - 1] ?? 'Unknown day';
// A two-letter code as the country's English name where the device knows it ("GB" -> "United Kingdom"); a name as given.
export function countryName(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return country;
  try {
    const names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
    return names.of(country) ?? country;
  } catch { return country; }
}

// The guest mix as plain lines: each kind of guest, the share of stays with them, and how much is not known.
export function guestMix(r: StayAnalytics) {
  const line = (label: string, part: StayAnalytics['mix']['adults'], withLabel: string) => ({
    label, total: part.total, known: part.known, share: percent(part.stays, part.known),
    detail: [part.known ? `${withLabel}: ${percent(part.stays, part.known)}% of stays where known` : '', notKnownLine(part.known, r.stays)].filter(Boolean).join(' · '),
  });
  return [
    line('Adults', r.mix.adults, 'With adults'),
    line('Children', r.mix.children, 'With children'),
    line('Infants', r.mix.infants, 'With infants'),
    line('Pets', r.mix.pets, 'With pets'),
  ];
}
