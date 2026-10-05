"use client";
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Hourglass, Activity, MoreHorizontal } from 'lucide-react';
import type { ReportPresentation } from '@/lib/report-presentation';
import { graphGeometry, shortReportDate, statusBreakdown } from '@/lib/report-graphs';

function useWidth() {
  const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(280);
  useEffect(()=>{const node=ref.current;if(!node)return;const observer=new ResizeObserver(()=>setWidth(Math.max(80,node.clientWidth)));observer.observe(node);return()=>observer.disconnect();},[]);
  return {ref,width};
}
export function MetricSparkline({report,metric,color}:{report:ReportPresentation;metric:'total'|'complete'|'waiting';color:string}) {
  const {ref,width}=useWidth(),field=metric==='total'?'value':metric==='complete'?'completed':'waiting';
  const values=report.chartDays.map(day=>day[field]),g=graphGeometry(values,width,4,23);
  if(!report.available)return <p>Data unavailable</p>;
  if(!report.sparkReady[metric])return <p className="spark-empty">Not enough days to chart</p>;
  return <div ref={ref} className="metric-spark"><svg width="100%" height={36} viewBox={`0 0 ${width} 36`} role="img" aria-label={`${report.duration>31?'Weekly':'Daily'} ${metric==='total'?'tasks':metric==='complete'?'completed tasks':'waiting tasks'}. Start ${values[0]}, end ${values.at(-1)}.`}><path d={g.area} fill={color} fillOpacity={0.12}/><polyline points={g.points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/><circle cx={g.x(values.length-1)} cy={g.y(values.at(-1)||0)} r={2.5} fill={color}/><text x={0} y={35} fill="var(--rc-muted)" fontSize={12}>{values[0]}</text><text x={width} y={35} textAnchor="end" fill="var(--rc-muted)" fontSize={12}>{values.at(-1)}</text></svg></div>;
}
export function ActivityChart({report}:{report:ReportPresentation}) {
  const {ref,width}=useWidth(),days=report.chartDays,max=Math.max(1,...days.map(day=>day.value));
  const all=graphGeometry(days.map(day=>day.value),width,82,182,max),done=graphGeometry(days.map(day=>day.completed),width,82,182,max),peak=days[report.peak];
  return <div ref={ref}>{report.duration>31&&<p>Weekly totals for longer periods</p>}<svg className="direct-chart report-line" viewBox={`0 0 ${width} 218`} role="img" aria-label={`Work per ${report.duration>31?'week':'day'}. Recorded ${report.current.total}. Completed ${report.current.complete}. Peak ${peak.value} on ${peak.date}.`}>
    {[0,1,2].map(i=><line key={i} x1={8} x2={width-8} y1={82+i*50} y2={82+i*50} stroke="var(--rc-border)" strokeDasharray="3 5"/>)}
    <path d={all.area} fill="var(--rc-primary)" fillOpacity={0.12}/><polyline points={all.points} stroke="var(--rc-primary)" strokeWidth={3} fill="none" strokeLinejoin="round"/><polyline points={done.points} stroke="var(--rc-success)" strokeWidth={2} strokeDasharray="5 4" fill="none" strokeLinejoin="round"/>
    <circle cx={all.x(report.peak)} cy={all.y(peak.value)} r={4} fill="var(--rc-primary)"/><line x1={all.x(report.peak)} y1={all.y(peak.value)-5} x2={8} y2={53} stroke="var(--rc-muted)" strokeDasharray="3 3"/>
    <text x={8} y={19} fontSize={13} fontWeight={600} fill="var(--rc-text)">{'Peak '+peak.value}</text><text x={8} y={39} fontSize={12} fill="var(--rc-muted)">{shortReportDate(peak.date)}</text>
    <line x1={width-8} x2={width-8} y1={all.y(days.at(-1)!.value)} y2={29} stroke="var(--rc-primary)"/><line x1={width-13} x2={width-13} y1={done.y(days.at(-1)!.completed)} y2={52} stroke="var(--rc-success)" strokeDasharray="5 4"/>
    <text x={width-18} y={19} textAnchor="end" fontSize={13} fontWeight={600} fill="var(--rc-primary)">{'Recorded '+report.current.total}</text><text x={width-18} y={43} textAnchor="end" fontSize={13} fontWeight={600} fill="var(--rc-success)">{'Completed '+report.current.complete}</text>
    {[0,Math.floor((days.length-1)/2),days.length-1].filter((i,n,list)=>list.indexOf(i)===n).map(i=><text key={i} x={all.x(i)} y={209} textAnchor={i===0?'start':i===days.length-1?'end':'middle'} fontSize={12} fill="var(--rc-muted)">{shortReportDate(days[i].date)}</text>)}
  </svg></div>;
}
const statusColor=(kind:string)=>kind==='complete'?'var(--rc-success)':kind==='waiting'?'var(--rc-waiting)':kind==='other'?'var(--rc-danger)':'var(--rc-chart)';
export function StatusBar({report}:{report:ReportPresentation}) {
  const [selected,setSelected]=useState<string|null>(null),data=report.current;
  const segments=statusBreakdown(data.status,data.total),focused=segments.find(s=>s.name===selected);
  return <div className="report-status">
    <p>Current status of tasks recorded in the selected period.</p>
    <div className="status-breakdown">
      <div className="status-donut" role="img" aria-label={'Tasks by status. '+data.status.map(s=>s.name+' '+s.value).join(', ')+'. Total '+data.total+'.'}>
        <svg viewBox="0 0 220 220" aria-hidden="true"><circle cx={110} cy={110} r={76} fill="none" stroke="var(--rc-elevated)" strokeWidth={20}/>{segments.filter(s=>s.value>0).map(s=><circle key={s.name} cx={110} cy={110} r={76} fill="none" stroke={statusColor(s.kind)} strokeWidth={20} strokeDasharray={`${Math.max(0,s.length-(s.share===1?0:3))} ${s.circumference}`} strokeDashoffset={-s.offset} transform="rotate(-90 110 110)" opacity={!focused||focused.name===s.name?1:0.22}/>)}</svg>
        <div className="status-donut-value"><span>{focused?.name||'Total tasks'}</span><strong aria-live="polite">{focused?.value??data.total}</strong><span>{focused?`${focused.percentage}% of ${data.total}`:'In this period'}</span></div>
      </div>
      <div className="status-breakdown-rows">{segments.map(s=>{const Icon=s.kind==='complete'?CircleCheck:s.kind==='waiting'?Hourglass:s.kind==='other'?MoreHorizontal:Activity;return <button key={s.name} type="button" className="status-breakdown-row" aria-label={`Highlight ${s.name}: ${s.value} tasks, ${s.percentage} percent`} aria-pressed={focused?.name===s.name} onClick={()=>setSelected(selected===s.name?null:s.name)} style={{borderColor:focused?.name===s.name?statusColor(s.kind):undefined}}>
        <span className="status-breakdown-label"><Icon size={18} color={statusColor(s.kind)} aria-hidden="true"/><span>{s.name}</span><b>{s.value}</b><small>{s.percentage}%</small></span><span className="status-breakdown-track" aria-hidden="true"><i style={{width:s.share*100+'%',background:statusColor(s.kind)}}/></span>
      </button>;})}</div>
    </div>
    <div className="status-breakdown-hint"><p>{data.total===0?'No tasks recorded in this period.':'Choose a status to highlight its share.'}</p>{focused&&<button type="button" onClick={()=>setSelected(null)}>Show all statuses</button>}</div>
  </div>;
}
export function SourceBars({report}:{report:ReportPresentation}) {
  const max=Math.max(1,...report.queues.map(q=>q.value));
  return <div className="direct-bars">{report.queues.map(q=><div className="direct-bar-row" key={q.name}><span>{q.name}</span><div className="direct-bar-track" aria-hidden="true"><i style={{width:(q.available?q.value/max*100:0)+'%',background:q.tone==='primary'?'var(--rc-primary)':`var(--rc-${q.tone}-ink)`}}/></div><strong>{q.available?q.value:'-'}</strong>{(!q.available||q.value===0)&&<small>{q.available?'None in this period':'Data unavailable'}</small>}</div>)}<p>{report.available?`${report.current.total} tasks in total`:'Task data unavailable'}</p></div>;
}
