import {
  averageSeries, buckets, compare, formatFixed, grainFor, percentOf, rangeDays, roundTo, stackParts, sumSeries,
  type AnalyticsModel, type BarRow, type ChartColour, type ChartSpec, type Grain, type Kpi, type Range, SERIES,
} from './report-analytics';
import { formatCount, formatDuration, formatMoney, formatMoneyShort, plural } from './format';
import { workspaceDateKey } from './analytics';
import {
  channelName, channelOrder, departmentName, funnelSteps, repairStageName, SOURCE_LABEL, startWhenName, waitLabel,
  type EnquiriesReport, type MessagesReport, type RepairsReport, type TimeReport, type TodosReport,
} from './business-reports-view';
import { arrivalDayName, countryName, LEAD_LABEL, LENGTH_LABEL, stayChannelName, type StayAnalytics } from './stay-analytics-view';
import { starsValue, type PropertyRatings } from './property-ratings';
import { REPAIR_STAGES } from './repairs-live';

// What each report's analytics section shows, built from the figures the report already reads (lib/report-analytics.ts
// describes the kit). One builder per report; each returns the headline figures and the charts, and nothing it cannot
// back with data: a figure with no data reads "–" and says why, a trend with too few points says so instead of a line.
// `now` is the chosen period's answer and `before` the previous period's of the same length (null when it could not be read).

const counted = (n: number, one: string, many = one + 's') => plural(n, one, many);
const kpiEmpty = (key: string, label: string, note: string): Kpi => ({ key, label, value: '–', note, empty: true });
const pct = (n: number | null) => (n === null ? '–' : `${formatFixed(n)}%`);
const hoursOf = (minutes: number) => roundTo(minutes / 60, 1);
const hoursText = (hours: number) => formatFixed(hours, hours < 100 ? 1 : 0);
// "Weekly", "Daily" or "Monthly", for a chart's subtitle.
const grainWord = (g: Grain) => (g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly');
const grainNoun = (g: Grain) => (g === 'day' ? 'day' : g === 'week' ? 'week' : 'month');
// A line needs two points with data to be a trend.
const lineState = (values: readonly (number | null)[], total: number) => (total <= 0 ? 'empty' as const : values.filter(v => v !== null && v !== 0).length < 2 ? 'low' as const : 'ok' as const);
const lowLine = (g: Grain) => `Not enough to chart a trend: fewer than two ${grainNoun(g)}s with any in these dates. Choose a longer period.`;
const lineBits = (r: Range, g: Grain = grainFor(r)) => { const b = buckets(r, g); return { grain: g, labels: b.map(x => x.label), partial: b.map(x => x.partial) }; };

// --- Ratings ------------------------------------------------------------------------------------------------------------

export const RATINGS_MIN_REVIEWS = 3;
export type RatingPoint = { propertyId: string; day: string; stars: number; n: number; sum: number };
// The database's compact points ({ propertyId: [[day, star 1 to 5, reviews, sum of stars], ...] }) as rows.
export function ratingPoints(points: Record<string, [string, number, number, number][]> | null | undefined): RatingPoint[] {
  if (!points) return [];
  return Object.entries(points).flatMap(([propertyId, rows]) => rows.map(([day, stars, n, sum]) => ({ propertyId, day, stars, n, sum })));
}
const avgOf = (rows: readonly RatingPoint[]) => { const n = rows.reduce((s, r) => s + r.n, 0); return { n, average: n ? rows.reduce((s, r) => s + r.sum, 0) / n : null }; };
const inRange = (r: Range) => (x: { day: string }) => x.day >= r.from && x.day <= r.to;
const stars = (n: number | null) => (n === null ? '–' : starsValue(n) ?? '–');

// Reports > Ratings: the portfolio's rating, how the chosen dates compare with the dates before, how many reviews and how
// many of them five stars, which properties sit under 4.0, the rating month by month, the star mix, every property's
// rating in the dates against the portfolio's, and the properties whose rating in the dates moved most from their own.
export function ratingsModel(data: PropertyRatings, range: Range, previous: Range, against: string): AnalyticsModel {
  const source = 'Source: guest reviews from Hostaway and the reviews the team logs. Stars are out of 5 (scores out of 10 are halved) and dated by when the guest left the review, UK time.';
  if (!data.points) return { kpis: [], charts: [], source, note: 'The rating charts appear once the report analytics update is installed on the database.' };
  const points = ratingPoints(data.points), names = new Map(data.properties.map(x => [x.propertyId, x.propertyName]));
  const all = avgOf(points), atStart = avgOf(points.filter(x => x.day < range.from));
  const now = points.filter(inRange(range)), before = points.filter(inRange(previous));
  const cur = avgOf(now), prev = avgOf(before);
  const five = (rows: RatingPoint[]) => { const n = rows.reduce((s, r) => s + r.n, 0); return n ? percentOf(rows.filter(r => r.stars === 5).reduce((s, r) => s + r.n, 0), n) : null; };
  const byProperty = (rows: readonly RatingPoint[]) => {
    const m = new Map<string, RatingPoint[]>();
    for (const r of rows) m.set(r.propertyId, [...(m.get(r.propertyId) ?? []), r]);
    return new Map([...m].map(([id, list]) => [id, avgOf(list)]));
  };
  const allTime = byProperty(points), startTime = byProperty(points.filter(x => x.day < range.from)), period = byProperty(now);
  const below = (m: Map<string, { n: number; average: number | null }>) => [...m.values()].filter(x => x.n > 0 && x.average !== null && x.average < 4).length;
  const kpis: Kpi[] = [
    all.n ? { key: 'portfolio', label: 'Portfolio average', value: stars(all.average), unit: 'of 5', note: `All time, from ${counted(all.n, 'review')}`,
      delta: compare(roundTo(all.average ?? 0, 2), atStart.n ? roundTo(atStart.average ?? 0, 2) : null, { better: 'up', kind: 'average', decimals: 2, against: 'since the start of these dates' }) }
      : kpiEmpty('portfolio', 'Portfolio average', 'No reviews yet'),
    cur.n ? { key: 'period', label: 'Average in these dates', value: stars(cur.average), unit: 'of 5', note: `From ${counted(cur.n, 'review')}${cur.n < RATINGS_MIN_REVIEWS ? '. Too few to read much into' : ''}`,
      delta: compare(roundTo(cur.average ?? 0, 2), prev.n ? roundTo(prev.average ?? 0, 2) : null, { better: 'up', kind: 'average', decimals: 2, against }) }
      : kpiEmpty('period', 'Average in these dates', 'No reviews in these dates'),
    { key: 'reviews', label: 'Reviews', value: formatCount(cur.n), note: 'Left in these dates', delta: compare(cur.n, prev.n, { better: 'up', against }) },
    cur.n ? { key: 'five', label: 'Five-star reviews', value: pct(five(now)), note: 'Share of the reviews in these dates', delta: compare(five(now), five(before), { better: 'up', kind: 'percent', against }) }
      : kpiEmpty('five', 'Five-star reviews', 'No reviews in these dates'),
    { key: 'below', label: 'Properties below 4.0', value: formatCount(below(allTime)), note: `All-time average, of ${counted([...allTime.values()].filter(x => x.n).length, 'rated property', 'rated properties')}`,
      delta: compare(below(allTime), below(startTime), { better: 'down', against: 'since the start of these dates' }) },
  ];
  // The rating over time: monthly over a few months or more, weekly over a shorter stretch. A month with no reviews is a
  // gap in the line, never a zero.
  const g: Grain = rangeDays(range) > 62 ? 'month' : 'week', bits = lineBits(range, g);
  const series = averageSeries(now.map(x => ({ day: x.day, sum: x.sum, n: x.n })), range, g);
  const withData = series.values.filter(v => v !== null).length;
  const charts: ChartSpec[] = [{
    kind: 'line', id: 'rating-trend', title: 'Portfolio rating over time', subtitle: `${grainWord(g)} average of every review, with the number of reviews behind each point.`,
    unit: 'Average stars out of 5', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n, 1), decimals: 1,
    series: [{ key: 'average', label: 'Average rating', colour: 'series1', values: series.values.map(v => (v === null ? null : roundTo(v, 2))) }],
    extras: [{ label: 'Reviews', values: series.counts }],
    reference: all.n ? { value: roundTo(all.average ?? 0, 2), label: 'All-time average' } : undefined, yMin: 1, yMax: 5,
    state: cur.n === 0 ? 'empty' : withData < 2 ? 'low' : 'ok', emptyText: 'No reviews in these dates.',
    lowText: `Not enough reviews to chart: fewer than two ${grainNoun(g)}s with reviews in these dates. Choose a longer period.`,
  }];
  const mix = [1, 2, 3, 4, 5].map(s => now.filter(x => x.stars === s).reduce((t, x) => t + x.n, 0));
  charts.push({
    kind: 'columns', id: 'star-mix', title: 'Star mix', subtitle: 'How many reviews gave each number of stars, rounded to the nearest star.', unit: 'Reviews in these dates',
    rows: mix.map((n, i) => ({ key: String(i + 1), label: `${i + 1} ${i ? 'stars' : 'star'}`, value: n, display: formatCount(n), colour: 'series1' as ChartColour })),
    state: cur.n ? 'ok' : 'empty', emptyText: 'No reviews in these dates.',
  });
  const rows: BarRow[] = [...period].filter(([, x]) => x.n > 0).map(([id, x]) => ({
    key: id, label: names.get(id) ?? 'Property', value: roundTo(x.average ?? 0, 2), display: `${stars(x.average)} (${formatCount(x.n)})`, muted: x.n < RATINGS_MIN_REVIEWS,
  }));
  const quiet = data.properties.length - rows.length;
  charts.push({
    kind: 'bars', id: 'by-property', title: 'Properties by rating', order: 'asc', limit: 10, max: 5, unit: 'Average stars out of 5 in these dates, reviews in brackets',
    subtitle: `Lowest first. Paler bars rest on fewer than ${RATINGS_MIN_REVIEWS} reviews.${quiet > 0 ? ` ${counted(quiet, 'property', 'properties')} had no reviews in these dates.` : ''}`,
    rows, reference: cur.n ? { value: roundTo(cur.average ?? 0, 2), label: 'Portfolio average' } : undefined,
    state: rows.length ? 'ok' : 'empty', emptyText: 'No reviews in these dates.',
  });
  const movers = [...period].filter(([id, x]) => x.n >= RATINGS_MIN_REVIEWS && (allTime.get(id)?.n ?? 0) > 0)
    .map(([id, x]) => { const base = allTime.get(id)!.average ?? 0, diff = roundTo((x.average ?? 0) - base, 2); return { id, x, base, diff }; })
    .filter(m => m.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || (names.get(a.id) ?? '').localeCompare(names.get(b.id) ?? '', 'en-GB')).slice(0, 5);
  charts.push({
    kind: 'movers', id: 'movers', title: 'Biggest movers', subtitle: `Each property's average in these dates against its own all-time average, for properties with ${RATINGS_MIN_REVIEWS} or more reviews in these dates.`,
    rows: movers.map(m => ({ key: m.id, label: names.get(m.id) ?? 'Property', before: `${stars(m.base)} all time`, after: `${stars(m.x.average)} now`, change: `${m.diff > 0 ? '+' : '−'}${formatFixed(Math.abs(m.diff), 2)}`, tone: m.diff > 0 ? 'good' : 'bad', direction: m.diff > 0 ? 'up' : 'down' })),
    state: movers.length ? 'ok' : 'empty', emptyText: `No property has ${RATINGS_MIN_REVIEWS} or more reviews in these dates with a rating different from its all-time average.`,
  });
  return { kpis, charts, source };
}

// --- Business reports -------------------------------------------------------------------------------------------------

const BUSINESS_SOURCE = 'Source: the workspace records, worked out by the database for these dates (UK days, both included).';

export function enquiriesModel(now: EnquiriesReport, before: EnquiriesReport | null, range: Range, against: string): AnalyticsModel {
  const estimateShare = (r: EnquiriesReport) => percentOf(r.funnel.estimate, r.funnel.received);
  const kpis: Kpi[] = [
    { key: 'received', label: 'Enquiries received', value: formatCount(now.received), note: `${SOURCE_LABEL.form} ${now.bySource.form} · ${SOURCE_LABEL.app} ${now.bySource.app}`, delta: compare(now.received, before?.received ?? null, { better: 'up', against }) },
    { key: 'estimate', label: 'Reached an estimate', value: pct(estimateShare(now)), note: `${now.funnel.estimate} of ${now.funnel.received}`, delta: compare(estimateShare(now), before ? estimateShare(before) : null, { better: 'up', kind: 'percent', against }) },
    { key: 'live', label: 'Gone live', value: formatCount(now.funnel.live), note: `${now.funnel.agreement} signed an agreement`, delta: compare(now.funnel.live, before?.funnel.live ?? null, { better: 'up', against }) },
    now.reply.medianMinutes === null ? kpiEmpty('reply', 'Median first reply', 'No replies to time in these dates')
      : { key: 'reply', label: 'Median first reply', value: waitLabel(now.reply.medianMinutes), note: `From ${counted(now.reply.replied, 'reply', 'replies')} · ${now.reply.waiting} with no reply yet`,
        delta: compare(roundTo(now.reply.medianMinutes), before?.reply.medianMinutes == null ? null : roundTo(before.reply.medianMinutes), { better: 'down', format: n => waitLabel(n), against }) },
  ];
  const bits = lineBits(range);
  const values = sumSeries(now.rows.map(r => ({ day: workspaceDateKey(Date.parse(r.receivedAt)), value: 1 })), range, bits.grain);
  const steps = funnelSteps(now.funnel);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'enquiries-trend', title: 'Enquiries received over time', subtitle: `${grainWord(bits.grain)} count of enquiries that came in.`, unit: 'Enquiries', labels: bits.labels, partial: bits.partial,
      format: n => formatFixed(n), series: [{ key: 'received', label: 'Enquiries', colour: 'series1', values }], state: lineState(values, now.received), emptyText: 'No enquiries in these dates.', lowText: lowLine(bits.grain) },
    { kind: 'columns', id: 'funnel', title: 'From enquiry to live', subtitle: 'How many reached each step, with the share of all enquiries.', unit: 'Enquiries',
      rows: steps.map(s => ({ key: s.key, label: s.label, value: s.count, display: `${formatCount(s.count)}${s.ofReceived === null ? '' : ` (${s.ofReceived}%)`}` })), state: now.received ? 'ok' : 'empty', emptyText: 'No enquiries in these dates.' },
    { kind: 'stack', id: 'sources', title: 'Where enquiries came from', unit: 'Share of enquiries', total: formatCount(now.received),
      parts: stackParts([{ key: 'form', label: SOURCE_LABEL.form, value: now.bySource.form, colour: 'series1' }, { key: 'app', label: SOURCE_LABEL.app, value: now.bySource.app, colour: 'series2' }]),
      state: now.received ? 'ok' : 'empty', emptyText: 'No enquiries in these dates.' },
  ];
  if (now.byStart.length) charts.push({ kind: 'bars', id: 'start-when', title: 'When they want to start', order: 'desc', unit: 'Enquiry forms',
    rows: now.byStart.map(s => ({ key: s.startWhen || 'none', label: startWhenName(s.startWhen), value: s.count, display: formatCount(s.count) })), state: 'ok' });
  return { kpis, charts, source: BUSINESS_SOURCE };
}

// Repair stages in the order a repair moves through them, the rest folded into "Other".
const stageOrder = (stage: string) => { const i = REPAIR_STAGES.findIndex(s => s.phase === stage); return i < 0 ? 99 : i; };
export function repairsModel(now: RepairsReport & { byDay?: { day: string; raised: number; completed: number }[] }, before: RepairsReport | null, range: Range, against: string): AnalyticsModel {
  const kpis: Kpi[] = [
    { key: 'raised', label: 'Repairs raised', value: formatCount(now.raised), note: 'Reported in these dates', delta: compare(now.raised, before?.raised ?? null, { better: 'none', against }) },
    { key: 'completed', label: 'Repairs finished', value: formatCount(now.completed), note: 'Finished in these dates', delta: compare(now.completed, before?.completed ?? null, { better: 'up', against }) },
    { key: 'quoted', label: 'Quoted', value: formatMoneyShort(now.quotedMinor), note: `On ${counted(now.quotedRepairs, 'repair')}`, delta: compare(now.quotedMinor, before?.quotedMinor ?? null, { better: 'down', format: n => formatMoneyShort(n), against }) },
    { key: 'spend', label: 'Spend approved', value: formatMoneyShort(now.spend.approvedMinor), note: `${formatMoneyShort(now.spend.waitingMinor)} waiting for approval`, delta: compare(now.spend.approvedMinor, before?.spend.approvedMinor ?? null, { better: 'down', format: n => formatMoneyShort(n), against }) },
  ];
  const bits = lineBits(range);
  const raised = now.byDay ? sumSeries(now.byDay.map(d => ({ day: d.day, value: d.raised })), range, bits.grain) : [];
  const done = now.byDay ? sumSeries(now.byDay.map(d => ({ day: d.day, value: d.completed })), range, bits.grain) : [];
  const stages = [...now.byStage].sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.stage.localeCompare(b.stage));
  const shown = stages.slice(0, 5), rest = stages.slice(5).reduce((n, s) => n + s.count, 0);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'repairs-trend', title: 'Repairs raised and finished', subtitle: `${grainWord(bits.grain)} count.`, unit: 'Repairs', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n),
      series: [{ key: 'raised', label: 'Raised', colour: 'series1', values: raised }, { key: 'completed', label: 'Finished', colour: 'series2', values: done }],
      state: !now.byDay ? 'empty' : lineState(raised.map((v, i) => v + done[i]), now.raised + now.completed), emptyText: now.byDay ? 'No repairs in these dates.' : 'The trend appears once the report analytics update is installed on the database.', lowText: lowLine(bits.grain) },
    { kind: 'stack', id: 'stages', title: 'Where the repairs raised stand now', unit: 'Share of repairs raised in these dates', total: formatCount(now.raised),
      parts: stackParts([...shown.map((s, i) => ({ key: s.stage, label: repairStageName(s.stage), value: s.count, colour: SERIES[i] })), ...(rest ? [{ key: 'other', label: 'Other stages', value: rest, colour: 'neutral' as ChartColour }] : [])]),
      state: now.raised ? 'ok' : 'empty', emptyText: 'No repairs raised in these dates.' },
    { kind: 'bars', id: 'by-property', title: 'Repairs by property', order: 'desc', limit: 10, unit: 'Repairs raised in these dates',
      rows: now.byProperty.filter(x => x.raised > 0).map(x => ({ key: x.propertyId, label: x.propertyName, value: x.raised, display: formatCount(x.raised), detail: `${x.completed} finished · quoted ${formatMoney(x.quotedMinor)}` })),
      state: now.byProperty.some(x => x.raised > 0) ? 'ok' : 'empty', emptyText: 'No repairs raised in these dates.' },
    { kind: 'bars', id: 'spend-by-property', title: 'Maintenance spend by property', order: 'desc', limit: 10, unit: 'Spend approved in these dates', colour: 'series2',
      rows: now.byProperty.filter(x => x.approvedMinor > 0).map(x => ({ key: x.propertyId, label: x.propertyName, value: x.approvedMinor, display: formatMoneyShort(x.approvedMinor), detail: x.waitingMinor ? `${formatMoneyShort(x.waitingMinor)} waiting` : undefined })),
      state: now.byProperty.some(x => x.approvedMinor > 0) ? 'ok' : 'empty', emptyText: 'No maintenance spend approved in these dates.' },
  ];
  return { kpis, charts, source: BUSINESS_SOURCE };
}

export function todosModel(now: TodosReport & { byDay?: { day: string; total: number; done: number; doneLate: number; overdue: number }[] }, before: TodosReport | null, range: Range, against: string): AnalyticsModel {
  const rate = (r: TodosReport) => percentOf(r.done, r.total);
  const kpis: Kpi[] = [
    { key: 'done', label: 'Done', value: formatCount(now.done), note: `Of ${counted(now.total, 'to-do')} due`, delta: compare(now.done, before?.done ?? null, { better: 'up', against }) },
    now.total ? { key: 'rate', label: 'Completion rate', value: pct(rate(now)), note: `${now.open} still open`, delta: compare(rate(now), before && before.total ? rate(before) : null, { better: 'up', kind: 'percent', against }) }
      : kpiEmpty('rate', 'Completion rate', 'No to-dos due in these dates'),
    { key: 'late', label: 'Done late', value: formatCount(now.doneLate), note: 'Ticked after their due day', delta: compare(now.doneLate, before?.doneLate ?? null, { better: 'down', against }) },
    { key: 'overdue', label: 'Overdue', value: formatCount(now.overdue), note: 'Past their due day and still open', delta: compare(now.overdue, before?.overdue ?? null, { better: 'down', against }) },
  ];
  const bits = lineBits(range);
  const due = now.byDay ? sumSeries(now.byDay.map(d => ({ day: d.day, value: d.total })), range, bits.grain) : [];
  const done = now.byDay ? sumSeries(now.byDay.map(d => ({ day: d.day, value: d.done })), range, bits.grain) : [];
  const onTime = Math.max(0, now.done - now.doneLate), waiting = Math.max(0, now.open - now.overdue);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'todos-trend', title: 'To-dos due and done', subtitle: `${grainWord(bits.grain)}, by the day each to-do was due. To-dos with no due day are left out of this chart.`, unit: 'To-dos', labels: bits.labels, partial: bits.partial,
      format: n => formatFixed(n), series: [{ key: 'due', label: 'Due', colour: 'series1', values: due }, { key: 'done', label: 'Done', colour: 'series2', values: done }],
      state: !now.byDay ? 'empty' : lineState(due, due.reduce((a, b) => a + b, 0)), emptyText: now.byDay ? 'No to-dos with a due day in these dates.' : 'The trend appears once the report analytics update is installed on the database.', lowText: lowLine(bits.grain) },
    { kind: 'stack', id: 'status', title: 'Where the to-dos stand', unit: 'Share of to-dos due in these dates', total: formatCount(now.total),
      parts: stackParts([{ key: 'onTime', label: 'Done on time', value: onTime, colour: 'good' }, { key: 'late', label: 'Done late', value: now.doneLate, colour: 'warn' }, { key: 'overdue', label: 'Overdue', value: now.overdue, colour: 'bad' }, { key: 'open', label: 'Open, not yet due', value: waiting, colour: 'neutral' }]),
      state: now.total ? 'ok' : 'empty', emptyText: 'No to-dos due in these dates.' },
    { kind: 'bars', id: 'by-department', title: 'Completion by department', order: 'asc', unit: 'Share of each department’s to-dos done, lowest first', max: 100,
      rows: now.byDepartment.filter(d => d.total > 0).map(d => ({ key: d.department || 'person', label: departmentName(d.department), value: percentOf(d.done, d.total), display: `${pct(percentOf(d.done, d.total))} (${d.done} of ${d.total})`, detail: d.overdue ? `${d.overdue} overdue` : undefined })),
      state: now.byDepartment.some(d => d.total > 0) ? 'ok' : 'empty', emptyText: 'No to-dos due in these dates.' },
    { kind: 'bars', id: 'by-person', title: 'Done by person', order: 'desc', limit: 10, unit: 'To-dos ticked off in these dates', colour: 'series2',
      rows: now.byPerson.filter(x => x.done > 0 || x.assigned > 0).map(x => ({ key: x.userId, label: x.fullName ?? 'Team member', value: x.done, display: formatCount(x.done), detail: [`${x.assigned} given to them`, x.overdue ? `${x.overdue} overdue` : ''].filter(Boolean).join(' · ') })),
      state: now.byPerson.length ? 'ok' : 'empty', emptyText: 'Nobody has to-dos in these dates.' },
  ];
  return { kpis, charts, source: BUSINESS_SOURCE };
}

// Channels keep one colour each on every chart: guest platforms first, then the owners' side, the rest "Other".
const CHANNEL_COLOUR: Record<string, ChartColour> = { airbnb: 'series1', booking_com: 'series2', vrbo: 'series3', direct: 'series4', whatsapp: 'series5', owner_chat: 'series6' };
export function messagesModel(now: MessagesReport, before: MessagesReport | null, range: Range, against: string): AnalyticsModel {
  const total = (r: MessagesReport, k: 'received' | 'sent') => r.byChannel.reduce((n, c) => n + c[k], 0);
  const within = (r: MessagesReport) => r.amberMinutes === null ? null : r.replyTimes.filter(t => t.medianMinutes !== null && t.medianMinutes <= (r.amberMinutes as number)).length;
  const timed = (r: MessagesReport) => r.replyTimes.reduce((n, t) => n + t.count, 0);
  const kpis: Kpi[] = [
    { key: 'received', label: 'Messages received', value: formatCount(total(now, 'received')), note: `On ${counted(now.byChannel.length, 'channel')}`, delta: compare(total(now, 'received'), before ? total(before, 'received') : null, { better: 'none', against }) },
    { key: 'sent', label: 'Messages sent', value: formatCount(total(now, 'sent')), note: 'Replies and messages from the team', delta: compare(total(now, 'sent'), before ? total(before, 'sent') : null, { better: 'none', against }) },
    now.replyTimes.length && within(now) !== null ? { key: 'within', label: 'Channels replying on time', value: `${within(now)} of ${now.replyTimes.length}`, note: `Median reply within the ${waitLabel(now.amberMinutes)} target`, delta: compare(within(now), before && before.replyTimes.length ? within(before) : null, { better: 'up', against }) }
      : kpiEmpty('within', 'Channels replying on time', 'No replies to time in these dates'),
    { key: 'timed', label: 'Replies timed', value: formatCount(timed(now)), note: 'Messages with a reply time', delta: compare(timed(now), before ? timed(before) : null, { better: 'none', against }) },
  ];
  // The database counts messages by week and by month, so the trend is weekly up to four months and monthly beyond.
  const g: Grain = rangeDays(range) > 122 ? 'month' : 'week', bits = lineBits(range, g);
  const dated = g === 'month' ? now.byMonth.map(m => ({ day: m.month + '-01' < range.from ? range.from : m.month + '-01', received: m.received, sent: m.sent }))
    : now.byWeek.map(w => ({ day: w.week < range.from ? range.from : w.week, received: w.received, sent: w.sent }));
  const received = sumSeries(dated.map(d => ({ day: d.day, value: d.received })), range, g), sent = sumSeries(dated.map(d => ({ day: d.day, value: d.sent })), range, g);
  const channels = [...now.byChannel].sort((a, b) => channelOrder(a.channel, b.channel));
  const coloured = channels.filter(c => CHANNEL_COLOUR[c.channel]), other = channels.filter(c => !CHANNEL_COLOUR[c.channel]).reduce((n, c) => n + c.received, 0);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'messages-trend', title: 'Messages received and sent', subtitle: `${grainWord(g)} totals across every channel.`, unit: 'Messages', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n),
      series: [{ key: 'received', label: 'Received', colour: 'series1', values: received }, { key: 'sent', label: 'Sent', colour: 'series2', values: sent }],
      state: lineState(received.map((v, i) => v + sent[i]), total(now, 'received') + total(now, 'sent')), emptyText: 'No messages in these dates.', lowText: lowLine(g) },
    { kind: 'bars', id: 'reply-times', title: 'Median reply time by channel', order: 'desc', unit: 'Median minutes to reply, slowest first',
      rows: now.replyTimes.filter(t => t.medianMinutes !== null).map(t => ({ key: t.channel, label: channelName(t.channel), value: t.medianMinutes, display: waitLabel(t.medianMinutes), detail: `${counted(t.count, 'reply', 'replies')} · slowest ${waitLabel(t.slowestMinutes)}` })),
      reference: now.amberMinutes === null ? undefined : { value: now.amberMinutes, label: 'Target (amber), minutes' }, colour: 'series3',
      state: now.replyTimes.some(t => t.medianMinutes !== null) ? 'ok' : 'empty', emptyText: 'No replies to time in these dates.' },
    { kind: 'stack', id: 'channel-share', title: 'Messages received by channel', unit: 'Share of messages received', total: formatCount(total(now, 'received')),
      parts: stackParts([...coloured.map(c => ({ key: c.channel, label: channelName(c.channel), value: c.received, colour: CHANNEL_COLOUR[c.channel] })), ...(other ? [{ key: 'other', label: 'Other channels', value: other, colour: 'neutral' as ChartColour }] : [])]),
      state: total(now, 'received') ? 'ok' : 'empty', emptyText: 'No messages received in these dates.' },
  ];
  return { kpis, charts, source: BUSINESS_SOURCE };
}

export function timeModel(now: TimeReport & { byDay?: { day: string; minutes: number; people: number; shifts: number }[] }, before: TimeReport | null, range: Range, against: string): AnalyticsModel {
  const perShift = (r: TimeReport) => (r.shifts ? r.minutes / r.shifts : null);
  const kpis: Kpi[] = [
    { key: 'hours', label: 'Hours worked', value: hoursText(hoursOf(now.minutes)), unit: 'hours', note: `After ${formatDuration(now.unpaidMinutes)} of unpaid pauses`, delta: compare(hoursOf(now.minutes), before ? hoursOf(before.minutes) : null, { better: 'none', decimals: 1, against }) },
    { key: 'shifts', label: 'Shifts', value: formatCount(now.shifts), note: now.running ? `${now.running} still running` : `${counted(now.byPerson.length, 'person', 'people')} clocked in`, delta: compare(now.shifts, before?.shifts ?? null, { better: 'none', against }) },
    perShift(now) === null ? kpiEmpty('perShift', 'Average shift', 'No shifts in these dates')
      : { key: 'perShift', label: 'Average shift', value: formatDuration(perShift(now) as number), note: 'Paid time per shift', delta: compare(roundTo(perShift(now) as number), before && perShift(before) !== null ? roundTo(perShift(before) as number) : null, { better: 'none', format: n => formatDuration(n), against }) },
    { key: 'overtime', label: 'Overtime', value: hoursText(hoursOf(now.overtimeMinutes)), unit: 'hours', note: 'From when overtime was started', delta: compare(hoursOf(now.overtimeMinutes), before ? hoursOf(before.overtimeMinutes) : null, { better: 'down', decimals: 1, against }) },
  ];
  const bits = lineBits(range);
  const hours = now.byDay ? sumSeries(now.byDay.map(d => ({ day: d.day, value: d.minutes / 60 })), range, bits.grain).map(v => roundTo(v, 1)) : [];
  const departments = [...now.byDepartment].sort((a, b) => b.minutes - a.minutes);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'hours-trend', title: 'Hours worked over time', subtitle: `${grainWord(bits.grain)} total, by the day each shift started.`, unit: 'Hours', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n, n < 10 && n % 1 ? 1 : 0),
      series: [{ key: 'hours', label: 'Hours', colour: 'series1', values: hours }], state: !now.byDay ? 'empty' : lineState(hours, now.shifts), emptyText: now.byDay ? 'No shifts in these dates.' : 'The trend appears once the report analytics update is installed on the database.', lowText: lowLine(bits.grain) },
    { kind: 'bars', id: 'by-person', title: 'Hours by person', order: 'desc', limit: 10, unit: 'Hours worked in these dates',
      rows: now.byPerson.map(x => ({ key: x.userId, label: x.fullName ?? 'Team member', value: hoursOf(x.minutes), display: `${hoursText(hoursOf(x.minutes))}h`, detail: [x.department ? departmentName(x.department) : '', counted(x.days, 'day')].filter(Boolean).join(' · ') })),
      state: now.byPerson.length ? 'ok' : 'empty', emptyText: 'No shifts in these dates.' },
    { kind: 'stack', id: 'by-department', title: 'Share of hours by department', unit: 'Share of hours worked', total: `${hoursText(hoursOf(now.minutes))} hours`,
      parts: stackParts([...departments.slice(0, 5).map((d, i) => ({ key: d.department, label: departmentName(d.department), value: d.minutes, display: `${hoursText(hoursOf(d.minutes))}h`, colour: SERIES[i] })),
        ...(departments.length > 5 ? [{ key: 'other', label: 'Other departments', value: departments.slice(5).reduce((n, d) => n + d.minutes, 0), colour: 'neutral' as ChartColour }] : [])]),
      state: now.minutes > 0 ? 'ok' : 'empty', emptyText: 'No hours in these dates.' },
  ];
  return { kpis, charts, source: BUSINESS_SOURCE + ' Unpaid pauses are taken off by the current pay rules.' };
}

// --- Guests and stays ------------------------------------------------------------------------------------------------

const STAY_COLOUR: Record<string, ChartColour> = { airbnb: 'series1', booking_com: 'series2', vrbo: 'series3', direct: 'series4', other: 'neutral' };
export function staysModel(now: StayAnalytics, before: StayAnalytics | null, range: Range, against: string): AnalyticsModel {
  const kpis: Kpi[] = [
    { key: 'stays', label: 'Stays', value: formatCount(now.stays), note: `${counted(now.nights, 'night')} booked`, delta: compare(now.stays, before?.stays ?? null, { better: 'up', against }) },
    { key: 'nights', label: 'Nights booked', value: formatCount(now.nights), note: 'Nights in these dates', delta: compare(now.nights, before?.nights ?? null, { better: 'up', against }) },
    now.guests.average === null ? kpiEmpty('guests', 'Guests per stay', 'Not known for these stays')
      : { key: 'guests', label: 'Guests per stay', value: formatFixed(now.guests.average, 1), note: `Known for ${now.guests.known} of ${now.stays} stays`, delta: compare(roundTo(now.guests.average, 1), before?.guests.average == null ? null : roundTo(before.guests.average, 1), { better: 'none', kind: 'average', decimals: 1, against }) },
    now.averageNights === null ? kpiEmpty('length', 'Nights per stay', 'No stays in these dates')
      : { key: 'length', label: 'Nights per stay', value: formatFixed(now.averageNights, 1), note: 'On average', delta: compare(roundTo(now.averageNights, 1), before?.averageNights == null ? null : roundTo(before.averageNights, 1), { better: 'none', kind: 'average', decimals: 1, against }) },
    now.leadTime.averageDays === null ? kpiEmpty('lead', 'Booked ahead', 'Not known for these stays')
      : { key: 'lead', label: 'Booked ahead', value: formatFixed(now.leadTime.averageDays), unit: 'days', note: `On average, known for ${now.leadTime.known} of ${now.stays}`, delta: compare(roundTo(now.leadTime.averageDays), before?.leadTime.averageDays == null ? null : roundTo(before.leadTime.averageDays), { better: 'none', format: n => `${formatFixed(n)} days`, against }) },
  ];
  const months = [...now.byMonth].sort((a, b) => a.month.localeCompare(b.month));
  const labelOf = (m: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'stays-trend', title: 'Stays and nights by month', subtitle: 'A stay with nights in two months counts in both.', unit: 'Stays and nights', labels: months.map(m => labelOf(m.month)),
      partial: months.map(m => m.month + '-01' < range.from || m.month === range.to.slice(0, 7) && range.to.slice(8) < '28'),
      format: n => formatFixed(n), series: [{ key: 'stays', label: 'Stays', colour: 'series1', values: months.map(m => m.stays) }, { key: 'nights', label: 'Nights', colour: 'series2', values: months.map(m => m.nights) }],
      state: now.stays === 0 ? 'empty' : months.length < 2 ? 'low' : 'ok', emptyText: 'No confirmed stays in these dates.', lowText: 'The trend is by month, so it needs dates across two months or more. Choose 90 days or 12 months.' },
    { kind: 'stack', id: 'channels', title: 'Stays by channel', unit: 'Share of stays', total: formatCount(now.stays),
      parts: stackParts([...now.channels].sort((a, b) => (STAY_COLOUR[a.channel] ?? 'z').localeCompare(STAY_COLOUR[b.channel] ?? 'z')).map(c => ({ key: c.channel, label: stayChannelName(c.channel), value: c.stays, colour: STAY_COLOUR[c.channel] ?? 'neutral' }))),
      state: now.stays ? 'ok' : 'empty', emptyText: 'No confirmed stays in these dates.' },
    { kind: 'columns', id: 'lengths', title: 'How long they stay', unit: 'Stays', rows: now.lengths.map(b => ({ key: b.bucket, label: LENGTH_LABEL[b.bucket] ?? b.bucket, value: b.stays, display: formatCount(b.stays) })), state: now.stays ? 'ok' : 'empty', emptyText: 'No confirmed stays in these dates.' },
    { kind: 'columns', id: 'arrivals', title: 'Day they arrive', unit: 'Stays', rows: [...now.arrivalDays].sort((a, b) => a.day - b.day).map(d => ({ key: String(d.day), label: arrivalDayName(d.day).slice(0, 3), value: d.stays, display: formatCount(d.stays) })), state: now.stays ? 'ok' : 'empty', emptyText: 'No confirmed stays in these dates.' },
    { kind: 'columns', id: 'lead', title: 'How far ahead they book', subtitle: now.leadTime.known < now.stays ? `Known for ${now.leadTime.known} of ${now.stays} stays.` : undefined, unit: 'Stays',
      rows: now.leadTime.buckets.map(b => ({ key: b.bucket, label: (LEAD_LABEL[b.bucket] ?? b.bucket).replace(' ahead', ''), value: b.stays, display: formatCount(b.stays) })), state: now.leadTime.known ? 'ok' : 'empty', emptyText: 'Not known for any of these stays. Hostaway has not sent when they booked.' },
    { kind: 'bars', id: 'countries', title: 'Where guests come from', order: 'desc', limit: 8, unit: 'Stays where the country is known',
      rows: [...now.countries.top.map(c => ({ key: c.country, label: countryName(c.country), value: c.stays, display: formatCount(c.stays) })), ...(now.countries.others ? [{ key: 'others', label: 'Other countries', value: now.countries.others, display: formatCount(now.countries.others) }] : [])],
      state: now.countries.known ? 'ok' : 'empty', emptyText: 'Not known for any of these stays. Hostaway has not sent the guests’ countries.' },
    { kind: 'bars', id: 'by-home', title: 'Stays by home', order: 'desc', limit: 10, unit: 'Stays in these dates', colour: 'series2',
      rows: now.byProperty.map(x => ({ key: x.propertyId, label: x.propertyName, value: x.stays, display: formatCount(x.stays), detail: `${counted(x.nights, 'night')}` })), state: now.byProperty.length ? 'ok' : 'empty', emptyText: 'No confirmed stays in these dates.' },
  ];
  return { kpis, charts, source: 'Source: confirmed stays from the bookings Hostaway sends, owner stays left out. Totals and averages only; no guest is named.' };
}

// --- Business overview (task trends) -----------------------------------------------------------------------------------

type Trend = { key: string; recorded: number; completed: number; waiting: number };
type Overview = { total: number; complete: number; waiting: number; properties: number | null; status: { name: string; value: number; kind: string }[]; queues: { name: string; value: number }[]; trend: Trend[] };
export function overviewModel(now: Overview, before: Overview, available: boolean, range: Range, against: string, propertyLabel = 'Properties'): AnalyticsModel {
  const rate = (o: Overview) => percentOf(o.complete, o.total);
  if (!available) return { kpis: [kpiEmpty('tasks', 'Tasks', 'Task data is unavailable')], charts: [], source: 'Source: the work records within your access.' };
  const kpis: Kpi[] = [
    { key: 'tasks', label: 'Tasks recorded', value: formatCount(now.total), note: 'Recorded in these dates', delta: compare(now.total, before.total, { better: 'none', against }) },
    { key: 'complete', label: 'Completed', value: formatCount(now.complete), note: `${pct(rate(now))} of tasks`, delta: compare(now.complete, before.complete, { better: 'up', against }) },
    now.total ? { key: 'rate', label: 'Completion rate', value: pct(rate(now)), delta: compare(rate(now), before.total ? rate(before) : null, { better: 'up', kind: 'percent', against }) } : kpiEmpty('rate', 'Completion rate', 'No tasks in these dates'),
    { key: 'waiting', label: 'Waiting', value: formatCount(now.waiting), note: 'Not started yet', delta: compare(now.waiting, before.waiting, { better: 'down', against }) },
    ...(now.properties === null ? [] : [{ key: 'properties', label: propertyLabel, value: formatCount(now.properties), note: 'As of today' }]),
  ];
  const bits = lineBits(range);
  const recorded = sumSeries(now.trend.map(t => ({ day: t.key, value: t.recorded })), range, bits.grain), completed = sumSeries(now.trend.map(t => ({ day: t.key, value: t.completed })), range, bits.grain);
  const tone: Record<string, ChartColour> = { complete: 'good', waiting: 'warn', progress: 'series3', other: 'bad' };
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'tasks-trend', title: 'Tasks recorded and completed', subtitle: `${grainWord(bits.grain)} count, by the day each task was recorded.`, unit: 'Tasks', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n),
      series: [{ key: 'recorded', label: 'Recorded', colour: 'series1', values: recorded }, { key: 'completed', label: 'Completed', colour: 'series2', values: completed }],
      state: lineState(recorded, now.total), emptyText: 'No tasks in these dates.', lowText: lowLine(bits.grain) },
    { kind: 'stack', id: 'status', title: 'Tasks by status', unit: 'Share of tasks recorded in these dates', total: formatCount(now.total),
      parts: stackParts(now.status.map(s => ({ key: s.kind, label: s.name, value: s.value, colour: tone[s.kind] ?? 'neutral' }))), state: now.total ? 'ok' : 'empty', emptyText: 'No tasks in these dates.' },
    { kind: 'bars', id: 'by-type', title: 'Tasks by type', order: 'desc', unit: 'Tasks recorded in these dates', rows: now.queues.map(q => ({ key: q.name, label: q.name, value: q.value, display: formatCount(q.value) })), state: now.total ? 'ok' : 'empty', emptyText: 'No tasks in these dates.' },
  ];
  return { kpis, charts, source: 'Source: the work records within your access (workflows, maintenance, cleans and more), by UK day.' };
}

// --- Productivity (hours clocked) -----------------------------------------------------------------------------------

type ProductivityLike = { people: { userId: string; fullName: string; department: string | null; minutes: number; shifts: number; days: number; overtimeMinutes?: number; weeks: { start: string; minutes: number }[]; months: { month: string; minutes: number }[] }[] };
export function productivityModel(now: ProductivityLike, before: ProductivityLike | null, range: Range, against: string, departmentLabel: (d: string) => string): AnalyticsModel {
  const sum = (d: ProductivityLike, k: 'minutes' | 'shifts' | 'overtimeMinutes') => d.people.reduce((n, x) => n + (x[k] ?? 0), 0);
  const clocked = (d: ProductivityLike) => d.people.filter(x => x.minutes > 0).length;
  const perPerson = (d: ProductivityLike) => (clocked(d) ? sum(d, 'minutes') / clocked(d) : null);
  const kpis: Kpi[] = [
    { key: 'hours', label: 'Team hours', value: hoursText(hoursOf(sum(now, 'minutes'))), unit: 'hours', note: `Over ${counted(sum(now, 'shifts'), 'shift')}`, delta: compare(hoursOf(sum(now, 'minutes')), before ? hoursOf(sum(before, 'minutes')) : null, { better: 'none', decimals: 1, against }) },
    { key: 'people', label: 'People who clocked in', value: formatCount(clocked(now)), delta: compare(clocked(now), before ? clocked(before) : null, { better: 'none', against }) },
    perPerson(now) === null ? kpiEmpty('perPerson', 'Hours per person', 'Nobody clocked in') : { key: 'perPerson', label: 'Hours per person', value: hoursText(hoursOf(perPerson(now) as number)), unit: 'hours', note: 'Among those who clocked in', delta: compare(hoursOf(perPerson(now) as number), before && perPerson(before) !== null ? hoursOf(perPerson(before) as number) : null, { better: 'none', decimals: 1, against }) },
    { key: 'overtime', label: 'Overtime', value: hoursText(hoursOf(sum(now, 'overtimeMinutes'))), unit: 'hours', delta: compare(hoursOf(sum(now, 'overtimeMinutes')), before ? hoursOf(sum(before, 'overtimeMinutes')) : null, { better: 'down', decimals: 1, against }) },
  ];
  // Weeks up to four months (each week counted from its Monday), months beyond.
  const g: Grain = rangeDays(range) > 122 ? 'month' : 'week', bits = lineBits(range, g);
  const pts = now.people.flatMap(x => g === 'week' ? x.weeks.map(w => ({ day: w.start < range.from ? range.from : w.start, value: w.minutes / 60 })) : x.months.map(m => ({ day: m.month + '-01' < range.from ? range.from : m.month + '-01', value: m.minutes / 60 })));
  const hours = sumSeries(pts, range, g).map(v => roundTo(v, 1));
  const byDept = new Map<string, number>();
  for (const x of now.people) if (x.minutes > 0) byDept.set(x.department ?? '', (byDept.get(x.department ?? '') ?? 0) + x.minutes);
  const depts = [...byDept].sort((a, b) => b[1] - a[1]);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'hours-trend', title: 'Team hours over time', subtitle: `${grainWord(g)} total.${g === 'week' ? ' A week that starts before these dates shows in full.' : ''}`, unit: 'Hours', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n),
      series: [{ key: 'hours', label: 'Hours', colour: 'series1', values: hours }], state: lineState(hours, sum(now, 'minutes')), emptyText: 'Nobody clocked in during these dates.', lowText: lowLine(g) },
    { kind: 'bars', id: 'by-person', title: 'Hours by person', order: 'desc', limit: 10, unit: 'Hours in these dates', rows: now.people.filter(x => x.minutes > 0).map(x => ({ key: x.userId, label: x.fullName || 'Team member', value: hoursOf(x.minutes), display: `${hoursText(hoursOf(x.minutes))}h`, detail: `${counted(x.shifts, 'shift')} · ${counted(x.days, 'day')}` })),
      state: clocked(now) ? 'ok' : 'empty', emptyText: 'Nobody clocked in during these dates.' },
    { kind: 'stack', id: 'by-department', title: 'Share of hours by department', unit: 'Share of team hours', total: `${hoursText(hoursOf(sum(now, 'minutes')))} hours`,
      parts: stackParts([...depts.slice(0, 5).map(([d, m], i) => ({ key: d || 'none', label: d ? departmentLabel(d) : 'No department', value: m, display: `${hoursText(hoursOf(m))}h`, colour: SERIES[i] })), ...(depts.length > 5 ? [{ key: 'other', label: 'Other departments', value: depts.slice(5).reduce((n, [, m]) => n + m, 0), colour: 'neutral' as ChartColour }] : [])]),
      state: sum(now, 'minutes') ? 'ok' : 'empty', emptyText: 'Nobody clocked in during these dates.' },
  ];
  return { kpis, charts, source: 'Source: every clock in and out, with unpaid pauses taken off. Changes waiting for a super admin are not counted yet.' };
}

// --- Team performance -------------------------------------------------------------------------------------------------

type PerfLike = { messages: number; targets: { passPercent: number; amberMinutes: number }; unassigned: { green: number; amber: number; red: number }; people: { userId: string; fullName: string; minutes: number; shifts: number; green: number; amber: number; red: number; score: number | null; onTrack: boolean | null }[] };
export function teamPerformanceModel(now: PerfLike, before: PerfLike | null, range: Range, against: string): AnalyticsModel {
  const replies = (d: PerfLike) => { const g = d.people.reduce((n, x) => n + x.green, d.unassigned.green), a = d.people.reduce((n, x) => n + x.amber, d.unassigned.amber), r = d.people.reduce((n, x) => n + x.red, d.unassigned.red); return { g, a, r, all: g + a + r }; };
  const onTime = (d: PerfLike) => { const x = replies(d); return percentOf(x.g, x.all); };
  const scored = (d: PerfLike) => d.people.filter(x => x.score !== null);
  const onTrack = (d: PerfLike) => scored(d).filter(x => x.onTrack).length;
  const minutes = (d: PerfLike) => d.people.reduce((n, x) => n + x.minutes, 0);
  const x = replies(now);
  const kpis: Kpi[] = [
    x.all ? { key: 'onTime', label: 'Guest replies on time', value: pct(onTime(now)), note: `Green, from ${counted(x.all, 'reply', 'replies')}`, delta: compare(onTime(now), before && replies(before).all ? onTime(before) : null, { better: 'up', kind: 'percent', against }) } : kpiEmpty('onTime', 'Guest replies on time', 'No replies to time in these dates'),
    { key: 'red', label: 'Late replies', value: formatCount(x.r), note: `Over ${now.targets.amberMinutes} minutes`, delta: compare(x.r, before ? replies(before).r : null, { better: 'down', against }) },
    scored(now).length ? { key: 'onTrack', label: 'People on track', value: `${onTrack(now)} of ${scored(now).length}`, note: `Score of ${now.targets.passPercent}% or more`, delta: compare(onTrack(now), before && scored(before).length ? onTrack(before) : null, { better: 'up', against }) } : kpiEmpty('onTrack', 'People on track', 'Nothing to score yet'),
    { key: 'hours', label: 'Hours worked', value: hoursText(hoursOf(minutes(now))), unit: 'hours', delta: compare(hoursOf(minutes(now)), before ? hoursOf(minutes(before)) : null, { better: 'none', decimals: 1, against }) },
  ];
  const charts: ChartSpec[] = [
    { kind: 'stack', id: 'reply-mix', title: 'Guest replies by speed', subtitle: 'Including messages that arrived while nobody was clocked in to guest relations.', unit: 'Share of guest replies', total: formatCount(x.all),
      parts: stackParts([{ key: 'green', label: 'Green (on time)', value: x.g, colour: 'good' }, { key: 'amber', label: 'Amber', value: x.a, colour: 'warn' }, { key: 'red', label: `Red (over ${now.targets.amberMinutes} minutes)`, value: x.r, colour: 'bad' }]),
      state: x.all ? 'ok' : 'empty', emptyText: 'No guest replies in these dates.' },
    { kind: 'bars', id: 'scores', title: 'Scores by person', order: 'desc', unit: 'Score, %', max: 100, reference: { value: now.targets.passPercent, label: 'On track from' },
      rows: scored(now).map(p => ({ key: p.userId, label: p.fullName || 'Team member', value: p.score, display: `${p.score}%`, detail: p.onTrack ? 'On track' : 'Off track' })),
      state: scored(now).length ? 'ok' : 'empty', emptyText: 'Nothing to score in these dates.' },
    { kind: 'bars', id: 'hours', title: 'Hours by person', order: 'desc', limit: 10, unit: 'Hours worked in these dates', colour: 'series2',
      rows: now.people.filter(p => p.minutes > 0).map(p => ({ key: p.userId, label: p.fullName || 'Team member', value: hoursOf(p.minutes), display: `${hoursText(hoursOf(p.minutes))}h`, detail: counted(p.shifts, 'shift') })),
      state: minutes(now) ? 'ok' : 'empty', emptyText: 'Nobody clocked in during these dates.' },
  ];
  return { kpis, charts, source: 'Source: guest messages and reply times, clock-ins and the daily work the team logs, against the targets set below.' };
}

// --- My performance ------------------------------------------------------------------------------------------------------

type Own = { score: number | null; replies: number; repliesGreen: number; repliesGreenPercent: number | null; tasksDone: number; minutes: number; shifts: number; amber?: number; red?: number };
export function myPerformanceModel(now: Own, before: Own | null, against: string): AnalyticsModel {
  const kpis: Kpi[] = [
    now.score === null ? kpiEmpty('score', 'Score', 'Nothing to score yet') : { key: 'score', label: 'Score', value: `${now.score}%`, delta: compare(now.score, before?.score ?? null, { better: 'up', kind: 'percent', against }) },
    now.replies ? { key: 'onTime', label: 'Guest replies on time', value: pct(now.repliesGreenPercent), note: `From ${counted(now.replies, 'reply', 'replies')}`, delta: compare(now.repliesGreenPercent, before?.replies ? before.repliesGreenPercent : null, { better: 'up', kind: 'percent', against }) } : kpiEmpty('onTime', 'Guest replies on time', 'No replies in these dates'),
    { key: 'tasks', label: 'Tasks done', value: formatCount(now.tasksDone), delta: compare(now.tasksDone, before?.tasksDone ?? null, { better: 'up', against }) },
    { key: 'time', label: 'Time worked', value: formatDuration(now.minutes), note: counted(now.shifts, 'shift'), delta: compare(now.minutes, before?.minutes ?? null, { better: 'none', format: n => formatDuration(n), against }) },
  ];
  const amber = now.amber ?? 0, red = now.red ?? Math.max(0, now.replies - now.repliesGreen - amber);
  const charts: ChartSpec[] = now.replies ? [{ kind: 'stack', id: 'my-replies', title: 'My guest replies by speed', unit: 'Share of my replies', total: formatCount(now.replies),
    parts: stackParts([{ key: 'green', label: 'Green (on time)', value: now.repliesGreen, colour: 'good' }, { key: 'amber', label: 'Amber', value: amber, colour: 'warn' }, { key: 'red', label: 'Red', value: red, colour: 'bad' }]), state: 'ok' }] : [];
  return { kpis, charts, source: 'Source: your own replies, clock-ins and finished work. Only you and management see these.' };
}

// --- Decisions ---------------------------------------------------------------------------------------------------------

type Decision = { at: string; area: string; outcome: string | null; amountMinor: number | null; by: string | null };
const GOOD = new Set(['approved', 'overturned', 'no_action']), BAD = new Set(['declined', 'rejected', 'removed_from_rota', 'upheld']);
export function decisionsModel(rows: readonly Decision[], range: Range, previous: Range, against: string, today: string, areaLabel: (a: string) => string): AnalyticsModel {
  const day = (d: Decision) => workspaceDateKey(Date.parse(d.at));
  const kept = previous.from >= shiftBack(today, 89);
  const now = rows.filter(d => day(d) >= range.from && day(d) <= range.to), before = kept ? rows.filter(d => day(d) >= previous.from && day(d) <= previous.to) : null;
  const approved = (list: readonly Decision[]) => list.filter(d => d.outcome === null || d.outcome === 'approved').length;
  const value = (list: readonly Decision[]) => list.reduce((n, d) => n + (d.amountMinor ?? 0), 0);
  const kpis: Kpi[] = [
    { key: 'decisions', label: 'Decisions', value: formatCount(now.length), delta: compare(now.length, before?.length ?? null, { better: 'none', against }) },
    now.length ? { key: 'approved', label: 'Approved', value: pct(percentOf(approved(now), now.length)), note: `${approved(now)} of ${now.length}`, delta: compare(percentOf(approved(now), now.length), before?.length ? percentOf(approved(before), before.length) : null, { better: 'none', kind: 'percent', against }) } : kpiEmpty('approved', 'Approved', 'No decisions in these dates'),
    { key: 'value', label: 'Value decided', value: formatMoneyShort(value(now)), note: 'Amounts on the decisions that have one', delta: compare(value(now), before ? value(before) : null, { better: 'none', format: n => formatMoneyShort(n), against }) },
  ];
  const bits = lineBits(range);
  const trend = sumSeries(now.map(d => ({ day: day(d), value: 1 })), range, bits.grain);
  const outcome = (d: Decision) => (d.outcome === null || GOOD.has(d.outcome) ? 'good' : BAD.has(d.outcome) ? 'bad' : 'other');
  const areas = [...new Set(now.map(d => d.area))].sort();
  const people = new Map<string, number>();
  for (const d of now) people.set(d.by ?? 'Unknown', (people.get(d.by ?? 'Unknown') ?? 0) + 1);
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'decisions-trend', title: 'Decisions over time', subtitle: `${grainWord(bits.grain)} count.`, unit: 'Decisions', labels: bits.labels, partial: bits.partial, format: n => formatFixed(n),
      series: [{ key: 'decisions', label: 'Decisions', colour: 'series1', values: trend }], state: lineState(trend, now.length), emptyText: 'No decisions in these dates.', lowText: lowLine(bits.grain) },
    { kind: 'stack', id: 'outcomes', title: 'Outcomes', unit: 'Share of decisions', total: formatCount(now.length),
      parts: stackParts([{ key: 'good', label: 'Approved or allowed', value: now.filter(d => outcome(d) === 'good').length, colour: 'good' }, { key: 'bad', label: 'Declined, rejected or upheld', value: now.filter(d => outcome(d) === 'bad').length, colour: 'bad' }, { key: 'other', label: 'Other outcomes', value: now.filter(d => outcome(d) === 'other').length, colour: 'neutral' }]),
      state: now.length ? 'ok' : 'empty', emptyText: 'No decisions in these dates.' },
    { kind: 'stack', id: 'areas', title: 'Decisions by area', unit: 'Share of decisions', total: formatCount(now.length),
      parts: stackParts(areas.map((a, i) => ({ key: a, label: areaLabel(a), value: now.filter(d => d.area === a).length, colour: SERIES[i % SERIES.length] }))), state: now.length ? 'ok' : 'empty', emptyText: 'No decisions in these dates.' },
    { kind: 'bars', id: 'by-person', title: 'Decisions by person', order: 'desc', limit: 10, unit: 'Decisions made in these dates', colour: 'series2',
      rows: [...people].map(([name, n]) => ({ key: name, label: name, value: n, display: formatCount(n) })), state: now.length ? 'ok' : 'empty', emptyText: 'No decisions in these dates.' },
  ];
  return { kpis, charts, source: 'Source: every approval and decision recorded in the last 90 days.', note: kept ? undefined : 'Decisions are read for the last 90 days only, so these dates have nothing earlier to compare with.' };
}
const shiftBack = (day: string, days: number) => new Date(Date.parse(day + 'T12:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);

// --- Invoices -----------------------------------------------------------------------------------------------------------

type InvoiceLike = { amount_minor: number; currency: string; status: string; issued_on?: string | null; paid_at?: string | null };
export function invoicesModel(all: readonly InvoiceLike[], range: Range, previous: Range, against: string, statusLabel: (s: string) => string): AnalyticsModel {
  const gbp = all.filter(i => i.currency === 'GBP');
  const issued = (r: Range) => gbp.filter(i => i.issued_on && i.issued_on >= r.from && i.issued_on <= r.to);
  const paidIn = (r: Range) => gbp.filter(i => i.paid_at && workspaceDateKey(Date.parse(i.paid_at)) >= r.from && workspaceDateKey(Date.parse(i.paid_at)) <= r.to);
  const value = (list: readonly InvoiceLike[]) => list.reduce((n, i) => n + i.amount_minor, 0);
  const now = issued(range), before = issued(previous), outstanding = gbp.filter(i => i.status === 'issued');
  const kpis: Kpi[] = [
    { key: 'issued', label: 'Invoiced', value: formatMoneyShort(value(now)), note: `${counted(now.length, 'invoice')} issued in these dates`, delta: compare(value(now), value(before), { better: 'up', format: n => formatMoneyShort(n), against }) },
    { key: 'paid', label: 'Payments recorded', value: formatMoneyShort(value(paidIn(range))), note: `${counted(paidIn(range).length, 'invoice')} paid in these dates`, delta: compare(value(paidIn(range)), value(paidIn(previous)), { better: 'up', format: n => formatMoneyShort(n), against }) },
    { key: 'outstanding', label: 'Outstanding now', value: formatMoneyShort(value(outstanding)), note: `${counted(outstanding.length, 'invoice')} issued and not yet paid` },
  ];
  const bits = lineBits(range);
  const trend = sumSeries(now.map(i => ({ day: i.issued_on as string, value: i.amount_minor / 100 })), range, bits.grain).map(v => roundTo(v, 2));
  const statuses = [...new Set(gbp.map(i => i.status))].sort();
  const tone = (s: string): ChartColour => (s === 'paid' ? 'good' : s === 'issued' ? 'warn' : s === 'void' || s === 'cancelled' ? 'neutral' : 'series3');
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'invoiced-trend', title: 'Invoiced over time', subtitle: `${grainWord(bits.grain)} value of invoices issued, in pounds.`, unit: 'Pounds invoiced', labels: bits.labels, partial: bits.partial, format: n => formatMoneyShort(roundTo(n * 100)),
      series: [{ key: 'invoiced', label: 'Invoiced', colour: 'series1', values: trend }], state: lineState(trend, now.length), emptyText: 'No invoices issued in these dates.', lowText: lowLine(bits.grain) },
    { kind: 'stack', id: 'status', title: 'Every invoice by status', unit: 'Share of all invoices by value, whatever their date', total: formatMoneyShort(value(gbp)),
      parts: stackParts(statuses.map(s => ({ key: s, label: statusLabel(s), value: value(gbp.filter(i => i.status === s)), display: formatMoneyShort(value(gbp.filter(i => i.status === s))), colour: tone(s) }))),
      state: gbp.length ? 'ok' : 'empty', emptyText: 'No invoices yet.' },
  ];
  return { kpis, charts, source: 'Source: the invoices issued in the workspace, in pounds. Dated by the day they were issued; payments by the day they were recorded.' };
}

// --- Accounts performance -------------------------------------------------------------------------------------------

type PerfFigures = { managementFeeMinor: number; cleaningMarginMinor: number; occupancyBps: number | null; averageNightlyRateMinor: number | null; grossRevenueMinor: number; nightsBooked: number };
type PerfReport = { totals: PerfFigures; byMonth: (PerfFigures & { period: string })[]; byProperty: (PerfFigures & { propertyId: string; propertyName: string })[]; byChannel: { channel: string; grossRevenueMinor: number; nightsBooked: number }[] };
export function performanceModel(now: PerfReport, before: PerfReport | null, against: string, monthLabel: (m: string) => string, channelLabel: (c: string) => string): AnalyticsModel {
  const t = now.totals, b = before?.totals ?? null;
  const occ = (f: PerfFigures | null) => (f && f.occupancyBps !== null ? roundTo(f.occupancyBps / 100, 1) : null);
  const kpis: Kpi[] = [
    { key: 'fees', label: 'Management fees', value: formatMoneyShort(t.managementFeeMinor), delta: compare(t.managementFeeMinor, b?.managementFeeMinor ?? null, { better: 'up', format: n => formatMoneyShort(n), against }) },
    { key: 'margin', label: 'Cleaning margin', value: formatMoneyShort(t.cleaningMarginMinor), delta: compare(t.cleaningMarginMinor, b?.cleaningMarginMinor ?? null, { better: 'up', format: n => formatMoneyShort(n), against }) },
    occ(t) === null ? kpiEmpty('occupancy', 'Occupancy', 'No nights available') : { key: 'occupancy', label: 'Occupancy', value: `${formatFixed(occ(t), 1)}%`, note: `${counted(t.nightsBooked, 'night')} booked`, delta: compare(occ(t), occ(b), { better: 'up', kind: 'percent', decimals: 1, against }) },
    t.averageNightlyRateMinor === null ? kpiEmpty('rate', 'Average nightly rate', 'No priced nights') : { key: 'rate', label: 'Average nightly rate', value: formatMoneyShort(t.averageNightlyRateMinor), delta: compare(t.averageNightlyRateMinor, b?.averageNightlyRateMinor ?? null, { better: 'up', format: n => formatMoneyShort(n), against }) },
  ];
  const months = [...now.byMonth].sort((a, c) => a.period.localeCompare(c.period));
  const fees = months.map(m => roundTo(m.managementFeeMinor / 100, 2));
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'fees-trend', title: 'Management fees by month', unit: 'Pounds', labels: months.map(m => monthLabel(m.period)), format: n => formatMoneyShort(roundTo(n * 100)),
      series: [{ key: 'fees', label: 'Management fees', colour: 'series1', values: fees }], state: months.length < 2 ? (t.managementFeeMinor ? 'low' : 'empty') : fees.some(v => v) ? 'ok' : 'empty', emptyText: 'No management fees in these dates.', lowText: 'The trend is by month, so it needs dates across two months or more.' },
    { kind: 'bars', id: 'fees-by-property', title: 'Management fees by property', order: 'desc', limit: 10, unit: 'Fees in these dates',
      rows: now.byProperty.filter(x => x.managementFeeMinor).map(x => ({ key: x.propertyId, label: x.propertyName, value: x.managementFeeMinor, display: formatMoneyShort(x.managementFeeMinor) })), state: now.byProperty.some(x => x.managementFeeMinor) ? 'ok' : 'empty', emptyText: 'No management fees in these dates.' },
    { kind: 'stack', id: 'channels', title: 'Nights booked by channel', unit: 'Share of nights booked', total: formatCount(now.byChannel.reduce((n, c) => n + c.nightsBooked, 0)),
      parts: stackParts(now.byChannel.slice(0, 6).map((c, i) => ({ key: c.channel, label: channelLabel(c.channel), value: c.nightsBooked, colour: SERIES[i] }))), state: now.byChannel.some(c => c.nightsBooked) ? 'ok' : 'empty', emptyText: 'No nights booked in these dates.' },
  ];
  return { kpis, charts, source: 'Source: owner statements and confirmed stays, worked out by the database (see the notes below).' };
}

// --- Furnishing Studio -------------------------------------------------------------------------------------------------

type Furnishing = { projects: number; sent: number; accepted: number; declined: number; conversionPercent: number | null; quotedPence: number; acceptedPence: number; byMonth: { month: string; sent: number; accepted: number; quotedPence: number }[]; byStatus: { status: string; projects: number }[]; topBySpend: { itemId: string; name: string; spendPence: number }[] };
export function furnishingModel(now: Furnishing, before: Furnishing | null, against: string, monthLabel: (m: string) => string, statusLabel: (s: string) => string): AnalyticsModel {
  const kpis: Kpi[] = [
    { key: 'sent', label: 'Quotes sent', value: formatCount(now.sent), note: `${counted(now.projects, 'project')} in these dates`, delta: compare(now.sent, before?.sent ?? null, { better: 'up', against }) },
    now.conversionPercent === null ? kpiEmpty('conversion', 'Conversion', 'No quotes sent yet') : { key: 'conversion', label: 'Conversion', value: `${formatFixed(now.conversionPercent, 1)}%`, note: `${now.accepted} accepted, ${now.declined} declined`, delta: compare(roundTo(now.conversionPercent, 1), before?.conversionPercent == null ? null : roundTo(before.conversionPercent, 1), { better: 'up', kind: 'percent', decimals: 1, against }) },
    { key: 'quoted', label: 'Quoted value', value: formatMoneyShort(now.quotedPence), delta: compare(now.quotedPence, before?.quotedPence ?? null, { better: 'up', format: n => formatMoneyShort(n), against }) },
    { key: 'accepted', label: 'Accepted value', value: formatMoneyShort(now.acceptedPence), delta: compare(now.acceptedPence, before?.acceptedPence ?? null, { better: 'up', format: n => formatMoneyShort(n), against }) },
  ];
  const months = [...now.byMonth].sort((a, b) => a.month.localeCompare(b.month));
  const charts: ChartSpec[] = [
    { kind: 'line', id: 'quotes-trend', title: 'Quotes sent and accepted by month', unit: 'Quotes', labels: months.map(m => monthLabel(m.month)), format: n => formatFixed(n),
      series: [{ key: 'sent', label: 'Sent', colour: 'series1', values: months.map(m => m.sent) }, { key: 'accepted', label: 'Accepted', colour: 'series2', values: months.map(m => m.accepted) }],
      state: !now.sent && !now.projects ? 'empty' : months.length < 2 ? 'low' : 'ok', emptyText: 'No quotes in these dates.', lowText: 'The trend is by month, so it needs dates across two months or more.' },
    { kind: 'stack', id: 'status', title: 'Projects by status', unit: 'Share of projects', total: formatCount(now.projects),
      parts: stackParts(now.byStatus.map((s, i) => ({ key: s.status, label: statusLabel(s.status), value: s.projects, colour: SERIES[i % SERIES.length] }))), state: now.projects ? 'ok' : 'empty', emptyText: 'No projects in these dates.' },
    { kind: 'bars', id: 'top-spend', title: 'Top items by spend', order: 'desc', limit: 8, unit: 'Spend on accepted quotes', colour: 'series2',
      rows: now.topBySpend.map(x => ({ key: x.itemId, label: x.name, value: x.spendPence, display: formatMoneyShort(x.spendPence) })), state: now.topBySpend.length ? 'ok' : 'empty', emptyText: 'No accepted quotes in these dates.' },
  ];
  return { kpis, charts, source: 'Source: Furnishing Studio projects and quotes, dated by the quote.' };
}
