import { CHANNEL_LABEL } from './owner-reports';

// Owner statement maths for one property and one period. Pure functions, no I/O, integer pence only:
// nothing here multiplies or divides money as a floating point number (products go through BigInt).
//
// Period: `from` is the first day included and `to` is the first day NOT included (ISO dates,
// YYYY-MM-DD), the same half-open range as nightsBetween in owner-reports.ts and as
// daterange(period_start, period_end) in SQL. A night is named by its date: the night of 26 Nov is
// inside a period when from <= 26 Nov < to. November 2026 is from 2026-11-01 to 2026-12-01, 30 nights.
//
// What the caller passes in: the property's confirmed (and cancelled, which are ignored) stays, the
// billable cleans (accepted and completed, mid-stay cleans included), the approved other payables
// and, optionally, the owner's own expenses. Everything dated is filtered to the period here.
// Revenue already counted in an older statement must be left out by the caller.

// Assumption (b): VAT on the management fee only, applied to the rounded fee.
export const VAT_BPS = 2000;
// The fee is charged on the payout after OTA fees (today's behaviour), or on gross. One switch.
export type FeeBase = 'payout_after_ota_fees' | 'gross';
export const FEE_BASE: FeeBase = 'payout_after_ota_fees';
// An unreviewed clean whose actual cost is above the agreed value blocks the statement.
export const STATEMENT_WAITS_FOR_CLEAN_REVIEW = true;
// Assumption (c): the order deductions are listed in. VAT is part of the management fee and sits
// straight after it. Within each category lines are in date order (then by id).
export const DEDUCTION_ORDER = ['ota_fee', 'changeover', 'management_fee', 'vat', 'payable'] as const;
export type StatementLineKind = (typeof DEDUCTION_ORDER)[number];

export type StatementMethod = 'nights' | 'check_in_month';
export type CleanChargeMode = 'agreed_fee' | 'actual_cost';

// The property's agreed terms (columns management_fee_bps, vat_on_fee, cleaning_cost_minor,
// clean_charge_mode). The caller refuses to prepare a statement while they are not set.
export type StatementTerms = {
  managementFeeBps: number;
  vatOnFee: boolean;
  cleaningCostMinor: number;
  cleanChargeMode: CleanChargeMode;
};
export type StatementStayInput = {
  id: string;
  channel: string; // 'airbnb' | 'booking_com' | 'vrbo' | 'direct' | 'other'
  checkIn: string;
  checkOut: string;
  status: string; // only 'confirmed' counts; 'cancelled' (or anything else) is left out
  settledMinor: number | null; // the amount received (net); null while unsettled
  itemisedFeesMinor?: number | null; // OTA fees itemised on the stay's payout lines
  grossMinor?: number | null; // gross from the payout file, used for gross minus net
  ownerStay?: boolean; // owner stays count as booked nights, with no money
  reference?: string;
};
export type StatementCleanInput = {
  id: string;
  date: string;
  chargedMinor?: number | null; // the value charged to the owner; defaults to the terms' cleaning cost
  actualCostMinor: number | null; // cleaner's invoice line, else the assigned cleaner's rate
  decision: CleanChargeMode | null; // the review's choice; used only while `reviewed` is true
  reviewed: boolean; // false when there is no review or the review went stale
};
export type StatementPayableInput = { id: string; date: string; description: string; amountMinor: number };
export type OwnerExpenseInput = { id?: string; date: string; amountMinor: number; category: string; note?: string };
export type StatementInput = {
  from: string;
  to: string;
  method: StatementMethod;
  terms: StatementTerms;
  stays: readonly StatementStayInput[];
  cleans: readonly StatementCleanInput[];
  payables: readonly StatementPayableInput[];
  ownerExpenses?: readonly OwnerExpenseInput[];
};

// Every line is a deduction from gross, as a positive amount: gross minus the sum of the lines is the
// payout. `refId` is the stay, clean or payable the line comes from (null for the fee and VAT).
export type StatementLine = { kind: StatementLineKind; date: string; label: string; amountMinor: number; refId: string | null };
// Each stay's share of this period. Money is zero for owner stays and for stays outside the money
// window (with check_in_month, a stay that started in an earlier period still counts its nights).
export type StatementStayShare = {
  id: string; channel: string; checkIn: string; checkOut: string; ownerStay: boolean;
  nights: number; nightsInPeriod: number; grossMinor: number; otaFeeMinor: number; payoutMinor: number;
};
export type StatementResult = {
  lines: StatementLine[];
  stays: StatementStayShare[];
  grossMinor: number;
  otaFeesMinor: number;
  changeoversMinor: number;
  feeBaseMinor: number;
  feeMinor: number;
  vatMinor: number;
  payablesMinor: number;
  payoutMinor: number;
  ownerExpensesMinor: number | null;
  netMinor: number | null; // payout minus owner expenses, when owner expenses were given
  nightsBooked: number;
  nightsAvailable: number;
  // Machine-readable codes, 'code:id'. Internal: they can reveal cleaner costs, so never show owners.
  // clean_over_agreed:<cleanId>, clean_cost_unknown:<cleanId>, ota_fee_unknown:<stayId>,
  // owner_stay_amount_ignored:<stayId>, nights_exceed_period
  flags: string[];
  blocked: boolean;
  // clean_unreviewed:<cleanId>, stay_unsettled:<stayId>
  blockedReasons: string[];
};

const OTA_CHANNELS: readonly string[] = ['airbnb', 'booking_com', 'vrbo'];
const ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), BPS_SCALE = BigInt(10000);

function safeInteger(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new RangeError(`${what} must be a whole number of pence`);
  return value;
}
function fromBig(value: bigint, what: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is too large`);
  return n;
}
// Floor division for a positive divisor (BigInt division truncates towards zero).
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== ZERO && a < ZERO ? q - ONE : q;
}

// minor x bps / 10000, halves rounded away from zero. A local copy: lib/payout-reconciliation.ts did
// not export percentOfMinor when this was written; switch to that one once it exists.
function percentOfMinor(minor: number, bps: number): number {
  const product = BigInt(safeInteger(minor, 'Amount')) * BigInt(safeInteger(bps, 'Rate'));
  const q = product / BPS_SCALE, r = product % BPS_SCALE;
  const twice = (r < ZERO ? -r : r) * TWO;
  return fromBig(twice >= BPS_SCALE ? q + (product < ZERO ? -ONE : ONE) : q, 'Amount');
}

// The share of x for nights before+1..through of a stay of `nights` nights:
// floor(x*through/nights) - floor(x*before/nights). Shares of consecutive ranges add up to x exactly.
export function prorate(x: number, before: number, through: number, nights: number): number {
  safeInteger(x, 'Amount');
  if (!Number.isSafeInteger(nights) || nights <= 0) throw new RangeError('A stay must have at least one night to share');
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(through) || before < 0 || through < before || through > nights) {
    throw new RangeError('Nights before and through must satisfy 0 <= before <= through <= nights');
  }
  const big = BigInt(x), n = BigInt(nights);
  return fromBig(floorDiv(big * BigInt(through), n) - floorDiv(big * BigInt(before), n), 'Share');
}

// The amount the management fee is charged on.
export function feeBaseMinor(grossMinor: number, otaFeesMinor: number, base: FeeBase = FEE_BASE): number {
  return base === 'gross' ? grossMinor : grossMinor - otaFeesMinor;
}

const DAY_MS = 86400000;
function dayNumber(iso: unknown, what: string): number {
  const match = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) throw new RangeError(`${what} must be a date (YYYY-MM-DD)`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== iso) throw new RangeError(`${what} is not a real date`);
  return ms / DAY_MS;
}
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const byDateThenId = <T extends { id?: string }>(date: (item: T) => string) => (a: T, b: T) =>
  date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0;
const percentLabel = (bps: number) => `${bps / 100}%`;
function total(values: readonly number[], what: string): number {
  return fromBig(values.reduce((sum, v) => sum + BigInt(v), ZERO), what);
}

export function statementFor(input: StatementInput): StatementResult {
  const from = dayNumber(input.from, 'Period start'), to = dayNumber(input.to, 'Period end');
  if (to <= from) throw new RangeError('The period must end after it starts');
  if (input.method !== 'nights' && input.method !== 'check_in_month') throw new RangeError('Unknown statement method');
  const { terms } = input;
  if (!Number.isSafeInteger(terms.managementFeeBps) || terms.managementFeeBps < 0 || terms.managementFeeBps > 10000) throw new RangeError('Invalid management fee');
  if (safeInteger(terms.cleaningCostMinor, 'Cleaning cost') < 0) throw new RangeError('Invalid cleaning cost');
  if (terms.cleanChargeMode !== 'agreed_fee' && terms.cleanChargeMode !== 'actual_cost') throw new RangeError('Invalid clean charge mode');
  const inPeriod = (iso: string, what: string) => { const d = dayNumber(iso, what); return d >= from && d < to; };
  const flags: string[] = [], blockedReasons: string[] = [];

  // Stays: nights inside the period for occupancy, and the money share by the chosen method.
  const stays: StatementStayShare[] = [];
  let nightsBooked = 0;
  for (const stay of [...input.stays].filter(s => s.status === 'confirmed').sort(byDateThenId(s => s.checkIn))) {
    const checkIn = dayNumber(stay.checkIn, 'Check-in'), checkOut = dayNumber(stay.checkOut, 'Check-out');
    if (checkOut < checkIn) throw new RangeError(`Stay ${stay.id} checks out before it checks in`);
    const nights = checkOut - checkIn;
    const nightsInPeriod = Math.max(0, Math.min(checkOut, to) - Math.max(checkIn, from));
    // A stay with no nights, and every stay under check_in_month, counts in full where it checks in.
    const whole = input.method === 'check_in_month' || nights === 0;
    const before = whole ? 0 : clamp(from - checkIn, 0, nights), through = whole ? nights : clamp(to - checkIn, 0, nights);
    const inMoney = whole ? checkIn >= from && checkIn < to : through > before;
    if (!inMoney && nightsInPeriod === 0) continue;
    nightsBooked += nightsInPeriod;
    const ownerStay = stay.ownerStay === true;
    let grossMinor = 0, otaFeeMinor = 0;
    if (ownerStay && stay.settledMinor !== null && stay.settledMinor !== undefined && stay.settledMinor !== 0) flags.push(`owner_stay_amount_ignored:${stay.id}`);
    if (inMoney && !ownerStay) {
      if (stay.settledMinor === null || stay.settledMinor === undefined) blockedReasons.push(`stay_unsettled:${stay.id}`);
      else {
        const settled = safeInteger(stay.settledMinor, 'Settled amount');
        // OTA fee: itemised fees, else gross minus net, else 0 (flagged for platform stays).
        let fee: number;
        if (stay.itemisedFeesMinor !== null && stay.itemisedFeesMinor !== undefined) fee = safeInteger(stay.itemisedFeesMinor, 'OTA fees');
        else if (stay.grossMinor !== null && stay.grossMinor !== undefined) fee = safeInteger(stay.grossMinor, 'Gross') - settled;
        else {
          fee = 0;
          if (OTA_CHANNELS.includes(stay.channel)) flags.push(`ota_fee_unknown:${stay.id}`);
        }
        const gross = safeInteger(settled + fee, 'Gross');
        const full = whole || (before === 0 && through === nights);
        grossMinor = full ? gross : prorate(gross, before, through, nights);
        otaFeeMinor = full ? fee : prorate(fee, before, through, nights);
      }
    }
    stays.push({ id: stay.id, channel: stay.channel, checkIn: stay.checkIn, checkOut: stay.checkOut, ownerStay, nights, nightsInPeriod, grossMinor, otaFeeMinor, payoutMinor: grossMinor - otaFeeMinor });
  }
  const nightsAvailable = to - from;
  if (nightsBooked > nightsAvailable) flags.push('nights_exceed_period');

  // Changeovers: the agreed value, unless the reviewed decision (or else the property's mode) says
  // actual cost. A clean costing more than the agreed value is flagged and waits for a review.
  const changeovers: StatementLine[] = [];
  for (const clean of input.cleans.filter(c => inPeriod(c.date, 'Clean date')).sort(byDateThenId(c => c.date))) {
    const agreed = safeInteger(clean.chargedMinor ?? terms.cleaningCostMinor, 'Clean charge');
    const actual = clean.actualCostMinor === null || clean.actualCostMinor === undefined ? null : safeInteger(clean.actualCostMinor, 'Clean cost');
    if (actual !== null && actual > agreed) {
      flags.push(`clean_over_agreed:${clean.id}`);
      if (STATEMENT_WAITS_FOR_CLEAN_REVIEW && !clean.reviewed && terms.cleanChargeMode === 'agreed_fee') blockedReasons.push(`clean_unreviewed:${clean.id}`);
    }
    const basis: CleanChargeMode = clean.reviewed && clean.decision ? clean.decision : terms.cleanChargeMode;
    let charge = agreed;
    if (basis === 'actual_cost') {
      if (actual === null) flags.push(`clean_cost_unknown:${clean.id}`);
      else charge = actual;
    }
    changeovers.push({ kind: 'changeover', date: clean.date, label: 'Changeover clean', amountMinor: charge, refId: clean.id });
  }

  const payables: StatementLine[] = input.payables.filter(x => inPeriod(x.date, 'Payable date')).sort(byDateThenId(x => x.date))
    .map(x => ({ kind: 'payable', date: x.date, label: x.description, amountMinor: safeInteger(x.amountMinor, 'Payable'), refId: x.id }));

  const otaLines: StatementLine[] = stays.filter(s => s.otaFeeMinor !== 0)
    .map(s => ({ kind: 'ota_fee', date: s.checkIn, label: `${CHANNEL_LABEL[s.channel] ?? s.channel} fees`, amountMinor: s.otaFeeMinor, refId: s.id }));

  const grossMinor = total(stays.map(s => s.grossMinor), 'Gross');
  const otaFeesMinor = total(otaLines.map(l => l.amountMinor), 'OTA fees');
  const changeoversMinor = total(changeovers.map(l => l.amountMinor), 'Changeovers');
  const payablesMinor = total(payables.map(l => l.amountMinor), 'Payables');
  const base = feeBaseMinor(grossMinor, otaFeesMinor);
  const feeMinor = percentOfMinor(base, terms.managementFeeBps);
  const vatMinor = terms.vatOnFee ? percentOfMinor(feeMinor, VAT_BPS) : 0;
  const feeLines: StatementLine[] = [{ kind: 'management_fee', date: input.from, label: `Management fee (${percentLabel(terms.managementFeeBps)})`, amountMinor: feeMinor, refId: null }];
  const vatLines: StatementLine[] = terms.vatOnFee ? [{ kind: 'vat', date: input.from, label: `VAT on the management fee (${percentLabel(VAT_BPS)})`, amountMinor: vatMinor, refId: null }] : [];
  const byKind: Record<StatementLineKind, StatementLine[]> = { ota_fee: otaLines, changeover: changeovers, management_fee: feeLines, vat: vatLines, payable: payables };
  const lines = DEDUCTION_ORDER.flatMap(kind => byKind[kind]);
  const payoutMinor = total([grossMinor, ...lines.map(l => -l.amountMinor)], 'Payout');

  const ownerExpensesMinor = input.ownerExpenses
    ? total(input.ownerExpenses.filter(x => inPeriod(x.date, 'Owner expense date')).map(x => safeInteger(x.amountMinor, 'Owner expense')), 'Owner expenses')
    : null;
  return {
    lines, stays, grossMinor, otaFeesMinor, changeoversMinor, feeBaseMinor: base, feeMinor, vatMinor, payablesMinor, payoutMinor,
    ownerExpensesMinor, netMinor: ownerExpensesMinor === null ? null : payoutMinor - ownerExpensesMinor,
    nightsBooked, nightsAvailable, flags, blocked: blockedReasons.length > 0, blockedReasons,
  };
}
