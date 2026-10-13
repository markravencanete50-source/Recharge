import { CHANNEL_LABEL } from './owner-reports';

// Owner statement maths for one property and one period. Pure functions, no I/O, integer pence only:
// nothing here multiplies or divides money as a floating point number (products go through BigInt).
//
// Period: `from` is the first day included and `to` is the first day NOT included (ISO dates,
// YYYY-MM-DD), the same half-open range as nightsBetween in owner-reports.ts and as
// daterange(period_start, period_end) in SQL. A night is named by its date: the night of 26 Nov is
// inside a period when from <= 26 Nov < to. November 2026 is from 2026-11-01 to 2026-12-01, 30 nights.
//
// What the caller passes in: the property's confirmed stays (cancelled or moved ones are ignored unless a
// stored copy below still shares their money into the period), the
// billable cleans (accepted and completed, mid-stay cleans included), the approved other payables
// and, optionally, the owner's own expenses. Everything dated is filtered to the period here.
// What other statements already did with a stay comes in on the stay (the database works it out):
// * storedShare: the copy of the stay's money kept by the first issued (or paid) statement of the same
//   method that put it on. From then on every period takes its share from that copy (its dates, nights,
//   gross and fee), whatever happens to the stay or its payout later, so the parts across statements
//   always add up to the copy. A stay that has changed since is flagged stay_changed_after_statement.
// * alreadyCounted: the money is on a statement of the other method in full; this one counts nights only.
// * sharedByNightsElsewhere / checkInStatementOverlaps / reliedOnBy: splits that would lose money,
//   which block the statement (stay_method_conflict, stay_relied_on).

// Assumption (b): VAT on the management fee only, applied to the rounded fee.
export const VAT_BPS = 2000;
// The fee is charged on the payout after OTA fees and the period's changeover charges (client answer 1, "after Airbnb
// fees and the cleaning fees"; Lee's decision, 13 October 2026). One base, no switch. SQL: the base in
// private.workspace_statement_compute (20261014120000), and private.workspace_statement_fee_base() names it.
export const FEE_BASE = 'payout_after_ota_fees_and_changeovers' as const;
// An unreviewed clean whose actual cost is above the agreed value blocks the statement.
export const STATEMENT_WAITS_FOR_CLEAN_REVIEW = false;
// Assumption (c): the order deductions are listed in. VAT is part of the management fee and sits
// straight after it. Within each category lines are in date order (then by id).
export const DEDUCTION_ORDER = ['ota_fee', 'visitor_levy', 'changeover', 'management_fee', 'vat', 'payable'] as const;
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
  // The visitor levy (migration 20261014150000): off when absent.
  visitorLevy?: VisitorLevyTerms | null;
};
// A property's visitor levy settings (columns levy_enabled, levy_rate_bps, levy_night_cap, levy_from). Councils differ,
// so none of it is fixed: the rate, the most nights of a stay that are levied (null: all) and the first check-in day
// levied (null: every stay).
export type VisitorLevyTerms = { enabled: boolean; rateBps: number; nightCap: number | null; from: string | null };
// The management fee is charged on the payout after the levy (SQL: private.workspace_statement_fee_after_levy()).
// One switch, a question for the client.
export const FEE_AFTER_LEVY = true;
// The stored copy of a stay's money (detail.stays[].stay* on the statement that first put it on).
export type StoredStayShare = {
  grossMinor: number; otaFeeMinor: number; settledMinor: number;
  nights: number; checkIn: string; checkOut: string;
  // The stay's visitor levy and levied nights as first counted (none on a copy made before the levy existed).
  levyMinor?: number | null; levyNights?: number | null;
  // The copy is on another property's statement (the stay has moved since): its money stays there.
  otherProperty?: boolean;
};
export type StatementStayInput = {
  id: string;
  channel: string; // 'airbnb' | 'booking_com' | 'vrbo' | 'direct' | 'other'
  checkIn: string;
  checkOut: string;
  // Only 'confirmed' (at this property) is booked; anything else is left out unless a stored copy holds it.
  status: string;
  settledMinor: number | null; // the amount received (net); null while unsettled
  itemisedFeesMinor?: number | null; // OTA fees itemised on the stay's payout lines
  grossMinor?: number | null; // gross from the payout file, used for gross minus net
  cleaningFeeMinor?: number | null; // the guest's cleaning fee on the payout lines; left out of the visitor levy's base
  ownerStay?: boolean; // owner stays count as booked nights, with no money
  reference?: string;
  storedShare?: StoredStayShare | null;
  alreadyCounted?: boolean;
  // A statement of the other method put part of the money on (by nights): splitting it again loses some.
  sharedByNightsElsewhere?: boolean;
  // A statement counted by check-in covers some of the stay's nights without counting it.
  checkInStatementOverlaps?: boolean;
  // Another live statement (of the method given) left the stay to a statement of the other method counting it in
  // full (its alreadyCounted), and no statement but this one could. Checked for every listed stay, and for a stay
  // no longer in the period that this statement counted when last prepared (countedBefore).
  reliedOnBy?: StatementMethod | null;
  countedBefore?: boolean;
};
export type StatementCleanInput = {
  id: string;
  date: string;
  chargedMinor?: number | null; // the value charged to the owner; defaults to the terms' cleaning cost
  actualCostMinor: number | null; // the cleaner's invoice line (client answer 4); only flags, never charged
  decision: CleanChargeMode | null; // the review's choice; kept for callers, no longer changes the charge
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
  counted: boolean; // this statement puts (a share of) the stay's money on
  levyMinor: number; // this period's share of the stay's visitor levy
};
export type StatementResult = {
  lines: StatementLine[];
  stays: StatementStayShare[];
  grossMinor: number;
  otaFeesMinor: number;
  visitorLevyMinor: number;
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
  // owner_stay_amount_ignored:<stayId>, stay_changed_after_statement:<stayId>, nights_exceed_period
  flags: string[];
  blocked: boolean;
  // clean_unreviewed:<cleanId>, stay_unsettled:<stayId>, stay_method_conflict:<stayId>, stay_relied_on:<stayId>
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

// The visitor levy on an amount for `levied` of its `nights` nights: amount x levied / nights x bps / 10000, halves
// rounded away from zero (the management fee's rule). 0 with no nights, no levied nights or no rate.
export function levyMinor(amount: number, levied: number, nights: number, bps: number): number {
  safeInteger(amount, 'Amount');
  if (!Number.isSafeInteger(nights) || !Number.isSafeInteger(levied) || !Number.isSafeInteger(bps) || nights <= 0 || levied <= 0 || bps <= 0) return 0;
  const x = BigInt(amount) * BigInt(Math.min(levied, nights)) * BigInt(bps), d = BigInt(nights) * BPS_SCALE;
  const magnitude = ((x < ZERO ? -x : x) * TWO + d) / (d * TWO);
  return fromBig(x < ZERO ? -magnitude : magnitude, 'Levy');
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

// The amount the management fee is charged on: gross less OTA fees less changeovers. Like the SQL it is plain
// subtraction, so it can be negative.
export function feeBaseMinor(grossMinor: number, otaFeesMinor: number, changeoversMinor: number): number {
  return grossMinor - otaFeesMinor - changeoversMinor;
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
  const levy = terms.visitorLevy?.enabled ? terms.visitorLevy : null;
  if (levy) {
    if (!Number.isSafeInteger(levy.rateBps) || levy.rateBps < 0 || levy.rateBps > 10000) throw new RangeError('Invalid visitor levy rate');
    if (levy.nightCap !== null && (!Number.isSafeInteger(levy.nightCap) || levy.nightCap < 1 || levy.nightCap > 366)) throw new RangeError('Invalid visitor levy night cap');
    if (levy.from !== null) dayNumber(levy.from, 'Visitor levy start');
  }
  const inPeriod = (iso: string, what: string) => { const d = dayNumber(iso, what); return d >= from && d < to; };
  const flags: string[] = [], blockedReasons: string[] = [];

  // Stays: nights inside the period for occupancy, and the money share by the chosen method.
  const stays: StatementStayShare[] = [];
  const listed = new Set<string>();
  let nightsBooked = 0;
  for (const stay of [...input.stays].sort(byDateThenId(s => s.checkIn))) {
    const checkIn = dayNumber(stay.checkIn, 'Check-in'), checkOut = dayNumber(stay.checkOut, 'Check-out');
    if (checkOut < checkIn) throw new RangeError(`Stay ${stay.id} checks out before it checks in`);
    const nights = checkOut - checkIn;
    const live = stay.status === 'confirmed';
    const stored = stay.storedShare ?? null, here = stored !== null && stored.otherProperty !== true;
    let storedIn = 0, storedOut = 0;
    if (stored) {
      storedIn = dayNumber(stored.checkIn, 'Stored check-in'); storedOut = dayNumber(stored.checkOut, 'Stored check-out');
      if (!Number.isSafeInteger(stored.nights) || stored.nights <= 0) throw new RangeError(`Stay ${stay.id} has a stored copy with no nights`);
    }
    // The money window: the stored copy's dates and nights once a copy holds the stay, else the stay's own.
    const windowIn = here ? storedIn : checkIn, windowNights = here ? stored.nights : nights;
    // A stay with no nights, and every stay under check_in_month, counts in full where it checks in.
    const whole = input.method === 'check_in_month' || windowNights === 0;
    const before = whole ? 0 : clamp(from - windowIn, 0, windowNights), through = whole ? windowNights : clamp(to - windowIn, 0, windowNights);
    const inMoney = whole ? windowIn >= from && windowIn < to : through > before;
    const fullShare = whole || (before === 0 && through === windowNights);
    const nightsInPeriod = live ? Math.max(0, Math.min(checkOut, to) - Math.max(checkIn, from)) : 0;
    // Listed: a confirmed stay touching the period (with no nights: checking in inside it), or a stay whose copy shares into it.
    const liveListed = live && (nightsInPeriod > 0 || (nights === 0 && checkIn >= from && checkIn < to));
    if (!liveListed && !(here && storedIn < to && storedOut > from)) continue;
    listed.add(stay.id);
    nightsBooked += nightsInPeriod;
    const ownerStay = stay.ownerStay === true, ownerMoney = ownerStay && !stored;
    let grossMinor = 0, otaFeeMinor = 0, counted = false, stayLevy = 0, stayLevyNights = 0;
    if (ownerStay && stay.settledMinor !== null && stay.settledMinor !== undefined && stay.settledMinor !== 0) flags.push(`owner_stay_amount_ignored:${stay.id}`);
    // OTA fee: itemised fees, else gross minus net, else 0 (flagged for platform stays).
    const liveFee = (settled: number) => stay.itemisedFeesMinor !== null && stay.itemisedFeesMinor !== undefined ? safeInteger(stay.itemisedFeesMinor, 'OTA fees')
      : stay.grossMinor !== null && stay.grossMinor !== undefined ? safeInteger(stay.grossMinor, 'Gross') - settled : null;
    if (stay.sharedByNightsElsewhere) blockedReasons.push(`stay_method_conflict:${stay.id}`);
    else if (stay.alreadyCounted && inMoney && !ownerMoney) { /* its money is on the other statement: nights only */ }
    else if (stored) {
      if (here && inMoney && live) {
        const gross = safeInteger(stored.grossMinor, 'Stored gross'), fee = safeInteger(stored.otaFeeMinor, 'Stored OTA fees');
        grossMinor = fullShare ? gross : prorate(gross, before, through, windowNights);
        otaFeeMinor = fullShare ? fee : prorate(fee, before, through, windowNights);
        counted = true;
        // The levy from the copy too, never from the settings as they are now.
        stayLevy = stored.levyMinor == null ? 0 : safeInteger(stored.levyMinor, 'Stored levy');
        stayLevyNights = stored.levyNights == null ? 0 : safeInteger(stored.levyNights, 'Stored levied nights');
      }
      const settled = stay.settledMinor ?? null;
      const changed = !here || !live || stay.checkIn !== stored.checkIn || stay.checkOut !== stored.checkOut || settled !== stored.settledMinor
        || (settled !== null && (liveFee(settled) ?? 0) !== stored.otaFeeMinor);
      if (changed) flags.push(`stay_changed_after_statement:${stay.id}`);
    } else if (inMoney && !ownerStay) {
      if (stay.settledMinor === null || stay.settledMinor === undefined) blockedReasons.push(`stay_unsettled:${stay.id}`);
      else {
        const settled = safeInteger(stay.settledMinor, 'Settled amount');
        let fee = liveFee(settled);
        if (fee === null) {
          fee = 0;
          if (OTA_CHANNELS.includes(stay.channel)) flags.push(`ota_fee_unknown:${stay.id}`);
        }
        const gross = safeInteger(settled + fee, 'Gross');
        grossMinor = fullShare ? gross : prorate(gross, before, through, windowNights);
        otaFeeMinor = fullShare ? fee : prorate(fee, before, through, windowNights);
        counted = true;
        // The visitor levy, worked out once here: on the accommodation (gross less the guest's cleaning fee) for the
        // first nights of the stay, at most the night cap, for a stay checking in on or after the start day.
        if (levy && windowNights > 0 && (levy.from === null || stay.checkIn >= levy.from)) {
          const cleaningFee = stay.cleaningFeeMinor == null ? null : safeInteger(stay.cleaningFeeMinor, 'Cleaning fee');
          if (cleaningFee === null && OTA_CHANNELS.includes(stay.channel)) flags.push(`levy_cleaning_fee_unknown:${stay.id}`);
          stayLevyNights = Math.min(windowNights, levy.nightCap ?? windowNights);
          stayLevy = levyMinor(gross - (cleaningFee ?? 0), stayLevyNights, windowNights, levy.rateBps);
        }
      }
    }
    // This period's share of the levy, by its levied nights (the first nights of the stay).
    const levyShare = counted && stayLevy !== 0 && stayLevyNights > 0
      ? (fullShare ? stayLevy : prorate(stayLevy, Math.min(before, stayLevyNights), Math.min(through, stayLevyNights), stayLevyNights)) : 0;
    // By nights, part of a stay whose other nights sit on a statement counted by check-in would never be paid.
    if (input.method === 'nights' && counted && !fullShare && stay.checkInStatementOverlaps) blockedReasons.push(`stay_method_conflict:${stay.id}`);
    // Another statement left this stay to a statement of the other method counting it in full: this one must do that.
    if (stay.reliedOnBy && !(stay.reliedOnBy !== input.method && counted && fullShare)) blockedReasons.push(`stay_relied_on:${stay.id}`);
    stays.push({ id: stay.id, channel: stay.channel, checkIn: stay.checkIn, checkOut: stay.checkOut, ownerStay, nights, nightsInPeriod, grossMinor, otaFeeMinor, payoutMinor: grossMinor - otaFeeMinor, counted, levyMinor: levyShare });
  }
  // A stay this statement used to count in full, no longer in its period, that another statement still relies on.
  for (const stay of input.stays.filter(s => s.reliedOnBy && s.countedBefore && !listed.has(s.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) blockedReasons.push(`stay_relied_on:${stay.id}`);
  const nightsAvailable = to - from;
  if (nightsBooked > nightsAvailable) flags.push('nights_exceed_period');

  // Changeovers: always the agreed value (client answer 4). The property's clean charge mode and a review's decision
  // no longer change it. A clean whose actual cost (the cleaner's invoice line) is above it is flagged for staff, but
  // the statement does not wait for its review (STATEMENT_WAITS_FOR_CLEAN_REVIEW is false).
  const changeovers: StatementLine[] = [];
  for (const clean of input.cleans.filter(c => inPeriod(c.date, 'Clean date')).sort(byDateThenId(c => c.date))) {
    const agreed = safeInteger(clean.chargedMinor ?? terms.cleaningCostMinor, 'Clean charge');
    const actual = clean.actualCostMinor === null || clean.actualCostMinor === undefined ? null : safeInteger(clean.actualCostMinor, 'Clean cost');
    if (actual !== null && actual > agreed) {
      flags.push(`clean_over_agreed:${clean.id}`);
      if (STATEMENT_WAITS_FOR_CLEAN_REVIEW && !clean.reviewed) blockedReasons.push(`clean_unreviewed:${clean.id}`);
    }
    changeovers.push({ kind: 'changeover', date: clean.date, label: 'Changeover clean', amountMinor: agreed, refId: clean.id });
  }

  const payables: StatementLine[] = input.payables.filter(x => inPeriod(x.date, 'Payable date')).sort(byDateThenId(x => x.date))
    .map(x => ({ kind: 'payable', date: x.date, label: x.description, amountMinor: safeInteger(x.amountMinor, 'Payable'), refId: x.id }));

  const otaLines: StatementLine[] = stays.filter(s => s.otaFeeMinor !== 0)
    .map(s => ({ kind: 'ota_fee', date: s.checkIn, label: `${CHANNEL_LABEL[s.channel] ?? s.channel} fees`, amountMinor: s.otaFeeMinor, refId: s.id }));

  const levyLines: StatementLine[] = stays.filter(s => s.levyMinor !== 0)
    .map(s => ({ kind: 'visitor_levy', date: s.checkIn, label: 'Visitor levy', amountMinor: s.levyMinor, refId: s.id }));

  const grossMinor = total(stays.map(s => s.grossMinor), 'Gross');
  const otaFeesMinor = total(otaLines.map(l => l.amountMinor), 'OTA fees');
  const visitorLevyMinor = total(levyLines.map(l => l.amountMinor), 'Visitor levy');
  const changeoversMinor = total(changeovers.map(l => l.amountMinor), 'Changeovers');
  const payablesMinor = total(payables.map(l => l.amountMinor), 'Payables');
  const base = feeBaseMinor(grossMinor, otaFeesMinor, changeoversMinor) - (FEE_AFTER_LEVY ? visitorLevyMinor : 0);
  const feeMinor = percentOfMinor(base, terms.managementFeeBps);
  const vatMinor = terms.vatOnFee ? percentOfMinor(feeMinor, VAT_BPS) : 0;
  const feeLines: StatementLine[] = [{ kind: 'management_fee', date: input.from, label: `Management fee (${percentLabel(terms.managementFeeBps)})`, amountMinor: feeMinor, refId: null }];
  const vatLines: StatementLine[] = terms.vatOnFee ? [{ kind: 'vat', date: input.from, label: `VAT on the management fee (${percentLabel(VAT_BPS)})`, amountMinor: vatMinor, refId: null }] : [];
  const byKind: Record<StatementLineKind, StatementLine[]> = { ota_fee: otaLines, visitor_levy: levyLines, changeover: changeovers, management_fee: feeLines, vat: vatLines, payable: payables };
  const lines = DEDUCTION_ORDER.flatMap(kind => byKind[kind]);
  const payoutMinor = total([grossMinor, ...lines.map(l => -l.amountMinor)], 'Payout');

  const ownerExpensesMinor = input.ownerExpenses
    ? total(input.ownerExpenses.filter(x => inPeriod(x.date, 'Owner expense date')).map(x => safeInteger(x.amountMinor, 'Owner expense')), 'Owner expenses')
    : null;
  return {
    lines, stays, grossMinor, otaFeesMinor, visitorLevyMinor, changeoversMinor, feeBaseMinor: base, feeMinor, vatMinor, payablesMinor, payoutMinor,
    ownerExpensesMinor, netMinor: ownerExpensesMinor === null ? null : payoutMinor - ownerExpensesMinor,
    nightsBooked, nightsAvailable, flags, blocked: blockedReasons.length > 0, blockedReasons,
  };
}
