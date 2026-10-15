import { z } from 'zod';
import { formatCount, formatMoney, formatMoneyShort } from './format';
import { isWorkspaceAdmin } from './modules';
import { formatOccupancy, periodRange, type PerformanceFigures, type PerformanceRange } from './performance';
import { reportAnchor, type EnquiriesReport } from './business-reports-view';
import type { NeedOpen } from './home-needs';

// "This month" on the admins' Home (Lee: Alex is the business owner, so his Home is the whole business at a glance):
// eight figures, each with a short label and, where it means something, a quiet change against last month. Every figure
// comes from a read the app already makes, and each opens the page where its detail lives:
// * Bookings value, occupancy and average nightly rate: the Performance report for this calendar month (Accounts →
//   Performance opens on the same dates), against last month's. Bookings value is the value as booked
//   (bookedValueMinor, 20261020910000): every stay with nights in the month, settled or not, so this month and last
//   are counted alike and the change line is fair. Nights booked is in occupancy's detail.
// * Guest replies on time: the share of guest replies within the green target this month so far, against the same
//   days of last month, in points (workspace_guest_reply_glance, 20261020910000, the rules of the Messages report and
//   Team performance). It took the place of nights booked, which occupancy's detail already gives.
// * Management fees: the same report for last month, as fees come from statements issued after a month ends.
// * Properties live (and onboarding): the property list Home already has (Properties shows the same count).
// * New enquiries: the enquiries Business report for the 1st of this month to today, against the same days of last
//   month (Reports → Business reports, with those dates).
// * Payouts overdue: management's overview (payoutsToReconcile, 20261020900000): Airbnb, Booking.com and Vrbo stays
//   whose payout is past its expected date and still missing or different (Accounts → Reconciliation). It took the
//   place of repair spend, the figure Alex is least likely to act on from Home (it was £0 most days).
// A figure that can't load shows a quiet "–", never an error.

export type FigureKey = 'bookings' | 'occupancy' | 'rate' | 'replies' | 'fees' | 'properties' | 'enquiries' | 'payouts';
export type FigureChange = { direction: 'up' | 'down' | 'same'; text: string; spoken: string };
export type BusinessFigure = { key: FigureKey; label: string; value: string; detail: string; zero: boolean; missing: boolean; change: FigureChange | null; open: NeedOpen };
const replyWindow = z.object({
  from: z.string(), to: z.string(), replies: z.number().int().min(0), onTime: z.number().int().min(0),
  onTimeBps: z.number().int().min(0).max(10000).nullable(), medianMinutes: z.number().min(0).nullable(),
});
export const guestReplyGlanceSchema = z.object({ greenMinutes: z.number().int().nullable(), amberMinutes: z.number().int().nullable(), thisMonth: replyWindow, lastMonth: replyWindow });
export type GuestReplyGlance = z.infer<typeof guestReplyGlanceSchema>;
export type OverviewData = {
  month: PerformanceFigures | null; lastMonth: PerformanceFigures | null;
  booked: number | null; bookedBefore: number | null;
  replies: GuestReplyGlance | null;
  enquiries: EnquiriesReport | null; enquiriesBefore: EnquiriesReport | null;
  payoutsOverdue: number | null;
  portfolio: { live: number; onboarding: number } | null;
};
export const EMPTY_OVERVIEW: OverviewData = { month: null, lastMonth: null, booked: null, bookedBefore: null, replies: null, enquiries: null, enquiriesBefore: null, payoutsOverdue: null, portfolio: null };
export const MISSING = '–';

// Only admins and super admins see the business figures; everyone else's Home is unchanged.
export const showsBusiness = (role: string) => isWorkspaceAdmin(role);

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
const monthShort = (iso: string) => new Date(iso.slice(0, 7) + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const monthLong = (iso: string) => new Date(iso.slice(0, 7) + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

// The dates each read asks for, for `today` (London's date). The Performance report's `to` is the day after; the
// Business reports' `to` is the last day itself. "The same days of last month" stop at its last day (31 March → 28 February).
export function overviewRanges(today: string) {
  const month = periodRange('this_month', today), lastMonth = periodRange('last_month', today);
  const lastDayBefore = shift(lastMonth.to, -1);
  const sameDay = shift(lastMonth.from, Number(today.slice(8, 10)) - 1);
  return {
    month, lastMonth,
    soFar: { from: month.from, to: today },
    sameDaysBefore: { from: lastMonth.from, to: sameDay < lastDayBefore ? sameDay : lastDayBefore },
    thisMonthName: monthShort(today), lastMonthName: monthShort(lastMonth.from), lastMonthLong: monthLong(lastMonth.from),
  };
}
export const performanceRangeQuery = (range: PerformanceRange) => ({ section: 'performance', from: range.from, to: range.to });

// ▲ 12% / ▼ 3% against last month; nothing when there is nothing to compare with.
// `against` is the short month ("Sep"); `spokenAgainst` says what was compared, for screen readers.
function percentChange(now: number | null | undefined, before: number | null | undefined, against: string, spokenAgainst = against): FigureChange | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { direction: 'same', text: `Same as ${against}`, spoken: `the same as ${spokenAgainst}` };
  const up = pct > 0;
  return { direction: up ? 'up' : 'down', text: `${up ? '▲' : '▼'} ${Math.abs(pct)}% vs ${against}`, spoken: `${up ? 'up' : 'down'} ${Math.abs(pct)}% on ${spokenAgainst}` };
}
// Occupancy and replies on time move in percentage points: ▲ 4.2 pts.
function pointsChange(now: number | null | undefined, before: number | null | undefined, against: string, spokenAgainst = against): FigureChange | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return null;
  const tenths = Math.round((now - before) / 10);
  if (tenths === 0) return { direction: 'same', text: `Same as ${against}`, spoken: `the same as ${spokenAgainst}` };
  const up = tenths > 0, pts = (Math.abs(tenths) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });
  return { direction: up ? 'up' : 'down', text: `${up ? '▲' : '▼'} ${pts} pts vs ${against}`, spoken: `${up ? 'up' : 'down'} ${pts} points on ${spokenAgainst}` };
}
// A share in basis points as a whole percentage: 9230 → "92%".
export const formatShare = (bps: number) => `${Math.round(bps / 100)}%`;

const PERFORMANCE: NeedOpen = { kind: 'work', view: 'accounts', sub: 'performance' };
const RECONCILE: NeedOpen = { kind: 'work', view: 'accounts', sub: 'payouts' };
const ENQUIRIES: NeedOpen = { kind: 'tab', tab: 'enquiries' };
// Reports → Business reports → Messages, for this month so far.
const MESSAGES: NeedOpen = { kind: 'tab', tab: 'analytics', anchor: reportAnchor('messages') };
const PROPERTIES: NeedOpen = { kind: 'page', section: 'properties' };

// The eight figures, in reading order: money and occupancy first, then the pipeline and spend. Each detail fits one
// line of a phone tile (about 20 characters).
export function businessFigures(d: OverviewData, today: string): BusinessFigure[] {
  const r = overviewRanges(today);
  const m = d.month, l = d.lastMonth, vs = r.lastMonthName;
  const figure = (key: FigureKey, label: string, value: number | null | undefined, show: (v: number) => string, detail: string, change: FigureChange | null, open: NeedOpen): BusinessFigure => {
    const missing = value == null || !Number.isFinite(value);
    return { key, label, value: missing ? MISSING : show(value), detail, zero: !missing && value === 0, missing, change: missing ? null : change, open };
  };
  const enquiries = d.enquiries?.received;
  const replies = d.replies?.thisMonth, green = d.replies?.greenMinutes;
  const repliesDetail = replies?.replies === 0 ? 'No replies yet' : green ? `within ${formatCount(green)} min` : 'Within the target';
  return [
    figure('bookings', 'Bookings value', d.booked, formatMoneyShort, 'Booked this month', percentChange(d.booked, d.bookedBefore, vs), PERFORMANCE),
    figure('occupancy', 'Occupancy', m?.occupancyBps, v => formatOccupancy(v), m ? `${formatCount(m.nightsBooked)} of ${formatCount(m.nightsAvailable)} nights` : 'Booked of available',
      pointsChange(m?.occupancyBps, l?.occupancyBps, vs), PERFORMANCE),
    figure('rate', 'Average nightly rate', m?.averageNightlyRateMinor, formatMoney, 'Priced nights only', percentChange(m?.averageNightlyRateMinor, l?.averageNightlyRateMinor, vs), PERFORMANCE),
    figure('replies', 'Guest replies on time', replies?.onTimeBps, formatShare, repliesDetail,
      pointsChange(replies?.onTimeBps, d.replies?.lastMonth.onTimeBps, vs, `the same days of ${vs}`), MESSAGES),
    figure('fees', 'Management fees', l?.managementFeeMinor, formatMoneyShort, `Issued for ${r.lastMonthLong}`, null, PERFORMANCE),
    figure('properties', 'Properties live', d.portfolio?.live, formatCount, d.portfolio ? (d.portfolio.onboarding ? `${formatCount(d.portfolio.onboarding)} onboarding` : 'None onboarding') : 'Live with Recharge', null, PROPERTIES),
    figure('enquiries', 'New enquiries', enquiries, formatCount, 'So far this month', percentChange(enquiries, d.enquiriesBefore?.received, vs, `the same days of ${vs}`), ENQUIRIES),
    figure('payouts', 'Payouts overdue', d.payoutsOverdue, formatCount, d.payoutsOverdue === 0 ? 'All in on time' : 'Past their pay date', null, RECONCILE),
  ];
}

// The words for one figure, for screen readers and tests: "Occupancy: 64.2%, up 4.2 points on Sep. Open".
export const figureText = (f: Pick<BusinessFigure, 'label' | 'value' | 'missing' | 'change'>) => `${f.label}: ${f.missing ? 'not available' : f.value}${f.change ? `, ${f.change.spoken}` : ''}`;

// "Needs your attention" on the admins' Home: the first six, then "See all (n)" opens the rest in place.
export const ATTENTION_SHOWN = 6;
export const shownNeeds = <T>(lines: readonly T[], expanded: boolean, limit = ATTENTION_SHOWN) => (expanded ? [...lines] : lines.slice(0, limit));
export const seeAllLabel = (total: number, limit = ATTENTION_SHOWN) => (total > limit ? `See all (${formatCount(total)})` : null);
