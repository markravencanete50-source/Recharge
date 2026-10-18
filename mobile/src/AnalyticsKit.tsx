import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { Pills } from "./Pills";
import { DateField } from "./CalendarPicker";
import { Loading, message, Notice } from "./LiveKit";
import { ChartTip, HoverColumns, useChartFocus } from "./ChartTip";
import { chartTokens } from "../../lib/design-tokens";
import {
  PERIOD_LABEL, chartSummary, niceScale, periodRange, previousLabel, previousRange, rangeError, rangeLabel, rankBars, seriesAt, MAX_RANGE_DAYS,
  type AnalyticsModel, type BarsSpec, type ChartColour, type ChartSpec, type ColumnsSpec, type Delta, type DonutSpec, type Kpi, type LineChartSpec, type MoversSpec, type PeriodKey, type Range, type RingsSpec, type StackSpec,
} from "../../lib/report-analytics";

// The one analytics section every report opens with (lib/report-analytics.ts says what goes in it and why). A report builds
// an AnalyticsModel from the figures it already reads and hands it to <AnalyticsPanel>; this file draws it the same way
// everywhere: the period and where the figures come from, the headline figures with their change, then the charts, two
// across on a wide screen and one on a phone, never wider than the screen. Every chart has words for a screen reader and
// a "Show the figures" table with the same numbers, and says so plainly when there is nothing or too little to chart.

// Colour by meaning: identity from the chart tokens, status from the theme. Text never wears these colours.
export function chartColour(p: Palette, c: ChartColour = "series1"): string {
  if (c === "good") return p.success;
  if (c === "bad") return p.danger;
  if (c === "warn") return p.waiting;
  if (c === "neutral") return p.controlBorder;
  return chartTokens[p.isDark ? "dark" : "light"][c];
}
const toneInk = (p: Palette, tone: "good" | "bad" | "neutral") => (tone === "good" ? p.success : tone === "bad" ? p.danger : p.muted);

// --- The period ---------------------------------------------------------------------------------------------------------

export type PeriodState = ReturnType<typeof usePeriod>;
// The period a report shows, chosen from `presets`, with the previous period of the same length to compare with.
export function usePeriod(presets: readonly PeriodKey[], initial: PeriodKey, today: string, opts: { custom?: Range; maxDays?: number } = {}) {
  const [key, setKeyState] = useState<PeriodKey>(initial);
  const [custom, setCustom] = useState<Range>(() => opts.custom ?? periodRange("30d", today));
  const [error, setError] = useState("");
  const range = useMemo(() => periodRange(key, today, custom), [key, today, custom]);
  const previous = useMemo(() => previousRange(range), [range]);
  const setKey = (next: PeriodKey) => { setError(""); setKeyState(next); };
  const chooseCustom = (next: Range) => {
    const problem = rangeError(next, opts.maxDays ?? MAX_RANGE_DAYS);
    if (problem) { setError(problem); return; }
    setError(""); setCustom(next); setKeyState("custom");
  };
  return { key, setKey, range, previous, custom, chooseCustom, error, presets, today, against: previousLabel(key, range), label: rangeLabel(range) };
}

// The chosen period's answer and the previous period's, read together and kept with the dates they answer, so a change of
// period never shows the last answer. The previous period is only for the comparison: if it cannot be read, the figures
// still show and say there is nothing to compare with.
export function usePeriodData<T>(read: (r: Range) => Promise<T>, period: Pick<PeriodState, "range" | "previous">, enabled = true, deps: readonly unknown[] = []) {
  const [state, setState] = useState<{ key: string; now: T; before: T | null } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const latest = useRef(0);
  const key = [period.range.from, period.range.to, ...deps.map(String)].join(":");
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true); setError("");
    try {
      const [now, before] = await Promise.all([read(period.range), read(period.previous).catch(() => null)]);
      if (mine === latest.current) setState({ key, now, before });
    } catch (e) { if (mine === latest.current) { setState(null); setError(message(e)); } }
    finally { if (mine === latest.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && enabled) void load(); }); return () => { active = false; }; }, [load, enabled]);
  const shown = state?.key === key ? state : null;
  return { now: shown?.now ?? null, before: shown?.before ?? null, loading, error, retry: load };
}

// The period chips, the dates when "Custom" is chosen, and anything wrong with them. One row above everything it changes.
export function PeriodBar({ p, period }: { p: Palette; period: PeriodState }) {
  return (
    <View style={{ gap: 10 }}>
      <Pills p={p} title="Period" values={period.presets} value={period.key} onChange={period.setKey} label={k => PERIOD_LABEL[k]} />
      {period.key === "custom" && <DateField p={p} label="Dates" value={period.custom} onChange={period.chooseCustom} today={period.today} />}
      {!!period.error && <Notice text={period.error} p={p} tone="bad" />}
    </View>
  );
}

// --- The section --------------------------------------------------------------------------------------------------------

// The analytics section: heading, period, what it is measured against and where the figures come from, the headline
// figures, then the charts. `controls` is the period bar (or the report's own filters) shown above everything.
export function AnalyticsPanel({ p, model, controls, caption, loading = false, error = "", title = "Analytics" }: {
  p: Palette; model: AnalyticsModel | null; controls?: ReactNode; caption?: string; loading?: boolean; error?: string; title?: string;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <View testID="report-analytics" style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      {controls}
      {!!caption && <Text style={[ui.small, { color: p.muted }]}>{caption}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!model && loading && <Loading p={p} />}
      {model && <View style={{ gap: 16, opacity: loading ? 0.6 : 1 }}>
        {!!model.kpis.length && <KpiRow p={p} kpis={model.kpis} />}
        {!!model.charts.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {model.charts.map(c => <View key={c.id} style={{ flexBasis: wide ? "46%" : "100%", flexGrow: 1, minWidth: 0 }}><ChartCard p={p} chart={c} /></View>)}
        </View>}
        <Text style={[ui.small, { color: p.muted }]}>{model.source}</Text>
        {!!model.note && <Text style={[ui.small, { color: p.muted }]}>{model.note}</Text>}
      </View>}
    </View>
  );
}

// --- Headline figures ---------------------------------------------------------------------------------------------------

export function KpiRow({ p, kpis }: { p: Palette; kpis: readonly Kpi[] }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{kpis.map(k => <KpiTile key={k.key} p={p} kpi={k} />)}</View>;
}
// One figure: what it is, the value and unit, the change against the previous period (an arrow and a coloured change, the
// colour right for that figure), and how much it rests on ("from 76 reviews").
export function KpiTile({ p, kpi }: { p: Palette; kpi: Kpi }) {
  const d = kpi.delta;
  const said = [kpi.label, kpi.value + (kpi.unit ? " " + kpi.unit : ""), d ? (d.tone === "neutral" ? d.text : `${d.text}, ${d.tone === "good" ? "better" : "worse"}`) : "", kpi.note ?? ""].filter(Boolean).join(". ");
  return (
    <View accessible accessibilityLabel={said} testID={"kpi-" + kpi.key}
      style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexBasis: 150, flexGrow: 1, minWidth: 0, padding: 14, gap: 6 }]}>
      <Text numberOfLines={2} style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{kpi.label}</Text>
      <View style={[ui.row, { gap: 6, alignItems: "baseline", flexWrap: "wrap" }]}>
        <Text style={{ color: kpi.empty ? p.muted : p.text, fontSize: 26, lineHeight: 32, fontWeight: "600", fontVariant: [] }}>{kpi.value}</Text>
        {!!kpi.unit && <Text style={[ui.small, { color: p.muted }]}>{kpi.unit}</Text>}
      </View>
      {!!d && <DeltaLine p={p} delta={d} />}
      {!!kpi.note && <Text style={[ui.small, { color: p.muted }]}>{kpi.note}</Text>}
    </View>
  );
}

// The change against the previous period: an arrow and the change, green when better and red when worse for that figure
// (grey when neither is better), with the words saying it too.
export function DeltaLine({ p, delta: d }: { p: Palette; delta: Delta }) {
  const icon = d.direction === "none" ? null : d.direction === "same" ? "minus" : d.direction === "up" ? "arrow-up-right" : "arrow-down-right";
  return (
    <View style={[ui.row, { gap: 6, alignItems: "flex-start" }]}>
      {icon && <Feather name={icon} size={14} color={toneInk(p, d.tone)} style={{ marginTop: 3 }} />}
      <Text style={[ui.small, { color: d.direction === "none" ? p.muted : toneInk(p, d.tone), flex: 1, fontWeight: d.tone === "neutral" ? "400" : "600" }]}>{d.text}</Text>
    </View>
  );
}

// --- The card around every chart -------------------------------------------------------------------------------------

export function ChartCard({ p, chart }: { p: Palette; chart: ChartSpec }) {
  const [table, setTable] = useState(false);
  const body = chart.state === "empty"
    ? <Text style={[ui.small, { color: p.muted }]}>{chart.emptyText ?? "No data in this period."}</Text>
    : chart.state === "low" && chart.kind === "line"
      ? <Text style={[ui.small, { color: p.muted }]}>{chart.lowText ?? "Not enough data to chart in this period."}</Text>
      : table ? <FigureTable p={p} chart={chart} /> : <ChartBody p={p} chart={chart} />;
  return (
    <View testID={"chart-" + chart.id} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 16, gap: 12 }]}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{chart.title}</Text>
        {!!chart.subtitle && <Text style={[ui.small, { color: p.muted }]}>{chart.subtitle}</Text>}
      </View>
      <View accessible={!table} accessibilityRole={table ? undefined : "image"} accessibilityLabel={table ? undefined : chartSummary(chart)}>{body}</View>
      {chart.state === "low" && chart.kind !== "line" && !!chart.lowText && <Text style={[ui.small, { color: p.muted }]}>{chart.lowText}</Text>}
      {chart.state !== "empty" && !(chart.state === "low" && chart.kind === "line") && <MotionPress accessibilityRole="switch" accessibilityState={{ checked: table }} accessibilityLabel={`Show ${chart.title} as figures`} onPress={() => setTable(t => !t)} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{table ? "Show the chart" : "Show the figures"}</Text>
      </MotionPress>}
    </View>
  );
}
function ChartBody({ p, chart }: { p: Palette; chart: ChartSpec }) {
  switch (chart.kind) {
    case "line": return <LineView p={p} c={chart} />;
    case "bars": return <BarsView p={p} c={chart} />;
    case "columns": return <ColumnsView p={p} c={chart} />;
    case "stack": return <StackView p={p} c={chart} />;
    case "donut": return <DonutView p={p} c={chart} />;
    case "rings": return <RingsView p={p} c={chart} />;
    case "movers": return <MoversView p={p} c={chart} />;
  }
}

// The table view: the same figures as the chart, as text.
function FigureTable({ p, chart }: { p: Palette; chart: ChartSpec }) {
  const rows: string[][] = chart.kind === "line"
    ? chart.labels.map((label, i) => [label + (chart.partial?.[i] ? " (part)" : ""), ...chart.series.map(s => s.values[i] === null ? "–" : chart.format(s.values[i] as number)), ...(chart.extras ?? []).map(e => String(e.values[i]))])
    : chart.kind === "bars" ? rankBars(chart.rows, chart.order).all.map(r => [r.label, r.display])
    : chart.kind === "columns" ? chart.rows.map(r => [r.label, r.display])
    : chart.kind === "stack" || chart.kind === "donut" ? chart.parts.map(x => [x.label, x.display, x.share + "%"])
    : chart.kind === "rings" ? chart.rows.map(r => [r.label, r.display])
    : chart.rows.map(r => [r.label, `${r.before} to ${r.after}`, r.change]);
  const head = chart.kind === "line" ? ["", ...chart.series.map(s => s.label), ...(chart.extras ?? []).map(e => e.label)] : null;
  return (
    <View style={{ gap: 0 }}>
      {head && <View style={[ui.row, { gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: p.border }]}>{head.map((h, i) => <Text key={i} numberOfLines={1} style={[ui.small, { flex: 1, color: p.muted, fontWeight: "600", textAlign: i ? "right" : "left" }]}>{h}</Text>)}</View>}
      {rows.map((r, n) => <View key={n} style={[ui.row, { gap: 8, paddingVertical: 6, borderBottomWidth: n === rows.length - 1 ? 0 : 1, borderColor: p.border }]}>
        {r.map((cell, i) => <Text key={i} numberOfLines={2} style={[ui.small, { flex: i ? 0 : 1, minWidth: i ? 56 : 0, color: p.text, textAlign: i ? "right" : "left", fontVariant: ["tabular-nums"] }]}>{cell}</Text>)}
      </View>)}
    </View>
  );
}

// A legend for two or more series: a short line key and the name, in text ink.
function Legend({ p, items }: { p: Palette; items: { key: string; label: string; colour: string; dashed?: boolean; block?: boolean }[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
      {items.map(i => <View key={i.key} style={[ui.row, { gap: 6 }]}>
        {i.block ? <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: i.colour }} />
          : <View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: i.dashed ? "dashed" : "solid", borderColor: i.colour }} />}
        <Text style={[ui.small, { color: p.text }]}>{i.label}</Text>
      </View>)}
    </View>
  );
}

// --- Trend: a line with points --------------------------------------------------------------------------------------------

function LineView({ p, c }: { p: Palette; c: LineChartSpec }) {
  const [width, setWidth] = useState(300);
  const focus = useChartFocus();
  const height = 200, top = 12, bottom = 166, left = 40, right = 10;
  const style = c.style ?? "line", columns = style === "columns";
  const known = c.series.flatMap(s => s.values.filter((v): v is number => v !== null));
  // With no figure at all (the card shows the empty words instead, so this only guards the maths) the scale is 0 to 1.
  const marks = [...known, ...(c.reference ? [c.reference.value] : [])];
  const scale = niceScale(marks.length ? Math.min(...marks) : c.yMin ?? 0, marks.length ? Math.max(...marks) : c.yMax ?? 1, { zero: c.yMin === undefined, min: c.yMin, max: c.yMax });
  const n = c.labels.length;
  // Columns sit in the middle of a band per period; a line or area runs edge to edge.
  const band = (width - left - right) / Math.max(1, n);
  const x = (i: number) => columns ? left + band * (i + 0.5) : left + (n <= 1 ? (width - left - right) / 2 : (i / (n - 1)) * (width - left - right));
  const y = (v: number) => bottom - ((v - scale.min) / (scale.max - scale.min || 1)) * (bottom - top);
  // A gap where there is no figure: the line breaks rather than drawing through a zero that never happened.
  const path = (values: (number | null)[]) => values.reduce((d, v, i) => v === null ? d : d + `${i && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `, "");
  // The shaded area under each run of figures, down to the axis, closed at both ends of the run.
  const base = y(Math.max(scale.min, Math.min(0, scale.max)));
  const area = (values: (number | null)[]) => values.reduce((d, v, i) => {
    if (v === null) return d;
    const start = !i || values[i - 1] === null, end = i === values.length - 1 || values[i + 1] === null;
    return d + (start ? `M${x(i).toFixed(1)} ${base.toFixed(1)} ` : "") + `L${x(i).toFixed(1)} ${y(v).toFixed(1)} ` + (end ? `L${x(i).toFixed(1)} ${base.toFixed(1)} Z ` : "");
  }, "");
  const slot = Math.min(28, (band * 0.72) / Math.max(1, c.series.length));
  const gradient = (key: string) => `area-${c.id}-${key}`;
  const tickLabels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, list) => v >= 0 && list.indexOf(v) === i);
  const anchor = (i: number) => (n === 1 || columns ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle");
  const shown = focus.focus;
  return (
    <View style={{ gap: 10 }}>
      {c.series.length > 1 && <Legend p={p} items={[...c.series.map(s => ({ key: s.key, label: s.label, colour: chartColour(p, s.colour), block: columns })), ...(c.reference ? [{ key: "ref", label: c.reference.label, colour: p.muted, dashed: true }] : [])]} />}
      {c.series.length === 1 && c.reference && <Legend p={p} items={[{ key: "ref", label: `${c.reference.label} ${c.format(c.reference.value)}`, colour: p.muted, dashed: true }]} />}
      <View onLayout={e => setWidth(Math.max(160, e.nativeEvent.layout.width))} style={{ position: "relative" }}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          {style === "area" && <Defs>{c.series.map(s => <LinearGradient key={s.key} id={gradient(s.key)} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={chartColour(p, s.colour)} stopOpacity={c.series.length > 1 ? 0.22 : 0.32} />
            <Stop offset="1" stopColor={chartColour(p, s.colour)} stopOpacity={0.02} />
          </LinearGradient>)}</Defs>}
          {scale.ticks.map(t => <Line key={"g" + t} x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={p.border} strokeWidth={1} />)}
          {scale.ticks.map(t => <SvgText key={"t" + t} x={left - 6} y={y(t) + 4} textAnchor="end" fill={p.muted} fontFamily="Montserrat_500Medium" fontSize={11}>{c.format(t)}</SvgText>)}
          {c.reference && <Line x1={left} x2={width - right} y1={y(c.reference.value)} y2={y(c.reference.value)} stroke={p.muted} strokeWidth={1.5} strokeDasharray="5 4" />}
          {shown !== null && <Line x1={x(shown)} x2={x(shown)} y1={top} y2={bottom} stroke={p.controlBorder} strokeWidth={1} />}
          {style === "area" && c.series.map(s => <Path key={"a" + s.key} d={area(s.values)} fill={`url(#${gradient(s.key)})`} stroke="none" />)}
          {columns && c.series.map((s, k) => s.values.map((v, i) => v === null ? null : <Rect key={s.key + i} x={x(i) - (slot * c.series.length) / 2 + slot * k + 1} width={Math.max(2, slot - 2)}
            y={Math.min(y(v), base - (v ? 2 : 0))} height={Math.max(v ? 2 : 0, Math.abs(base - y(v)))} rx={3} fill={chartColour(p, s.colour)} opacity={shown === null || shown === i ? 1 : 0.55} />))}
          {!columns && c.series.map(s => <Path key={s.key} d={path(s.values)} fill="none" stroke={chartColour(p, s.colour)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
          {!columns && c.series.map(s => s.values.map((v, i) => v === null ? null : <Circle key={s.key + i} cx={x(i)} cy={y(v)} r={shown === i ? 5 : 4} fill={chartColour(p, s.colour)} stroke={p.surface} strokeWidth={2} />))}
          {tickLabels.map(i => <SvgText key={"x" + i} x={x(i)} y={height - 8} textAnchor={anchor(i)} fill={p.muted} fontFamily="Montserrat_500Medium" fontSize={11}>{c.labels[i]}</SvgText>)}
        </Svg>
        <HoverColumns xs={c.labels.map((_, i) => x(i))} width={width} height={bottom} focus={focus}
          label={i => `${c.labels[i]}: ${c.series.map(s => `${s.label} ${s.values[i] === null ? "no figure" : c.format(s.values[i] as number)}`).join(", ")}`} />
        {shown !== null && <ChartTip p={p} x={x(shown)} width={width} top={0} tipWidth={170}
          title={c.labels[shown] + (c.partial?.[shown] ? " (part)" : "")}
          rows={[...c.series.map(s => ({ label: s.label, value: s.values[shown] === null ? "–" : c.format(s.values[shown] as number), color: undefined })), ...(c.extras ?? []).map(e => ({ label: e.label, value: e.values[shown] }))]} />}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{c.unit}{c.partial?.some(Boolean) ? ". A period cut short by the dates is marked (part)." : ""}</Text>
    </View>
  );
}

// --- Comparison: sorted horizontal bars -----------------------------------------------------------------------------------

function BarsView({ p, c }: { p: Palette; c: BarsSpec }) {
  const [all, setAll] = useState(false);
  const ranked = rankBars(c.rows, c.order, all ? undefined : c.limit);
  const max = c.max ?? Math.max(ranked.max, c.reference?.value ?? 0, 0) ?? 1;
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%` as const;
  // One colour, a colour per row in turn (`palette`), or the row's own colour where it means something (good, warn, bad).
  const ink = (r: { colour?: ChartColour }, i: number) => chartColour(p, r.colour ?? (c.palette ? seriesAt(i) : c.colour ?? "series1"));
  return (
    <View style={{ gap: 12 }}>
      {c.reference && <Legend p={p} items={[{ key: "ref", label: `${c.reference.label} ${c.reference.value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`, colour: p.muted, dashed: true }]} />}
      {ranked.rows.map((r, i) => (
        <View key={r.key} style={{ gap: 4 }}>
          <View style={[ui.between, { gap: 10, alignItems: "flex-start" }]}>
            <Text numberOfLines={2} style={[ui.small, { color: p.text, flex: 1, fontWeight: "600" }]}>{r.label}</Text>
            <Text style={[ui.small, { color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{r.display}</Text>
          </View>
          <View style={{ height: 12, justifyContent: "center" }}>
            <View style={{ height: 12, borderRadius: 6, backgroundColor: p.elevated, opacity: 0.5, position: "absolute", left: 0, right: 0 }} />
            {r.value !== null && <View style={{ height: 12, width: at(r.value), borderRadius: 6, backgroundColor: ink(r, i), opacity: r.muted ? 0.45 : 1 }} />}
            {c.reference && <View style={{ position: "absolute", left: at(c.reference.value), top: -3, bottom: -3, width: 0, borderLeftWidth: 2, borderStyle: "dashed", borderColor: p.muted }} />}
          </View>
          {!!r.detail && <Text style={[ui.small, { color: p.muted }]}>{r.detail}</Text>}
        </View>
      ))}
      {(ranked.hidden > 0 || all) && !!c.limit && ranked.all.length > c.limit && <MotionPress accessibilityRole="button" onPress={() => setAll(a => !a)} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{all ? `Show the top ${c.limit}` : `Show all ${ranked.all.length}`}</Text>
      </MotionPress>}
      <Text style={[ui.small, { color: p.muted }]}>{c.unit}</Text>
    </View>
  );
}

// --- Distribution: columns in the categories' own order -------------------------------------------------------------------

function ColumnsView({ p, c }: { p: Palette; c: ColumnsSpec }) {
  const max = Math.max(1, ...c.rows.map(r => r.value)), height = 120;
  const col = useChartFocus();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: height + 22 }} {...col.leave}>
        {c.rows.map((r, i) => (
          <MotionPress key={r.key} accessibilityRole="button" accessibilityLabel={`${r.label}: ${r.display}`} {...col.press(i)} style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "flex-end", height: height + 22, gap: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: p.text, fontVariant: ["tabular-nums"] }}>{r.display}</Text>
            <View style={{ width: "70%", maxWidth: 40, height: Math.max(r.value ? 3 : 1, (r.value / max) * height), borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: r.value ? chartColour(p, r.colour ?? (c.palette ? seriesAt(i) : "series1")) : p.border, opacity: col.focus === null || col.focus === i ? 1 : 0.55 }} />
          </MotionPress>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 2, borderTopWidth: 1, borderColor: p.border, paddingTop: 6 }}>
        {c.rows.map(r => <Text key={r.key} numberOfLines={2} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: p.muted }}>{r.label}</Text>)}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{c.unit}</Text>
    </View>
  );
}

// --- Share of a whole: one 100% bar ------------------------------------------------------------------------------------

function StackView({ p, c }: { p: Palette; c: StackSpec }) {
  const parts = c.parts.filter(x => x.value > 0);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", height: 16, gap: 2, borderRadius: 4, overflow: "hidden" }}>
        {parts.map(x => <View key={x.key} style={{ flexGrow: x.value, flexBasis: 0, minWidth: 3, backgroundColor: chartColour(p, x.colour) }} />)}
      </View>
      <View style={{ gap: 6 }}>
        {c.parts.map(x => (
          <View key={x.key} style={[ui.row, { gap: 8 }]}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: chartColour(p, x.colour) }} />
            <Text numberOfLines={2} style={[ui.small, { color: p.text, flex: 1 }]}>{x.label}</Text>
            <Text style={[ui.small, { color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{x.display}</Text>
            <Text style={[ui.small, { color: p.muted, minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{x.share}%</Text>
          </View>
        ))}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{c.unit}. Total {c.total}.</Text>
    </View>
  );
}

// --- Share of a whole: a ring with the total in the middle ---------------------------------------------------------------

// A point on a circle, clockwise from twelve o'clock, and the arc between two such angles (degrees).
const onCircle = (cx: number, cy: number, r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const; };
function ringArc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = onCircle(cx, cy, r, from), [x1, y1] = onCircle(cx, cy, r, to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function DonutView({ p, c }: { p: Palette; c: DonutSpec }) {
  const [focus, setFocus] = useState<string | null>(null);
  const size = 180, mid = size / 2, radius = 68, thick = 24;
  const parts = c.parts.filter(x => x.value > 0), total = parts.reduce((n, x) => n + x.value, 0) || 1;
  // A small gap between the parts, so neighbouring colours never run together; none with only one part.
  const gap = parts.length > 1 ? 1.6 : 0;
  const ends = parts.map((_, i) => (parts.slice(0, i + 1).reduce((n, x) => n + x.value, 0) / total) * 360);
  const arcs = parts.map((x, i) => ({ ...x, from: i ? ends[i - 1] : 0, to: ends[i] }));
  const picked = arcs.find(x => x.key === focus) ?? null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <View style={{ width: size, height: size, alignSelf: "center" }}>
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle cx={mid} cy={mid} r={radius} fill="none" stroke={p.elevated} strokeWidth={thick} />
            {arcs.map(x => x.to - x.from >= 359.9
              ? <Circle key={x.key} cx={mid} cy={mid} r={radius} fill="none" stroke={chartColour(p, x.colour)} strokeWidth={thick} />
              : <Path key={x.key} d={ringArc(mid, mid, radius, x.from + gap / 2, Math.max(x.from + gap / 2 + 0.5, x.to - gap / 2))} fill="none" stroke={chartColour(p, x.colour)}
                strokeWidth={focus === x.key ? thick + 6 : thick} opacity={focus === null || focus === x.key ? 1 : 0.4} />)}
          </Svg>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}>
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{picked ? `${picked.share}%` : c.total}</Text>
            <Text numberOfLines={2} style={[ui.small, { color: p.muted, textAlign: "center" }]}>{picked ? picked.label : "Total"}</Text>
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 160, gap: 6 }}>
          {c.parts.map(x => (
            <MotionPress key={x.key} accessibilityRole="button" accessibilityLabel={`${x.label}: ${x.display}, ${x.share}%`} disabled={!x.value}
              onPress={() => setFocus(f => (f === x.key ? null : x.key))} style={[ui.row, { gap: 8, minHeight: 28, opacity: focus === null || focus === x.key ? 1 : 0.6 }]}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: chartColour(p, x.colour) }} />
              <Text numberOfLines={2} style={[ui.small, { color: p.text, flex: 1 }]}>{x.label}</Text>
              <Text style={[ui.small, { color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{x.display}</Text>
              <Text style={[ui.small, { color: p.muted, minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{x.share}%</Text>
            </MotionPress>
          ))}
        </View>
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{c.unit}. Total {c.total}. Tap a part to see its share.</Text>
    </View>
  );
}

// --- Rates out of 100: progress rings ------------------------------------------------------------------------------------

function RingsView({ p, c }: { p: Palette; c: RingsSpec }) {
  const rows = c.rows.slice(0, 4), size = 180, mid = size / 2, thick = 12, step = thick + 6;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
      <View style={{ width: size, height: size, alignSelf: "center" }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {rows.map((r, i) => {
            const radius = mid - thick / 2 - 2 - i * step, v = Math.max(0, Math.min(100, r.value ?? 0));
            return [
              <Circle key={r.key + "-track"} cx={mid} cy={mid} r={radius} fill="none" stroke={p.elevated} strokeWidth={thick} />,
              v >= 99.95 ? <Circle key={r.key} cx={mid} cy={mid} r={radius} fill="none" stroke={chartColour(p, r.colour)} strokeWidth={thick} />
                : v > 0 ? <Path key={r.key} d={ringArc(mid, mid, radius, 0, Math.max(2, v * 3.6))} fill="none" stroke={chartColour(p, r.colour)} strokeWidth={thick} strokeLinecap="round" /> : null,
            ];
          })}
        </Svg>
      </View>
      <View style={{ flex: 1, minWidth: 160, gap: 10 }}>
        {rows.map(r => (
          <View key={r.key} style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 4, backgroundColor: chartColour(p, r.colour) }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={[ui.small, { color: p.text }]}>{r.label}</Text>
              {!!r.detail && <Text style={[ui.small, { color: p.muted }]}>{r.detail}</Text>}
            </View>
            <Text style={{ color: p.text, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{r.display}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// --- Biggest changes ---------------------------------------------------------------------------------------------------

function MoversView({ p, c }: { p: Palette; c: MoversSpec }) {
  return (
    <View style={{ gap: 0 }}>
      {c.rows.map((r, i) => (
        <View key={r.key} style={[ui.row, { gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
          <Feather name={r.direction === "up" ? "arrow-up-right" : "arrow-down-right"} size={16} color={toneInk(p, r.tone)} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={[ui.small, { color: p.text, fontWeight: "600" }]}>{r.label}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{r.before} to {r.after}</Text>
          </View>
          <Text style={[ui.small, { color: toneInk(p, r.tone), fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{r.change}</Text>
        </View>
      ))}
    </View>
  );
}
