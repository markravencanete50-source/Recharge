import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Report analytics (Lee: "Every reporting should have an analytics ... think like a data analyst"): the shared kit's maths
// (periods, the previous period, buckets, rounding, the change and which way is good, empty and low states, sorted bars)
// and each report's model, built from the figures that report already reads. The screens are in
// tests/report-analytics-screens.test.mjs, the database in the reports' own database tests.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const K = await vite.ssrLoadModule('/lib/report-analytics.ts');
const M = await vite.ssrLoadModule('/lib/report-analytics-models.ts');
const { chartTokens } = await vite.ssrLoadModule('/lib/design-tokens.ts');
const chart = (model, id) => model.charts.find(c => c.id === id);
const kpi = (model, key) => model.kpis.find(k => k.key === key);

test('periods: the dates each choice covers, counted back from today, and the previous period of the same length', () => {
  const today = '2026-10-18';
  assert.deepEqual(K.periodRange('30d', today), { from: '2026-09-19', to: '2026-10-18' });
  assert.deepEqual(K.periodRange('90d', today), { from: '2026-07-21', to: '2026-10-18' });
  assert.deepEqual(K.periodRange('12m', today), { from: '2025-10-19', to: '2026-10-18' }, '365 days, so it compares on equal terms');
  assert.deepEqual(K.periodRange('today', today), { from: today, to: today });
  assert.deepEqual(K.periodRange('month', today), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(K.periodRange('custom', today, { from: '2026-01-05', to: '2026-01-11' }), { from: '2026-01-05', to: '2026-01-11' });
  for (const key of ['7d', '30d', '90d', '12m']) assert.equal(K.rangeDays(K.periodRange(key, today)), { '7d': 7, '30d': 30, '90d': 90, '12m': 365 }[key]);
  // The previous period: the same number of days just before; whole months against as many whole months before.
  assert.deepEqual(K.previousRange({ from: '2026-09-19', to: '2026-10-18' }), { from: '2026-08-20', to: '2026-09-18' });
  assert.deepEqual(K.previousRange({ from: '2026-10-18', to: '2026-10-18' }), { from: '2026-10-17', to: '2026-10-17' });
  assert.deepEqual(K.previousRange({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(K.previousRange({ from: '2026-01-01', to: '2026-03-31' }), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(K.previousRange({ from: '2024-03-01', to: '2024-03-31' }), { from: '2024-02-01', to: '2024-02-29' }, 'a leap February');
  for (const key of ['7d', '30d', '90d', '12m']) { const r = K.periodRange(key, today), b = K.previousRange(r); assert.equal(K.rangeDays(b), K.rangeDays(r)); assert.equal(K.shiftDay(b.to, 1), r.from, 'touching, never overlapping'); }
  // Across the clocks going back (25 October 2026) a day is still a day.
  assert.equal(K.rangeDays({ from: '2026-10-20', to: '2026-10-30' }), 11);
  assert.equal(K.rangeError({ from: '2026-01-01', to: '2027-01-02' }), 'Choose up to 366 days.', '367 days');
  assert.equal(K.rangeError({ from: '2026-02-01', to: '2026-01-01' }), 'The last day must be on or after the first day.');
  assert.equal(K.rangeError({ from: '2025-10-19', to: '2026-10-19' }), '', '366 days is allowed');
  assert.equal(K.rangeLabel({ from: '2026-10-01', to: '2026-10-31' }), 'October 2026');
  assert.equal(K.rangeLabel({ from: '2026-09-19', to: '2026-10-18' }), '19 Sep to 18 Oct 2026');
  assert.equal(K.rangeLabel({ from: '2025-12-20', to: '2026-01-02' }), '20 Dec 2025 to 2 Jan 2026');
  assert.equal(K.previousLabel('30d', K.periodRange('30d', today)), 'vs the previous 30 days (20 Aug to 18 Sep 2026)');
});

test('buckets: days, weeks or months by length, clipped ends marked part, zeros where nothing happened and gaps where nothing to average', () => {
  assert.equal(K.grainFor({ from: '2026-10-01', to: '2026-10-31' }), 'day');
  assert.equal(K.grainFor({ from: '2026-07-21', to: '2026-10-18' }), 'week');
  assert.equal(K.grainFor({ from: '2025-10-19', to: '2026-10-18' }), 'month');
  const r = { from: '2026-10-01', to: '2026-10-18' };
  const weeks = K.buckets(r, 'week');
  assert.deepEqual(weeks.map(b => [b.key, b.from, b.to, b.partial]), [
    ['2026-09-28', '2026-10-01', '2026-10-04', true], ['2026-10-05', '2026-10-05', '2026-10-11', false], ['2026-10-12', '2026-10-12', '2026-10-18', false]]);
  assert.equal(weeks[1].label, 'w/c 5 Oct');
  const months = K.buckets({ from: '2026-08-15', to: '2026-10-18' }, 'month');
  assert.deepEqual(months.map(b => [b.label, b.partial]), [['Aug 26', true], ['Sep 26', false], ['Oct 26', true]]);
  assert.deepEqual(K.sumSeries([{ day: '2026-10-02', value: 2 }, { day: '2026-10-06', value: 1 }, { day: '2026-10-07', value: 3 }, { day: '2026-11-01', value: 9 }], r, 'week'), [2, 4, 0], 'outside the dates is left out; an empty week is a true zero');
  const avg = K.averageSeries([{ day: '2026-10-02', sum: 9, n: 2 }, { day: '2026-10-03', sum: 5, n: 1 }], r, 'week');
  assert.deepEqual(avg.values, [14 / 3, null, null], 'no reviews is a gap, never a zero');
  assert.deepEqual(avg.counts, [3, 0, 0]);
});

test('rounding: half away from zero, no binary surprises, no minus zero, en-GB grouping and shares that add up to 100', () => {
  assert.equal(K.roundTo(1.005, 2), 1.01);
  assert.equal(K.roundTo(2.5), 3); assert.equal(K.roundTo(-2.5), -3);
  assert.ok(Object.is(K.roundTo(-0.4), 0), 'never -0');
  assert.equal(K.roundTo(4.444, 1), 4.4); assert.equal(K.roundTo(4.45, 1), 4.5);
  assert.equal(K.formatFixed(1234.5), '1,235');
  assert.equal(K.formatFixed(4.25, 1), '4.3');
  assert.equal(K.formatFixed(-3), '−3', 'a true minus sign');
  assert.equal(K.formatFixed(null), '–');
  assert.equal(K.percentOf(1, 3), 33); assert.equal(K.percentOf(2, 3), 67); assert.equal(K.percentOf(1, 0), null);
  assert.deepEqual(K.sharesOf([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(K.sharesOf([0, 0]), [0, 0]);
  for (const list of [[3, 3, 3, 1], [7, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6, 7]]) assert.equal(K.sharesOf(list).reduce((a, b) => a + b, 0), 100, list.join());
  assert.deepEqual(K.sharesOf([999, 1, 0]).at(-1), 0, 'a zero part never gets a share');
  const s = K.niceScale(3, 47);
  assert.equal(s.min, 0); assert.ok(s.max >= 47); assert.ok([1, 2, 2.5, 5].includes(s.step / 10 ** Math.floor(Math.log10(s.step))));
  const stars = K.niceScale(3.6, 4.9, { zero: false, min: 1, max: 5 });
  assert.ok(stars.min >= 1 && stars.max <= 5 && stars.min <= 3.6 && stars.max >= 4.9, 'a rating axis hugs the data within 1 to 5');
});

test('the change against the previous period: arrow, size, percentage and the right colour for each figure', () => {
  const up = K.compare(12, 10, { better: 'up', against: 'vs the previous 30 days' });
  assert.deepEqual([up.direction, up.tone, up.change, up.relative, up.text], ['up', 'good', 2, 20, '+2 (+20%) vs the previous 30 days']);
  const late = K.compare(12, 10, { better: 'down' });
  assert.deepEqual([late.direction, late.tone], ['up', 'bad'], 'more overdue work is worse');
  const fewer = K.compare(8, 10, { better: 'down' });
  assert.deepEqual([fewer.direction, fewer.tone, fewer.text], ['down', 'good', '−2 (−20%)']);
  assert.equal(K.compare(8, 10, { better: 'none' }).tone, 'neutral', 'a plain volume is neither');
  assert.equal(K.compare(5, 0, { better: 'up' }).text, '+5 (new)');
  assert.deepEqual([K.compare(4, 4, { better: 'up' }).direction, K.compare(4, 4, { better: 'up' }).text], ['same', 'No change']);
  const none = K.compare(4, null, { better: 'up' });
  assert.deepEqual([none.direction, none.tone, none.text], ['none', 'neutral', 'No earlier figure to compare']);
  assert.equal(K.compare(null, 4, { better: 'up' }).direction, 'none');
  assert.equal(K.compare(63, 60, { better: 'up', kind: 'percent' }).text, '+3 pts');
  const rating = K.compare(4.62, 4.71, { better: 'up', kind: 'average', decimals: 2 });
  assert.deepEqual([rating.tone, rating.text], ['bad', '−0.09']);
  assert.equal(K.compare(4.704, 4.701, { better: 'up', kind: 'average', decimals: 2 }).direction, 'same', 'a change smaller than shown is no change');
  assert.equal(K.compare(250000, 200000, { better: 'down', format: n => '£' + n / 100 }).text, '−£500'.replace('−', '+') + ' (+25%)');
});

test('empty and low samples, and sorted bars with the rest behind "Show all"', () => {
  assert.equal(K.sampleState(0, 3), 'empty'); assert.equal(K.sampleState(2, 3), 'low'); assert.equal(K.sampleState(3, 3), 'ok');
  const rows = [
    { key: 'a', label: 'Birch', value: 3, display: '3' }, { key: 'b', label: 'Alder', value: 3, display: '3' },
    { key: 'c', label: 'Cedar', value: null, display: '–' }, { key: 'd', label: 'Damson', value: 9, display: '9' }, { key: 'e', label: 'Elm', value: 1, display: '1' }];
  const desc = K.rankBars(rows, 'desc', 3);
  assert.deepEqual(desc.rows.map(r => r.label), ['Damson', 'Alder', 'Birch'], 'highest first, ties by name');
  assert.equal(desc.hidden, 2); assert.equal(desc.all.at(-1).label, 'Cedar', 'no figure last');
  assert.deepEqual([desc.max, desc.min], [9, 1]);
  assert.deepEqual(K.rankBars(rows, 'asc').all.map(r => r.label), ['Elm', 'Alder', 'Birch', 'Damson', 'Cedar']);
  assert.equal(K.rankBars(rows, 'desc', 10).hidden, 0);
  assert.deepEqual(K.rankBars([], 'desc'), { rows: [], all: [], hidden: 0, max: 0, min: 0 });
  // Every chart has words for a screen reader with the same figures.
  const stack = { kind: 'stack', id: 's', title: 'Status', unit: 'Share', total: '3', state: 'ok', parts: K.stackParts([{ key: 'x', label: 'Done', value: 2, colour: 'good' }, { key: 'y', label: 'Open', value: 1, colour: 'neutral' }]) };
  assert.equal(K.chartSummary(stack), 'Status. Total 3. Done 2, 67%, Open 1, 33%.');
  assert.equal(K.chartSummary({ ...stack, state: 'empty', emptyText: 'Nothing here.' }), 'Status. Nothing here.');
});

test('the chart colours: six series in a fixed order for light and dark, separate from the status colours', () => {
  for (const mode of ['light', 'dark']) {
    const values = Object.values(chartTokens[mode]);
    assert.deepEqual(Object.keys(chartTokens[mode]), ['series1', 'series2', 'series3', 'series4', 'series5', 'series6']);
    assert.equal(new Set(values).size, 6);
    for (const v of values) assert.match(v, /^#[0-9A-F]{6}$/);
  }
  assert.notDeepEqual(chartTokens.light, chartTokens.dark, 'dark mode has its own steps, not a flip');
  assert.deepEqual(K.SERIES, ['series1', 'series2', 'series3', 'series4', 'series5', 'series6']);
});

// --- Ratings ---------------------------------------------------------------------------------------------------------

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const ratingsData = {
  sync: { lastRunAt: null, lastSuccessAt: null, complete: true, lastError: null, unlinked: 0 },
  property: null,
  properties: [
    { propertyId: A, propertyName: 'Harbour Flat', linked: true, reviews: 5, average: 4.6, recentReviews: 3, recentAverage: 4.33, hostawayReviews: 5, teamReviews: 0, latestOn: '2026-10-10' },
    { propertyId: B, propertyName: 'Glen Lodge', linked: true, reviews: 4, average: 3.5, recentReviews: 1, recentAverage: 2, hostawayReviews: 4, teamReviews: 0, latestOn: '2026-10-01' },
    { propertyId: C, propertyName: 'Quiet Bothy', linked: false, reviews: 0, average: null, recentReviews: 0, recentAverage: null, hostawayReviews: 0, teamReviews: 0, latestOn: null },
  ],
  // [day, star, reviews, sum of stars]
  points: {
    [A]: [['2026-05-02', 5, 2, 10], ['2026-08-30', 5, 1, 5], ['2026-09-20', 4, 1, 4], ['2026-10-10', 4, 1, 4]],
    [B]: [['2026-05-10', 4, 2, 8], ['2026-06-01', 4, 1, 4], ['2026-10-01', 2, 1, 2]],
  },
};
const today = '2026-10-18', r90 = K.periodRange('90d', today), p90 = K.previousRange(r90);

test('ratings: the portfolio, the last 90 days against the 90 before, reviews, five stars and properties under 4.0', () => {
  const m = M.ratingsModel(ratingsData, r90, p90, 'vs the previous 90 days');
  // All time: A 10+5+4+4=23 from 5, B 8+4+2=14 from 4: 37/9 = 4.11.
  assert.equal(kpi(m, 'portfolio').value, '4.1'); assert.equal(kpi(m, 'portfolio').note, 'All time, from 9 reviews');
  // In the dates (21 Jul to 18 Oct): A 5,4,4 and B 2 = 15/4 = 3.75; before (22 Apr to 20 Jul): A 10/2, B 8/2 + 4/1 = 22/5 = 4.4.
  assert.equal(kpi(m, 'period').value, '3.8');
  assert.deepEqual([kpi(m, 'period').delta.tone, kpi(m, 'period').delta.text], ['bad', '−0.65 vs the previous 90 days']);
  assert.equal(kpi(m, 'reviews').value, '4'); assert.equal(kpi(m, 'reviews').delta.text, '−1 (−20%) vs the previous 90 days');
  assert.equal(kpi(m, 'reviews').delta.tone, 'bad', 'fewer reviews is worse');
  assert.equal(kpi(m, 'five').value, '25%'); assert.equal(kpi(m, 'five').delta.text, '−15 pts vs the previous 90 days', 'one of four against two of five');
  // Below 4.0 on the all-time average: B (14/4 = 3.5) now; at the start of the dates B was 12/3 = 4.0, so none.
  assert.equal(kpi(m, 'below').value, '1'); assert.equal(kpi(m, 'below').delta.tone, 'bad');
  assert.equal(m.kpis.length, 5);
  assert.match(m.source, /out of 5/);
});

test('ratings: the monthly line with gaps and counts, the star mix, properties against the portfolio and the biggest movers', () => {
  const m = M.ratingsModel(ratingsData, r90, p90, 'vs the previous 90 days');
  const line = chart(m, 'rating-trend');
  assert.equal(line.kind, 'line'); assert.deepEqual(line.labels, ['Jul 26', 'Aug 26', 'Sep 26', 'Oct 26']);
  assert.deepEqual(line.series[0].values, [null, 5, 4, 3], 'a month with no reviews is a gap');
  assert.deepEqual(line.extras[0].values, [0, 1, 1, 2], 'with the reviews behind each point');
  assert.deepEqual([line.yMin, line.yMax, line.reference.value], [1, 5, 4.11]);
  assert.deepEqual(line.partial, [true, false, false, true]);
  assert.equal(line.state, 'ok');
  assert.deepEqual(chart(m, 'star-mix').rows.map(r => r.value), [0, 1, 0, 2, 1]);
  const bars = chart(m, 'by-property');
  assert.equal(bars.order, 'asc', 'lowest first, where the problems are');
  assert.deepEqual(bars.rows.map(r => [r.label, r.value, r.muted]), [['Harbour Flat', 4.33, false], ['Glen Lodge', 2, true]]);
  assert.equal(bars.reference.value, 3.75, 'the portfolio average in these dates');
  assert.match(bars.subtitle, /1 property had no reviews in these dates/);
  const movers = chart(m, 'movers');
  assert.deepEqual(movers.rows.map(r => [r.label, r.change, r.tone, r.direction]), [['Harbour Flat', '−0.27', 'bad', 'down']], 'only properties with 3 or more reviews in the dates');
});

test('ratings: empty, low and older-server states say so instead of drawing', () => {
  const quiet = M.ratingsModel(ratingsData, { from: '2026-01-01', to: '2026-01-31' }, { from: '2025-12-01', to: '2025-12-31' }, 'vs December 2025');
  assert.equal(chart(quiet, 'rating-trend').state, 'empty');
  assert.equal(kpi(quiet, 'period').empty, true); assert.equal(kpi(quiet, 'period').value, '–');
  assert.equal(chart(quiet, 'by-property').state, 'empty'); assert.equal(chart(quiet, 'movers').state, 'empty');
  const r30 = K.periodRange('30d', today), thin = M.ratingsModel(ratingsData, r30, K.previousRange(r30), '');
  assert.equal(chart(thin, 'rating-trend').state, 'ok');
  const one = M.ratingsModel(ratingsData, { from: '2026-10-05', to: '2026-10-11' }, { from: '2026-09-28', to: '2026-10-04' }, '');
  assert.equal(chart(one, 'rating-trend').state, 'low', 'one week with reviews is not a trend');
  assert.match(chart(one, 'rating-trend').lowText, /Not enough reviews to chart/);
  assert.match(kpi(one, 'period').note, /Too few to read much into/);
  const old = M.ratingsModel({ ...ratingsData, points: undefined }, r90, p90, '');
  assert.deepEqual([old.kpis, old.charts], [[], []]); assert.match(old.note, /once the report analytics update is installed/);
  assert.deepEqual(M.ratingPoints(null), []);
});

// --- Business reports, stays, overview and the rest -------------------------------------------------------------------

const r30 = { from: '2026-09-19', to: '2026-10-18' };
test('to-dos, repairs and time: the trend from the day-by-day figures, the status mix and the right good direction', () => {
  const todos = { from: r30.from, to: r30.to, total: 10, done: 6, doneLate: 2, overdue: 3, open: 4,
    byDepartment: [{ department: 'cleaning', total: 4, done: 1, doneLate: 0, overdue: 2 }, { department: 'guest_relations', total: 6, done: 5, doneLate: 2, overdue: 1 }],
    byPerson: [], byDay: [{ day: '2026-10-01', total: 4, done: 3, doneLate: 1, overdue: 1 }, { day: '2026-10-10', total: 6, done: 3, doneLate: 1, overdue: 2 }] };
  const before = { ...todos, total: 10, done: 5, doneLate: 1, overdue: 1, open: 5 };
  const m = M.todosModel(todos, before, r30, 'vs before');
  assert.equal(kpi(m, 'rate').value, '60%'); assert.equal(kpi(m, 'rate').delta.text, '+10 pts vs before');
  assert.equal(kpi(m, 'late').delta.tone, 'bad'); assert.equal(kpi(m, 'overdue').delta.tone, 'bad');
  assert.deepEqual(chart(m, 'status').parts.map(p => [p.key, p.value, p.colour]), [['onTime', 4, 'good'], ['late', 2, 'warn'], ['overdue', 3, 'bad'], ['open', 1, 'neutral']]);
  assert.equal(chart(m, 'status').parts.reduce((n, p) => n + p.share, 0), 100);
  assert.deepEqual(chart(m, 'by-department').rows.map(r => r.value), [25, 83]);
  assert.equal(chart(m, 'todos-trend').series[0].values.reduce((a, b) => a + b, 0), 10);
  // Without the day-by-day figures (an older server) the trend says why instead of drawing zeros.
  const old = M.todosModel({ ...todos, byDay: undefined }, null, r30, '');
  assert.equal(chart(old, 'todos-trend').state, 'empty'); assert.match(chart(old, 'todos-trend').emptyText, /report analytics update/);
  assert.equal(kpi(old, 'done').delta.text, 'No earlier figure to compare');

  const repairs = { from: r30.from, to: r30.to, raised: 3, completed: 2, quotedMinor: 50000, quotedRepairs: 2, finalMinor: 0, finalRepairs: 0,
    byStage: [{ stage: 'triage', count: 2 }, { stage: 'completed', count: 1 }], spend: { approvedMinor: 20000, waitingMinor: 5000, rejectedMinor: 0, expenses: 2 },
    byProperty: [], byDay: [{ day: '2026-10-01', raised: 2, completed: 0 }, { day: '2026-10-05', raised: 1, completed: 2 }] };
  const rm = M.repairsModel(repairs, { ...repairs, spend: { ...repairs.spend, approvedMinor: 10000 } }, r30, 'vs before');
  assert.equal(kpi(rm, 'spend').delta.tone, 'bad', 'more spend is worse'); assert.equal(kpi(rm, 'raised').delta.tone, 'neutral');
  assert.deepEqual(chart(rm, 'stages').parts.map(p => p.key), ['triage', 'completed'], 'in the order a repair moves');

  const time = { from: r30.from, to: r30.to, minutes: 600, unpaidMinutes: 30, overtimeMinutes: 60, shifts: 2, running: 0, byPerson: [], byDepartment: [{ department: 'cleaning', minutes: 600, unpaidMinutes: 30, overtimeMinutes: 60, shifts: 2, people: 1 }],
    byDay: [{ day: '2026-10-01', minutes: 300, people: 1, shifts: 1 }, { day: '2026-10-02', minutes: 300, people: 1, shifts: 1 }] };
  const tm = M.timeModel(time, null, r30, '');
  assert.equal(kpi(tm, 'hours').value, '10.0'); assert.equal(kpi(tm, 'perShift').value, '5h 00m');
  assert.equal(chart(tm, 'hours-trend').series[0].values.filter(Boolean).length, 2);
});

test('enquiries and messages: trend from the rows, funnel, sources, and reply times against the target', () => {
  const enquiries = { from: r30.from, to: r30.to, received: 3, priority: 1, bySource: { form: 2, app: 1 }, byStart: [],
    funnel: { received: 3, estimate: 2, agreement: 1, live: 1, declined: 0 },
    reply: { replied: 2, waiting: 1, medianMinutes: 90, slowestMinutes: 120, estimateSent: 2, estimateMedianMinutes: 100, estimateSlowestMinutes: 200 },
    rows: [{ receivedAt: '2026-10-01T09:00:00Z', source: 'form', propertyName: null, startWhen: '', reached: 'live', declined: false, replyMinutes: 60, estimateMinutes: 90 },
      { receivedAt: '2026-10-05T09:00:00Z', source: 'form', propertyName: null, startWhen: '', reached: 'estimate', declined: false, replyMinutes: 120, estimateMinutes: 100 },
      { receivedAt: '2026-10-05T23:30:00Z', source: 'app', propertyName: null, startWhen: '', reached: 'received', declined: false, replyMinutes: null, estimateMinutes: null }] };
  const m = M.enquiriesModel(enquiries, { ...enquiries, reply: { ...enquiries.reply, medianMinutes: 60 } }, r30, 'vs before');
  assert.equal(kpi(m, 'estimate').value, '67%');
  assert.equal(kpi(m, 'reply').delta.tone, 'bad', 'a slower first reply is worse');
  const line = chart(m, 'enquiries-trend');
  assert.equal(line.series[0].values.reduce((a, b) => a + b, 0), 3);
  assert.equal(line.series[0].values[line.labels.indexOf('6 Oct')], 1, 'dated by the UK day (23:30 UTC in October is the next morning in London)');
  const messages = { from: r30.from, to: r30.to, amberMinutes: 30,
    byChannel: [{ channel: 'airbnb', received: 10, sent: 8 }, { channel: 'whatsapp', received: 2, sent: 2 }, { channel: 'client_email', received: 1, sent: 1 }],
    byWeek: [{ week: '2026-09-14', channel: 'airbnb', received: 4, sent: 4 }, { week: '2026-10-12', channel: 'airbnb', received: 6, sent: 4 }],
    byMonth: [], replyTimes: [{ channel: 'airbnb', count: 8, medianMinutes: 20, slowestMinutes: 60 }, { channel: 'whatsapp', count: 2, medianMinutes: 45, slowestMinutes: 50 }] };
  const mm = M.messagesModel(messages, null, r30, '');
  assert.equal(kpi(mm, 'within').value, '1 of 2');
  assert.equal(chart(mm, 'messages-trend').series[0].values[0], 4, 'a week starting before the dates counts in the first week');
  assert.deepEqual(chart(mm, 'reply-times').reference, { value: 30, label: 'Target (amber), minutes' });
  assert.deepEqual(chart(mm, 'channel-share').parts.map(p => [p.key, p.colour]), [['airbnb', 'series1'], ['whatsapp', 'series5'], ['other', 'neutral']], 'each channel keeps its colour; the rest fold into Other');
});

test('stays, the business overview, productivity, team performance and my performance', () => {
  const month = (m, stays) => ({ month: m, stays, nights: stays * 3, averageNights: 3, guestsKnown: stays, averageGuests: 2, leadKnown: stays, averageLeadDays: 20 });
  const stays = { from: '2026-08-01', to: '2026-10-31', propertyId: null, channel: null, stays: 12, nights: 36, averageNights: 3,
    guests: { known: 10, total: 22, average: 2.2 }, mix: { adults: { known: 0, total: 0, stays: 0 }, children: { known: 0, total: 0, stays: 0 }, infants: { known: 0, total: 0, stays: 0 }, pets: { known: 0, total: 0, stays: 0 } },
    lengths: [{ bucket: '1', stays: 2 }], arrivalDays: [{ day: 5, stays: 3 }, { day: 1, stays: 2 }], leadTime: { known: 10, averageDays: 21.4, buckets: [] },
    channels: [{ channel: 'direct', stays: 2 }, { channel: 'airbnb', stays: 10 }], countries: { known: 0, others: 0, top: [] },
    byMonth: [month('2026-09', 5), month('2026-08', 4), month('2026-10', 3)], byProperty: [] };
  const sm = M.staysModel(stays, { ...stays, stays: 10 }, { from: '2026-08-01', to: '2026-10-31' }, 'vs May to July');
  assert.equal(kpi(sm, 'stays').delta.text, '+2 (+20%) vs May to July');
  assert.deepEqual(chart(sm, 'stays-trend').labels, ['Aug 26', 'Sep 26', 'Oct 26'], 'months in order');
  assert.deepEqual(chart(sm, 'channels').parts.map(p => p.key), ['airbnb', 'direct']);
  assert.deepEqual(chart(sm, 'arrivals').rows.map(r => r.label), ['Mon', 'Fri']);
  assert.equal(chart(sm, 'countries').state, 'empty');
  assert.equal(chart(M.staysModel({ ...stays, byMonth: [month('2026-10', 3)] }, null, { from: '2026-10-01', to: '2026-10-31' }, ''), 'stays-trend').state, 'low');

  const day = (key, recorded, completed) => ({ key, recorded, completed, waiting: 0 });
  const now = { total: 6, complete: 3, waiting: 1, properties: 4, status: [{ name: 'Completed', value: 3, kind: 'complete' }, { name: 'Waiting', value: 1, kind: 'waiting' }, { name: 'In progress', value: 2, kind: 'progress' }],
    queues: [{ name: 'Cleans', value: 4 }, { name: 'Maintenance', value: 2 }], trend: [day('2026-10-01', 2, 1), day('2026-10-02', 4, 2)] };
  const om = M.overviewModel(now, { ...now, total: 4, complete: 1, waiting: 2 }, true, r30, 'vs before');
  assert.equal(kpi(om, 'waiting').delta.tone, 'good', 'less waiting work is better');
  assert.equal(kpi(om, 'rate').value, '50%');
  assert.deepEqual(chart(om, 'status').parts.map(p => p.colour), ['good', 'warn', 'series3'], 'a status bar, not a donut');
  assert.deepEqual(M.overviewModel(now, now, false, r30, '').kpis.map(k => k.empty), [true]);

  const person = (id, minutes, dept) => ({ userId: id, fullName: 'P ' + id, department: dept, minutes, shifts: 2, days: 2, overtimeMinutes: 30, weeks: [{ start: '2026-10-12', minutes }], months: [] });
  const pm = M.productivityModel({ people: [person('a', 600, 'cleaning'), person('b', 0, null)] }, { people: [person('a', 300, 'cleaning')] }, r30, 'vs before', d => d);
  assert.deepEqual([kpi(pm, 'hours').value, kpi(pm, 'people').value, kpi(pm, 'perPerson').value], ['10.0', '1', '10.0']);
  assert.deepEqual([kpi(pm, 'overtime').delta.text, kpi(pm, 'overtime').delta.tone], ['+0.5 (+100%) vs before', 'bad'], 'more overtime is worse');

  const perf = { messages: 5, targets: { passPercent: 80, amberMinutes: 30 }, unassigned: { green: 1, amber: 0, red: 1 },
    people: [{ userId: 'a', fullName: 'Ann', minutes: 600, shifts: 2, green: 6, amber: 1, red: 1, score: 85, onTrack: true }, { userId: 'b', fullName: 'Bob', minutes: 0, shifts: 0, green: 0, amber: 0, red: 0, score: null, onTrack: null }] };
  const tp = M.teamPerformanceModel(perf, null, r30, '');
  assert.equal(kpi(tp, 'onTime').value, '70%'); assert.equal(kpi(tp, 'onTrack').value, '1 of 1');
  assert.deepEqual(chart(tp, 'scores').reference, { value: 80, label: 'On track from' });

  const mine = M.myPerformanceModel({ score: 90, replies: 10, repliesGreen: 8, repliesGreenPercent: 80, tasksDone: 5, minutes: 300, shifts: 2, amber: 1, red: 1 }, { score: 85, replies: 5, repliesGreen: 5, repliesGreenPercent: 100, tasksDone: 6, minutes: 200, shifts: 1 }, 'vs the previous 7 days');
  assert.deepEqual([kpi(mine, 'score').delta.tone, kpi(mine, 'onTime').delta.tone, kpi(mine, 'tasks').delta.tone], ['good', 'bad', 'bad']);
  assert.deepEqual(chart(mine, 'my-replies').parts.map(p => p.value), [8, 1, 1]);
  assert.doesNotMatch(JSON.stringify(mine), /£|amountMinor|bonusPercent/, 'no pay on the person\'s own page');
});

test('decisions, invoices, accounts performance and Furnishing Studio', () => {
  const d = (at, outcome, area = 'repairs', amountMinor = null) => ({ at, area, outcome, amountMinor, by: 'Lee' });
  const rows = [d('2026-10-10T10:00:00Z', 'approved', 'repairs', 10000), d('2026-10-01T10:00:00Z', 'declined'), d('2026-09-01T10:00:00Z', 'approved')];
  const r30d = K.periodRange('30d', today);
  const dm = M.decisionsModel(rows, r30d, K.previousRange(r30d), 'vs before', today, a => a);
  assert.deepEqual([kpi(dm, 'decisions').value, kpi(dm, 'approved').value, kpi(dm, 'decisions').delta.text], ['2', '50%', '+1 (+100%) vs before']);
  const r90d = K.periodRange('90d', today), long = M.decisionsModel(rows, r90d, K.previousRange(r90d), 'vs before', today, a => a);
  assert.equal(kpi(long, 'decisions').delta.direction, 'none', 'nothing is read before the last 90 days');
  assert.match(long.note, /last 90 days only/);

  const inv = (status, issued, paid, amount = 10000, currency = 'GBP') => ({ amount_minor: amount, currency, status, issued_on: issued, paid_at: paid });
  const im = M.invoicesModel([inv('paid', '2026-10-01', '2026-10-05T10:00:00Z'), inv('issued', '2026-10-10', null), inv('issued', '2026-08-01', null), inv('paid', '2026-10-02', null, 5000, 'EUR')], r30, K.previousRange(r30), 'vs before', s => s);
  assert.deepEqual([kpi(im, 'issued').value, kpi(im, 'paid').value, kpi(im, 'outstanding').value], ['£200', '£100', '£200']);
  assert.match(kpi(im, 'issued').note, /2 invoices/, 'pounds only: the euro invoice is left out');

  const fig = (fee, occ) => ({ managementFeeMinor: fee, cleaningMarginMinor: 1000, occupancyBps: occ, averageNightlyRateMinor: 10000, grossRevenueMinor: 0, nightsBooked: 10 });
  const perf = { totals: fig(50000, 6550), byMonth: [{ ...fig(20000, 6000), period: '2026-09' }, { ...fig(30000, 7000), period: '2026-10' }], byProperty: [], byChannel: [{ channel: 'airbnb', grossRevenueMinor: 0, nightsBooked: 10 }] };
  const am = M.performanceModel(perf, { ...perf, totals: fig(40000, 6000) }, 'vs before', m => m, c => c);
  assert.equal(kpi(am, 'occupancy').value, '65.5%'); assert.equal(kpi(am, 'occupancy').delta.text, '+5.5 pts vs before');
  assert.equal(kpi(am, 'fees').delta.tone, 'good');
  assert.deepEqual(chart(am, 'fees-trend').series[0].values, [200, 300]);

  const furn = { projects: 4, sent: 3, accepted: 1, declined: 1, conversionPercent: 50, quotedPence: 300000, acceptedPence: 100000, byMonth: [{ month: '2026-10', sent: 3, accepted: 1, quotedPence: 300000 }], byStatus: [{ status: 'sent', projects: 2 }], topBySpend: [] };
  const fm = M.furnishingModel(furn, null, '', m => m, s => s);
  assert.equal(chart(fm, 'quotes-trend').state, 'low'); assert.equal(chart(fm, 'top-spend').state, 'empty');
});

test('the kit files keep CRLF and no em dashes, and the ratings model never reaches owners', () => {
  for (const file of ['lib/report-analytics.ts', 'lib/report-analytics-models.ts', 'mobile/src/AnalyticsKit.tsx', 'mobile/src/InvoiceAnalytics.tsx', 'supabase/migrations/20261023300000_report_analytics.sql']) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF');
    assert.doesNotMatch(text, /—/, file + ' has no em dash');
  }
  assert.doesNotMatch(readFileSync('mobile/src/LiveClientReports.tsx', 'utf8'), /rating/i, 'the owner reports never show ratings');
});

test('richer charts (Lee: "different colors different type of graphs"): donuts for shares, rings for rates, areas and columns for trends, colours by meaning', () => {
  assert.equal(K.seriesAt(0), 'series1'); assert.equal(K.seriesAt(7), 'series2');
  assert.deepEqual([K.toneOf(4.6, 4.5, 4), K.toneOf(4.2, 4.5, 4), K.toneOf(3.9, 4.5, 4), K.toneOf(null, 1, 0)], ['good', 'warn', 'bad', 'neutral']);
  assert.deepEqual([K.toneOf(10, 15, 30, 'down'), K.toneOf(20, 15, 30, 'down'), K.toneOf(45, 15, 30, 'down')], ['good', 'warn', 'bad'], 'a slower reply is worse');
  const donut = { kind: 'donut', id: 'd', title: 'Sources', unit: 'Share', total: '4', state: 'ok', parts: K.stackParts([{ key: 'a', label: 'Form', value: 3, colour: 'series1' }, { key: 'b', label: 'App', value: 1, colour: 'series2' }]) };
  assert.equal(K.chartSummary(donut), 'Sources. Total 4. Form 3, 75%, App 1, 25%.');
  assert.equal(K.chartSummary({ kind: 'rings', id: 'r', title: 'Rates', state: 'ok', rows: [{ key: 'x', label: 'Done', value: 60, display: '60%', colour: 'good' }] }), 'Rates. Done 60%.');

  const todos = { from: r30.from, to: r30.to, total: 10, done: 6, doneLate: 2, overdue: 3, open: 4,
    byDepartment: [{ department: 'cleaning', total: 4, done: 1, doneLate: 0, overdue: 2 }, { department: 'guest_relations', total: 6, done: 5, doneLate: 2, overdue: 1 }], byPerson: [], byDay: [] };
  const m = M.todosModel(todos, null, r30, '');
  assert.equal(chart(m, 'todos-trend').style, 'area');
  assert.deepEqual(chart(m, 'rates').rows.map(r => [r.key, r.value, r.colour]), [['done', 60, 'series1'], ['onTime', 67, 'good'], ['overdue', 30, 'bad']]);
  assert.deepEqual(chart(m, 'by-department').rows.map(r => r.colour), ['bad', 'good'], 'each department coloured by how it is doing');

  const kinds = new Set();
  const ratings = M.ratingsModel({ properties: [{ propertyId: 'p', propertyName: 'Flat' }], points: { p: [['2026-10-01', 5, 2, 10], ['2026-10-08', 3, 1, 3]] } }, r30, { from: '2026-08-20', to: '2026-09-18' }, '');
  for (const c of [...ratings.charts, ...m.charts]) kinds.add(c.kind === 'line' ? 'line-' + (c.style ?? 'line') : c.kind);
  assert.deepEqual(chart(ratings, 'star-mix').rows.map(r => r.colour), ['bad', 'bad', 'warn', 'series3', 'good'], 'one to five stars from red to green');
  assert.ok(kinds.size >= 5, 'several kinds of chart on one report pair: ' + [...kinds].join(', '));
});
