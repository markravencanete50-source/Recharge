// The shared analytics kit behind every report (Lee, 18 October 2026: "Every reporting should have an analytics. Make sure
// the analytics is professional, think like a data analyst, structure the graphs, lines etc.").
//
// Each report page opens with the same analytics section, drawn by mobile/src/AnalyticsKit.tsx from a model this file
// describes: a period picker, a row of three to five headline figures (each with its change against the previous period
// of the same length, coloured by whether that change is good for that figure), then charts chosen by the question:
//   trend over time            -> 'line'    (points, a light grid, units, an optional dashed reference line)
//   comparison across things   -> 'bars'    (sorted horizontal bars with value labels, top N and "Show all")
//   distribution               -> 'columns' (a histogram in the categories' own order, e.g. 1 to 5 stars)
//   share of a whole / status  -> 'stack'   (one 100% bar; never a pie)
//   biggest changes            -> 'movers'
// Everything here is plain maths with no React, so the tests can check it. Nothing is ever invented: a figure with no data
// is null and says so, a chart with too little data shows why instead of a line, and every rounding goes through roundTo.

// --- Periods ----------------------------------------------------------------------------------------------------------

export type Range = { from: string; to: string };
export const PERIOD_KEYS = ['today', '7d', '30d', '90d', 'month', '12m', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABEL: Record<PeriodKey, string> = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days', month: 'This month', '12m': '12 months', custom: 'Custom' };
// What the change on each figure is measured against, in words: "the previous 30 days".
const PREVIOUS_LABEL: Record<PeriodKey, string> = { today: 'yesterday', '7d': 'the previous 7 days', '30d': 'the previous 30 days', '90d': 'the previous 90 days', month: 'last month', '12m': 'the previous 12 months', custom: 'the same number of days before' };
// The usual choice on most reports, and the longest a report can read in one go (the reports refuse more than 366 days).
export const STANDARD_PERIODS: readonly PeriodKey[] = ['30d', '90d', '12m', 'custom'];
export const MAX_RANGE_DAYS = 366;

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const shiftDay = (day: string, days: number) => new Date(Date.parse(day + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const rangeDays = (r: Range) => Math.round((Date.parse(r.to + 'T12:00:00Z') - Date.parse(r.from + 'T12:00:00Z')) / DAY) + 1;
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1 to 12
const isWholeMonths = (r: Range) => r.from.endsWith('-01') && Number(r.to.slice(8, 10)) === lastDayOf(Number(r.to.slice(0, 4)), Number(r.to.slice(5, 7)));

// The dates a period covers, counted back from today (the UK day). "12 months" is the last 365 days, so it compares with
// the 365 days before on equal terms; "This month" is the whole calendar month (bookings ahead count on stay reports).
export function periodRange(key: PeriodKey, today: string, custom?: Range): Range {
  if (key === 'custom') return custom ?? { from: shiftDay(today, -29), to: today };
  if (key === 'today') return { from: today, to: today };
  if (key === 'month') { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` }; }
  const days = key === '7d' ? 7 : key === '30d' ? 30 : key === '90d' ? 90 : 365;
  return { from: shiftDay(today, 1 - days), to: today };
}
// The previous period of the same length, just before: whole calendar months compare with the same number of whole months
// before (October with September); anything else with the same number of days before.
export function previousRange(r: Range): Range {
  if (isWholeMonths(r)) {
    const months = (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5, 7)) - Number(r.from.slice(5, 7)) + 1;
    const fy = Number(r.from.slice(0, 4)), fm = Number(r.from.slice(5, 7));
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1)), end = new Date(Date.UTC(fy, fm - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const n = rangeDays(r);
  return { from: shiftDay(r.from, -n), to: shiftDay(r.from, -1) };
}
// '' when the dates can be used, or what to change.
export function rangeError(r: Range, maxDays = MAX_RANGE_DAYS): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) return 'Choose the first and last day.';
  if (r.to < r.from) return 'The last day must be on or after the first day.';
  return rangeDays(r) > maxDays ? `Choose up to ${maxDays} days.` : '';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayText = (day: string, year = true) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}${year ? ' ' + day.slice(0, 4) : ''}`;
// "1 Oct to 30 Oct 2026", "8 Oct 2026", "October 2026".
export function rangeLabel(r: Range): string {
  if (r.from === r.to) return dayText(r.from);
  if (isWholeMonths(r) && r.from.slice(0, 7) === r.to.slice(0, 7)) return `${MONTHS_LONG[Number(r.from.slice(5, 7)) - 1]} ${r.from.slice(0, 4)}`;
  return `${dayText(r.from, r.from.slice(0, 4) !== r.to.slice(0, 4))} to ${dayText(r.to)}`;
}
// "vs the previous 30 days (2 Aug to 31 Aug 2026)".
export function previousLabel(key: PeriodKey, r: Range): string {
  return `vs ${PREVIOUS_LABEL[key]} (${rangeLabel(previousRange(r))})`;
}

// --- Buckets for trends -----------------------------------------------------------------------------------------------

export type Grain = 'day' | 'week' | 'month';
// Days for a month or less, weeks up to four months, months beyond: always enough points for a line, never too many.
export function grainFor(r: Range): Grain {
  const n = rangeDays(r);
  return n <= 31 ? 'day' : n <= 122 ? 'week' : 'month';
}
export const mondayOf = (day: string) => { const d = new Date(day + 'T12:00:00Z'); return shiftDay(day, -((d.getUTCDay() + 6) % 7)); };
export function bucketKey(day: string, grain: Grain): string {
  return grain === 'day' ? day : grain === 'week' ? mondayOf(day) : day.slice(0, 7);
}
export type Bucket = { key: string; from: string; to: string; label: string; partial: boolean };
// Every bucket in the range, in order, each clipped to the range. A clipped week or month is marked partial, so its
// total is never read as a whole one.
export function buckets(r: Range, grain: Grain = grainFor(r)): Bucket[] {
  const out: Bucket[] = [];
  let day = r.from;
  while (day <= r.to) {
    const key = bucketKey(day, grain);
    const end = grain === 'day' ? day : grain === 'week' ? shiftDay(key, 6) : `${key}-${pad(lastDayOf(Number(key.slice(0, 4)), Number(key.slice(5, 7))))}`;
    const start = grain === 'month' ? key + '-01' : key;
    const from = start < r.from ? r.from : start, to = end > r.to ? r.to : end;
    const label = grain === 'month' ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}` : grain === 'week' ? `w/c ${dayText(key, false)}` : dayText(day, false);
    out.push({ key, from, to, label, partial: from !== start || to !== end });
    day = shiftDay(to, 1);
  }
  return out;
}
// Totals per bucket from dated points, zero where nothing happened (a count with no events is a true zero).
export function sumSeries(points: readonly { day: string; value: number }[], r: Range, grain: Grain = grainFor(r)): number[] {
  const list = buckets(r, grain), index = new Map(list.map((b, i) => [b.key, i])), out = list.map(() => 0);
  for (const p of points) { if (p.day < r.from || p.day > r.to) continue; const i = index.get(bucketKey(p.day, grain)); if (i !== undefined) out[i] += p.value; }
  return out;
}
// Averages per bucket from dated sums and counts: null (a gap in the line, not a zero) where there is nothing to average.
export function averageSeries(points: readonly { day: string; sum: number; n: number }[], r: Range, grain: Grain = grainFor(r)) {
  const list = buckets(r, grain), index = new Map(list.map((b, i) => [b.key, i]));
  const sums = list.map(() => 0), counts = list.map(() => 0);
  for (const p of points) { if (p.day < r.from || p.day > r.to) continue; const i = index.get(bucketKey(p.day, grain)); if (i !== undefined) { sums[i] += p.sum; counts[i] += p.n; } }
  return { values: sums.map((s, i) => (counts[i] ? s / counts[i] : null)), counts };
}

// --- Rounding and numbers -------------------------------------------------------------------------------------------

// Half away from zero at any number of decimals, without binary surprises (1.005 -> 1.01) and never "-0".
export function roundTo(n: number, decimals = 0): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** decimals, v = Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
  return Object.is(v, -0) ? 0 : v;
}
const grouped = (decimals: number) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
// 1234 -> "1,234"; 4.25 at 1 -> "4.3". A true minus sign for negatives.
export function formatFixed(n: number | null, decimals = 0): string {
  if (n === null || !Number.isFinite(n)) return '–';
  const v = roundTo(n, decimals);
  return (v < 0 ? '−' : '') + grouped(decimals).format(Math.abs(v));
}
export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
// A share as a whole percentage, or null with nothing to share.
export const percentOf = (part: number, whole: number) => (whole > 0 ? roundTo((part * 100) / whole) : null);
// Whole percentages that add up to exactly 100 (largest remainder), so a stacked bar's labels never read 99% or 101%.
export function sharesOf(values: readonly number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (!total) return values.map(() => 0);
  const raw = values.map(v => (Math.max(0, v) * 100) / total), floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; if (raw[i] > 0) { floors[i] += 1; left -= 1; } }
  return floors;
}

// A clean axis: round steps (1, 2, 2.5 or 5 times a power of ten) that cover the data, from zero for counts and money,
// or hugging the data for a rating or an average (`zero: false`), always within any fixed bounds given.
export function niceScale(low: number, high: number, opts: { ticks?: number; zero?: boolean; min?: number; max?: number } = {}) {
  const want = opts.ticks ?? 4, zero = opts.zero ?? true;
  let lo = zero ? Math.min(0, low) : low, hi = Math.max(high, lo);
  if (opts.min !== undefined) lo = Math.max(opts.min, Math.min(lo, opts.max ?? lo));
  if (hi === lo) hi = lo + (zero ? 1 : 0.5);
  const rough = (hi - lo) / want, power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough - 1e-12) ?? 10 * power;
  let min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
  if (opts.min !== undefined) min = Math.max(opts.min, min);
  if (opts.max !== undefined) max = Math.min(opts.max, max);
  if (max <= min) max = min + step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(roundTo(v, 6));
  return { min, max, step, ticks };
}

// --- Change against the previous period -------------------------------------------------------------------------------

// Which way is good for a figure: more reviews and a higher rating are good ('up'); a slower reply, a higher cost, more
// overdue work are bad ('down'); a plain volume like messages sent is neither ('none'), so it is shown in grey.
export type Better = 'up' | 'down' | 'none';
export type Delta = { direction: 'up' | 'down' | 'same' | 'none'; tone: 'good' | 'bad' | 'neutral'; change: number | null; relative: number | null; text: string };
// How a change is written: a count or money shows the difference and the percentage; a percentage shows points; a rating
// or an average shows the difference at its own decimals.
export type DeltaStyle = { better: Better; decimals?: number; kind?: 'count' | 'percent' | 'average'; format?: (n: number) => string; against?: string };
export function compare(current: number | null, previous: number | null, style: DeltaStyle): Delta {
  const decimals = style.decimals ?? 0, against = style.against ? ' ' + style.against : '';
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous))
    return { direction: 'none', tone: 'neutral', change: null, relative: null, text: 'No earlier figure to compare' };
  const change = roundTo(current - previous, decimals);
  if (change === 0) return { direction: 'same', tone: 'neutral', change: 0, relative: 0, text: 'No change' + against };
  const direction = change > 0 ? 'up' : 'down';
  const tone = style.better === 'none' ? 'neutral' : (direction === style.better ? 'good' : 'bad');
  const sign = change > 0 ? '+' : '−', size = Math.abs(change);
  const relative = style.kind === 'percent' || style.kind === 'average' || previous === 0 ? null : roundTo(((current - previous) * 100) / Math.abs(previous));
  const body = style.kind === 'percent' ? `${sign}${formatFixed(size, decimals)} pts`
    : `${sign}${style.format ? style.format(size) : formatFixed(size, decimals)}${relative === null ? (previous === 0 && style.kind !== 'average' ? ' (new)' : '') : ` (${relative > 0 ? '+' : relative < 0 ? '−' : ''}${formatFixed(Math.abs(relative))}%)`}`;
  return { direction, tone, change, relative, text: body + against };
}

// --- Honest states ----------------------------------------------------------------------------------------------------

export type SampleState = 'ok' | 'low' | 'empty';
// Empty with nothing at all, low below the minimum a chart or average needs to mean anything.
export const sampleState = (n: number, minimum: number): SampleState => (n <= 0 ? 'empty' : n < minimum ? 'low' : 'ok');

// --- Sorted bars ------------------------------------------------------------------------------------------------------

export type BarRow = { key: string; label: string; value: number | null; display: string; detail?: string; muted?: boolean };
// Highest first (or lowest first, for "where are the problems"), rows with no value always last, ties by name; `limit`
// keeps the top N and says how many are hidden behind "Show all".
export function rankBars(rows: readonly BarRow[], order: 'desc' | 'asc' = 'desc', limit?: number) {
  const sorted = [...rows].sort((a, b) => {
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
    if (a.value !== null && b.value !== null && a.value !== b.value) return order === 'desc' ? b.value - a.value : a.value - b.value;
    return a.label.localeCompare(b.label, 'en-GB');
  });
  const shown = limit && sorted.length > limit ? sorted.slice(0, limit) : sorted;
  const values = sorted.filter(r => r.value !== null).map(r => r.value as number);
  return { rows: shown, all: sorted, hidden: sorted.length - shown.length, max: values.length ? Math.max(...values) : 0, min: values.length ? Math.min(...values) : 0 };
}

// --- The model the screen draws ---------------------------------------------------------------------------------------

// Colours by meaning, the same on every report (mobile/src/AnalyticsKit.tsx resolves them from lib/design-tokens.ts
// chartTokens): series1 to series6 for identity in a fixed order, good / warn / bad / neutral for status, never mixed.
export type ChartColour = 'series1' | 'series2' | 'series3' | 'series4' | 'series5' | 'series6' | 'good' | 'warn' | 'bad' | 'neutral';
export const SERIES: readonly ChartColour[] = ['series1', 'series2', 'series3', 'series4', 'series5', 'series6'];

export type Kpi = { key: string; label: string; value: string; unit?: string; delta?: Delta; note?: string; empty?: boolean };
type ChartBase = { id: string; title: string; subtitle?: string; state: SampleState; emptyText?: string; lowText?: string };
export type LineSeries = { key: string; label: string; colour: ChartColour; values: (number | null)[] };
export type LineChartSpec = ChartBase & {
  kind: 'line'; unit: string; labels: string[]; partial?: boolean[]; series: LineSeries[]; format: (n: number) => string; decimals?: number;
  // Extra rows for each point's tooltip and table (e.g. "Reviews 12").
  extras?: { label: string; values: (string | number)[] }[];
  reference?: { value: number; label: string }; yMin?: number; yMax?: number;
};
export type BarsSpec = ChartBase & { kind: 'bars'; unit: string; rows: BarRow[]; order: 'desc' | 'asc'; limit?: number; reference?: { value: number; label: string }; colour?: ChartColour; max?: number };
export type ColumnsSpec = ChartBase & { kind: 'columns'; unit: string; rows: { key: string; label: string; value: number; display: string; colour?: ChartColour }[] };
export type StackSpec = ChartBase & { kind: 'stack'; unit: string; parts: { key: string; label: string; value: number; display: string; share: number; colour: ChartColour }[]; total: string };
export type MoversSpec = ChartBase & { kind: 'movers'; rows: { key: string; label: string; before: string; after: string; change: string; tone: 'good' | 'bad' | 'neutral'; direction: 'up' | 'down' }[] };
export type ChartSpec = LineChartSpec | BarsSpec | ColumnsSpec | StackSpec | MoversSpec;
export type AnalyticsModel = { kpis: Kpi[]; charts: ChartSpec[]; source: string; note?: string };

// A stacked bar's parts with shares that add up to 100, zero parts kept (so the legend still names them).
export function stackParts(parts: readonly { key: string; label: string; value: number; colour: ChartColour; display?: string }[]) {
  const shares = sharesOf(parts.map(p => p.value));
  return parts.map((p, i) => ({ ...p, display: p.display ?? formatFixed(p.value), share: shares[i] }));
}
// The words a screen reader hears for a chart, and the table view's rows: the same figures as the picture.
export function chartSummary(c: ChartSpec): string {
  if (c.state === 'empty') return `${c.title}. ${c.emptyText ?? 'No data in this period.'}`;
  switch (c.kind) {
    case 'line': {
      const s = c.series[0], known = s.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][];
      if (!known.length) return `${c.title}. No data in this period.`;
      const [first, last] = [known[0], known[known.length - 1]];
      const top = known.reduce((a, b) => (b[0] > a[0] ? b : a));
      return `${c.title}, ${c.unit}. ${c.labels[first[1]]} ${c.format(first[0])}, ${c.labels[last[1]]} ${c.format(last[0])}, highest ${c.format(top[0])} in ${c.labels[top[1]]}.`
        + (c.reference ? ` ${c.reference.label} ${c.format(c.reference.value)}.` : '');
    }
    case 'bars': { const r = rankBars(c.rows, c.order); return `${c.title}, ${c.unit}. ` + r.all.slice(0, 5).map(x => `${x.label} ${x.display}`).join(', ') + (r.all.length > 5 ? `, and ${r.all.length - 5} more.` : '.'); }
    case 'columns': return `${c.title}, ${c.unit}. ` + c.rows.map(x => `${x.label} ${x.display}`).join(', ') + '.';
    case 'stack': return `${c.title}. Total ${c.total}. ` + c.parts.map(x => `${x.label} ${x.display}, ${x.share}%`).join(', ') + '.';
    case 'movers': return `${c.title}. ` + c.rows.map(x => `${x.label} ${x.before} to ${x.after}`).join(', ') + '.';
  }
}
