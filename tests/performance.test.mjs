import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The Performance report's screen helpers (lib/performance.ts): the shapes it reads (whole numbers only), the
// occupancy label, the period choices and typed dates (to is the first day not included), and the query sent.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const {
  formatOccupancy, periodRange, customRange, rangeLabel, rangeDays, addDays, performanceQuery, regionOptions, performanceMonthLabel, hasActivity,
  performanceReportSchema, performanceFiguresSchema, PERFORMANCE_PERIODS, PERIOD_LABEL, PERFORMANCE_CHANNELS, PERFORMANCE_HELP, MAX_PERFORMANCE_DAYS,
} = await vite.ssrLoadModule('/lib/performance.ts');

const figures = (over = {}) => ({
  managementFeeMinor: 37500, vatMinor: 5400, cleaningChargedMinor: 32000, cleaningCostMinor: 27000, cleaningMarginMinor: 5000,
  cleanCount: 5, cleansWithoutCost: 1, statementCount: 3, grossRevenueMinor: 205547, nightsBooked: 27, nightsAvailable: 122,
  occupancyBps: 2213, nightsSold: 20, averageNightlyRateMinor: 10277, ...over,
});
const sample = (over = {}) => ({
  section: 'performance', from: '2026-09-01', to: '2026-11-01', days: 61, filters: { propertyId: null, region: null, channel: null },
  totals: figures(),
  byProperty: [{ propertyId: 'a1b2c3d4-0000-4000-8000-000000000001', propertyName: 'Glen Cottage', region: 'Highlands', ...figures({ cleaningMarginMinor: -1000 }) }],
  byMonth: [{ period: '2026-09', from: '2026-09-01', to: '2026-10-01', ...figures({ averageNightlyRateMinor: null, occupancyBps: null }) }],
  byChannel: [{ channel: 'vrbo', nightsBooked: 4, occupancyBps: 328, grossRevenueMinor: 0, nightsSold: 0, averageNightlyRateMinor: null }],
  ...over,
});

test('occupancy reads as a percentage with at most one decimal', () => {
  assert.equal(formatOccupancy(5000), '50%');
  assert.equal(formatOccupancy(2213), '22.1%');
  assert.equal(formatOccupancy(2419), '24.2%');
  assert.equal(formatOccupancy(2415), '24.2%', 'half a tenth rounds up');
  assert.equal(formatOccupancy(2414), '24.1%');
  assert.equal(formatOccupancy(0), '0%');
  assert.equal(formatOccupancy(10000), '100%');
  assert.equal(formatOccupancy(4), '0%');
  assert.equal(formatOccupancy(5), '0.1%');
  for (const blank of [null, undefined, -1, 12.5, Number.NaN]) assert.equal(formatOccupancy(blank), '–');
});

test('the report shape accepts whole numbers only and nulls where a rate has no nights', () => {
  const parsed = performanceReportSchema.parse(sample());
  assert.equal(parsed.totals.averageNightlyRateMinor, 10277);
  assert.equal(parsed.byMonth[0].averageNightlyRateMinor, null);
  assert.equal(parsed.byProperty[0].cleaningMarginMinor, -1000, 'a margin can be negative');
  for (const bad of [{ managementFeeMinor: 375.5 }, { nightsBooked: -1 }, { occupancyBps: 22.13 }, { vatMinor: '5400' }, { averageNightlyRateMinor: 10277.35 }]) {
    assert.equal(performanceFiguresSchema.safeParse(figures(bad)).success, false, JSON.stringify(bad));
  }
  assert.equal(performanceReportSchema.safeParse(sample({ section: 'payoutLines' })).success, false);
  assert.equal(performanceReportSchema.safeParse(sample({ byMonth: [{ ...sample().byMonth[0], period: '2026-13' }] })).success, false);
  assert.equal(performanceReportSchema.safeParse({ ...sample(), totals: undefined }).success, false);
});

test('period choices: this month, last month, the three whole months before this one, this year', () => {
  assert.deepEqual(PERFORMANCE_PERIODS, ['this_month', 'last_month', 'last_3_months', 'this_year', 'custom']);
  assert.deepEqual(PERFORMANCE_PERIODS.map(p => PERIOD_LABEL[p]), ['This month', 'Last month', 'Last 3 months', 'This year', 'Choose dates']);
  const today = '2026-10-13';
  assert.deepEqual(periodRange('this_month', today), { from: '2026-10-01', to: '2026-11-01' });
  assert.deepEqual(periodRange('last_month', today), { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(periodRange('last_3_months', today), { from: '2026-07-01', to: '2026-10-01' });
  assert.deepEqual(periodRange('this_year', today), { from: '2026-01-01', to: '2027-01-01' });
  // Across the turn of the year, and in December.
  assert.deepEqual(periodRange('last_month', '2027-01-05'), { from: '2026-12-01', to: '2027-01-01' });
  assert.deepEqual(periodRange('last_3_months', '2027-02-28'), { from: '2026-11-01', to: '2027-02-01' });
  assert.deepEqual(periodRange('this_month', '2026-12-31'), { from: '2026-12-01', to: '2027-01-01' });
  assert.equal(rangeDays(periodRange('this_year', '2028-06-01')), 366, 'a leap year fits the report limit');
  assert.throws(() => periodRange('this_month', '13/10/2026'), /Today must be a date/);
});

test('typed dates: both days included on screen, the day after the last sent as the end', () => {
  assert.deepEqual(customRange('2026-09-01', '2026-10-31'), { from: '2026-09-01', to: '2026-11-01' });
  assert.deepEqual(customRange(' 2026-09-29 ', '2026-09-29'), { from: '2026-09-29', to: '2026-09-30' }, 'one day');
  assert.deepEqual(customRange('2026-01-01', '2026-12-31'), { from: '2026-01-01', to: '2027-01-01' });
  assert.match(customRange('2026-02-30', '2026-03-01').error, /YYYY-MM-DD/);
  assert.match(customRange('', '2026-03-01').error, /YYYY-MM-DD/);
  assert.match(customRange('2026-03-02', '2026-03-01').error, /on or after/);
  assert.match(customRange('2026-01-01', '2027-01-02').error, /366 days/, '367 days is too many');
  assert.deepEqual(customRange('2028-01-01', '2028-12-31'), { from: '2028-01-01', to: '2029-01-01' }, '366 days is allowed');
  assert.equal(MAX_PERFORMANCE_DAYS, 366);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.match(rangeLabel({ from: '2026-09-01', to: '2026-11-01' }), /^1 Sept? 2026 to 31 Oct 2026$/, 'the last day shown is the day before the end');
  assert.equal(rangeLabel({ from: '2026-09-29', to: '2026-09-30' }).includes(' to '), false);
  assert.equal(rangeLabel({ from: '2026-09-29', to: '2026-09-29' }), '');
});

test('the query carries the section, the dates and only the filters that are set', () => {
  const range = { from: '2026-09-01', to: '2026-11-01' };
  assert.deepEqual(performanceQuery(range), { section: 'performance', from: '2026-09-01', to: '2026-11-01' });
  assert.deepEqual(performanceQuery(range, { propertyId: 'p1', region: ' Highlands ', channel: 'direct' }),
    { section: 'performance', from: '2026-09-01', to: '2026-11-01', propertyId: 'p1', region: 'Highlands', channel: 'direct' });
  assert.deepEqual(performanceQuery(range, { propertyId: null, region: '  ', channel: null }), { section: 'performance', from: '2026-09-01', to: '2026-11-01' });
  assert.deepEqual(PERFORMANCE_CHANNELS, ['airbnb', 'booking_com', 'vrbo', 'direct', 'other']);
});

test('region choices, month labels and the help line', () => {
  assert.deepEqual(regionOptions([{ region: 'Highlands' }, { region: ' edinburgh' }, { region: 'Edinburgh' }, { region: '' }, { region: null }, {}, { region: 'highlands' }]), ['edinburgh', 'Highlands']);
  assert.equal(performanceMonthLabel('2026-09'), 'September 2026');
  assert.equal(hasActivity({ statementCount: 0, nightsBooked: 0, cleanCount: 0 }), false);
  assert.equal(hasActivity({ statementCount: 0, nightsBooked: 3, cleanCount: 0 }), true);
  for (const words of [/issued and paid statements/, /VAT/, /not income/, /owner stays included/, /channel filter changes stays only/]) assert.match(PERFORMANCE_HELP, words);
  assert.doesNotMatch(PERFORMANCE_HELP, new RegExp(String.fromCharCode(0x2014)), 'no em dashes');
});
