import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Accounts -> Performance and Statements (Lee: "minimize buttons"): one date field that opens the calendar instead of the
// period chips, and a dropdown each for region and channel instead of rows of chips. The reads are the same as before.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const P = await vite.ssrLoadModule('/lib/performance.ts');
const C = await vite.ssrLoadModule('/lib/calendar-picker.ts');
const performance = readFileSync('mobile/src/AccountsPerformance.tsx', 'utf8');
const statements = readFileSync('mobile/src/AccountsStatements.tsx', 'utf8');

test('Performance: the calendar range drives the report exactly as the period chips and typed dates did', () => {
  const today = '2026-10-13';
  // The default is this month, as the "This month" chip was.
  const month = P.periodRange('this_month', today);
  assert.deepEqual(month, { from: '2026-10-01', to: '2026-11-01' });
  assert.equal(P.lastDayOfRange(month), '2026-10-31');
  // "Whole month" on the calendar gives the same range as the chip.
  const whole = C.wholeMonth('2026-09');
  assert.deepEqual(P.customRange(whole.from, whole.to), P.periodRange('last_month', today));
  // A range across months, chosen on the calendar: the same query typed dates made.
  const across = P.customRange('2026-08-20', '2026-10-05');
  assert.deepEqual(across, { from: '2026-08-20', to: '2026-10-06' });
  assert.deepEqual(P.performanceQuery(across, { propertyId: null, region: null, channel: null }), P.performanceQuery({ from: '2026-08-20', to: '2026-10-06' }, { propertyId: null, region: null, channel: null }));
  assert.match(P.customRange('2026-10-05', '2026-08-20').error, /on or after/);
  // The screen: one date field, no period chips, no typed date fields.
  assert.match(performance, /<DateField p=\{p\} label="Dates" value=\{\{ from: range\.from, to: lastDayOfRange\(range\) \}\} onChange=\{chooseDates\}/);
  assert.doesNotMatch(performance, /PERFORMANCE_PERIODS|PERIOD_LABEL|Choose dates|First day \(YYYY-MM-DD\)|Show these dates/);
});

test('Performance: region and channel are dropdowns with the same values the chips had', () => {
  assert.deepEqual(P.regionFilterOptions(['Edinburgh', 'Glasgow']), [{ value: 'all', label: 'All regions' }, { value: 'Edinburgh', label: 'Edinburgh' }, { value: 'Glasgow', label: 'Glasgow' }]);
  assert.deepEqual(P.CHANNEL_FILTER_OPTIONS.map(o => o.label), ['All channels', 'Airbnb', 'Booking.com', 'Vrbo', 'Direct', 'Other']);
  assert.deepEqual(P.CHANNEL_FILTER_OPTIONS.map(o => o.value), ['all', ...P.PERFORMANCE_CHANNELS]);
  // "all" sends no filter; anything else is sent as the chip's value was.
  const range = { from: '2026-10-01', to: '2026-11-01' };
  assert.deepEqual(P.performanceQuery(range, { propertyId: null, region: 'Edinburgh', channel: 'airbnb' }), { section: 'performance', from: '2026-10-01', to: '2026-11-01', region: 'Edinburgh', channel: 'airbnb' });
  assert.match(performance, /<Dropdown p=\{p\} label="Region" value=\{region\} onChange=\{setRegion\} options=\{regionFilterOptions\(regions\)\} \/>/);
  assert.match(performance, /<Dropdown p=\{p\} label="Channel" value=\{channel\} onChange=\{setChannel\} options=\{CHANNEL_FILTER_OPTIONS\} \/>/);
  assert.doesNotMatch(performance, /label=\{v => v === ALL \? "All regions"|"All channels" : CHANNEL_LABEL/);
});

test('Statements: no month chips or Custom dates; one date field', () => {
  assert.match(statements, /<DateField p=\{p\} label="Dates"/);
  assert.doesNotMatch(statements, /label="Custom dates"|MONTHS_SHOWN|First day" value=\{fromText\}/);
});
