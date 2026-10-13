import { formatBps, formatCount, formatDay, formatMoney, plural } from './format';
import { isFinanceRole, monthLabel, statementMoves, STATEMENT_LINE_KINDS, type Statement, type StatementLineView, type StatementPreview } from './accounts-live';
import { addressOf, nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerForm } from './tracker-sections';
import type { FinanceAction } from './workspace-finance-policy';
import type { Detail } from './work-details';

// Owner statements as tracker items, and the pure rules behind the Statements screen. One row is one
// statement for one property: Reconciled, Cleans reviewed, Prepared, Issued, Paid. A property with no
// statement yet for the month is a row too ("Not prepared"), so Accounts can see what is left to do.
//
// Dates: a statement runs from `from` to `to`, and `to` is the first day NOT included (the database and
// prepareStatement read it as daterange(from, to)). People think of the last day included, so the screen
// asks for that (`lastDay`) and this file turns it into `to` in exactly one place: customRange.
//
// Owners never see staff names, the internal flags, what a clean really cost, or the Reconciled and
// Cleans reviewed steps (the checks Accounts make before a statement exists).
export const STATEMENT_SECTION: TrackerItem['section'] = 'statements';

// ---------------------------------------------------------------------------------------------------------
// Periods

const DAY_MS = 86_400_000;
const parseDay = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time;
};
export const shiftDay = (iso: string, by: number) => new Date(Date.parse(iso + 'T00:00:00Z') + by * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);

// A period as the screen holds it. `to` is the first day not included; `lastDay` is the day before it.
// month is 'YYYY-MM' when the period is exactly one calendar month, otherwise null.
export type StatementRange = { from: string; to: string; lastDay: string; days: number; month: string | null };

function rangeOf(from: string, to: string): StatementRange {
  const month = from.endsWith('-01') && to === nextMonthStart(from.slice(0, 7)) ? from.slice(0, 7) : null;
  return { from, to, lastDay: shiftDay(to, -1), days: daysBetween(from, to), month };
}
function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
// Two real dates, `to` after `from` and not included: the range between them (null when they are not).
export function rangeFromDates(from: string, to: string): StatementRange | null {
  const start = parseDay(from.slice(0, 10)), end = parseDay(to.slice(0, 10));
  return start === null || end === null || end <= start ? null : rangeOf(from.slice(0, 10), to.slice(0, 10));
}
// A calendar month: 'YYYY-MM' (null when it is not one).
export function monthRange(month: string): StatementRange | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? rangeOf(month + '-01', nextMonthStart(month)) : null;
}
// Dates chosen on the calendar (first and last day, both included). A whole calendar month is the page's month, as the old
// month chips were (it moves the page when the page lets it); any other dates are custom and go through customRange, so
// the request is the same as before: `from` and the day after the last day.
export function pickStatementDates(next: { from: string; to: string }, period: string, movesPage: boolean): { month: string } | { custom: { from: string; last: string } } {
  const whole = monthRange(next.from.slice(0, 7));
  if (whole && whole.from === next.from && whole.lastDay === next.to && (movesPage || whole.month === period)) return { month: whole.month! };
  return { custom: { from: next.from, last: next.to } };
}
// Custom dates as typed: the first day and the LAST day included (both YYYY-MM-DD). The range sent to the
// database ends the day after, because `to` is not included. `today` is today's date in London.
export function customRange(fromText: string, lastDayText: string, today: string): StatementRange | { error: string } {
  const from = fromText.trim(), last = lastDayText.trim(), start = parseDay(from), end = parseDay(last);
  if (start === null) return { error: 'Enter the first day as year-month-day, for example 2026-11-01.' };
  if (end === null) return { error: 'Enter the last day as year-month-day, for example 2026-11-30.' };
  if (from < '2000-01-01' || last > '2100-12-31') return { error: 'Choose dates between the years 2000 and 2100.' };
  if (end < start) return { error: 'The last day must be on or after the first day.' };
  if (from > today) return { error: 'A statement covers days that have started. Choose a first day that is today or earlier.' };
  const range = rangeOf(from, shiftDay(last, 1));
  if (range.days > 366) return { error: 'A statement covers up to 366 days.' };
  return range;
}

const dayOnly = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const londonYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' });
const at = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z');

// "November 2026" for a whole calendar month, otherwise "1 Nov to 30 Nov" (the last day included). Years
// are added when the dates are not both in the current year.
export function periodTitle(period: { periodStart?: string | null; periodEnd?: string | null; period?: string | null }, now: Date = new Date()): string {
  const start = period.periodStart, end = period.periodEnd;
  if (start && end && parseDay(start.slice(0, 10)) !== null && parseDay(end.slice(0, 10)) !== null) {
    const range = rangeOf(start.slice(0, 10), end.slice(0, 10));
    if (range.month) return monthLabel(range.month);
    const thisYear = londonYear.format(now), plain = start.slice(0, 4) === thisYear && range.lastDay.slice(0, 4) === thisYear;
    const show = (iso: string) => (plain ? dayOnly : dayYear).format(at(iso));
    return `${show(range.from)} to ${show(range.lastDay)}`;
  }
  return period.period && /^\d{4}-\d{2}$/.test(period.period) ? monthLabel(period.period) : 'Statement';
}

export const STATEMENT_METHOD_LABEL: Record<string, string> = {
  nights: 'Each stay is shared by the nights that fall in the period',
  check_in_month: 'Each stay counts in full in the period it checks in',
};

// The request that checks a period (a 'statementPreview' report) and the action that prepares it. Neither names
// how stays are counted once a statement is held for the dates: the database then keeps that statement's own
// method (an old monthly draft counts stays by check-in) for both, so the figures you checked are the figures
// that get prepared. A new statement shares stays by nights (STATEMENT_METHOD, the database default too). A whole
// month is sent as the month; other dates as from and to (`to` not included).
export const STATEMENT_METHOD = 'nights' as const;
export function previewQuery(propertyId: string, range: StatementRange): Record<string, string> {
  return { section: 'statementPreview', propertyId, from: range.from, to: range.to };
}
export type PrepareStatement = Omit<Extract<FinanceAction, { action: 'prepareStatement' }>, 'requestId'>;
// existing: the statement already held for these dates, if any (preparing it again keeps its method).
export function prepareAction(propertyId: string, range: StatementRange, existing?: { id: string } | null): PrepareStatement {
  const method = existing ? {} : { method: STATEMENT_METHOD };
  return range.month
    ? { action: 'prepareStatement', propertyId, period: range.month, ...method }
    : { action: 'prepareStatement', propertyId, from: range.from, to: range.to, ...method };
}
// Two checks are the same check when they ask for the same property, dates and method.
export const previewKey = (propertyId: string, range: StatementRange) => [propertyId, range.from, range.to, STATEMENT_METHOD].join('|');

// ---------------------------------------------------------------------------------------------------------
// Why a period cannot be prepared yet, in plain words

export type BlockReason = { kind: 'stays' | 'cleans' | 'other'; count: number; text: string; pointer: string; link: 'payouts' | 'cleans' | null };
const countOf = (reasons: readonly string[], prefix: string) => reasons.filter(r => r.startsWith(prefix + ':')).length;
// The blocking reasons of a preview (statementPreview.blockedReasons). One entry per kind, with the count.
export function blockReasons(reasons: readonly string[]): BlockReason[] {
  const out: BlockReason[] = [];
  const stays = countOf(reasons, 'stay_unsettled'), cleans = countOf(reasons, 'clean_unreviewed'), other = reasons.length - stays - cleans;
  if (stays) out.push({
    kind: 'stays', count: stays, link: 'payouts',
    text: stays === 1 ? '1 stay is waiting for its payout' : `${formatCount(stays)} stays are waiting for their payout`,
    pointer: 'Reconcile ' + (stays === 1 ? 'it' : 'them') + ' under Reconciliation first.',
  });
  if (cleans) out.push({
    kind: 'cleans', count: cleans, link: 'cleans',
    text: cleans === 1 ? '1 clean cost more than the owner is charged: review it' : `${formatCount(cleans)} cleans cost more than the owner is charged: review them`,
    pointer: 'Decide what the owner pays under Cleans to review in Payable.',
  });
  if (other > 0) out.push({ kind: 'other', count: other, link: null, text: 'Something else needs attention before this can be prepared', pointer: 'Refresh and check again.' });
  return out;
}

// Things worth a look that do not stop a statement. Finance staff only.
export function flagNotes(flags: readonly string[], blockedReasons: readonly string[] = [], lateMoneyCount = 0): string[] {
  const notes: string[] = [];
  const unknownFee = countOf(flags, 'ota_fee_unknown'), over = countOf(flags, 'clean_over_agreed') - countOf(blockedReasons, 'clean_unreviewed');
  const noCost = countOf(flags, 'clean_cost_unknown'), ownerAmount = countOf(flags, 'owner_stay_amount_ignored');
  if (unknownFee) notes.push(unknownFee === 1 ? 'A platform stay has no fee on its payout, so no platform fee is taken off for it.' : `${formatCount(unknownFee)} platform stays have no fee on their payout, so no platform fee is taken off for them.`);
  if (over > 0) notes.push(over === 1 ? '1 clean\'s invoice is above the agreed fee. The owner still pays the agreed fee; review it under clean costs.' : `${formatCount(over)} cleans' invoices are above the agreed fee. The owner still pays the agreed fee; review them under clean costs.`);
  const levyNoClean = countOf(flags, 'levy_cleaning_fee_unknown');
  if (levyNoClean) notes.push(levyNoClean === 1 ? 'A platform stay has no cleaning fee on its payout, so its visitor levy is worked out on the whole amount.' : `${formatCount(levyNoClean)} platform stays have no cleaning fee on their payout, so their visitor levy is worked out on the whole amount.`);
  if (noCost) notes.push(noCost === 1 ? '1 clean is charged at actual cost but has no cost on record, so the agreed fee is used.' : `${formatCount(noCost)} cleans are charged at actual cost but have no cost on record, so the agreed fee is used.`);
  if (ownerAmount) notes.push('An owner stay has an amount on it. Owner stays count as nights booked only.');
  const changed = countOf(flags, 'stay_changed_after_statement');
  if (changed) notes.push(changed === 1 ? '1 stay has changed since its first statement was issued. A stay that was cancelled takes no share in this one.' : `${formatCount(changed)} stays have changed since their first statement was issued. A stay that was cancelled takes no share in this one.`);
  if (lateMoneyCount) notes.push(lateMoneyCount === 1 ? '1 stay was paid a different amount after its statement was issued. That money is on no statement yet, so check it with the payouts.' : `${formatCount(lateMoneyCount)} stays were paid a different amount after their statement was issued. That money is on no statement yet, so check it with the payouts.`);
  if (flags.includes('nights_exceed_period')) notes.push('More nights are booked than the period has. Check for overlapping stays.');
  return notes;
}

// ---------------------------------------------------------------------------------------------------------
// The figures, in the order they come off

const LINE_TITLE: Record<(typeof STATEMENT_LINE_KINDS)[number], string> = {
  ota_fee: 'Platform fees', visitor_levy: 'Visitor levy', changeover: 'Changeovers', management_fee: 'Management fee', vat: 'VAT', payable: 'Other payables',
};
export type LineGroup = { kind: (typeof STATEMENT_LINE_KINDS)[number]; title: string; totalMinor: number; lines: { label: string; when: string | null; amountMinor: number }[] };
// The lines grouped in the order they come off (platform fees, changeovers, management fee, VAT, other payables),
// each group in date order as the database sent it. Empty groups are left out.
export function lineGroups(lines: readonly StatementLineView[], now: Date = new Date()): LineGroup[] {
  const when = (line: StatementLineView): string | null => {
    if (!line.date || (line.kind !== 'ota_fee' && line.kind !== 'visitor_levy' && line.kind !== 'changeover' && line.kind !== 'payable')) return null;
    const day = line.date.slice(0, 10);
    return parseDay(day) === null ? null : (day.slice(0, 4) === londonYear.format(now) ? dayOnly : dayYear).format(at(day));
  };
  return STATEMENT_LINE_KINDS.map(kind => {
    const mine = lines.filter(l => l.kind === kind);
    return { kind, title: LINE_TITLE[kind], totalMinor: mine.reduce((sum, l) => sum + l.amountMinor, 0), lines: mine.map(l => ({ label: l.label, when: when(l), amountMinor: l.amountMinor })) };
  }).filter(group => group.lines.length > 0);
}

// Occupancy as the database writes it: nights booked over nights in the period, in hundredths of a percent.
export const occupancyBps = (booked: number | null | undefined, available: number | null | undefined): number | null =>
  booked == null || !available || available <= 0 ? null : Math.round((booked * 10000) / available);
export const occupancyText = (booked: number | null | undefined, available: number | null | undefined): string => {
  const bps = occupancyBps(booked, available);
  return bps === null || booked == null || available == null ? 'Not known' : `${formatBps(bps)} occupancy, ${formatCount(booked)} of ${plural(available, 'night')} booked`;
};

export const CLEAN_MODE_LABEL: Record<string, string> = { agreed_fee: 'Agreed fee', actual_cost: 'Actual cost' };
const vatRateText = (bps: number | null | undefined) => formatBps(bps ?? 2000);

export type SummaryRow = { key: string; label: string; value: string; note?: string; strong?: boolean };
export type PreviewSummary = {
  occupancy: string; rows: SummaryRow[]; payout: SummaryRow;
  // Reasons the figures cannot be trusted, empty when they add up. A screen refuses to prepare while there are any.
  problems: string[];
};
const deduct = (minor: number) => formatMoney(-minor);

// The checked figures as rows, gross first, then each deduction in order, then the payout. VAT shows only when the
// property charges it. The figures are checked against each other: gross less every deduction must be the payout, and the
// itemised lines must add up to each deduction. Anything that does not is returned in `problems`, never smoothed over.
export function previewSummary(p: StatementPreview): PreviewSummary {
  const terms = p.terms, owes = p.payoutMinor < 0, levy = p.visitorLevyMinor ?? 0;
  const levyTerms = (terms as { visitorLevy?: { enabled?: boolean; rateBps?: number; nightCap?: number | null; feeAfterLevy?: boolean } | null }).visitorLevy ?? null;
  const levyShown = levy !== 0 || levyTerms?.enabled === true;
  const levyNote = levyTerms?.nightCap ? `For the first ${plural(levyTerms.nightCap, 'night')} of each stay, on the accommodation without the cleaning fee` : 'On the accommodation without the cleaning fee';
  const feeAfterLevy = levy !== 0 && levyTerms?.feeAfterLevy !== false;
  const rows: SummaryRow[] = [
    { key: 'gross', label: 'Gross revenue', value: formatMoney(p.grossMinor), note: 'Guest payments for the stays in this period, before platform fees' },
    { key: 'ota_fee', label: 'Platform fees', value: deduct(p.otaFeesMinor), note: 'Airbnb, Booking.com and Vrbo fees' },
    ...(levyShown ? [{ key: 'visitor_levy', label: levyTerms?.rateBps != null ? `Visitor levy (${formatBps(levyTerms.rateBps)})` : 'Visitor levy', value: deduct(levy), note: levyNote }] : []),
    { key: 'changeover', label: `Changeovers (${p.cleaningCount})`, value: deduct(p.changeoversMinor), note: 'Charged at the agreed fee for each clean' },
    { key: 'management_fee', label: `Management fee (${formatBps(terms.managementFeeBps)})`, value: deduct(p.feeMinor), note: `${formatMoney(p.feeBaseMinor)}, ${terms.feeBase === 'payout_after_ota_fees' ? 'the payout after platform fees' : terms.feeBase === 'gross' ? 'the gross revenue' : feeAfterLevy ? 'the payout after platform fees, the visitor levy and changeovers' : 'the payout after platform fees and changeovers'}, at ${formatBps(terms.managementFeeBps)}` },
    ...(terms.vatOnFee ? [{ key: 'vat', label: `VAT on the management fee (${vatRateText(terms.vatRateBps)})`, value: deduct(p.vatMinor) }] : []),
    { key: 'payable', label: 'Other payables', value: deduct(p.payablesMinor), note: 'Approved repairs and supplies received in this period' },
  ];
  const problems: string[] = [];
  if (p.grossMinor - p.otaFeesMinor - levy - p.changeoversMinor - p.feeMinor - p.vatMinor - p.payablesMinor !== p.payoutMinor) problems.push('The figures do not add up to the payout.');
  const sum = (kind: StatementLineView['kind']) => p.lines.filter(l => l.kind === kind).reduce((total, l) => total + l.amountMinor, 0);
  const expected: [StatementLineView['kind'], number][] = [['ota_fee', p.otaFeesMinor], ['visitor_levy', levy], ['changeover', p.changeoversMinor], ['management_fee', p.feeMinor], ['vat', p.vatMinor], ['payable', p.payablesMinor]];
  if (expected.some(([kind, total]) => sum(kind) !== total)) problems.push('The itemised lines do not add up to the totals.');
  return {
    occupancy: occupancyText(p.nightsBooked, p.nightsAvailable), rows, problems,
    payout: { key: 'payout', label: owes ? 'The owner owes' : 'Payout to the owner', value: formatMoney(Math.abs(p.payoutMinor)), strong: true },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The tracker item for one statement

export type StatementRowInput = {
  propertyId: string; propertyName: string; unsettledPayouts: number; missingDetails: number; cleansToReview?: number;
  terms: { managementFeeBps: number | null; cleaningCostMinor: number | null; vatOnFee?: boolean | null; vatRateBps?: number | null; cleanChargeMode?: string | null } | null;
};
export type StatementSource = { row: StatementRowInput; statement: Statement | null; month: string };
export type StatementContext = {
  now: Date;
  // True for owners (client role): no staff names, no internal flags, no pre-statement checks.
  owner?: boolean;
  // The viewer's role, to work out which steps they may take. Leave out for a read-only list.
  role?: string;
  // The month the list is showing, 'YYYY-MM'.
  month: string;
  property?: (propertyId: string) => { name?: string | null; address?: string | null } | null | undefined;
  // A check of this property and month, when one has been loaded: it gives the exact reasons instead of the list's counts.
  preview?: StatementPreview | null;
};

export const CHECK_FIGURES = 'checkFigures';
export const ISSUE_STATEMENT = 'issueStatement';
export const RECORD_PAYOUT = 'recordOwnerPayout';
export const VOID_STATEMENT = 'voidStatement';
export const SET_TERMS = 'setStatementTerms';

const termsSet = (row: Pick<StatementRowInput, 'terms'>) => row.terms?.managementFeeBps != null && row.terms?.cleaningCostMinor != null;
const isManagement = (role: string) => role === 'admin' || role === 'super_admin';

// What this person may do to a statement, in the order of importance. Keys are handled by the Statements screen.
export function statementForms(role: string | undefined, row: StatementRowInput, statement: Statement | null): TrackerForm[] {
  if (!role || !isFinanceRole(role)) return [];
  const moves = statementMoves(role, { statement, unsettledPayouts: row.unsettledPayouts, missingDetails: row.missingDetails, terms: row.terms }).moves;
  const forms: TrackerForm[] = [];
  const status = statement?.status;
  if (!termsSet(row)) { if (isManagement(role)) forms.push({ key: SET_TERMS, title: 'Set the fee and cleaning cost' }); }
  if (moves.includes('issue')) forms.push({ key: ISSUE_STATEMENT, title: 'Issue to owner' });
  if (moves.includes('pay')) forms.push({ key: RECORD_PAYOUT, title: 'Record bank transfer' });
  if (termsSet(row) && status !== 'issued' && status !== 'paid') forms.push({ key: CHECK_FIGURES, title: statement ? 'Check the figures and prepare again' : 'Check figures' });
  if (moves.includes('void')) forms.push({ key: VOID_STATEMENT, title: 'Void' });
  if (isManagement(role) && termsSet(row) && status !== 'paid') forms.push({ key: SET_TERMS, title: 'Statement terms' });
  return forms;
}

const STATUS_WORD: Record<string, string> = { draft: 'Prepared', issued: 'Issued', paid: 'Paid' };
const methodText = (method: string | null | undefined) => (method ? STATEMENT_METHOD_LABEL[method] ?? '' : '');

export function statementTrackerItem(row: StatementRowInput, statement: Statement | null, ctx: StatementContext): TrackerItem<StatementSource> {
  const owner = !!ctx.owner, property = ctx.property?.(row.propertyId);
  const address = addressOf(property) || row.propertyName, propertyName = property?.name?.trim() || row.propertyName;
  const status = statement?.status, paid = status === 'paid', issued = status === 'issued' || paid, drafted = !!statement;
  const owes = !!statement && statement.payoutMinor < 0;

  // The two checks before a statement exists. A loaded check gives the exact reasons; otherwise the list's counts do.
  const reasons = ctx.preview?.blockedReasons;
  const staysOpen = reasons ? countOf(reasons, 'stay_unsettled') : row.unsettledPayouts + row.missingDetails;
  // Client answer 4: a clean costing more than agreed is flagged for staff but no longer holds a statement up, so only an
  // older server's reasons can still list one.
  const cleansOpen = reasons ? countOf(reasons, 'clean_unreviewed') : 0;
  const reconciled = drafted || staysOpen === 0, cleansReviewed = drafted || cleansOpen === 0;
  const ready = reconciled && cleansReviewed && termsSet(row);

  const stateOf = (done: boolean, ...earlier: boolean[]): TrackerStep['state'] => (done ? 'done' : earlier.every(Boolean) ? 'current' : 'todo');
  const day = (iso: string | null | undefined) => (iso ? formatDay(iso, ctx.now) : '');
  const steps: TrackerStep[] = [];
  if (!owner) {
    steps.push({ key: 'reconciled', label: 'Reconciled', state: stateOf(reconciled), ...(!reconciled ? { detail: plural(staysOpen, 'stay') + ' still to reconcile' } : {}) });
    steps.push({ key: 'cleans', label: 'Cleans reviewed', state: stateOf(cleansReviewed, reconciled), ...(!cleansReviewed ? { detail: plural(cleansOpen, 'clean') + ' cost more than the owner is charged' } : {}) });
  }
  steps.push({ key: 'prepared', label: 'Prepared', state: stateOf(drafted, owner || ready), ...(statement && status === 'draft' ? { detail: 'Draft, the figures can still change' } : {}) });
  steps.push({ key: 'issued', label: 'Issued', state: stateOf(issued, drafted), ...(issued && statement?.issuedAt ? { detail: 'Issued ' + day(statement.issuedAt) } : {}) });
  steps.push({ key: 'paid', label: 'Paid', state: stateOf(paid, issued),
    ...(paid && statement ? { detail: ['Paid ' + day(statement.paidAt), statement.payoutReference && 'ref ' + statement.payoutReference].filter(Boolean).join(', ') } : issued && owes ? { detail: 'The owner owes this balance' } : {}) });

  const label = paid ? 'Paid' : issued ? (owes ? 'Owner owes' : 'Issued') : status === 'draft' ? 'Draft' : owner ? 'Being prepared' : !termsSet(row) ? 'Terms needed' : ready ? 'Ready to prepare' : 'Not ready';
  const tone: TrackerTone = paid ? 'good' : issued ? (owes ? 'bad' : 'plain') : status === 'draft' || !ready ? 'wait' : 'plain';

  let nextStep: string, waitingOn: string | null;
  if (paid) { nextStep = 'Nothing more to do'; waitingOn = null; }
  else if (issued) { nextStep = owner ? 'Recharge pays your payout' : owes ? 'The owner settles the balance' : 'Pay the owner and record the transfer'; waitingOn = owner ? 'Recharge' : owes ? 'the owner' : 'Accounts'; }
  else if (status === 'draft') { nextStep = 'Check the figures, then issue to the owner'; waitingOn = 'Accounts'; }
  else if (!termsSet(row)) { nextStep = 'Set the fee and cleaning cost from the agreement'; waitingOn = 'Management'; }
  else if (!reconciled) { nextStep = 'Reconcile ' + plural(staysOpen, 'stay'); waitingOn = 'Accounts'; }
  else if (!cleansReviewed) { nextStep = 'Review ' + plural(cleansOpen, 'clean'); waitingOn = 'Accounts'; }
  else { nextStep = 'Check the figures and prepare the statement'; waitingOn = 'Accounts'; }

  const forms = ctx.role ? statementForms(ctx.role, row, statement) : [];
  const primary = forms.filter(f => f.key !== VOID_STATEMENT && (f.key !== SET_TERMS || !termsSet(row)));
  const title = periodTitle(statement ? { periodStart: statement.periodStart, periodEnd: statement.periodEnd, period: statement.period } : { period: ctx.month }, ctx.now);

  const details: Detail[] = [];
  const add = (name: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label: name, value, ...(tone ? { tone } : {}) }); };
  if (statement) {
    add('Period', title);
    add('How stays are counted', methodText(statement.method));
    add('Occupancy', occupancyText(statement.nightsBooked, statement.nightsAvailable) === 'Not known' ? '' : occupancyText(statement.nightsBooked, statement.nightsAvailable));
    add('Gross revenue', statement.grossMinor != null ? formatMoney(statement.grossMinor) : '');
    if (statement.vatMinor) add(`VAT on the management fee (${vatRateText(statement.vatRateBps)})`, formatMoney(statement.vatMinor));
    add(statement.payoutMinor < 0 ? 'Owner owes' : owner ? 'Your payout' : 'Payout to the owner', formatMoney(Math.abs(statement.payoutMinor)), statement.payoutMinor < 0 ? 'bad' : 'good');
    if (!owner) {
      add('Terms', [`Management fee ${formatBps(statement.feeBps)}`, statement.vatMinor ? `plus VAT` : '', statement.cleanChargeMode ? 'cleans at ' + (CLEAN_MODE_LABEL[statement.cleanChargeMode] ?? '').toLowerCase() : ''].filter(Boolean).join(', '));
      add('Worth a look', flagNotes(statement.detail.internal ?? []).join('\n'));
    }
  } else {
    add('Period', title);
    if (!owner) {
      add('Stays still to reconcile', staysOpen ? formatCount(staysOpen) : '');
      add('Cleans to review', cleansOpen ? formatCount(cleansOpen) : '');
      add('Next', termsSet(row) ? 'Choose Check figures to see the numbers before preparing.' : 'Management sets the fee and cleaning cost first.');
    }
  }

  const updatedAt = statement ? statement.updatedAt ?? statement.paidAt ?? statement.issuedAt : null;
  return {
    id: statement ? statement.id : `${row.propertyId}:${ctx.month}`, section: STATEMENT_SECTION, source: { row, statement, month: ctx.month },
    propertyId: row.propertyId, address, propertyName, title, status: { label, tone }, closed: paid,
    nextStep, nextAction: paid ? null : nextActionOf(primary, waitingOn),
    lastUpdate: statement && updatedAt ? { at: updatedAt, by: owner ? null : 'Accounts', what: STATUS_WORD[statement.status] ?? null } : null,
    progress: progressOf(steps), steps, details,
    search: [address, propertyName, title, label, paid ? '' : nextStep, statement ? formatMoney(statement.payoutMinor) : ''].filter(Boolean).join(' '),
  };
}

// The list for a month: every live statement overlapping it, and a "Not prepared" row for each property that has none.
// `periodStatements` is every live statement overlapping the month; an older answer only has the one starting in it.
export function statementTrackerItems(rows: readonly (StatementRowInput & { statement: Statement | null; periodStatements?: Statement[] })[], ctx: StatementContext): TrackerItem<StatementSource>[] {
  const items: TrackerItem<StatementSource>[] = [];
  for (const row of rows) {
    const list = row.periodStatements ?? (row.statement ? [row.statement] : []);
    const window = monthRange(ctx.month);
    const preview = ctx.preview && ctx.preview.propertyId === row.propertyId && window && ctx.preview.periodStart === window.from && ctx.preview.periodEnd === window.to ? ctx.preview : null;
    if (!list.length) items.push(statementTrackerItem(row, null, { ...ctx, preview }));
    for (const statement of list) items.push(statementTrackerItem(row, statement, ctx));
  }
  return items;
}
