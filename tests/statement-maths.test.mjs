import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Owner statement maths (lib/statement-maths.ts): the brief's worked example, rounding, pro-rating
// across periods, owner and cancelled stays, the clean review block, today's check-in-month figures.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { prorate, statementFor, feeBaseMinor, VAT_BPS, FEE_BASE, STATEMENT_WAITS_FOR_CLEAN_REVIEW, DEDUCTION_ORDER } = await vite.ssrLoadModule('/lib/statement-maths.ts');

/*
Worked example, recomputed by hand from the rules before any code was run.
November 2026 = 2026-11-01 (included) to 2026-12-01 (not included): 30 nights. 15% fee, VAT on.

Stays (gross = settled + OTA fee; Booking.com is pro-rated, the rest sit wholly in November):
  Airbnb      3 to 8 Nov    5 nights  settled 50000, fee 1546         gross 51546
  Vrbo       12 to 15 Nov   3 nights  gross 42400, fee 3392           settled 39008
  Direct     20 to 22 Nov   2 nights  settled 30000, no fee           gross 30000
  Booking.com 26 Nov to 3 Dec, 7 nights, 5 in November (before 0, through 5):
    gross 72000, fee 11808, settled 60192
    November gross = floor(72000*5/7) - floor(72000*0/7) = floor(51428.57) - 0 = 51428
    November fee   = floor(11808*5/7) - 0 = floor(8434.28) = 8434
    November net   = 51428 - 8434 = 42994
    December (before 5, through 7): gross 72000 - 51428 = 20572, fee 11808 - 8434 = 3374,
    net 20572 - 3374 = 17198. Check: 42994 + 17198 = 60192 = settled.
Gross       = 51546 + 42400 + 30000 + 51428 = 175374
OTA fees    = 1546 + 3392 + 0 + 8434 = 13372
Fee base    = 175374 - 13372 = 162002 (payout after OTA fees)
Fee         = 162002 x 1500 / 10000 = 24300.3, rounds to 24300
VAT         = 24300 x 2000 / 10000 = 4860
Changeovers = cleans on the checkout days 8, 15 and 22 Nov (the 3 Dec one is December's):
              3 x 6000 = 18000 at the agreed value. Actual costs 5500, 7500, 5500: the 15 Nov
              clean (7500 > 6000) is flagged. Actual-cost mode: 5500 + 7500 + 5500 = 18500.
Payables    = 6000 + 2500 = 8500
Payout      = 175374 - 13372 - 18000 - 24300 - 4860 - 8500 = 106342
Nights      = 5 + 3 + 2 + 5 = 15 of 30 (50%)
Net         = 106342 - 55000 owner expenses = 51342
Every figure agrees with the brief. (The brief gives only the flagged clean's actual cost; 5500 for
the other two is this fixture's choice so that actual-cost mode totals 18500.)
*/
const terms = (over = {}) => ({ managementFeeBps: 1500, vatOnFee: true, cleaningCostMinor: 6000, cleanChargeMode: 'agreed_fee', ...over });
const exampleStays = [
  { id: 'airbnb', channel: 'airbnb', checkIn: '2026-11-03', checkOut: '2026-11-08', status: 'confirmed', settledMinor: 50000, itemisedFeesMinor: 1546 },
  { id: 'vrbo', channel: 'vrbo', checkIn: '2026-11-12', checkOut: '2026-11-15', status: 'confirmed', settledMinor: 39008, itemisedFeesMinor: 3392, grossMinor: 42400 },
  { id: 'direct', channel: 'direct', checkIn: '2026-11-20', checkOut: '2026-11-22', status: 'confirmed', settledMinor: 30000 },
  // Fee from gross minus net (no itemised fees).
  { id: 'booking', channel: 'booking_com', checkIn: '2026-11-26', checkOut: '2026-12-03', status: 'confirmed', settledMinor: 60192, grossMinor: 72000 },
];
const exampleCleans = (over = {}) => [
  { id: 'c1', date: '2026-11-08', actualCostMinor: 5500, decision: null, reviewed: false },
  { id: 'c2', date: '2026-11-15', actualCostMinor: 7500, decision: 'agreed_fee', reviewed: true, ...over },
  { id: 'c3', date: '2026-11-22', actualCostMinor: 5500, decision: null, reviewed: false },
  { id: 'c4', date: '2026-12-03', actualCostMinor: 6000, decision: null, reviewed: false },
];
const examplePayables = [
  { id: 'p2', date: '2026-11-25', description: 'Light bulbs', amountMinor: 2500 },
  { id: 'p1', date: '2026-11-10', description: 'Boiler service', amountMinor: 6000 },
];
const ownerExpenses = [
  { date: '2026-11-01', amountMinor: 40000, category: 'mortgage' },
  { date: '2026-11-01', amountMinor: 15000, category: 'insurance' },
];
const november = (over = {}) => statementFor({ from: '2026-11-01', to: '2026-12-01', method: 'nights', terms: terms(), stays: exampleStays, cleans: exampleCleans(), payables: examplePayables, ownerExpenses, ...over });
const lineSum = r => r.lines.reduce((n, l) => n + l.amountMinor, 0);

test('the constants are the brief\'s assumptions', () => {
  assert.equal(VAT_BPS, 2000);
  assert.equal(FEE_BASE, 'payout_after_ota_fees_and_changeovers');
  assert.equal(STATEMENT_WAITS_FOR_CLEAN_REVIEW, true);
  assert.deepEqual([...DEDUCTION_ORDER], ['ota_fee', 'changeover', 'management_fee', 'vat', 'payable']);
  // Client answer 1 (Lee's decision): the fee is charged after platform fees and changeovers. Plain subtraction, like the SQL.
  assert.equal(feeBaseMinor(1000, 150, 300), 550);
  assert.equal(feeBaseMinor(1000, 150, 0), 850);
  assert.equal(feeBaseMinor(100, 0, 300), -200);
});

test('worked example: November 2026 matches the hand arithmetic', () => {
  const r = november();
  assert.equal(r.grossMinor, 175374);
  assert.equal(r.otaFeesMinor, 13372);
  // The fee is charged after platform fees and changeovers: 175374 - 13372 - 18000 = 144002; 15% is 21600.3 -> 21600.
  assert.equal(r.feeBaseMinor, 144002);
  assert.equal(r.changeoversMinor, 18000);
  assert.equal(r.feeMinor, 21600);
  assert.equal(r.vatMinor, 4320);
  assert.equal(r.payablesMinor, 8500);
  assert.equal(r.payoutMinor, 109582);
  assert.equal(r.nightsBooked, 15);
  assert.equal(r.nightsAvailable, 30);
  assert.equal(r.ownerExpensesMinor, 55000);
  assert.equal(r.netMinor, 54582);
  assert.equal(r.blocked, false, 'the flagged clean has been reviewed');
  assert.deepEqual(r.flags, ['clean_over_agreed:c2']);
  assert.equal(r.grossMinor - lineSum(r), r.payoutMinor);
  const booking = r.stays.find(s => s.id === 'booking');
  assert.deepEqual([booking.grossMinor, booking.otaFeeMinor, booking.payoutMinor, booking.nightsInPeriod, booking.nights], [51428, 8434, 42994, 5, 7]);
  // Lines in DEDUCTION_ORDER, each category in date order.
  assert.deepEqual(r.lines.map(l => [l.kind, l.refId, l.amountMinor]), [
    ['ota_fee', 'airbnb', 1546], ['ota_fee', 'vrbo', 3392], ['ota_fee', 'booking', 8434],
    ['changeover', 'c1', 6000], ['changeover', 'c2', 6000], ['changeover', 'c3', 6000],
    ['management_fee', null, 21600], ['vat', null, 4320],
    ['payable', 'p1', 6000], ['payable', 'p2', 2500],
  ]);
  assert.equal(r.lines.find(l => l.kind === 'management_fee').label, 'Management fee (15%)');
});

test('worked example: actual-cost mode charges 18500 in changeovers', () => {
  // Property mode actual cost; the flagged clean reviewed with no override.
  const byMode = november({ terms: terms({ cleanChargeMode: 'actual_cost' }), cleans: exampleCleans({ decision: null }) });
  assert.equal(byMode.changeoversMinor, 18500);
  // 500 more in changeovers lowers the fee base too: 143502 x 15% = 21525.3 -> 21525, VAT 4305.
  assert.equal(byMode.payoutMinor, 162002 - 18500 - 21525 - 4305 - 8500);
  // Agreed-fee property, but the review chose actual cost for every clean it looked at: only c2 moves.
  const byReview = november({ cleans: exampleCleans({ decision: 'actual_cost' }) });
  assert.equal(byReview.changeoversMinor, 6000 + 7500 + 6000);
  // Actual-cost property, review chose the agreed fee for c2: 5500 + 6000 + 5500.
  const override = november({ terms: terms({ cleanChargeMode: 'actual_cost' }) });
  assert.equal(override.changeoversMinor, 17000);
  // A stale review (decision kept, reviewed false) does not apply and the statement waits.
  const stale = november({ cleans: exampleCleans({ decision: 'actual_cost', reviewed: false }) });
  assert.equal(stale.changeoversMinor, 18000);
  assert.equal(stale.blocked, true);
});

test('worked example: December share of the Booking.com stay, November plus December add up', () => {
  const dec = statementFor({ from: '2026-12-01', to: '2027-01-01', method: 'nights', terms: terms(), stays: exampleStays, cleans: [], payables: [] });
  assert.equal(dec.grossMinor, 20572);
  assert.equal(dec.otaFeesMinor, 3374);
  assert.equal(dec.grossMinor - dec.otaFeesMinor, 17198);
  assert.equal(dec.nightsBooked, 2);
  assert.equal(dec.nightsAvailable, 31);
  const nov = november().stays.find(s => s.id === 'booking'), d = dec.stays.find(s => s.id === 'booking');
  assert.equal(nov.grossMinor + d.grossMinor, 72000);
  assert.equal(nov.otaFeeMinor + d.otaFeeMinor, 11808);
  assert.equal(nov.payoutMinor + d.payoutMinor, 60192);
});

test('fee rounds half pence away from zero; VAT is worked on the rounded fee', () => {
  const one = (settledMinor, over = {}) => statementFor({ from: '2026-11-01', to: '2026-12-01', method: 'nights', terms: terms(over), cleans: [], payables: [],
    stays: [{ id: 's', channel: 'direct', checkIn: '2026-11-05', checkOut: '2026-11-07', status: 'confirmed', settledMinor }] });
  // 30 x 15% = 4.5 -> 5; VAT 5 x 20% = 1.
  assert.deepEqual([one(30).feeMinor, one(30).vatMinor], [5, 1]);
  // 10 x 15% = 1.5 -> 2; VAT 0.4 -> 0.
  assert.deepEqual([one(10).feeMinor, one(10).vatMinor], [2, 0]);
  // 13 x 15% = 1.95 -> 2; 3 x 15% = 0.45 -> 0.
  assert.equal(one(13).feeMinor, 2);
  assert.equal(one(3).feeMinor, 0);
  // A refund (negative) rounds away from zero too: -30 x 15% = -4.5 -> -5, VAT -1.
  assert.deepEqual([one(-30).feeMinor, one(-30).vatMinor], [-5, -1]);
  // 12.5%: 4 -> 0.5 -> 1, 12 -> 1.5 -> 2, 20 -> 2.5 -> 3 (VAT 0.6 -> 1).
  assert.equal(one(4, { managementFeeBps: 1250 }).feeMinor, 1);
  assert.equal(one(12, { managementFeeBps: 1250 }).feeMinor, 2);
  assert.deepEqual([one(20, { managementFeeBps: 1250 }).feeMinor, one(20, { managementFeeBps: 1250 }).vatMinor], [3, 1]);
  // VAT at 20% of a whole fee is never exactly half a penny; check the nearest cases: 13 -> 2.6 -> 3, 12 -> 2.4 -> 2.
  assert.equal(one(87, { managementFeeBps: 1500 }).feeMinor, 13);
  assert.equal(one(87).vatMinor, 3);
  assert.equal(one(80).feeMinor, 12);
  assert.equal(one(80).vatMinor, 2);
});

test('VAT off gives VAT 0 and no VAT line', () => {
  const r = november({ terms: terms({ vatOnFee: false }) });
  assert.equal(r.vatMinor, 0);
  assert.equal(r.lines.some(l => l.kind === 'vat'), false);
  assert.equal(r.feeMinor, 21600);
  assert.equal(r.payoutMinor, 109582 + 4320);
});

// Seeded generator (mulberry32) so failures reproduce.
function generator(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isoDay = n => new Date(n * 86400000).toISOString().slice(0, 10);

test('a stay split across three periods adds up exactly (600 seeded cases)', () => {
  const random = generator(20261012), int = (low, high) => low + Math.floor(random() * (high - low + 1));
  const base = Date.UTC(2026, 0, 1) / 86400000;
  for (let i = 0; i < 600; i++) {
    const nights = int(2, 90), a = int(0, nights - 1), b = int(a + 1, nights);
    const checkIn = base + int(0, 700);
    const gross = int(0, 1) ? int(0, 5000000) : int(0, 2_000_000_000_000);
    const fee = int(0, gross);
    const stay = { id: 's', channel: 'booking_com', checkIn: isoDay(checkIn), checkOut: isoDay(checkIn + nights), status: 'confirmed', settledMinor: gross - fee, itemisedFeesMinor: fee };
    const run = (from, to) => statementFor({ from: isoDay(from), to: isoDay(to), method: 'nights', terms: terms(), stays: [stay], cleans: [], payables: [] });
    const parts = [run(checkIn - int(0, 40), checkIn + a), run(checkIn + a, checkIn + b), run(checkIn + b, checkIn + nights + int(1, 40))];
    const sum = key => parts.reduce((n, p) => n + p[key], 0);
    const label = `case ${i}: nights ${nights}, cuts ${a}/${b}, gross ${gross}, fee ${fee}`;
    assert.equal(sum('grossMinor'), gross, label);
    assert.equal(sum('otaFeesMinor'), fee, label);
    assert.equal(parts.reduce((n, p) => n + p.grossMinor - p.otaFeesMinor, 0), gross - fee, label);
    assert.equal(sum('nightsBooked'), nights, label);
    // Gross and fee are floored separately, so a part's payout share can sit one penny off the
    // payout pro-rated on its own (even -1p when the fee is close to gross); never more.
    const cuts = [[0, a], [a, b], [b, nights]];
    parts.forEach((p, k) => assert.ok(Math.abs(p.grossMinor - p.otaFeesMinor - prorate(gross - fee, cuts[k][0], cuts[k][1], nights)) <= 1, label));
  }
  // The smallest case of that: 3p gross, 2p fee, 5 nights, the third night alone.
  const tiny = { id: 't', channel: 'airbnb', checkIn: '2026-11-01', checkOut: '2026-11-06', status: 'confirmed', settledMinor: 1, itemisedFeesMinor: 2 };
  const third = statementFor({ from: '2026-11-03', to: '2026-11-04', method: 'nights', terms: terms(), stays: [tiny], cleans: [], payables: [] });
  assert.deepEqual([third.grossMinor, third.otaFeesMinor, third.feeBaseMinor], [0, 1, -1]);
});

test('prorate is exact for large and negative amounts and each share is within a penny of the exact value', () => {
  const random = generator(7), int = (low, high) => low + Math.floor(random() * (high - low + 1));
  for (let i = 0; i < 600; i++) {
    const nights = int(1, 400), before = int(0, nights), through = int(before, nights);
    const x = (int(0, 1) ? 1 : -1) * int(0, Number.MAX_SAFE_INTEGER);
    const share = prorate(x, before, through, nights);
    // |share x nights - x x (through - before)| < nights, checked in BigInt.
    const gap = BigInt(share) * BigInt(nights) - BigInt(x) * BigInt(through - before);
    assert.ok((gap < 0n ? -gap : gap) < BigInt(nights), `case ${i}`);
    assert.equal(prorate(x, 0, before, nights) + share + prorate(x, through, nights, nights), x, `case ${i}`);
  }
  assert.equal(prorate(72000, 0, 5, 7), 51428);
  assert.equal(prorate(72000, 5, 7, 7), 20572);
  assert.equal(prorate(-7, 0, 1, 2), -4);
  assert.equal(prorate(-7, 1, 2, 2), -3);
});

test('prorate refuses impossible inputs', () => {
  assert.throws(() => prorate(100, 0, 0, 0), RangeError);
  assert.throws(() => prorate(100, 0, 1, -1), RangeError);
  assert.throws(() => prorate(100, 2, 1, 3), RangeError);
  assert.throws(() => prorate(100, -1, 1, 3), RangeError);
  assert.throws(() => prorate(100, 0, 4, 3), RangeError);
  assert.throws(() => prorate(100, 0.5, 1, 3), RangeError);
  assert.throws(() => prorate(10.5, 0, 1, 3), RangeError);
  assert.throws(() => prorate(Number.MAX_SAFE_INTEGER + 1, 0, 1, 3), RangeError);
});

test('an owner stay counts as booked nights with no revenue; a cancelled stay is left out', () => {
  const r = statementFor({ from: '2026-11-01', to: '2026-12-01', method: 'nights', terms: terms(), cleans: [], payables: [], stays: [
    { id: 'owner', channel: 'other', checkIn: '2026-11-10', checkOut: '2026-11-17', status: 'confirmed', settledMinor: null, ownerStay: true },
    { id: 'gone', channel: 'airbnb', checkIn: '2026-11-20', checkOut: '2026-11-25', status: 'cancelled', settledMinor: 40000, itemisedFeesMinor: 1200 },
    { id: 'gone2', channel: 'airbnb', checkIn: '2026-11-26', checkOut: '2026-11-28', status: 'cancelled', settledMinor: null },
    { id: 'paid', channel: 'direct', checkIn: '2026-11-01', checkOut: '2026-11-03', status: 'confirmed', settledMinor: 20000 },
  ] });
  assert.equal(r.nightsBooked, 7 + 2);
  assert.equal(r.grossMinor, 20000);
  assert.equal(r.otaFeesMinor, 0);
  assert.equal(r.blocked, false, 'an unsettled owner or cancelled stay never blocks');
  assert.deepEqual(r.stays.map(s => s.id), ['paid', 'owner']);
  const owner = r.stays.find(s => s.id === 'owner');
  assert.deepEqual([owner.ownerStay, owner.grossMinor, owner.payoutMinor, owner.nightsInPeriod], [true, 0, 0, 7]);
  assert.deepEqual(r.flags, []);
});

test('an unreviewed flagged clean blocks the statement; an unflagged one does not', () => {
  const r = november({ cleans: exampleCleans({ decision: null, reviewed: false }) });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedReasons, ['clean_unreviewed:c2']);
  assert.deepEqual(r.flags, ['clean_over_agreed:c2']);
  // The figures are still worked out, at the agreed value, so the screen can show them.
  assert.equal(r.changeoversMinor, 18000);
  // Clean costing exactly the agreed value: tolerance 0, so not flagged.
  const exact = november({ cleans: [{ id: 'e', date: '2026-11-08', actualCostMinor: 6000, decision: null, reviewed: false }] });
  assert.deepEqual([exact.blocked, exact.flags], [false, []]);
  // A clean with no known cost in actual-cost mode is charged the agreed value and flagged.
  const unknown = november({ terms: terms({ cleanChargeMode: 'actual_cost' }), cleans: [{ id: 'u', date: '2026-11-08', actualCostMinor: null, decision: null, reviewed: false }] });
  assert.deepEqual([unknown.changeoversMinor, unknown.flags, unknown.blocked], [6000, ['clean_cost_unknown:u'], false]);
});

test('in actual-cost mode a flagged clean stays flagged but does not block, as the owner pays the real cost', () => {
  const r = november({ terms: terms({ cleanChargeMode: 'actual_cost' }), cleans: exampleCleans({ decision: null, reviewed: false }) });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.blockedReasons, []);
  assert.deepEqual(r.flags, ['clean_over_agreed:c2']);
  assert.equal(r.changeoversMinor, 18500);
});

test('an unsettled stay blocks; a platform stay with no fee data is flagged', () => {
  const r = statementFor({ from: '2026-11-01', to: '2026-12-01', method: 'nights', terms: terms(), cleans: [], payables: [], stays: [
    { id: 'wait', channel: 'airbnb', checkIn: '2026-11-03', checkOut: '2026-11-05', status: 'confirmed', settledMinor: null },
    { id: 'nofee', channel: 'vrbo', checkIn: '2026-11-06', checkOut: '2026-11-08', status: 'confirmed', settledMinor: 10000 },
  ] });
  assert.deepEqual(r.blockedReasons, ['stay_unsettled:wait']);
  assert.deepEqual(r.flags, ['ota_fee_unknown:nofee']);
  assert.equal(r.grossMinor, 10000);
});

test('check_in_month reproduces today\'s statement for a sample month', () => {
  const stays = [
    // Started in October: no money in November, but its November nights count for occupancy.
    { id: 'oct', channel: 'airbnb', checkIn: '2026-10-29', checkOut: '2026-11-02', status: 'confirmed', settledMinor: 48000, itemisedFeesMinor: 1500 },
    { id: 'a', channel: 'airbnb', checkIn: '2026-11-04', checkOut: '2026-11-09', status: 'confirmed', settledMinor: 61237, itemisedFeesMinor: 1894 },
    { id: 'b', channel: 'booking_com', checkIn: '2026-11-13', checkOut: '2026-11-16', status: 'confirmed', settledMinor: 33333, grossMinor: 40650 },
    // Starts in November, ends in December: all its money in November, as today.
    { id: 'c', channel: 'direct', checkIn: '2026-11-28', checkOut: '2026-12-04', status: 'confirmed', settledMinor: 54321 },
    { id: 'x', channel: 'airbnb', checkIn: '2026-11-18', checkOut: '2026-11-20', status: 'cancelled', settledMinor: 9999 },
  ];
  const cleans = [
    { id: 'k1', date: '2026-11-02', actualCostMinor: 4000, decision: null, reviewed: false },
    { id: 'k2', date: '2026-11-09', actualCostMinor: 4000, decision: null, reviewed: false },
    { id: 'k3', date: '2026-11-16', actualCostMinor: 4500, decision: null, reviewed: false },
  ];
  const payables = [{ id: 'e1', date: '2026-11-11', description: 'Plumber', amountMinor: 12345 }, { id: 'e2', date: '2026-10-31', description: 'Earlier', amountMinor: 999 }];
  const r = statementFor({ from: '2026-11-01', to: '2026-12-01', method: 'check_in_month', terms: terms({ managementFeeBps: 1200, vatOnFee: false, cleaningCostMinor: 4500 }), stays, cleans, payables });
  // Today (prepareStatement): revenue = settled payouts of confirmed stays checking in during the
  // month; cleaning = accepted cleans due in the month x cleaning cost; approved expenses received
  // in the month; fee = round(revenue x bps / 10000); payout = revenue - cleaning - expenses - fee.
  const revenue = 61237 + 33333 + 54321;
  // The fee is now charged after the cleaning too (client answer 1).
  const fee = Math.round((revenue - 3 * 4500) * 1200 / 10000);
  const today = { fee, payout: revenue - 3 * 4500 - 12345 - fee };
  assert.equal(r.feeBaseMinor, revenue - 3 * 4500);
  assert.equal(r.feeMinor, today.fee);
  assert.equal(r.payoutMinor, today.payout);
  assert.equal(r.changeoversMinor, 3 * 4500);
  assert.equal(r.payablesMinor, 12345);
  assert.equal(r.vatMinor, 0);
  assert.equal(r.grossMinor, revenue + 1894 + (40650 - 33333));
  // Occupancy as today's owner figures: nights inside the month from every confirmed stay touching it.
  assert.equal(r.nightsBooked, 1 + 5 + 3 + 3);
  assert.equal(r.stays.find(s => s.id === 'oct').grossMinor, 0);
  assert.equal(r.stays.find(s => s.id === 'c').grossMinor, 54321);
});

test('statementFor refuses bad periods, dates and terms', () => {
  const base = { from: '2026-11-01', to: '2026-12-01', method: 'nights', terms: terms(), stays: [], cleans: [], payables: [] };
  assert.throws(() => statementFor({ ...base, to: '2026-11-01' }), RangeError);
  assert.throws(() => statementFor({ ...base, from: '2026-02-30' }), RangeError);
  assert.throws(() => statementFor({ ...base, method: 'checkout' }), RangeError);
  assert.throws(() => statementFor({ ...base, terms: terms({ managementFeeBps: 10001 }) }), RangeError);
  assert.throws(() => statementFor({ ...base, stays: [{ id: 's', channel: 'direct', checkIn: '2026-11-05', checkOut: '2026-11-04', status: 'confirmed', settledMinor: 1 }] }), RangeError);
  assert.throws(() => statementFor({ ...base, payables: [{ id: 'p', date: '2026-11-05', description: 'x', amountMinor: 1.5 }] }), RangeError);
  const empty = statementFor(base);
  assert.deepEqual([empty.grossMinor, empty.feeMinor, empty.vatMinor, empty.payoutMinor, empty.netMinor, empty.nightsAvailable], [0, 0, 0, 0, null, 30]);
});
