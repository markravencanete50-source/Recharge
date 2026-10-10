import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { Text } from './Typography';
import { ui, departmentColor, depth, type Palette } from './theme';
import { GrowBar, MotionPress, TweenNumber, useMotionPreference, useReveal } from './motion';
import type { ReportPresentation } from '../../lib/report-presentation';
import { graphGeometry, pathLength, shortReportDate, smoothArea, smoothPath, statusBreakdown } from '../../lib/report-graphs';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ChartReveal({children,motionKey}:{children:React.ReactNode;motionKey:string}) {
  const progress=useReveal(motionKey,0,550);
  return <Animated.View style={{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[10,0]})}]}}>{children}</Animated.View>;
}
// Draws a chart in once per motion key: 0 → 1 over `duration`, or straight to 1 when motion is reduced.
function useDraw(motionKey: string, duration = 1100, delay = 120) {
  const {reduced,ready,seen}=useMotionPreference();
  const [draw]=useState(()=>new Animated.Value(1));
  useEffect(()=>{
    if(!ready)return;
    if(reduced||seen.has('draw:'+motionKey)){draw.setValue(1);return;}
    seen.add('draw:'+motionKey);draw.setValue(0);
    const animation=Animated.timing(draw,{toValue:1,duration,delay,easing:Easing.bezier(0.22,1,0.36,1),useNativeDriver:false});
    animation.start();return()=>{animation.stop();draw.setValue(1);};
  },[draw,motionKey,ready,reduced,seen,duration,delay]);
  return draw;
}
export function ReportSymbol({kind,color,size=16}:{kind:string;color:string;size?:number}) {
  return kind==='waiting'?<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4"/></Svg>:<Feather name={kind==='complete'?'check-circle':kind==='property'?'home':kind==='other'?'more-horizontal':'activity'} size={size} color={color}/>;
}
const pointsOf=(values:number[],g:ReturnType<typeof graphGeometry>)=>values.map((value,i)=>({x:g.x(i),y:g.y(value)}));

// A small trend under a headline figure: a smooth line that draws itself in over a soft fill,
// ending in a dot with a halo.
export function MetricSparkline({report,metric,color,palette:p,motionKey}:{report:ReportPresentation;metric:'total'|'complete'|'waiting';color:string;palette:Palette;motionKey:string}) {
  const [width,setWidth]=useState(120),field=metric==='total'?'value':metric==='complete'?'completed':'waiting';
  const values=report.chartDays.map(day=>day[field]),g=graphGeometry(values,width,6,26);
  const pts=pointsOf(values,g),length=pathLength(pts)||1,draw=useDraw(motionKey,900);
  const id='spark-'+motionKey.replace(/[^a-z0-9]/gi,'');
  if(!report.available)return <Text style={[ui.small,{color:p.muted}]}>Data unavailable</Text>;
  if(!report.sparkReady[metric])return <Text style={[ui.small,{color:p.muted,minHeight:36}]}>Not enough days to chart</Text>;
  return <View onLayout={event=>setWidth(event.nativeEvent.layout.width)} accessible accessibilityLabel={`${report.duration>31?'Weekly':'Daily'} ${metric==='total'?'tasks':metric==='complete'?'completed tasks':'waiting tasks'}. Start ${values[0]}, end ${values.at(-1)}.`}>
    <Svg width="100%" height={40} viewBox={`0 0 ${width} 40`}>
      <Defs><LinearGradient id={id} x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity={0.24}/><Stop offset="1" stopColor={color} stopOpacity={0}/></LinearGradient></Defs>
      <AnimatedPath d={smoothArea(pts,30)} fill={`url(#${id})`} opacity={draw}/>
      <AnimatedPath d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeDasharray={length} strokeDashoffset={draw.interpolate({inputRange:[0,1],outputRange:[length,0]})}/>
      <AnimatedCircle cx={pts.at(-1)!.x} cy={pts.at(-1)!.y} r={6} fill={color} opacity={draw.interpolate({inputRange:[0,0.85,1],outputRange:[0,0,0.18]})}/>
      <AnimatedCircle cx={pts.at(-1)!.x} cy={pts.at(-1)!.y} r={2.8} fill={color} opacity={draw.interpolate({inputRange:[0,0.85,1],outputRange:[0,0,1]})}/>
      <SvgText x={0} y={39} fill={p.muted} fontFamily="Montserrat_500Medium" fontSize={11}>{values[0]}</SvgText><SvgText x={width} y={39} textAnchor="end" fill={p.muted} fontFamily="Montserrat_500Medium" fontSize={11}>{values.at(-1)}</SvgText>
    </Svg>
  </View>;
}

// Work per day: recorded (solid, with a soft fill) and completed (dashed) as smooth lines that draw
// in. Point at a day (hover on a computer, tap on a phone) to see its figures beside a guide line.
export function LineChart({report,palette:p,motionKey='report:line'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const [width,setWidth]=useState(280),days=report.chartDays,max=Math.max(1,...days.map(day=>day.value));
  const top=34,bottom=190,height=226;
  const all=graphGeometry(days.map(day=>day.value),width,top,bottom,max),done=graphGeometry(days.map(day=>day.completed),width,top,bottom,max);
  const allPts=pointsOf(days.map(day=>day.value),all),donePts=pointsOf(days.map(day=>day.completed),done);
  const draw=useDraw(motionKey),lengthAll=pathLength(allPts)||1;
  const [focus,setFocus]=useState<number|null>(null);
  const peak=days[report.peak],shown=focus===null?null:days[focus];
  const id='line-'+motionKey.replace(/[^a-z0-9]/gi,'');
  const ticks=[0,0.5,1].map(f=>Math.round(max*f));
  return <ChartReveal motionKey={motionKey}><View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{gap:12}} accessible accessibilityLabel={`Work per ${report.duration>31?'week':'day'}. Recorded ${report.current.total}. Completed ${report.current.complete}. Peak ${peak.value} on ${peak.date}.`}>
    <View style={[ui.row,{gap:14,flexWrap:'wrap'}]}>
      <View style={[ui.row,{gap:7}]}><View style={{width:14,height:4,borderRadius:2,backgroundColor:p.primary}}/><Text style={{color:p.text,fontSize:12,fontWeight:'600'}}>Recorded <Text style={{fontWeight:'800'}}>{report.current.total}</Text></Text></View>
      <View style={[ui.row,{gap:7}]}><View style={{width:14,height:0,borderTopWidth:2,borderStyle:'dashed',borderColor:p.success}}/><Text style={{color:p.text,fontSize:12,fontWeight:'600'}}>Completed <Text style={{fontWeight:'800'}}>{report.current.complete}</Text></Text></View>
      <Text style={{color:p.muted,fontSize:12,flex:1,textAlign:'right',minWidth:120}}>Peak {peak.value} · {shortReportDate(peak.date)}{report.duration>31?' · weekly totals':''}</Text>
    </View>
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs><LinearGradient id={id} x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={p.isDark?'#A7D9C1':'#2F6F63'} stopOpacity={0.26}/><Stop offset="1" stopColor={p.isDark?'#A7D9C1':'#2F6F63'} stopOpacity={0}/></LinearGradient></Defs>
        {ticks.map((tick,i)=><Line key={'grid'+i} x1={28} x2={width-8} y1={all.y(tick)} y2={all.y(tick)} stroke={p.border} strokeDasharray={i?'2 6':undefined} strokeOpacity={i?0.9:1}/>)}
        {ticks.map((tick,i)=><SvgText key={'tick'+i} x={0} y={all.y(tick)+4} fill={p.muted} fontFamily="Montserrat_500Medium" fontSize={11}>{tick}</SvgText>)}
        <AnimatedPath d={smoothArea(allPts,bottom)} fill={`url(#${id})`} opacity={draw}/>
        <AnimatedPath d={smoothPath(donePts)} fill="none" stroke={p.success} strokeWidth={2} strokeDasharray={`5 5`} strokeLinecap="round" opacity={draw.interpolate({inputRange:[0,0.4,1],outputRange:[0,0.2,1]})}/>
        <AnimatedPath d={smoothPath(allPts)} fill="none" stroke={p.primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={lengthAll} strokeDashoffset={draw.interpolate({inputRange:[0,1],outputRange:[lengthAll,0]})}/>
        {focus===null&&<><Circle cx={all.x(report.peak)} cy={all.y(peak.value)} r={9} fill={p.primary} fillOpacity={0.14}/><Circle cx={all.x(report.peak)} cy={all.y(peak.value)} r={4} fill={p.primary}/></>}
        {focus!==null&&<>
          <Line x1={all.x(focus)} x2={all.x(focus)} y1={top-10} y2={bottom} stroke={p.controlBorder} strokeDasharray="3 4"/>
          <Circle cx={done.x(focus)} cy={done.y(days[focus].completed)} r={4} fill={p.surface} stroke={p.success} strokeWidth={2}/>
          <Circle cx={all.x(focus)} cy={all.y(days[focus].value)} r={10} fill={p.primary} fillOpacity={0.16}/>
          <Circle cx={all.x(focus)} cy={all.y(days[focus].value)} r={5} fill={p.primary} stroke={p.surface} strokeWidth={2}/>
        </>}
        {[0,Math.floor((days.length-1)/2),days.length-1].filter((i,n,list)=>list.indexOf(i)===n).map(i=><SvgText key={i} x={all.x(i)} y={height-6} textAnchor={i===0?'start':i===days.length-1?'end':'middle'} fontFamily="Montserrat_500Medium" fontSize={11} fill={p.muted}>{shortReportDate(days[i].date)}</SvgText>)}
      </Svg>
      {/* One invisible column per day picks it on hover or tap; leaving the chart clears the guide. */}
      <View style={{position:'absolute',left:0,right:0,top:0,height:bottom,flexDirection:'row'}} {...(Platform.OS==='web'?{onMouseLeave:()=>setFocus(null)}:{})}>
        {days.map((day,i)=>{
          const left=i===0?0:(all.x(i-1)+all.x(i))/2,right=i===days.length-1?width:(all.x(i)+all.x(i+1))/2;
          return <MotionPress key={day.date} accessibilityRole="button" accessibilityLabel={`${day.date}: ${day.value} recorded, ${day.completed} completed`} onPress={()=>setFocus(focus===i?null:i)} onHoverIn={()=>setFocus(i)}
            style={{position:'absolute',left,width:Math.max(1,right-left),top:0,bottom:0}}/>;
        })}
      </View>
      {shown&&focus!==null&&<View pointerEvents="none" style={{position:'absolute',top:0,left:Math.min(Math.max(0,all.x(focus)-70),Math.max(0,width-140)),width:140,padding:10,borderRadius:14,backgroundColor:p.surface,borderWidth:1,borderColor:p.border,gap:3,...depth.raised}}>
        <Text style={{color:p.muted,fontSize:11,fontWeight:'700',letterSpacing:0.6,textTransform:'uppercase'}}>{shortReportDate(shown.date)}</Text>
        <View style={ui.between}><Text style={{color:p.text,fontSize:12}}>Recorded</Text><Text style={{color:p.primary,fontSize:13,fontWeight:'800'}}>{shown.value}</Text></View>
        <View style={ui.between}><Text style={{color:p.text,fontSize:12}}>Completed</Text><Text style={{color:p.success,fontSize:13,fontWeight:'800'}}>{shown.completed}</Text></View>
      </View>}
    </View>
  </View></ChartReveal>;
}

// Tasks by status: a ring that sweeps round from the top, its centre figure following the status in
// focus. Choosing a status (or hovering it) dims the others.
export function StatusChart({report,palette:p,motionKey='report:status'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const [width,setWidth]=useState(280),[selected,setSelected]=useState<string|null>(null),[hovered,setHovered]=useState<string|null>(null);
  const data=report.current,segments=statusBreakdown(data.status,data.total);
  const active=hovered??selected,focused=segments.find(item=>item.name===active);
  const sweep=useDraw(motionKey,1200,80);
  const color=(kind:string)=>kind==='complete'?p.success:kind==='waiting'?p.waiting:kind==='other'?p.danger:p.chart;
  const label=focused?.name||'Total tasks',value=focused?.value??data.total;
  return <ChartReveal motionKey={motionKey}><View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{gap:18}}>
    <Text style={[ui.small,{color:p.muted}]}>Current status of tasks recorded in the selected period.</Text>
    <View style={{flexDirection:width>=520?'row':'column',alignItems:'center',gap:24}}>
      <View accessible accessibilityRole="image" accessibilityLabel={'Tasks by status. '+data.status.map(s=>s.name+' '+s.value).join(', ')+'. Total '+data.total+'.'} style={{width:220,height:220,flexShrink:0,alignItems:'center',justifyContent:'center'}}>
        <Svg width={220} height={220} viewBox="0 0 220 220" style={{position:'absolute'}}>
          <Circle cx={110} cy={110} r={92} fill={p.background} opacity={0.6}/>
          <Circle cx={110} cy={110} r={76} stroke={p.elevated} strokeWidth={18} fill="none"/>
          {segments.filter(s=>s.value>0).map(s=>{const len=Math.max(0,s.length-(s.share===1?0:4));return <AnimatedCircle key={s.name} cx={110} cy={110} r={76} stroke={color(s.kind)} strokeWidth={focused?.name===s.name?22:18} strokeLinecap={s.share===1?'butt':'round'} fill="none"
            strokeDasharray={sweep.interpolate({inputRange:[0,1],outputRange:[`0 ${s.circumference}`,`${len} ${s.circumference}`]})} strokeDashoffset={sweep.interpolate({inputRange:[0,1],outputRange:[0,-s.offset]})}
            rotation={-90} origin="110,110" opacity={!focused||focused.name===s.name?1:0.22}/>;})}
        </Svg>
        <Text style={{color:p.muted,fontSize:12,lineHeight:18,fontWeight:'600'}}>{label}</Text>
        <TweenNumber value={value} accessibilityLiveRegion="polite" style={{color:p.text,fontSize:40,lineHeight:48,fontWeight:'700',letterSpacing:-1.4,fontVariant:['tabular-nums']}}/>
        <Text style={{color:p.muted,fontSize:12,lineHeight:18}}>{focused?`${focused.percentage}% of ${data.total}`:'In this period'}</Text>
      </View>
      <View style={{gap:10,flex:width>=520?1:undefined,width:width>=520?undefined:'100%',minWidth:0}}>
        {segments.map(s=>{const on=focused?.name===s.name;return <MotionPress key={s.name} accessibilityRole="button" accessibilityLabel={`Highlight ${s.name}: ${s.value} tasks, ${s.percentage} percent`} accessibilityState={{selected:selected===s.name}} onPress={()=>setSelected(selected===s.name?null:s.name)} onHoverIn={()=>setHovered(s.name)} onHoverOut={()=>setHovered(null)}
          style={{gap:9,padding:12,borderWidth:1,borderColor:on?color(s.kind):p.border,borderRadius:16,backgroundColor:on?p.wash:p.surface}}>
          <View style={[ui.row,{gap:10}]}><View style={{width:30,height:30,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:p.background}}><ReportSymbol kind={s.kind} color={color(s.kind)} size={16}/></View><Text style={{flex:1,color:p.text,fontSize:14,lineHeight:20,fontWeight:'600'}}>{s.name}</Text><Text style={{color:p.text,fontSize:20,fontWeight:'700',fontVariant:['tabular-nums']}}>{s.value}</Text><Text style={{minWidth:42,textAlign:'right',color:p.muted,fontSize:12,fontVariant:['tabular-nums']}}>{s.percentage}%</Text></View>
          <GrowBar share={s.share} color={color(s.kind)} track={p.elevated} height={5}/>
        </MotionPress>;})}
      </View>
    </View>
    <View style={[ui.between,{gap:12,flexWrap:'wrap'}]}><Text style={[ui.small,{color:p.muted,flexShrink:1}]}>{data.total===0?'No tasks recorded in this period.':'Choose a status to highlight its share.'}</Text>{selected&&<MotionPress accessibilityRole="button" accessibilityLabel="Show all task statuses" onPress={()=>setSelected(null)} style={{minHeight:44,justifyContent:'center'}}><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>Show all statuses</Text></MotionPress>}</View>
  </View></ChartReveal>;
}

// Work by type: one bar per area in its department colour, growing to its share of the largest.
export function QueueChart({report,palette:p,motionKey='report:queues'}:{report:ReportPresentation;palette:Palette;motionKey?:string}) {
  const max=Math.max(1,...report.queues.map(q=>q.value));
  return <ChartReveal motionKey={motionKey}><View style={{gap:16}}>{report.queues.map(q=>{
    const ink=q.tone==='primary'?p.primary:departmentColor(q.tone,p).ink;
    return <View key={q.name} style={{gap:8}}>
      <View style={ui.between}><Text style={[ui.small,{color:p.text,fontWeight:'600'}]}>{q.name}</Text><Text style={{color:p.text,fontSize:15,fontWeight:'700',fontVariant:['tabular-nums']}}>{q.available?q.value:'-'}</Text></View>
      <GrowBar share={q.available?q.value/max:0} color={ink} track={p.elevated} height={12}/>
      {(!q.available||q.value===0)&&<Text style={[ui.small,{color:p.muted}]}>{q.available?'None in this period':'Data unavailable'}</Text>}
    </View>;})}
    <Text style={[ui.small,{color:p.muted}]}>{report.available?`${report.current.total} tasks in total`:'Task data unavailable'}</Text></View></ChartReveal>;
}
