import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, {Circle,Defs,Filter,FeGaussianBlur,Line,LinearGradient,Path,Polyline,Stop,Text as SvgText} from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { todayColors, type todayPresentation } from '../../lib/today-presentation';
import { Text } from './Typography';
import { ReportSymbol } from './Charts';
import { MotionPress, useMotionPreference } from './motion';
import { ui, type Palette } from './theme';

type Today=ReturnType<typeof todayPresentation>;
const AnimatedCircle=Animated.createAnimatedComponent(Circle);
const AnimatedPolyline=Animated.createAnimatedComponent(Polyline);
const AnimatedPath=Animated.createAnimatedComponent(Path);

export function TodayRing({completed,total,motionKey,size=88,palette:p}:{completed:number;total:number;motionKey:string;size?:number;palette:Palette}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  const {reduced,ready,seen}=useMotionPreference();
  const [draw]=useState(()=>new Animated.Value(1));
  const share=total?Math.min(1,completed/total):0,circumference=2*Math.PI*35;
  useEffect(()=>{
    if(!ready)return;
    if(reduced||seen.has(motionKey)){draw.setValue(1);return;}
    seen.add(motionKey);draw.setValue(0);
    const animation=Animated.timing(draw,{toValue:1,duration:550,useNativeDriver:false});
    animation.start();return()=>{animation.stop();draw.setValue(1);};
  },[draw,motionKey,ready,reduced,seen]);
  const ring={cx:44,cy:44,r:35,fill:'none',stroke:tone.mint,strokeWidth:6,strokeLinecap:'round' as const,strokeDasharray:circumference,strokeDashoffset:draw.interpolate({inputRange:[0,1],outputRange:[circumference,circumference*(1-share)]}),rotation:-90,origin:'44,44'};
  return <View accessible accessibilityLabel={`${completed} of ${total} tasks done, ${total?Math.round(share*100):0} percent`} style={{width:size,height:size,alignItems:'center',justifyContent:'center',gap:1}}>
    <Svg width={size} height={size} style={{position:'absolute'}} viewBox="0 0 88 88">
      <Defs><Filter id="today-ring-glow" x="-50%" y="-50%" width="200%" height="200%"><FeGaussianBlur stdDeviation={4}/></Filter></Defs>
      {/* Solid themed backing and track keep the progress stroke readable. */}
      <Circle cx={44} cy={44} r={42} fill={tone.ringBg}/>
      <Circle cx={44} cy={44} r={35} fill="none" stroke={tone.ringTrack} strokeWidth={6}/>
      {share>0&&<><AnimatedCircle {...ring} opacity={0.4} filter="url(#today-ring-glow)"/><AnimatedCircle {...ring}/></>}
    </Svg>
    <Text style={{color:tone.heroText,fontSize:size>88?28:22,fontWeight:'600',letterSpacing:-0.7}}>{total?Math.round(share*100):0}%</Text><Text style={{color:tone.heroMuted,fontSize:12}}>done</Text>
  </View>;
}

export function OpenTasksTrend({data,motionKey,wide=false,palette:p}:{data:Today;motionKey:string;wide?:boolean;palette:Palette}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  const [width,setWidth]=useState(300);
  const [selectedDate,setSelectedDate]=useState(data.days.at(-1)?.date);
  const values=data.days.map(day=>day.value),total=values.reduce((sum,value)=>sum+value,0);
  const max=Math.max(2,Math.ceil(Math.max(0,...values)/2)*2),height=wide?180:150;
  const x=(i:number)=>28+(i+0.5)/values.length*(width-28);
  const y=(value:number)=>height-12-value/max*(height-36);
  const points=values.map((value,i)=>`${x(i)},${y(value)}`).join(' ');
  const length=values.reduce((sum,value,i)=>i?sum+Math.hypot(x(i)-x(i-1),y(value)-y(values[i-1])):sum,0);
  const found=data.days.findIndex(day=>day.date===selectedDate);
  const selected=found<0?data.days.length-1:found;
  const day=data.days[selected];
  const label=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'});
  const {reduced,ready,seen}=useMotionPreference(),[draw]=useState(()=>new Animated.Value(1));
  useEffect(()=>{
    if(!ready)return;
    if(reduced||seen.has(motionKey)){draw.setValue(1);return;}
    seen.add(motionKey);draw.setValue(0);
    const animation=Animated.timing(draw,{toValue:1,duration:650,useNativeDriver:false});
    animation.start();return()=>{animation.stop();draw.setValue(1);};
  },[motionKey,draw,ready,reduced,seen]);
  return <View testID="home-task-trend" style={{gap:14,backgroundColor:tone.trendBg,borderRadius:18,padding:16,overflow:'hidden'}}>
    <View style={[ui.between,{gap:12,flexWrap:'wrap'}]}>
      <View style={{gap:4}}><Text style={{color:tone.heroText,fontSize:15,fontWeight:'600'}}>Open tasks by date</Text><Text style={{color:tone.heroText,fontSize:12,lineHeight:18}}>{label(data.days[0].date)} to {label(data.days.at(-1)!.date)}</Text></View>
      <View style={[ui.row,{gap:6,backgroundColor:tone.chipBg,paddingHorizontal:10,paddingVertical:7,borderRadius:999}]}><Feather name={data.direction==='down'?'arrow-down':data.direction==='up'?'arrow-up':'minus'} size={15} color={data.good?tone.mint:tone.unfavourable}/><Text style={{color:tone.heroText,fontSize:12,fontWeight:'500'}}>{data.changeLabel}</Text></View>
    </View>
    {data.available?<>
      <Text style={{color:tone.heroText,fontSize:12,lineHeight:18}}>{total} currently open, recorded in these 7 days</Text>
      <View onLayout={event=>setWidth(Math.max(80,event.nativeEvent.layout.width))} accessible accessibilityRole="image" accessibilityLabel={`Open tasks by recorded date. ${data.days.map(day=>`${day.date}: ${day.value}`).join('; ')}. ${data.changeLabel}. Counts use current task status, not historical backlog.`}>
        <Svg accessible={false} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <Defs><LinearGradient id="today-open-area" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={tone.spark} stopOpacity={0.3}/><Stop offset="1" stopColor={tone.spark} stopOpacity={0}/></LinearGradient></Defs>
          {[0,max/2,max].map(value=><Line key={'grid-'+value} x1={28} x2={width} y1={y(value)} y2={y(value)} stroke={tone.grid} strokeOpacity={tone.gridOpacity} strokeDasharray="3 5"/>)}
          {[0,max/2,max].map(value=><SvgText key={'label-'+value} x={0} y={y(value)+4} fill={tone.heroText} fontSize={12} fontFamily="Montserrat_500Medium">{value}</SvgText>)}
          <AnimatedPath d={`M${x(0)} ${height-12} L${points.split(' ').join(' L')} L${x(values.length-1)} ${height-12} Z`} fill="url(#today-open-area)" opacity={draw}/>
          <AnimatedPolyline points={points} fill="none" stroke={tone.spark} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length||1} strokeDashoffset={draw.interpolate({inputRange:[0,1],outputRange:[length||1,0]})}/>
          {values.map((value,i)=><Circle key={data.days[i].date} cx={x(i)} cy={y(value)} r={3} fill={tone.spark}/>)}
          <Line x1={x(selected)} x2={x(selected)} y1={18} y2={height-12} stroke={tone.selectionLine} strokeOpacity={0.6} strokeDasharray="3 4"/>
          <Circle cx={x(selected)} cy={y(day.value)} r={8} fill={tone.spark} fillOpacity={0.3}/><Circle cx={x(selected)} cy={y(day.value)} r={4} fill={tone.dot}/>
          <SvgText x={x(selected)} y={y(day.value)-12} textAnchor="middle" fill={tone.heroText} fontSize={13} fontFamily="Montserrat_600SemiBold">{day.value}</SvgText>
        </Svg>
      </View>
      <View style={{flexDirection:'row',paddingLeft:28}}>{data.days.map(item=><MotionPress key={item.date} accessibilityRole="button" accessibilityLabel={`${label(item.date)}, ${item.value} open tasks. Show daily count`} accessibilityState={{selected:item.date===day.date}} onPress={()=>setSelectedDate(item.date)} onHoverIn={()=>setSelectedDate(item.date)} style={{flex:1,minHeight:44,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:item.date===day.date?tone.selectedBg:'transparent'}}><Text style={{color:tone.heroText,fontSize:12,fontWeight:item.date===day.date?'600':'400'}}>{wide?label(item.date):Number(item.date.slice(-2))}</Text></MotionPress>)}</View>
      <View style={{gap:4}}><Text accessibilityLiveRegion="polite" style={{color:tone.heroText,fontSize:14,fontWeight:'600'}}>{label(day.date)} · {day.value} open {day.value===1?'task':'tasks'}</Text><Text style={{color:tone.heroText,fontSize:12,lineHeight:18}}>By record date, using current task status. Select a date to explore.</Text>{data.partial&&<Text style={{color:tone.heroText,fontSize:12}}>Some data sources are unavailable.</Text>}</View>
    </>:<Text style={{color:tone.heroText,fontSize:14}}>Task data is unavailable. Try refreshing Reports.</Text>}
  </View>;
}

export function TodayTiles({data,palette:p,onWaiting,onProperties,vertical=false}:{data:Today;palette:Palette;onWaiting:()=>void;onProperties:()=>void;vertical?:boolean}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  return <View style={{flexDirection:vertical?'column':'row',gap:vertical?16:12,alignItems:'stretch',...(vertical?{flex:1,minWidth:0}:{})}}>{['waiting','properties'].map(kind=>{
    const waiting=kind==='waiting',icon=waiting?tone.waitingIcon:tone.propertyIcon;
    return <MotionPress key={kind} accessibilityRole="button" accessibilityLabel={waiting?`${data.waiting} waiting, ${data.waiting} of ${data.open} open tasks`:`${data.properties??'Unavailable'} properties, as of today`} onPress={waiting?onWaiting:onProperties} style={{flex:1,minWidth:0,padding:vertical?24:16,justifyContent:vertical?'center':undefined,borderRadius:22,borderWidth:1,borderColor:waiting?tone.waitingBorder:tone.propertyBorder,backgroundColor:waiting?tone.waitingBg:tone.propertyBg,gap:vertical?18:10}}>
      <View style={ui.between}><View style={{width:30,height:30,borderRadius:10,backgroundColor:p.isDark?(waiting?'#FFB54729':'#A9BAFF29'):(waiting?'#B4530910':'#3457D510'),alignItems:'center',justifyContent:'center'}}><ReportSymbol kind={waiting?'waiting':'property'} color={icon} size={19}/></View><Feather name="arrow-up-right" size={16} color={icon}/></View>
      <View style={[ui.row,{gap:vertical?10:6,flexWrap:'wrap'}]}><Text style={{fontSize:vertical?42:24,fontWeight:'600',letterSpacing:-0.8,color:p.text}}>{waiting?data.waiting:data.properties??'—'}</Text><Text style={{fontSize:vertical?16:13,color:p.text}}>{kind}</Text></View>
      {waiting?<><View accessible accessibilityLabel={`${data.waiting} of ${data.open} open tasks waiting`} style={{height:6,borderRadius:3,backgroundColor:'#FFB54733',overflow:'hidden'}}><View style={{height:6,borderRadius:3,width:`${data.waitingShare*100}%`,backgroundColor:tone.waitingFill}}/></View><Text style={{fontSize:12,lineHeight:18,color:p.text}}>{data.waiting} of {data.open} open tasks</Text></>:<Text style={{fontSize:12,lineHeight:18,color:p.text}}>As of today</Text>}
    </MotionPress>;
  })}</View>;
}
