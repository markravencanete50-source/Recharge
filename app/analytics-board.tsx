"use client";


import { useMemo, useState, useSyncExternalStore } from "react";
import { Activity, CircleCheck, Clock3, Building2, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildWorkspaceAnalytics, type AnalyticsInput } from "@/lib/analytics";

const colours = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
function subscribeMotion(callback: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", callback);
  return () => preference.removeEventListener("change", callback);
}
export function AnalyticsBoard({ initialData, propertyCount, preview }: { initialData: AnalyticsInput; propertyCount: number; preview: boolean }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const motion = useSyncExternalStore(subscribeMotion, () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const metrics = useMemo(() => buildWorkspaceAnalytics(data, days), [data, days]);
  async function refresh() {
    setRefreshing(true); setError("");
    try {
      const results = await Promise.all([
        fetch("/api/workflows/tickets", { cache: "no-store" }),
        fetch("/api/maintenance", { cache: "no-store" }),
        fetch("/api/cleans", { cache: "no-store" }),
      ]);
      const next = { ...data };
      const keys = ["workflows", "maintenance", "cleans"] as const;
      let failures = 0;
      for (let i = 0; i < results.length; i++) {
        if (!results[i].ok) { failures++; continue; }
        const result = await results[i].json() as { data?: unknown };
        if (!result.data) { failures++; continue; }
        // All three endpoints return their complete source snapshot.
        Object.assign(next, { [keys[i]]: result.data });
      }
      setData(next); setUpdated(new Date());
      if (failures) setError("Some sources could not refresh. Their last available records are still shown.");
    } catch { setError("Could not refresh the board. Check your connection and try again."); }
    finally { setRefreshing(false); }
  }
  const tooltip = { contentStyle: { background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 12 }, labelStyle: { color: "var(--foreground)" } };
  return <section className="analytics-board">
    <p className="eyebrow">Workspace intelligence</p>
    <div className="analytics-heading">
      <div><h1>Analytics</h1><p>Every queue, one clear picture.</p></div>
      <div className="analytics-controls"><label className="sr-only" htmlFor="analytics-period">Analytics period</label>
        <select id="analytics-period" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
        <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh analytics"><RefreshCw size={17} className={refreshing ? "animate-spin" : ""} /></button>
      </div>
    </div>
    <div className="analytics-source-note">{preview ? "Sample records for design review." : "Current workspace records. Source limits apply."} Last updated {updated ? updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "on opening"}.</div>
    {error && <p role="alert" className="analytics-error">{error}</p>}
    <div className="analytics-metrics">
      {[{ name: "Recorded items", value: metrics.total, note: "Across the selected period", icon: Activity }, { name: "Completed", value: metrics.complete, note: "Current completion status", icon: CircleCheck }, { name: "Waiting", value: metrics.waiting, note: "New or awaiting action", icon: Clock3 }, { name: "Managed properties", value: propertyCount, note: "Current property snapshot", icon: Building2 }].map(({ name, value, note, icon: Icon }) => <article className="analytics-metric" key={name}><div><span>{name}</span><Icon size={20} /></div><strong>{value.toLocaleString("en-GB")}</strong><p>{note}</p></article>)}
    </div>
    <div className="analytics-chart-grid">
      <article className="analytics-chart analytics-trend"><div className="analytics-chart-title"><div><h2>Activity over time</h2><p>New workflow and maintenance records each day</p></div><span className="analytics-chart-tag">Daily</span></div>
        <div className="analytics-plot" role="img" aria-label="Line chart showing daily workflow and maintenance records. Exact values are available under View chart data."><ResponsiveContainer width="100%" height="100%"><LineChart data={metrics.trend} margin={{ left: -20, right: 15, top: 20, bottom: 0 }} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" /><XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} minTickGap={45} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip {...tooltip} /><Line type="monotone" dataKey="workflows" name="Workflows" stroke={colours[0]} strokeWidth={3} dot={false} activeDot={{ r: 5 }} isAnimationActive={motion} animationDuration={800} /><Line type="monotone" dataKey="repairs" name="Maintenance" stroke={colours[1]} strokeWidth={3} dot={false} isAnimationActive={motion} animationDuration={800} /></LineChart></ResponsiveContainer></div>
        <div className="analytics-legend"><span><i style={{ background: colours[0] }} />Workflows</span><span><i style={{ background: colours[1] }} />Maintenance</span></div>
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
      <article className="analytics-chart analytics-sources"><h2>Connected sources</h2><p>Availability of each workspace snapshot</p>{metrics.sources.map(source => <div key={source.name}><span>{source.name}</span><span className={source.available ? "source-connected" : "source-unavailable"}>{source.available ? "Available" : "Not connected"}</span></div>)}<small>Workflow snapshots contain up to 250 records. Linked work may appear in more than one queue. Clean counts use the scheduled clean date. Revenue and occupancy need booking and payment integrations.</small></article>
    </div>
    <details className="analytics-data"><summary>View chart data</summary><div className="analytics-table-wrap"><table><caption>Exact daily record counts</caption><thead><tr><th>Date</th><th>Workflows</th><th>Maintenance</th></tr></thead><tbody>{metrics.trend.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.workflows}</td><td>{day.repairs}</td></tr>)}</tbody></table></div></details>
    {metrics.total === 0 && <p className="analytics-source-note">No dated records in this period. Try a wider period or connect the missing sources.</p>}
  </section>;
}
