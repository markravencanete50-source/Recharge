import { Animated, View, type DimensionValue } from 'react-native';
import Svg, { Circle, Line, Polyline, Path, G, Text as SvgText } from 'react-native-svg';
import { Text } from './Typography';
import { ui, departmentColor, type Palette } from './theme';
import { useReveal } from './motion';
import type { buildAnalytics } from './model';
type Analytics = ReturnType<typeof buildAnalytics>;
const shortDate=(date:string)=>date.split(' ').slice(0,2).join(' ');
export function ChartReveal({children,motionKey}:{children:React.ReactNode;motionKey:string}) {
  const progress=useReveal(motionKey,0,550);
  return <Animated.View style={{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[8,0]})}]}}>{children}</Animated.View>;
}
export function LineChart({data,palette:p,motionKey='report:line'}:{data:Analytics;palette:Palette;motionKey?:string}) {
  const days=data.trend.map(day=>({date:day.date,value:data.sources.reduce((n,s)=>n+(day[s.key]||0),0)}));
  const max=Math.max(1,...days.map(day=>day.value));
  const peak=days.reduce((n,day,i)=>day.value>days[n].value?i:n,0);
  const labels=[...new Set([0,peak,days.length-1])].filter(i=>i>=0);
  const x=(i:number)=>24+i/Math.max(1,days.length-1)*304, y=(value:number)=>196-value/max*106;
  const points=days.map((day,i)=>x(i)+','+y(day.value)).join(' ');
  return <ChartReveal motionKey={motionKey}><View accessible accessibilityLabel={'Daily recorded items. '+labels.map(i=>(i===0?'First':i===days.length-1?'Latest':'Peak')+' '+days[i].date+': '+days[i].value).join('. ')}>
    <Svg width="100%" height={248} viewBox="0 0 352 248">
      {[0,1,2].map(i=><Line key={i} x1={24} x2={328} y1={90+i*53} y2={90+i*53} stroke={p.border} strokeDasharray="3 5"/>)}
      <Path d={'M24 196 L'+points.split(' ').join(' L')+' L'+x(days.length-1)+' 196Z'} fill={p.wash}/>
      <Polyline points={points} stroke={p.bright} strokeWidth={3} fill="none" strokeLinejoin="round"/>
      {labels.map((index,i)=>{const tx=labels.length===1?176:42+i/(labels.length-1)*268, label=index===0?'First':index===days.length-1?'Latest':'Peak';return <G key={index}>
        <Line x1={tx} y1={55} x2={x(index)} y2={y(days[index].value)-8} stroke={p.muted} strokeDasharray={i===1?'3 3':undefined}/>
        <Circle cx={x(index)} cy={y(days[index].value)} r={5} fill={p.primary} stroke={p.surface} strokeWidth={2}/>
        <SvgText fontFamily="Inter_600SemiBold" x={tx} y={22} textAnchor="middle" fontSize={15} fontWeight="600" fill={p.text}>{label+' '+days[index].value}</SvgText>
        <SvgText fontFamily="Inter_600SemiBold" x={tx} y={42} textAnchor="middle" fontSize={14} fill={p.muted}>{shortDate(days[index].date)}</SvgText>
      </G>})}
      <SvgText fontFamily="Inter_600SemiBold" x={24} y={228} fontSize={14} fill={p.muted}>{shortDate(days[0]?.date||'')}</SvgText><SvgText fontFamily="Inter_600SemiBold" x={328} y={228} textAnchor="end" fontSize={14} fill={p.muted}>{shortDate(days.at(-1)?.date||'')}</SvgText>
    </Svg>
  </View></ChartReveal>;
}
export function StatusChart({data,palette:p,motionKey='report:status'}:{data:Analytics;palette:Palette;motionKey?:string}) {
  const colors=[p.bright,departmentColor('stays',p).ink,departmentColor('cleans',p).ink], circumference=2*Math.PI*62;
  const labelRows=data.status.map((status,index)=>{const previous=data.status.slice(0,index).reduce((sum,s)=>sum+s.value,0);const angle=data.total?(previous+status.value/2)/data.total*Math.PI*2-Math.PI/2:-Math.PI/2+index*Math.PI*2/3;return {index,y:Math.sin(angle)};}).sort((a,b)=>a.y-b.y);
  return <ChartReveal motionKey={motionKey}><View accessible accessibilityLabel={'Work status. '+data.status.map(s=>s.name+' '+s.value).join(', ')}>
    <Svg width="100%" height={256} viewBox="0 0 352 256">
      <Circle cx={92} cy={124} r={62} stroke={p.elevated} strokeWidth={18} fill="none"/>
      {data.status.map((s,i)=>{const previous=data.status.slice(0,i).reduce((n,s)=>n+s.value,0), length=data.total?s.value/data.total*circumference:0;
        const angle=data.total?(previous+s.value/2)/data.total*Math.PI*2-Math.PI/2:-Math.PI/2+i*Math.PI*2/3;
        const startX=92+Math.cos(angle)*72,startY=124+Math.sin(angle)*72,labelY=46+labelRows.findIndex(row=>row.index===i)*77;
        return <G key={s.name}>
          {s.value>0&&<Circle cx={92} cy={124} r={62} stroke={colors[i]} strokeWidth={18} fill="none" strokeDasharray={Math.max(0,length-4)+' '+circumference} strokeDashoffset={data.total?-previous/data.total*circumference:0} rotation={-90} origin="92,124"/>}
          <Polyline points={startX+','+startY+(startX<92?' '+startX+','+(startY<124?12:244)+' 184,'+(startY<124?12:244):'')+' 184,'+labelY+' 198,'+labelY} stroke={p.muted} strokeWidth={1} fill="none" strokeDasharray={i===1?'3 3':undefined}/>
          <SvgText fontFamily="Inter_600SemiBold" x={208} y={labelY-3} fontSize={15} fill={p.text}>{s.name}</SvgText><SvgText fontFamily="Inter_600SemiBold" x={208} y={labelY+21} fontSize={20} fontWeight="600" fill={p.text}>{s.value}</SvgText>
        </G>;
      })}
      <SvgText fontFamily="Inter_600SemiBold" x={92} y={126} textAnchor="middle" fontSize={28} fontWeight="700" fill={p.text}>{data.total}</SvgText><SvgText fontFamily="Inter_600SemiBold" x={92} y={146} textAnchor="middle" fontSize={14} fill={p.muted}>items</SvgText>
    </Svg>
  </View></ChartReveal>;
}
export function QueueChart({data,palette:p,motionKey='report:queues'}:{data:Analytics;palette:Palette;motionKey?:string}) {
  const colors=[p.bright,departmentColor('stays',p).ink,departmentColor('cleans',p).ink,departmentColor('clients',p).ink,departmentColor('accounts',p).ink];
  const queues=data.queues.map((q,i)=>({...q,index:i,available:data.sources[i].available})).sort((a,b)=>b.value-a.value||a.index-b.index);
  const max=Math.max(1,...queues.map(q=>q.value));
  return <ChartReveal motionKey={motionKey}><View style={{gap:18}}>{queues.map(q=><View key={q.name} accessible accessibilityLabel={q.name+': '+(q.available?q.value+' records':'not connected')} style={{gap:8}}>
    <Text style={[ui.small,{color:p.text,fontWeight:'600'}]}>{q.name}</Text>
    <View style={[ui.row,{gap:12}]}><View style={{flex:1,height:16,borderRadius:999,backgroundColor:p.elevated,overflow:'hidden'}}><View style={{height:16,width:((q.available?q.value/max*100:0)+'%') as DimensionValue,backgroundColor:colors[q.index%colors.length],borderRadius:999}}/></View><Text style={{minWidth:38,fontSize:15,fontWeight:'600',color:p.text,textAlign:'right'}}>{q.available?q.value:'-'}</Text></View>
    {!q.available&&<Text style={[ui.small,{color:p.muted}]}>Source not connected</Text>}
  </View>)}</View></ChartReveal>;
}
export function Sparkline({values,label,palette:p}:{values:number[];label:string;palette:Palette}) {
  const max=Math.max(1,...values);
  return <View accessible accessibilityLabel={'Seven-day recorded activity. '+label} style={[ui.row,{gap:16,flexWrap:'wrap'}]}><Svg width={112} height={36} viewBox="0 0 112 36"><Polyline points={values.map((v,i)=>(4+i/Math.max(1,values.length-1)*104)+','+(31-v/max*25)).join(' ')} stroke={p.heroText} strokeWidth={2} fill="none" strokeLinejoin="round"/><Circle cx={108} cy={31-(values.at(-1)||0)/max*25} r={3} fill={p.heroText}/></Svg><Text style={{fontSize:13,color:p.heroText}}>{label}</Text></View>;
}
