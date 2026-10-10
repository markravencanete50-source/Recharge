import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The rules behind the Payouts list (lib/accounts-live.ts): what each row can do, the figures it shows, the date filter
// and what "Approve all" would include. The database repeats the approval rules; tests/payout-bulk-approval-database.test.mjs
// checks that the two agree.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { matchesSearch } = await vite.ssrLoadModule('/lib/search-options.ts');
after(() => vite.close());

let n = 0;
const stay = (over = {}) => ({
  reservationId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, version: 1, checkIn: '2026-10-01', settledMinor: null,
  state: 'missing', expectedMinor: 30000, receivedMinor: null, agreedMinor: null, ...over,
});

test('a row offers to approve, to add details, or nothing', () => {
  assert.equal(live.payoutMove(stay({ state: 'missing' })), 'approve');
  assert.equal(live.payoutMove(stay({ state: 'different', receivedMinor: 28000 })), 'approve');
  assert.equal(live.payoutMove(stay({ state: 'matched', receivedMinor: 30000, settledMinor: 30000 })), 'none');
  assert.equal(live.payoutMove(stay({ state: 'agreed', receivedMinor: null, settledMinor: 30000, agreedMinor: 30000 })), 'none');
  assert.equal(live.payoutMove(stay({ state: 'no_reference', expectedMinor: null })), 'details');
  assert.equal(live.payoutMove(stay({ state: 'no_expected_amount', expectedMinor: null })), 'details');
});

test('the amount approved is the one the button shows: expected before payment, received after a different payment', () => {
  assert.deepEqual(live.payoutApproval(stay({ state: 'missing', expectedMinor: 30687 })), { agreedMinor: 30687, basis: 'expected' });
  assert.deepEqual(live.payoutApproval(stay({ state: 'different', expectedMinor: 40000, receivedMinor: 35000 })), { agreedMinor: 35000, basis: 'received' });
  assert.equal(live.payoutApproval(stay({ state: 'matched', receivedMinor: 30000 })), null);
});

test('an amount the database would refuse is never offered for approval', () => {
  assert.equal(live.payoutApproval(stay({ state: 'missing', expectedMinor: null })), null);
  assert.equal(live.payoutApproval(stay({ state: 'missing', expectedMinor: -100 })), null);
  assert.equal(live.payoutApproval(stay({ state: 'missing', expectedMinor: 100_000_001 })), null);
  assert.deepEqual(live.payoutApproval(stay({ state: 'missing', expectedMinor: 100_000_000 })), { agreedMinor: 100_000_000, basis: 'expected' });
  assert.equal(live.payoutApproval(stay({ state: 'different', expectedMinor: 100, receivedMinor: -5 })), null);
  assert.equal(live.payoutMove(stay({ state: 'different', expectedMinor: 100, receivedMinor: -5 })), 'details', 'a negative payout needs a person to look');
  assert.deepEqual(live.payoutApproval(stay({ state: 'different', expectedMinor: 100, receivedMinor: 0 })), { agreedMinor: 0, basis: 'received' });
});

test('the difference is received minus expected, and only when both are known', () => {
  assert.equal(live.payoutDifference({ expectedMinor: 30000, receivedMinor: 28550 }), -1450);
  assert.equal(live.payoutDifference({ expectedMinor: 30000, receivedMinor: 31000 }), 1000);
  assert.equal(live.payoutDifference({ expectedMinor: 30000, receivedMinor: 30000 }), 0);
  assert.equal(live.payoutDifference({ expectedMinor: 30000, receivedMinor: null }), null);
  assert.equal(live.payoutDifference({ expectedMinor: null, receivedMinor: 30000 }), null);
});

test('the list filters by kind and by any number of check-in dates', () => {
  const rows = [
    stay({ checkIn: '2026-10-01' }), stay({ checkIn: '2026-10-01', state: 'different', receivedMinor: 100 }), stay({ checkIn: '2026-10-02' }),
    stay({ checkIn: '2026-10-02', state: 'matched', settledMinor: 100, receivedMinor: 100 }), stay({ checkIn: '2026-10-05', state: 'agreed', settledMinor: 100 }),
  ];
  assert.equal(live.filterPayouts(rows, 'open').length, 3);
  assert.equal(live.filterPayouts(rows, 'settled').length, 2);
  assert.equal(live.filterPayouts(rows, 'all').length, 5);
  assert.equal(live.filterPayouts(rows, 'open', ['2026-10-01']).length, 2);
  assert.equal(live.filterPayouts(rows, 'open', ['2026-10-01', '2026-10-02']).length, 3);
  assert.equal(live.filterPayouts(rows, 'open', ['2026-10-05']).length, 0, 'nothing open on a date where everything is settled');
  assert.equal(live.filterPayouts(rows, 'all', ['2026-10-02', '2026-10-05']).length, 3);
  assert.equal(live.filterPayouts(rows, 'open', []).length, 3, 'no dates chosen means every date');
  assert.equal(live.filterPayouts(rows, 'open', ['2026-11-01']).length, 0);
});

test('the dates offered are the ones present, earliest first, with their counts', () => {
  const rows = [stay({ checkIn: '2026-10-09' }), stay({ checkIn: '2026-10-02' }), stay({ checkIn: '2026-10-09' }), stay({ checkIn: '2026-10-02' }), stay({ checkIn: '2026-10-02' })];
  assert.deepEqual(live.payoutDates(rows), [{ date: '2026-10-02', count: 3 }, { date: '2026-10-09', count: 2 }]);
  assert.deepEqual(live.payoutDates([]), []);
});

test('the totals add only the amounts that are known', () => {
  const rows = [stay({ expectedMinor: 30000, receivedMinor: null }), stay({ expectedMinor: 20000, receivedMinor: 19000 }), stay({ expectedMinor: null, receivedMinor: 500 })];
  assert.deepEqual(live.payoutTotals(rows), { count: 3, expectedMinor: 50000, receivedMinor: 19500 });
  assert.deepEqual(live.payoutTotals([]), { count: 0, expectedMinor: 0, receivedMinor: 0 });
});

test('Approve all takes the unpaid stays, holds back different amounts unless included, and skips what needs details', () => {
  const unpaid = [stay({ expectedMinor: 30000 }), stay({ expectedMinor: 20000 })];
  const short = stay({ state: 'different', expectedMinor: 40000, receivedMinor: 35000 });
  const rows = [
    ...unpaid, short, stay({ state: 'no_reference', expectedMinor: null }), stay({ state: 'matched', receivedMinor: 100, settledMinor: 100 }),
    stay({ state: 'agreed', settledMinor: 100 }), stay({ state: 'missing', expectedMinor: -1 }),
  ];
  const plain = live.bulkPayoutPlan(rows, false);
  assert.deepEqual(plain.items.map(i => i.reservationId), unpaid.map(r => r.reservationId));
  assert.deepEqual(plain.atExpected, { count: 2, minor: 50000 });
  assert.deepEqual(plain.atReceived, { count: 0, minor: 0 });
  assert.equal(plain.heldBack, 1); assert.equal(plain.needDetails, 2); assert.equal(plain.settled, 2);

  const all = live.bulkPayoutPlan(rows, true);
  assert.equal(all.items.length, 3);
  assert.deepEqual(all.atExpected, { count: 2, minor: 50000 });
  assert.deepEqual(all.atReceived, { count: 1, minor: 35000 });
  assert.equal(all.heldBack, 0);
  assert.deepEqual(all.items.at(-1), { reservationId: short.reservationId, version: short.version }, 'each item carries the version the person saw');
  assert.equal(live.bulkPayoutPlan([], false).items.length, 0);
});

test('long lists go out in requests the server accepts', () => {
  const items = Array.from({ length: 600 }, (_, i) => i);
  const parts = live.chunk(items, live.BULK_PAYOUT_CHUNK);
  assert.deepEqual(parts.map(p => p.length), [250, 250, 100]);
  assert.deepEqual(parts.flat(), items);
  assert.deepEqual(live.chunk([], 250), []);
  assert.ok(live.BULK_PAYOUT_CHUNK <= 500, 'the server accepts 500 stays in one request');
});

test('the results of several requests add up to one summary', () => {
  const part = (approved, minor, skipped = {}) => ({ approved, approvedMinor: minor, atExpected: approved, atReceived: 0, skipped: { changed: 0, settled: 0, needsDetails: 0, different: 0, locked: 0, notFound: 0, ...skipped } });
  const sum = live.sumBulkApprovals([part(250, 1000), part(50, 400, { changed: 2, different: 1 }), part(0, 0, { changed: 1, locked: 4 })]);
  assert.equal(sum.approved, 300); assert.equal(sum.approvedMinor, 1400); assert.equal(sum.atExpected, 300);
  assert.deepEqual(sum.skipped, { changed: 3, settled: 0, needsDetails: 0, different: 1, locked: 4, notFound: 0 });
  assert.deepEqual(live.sumBulkApprovals([]).skipped, { changed: 0, settled: 0, needsDetails: 0, different: 0, locked: 0, notFound: 0 });
});

test('the search finds a stay by anything its row shows, in any order and any case', () => {
  const row = stay({ reference: 'HA:66902511', channel: 'airbnb', channelReference: '447681-guest-83986167-confirmation-HMBPSEXT5X', checkIn: '2026-10-01', state: 'missing', expectedMinor: 30687, receivedMinor: null });
  const text = live.payoutSearchText(row, '39 (Lower) Pitt Street');
  for (const query of ['66902511', 'ha 6690', 'HMBPSEXT5X', 'confirmation-hmbpsext5x', 'airbnb', 'pitt lower', 'LOWER pitt street', '1 oct', '2026-10-01', '306.87', '£306.87', 'not received', 'pitt airbnb 1 oct'])
    assert.ok(matchesSearch(text, query), `should find "${query}"`);
  for (const query of ['booking', 'HMCCT5Q8JT', '99999', 'approved', 'pitt 2 nov', 'matched'])
    assert.ok(!matchesSearch(text, query), `should not find "${query}"`);
  assert.ok(matchesSearch(text, ''), 'an empty search matches everything');
  assert.ok(matchesSearch(text, '   '), 'so does one made of spaces');
});

test('the search reads the status and the amounts the row shows now, not stale ones', () => {
  const approved = live.payoutSearchText(stay({ reference: 'HA:1', channel: 'booking_com', state: 'agreed', expectedMinor: 30000, receivedMinor: null, agreedMinor: 28500, settledMinor: 28500 }));
  assert.ok(matchesSearch(approved, 'approved'));
  assert.ok(matchesSearch(approved, 'booking.com'));
  assert.ok(matchesSearch(approved, '285.00'), 'the amount agreed is searchable');
  assert.ok(!matchesSearch(approved, 'not received'));
  const short = live.payoutSearchText(stay({ reference: 'HA:2', state: 'different', expectedMinor: 30000, receivedMinor: 28000 }), 'The Mill');
  assert.ok(matchesSearch(short, 'different amount') && matchesSearch(short, 'the mill') && matchesSearch(short, '280'));
  // A stay with nothing known yet is still found by its reference and its place.
  const bare = live.payoutSearchText(stay({ reference: 'HA:3', channel: 'airbnb', state: 'no_reference', expectedMinor: null, receivedMinor: null }), undefined);
  assert.ok(matchesSearch(bare, 'ha 3') && matchesSearch(bare, 'needs platform code'));
  assert.ok(!matchesSearch(bare, 'undefined') && !matchesSearch(bare, 'null'), 'a missing value never turns into a word');
});

test('the figures, the counts and Approve all read the same rows once a search narrows the list', () => {
  const rows = [
    stay({ reference: 'HA:10', channel: 'airbnb', checkIn: '2026-10-01', expectedMinor: 10000 }),
    stay({ reference: 'HA:11', channel: 'airbnb', checkIn: '2026-10-02', expectedMinor: 20000 }),
    stay({ reference: 'HA:12', channel: 'booking_com', checkIn: '2026-10-02', expectedMinor: 40000 }),
    stay({ reference: 'HA:13', channel: 'airbnb', checkIn: '2026-10-02', state: 'matched', expectedMinor: 5000, receivedMinor: 5000, settledMinor: 5000 }),
  ];
  const place = { [rows[0].reservationId]: 'Mill', [rows[1].reservationId]: 'Pitt', [rows[2].reservationId]: 'Pitt', [rows[3].reservationId]: 'Pitt' };
  // The same steps the screen takes: search, then status, then dates, then the totals and the plan from what is left.
  const inView = (query, status, dates) => {
    const searched = rows.filter(r => matchesSearch(live.payoutSearchText(r, place[r.reservationId]), query));
    const scope = live.filterPayouts(live.filterPayouts(searched, status), 'all', dates);
    return { scope, dates: live.payoutDates(live.filterPayouts(searched, status)), totals: live.payoutTotals(scope), plan: live.bulkPayoutPlan(scope, false) };
  };
  const pitt = inView('pitt', 'open', []);
  assert.deepEqual(pitt.scope.map(r => r.reference), ['HA:11', 'HA:12'], 'the settled stay and the other property are out');
  assert.deepEqual(pitt.dates, [{ date: '2026-10-02', count: 2 }], 'dates with nothing left to show disappear from the chips');
  assert.equal(pitt.totals.expectedMinor, 60000);
  assert.deepEqual(pitt.plan.items.map(i => i.reservationId), pitt.scope.map(r => r.reservationId), 'Approve all is exactly what the list shows');
  const pittAirbnb = inView('pitt airbnb', 'open', ['2026-10-02']);
  assert.deepEqual(pittAirbnb.scope.map(r => r.reference), ['HA:11']);
  assert.equal(pittAirbnb.plan.atExpected.minor, 20000);
  assert.equal(inView('nothing like this', 'all', []).scope.length, 0);
  assert.equal(inView('', 'all', []).scope.length, rows.length, 'no search leaves everything in view');
});

test('the words on screen say approved, not agreed', () => {
  assert.equal(live.PAYOUT_LABEL.agreed[0], 'Approved');
  assert.equal(live.PAYOUT_LABEL.missing[0], 'Not received');
  assert.equal(live.CHANNEL_LABEL.airbnb, 'Airbnb');
  assert.equal(live.CHANNEL_LABEL.booking_com, 'Booking.com');
});
