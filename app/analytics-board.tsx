"use client";


import { useEffect, useMemo, useState } from "react";
import { Activity, CircleCheck, Clock3, Building2, RefreshCw, Download } from "lucide-react";
import { periodLabel, presetPeriod, type AnalyticsSnapshot } from "@/lib/analytics";
import { reportPresentation } from "@/lib/report-presentation";
import { ActivityChart, StatusDonut, SourceBars } from "@/components/report-charts";
import { Count, useWorkspaceMotion } from "@/components/workspace-motion";
import { AnalyticsDateRange } from "@/app/analytics-date-range";
import { isWorkspaceAdmin, type WorkspaceRole } from "@/lib/modules";
import { analyticsCsv, analyticsFilename } from "@/lib/analytics-export";
import { downloadReport } from "@/lib/download-report";

const revealedReports=new Set<string>();
export function AnalyticsBoard({ initialData, preview, role }: { initialData: AnalyticsSnapshot; preview: boolean; role: WorkspaceRole }) {
  const [period, setPeriod] = useState(() => presetPeriod(30));
  const [choice, setChoice] = useState("30");
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const reduced = useWorkspaceMotion();
  const [display,setDisplay]=useState("Chart");
  const [reveal,setReveal]=useState(()=>!revealedReports.has(role));
  useEffect(()=>{revealedReports.add(role);const timer=setTimeout(()=>setReveal(false),650);return()=>clearTimeout(timer);},[role]);
  const [exportNotice,setExportNotice]=useState("");
  const report=useMemo(()=>reportPresentation(data,period),[data,period]);
  const metrics=report.current;
  async function exportCsv() {
    if (!isWorkspaceAdmin(role) || exporting) return;
    setExporting(true); setError(""); setExportNotice("");
    try {
      if (preview) downloadReport(analyticsCsv(data, period, true), analyticsFilename(period));
      else {
        const response = await fetch(`/api/analytics/export?${new URLSearchParams(period)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Active admin access is required to export reports." : "Could not export the report. Try again.");
        downloadReport(await response.text(), analyticsFilename(period));
      }
      setExportNotice(preview?"Sample report download started.":"Report download started.");
    } catch (error) { setError(error instanceof Error ? error.message : "Report export unavailable."); }
    finally { setExporting(false); }
  }
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
  return <section className="analytics-board phase-two-reports" data-reduced-motion={reduced} data-reveal={reveal&&!reduced} aria-busy={refreshing}>
    <p className="eyebrow">Your workspace intelligence</p>
    <div className="analytics-heading"><div><h1>{data.title}</h1><p>{data.description}</p></div><div className="analytics-controls">
      <AnalyticsDateRange period={period} choice={choice} onChange={(next,nextChoice)=>{setPeriod(next);setChoice(nextChoice);}}/>
      <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh analytics"><RefreshCw size={17}/>{refreshing?'Refreshing...':'Refresh'}</button>
      {isWorkspaceAdmin(role)&&<button type="button" className="export-report" onClick={exportCsv} disabled={exporting} aria-busy={exporting}><Download size={17}/>{exporting?'Preparing report...':'Export CSV'}</button>}
    </div></div>
    <p className="analytics-period-summary" role="status">{periodLabel(period)}<span>UK dates, both dates included</span></p>
    <p className="analytics-source-note">{preview?'Sample records for design review.':'Records permitted by your current access. Source limits apply.'} Last updated {updated?updated.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'on opening'}.</p>
    {error&&<div role="alert" className="analytics-error"><p>{error}</p><button type="button" disabled={refreshing} onClick={refresh}>Retry refresh</button></div>}
    {exportNotice&&<p role="status" className="analytics-source-note">{exportNotice}</p>}
    <h2 className="report-headline">{report.headline}</h2>
    <div className="analytics-metrics">
      {[{name:'Recorded items',value:report.available?metrics.total:null,note:report.deltas.total,icon:Activity},{name:'Completed',value:report.available?metrics.complete:null,note:report.deltas.complete,icon:CircleCheck},{name:'Waiting',value:report.available?metrics.waiting:null,note:report.deltas.waiting,icon:Clock3},{name:data.propertyLabel,value:data.propertyCount,note:'Current property snapshot',icon:Building2}].map(({name,value,note,icon:Icon})=><article className="analytics-metric" key={name}><div><span>{name}</span><Icon size={20}/></div>{refreshing?<div className="metric-skeleton" aria-label="Refreshing metric"/>:<strong><Count value={value} motionKey={role+':reports:'+name}/></strong>}<p>{note}</p></article>)}
    </div><p className="analytics-source-note">{report.comparisonNote}</p>
    {report.partial&&<p className="analytics-error">Some permitted sources are not connected. Their values are shown as a dash and excluded from totals.</p>}
    <div className="report-view-switch" role="group" aria-label="Report presentation">{['Chart','Table'].map(value=><button type="button" key={value} aria-pressed={display===value} onClick={()=>setDisplay(value)}>{value}</button>)}</div>
    {display==='Chart'?<div className="analytics-chart-grid">
      <article className="analytics-chart analytics-trend"><h2>Activity over time</h2><p>Daily recorded items, with first, peak and latest points labelled</p>{report.available?<ActivityChart report={report}/>:<p>No connected source for this chart.</p>}</article>
      <article className="analytics-chart"><h2>Work status</h2><p>Current status in the selected period</p>{report.available?<StatusDonut report={report}/>:<p>No connected source for this chart.</p>}</article>
      <article className="analytics-chart"><h2>Queue volume</h2><p>Highest volume first, on the same scale</p><SourceBars report={report}/></article>
      <article className="analytics-chart analytics-sources"><h2>Source coverage</h2><p>Only sources included in your permissions</p>{metrics.sources.map(source=><div key={source.name}><span>{source.name}</span><span className={source.available?'source-connected':'source-unavailable'}>{source.available?'Available':'Not connected'}</span></div>)}<small>Counts use current source snapshots: up to 250 workflows, 500 maintenance records, 1,500 cleans or 300 onboarding cases. Older records may be outside these limits. Clean counts use the scheduled date; other sources use their creation date. Linked work can appear in more than one queue.</small></article>
    </div>:<article className="analytics-data"><h2>Exact report data</h2><div className="analytics-table-wrap"><table><caption>Same dates and records as your CSV export</caption><thead><tr><th scope="col">Date</th>{metrics.sources.map(source=><th key={source.key} scope="col">{source.name}</th>)}</tr></thead><tbody>{metrics.trend.map(day=><tr key={day.key}><th scope="row">{day.date}</th>{metrics.sources.map(source=><td key={source.key}>{source.available?(day[source.key]||0):'-'}</td>)}</tr>)}</tbody></table></div><div className="report-table-totals"><h3>Status totals</h3>{metrics.status.map(s=><p key={s.name}>{s.name}: {report.available?s.value:'-'}</p>)}<h3>Queue totals</h3>{report.queues.map(q=><p key={q.name}>{q.name}: {q.available?q.value:'-'}{!q.available?' (not connected)':''}</p>)}</div></article>}
    {metrics.total===0&&<p className="analytics-source-note">{metrics.sources.length?'No dated records in this period. Try a wider period or connect the missing sources.':'Analytics will appear when workspace tools are assigned to your account.'}</p>}
  </section>;
}
