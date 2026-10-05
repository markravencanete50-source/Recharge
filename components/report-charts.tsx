"use client";
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Hourglass, Activity, MoreHorizontal } from 'lucide-react';
import type { ReportPresentation } from '@/lib/report-presentation';
import { graphGeometry, shortReportDate } from '@/lib/report-graphs';

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
const statusColor=(kind:string)=>kind==='complete'?'var(--rc-success)':kind==='waiting'?'var(--rc-waiting)':kind==='other'?'var(--rc-danger)':'var(--rc-primary)';
export function StatusBar({report}:{report:ReportPresentation}) {
  const {ref,width}=useWidth(),data=report.current;
  return <div ref={ref} className="report-status" role="img" aria-label={'Tasks by status. '+data.status.map(s=>s.name+' '+s.value).join(', ')+'. Total '+data.total+'.'}>
    <p className="status-total">{data.total} tasks</p><div className="status-stack" aria-hidden="true">{data.status.map(s=>s.value>0?<span key={s.name} style={{width:s.value/Math.max(1,data.total)*100+'%',background:statusColor(s.kind)}}/>:null)}</div>
    <svg width="100%" height={20} viewBox={`0 0 ${width} 20`} aria-hidden="true">{data.status.map((s,i)=>s.value>0?<line key={s.name} x1={(data.status.slice(0,i).reduce((n,s)=>n+s.value,0)+s.value/2)/Math.max(1,data.total)*width} y1={0} x2={(i+0.5)/data.status.length*width} y2={20} stroke={statusColor(s.kind)} strokeWidth={1.5} strokeDasharray={s.kind==='waiting'?'3 3':undefined}/>:null)}</svg>
    <div className="status-labels">{data.status.map(s=>{const Icon=s.kind==='complete'?CircleCheck:s.kind==='waiting'?Hourglass:s.kind==='other'?MoreHorizontal:Activity;return <div key={s.name}><Icon size={16} color={statusColor(s.kind)} aria-hidden="true"/><span>{s.name}</span><b>{s.value}</b></div>;})}</div>
  </div>;
}
export function SourceBars({report}:{report:ReportPresentation}) {
  const max=Math.max(1,...report.queues.map(q=>q.value));
  return <div className="direct-bars">{report.queues.map(q=><div className="direct-bar-row" key={q.name}><span>{q.name}</span><div className="direct-bar-track" aria-hidden="true"><i style={{width:(q.available?q.value/max*100:0)+'%',background:q.tone==='primary'?'var(--rc-primary)':`var(--rc-${q.tone}-ink)`}}/></div><strong>{q.available?q.value:'-'}</strong>{(!q.available||q.value===0)&&<small>{q.available?'None in this period':'Data unavailable'}</small>}</div>)}<p>{report.available?`${report.current.total} tasks in total`:'Task data unavailable'}</p></div>;
}
