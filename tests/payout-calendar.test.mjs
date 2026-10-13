import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The check-in calendar on Accounts -> Reconciliation -> Platform stays (lib/payout-calendar.ts), which replaced the day chips.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const cal = await vite.ssrLoadModule('/lib/payout-calendar.ts');
const picker = await vite.ssrLoadModule('/lib/calendar-picker.ts');
after(() => vite.close());

let n = 0;
const stay = (over = {}) => ({ reservationId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, version: 1, checkIn: '2026-10-01', settledMinor: null,
  state: 'missing', expectedMinor: 30000, receivedMinor: null, agreedMinor: null, channel: 'airbnb', ...over });
const rows = [
  stay({ checkIn: '2026-10-01' }), stay({ checkIn: '2026-10-01', channel: 'booking_com' }),
  stay({ checkIn: '2026-10-02' }), stay({ checkIn: '2026-10-02', state: 'different', receivedMinor: 28000 }),
  stay({ checkIn: '2026-10-02', state: 'matched', receivedMinor: 30000, settledMinor: 30000 }),
  stay({ checkIn: '2026-10-09', state: 'no_reference', expectedMinor: null }),
  stay({ checkIn: '2026-10-20', channel: 'booking_com', state: 'agreed', settledMinor: 30000, agreedMinor: 30000 }),
];
// What the screen does: platform, then status, then the calendar.
const inView = (status, platform = 'all') => live.filterPayouts(platform === 'all' ? rows : rows.filter(r => r.channel === platform), status);

test('each day counts the stays in view, for the status and platform chosen', () => {
  assert.deepEqual(cal.payoutDayCounts(inView('open')), { '2026-10-01': 2, '2026-10-02': 2, '2026-10-09': 1 });
  assert.deepEqual(cal.payoutDayCounts(inView('settled')), { '2026-10-02': 1, '2026-10-20': 1 });
  assert.deepEqual(cal.payoutDayCounts(inView('all')), { '2026-10-01': 2, '2026-10-02': 3, '2026-10-09': 1, '2026-10-20': 1 });
  assert.deepEqual(cal.payoutDayCounts(inView('open', 'booking_com')), { '2026-10-01': 1 });
  assert.deepEqual(cal.payoutDayCounts(inView('all', 'booking_com')), { '2026-10-01': 1, '2026-10-20': 1 });
  // On the calendar: the counts on their days, nothing on the others, days outside the data muted.
  const counts = cal.payoutDayCounts(inView('open')), bounds = cal.payoutDataBounds(rows);
  assert.deepEqual(bounds, { from: '2026-10-01', to: '2026-10-20' });
  const cells = picker.pickerWeeks('2026-10', { today: '2026-10-13', counts, dataFrom: bounds.from, dataTo: bounds.to }).flat();
  const c = d => cells.find(x => x.date === d);
  assert.deepEqual([c('2026-10-02').count, c('2026-10-03').count, c('2026-10-20').count, c('2026-10-21').muted, c('2026-10-10').muted], [2, null, null, true, false]);
});

test('choosing a day narrows the list; choosing it again, or All dates, clears it; an empty day cannot be chosen', () => {
  const counts = cal.payoutDayCounts(inView('open'));
  let day = cal.togglePayoutDay(null, '2026-10-02', counts);
  assert.equal(day, '2026-10-02');
  assert.deepEqual(cal.payoutCalendarScope(inView('open'), day).list.map(r => r.checkIn), ['2026-10-02', '2026-10-02']);
  assert.equal(cal.togglePayoutDay(day, '2026-10-02', counts), null, 'the same day again');
  assert.equal(cal.togglePayoutDay(day, null, counts), null, 'All dates');
  assert.equal(cal.togglePayoutDay(day, '2026-10-01', counts), '2026-10-01', 'another day moves the choice');
  assert.equal(cal.togglePayoutDay(null, '2026-10-05', counts), null, 'nothing checks in that day');
  assert.equal(cal.payoutCalendarScope(inView('open'), null).list.length, 5);
});

test('the day\'s approve works on that day only, holding back the same stays as Approve all; Approve all keeps the whole set', () => {
  const { day, all } = cal.payoutCalendarScope(inView('open'), '2026-10-02');
  const ids = new Set(rows.filter(r => r.checkIn === '2026-10-02').map(r => r.reservationId));
  assert.equal(day.items.length, 1);
  assert.ok(day.items.every(i => ids.has(i.reservationId)));
  assert.deepEqual([day.heldBack, day.needDetails], [1, 0], 'the stay paid a different amount is held back, as before');
  assert.deepEqual([all.items.length, all.heldBack, all.needDetails], [3, 1, 1]);
  assert.deepEqual(day, live.bulkPayoutPlan(rows.filter(r => r.checkIn === '2026-10-02' && r.settledMinor === null), false));
  assert.equal(cal.payoutCalendarScope(inView('open'), null).day, null);
});

test('the month: opens on the chosen day, else the first stay, else the period; arrows move a month', () => {
  assert.equal(cal.payoutCalendarMonth('2026-11-03', rows, '2026-10'), '2026-11');
  assert.equal(cal.payoutCalendarMonth(null, rows, '2026-12'), '2026-10');
  assert.equal(cal.payoutCalendarMonth(null, [], '2026-12'), '2026-12');
  assert.equal(picker.shiftMonth('2026-10', 1), '2026-11');
  assert.equal(picker.shiftMonth('2026-01', -1), '2025-12');
});

test('the screen: the calendar instead of the day chips, both approve buttons, filters and search kept', () => {
  const screen = readFileSync('mobile/src/PayoutStays.tsx', 'utf8');
  assert.match(screen, /<CalendarPicker key=\{periodLabel\} p=\{p\} mode="single"/);
  assert.doesNotMatch(screen, /Choose one or more|payoutDates\(/);
  assert.match(screen, /Approve these \$\{formatCount\(approvableDay\)\}/);
  assert.match(screen, /openSheet\("day"\)/); assert.match(screen, /openSheet\("all"\)/);
  assert.match(screen, /`Approve all \$\{formatCount\(approvable\)\}`/);
  for (const kept of ['label="All platforms"', 'open: "To approve", settled: "Approved or matched", all: "All"', '<SearchBox', 'accessibilityLabel="All dates"']) assert.ok(screen.includes(kept), kept);
});
