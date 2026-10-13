import { z } from 'zod';

// The Performance report (finance report section 'performance', read through workspace_finance_report by
// finance roles and admins only). The database works every figure out (20261012130000); this file holds the
// shapes the screen reads, the period choices and the small pure helpers around them.
//
// Definitions, the same as the SQL:
// * Management fees: the fee on ISSUED or PAID owner statements whose period starts inside the dates, each
//   statement whole. Draft and void statements are left out. VAT is shown on its own and is never income.
// * Cleaning charged: the changeover lines on those statements. Cleaning cost: what the same cleans actually
//   cost (the cleaner's invoice line, else the cleaner's rate). Margin = charged minus cost.
// * Occupancy: nights booked (confirmed stays, owner stays included, each counted for its nights inside the
//   dates) over nights available (the dates' nights for each property in view).
// * Average nightly rate: gross of platform and direct stays whose amount is known (a platform stay once its
//   payout is settled), shared by nights inside the dates, over those nights. Halves round away from zero.
// * The channel filter narrows stays (occupancy, gross and rate) only; fees and cleaning come from statements.
// Every amount is whole pence.

export const PERFORMANCE_CHANNELS = ['airbnb', 'booking_com', 'vrbo', 'direct', 'other'] as const;
export type PerformanceChannel = (typeof PERFORMANCE_CHANNELS)[number];
export const MAX_PERFORMANCE_DAYS = 366;
export const PERFORMANCE_HELP =
  'Management fees come from issued and paid statements that start in these dates (VAT is shown on its own and is not income). ' +
  'Cleaning margin is what owners were charged for those cleans less what the cleans cost. ' +
  'Occupancy is nights booked, owner stays included, over nights available. ' +
  'The nightly rate uses platform and direct stays once their payout is known. The channel filter changes stays only.';

const int = z.number().int();
const count = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const figures = {
  managementFeeMinor: int, vatMinor: int,
  cleaningChargedMinor: int, cleaningCostMinor: int, cleaningMarginMinor: int,
  cleanCount: count, cleansWithoutCost: count, statementCount: count,
  grossRevenueMinor: int, nightsBooked: count, nightsAvailable: count, occupancyBps: count.nullable(),
  nightsSold: count, averageNightlyRateMinor: int.nullable(),
  // Profit per clean (client answer 4, 20261014140000): cleans on itemised statements that have an invoice line. Optional
  // so an older server's report still reads.
  invoicedCleanCount: count.optional(), invoicedChargedMinor: int.optional(), invoicedCostMinor: int.optional(),
  cleanProfitMinor: int.optional(), profitPerCleanMinor: int.nullable().optional(),
};
export const performanceFiguresSchema = z.object(figures);
export const performancePropertySchema = z.object({ propertyId: z.string().uuid(), propertyName: z.string(), region: z.string().nullable(), ...figures });
export const performanceMonthSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), from: isoDate, to: isoDate, ...figures });
export const performanceChannelSchema = z.object({
  channel: z.string(), nightsBooked: count, occupancyBps: count.nullable(), grossRevenueMinor: int, nightsSold: count, averageNightlyRateMinor: int.nullable(),
});
export const performanceReportSchema = z.object({
  section: z.literal('performance'), from: isoDate, to: isoDate, days: count,
  filters: z.object({ propertyId: z.string().uuid().nullable(), region: z.string().nullable(), channel: z.string().nullable() }),
  totals: performanceFiguresSchema,
  byProperty: z.array(performancePropertySchema),
  byMonth: z.array(performanceMonthSchema),
  byChannel: z.array(performanceChannelSchema),
});
export type PerformanceFigures = z.infer<typeof performanceFiguresSchema>;
export type PerformanceReport = z.infer<typeof performanceReportSchema>;

// 5000 → "50%", 2213 → "22.1%", null → "–". Whole numbers only, halves of a tenth rounded up.
export function formatOccupancy(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isSafeInteger(bps) || bps < 0) return '–';
  const tenths = Math.floor((bps + 5) / 10);
  const whole = Math.floor(tenths / 10), tenth = tenths % 10;
  return `${whole.toLocaleString('en-GB')}${tenth ? '.' + tenth : ''}%`;
}

// Dates are ISO days (YYYY-MM-DD). A range is { from, to } with `to` the first day NOT included.
export type PerformanceRange = { from: string; to: string };
const DAY_MS = 86400000;
function dayNumber(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms / DAY_MS : null;
}
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const monthStart = (year: number, month: number) => isoOf(Date.UTC(year, month, 1) / DAY_MS); // month may run past 0..11
export const addDays = (iso: string, days: number) => { const n = dayNumber(iso); if (n === null) throw new RangeError('Not a date'); return isoOf(n + days); };
export const rangeDays = (range: PerformanceRange) => { const a = dayNumber(range.from), b = dayNumber(range.to); return a === null || b === null ? null : b - a; };

export const PERFORMANCE_PERIODS = ['this_month', 'last_month', 'last_3_months', 'this_year', 'custom'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];
export const PERIOD_LABEL: Record<PerformancePeriod, string> = {
  this_month: 'This month', last_month: 'Last month', last_3_months: 'Last 3 months', this_year: 'This year', custom: 'Choose dates',
};
// The dates of a period choice, for `today` (London's date, YYYY-MM-DD). "Last 3 months" is the three whole
// months before this one; "This year" is 1 January to 31 December.
export function periodRange(period: Exclude<PerformancePeriod, 'custom'>, today: string): PerformanceRange {
  if (dayNumber(today) === null) throw new RangeError('Today must be a date (YYYY-MM-DD)');
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1;
  if (period === 'this_month') return { from: monthStart(year, month), to: monthStart(year, month + 1) };
  if (period === 'last_month') return { from: monthStart(year, month - 1), to: monthStart(year, month) };
  if (period === 'last_3_months') return { from: monthStart(year, month - 3), to: monthStart(year, month) };
  return { from: monthStart(year, 0), to: monthStart(year + 1, 0) };
}
// Dates typed by hand: the first day and the last day, both included (the screen's words). Up to 366 days.
export function customRange(first: string, last: string): PerformanceRange | { error: string } {
  const a = dayNumber(first.trim()), b = dayNumber(last.trim());
  if (a === null || b === null) return { error: 'Enter both dates as YYYY-MM-DD, for example 2026-09-01.' };
  if (b < a) return { error: 'The last day must be on or after the first day.' };
  if (b + 1 - a > MAX_PERFORMANCE_DAYS) return { error: 'Choose up to 366 days.' };
  return { from: isoOf(a), to: isoOf(b + 1) };
}
// "1 Sep 2026 to 31 Oct 2026": the last day shown is the day before `to`.
export function rangeLabel(range: PerformanceRange): string {
  const a = dayNumber(range.from), b = dayNumber(range.to);
  if (a === null || b === null || b <= a) return '';
  const show = (day: number) => new Date(day * DAY_MS).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return b - a === 1 ? show(a) : `${show(a)} to ${show(b - 1)}`;
}

export type PerformanceFilters = { propertyId?: string | null; region?: string | null; channel?: PerformanceChannel | null };
// The query for readFinance: the report section, its dates and only the filters that are set.
export function performanceQuery(range: PerformanceRange, filters: PerformanceFilters = {}): Record<string, string> {
  const query: Record<string, string> = { section: 'performance', from: range.from, to: range.to };
  if (filters.propertyId) query.propertyId = filters.propertyId;
  if (filters.region?.trim()) query.region = filters.region.trim();
  if (filters.channel) query.channel = filters.channel;
  return query;
}
// The regions to filter by: each non-blank region once, in alphabetical order (case kept from the first seen).
// The region and channel filters as one dropdown each (they were rows of chips): the same values, "all" first.
export const ALL_FILTER = 'all';
export const regionFilterOptions = (regions: readonly string[]) => [{ value: ALL_FILTER, label: 'All regions' }, ...regions.map(r => ({ value: r, label: r }))];
const CHANNEL_NAME: Record<PerformanceChannel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other' };
export const CHANNEL_FILTER_OPTIONS: { value: PerformanceChannel | typeof ALL_FILTER; label: string }[] = [{ value: ALL_FILTER, label: 'All channels' }, ...PERFORMANCE_CHANNELS.map(c => ({ value: c, label: CHANNEL_NAME[c] }))];
// The last day a range includes (its `to` is the day after), for the date field.
export const lastDayOfRange = (r: PerformanceRange) => isoOf((dayNumber(r.to) ?? 0) - 1);
export function regionOptions(properties: readonly { region?: string | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const p of properties) { const r = p.region?.trim(); if (r && !seen.has(r.toLowerCase())) seen.set(r.toLowerCase(), r); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en-GB'));
}
// A month's heading: "2026-09" → "September 2026".
export const performanceMonthLabel = (period: string) => new Date(period + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Whether a figure set has anything in it, so an empty month or property can say so plainly.
export const hasActivity = (f: Pick<PerformanceFigures, 'statementCount' | 'nightsBooked' | 'cleanCount'>) => f.statementCount > 0 || f.nightsBooked > 0 || f.cleanCount > 0;
