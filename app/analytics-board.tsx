"use client";


import { useMemo, useState, useSyncExternalStore } from "react";
import { Activity, CircleCheck, Clock3, Building2, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildAnalytics, periodLabel, presetPeriod, type AnalyticsSnapshot } from "@/lib/analytics";
import { AnalyticsDateRange } from "@/app/analytics-date-range";

const colours = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
function subscribeMotion(callback: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", callback);
  return () => preference.removeEventListener("change", callback);
}
export function AnalyticsBoard({ initialData, preview }: { initialData: AnalyticsSnapshot; preview: boolean }) {
  const [period, setPeriod] = useState(() => presetPeriod(30));
  const [choice, setChoice] = useState("30");
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const motion = useSyncExternalStore(subscribeMotion, () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const metrics = useMemo(() => buildAnalytics(data, period), [data, period]);
  async function refresh() {
    setRefreshing(true); setError("");
    try {
      if (preview) { setData(initialData); setUpdated(new Date()); return; }
      const response = await fetch("/api/analytics", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setData({ ...data, propertyCount: 0, sources: [] });
        setError("Your access has changed. Sign in again to load your current analytics.");
        return;
      }
      if (!response.ok) throw new Error("Refresh unavailable");
      const result = await response.json() as { data?: AnalyticsSnapshot };
      if (!result.data) throw new Error("Missing analytics");
      setData(result.data); setUpdated(new Date());
      if (result.data.sources.some(source => !source.available)) setError("Some permitted sources are unavailable. Their counts are excluded until they reconnect.");
    } catch { setError("Could not refresh the board. Check your connection and try again."); }
    finally { setRefreshing(false); }
  }
  const tooltip = { contentStyle: { background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 12 }, labelStyle: { color: "var(--foreground)" } };
  return <section className="analytics-board">
    <p className="eyebrow">Your workspace intelligence</p>
    <div className="analytics-heading">
      <div><h1>{data.title}</h1><p>{data.description}</p></div>
      <div className="analytics-controls">
        <AnalyticsDateRange period={period} choice={choice} onChange={(next, nextChoice) => { setPeriod(next); setChoice(nextChoice); }} />
        <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh analytics"><RefreshCw size={17} className={refreshing ? "animate-spin" : ""} /></button>
      </div>
    </div>
    <p className="analytics-period-summary" role="status">{periodLabel(period)}<span>UK dates, both dates included</span></p>
    <div className="analytics-source-note">{preview ? "Sample records for design review." : "Records permitted by your current access. Source limits apply."} Last updated {updated ? updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "on opening"}.</div>
    {error && <p role="alert" className="analytics-error">{error}</p>}
    <div className="analytics-metrics">
      {[{ name: "Recorded items", value: metrics.total, note: "Across the selected period", icon: Activity }, { name: "Completed", value: metrics.complete, note: "Current completion status", icon: CircleCheck }, { name: "Waiting", value: metrics.waiting, note: "New or awaiting action", icon: Clock3 }, { name: data.propertyLabel, value: data.propertyCount, note: "Current property snapshot", icon: Building2 }].map(({ name, value, note, icon: Icon }) => <article className="analytics-metric" key={name}><div><span>{name}</span><Icon size={20} /></div><strong>{value.toLocaleString("en-GB")}</strong><p>{note}</p></article>)}
    </div>
    <div className="analytics-chart-grid">
      <article className="analytics-chart analytics-trend"><div className="analytics-chart-title"><div><h2>Activity over time</h2><p>Daily records within your access</p></div><span className="analytics-chart-tag">Daily</span></div>
        <div className="analytics-plot" role="img" aria-label="Line chart of permitted daily records. Exact values are available under View chart data."><ResponsiveContainer width="100%" height="100%"><LineChart data={metrics.trend} margin={{ left: -20, right: 15, top: 20, bottom: 0 }} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" /><XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} minTickGap={45} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip {...tooltip} />{metrics.sources.map((source, i) => <Line key={source.key} type="monotone" dataKey={source.key} name={source.name} stroke={colours[i % colours.length]} strokeWidth={3} dot={metrics.trend.length === 1 ? { r: 4 } : false} activeDot={{ r: 5 }} isAnimationActive={motion} animationDuration={800} />)}</LineChart></ResponsiveContainer></div>
        <div className="analytics-legend">{metrics.sources.map((source, i) => <span key={source.key}><i style={{ background: colours[i % colours.length] }} />{source.name}</span>)}</div>
      </article>
      <article className="analytics-chart"><div className="analytics-chart-title"><div><h2>Work status</h2><p>Current status of records in this period</p></div></div>
        <div className="analytics-donut" role="img" aria-label={`Donut chart: ${metrics.waiting} waiting, ${metrics.total - metrics.waiting - metrics.complete} in progress, ${metrics.complete} complete.`}>
          {metrics.total ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={metrics.status} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="88%" paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={motion} animationDuration={800}>{metrics.status.map((s, i) => <Cell key={s.name} fill={colours[i]} />)}</Pie><Tooltip {...tooltip} /></PieChart></ResponsiveContainer> : <div className="analytics-empty-ring" />}
          <div className="analytics-donut-total"><strong>{metrics.total}</strong><span>recorded items</span></div>
        </div><div className="analytics-status-legend">{metrics.status.map((s, i) => <div key={s.name}><span><i style={{ background: colours[i] }} />{s.name}</span><strong>{s.value}</strong></div>)}</div>
      </article>
      <article className="analytics-chart"><div className="analytics-chart-title"><div><h2>Queue volume</h2><p>Records by source, counted on the same scale</p></div></div>
        <div className="analytics-plot" role="img" aria-label={`Bar chart: ${metrics.queues.map(q => `${q.name} ${q.value}`).join(", ")}.`}><ResponsiveContainer width="100%" height="100%"><BarChart data={metrics.queues} margin={{ left: -20, right: 12, top: 15 }} accessibilityLayer><defs><linearGradient id="queue-depth" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#548b7a" /><stop offset="0.45" stopColor="#a9c598" /><stop offset="1" stopColor="#7ba889" /></linearGradient></defs><CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" /><XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} /><Bar dataKey="value" name="Records" fill="url(#queue-depth)" radius={[8, 8, 0, 0]} maxBarSize={65} isAnimationActive={motion} animationDuration={800} /></BarChart></ResponsiveContainer></div>
      </article>
      <article className="analytics-chart analytics-sources"><h2>Connected sources</h2><p>Only sources included in your permissions</p>{metrics.sources.map(source => <div key={source.name}><span>{source.name}</span><span className={source.available ? "source-connected" : "source-unavailable"}>{source.available ? "Available" : "Not connected"}</span></div>)}<small>Counts use current source snapshots: up to 250 workflows, 500 maintenance records, 1,500 cleans or 300 onboarding cases. Older records may be outside these limits. Clean counts use the scheduled date; other sources use their creation date. Linked work can appear in more than one queue.</small></article>
    </div>
    <details className="analytics-data"><summary>View chart data</summary><div className="analytics-table-wrap"><table><caption>Exact daily record counts</caption><thead><tr><th>Date</th>{metrics.sources.map(source => <th key={source.key} scope="col">{source.name}</th>)}</tr></thead><tbody>{metrics.trend.map(day => <tr key={day.key}><th scope="row">{day.date}</th>{metrics.sources.map(source => <td key={source.key}>{day[source.key] || 0}</td>)}</tr>)}</tbody></table></div></details>
    {metrics.total === 0 && <p className="analytics-source-note">{metrics.sources.length ? "No dated records in this period. Try a wider period or connect the missing sources." : "Analytics will appear when workspace tools are assigned to your account."}</p>}
  </section>;
}
