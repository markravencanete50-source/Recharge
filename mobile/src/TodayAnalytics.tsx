import { DimensionalIcon } from './DimensionalIcon';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, {Circle,Defs,Filter,FeGaussianBlur,Line,LinearGradient,Path,Polyline,RadialGradient,Rect,Stop,Text as SvgText} from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { todayColors, type todayPresentation } from '../../lib/today-presentation';
import { Text } from './Typography';
import { MotionPress, useMotionPreference, useReducedMotion } from './motion';
import { ui, type Palette } from './theme';

type Today=ReturnType<typeof todayPresentation>;

// Forest gradient with two soft lights drifting slowly behind the Home hero.
// Glow opacity stays low so hero text keeps its tested contrast.
export function HeroGlow({palette:p}:{palette:Palette}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  const reduced=useReducedMotion();
  const [drift]=useState(()=>new Animated.Value(0));
  useEffect(()=>{
    if(reduced){drift.stopAnimation();drift.setValue(0);return;}
    const ease=Easing.inOut(Easing.sin),native=Platform.OS!=='web';
    const loop=Animated.loop(Animated.sequence([
      Animated.timing(drift,{toValue:1,duration:9000,easing:ease,useNativeDriver:native}),
      Animated.timing(drift,{toValue:0,duration:9000,easing:ease,useNativeDriver:native}),
    ]));
    loop.start();return()=>loop.stop();
  },[drift,reduced]);
  const glow=(id:string,color:string,opacity:number,size:number)=><Svg width={size} height={size}><Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={opacity}/><Stop offset="1" stopColor={color} stopOpacity={0}/></RadialGradient></Defs><Circle cx={size/2} cy={size/2} r={size/2} fill={`url(#${id})`}/></Svg>;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" viewBox="0 0 600 300" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Defs><LinearGradient id="home-hero-base" x1="0" x2="1" y1="0" y2="1"><Stop offset="0" stopColor={tone.heroStart}/><Stop offset="1" stopColor={tone.heroEnd}/></LinearGradient></Defs>
      <Rect width="600" height="300" fill="url(#home-hero-base)"/>
    </Svg>
    <Animated.View style={{position:'absolute',right:-120,top:-140,transform:[{translateX:drift.interpolate({inputRange:[0,1],outputRange:[0,-48]})},{translateY:drift.interpolate({inputRange:[0,1],outputRange:[0,36]})}]}}>{glow('home-hero-glow-a',tone.mint,0.2,380)}</Animated.View>
    <Animated.View style={{position:'absolute',left:-140,bottom:-160,transform:[{translateX:drift.interpolate({inputRange:[0,1],outputRange:[0,40]})},{translateY:drift.interpolate({inputRange:[0,1],outputRange:[0,-28]})}]}}>{glow('home-hero-glow-b','#EFE9DB',0.08,340)}</Animated.View>
  </View>;
}
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
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
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

const AREA_COLOURS={light:['#1F5F55','#9A6418','#3B5866','#9A4426','#6B4768','#3F6A2A'],dark:['#8FD3C2','#E8C27D','#A9C6D2','#F2AE8C','#D9B5D5','#B7DA92']};
const DAY_INITIALS=['Su','Mo','Tu','We','Th','Fr','Sa'];

function GrowBar({value,max,color,track,delay,highlight}:{value:number;max:number;color:string;track:string;delay:number;highlight:boolean}) {
  const reduced=useReducedMotion();
  const [grow]=useState(()=>new Animated.Value(reduced?1:0));
  useEffect(()=>{if(reduced){grow.setValue(1);return;}grow.setValue(0);const a=Animated.timing(grow,{toValue:1,duration:700,delay,easing:Easing.bezier(0.16,1,0.3,1),useNativeDriver:false});a.start();return()=>a.stop();},[grow,reduced,value,delay]);
  const pct=max?Math.max(value?8:3,value/max*100):3;
  return <View style={{flex:1,height:'100%',justifyContent:'flex-end',borderRadius:8,backgroundColor:track,overflow:'hidden'}}>
    <Animated.View style={{height:grow.interpolate({inputRange:[0,1],outputRange:['0%',pct+'%']}),borderRadius:8,backgroundColor:color,opacity:highlight?1:0.62}}/>
  </View>;
}

// Desktop side cards: compact, each carrying its own small chart so the
// numbers have context instead of sitting in empty space.
export function TodayTiles({data,palette:p,onWaiting,onProperties,vertical=false,children}:{data:Today;palette:Palette;onWaiting:()=>void;onProperties:()=>void;vertical?:boolean;children?:ReactNode}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  const reduced=useReducedMotion();
  const [fill]=useState(()=>new Animated.Value(reduced?1:0));
  useEffect(()=>{if(reduced){fill.setValue(1);return;}fill.setValue(0);const a=Animated.timing(fill,{toValue:1,duration:900,delay:250,easing:Easing.bezier(0.16,1,0.3,1),useNativeDriver:false});a.start();return()=>a.stop();},[fill,reduced,data.waitingShare]);
  const week=data.current.trend.slice(-7);
  const weekMax=Math.max(1,...week.map(day=>day.waiting));
  const areas=data.current.queues.filter(queue=>queue.value>0);
  const areaTotal=areas.reduce((total,queue)=>total+queue.value,0);
  const colours=AREA_COLOURS[p.isDark?'dark':'light'];
  const perProperty=data.properties?Math.round(data.open/data.properties*10)/10:null;
  const card=(waiting:boolean)=>({minWidth:0,padding:vertical?22:16,borderRadius:26,borderWidth:1,borderColor:waiting?tone.waitingBorder:tone.propertyBorder,backgroundColor:waiting?tone.waitingBg:tone.propertyBg,gap:16,overflow:'hidden' as const});
  const header=(waiting:boolean)=>{const icon=waiting?tone.waitingIcon:tone.propertyIcon;return <View style={[ui.row,{gap:12}]}>
    <View style={{width:52,height:52,borderRadius:17,backgroundColor:p.isDark?'#FFFFFF0D':'#FFFFFF8C',alignItems:'center',justifyContent:'center'}}><DimensionalIcon name={waiting?'hourglass':'house'} size={42}/></View>
    <View style={{flex:1,gap:2}}>
      <Text style={{fontSize:12,fontWeight:'600',letterSpacing:1.2,textTransform:'uppercase',color:p.muted}}>{waiting?'Waiting':'Properties'}</Text>
      <View style={[ui.row,{gap:8,alignItems:'flex-end'}]}><Text style={{fontSize:34,lineHeight:40,fontWeight:'700',letterSpacing:-1.2,color:p.text}}>{waiting?data.waiting:data.properties??'—'}</Text><Text style={{fontSize:13,color:p.muted,paddingBottom:6}}>{waiting?'need a response':'managed'}</Text></View>
    </View>
    <View style={{width:34,height:34,borderRadius:17,borderWidth:1,borderColor:icon+'40',alignItems:'center',justifyContent:'center'}}><Feather name="arrow-up-right" size={16} color={icon}/></View>
  </View>;};
  return <View style={{flexDirection:vertical?'column':'row',gap:vertical?16:12,alignItems:'stretch',...(vertical?{flex:1,minWidth:0}:{})}}>
    <MotionPress {...(Platform.OS==='web'?{dataSet:{hover:'lift'}}:{})} accessibilityRole="button" accessibilityLabel={`${data.waiting} waiting, ${data.waiting} of ${data.open} open tasks`} onPress={onWaiting} style={card(true)}>
      {header(true)}
      <View accessible accessibilityLabel={'Waiting tasks by day: '+week.map(day=>day.waiting).join(', ')} style={{gap:8}}>
        <Text style={{fontSize:12,fontWeight:'600',color:p.text}}>Last 7 days</Text>
        <View style={{flexDirection:'row',gap:7,height:84}}>
          {week.map((day,index)=><GrowBar key={day.key} value={day.waiting} max={weekMax} color={tone.waitingFill} track={tone.waitingFill+'1F'} delay={120+index*60} highlight={index===week.length-1}/>)}
        </View>
        <View style={{flexDirection:'row',gap:7}}>{week.map((day,index)=><Text key={day.key} style={{flex:1,textAlign:'center',fontSize:11,fontWeight:index===week.length-1?'700':'500',color:index===week.length-1?p.text:p.muted}}>{DAY_INITIALS[new Date(day.key+'T12:00:00Z').getUTCDay()]}</Text>)}</View>
      </View>
      <View style={{gap:8}}>
        <View accessible accessibilityLabel={`${data.waiting} of ${data.open} open tasks waiting`} style={{height:8,borderRadius:4,backgroundColor:tone.waitingFill+'33',overflow:'hidden'}}><Animated.View style={{height:8,borderRadius:4,width:fill.interpolate({inputRange:[0,1],outputRange:['0%',`${data.waitingShare*100}%`]}),backgroundColor:tone.waitingFill}}/></View>
        <View style={ui.between}><Text style={{fontSize:12,lineHeight:18,color:p.text}}>{data.waiting} of {data.open} open tasks</Text><Text style={{fontSize:12,lineHeight:18,fontWeight:'700',color:tone.waitingIcon}}>{Math.round(data.waitingShare*100)}%</Text></View>
      </View>
    </MotionPress>
    <MotionPress {...(Platform.OS==='web'?{dataSet:{hover:'lift'}}:{})} accessibilityRole="button" accessibilityLabel={`${data.properties??'Unavailable'} properties, as of today`} onPress={onProperties} style={card(false)}>
      {header(false)}
      {perProperty!==null&&<View style={[ui.row,{gap:10,padding:12,borderRadius:16,backgroundColor:p.isDark?'#FFFFFF0A':'#FFFFFF8C'}]}>
        <Feather name="layers" size={16} color={tone.propertyIcon}/>
        <Text style={{flex:1,fontSize:13,color:p.text}}><Text style={{fontWeight:'700'}}>{perProperty}</Text> open tasks per property</Text>
      </View>}
      <View style={{gap:10}}>
        <Text style={{fontSize:12,fontWeight:'600',color:p.text}}>Work by area</Text>
        {areaTotal>0?<>
          <View style={{flexDirection:'row',height:10,borderRadius:5,overflow:'hidden',gap:2}}>{areas.map((queue,index)=><View key={queue.name} style={{flex:queue.value,backgroundColor:colours[index%colours.length]}}/>)}</View>
          {areas.map((queue,index)=><View key={queue.name} style={[ui.row,{gap:8}]}>
            <View style={{width:9,height:9,borderRadius:3,backgroundColor:colours[index%colours.length]}}/>
            <Text style={{flex:1,fontSize:12,color:p.text}}>{queue.name}</Text>
            <Text style={{fontSize:12,fontWeight:'700',color:p.text}}>{queue.value}</Text>
            <Text style={{width:38,textAlign:'right',fontSize:12,color:p.muted}}>{Math.round(queue.value/areaTotal*100)}%</Text>
          </View>)}
        </>:<Text style={{fontSize:12,color:p.muted}}>No recorded work in this period.</Text>}
      </View>
    </MotionPress>
    {children}
  </View>;
}
