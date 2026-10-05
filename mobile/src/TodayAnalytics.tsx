import { useEffect, useState } from 'react';
import { Animated, Platform, View } from 'react-native';
import Svg, {Circle,Defs,Filter,FeGaussianBlur,LinearGradient,Path,Polyline,Stop,Text as SvgText} from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { todayColors, type todayPresentation } from '../../lib/today-presentation';
import { Text } from './Typography';
import { ReportSymbol } from './Charts';
import { MotionPress, useMotionPreference } from './motion';
import { ui, type Palette } from './theme';

type Today=ReturnType<typeof todayPresentation>;
const AnimatedCircle=Animated.createAnimatedComponent(Circle);

export function TodayRing({completed,total,motionKey}:{completed:number;total:number;motionKey:string}) {
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
  const ring={cx:44,cy:44,r:35,fill:'none',stroke:todayColors.mint,strokeWidth:6,strokeLinecap:'round' as const,strokeDasharray:circumference,strokeDashoffset:draw.interpolate({inputRange:[0,1],outputRange:[circumference,circumference*(1-share)]}),rotation:-90,origin:'44,44'};
  return <View accessible accessibilityLabel={`${completed} of ${total} tasks done, ${total?Math.round(share*100):0} percent`} style={{width:88,height:88,alignItems:'center',justifyContent:'center',gap:1}}>
    <Svg width={88} height={88} style={{position:'absolute'}} viewBox="0 0 88 88">
      <Defs><Filter id="today-ring-glow" x="-50%" y="-50%" width="200%" height="200%"><FeGaussianBlur stdDeviation={4}/></Filter></Defs>
      {/* Blue backing preserves 3:1 against the requested 22% white track. */}
      <Circle cx={44} cy={44} r={42} fill={todayColors.heroStart}/>
      <Circle cx={44} cy={44} r={35} fill="none" stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={6}/>
      {share>0&&<><AnimatedCircle {...ring} opacity={0.4} filter="url(#today-ring-glow)"/><AnimatedCircle {...ring}/></>}
    </Svg>
    <Text style={{color:'#FFFFFF',fontSize:22,fontWeight:'600',letterSpacing:-0.7}}>{total?Math.round(share*100):0}%</Text><Text style={{color:'#FFFFFF',fontSize:12}}>done</Text>
  </View>;
}

export function OpenTasksSparkline({data,motionKey}:{data:Today;motionKey:string}) {
  const [width,setWidth]=useState(112);
  const values=data.days.map(day=>day.value),max=Math.max(1,...values);
  const x=(i:number)=>8+i/Math.max(1,values.length-1)*(width-16),y=(value:number)=>32-value/max*23;
  const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
  const {reduced,ready,seen}=useMotionPreference(),[opacity]=useState(()=>new Animated.Value(1));
  useEffect(()=>{if(!ready)return;if(reduced||seen.has(motionKey)){opacity.setValue(1);return;}seen.add(motionKey);opacity.setValue(0);const animation=Animated.timing(opacity,{toValue:1,duration:300,useNativeDriver:Platform.OS!=='web'});animation.start();return()=>{animation.stop();opacity.setValue(1);};},[motionKey,opacity,ready,reduced,seen]);
  return <View style={{gap:8}}><View style={[ui.row,{gap:12,flexWrap:'wrap'}]}>
    <Animated.View onLayout={event=>setWidth(event.nativeEvent.layout.width)} accessible accessibilityLabel={`Currently open tasks by recorded date: ${data.days.map(day=>`${day.date}: ${day.value}`).join('; ')}. ${data.changeLabel}. Historical backlog is unavailable.`} style={{width:112,opacity}}>
      {data.available?<Svg width="100%" height={54} viewBox={`0 0 ${width} 54`}><Defs><LinearGradient id="today-open-area" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={todayColors.spark} stopOpacity={0.35}/><Stop offset="1" stopColor={todayColors.spark} stopOpacity={0}/></LinearGradient></Defs>
        <Path d={`M8 36 L${points.split(' ').join(' L')} L${x(values.length-1)} 36 Z`} fill="url(#today-open-area)"/>
        <Polyline points={points} fill="none" stroke={todayColors.spark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
        <Circle cx={x(values.length-1)} cy={y(values.at(-1)||0)} r={6} fill={todayColors.spark} fillOpacity={0.4}/><Circle cx={x(values.length-1)} cy={y(values.at(-1)||0)} r={2.5} fill="#FFFFFF"/>
        <SvgText x={x(0)} y={51} fill="#FFFFFF" fontSize={12} fontFamily="Montserrat_500Medium" textAnchor="start">{values[0]}</SvgText><SvgText x={x(values.length-1)} y={51} fill="#FFFFFF" fontSize={12} fontFamily="Montserrat_500Medium" textAnchor="end">{values.at(-1)}</SvgText>
      </Svg>:<Text style={{color:'#FFFFFF',fontSize:12}}>Data unavailable</Text>}
    </Animated.View>
    <View style={[ui.row,{gap:6,backgroundColor:'rgba(255,255,255,0.14)',paddingHorizontal:10,paddingVertical:8,borderRadius:999,flexShrink:1}]}><Feather name={data.direction==='down'?'arrow-down':data.direction==='up'?'arrow-up':'minus'} size={15} color={data.good?todayColors.mint:todayColors.unfavourable}/><Text style={{color:'#FFFFFF',fontSize:12,fontWeight:'500',flexShrink:1,lineHeight:18}}>{data.changeLabel}</Text></View>
  </View><Text style={{color:'#FFFFFF',fontSize:12,lineHeight:18}}>Open tasks, last 7 days</Text></View>;
}

export function TodayTiles({data,palette:p,onWaiting,onProperties}:{data:Today;palette:Palette;onWaiting:()=>void;onProperties:()=>void}) {
  const tone=todayColors[p.isDark?'dark':'light'];
  return <View style={[ui.row,{gap:12,alignItems:'stretch'}]}>{['waiting','properties'].map(kind=>{
    const waiting=kind==='waiting',icon=waiting?tone.waitingIcon:tone.propertyIcon;
    return <MotionPress key={kind} accessibilityRole="button" accessibilityLabel={waiting?`${data.waiting} waiting, ${data.waiting} of ${data.open} open tasks`:`${data.properties??'Unavailable'} properties, as of today`} onPress={waiting?onWaiting:onProperties} style={{flex:1,minWidth:0,padding:16,borderRadius:22,borderWidth:1,borderColor:waiting?tone.waitingBorder:tone.propertyBorder,backgroundColor:waiting?tone.waitingBg:tone.propertyBg,gap:10}}>
      <View style={ui.between}><View style={{width:30,height:30,borderRadius:10,backgroundColor:p.isDark?(waiting?'#FFB54729':'#A9BAFF29'):(waiting?'#B4530910':'#3457D510'),alignItems:'center',justifyContent:'center'}}><ReportSymbol kind={waiting?'waiting':'property'} color={icon} size={19}/></View><Feather name="arrow-up-right" size={16} color={icon}/></View>
      <View style={[ui.row,{gap:6,flexWrap:'wrap'}]}><Text style={{fontSize:24,fontWeight:'600',letterSpacing:-0.8,color:p.text}}>{waiting?data.waiting:data.properties??'—'}</Text><Text style={{fontSize:13,color:p.text}}>{kind}</Text></View>
      {waiting?<><View accessible accessibilityLabel={`${data.waiting} of ${data.open} open tasks waiting`} style={{height:6,borderRadius:3,backgroundColor:'#FFB54733',overflow:'hidden'}}><View style={{height:6,borderRadius:3,width:`${data.waitingShare*100}%`,backgroundColor:tone.waitingFill}}/></View><Text style={{fontSize:12,lineHeight:18,color:p.text}}>{data.waiting} of {data.open} open tasks</Text></>:<Text style={{fontSize:12,lineHeight:18,color:p.text}}>As of today</Text>}
    </MotionPress>;
  })}</View>;
}
