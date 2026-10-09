import { z } from 'zod';
import { addMonths, daysInMonth } from './owner-reports';

// Owner Home by period: This month, Last month, This quarter (so far) and This year (so far), each
// compared with the period before it, like for like. Figures come month by month from the owner's
// statements: an issued statement's figures exactly, otherwise an estimate worked out the way
// Accounts prepare one. Booking income counts stays starting in the month, as statements do.
export const OWNER_PERIODS = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as const;
export type OwnerPeriod = (typeof OWNER_PERIODS)[number];
export const OWNER_PERIOD_LABEL: Record<OwnerPeriod, string> = { thisMonth: 'This month', lastMonth: 'Last month', thisQuarter: 'This quarter', thisYear: 'This year' };

const month = z.string().regex(/^\d{4}-\d{2}$/);
const nullableMinor = z.number().nullable();
export const ownerPeriodCellSchema = z.object({
  month, propertyId: z.string().uuid(), source: z.enum(['statement', 'estimate']), status: z.enum(['issued', 'paid']).nullable(), preparing: z.boolean(),
  revenueMinor: z.number(), bookings: z.number(), stayNights: z.number(), bookedNights: z.number(),
  cleaningCount: z.number(), cleaningMinor: nullableMinor, expensesMinor: z.number(), feeBps: z.number().nullable(), feeMinor: nullableMinor, payoutMinor: nullableMinor,
  missingAmounts: z.number(),
});
export type OwnerPeriodCell = z.infer<typeof ownerPeriodCellSchema>;
export const ownerPeriodsSchema = z.object({
  from: month, to: month,
  properties: z.array(z.object({ propertyId: z.string().uuid(), propertyName: z.string() })),
  months: z.array(ownerPeriodCellSchema),
});
export type OwnerPeriods = z.infer<typeof ownerPeriodsSchema>;

export type PeriodRange = { months: string[]; previous: string[]; versus: string };
// The months a period covers, and the months it is compared with. Periods still running are
// compared with the same number of months in the period before (October so far against July so far).
export function periodRange(period: OwnerPeriod, today: string): PeriodRange {
  const current = today.slice(0, 7);
  const run = (first: string, count: number) => Array.from({ length: count }, (_, i) => addMonths(first, i));
  if (period === 'thisMonth') return { months: [current], previous: [addMonths(current, -1)], versus: 'vs last month' };
  if (period === 'lastMonth') return { months: [addMonths(current, -1)], previous: [addMonths(current, -2)], versus: 'vs the month before' };
  const monthNumber = Number(current.slice(5, 7));
  if (period === 'thisQuarter') {
    const first = addMonths(current, -((monthNumber - 1) % 3)), count = (monthNumber - 1) % 3 + 1;
    return { months: run(first, count), previous: run(addMonths(first, -3), count), versus: count === 1 ? 'vs the first month of last quarter' : 'vs the same months last quarter' };
  }
  const first = current.slice(0, 4) + '-01';
  return { months: run(first, monthNumber), previous: run(addMonths(first, -12), monthNumber), versus: 'vs the same months last year' };
}
// One read covers both: from the earliest month to the latest.
export function readRange(range: PeriodRange) {
  const all = [...range.previous, ...range.months].sort();
  return { from: all[0] + '-01', to: all[all.length - 1] + '-01' };
}

export type PeriodBasis = 'issued' | 'mixed' | 'estimated' | 'empty';
export type PeriodSummary = {
  bookingIncomeMinor: number; cleaningCount: number; cleaningMinor: number | null; expensesMinor: number; feeMinor: number | null; payoutMinor: number | null;
  bookings: number; stayNights: number; bookedNights: number; availableNights: number; occupancy: number | null; averageNightlyMinor: number | null;
  basis: PeriodBasis; estimatedMonths: string[]; issuedMonths: string[]; preparingMonths: string[]; missingAmounts: number;
};
const sumOrNull = (cells: readonly OwnerPeriodCell[], key: 'cleaningMinor' | 'feeMinor' | 'payoutMinor') =>
  cells.some(c => c[key] === null) ? null : cells.reduce((n, c) => n + (c[key] ?? 0), 0);
// The period's figures, from its months (optionally one property). A month counts as issued only
// when every property's statement for it is issued; otherwise it is estimated.
export function summarisePeriod(cells: readonly OwnerPeriodCell[], months: readonly string[], propertyCount: number, propertyId?: string): PeriodSummary {
  const mine = cells.filter(c => months.includes(c.month) && (!propertyId || c.propertyId === propertyId));
  const income = mine.reduce((n, c) => n + c.revenueMinor, 0), stayNights = mine.reduce((n, c) => n + c.stayNights, 0);
  const bookedNights = mine.reduce((n, c) => n + c.bookedNights, 0);
  const availableNights = (propertyId ? 1 : propertyCount) * months.reduce((n, m) => n + daysInMonth(m), 0);
  const monthsWith = (test: (c: OwnerPeriodCell) => boolean) => months.filter(m => mine.some(c => c.month === m && test(c)));
  const estimatedMonths = monthsWith(c => c.source === 'estimate'), issuedMonths = months.filter(m => mine.some(c => c.month === m) && !estimatedMonths.includes(m));
  return {
    bookingIncomeMinor: income, cleaningCount: mine.reduce((n, c) => n + c.cleaningCount, 0), cleaningMinor: sumOrNull(mine, 'cleaningMinor'),
    expensesMinor: mine.reduce((n, c) => n + c.expensesMinor, 0), feeMinor: sumOrNull(mine, 'feeMinor'), payoutMinor: sumOrNull(mine, 'payoutMinor'),
    bookings: mine.reduce((n, c) => n + c.bookings, 0), stayNights, bookedNights, availableNights,
    occupancy: availableNights ? Math.min(1, bookedNights / availableNights) : null,
    averageNightlyMinor: stayNights ? Math.round(income / stayNights) : null,
    basis: !mine.length ? 'empty' : !estimatedMonths.length ? 'issued' : !issuedMonths.length ? 'estimated' : 'mixed',
    estimatedMonths, issuedMonths, preparingMonths: monthsWith(c => c.preparing), missingAmounts: mine.reduce((n, c) => n + c.missingAmounts, 0),
  };
}

// Change against the period before, as a whole percentage. Nothing to compare with gives null.
export type Change = { direction: 'up' | 'down' | 'flat'; percent: number };
export function changeOf(current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null || previous === 0) return null;
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return { direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat', percent: Math.abs(percent) };
}
export const changeLabel = (change: Change | null) => !change ? null : change.direction === 'flat' ? 'No change' : `${change.direction === 'up' ? '↑' : '↓'} ${change.percent}%`;
