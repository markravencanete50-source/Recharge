"use client";
import type { reportPresentation } from '@/lib/report-presentation';
type Report=ReturnType<typeof reportPresentation>;
const short=(date:string)=>date.split(' ').slice(0,2).join(' ');
export function ActivityChart({report}:{report:Report}) {
  const {days,labels}=report,max=Math.max(1,...days.map(d=>d.value)),x=(i:number)=>32+i/Math.max(1,days.length-1)*336,y=(v:number)=>202-v/max*112;
  const points=days.map((d,i)=>x(i)+','+y(d.value)).join(' ');
  return <svg className="direct-chart" viewBox="0 0 400 250" role="img" aria-label={'Daily recorded items. '+labels.map(d=>d.kind+' '+d.date+': '+d.value).join('. ')}>
    {[0,1,2].map(i=><line key={i} x1={32} x2={368} y1={90+i*56} y2={90+i*56} stroke="var(--rc-border)" strokeDasharray="3 5"/>)}
    <path d={'M32 202 L'+points.split(' ').join(' L')+' L'+x(days.length-1)+' 202Z'} fill="var(--rc-wash)"/>
    <polyline points={points} stroke="var(--rc-bright)" strokeWidth={3} fill="none" strokeLinejoin="round"/>
    {labels.map((d,i)=>{const tx=labels.length===1?200:48+i/(labels.length-1)*304;return <g key={d.index}><line x1={tx} y1={54} x2={x(d.index)} y2={y(d.value)-8} stroke="var(--rc-muted)" strokeDasharray={i===1?'3 3':undefined}/><circle cx={x(d.index)} cy={y(d.value)} r={5} fill="var(--rc-primary)" stroke="var(--rc-surface)" strokeWidth={2}/><text x={tx} y={22} textAnchor="middle" fill="var(--rc-text)" fontSize={14} fontWeight={600}>{d.kind+' '+d.value}</text><text x={tx} y={42} textAnchor="middle" fill="var(--rc-muted)" fontSize={13}>{short(d.date)}</text></g>})}
    <text x={32} y={234} fill="var(--rc-muted)" fontSize={13}>{short(days[0]?.date||'')}</text><text x={368} y={234} textAnchor="end" fill="var(--rc-muted)" fontSize={13}>{short(days.at(-1)?.date||'')}</text>
  </svg>;
}
export function StatusDonut({report}:{report:Report}) {
  const data=report.current,colors=['var(--rc-bright)','var(--rc-stays-ink)','var(--rc-cleans-ink)'],circumference=2*Math.PI*62;
  const labelRows=data.status.map((status,index)=>{const previous=data.status.slice(0,index).reduce((sum,s)=>sum+s.value,0);const angle=data.total?(previous+status.value/2)/data.total*Math.PI*2-Math.PI/2:-Math.PI/2+index*Math.PI*2/3;return {index,y:Math.sin(angle)};}).sort((a,b)=>a.y-b.y);
  return <svg className="direct-chart" viewBox="0 0 352 256" role="img" aria-label={'Work status. '+data.status.map(s=>s.name+' '+s.value).join(', ')}>
    <circle cx={92} cy={124} r={62} stroke="var(--rc-elevated)" strokeWidth={18} fill="none"/>
    {data.status.map((s,i)=>{const previous=data.status.slice(0,i).reduce((n,s)=>n+s.value,0),length=data.total?s.value/data.total*circumference:0,angle=data.total?(previous+s.value/2)/data.total*Math.PI*2-Math.PI/2:-Math.PI/2+i*Math.PI*2/3,startX=92+Math.cos(angle)*72,startY=124+Math.sin(angle)*72,labelY=46+labelRows.findIndex(row=>row.index===i)*77;return <g key={s.name}>
      {s.value>0&&<circle cx={92} cy={124} r={62} stroke={colors[i]} strokeWidth={18} fill="none" strokeDasharray={Math.max(0,length-4)+' '+circumference} strokeDashoffset={data.total?-previous/data.total*circumference:0} transform="rotate(-90 92 124)"/>}
      <polyline points={startX+','+startY+(startX<92?' '+startX+','+(startY<124?12:244)+' 184,'+(startY<124?12:244):'')+' 184,'+labelY+' 198,'+labelY} stroke="var(--rc-muted)" strokeWidth={1} fill="none" strokeDasharray={i===1?'3 3':undefined}/><text x={208} y={labelY-3} fontSize={14} fill="var(--rc-text)">{s.name}</text><text x={208} y={labelY+21} fontSize={20} fontWeight={600} fill="var(--rc-text)">{s.value}</text>
    </g>})}
    <text x={92} y={126} textAnchor="middle" fontSize={28} fontWeight={700} fill="var(--rc-text)">{data.total}</text><text x={92} y={146} textAnchor="middle" fontSize={13} fill="var(--rc-muted)">items</text>
  </svg>;
}
export function SourceBars({report}:{report:Report}) {
  const colors=['var(--rc-bright)','var(--rc-stays-ink)','var(--rc-cleans-ink)','var(--rc-clients-ink)','var(--rc-accounts-ink)'],max=Math.max(1,...report.queues.map(q=>q.value));
  return <div className="direct-bars">{report.queues.map(q=><div className="direct-bar-row" key={q.name}><span>{q.name}</span><div className="direct-bar-track" aria-hidden="true"><i style={{width:(q.available?q.value/max*100:0)+'%',background:colors[q.index%colors.length]}}/></div><strong>{q.available?q.value:'-'}</strong>{!q.available&&<small>Source not connected</small>}</div>)}</div>;
}
