"use client";


import { useEffect, useMemo, useState } from "react";
import { Activity, CircleCheck, Building2, RefreshCw, Download, Hourglass, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { periodLabel, presetPeriod, type AnalyticsSnapshot } from "@/lib/analytics";
import { reportPresentation } from "@/lib/report-presentation";
import { ActivityChart, StatusBar, SourceBars, MetricSparkline } from "@/components/report-charts";
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
        setData({ ...data, propertyCount: 0, propertyAvailable:false, sources: [] });
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
  return <section className="analytics-board phase-two-reports reports-revision" data-reduced-motion={reduced} data-reveal={reveal&&!reduced} aria-busy={refreshing}>
    <p className="eyebrow">Your workspace intelligence</p>
    <div className="analytics-heading"><div><h1>{data.title}</h1><p>{data.description}</p></div><div className="analytics-controls">
      <AnalyticsDateRange period={period} choice={choice} onChange={(next,nextChoice)=>{setPeriod(next);setChoice(nextChoice);}}/>
      <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh analytics"><RefreshCw size={17}/>{refreshing?'Refreshing...':'Refresh'}</button>
      {isWorkspaceAdmin(role)&&<button type="button" className="export-report" onClick={exportCsv} disabled={exporting} aria-busy={exporting}><Download size={17}/>{exporting?'Preparing report...':'Export CSV'}</button>}
    </div></div>
    <p className="analytics-period-summary" role="status">{periodLabel(period)}</p>
    <p className="analytics-source-note">Last updated {updated?updated.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'on opening'}.</p>
    {error&&<div role="alert" className="analytics-error"><p>{error}</p><button type="button" disabled={refreshing} onClick={refresh}>Retry refresh</button></div>}
    {exportNotice&&<p role="status" className="analytics-source-note">{exportNotice}</p>}
    <h2 className="report-headline">{report.headline}</h2>
    <p className="report-inclusive">Counts include the first and last day.</p>
    <div className="analytics-metrics">
      {[{name:'Tasks',value:report.available?metrics.total:null,metric:'total' as const,color:'var(--rc-primary)',icon:Activity},{name:'Completed',value:report.available?metrics.complete:null,metric:'complete' as const,color:'var(--rc-success)',icon:CircleCheck},{name:'Waiting',value:report.available?metrics.waiting:null,metric:'waiting' as const,color:'var(--rc-waiting)',icon:Hourglass},{name:'Properties',value:metrics.properties,metric:'property' as const,color:'var(--rc-primary)',icon:Building2}].map(({name,value,metric,color,icon:Icon})=><article className="analytics-metric" key={name}>
        <div className="report-metric-label"><span className="report-metric-icon"><Icon size={16} color={color}/></span><span>{name}</span></div>
        {refreshing?<div className="metric-skeleton" aria-label="Refreshing metric"/>:<strong><Count value={value} motionKey={role+':reports:'+name}/></strong>}
        {metric==='property'?<p>{report.propertyAvailable?'As of today':'Property data unavailable'}</p>:<><MetricSparkline report={report} metric={metric} color={color}/><p className="metric-comparison">{report.comparisons[metric].direction==='up'?<ArrowUp size={14}/>:report.comparisons[metric].direction==='down'?<ArrowDown size={14}/>:<Minus size={14}/>}<span>{report.deltas[metric]}</span></p></>}
      </article>)}
    </div>
    {report.partial&&<p className="analytics-source-note">Some task data is unavailable. Totals include available tasks.</p>}
    {display==='Chart'?<div className="analytics-chart-grid">
      <article className="analytics-chart report-status-card"><h2>Tasks by status</h2>{report.available?<StatusBar report={report}/>:<p>- Task data unavailable.</p>}</article>
      <article className="analytics-chart analytics-trend"><h2>Work per day</h2><p>Tasks recorded each day</p>{report.available?<ActivityChart report={report}/>:<p>- Task data unavailable.</p>}</article>
      <article className="analytics-chart"><h2>Work by type</h2><p>Number of tasks in each type</p><SourceBars report={report}/></article>
    </div>:<article className="analytics-data"><h2>Tasks in this period</h2><div className="analytics-table-wrap"><table><caption>Same numbers as the charts and CSV</caption><thead><tr><th scope="col">Date</th><th>Tasks</th><th>Completed</th><th>Waiting</th>{metrics.sources.map(source=><th key={source.key} scope="col">{source.name}</th>)}</tr></thead><tbody>{metrics.trend.map(day=><tr key={day.key}><th scope="row">{day.date}</th><td>{report.available?day.recorded:'-'}</td><td>{report.available?day.completed:'-'}</td><td>{report.available?day.waiting:'-'}</td>{metrics.sources.map(source=><td key={source.key}>{source.available?(day[source.key]||0):'-'}</td>)}</tr>)}</tbody></table></div><div className="report-table-totals"><p>Tasks: {report.available?metrics.total:'-'}.</p>{metrics.status.map(s=><p key={s.name}>{s.name}: {report.available?s.value:'-'}</p>)}{report.queues.map(q=><p key={q.name}>{q.name}: {q.available?q.value:'- (unavailable)'}</p>)}</div></article>}
    <p className="report-accessible-summary" role="status">{report.summary}</p>
    <button type="button" className="report-table-toggle" aria-pressed={display==='Table'} onClick={()=>setDisplay(value=>value==='Table'?'Chart':'Table')}>Show as table</button>
    <p className="analytics-source-note">{report.comparisonNote}</p>  </section>;
}
