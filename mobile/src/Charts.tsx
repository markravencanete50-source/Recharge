import { useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Path, Text as SvgText } from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { Text } from './Typography';
import { ui, departmentColor, type Palette } from './theme';
import { MotionPress, useReveal } from './motion';
import type { ReportPresentation } from '../../lib/report-presentation';
import { graphGeometry, shortReportDate, statusBreakdown } from '../../lib/report-graphs';

export function ChartReveal({children,motionKey}:{children:React.ReactNode;motionKey:string}) {
  const progress=useReveal(motionKey,0,550);
  return <Animated.View style={{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[8,0]})}]}}>{children}</Animated.View>;
}
export function ReportSymbol({kind,color,size=16}:{kind:string;color:string;size?:number}) {
  return kind==='waiting'?<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4"/></Svg>:<Feather name={kind==='complete'?'check-circle':kind==='property'?'home':kind==='other'?'more-horizontal':'activity'} size={size} color={color}/>;
}
export function MetricSparkline({report,metric,color,palette:p,motionKey}:{report:ReportPresentation;metric:'total'|'complete'|'waiting';color:string;palette:Palette;motionKey:string}) {
  const [width,setWidth]=useState(120),field=metric==='total'?'value':metric==='complete'?'completed':'waiting';
  const values=report.chartDays.map(day=>day[field]),g=graphGeometry(values,width,4,23);
  if(!report.available)return <Text style={[ui.small,{color:p.muted}]}>Data unavailable</Text>;
  if(!report.sparkReady[metric])return <Text style={[ui.small,{color:p.muted,minHeight:36}]}>Not enough days to chart</Text>;
  return <ChartReveal motionKey={motionKey}><View onLayout={event=>setWidth(event.nativeEvent.layout.width)} accessible accessibilityLabel={`${report.duration>31?'Weekly':'Daily'} ${metric==='total'?'tasks':metric==='complete'?'completed tasks':'waiting tasks'}. Start ${values[0]}, end ${values.at(-1)}.`}>
    <Svg width="100%" height={36} viewBox={`0 0 ${width} 36`}><Path d={g.area} fill={color} fillOpacity={0.12}/><Polyline points={g.points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/><Circle cx={g.x(values.length-1)} cy={g.y(values.at(-1)||0)} r={2.5} fill={color}/><SvgText x={0} y={35} fill={p.muted} fontFamily="Montserrat_400Regular" fontSize={12}>{values[0]}</SvgText><SvgText x={width} y={35} textAnchor="end" fill={p.muted} fontFamily="Montserrat_400Regular" fontSize={12}>{values.at(-1)}</SvgText></Svg>
  </View></ChartReveal>;
}
export function LineChart({report,palette:p,motionKey='report:line'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const [width,setWidth]=useState(280),days=report.chartDays,max=Math.max(1,...days.map(day=>day.value));
  const all=graphGeometry(days.map(day=>day.value),width,82,182,max),done=graphGeometry(days.map(day=>day.completed),width,82,182,max),peak=days[report.peak];
  return <ChartReveal motionKey={motionKey}><View onLayout={event=>setWidth(event.nativeEvent.layout.width)} accessible accessibilityLabel={`Work per ${report.duration>31?'week':'day'}. Recorded ${report.current.total}. Completed ${report.current.complete}. Peak ${peak.value} on ${peak.date}.`}>
    {report.duration>31&&<Text style={[ui.small,{color:p.muted}]}>Weekly totals for longer periods</Text>}
    <Svg width="100%" height={218} viewBox={`0 0 ${width} 218`}>
      {[0,1,2].map(i=><Line key={i} x1={8} x2={width-8} y1={82+i*50} y2={82+i*50} stroke={p.border} strokeDasharray="3 5"/>)}
      <Path d={all.area} fill={p.primary} fillOpacity={0.12}/><Polyline points={all.points} stroke={p.primary} strokeWidth={3} fill="none" strokeLinejoin="round"/><Polyline points={done.points} stroke={p.success} strokeWidth={2} strokeDasharray="5 4" fill="none" strokeLinejoin="round"/>
      <Circle cx={all.x(report.peak)} cy={all.y(peak.value)} r={4} fill={p.primary}/><Line x1={all.x(report.peak)} y1={all.y(peak.value)-5} x2={8} y2={53} stroke={p.muted} strokeDasharray="3 3"/>
      <SvgText x={8} y={19} fontFamily="Montserrat_600SemiBold" fontSize={13} fill={p.text}>{'Peak '+peak.value}</SvgText><SvgText x={8} y={39} fontFamily="Montserrat_400Regular" fontSize={12} fill={p.muted}>{shortReportDate(peak.date)}</SvgText>
      <Line x1={width-8} x2={width-8} y1={all.y(days.at(-1)!.value)} y2={29} stroke={p.primary}/><Line x1={width-13} x2={width-13} y1={done.y(days.at(-1)!.completed)} y2={52} stroke={p.success} strokeDasharray="5 4"/>
      <SvgText x={width-18} y={19} textAnchor="end" fontFamily="Montserrat_600SemiBold" fontSize={13} fill={p.primary}>{'Recorded '+report.current.total}</SvgText><SvgText x={width-18} y={43} textAnchor="end" fontFamily="Montserrat_600SemiBold" fontSize={13} fill={p.success}>{'Completed '+report.current.complete}</SvgText>
      {[0,Math.floor((days.length-1)/2),days.length-1].filter((i,n,list)=>list.indexOf(i)===n).map(i=><SvgText key={i} x={all.x(i)} y={209} textAnchor={i===0?'start':i===days.length-1?'end':'middle'} fontFamily="Montserrat_400Regular" fontSize={12} fill={p.muted}>{shortReportDate(days[i].date)}</SvgText>)}
    </Svg>
  </View></ChartReveal>;
}
export function StatusChart({report,palette:p,motionKey='report:status'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const [width,setWidth]=useState(280),[selected,setSelected]=useState<string|null>(null);
  const data=report.current,segments=statusBreakdown(data.status,data.total);
  const focused=segments.find(item=>item.name===selected);
  const color=(kind:string)=>kind==='complete'?p.success:kind==='waiting'?p.waiting:kind==='other'?p.danger:p.chart;
  const label=focused?.name||'Total tasks',value=focused?.value??data.total;
  return <ChartReveal motionKey={motionKey}><View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{gap:18}}>
    <Text style={[ui.small,{color:p.muted}]}>Current status of tasks recorded in the selected period.</Text>
    <View style={{flexDirection:width>=520?'row':'column',alignItems:'center',gap:24}}>
      <View accessible accessibilityRole="image" accessibilityLabel={'Tasks by status. '+data.status.map(s=>s.name+' '+s.value).join(', ')+'. Total '+data.total+'.'} style={{width:220,height:220,flexShrink:0,alignItems:'center',justifyContent:'center'}}>
        <Svg width={220} height={220} viewBox="0 0 220 220" style={{position:'absolute'}}>
          <Circle cx={110} cy={110} r={76} stroke={p.elevated} strokeWidth={20} fill="none"/>
          {segments.filter(s=>s.value>0).map(s=><Circle key={s.name} cx={110} cy={110} r={76} stroke={color(s.kind)} strokeWidth={20} fill="none" strokeDasharray={`${Math.max(0,s.length-(s.share===1?0:3))} ${s.circumference}`} strokeDashoffset={-s.offset} rotation={-90} origin="110,110" opacity={!focused||focused.name===s.name?1:0.22}/>)}
        </Svg>
        <Text style={{color:p.muted,fontSize:12,lineHeight:18,fontWeight:'500'}}>{label}</Text>
        <Text accessibilityLiveRegion="polite" style={{color:p.text,fontSize:38,lineHeight:48,fontWeight:'700',fontVariant:['tabular-nums']}}>{value}</Text>
        <Text style={{color:p.muted,fontSize:12,lineHeight:18}}>{focused?`${focused.percentage}% of ${data.total}`:'In this period'}</Text>
      </View>
      <View style={{gap:10,flex:width>=520?1:undefined,width:width>=520?undefined:'100%',minWidth:0}}>
        {segments.map(s=><MotionPress key={s.name} accessibilityRole="button" accessibilityLabel={`Highlight ${s.name}: ${s.value} tasks, ${s.percentage} percent`} accessibilityState={{selected:focused?.name===s.name}} onPress={()=>setSelected(selected===s.name?null:s.name)} style={{gap:9,padding:12,borderWidth:1,borderColor:focused?.name===s.name?color(s.kind):p.border,borderRadius:14,backgroundColor:focused?.name===s.name?p.wash:p.surface}}>
          <View style={[ui.row,{gap:10}]}><ReportSymbol kind={s.kind} color={color(s.kind)} size={18}/><Text style={{flex:1,color:p.text,fontSize:14,lineHeight:20,fontWeight:'600'}}>{s.name}</Text><Text style={{color:p.text,fontSize:20,fontWeight:'600',fontVariant:['tabular-nums']}}>{s.value}</Text><Text style={{minWidth:38,textAlign:'right',color:p.muted,fontSize:12,fontVariant:['tabular-nums']}}>{s.percentage}%</Text></View>
          <View accessible={false} style={{height:5,borderRadius:3,backgroundColor:p.elevated,overflow:'hidden'}}><View style={{height:5,width:`${s.share*100}%`,borderRadius:3,backgroundColor:color(s.kind)}}/></View>
        </MotionPress>)}
      </View>
    </View>
    <View style={[ui.between,{gap:12,flexWrap:'wrap'}]}><Text style={[ui.small,{color:p.muted,flexShrink:1}]}>{data.total===0?'No tasks recorded in this period.':'Choose a status to highlight its share.'}</Text>{focused&&<MotionPress accessibilityRole="button" accessibilityLabel="Show all task statuses" onPress={()=>setSelected(null)} style={{minHeight:44,justifyContent:'center'}}><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>Show all statuses</Text></MotionPress>}</View>
  </View></ChartReveal>;
}
export function QueueChart({report,palette:p,motionKey='report:queues'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const max=Math.max(1,...report.queues.map(q=>q.value));
  return <ChartReveal motionKey={motionKey}><View style={{gap:18}}>{report.queues.map(q=><View key={q.name} style={{gap:8}}><Text style={[ui.small,{color:p.text,fontWeight:'600'}]}>{q.name}</Text><View style={[ui.row,{gap:12}]}><View style={{flex:1,height:14,borderRadius:7,backgroundColor:p.elevated,overflow:'hidden'}}><View style={{height:14,width:`${q.available?q.value/max*100:0}%`,borderRadius:7,backgroundColor:q.tone==='primary'?p.primary:departmentColor(q.tone,p).ink}}/></View><Text style={{minWidth:30,color:p.text,fontSize:14,fontWeight:'600',textAlign:'right',fontVariant:['tabular-nums']}}>{q.available?q.value:'-'}</Text></View>{(!q.available||q.value===0)&&<Text style={[ui.small,{color:p.muted}]}>{q.available?'None in this period':'Data unavailable'}</Text>}</View>)}<Text style={[ui.small,{color:p.muted}]}>{report.available?`${report.current.total} tasks in total`:'Task data unavailable'}</Text></View></ChartReveal>;
}
