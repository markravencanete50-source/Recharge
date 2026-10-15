import { z } from 'zod';
import { sectionAnchor } from './home-tools';
import { formatCount, formatMoneyShort } from './format';
import { formatShare, MISSING, type BusinessFigure } from './home-overview';
import type { NeedOpen } from './home-needs';
import type { PeriodSummary } from './owner-periods';

// Each role's Home (Lee: what we applied for the super admin, applied to every role, with what each role needs to
// see). The same layout as management's: "This month" (here "At a glance": a role's figures mix today, this week and
// this month), then "Needs you now". The counts come from one read, workspace_role_home (20261021300000), which works
// them out only from what the person's role may open; owners' come from the reads their Home already makes. This file
// reads the answer and builds the figure tiles; the "Needs you now" lines are in lib/home-needs.ts.
export const ROLE_HOME_ROLES = ['stays', 'cleaning_manager', 'cleans', 'ready', 'accounts'] as const;
export type RoleHomeRole = (typeof ROLE_HOME_ROLES)[number];
export const hasRoleHome = (role: string): role is RoleHomeRole => (ROLE_HOME_ROLES as readonly string[]).includes(role);

// A count the read may leave out (the role lacks that tool): null or missing, and the line or tile is left out.
const count = z.number().int().min(0).nullable().optional();
const money = z.number().int().nullable().optional();
export const roleHomeSchema = z.object({
  role: z.string(), today: z.string(), weekStart: z.string(), month: z.string(),
  // Guest relations.
  guestsWaiting: count, enquiriesToValue: count, cleansToReview: count, repairsToRefer: count, listingsToCheck: count, relistingsOpen: count, emptyNights: count,
  checkInsToday: count, checkInsTomorrow: count, checkOutsToday: count, cleansToday: count, cleansDoneToday: count, openRepairs: count,
  // Cleaning managers and cleaners.
  unassignedToday: count, unassignedTomorrow: count, toReview: count, disputes: count, complaintsThisMonth: count, cleansThisWeek: count, restockOpen: count,
  reviewedFirst: count, acceptedFirst: count, overdue: count, redo: count, toRespond: count, doneThisMonth: count,
  // Ready.
  newJobs: count, approvedToBook: count, repairsToday: count, toMarkDone: count, openJobs: count, repairsThisWeek: count, repairsDoneThisMonth: count,
  visitsToday: count, visitsOverdue: count, visitsThisWeek: count, visitsDoneThisMonth: count,
  // Accounts (money in pence, for the finance roles only).
  expensesToApprove: count, payoutsOverdue: count, statementsToIssue: count, cleanerInvoicesToApprove: count, purchasesToApprove: count, purchaseInvoicesToRecord: count,
  payoutsReceivedMinor: money, expensesMinor: money, expensesCount: count, statementsIssued: count, ownerPayoutsMinor: money,
});
export type RoleHome = z.infer<typeof roleHomeSchema>;
export const roleHomeQuery = (role: RoleHomeRole) => ({ section: 'roleHome', role });

export type RoleFigure = Omit<BusinessFigure, 'key'> & { key: string };
const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);
// One tile: a number shown its own way, or a word (a date), with a short detail that fits a phone tile.
function figure(key: string, label: string, value: number | null | undefined, show: (v: number) => string, detail: string, open: NeedOpen): RoleFigure {
  const v = n(value);
  return { key, label, value: v === null ? MISSING : show(v), detail, zero: v === 0, missing: v === null, change: null, open };
}
function wordFigure(key: string, label: string, value: string | null, detail: string, open: NeedOpen): RoleFigure {
  return { key, label, value: value ?? MISSING, detail, zero: false, missing: value === null, change: null, open };
}
const sum = (...values: (number | null | undefined)[]) => values.every(v => n(v) === null) ? null : values.reduce<number>((t, v) => t + (n(v) ?? 0), 0);
// "Accepted first time": the share of cleans whose first review this month passed. Nothing reviewed yet: no share.
function firstTime(h: RoleHome, open: NeedOpen): RoleFigure {
  const reviewed = n(h.reviewedFirst), accepted = n(h.acceptedFirst);
  const bps = reviewed ? Math.round(((accepted ?? 0) / reviewed) * 10000) : null;
  return { key: 'firstTime', label: 'Accepted first time', value: bps === null ? MISSING : formatShare(bps), detail: reviewed ? `${formatCount(accepted ?? 0)} of ${formatCount(reviewed)} this month` : 'No reviews yet this month',
    zero: false, missing: bps === null, change: null, open };
}

const work = (view: 'stays' | 'clients' | 'cleans' | 'repairs' | 'accounts', extra: { sub?: string; section?: string } = {}): NeedOpen =>
  ({ kind: 'work', view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : {}) });
const CLEANS = work('cleans', { section: 'Schedule' });
const REPAIRS = work('repairs', { section: 'Reactive maintenance' });
const CALENDAR: NeedOpen = { kind: 'page', section: 'calendar' };

// The tiles for each role, in reading order: today first, then the week and the month. Nothing about money outside
// Accounts, and nothing business-wide: every figure is the person's own properties or work.
export function roleFigures(h: RoleHome, extra: { payLabel?: string | null; payDetail?: string } = {}): RoleFigure[] {
  if (h.role === 'stays') return [
    figure('checkIns', 'Check-ins today', h.checkInsToday, formatCount, h.checkInsTomorrow != null ? `${formatCount(h.checkInsTomorrow)} tomorrow` : 'At your properties', CALENDAR),
    figure('checkOuts', 'Check-outs today', h.checkOutsToday, formatCount, 'At your properties', CALENDAR),
    figure('cleans', 'Cleans done today', h.cleansDoneToday, formatCount, h.cleansToday != null ? `of ${formatCount(h.cleansToday)} today` : 'Today', work('cleans')),
    figure('repairs', 'Open repairs', h.openRepairs, formatCount, 'At your properties', REPAIRS),
  ];
  if (h.role === 'cleaning_manager') return [
    figure('today', 'Cleans done today', h.cleansDoneToday, formatCount, h.cleansToday != null ? `of ${formatCount(h.cleansToday)} today` : 'Today', CLEANS),
    figure('week', 'Cleans this week', h.cleansThisWeek, formatCount, 'Monday to Sunday', CLEANS),
    firstTime(h, work('cleans', { section: 'Cleaner performance this month' })),
    figure('complaints', 'Complaints', h.complaintsThisMonth, formatCount, 'This month', work('cleans', { section: 'Disputes to decide' })),
  ];
  if (h.role === 'cleans') return [
    figure('done', 'Cleans done', h.doneThisMonth, formatCount, 'This month', work('cleans', { section: 'Your month' })),
    wordFigure('pay', 'Pay this month', extra.payLabel ?? null, extra.payDetail ?? 'At your rate per clean', work('cleans', { section: 'Your month' })),
    firstTime(h, work('cleans', { section: 'Your month' })),
    figure('week', 'Cleans this week', h.cleansThisWeek, formatCount, 'Monday to Sunday', CLEANS),
  ];
  if (h.role === 'ready') return [
    figure('open', 'Open jobs', h.openJobs, formatCount, 'Repairs with you', REPAIRS),
    figure('week', 'Visits this week', sum(h.repairsThisWeek, h.visitsThisWeek), formatCount, 'Repairs and routine visits', CALENDAR),
    figure('done', 'Done this month', sum(h.repairsDoneThisMonth, h.visitsDoneThisMonth), formatCount, 'Repairs and routine visits', REPAIRS),
  ];
  if (h.role === 'accounts') return [
    figure('payouts', 'Payouts received', h.payoutsReceivedMinor, formatMoneyShort, 'Paid this month', work('accounts', { sub: 'payouts' })),
    figure('expenses', 'Expenses', h.expensesMinor, formatMoneyShort, h.expensesCount != null ? `${formatCount(h.expensesCount)} received this month` : 'Received this month', work('accounts', { sub: 'expenses' })),
    figure('issued', 'Statements issued', h.statementsIssued, formatCount, 'This month', work('accounts', { sub: 'statements' })),
    figure('ownerPayouts', 'Paid to owners', h.ownerPayoutsMinor, formatMoneyShort, 'This month', work('accounts', { sub: 'statements' })),
  ];
  return [];
}

// Owners: their own figures for this month from their statements (an issued statement exactly, otherwise an estimate,
// as their Reports work it out), and their next 30 days of bookings. Never anything about other owners' properties.
export type OwnerUpcoming = { nights: number; next: { checkIn: string; propertyName: string } | null };
const shortDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const STAYS_TAB: NeedOpen = { kind: 'tab', tab: 'analytics' };
export function ownerFigures(month: PeriodSummary | null, upcoming: OwnerUpcoming | null): RoleFigure[] {
  const basis = month?.basis === 'issued' ? 'From your statement' : 'Estimated so far';
  return [
    figure('earnings', 'Earnings', month?.bookingIncomeMinor, formatMoneyShort, month ? basis : 'This month', STAYS_TAB),
    figure('payout', 'Your payout', month?.payoutMinor, formatMoneyShort, 'After fees and costs', STAYS_TAB),
    figure('occupancy', 'Occupancy', month?.occupancy == null ? null : Math.round(month.occupancy * 1000) / 10, v => `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`,
      month ? `${formatCount(month.bookedNights)} of ${formatCount(month.availableNights)} nights` : 'This month', STAYS_TAB),
    wordFigure('next', 'Next check-in', upcoming ? (upcoming.next ? shortDay(upcoming.next.checkIn) : 'None booked') : null, upcoming?.next?.propertyName ?? 'Next 30 days', STAYS_TAB),
    figure('nights', 'Nights booked', upcoming?.nights, formatCount, 'Next 30 days', STAYS_TAB),
  ];
}

// The owner's next 30 days from their bookings: nights booked inside the window, and the first arrival from today.
export function ownerUpcoming(stays: readonly { checkIn: string; checkOut: string; propertyName: string }[], today: string, days = 30): OwnerUpcoming {
  const DAY = 86_400_000, start = Date.parse(today + 'T00:00:00Z'), end = start + days * DAY;
  let nights = 0;
  for (const s of stays) {
    const from = Math.max(start, Date.parse(s.checkIn + 'T00:00:00Z')), to = Math.min(end, Date.parse(s.checkOut + 'T00:00:00Z'));
    if (to > from) nights += Math.round((to - from) / DAY);
  }
  const next = [...stays].filter(s => s.checkIn >= today).sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.propertyName.localeCompare(b.propertyName))[0];
  return { nights, next: next ? { checkIn: next.checkIn, propertyName: next.propertyName } : null };
}
