import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View, useWindowDimensions } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { reportPresentation } from '../../lib/report-presentation';
import { periodLabel, type AnalyticsPeriod, type AnalyticsSnapshot } from '../../lib/analytics';
import { isWorkspaceAdmin, type WorkspaceRole } from '../../lib/modules';
import { LineChart, StatusChart, QueueChart, MetricSparkline, ReportSymbol } from './Charts';
import { CountUp, Entrance, MotionPress } from './motion';
import { Text } from './Typography';
import { ui, type Palette } from './theme';
export function Reports({snapshot,period,role,palette:p,onDates,onExport,exporting,exportMessage}:{snapshot:AnalyticsSnapshot;period:AnalyticsPeriod;role:WorkspaceRole;palette:Palette;onDates:()=>void;onExport:()=>void;exporting:boolean;exportMessage:string}) {
  const report=useMemo(()=>reportPresentation(snapshot,period),[snapshot,period]);
  const {width}=useWindowDimensions(),desktop=width>=1024;
  const [table,setTable]=useState(false),metrics=report.current,card={backgroundColor:p.surface,borderColor:p.border};
  const summary=[
    {label:'Tasks',metric:'total' as const,kind:'tasks',value:report.available?metrics.total:null,color:p.primary},
    {label:'Completed',metric:'complete' as const,kind:'complete',value:report.available?metrics.complete:null,color:p.success},
    {label:'Waiting',metric:'waiting' as const,kind:'waiting',value:report.available?metrics.waiting:null,color:p.waiting},
    {label:'Properties',metric:'property' as const,kind:'property',value:metrics.properties,color:p.primary},
  ];
  return <View style={{gap:24}}>
    <Entrance sessionKey={'reports:'+role+':heading'}><View style={{gap:8}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>{snapshot.title}</Text><Text style={[ui.body,{color:p.muted}]}>{snapshot.description}</Text></View></Entrance>
    <View style={[ui.row,{gap:12,flexWrap:'wrap'}]}>
      <MotionPress accessibilityRole="button" accessibilityLabel="Choose analytics date range" onPress={onDates} style={[ui.button,card,{borderWidth:1,flexGrow:desktop?0:1,gap:10}]}><Feather name="calendar" size={18} color={p.primary}/><Text style={[ui.small,{color:p.text,flexShrink:1,fontWeight:'600'}]}>{periodLabel(period)}</Text><Feather name="chevron-down" size={16} color={p.muted}/></MotionPress>
      {isWorkspaceAdmin(role)&&<MotionPress accessibilityRole="button" accessibilityLabel="Export analytics CSV" accessibilityState={{busy:exporting,disabled:exporting}} disabled={exporting} onPress={onExport} style={[ui.button,{backgroundColor:p.primary,flexGrow:desktop?0:1}]}>{exporting?<ActivityIndicator color={p.onPrimary}/>:<Feather name="download" size={18} color={p.onPrimary}/>}<Text style={[ui.buttonText,{color:p.onPrimary}]}>{exporting?'Preparing report...':'Export CSV report'}</Text></MotionPress>}
    </View>
    {!!exportMessage&&isWorkspaceAdmin(role)&&<Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.text}]}>{exportMessage}</Text>}
    <Entrance sessionKey={'reports:'+role+':summary'} delay={55}><View style={{gap:18}}>
      <View style={{gap:5}}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{report.headline}</Text><Text style={[ui.small,{color:p.muted}]}>Counts include the first and last day.</Text></View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{summary.map(item=><View key={item.label} style={[ui.card,card,{flexBasis:desktop?'22%':'45%',flexGrow:1,minWidth:0,minHeight:desktop?190:210,padding:desktop?18:14}]}>
        <View style={[ui.row,{gap:6}]}><View style={{width:26,height:26,backgroundColor:p.wash,borderRadius:8,alignItems:'center',justifyContent:'center'}}><ReportSymbol kind={item.kind} color={item.color}/></View><Text style={[ui.small,{color:p.muted,fontWeight:'600',flexShrink:1}]}>{item.label}</Text></View>
        {item.value===null?<Text style={[ui.statValue,{color:p.text}]}>-</Text>:<CountUp value={item.value} sessionKey={'reports:'+role+':'+item.label} style={[ui.statValue,{color:p.text}]}/>}
        {item.metric==='property'?<Text style={[ui.small,{color:p.muted}]}>{report.propertyAvailable?'As of today':'Property data unavailable'}</Text>:<>
          <MetricSparkline report={report} metric={item.metric} color={item.color} palette={p} motionKey={'reports:'+role+':spark:'+item.metric}/>
          <View style={[ui.row,{gap:6,alignItems:'flex-start'}]}><Feather name={report.comparisons[item.metric].direction==='up'?'arrow-up':report.comparisons[item.metric].direction==='down'?'arrow-down':'minus'} size={14} color={p.muted} style={{marginTop:3}}/><Text style={[ui.small,{color:p.muted,flex:1}]}>{report.deltas[item.metric]}</Text></View>
        </>}
      </View>)}</View>
    </View></Entrance>
    {report.partial&&<Text style={[ui.small,{color:p.muted}]}>Some task data is unavailable. Totals include available tasks.</Text>}
    {!table?<View style={{gap:20,flexDirection:'row',flexWrap:'wrap'}}>{([['Tasks by status','',StatusChart],['Work per day','Tasks recorded each day',LineChart],['Work by type','Number of tasks in each type',QueueChart]] as const).map(([title,note,Chart],i)=><Entrance key={title} sessionKey={'reports:'+role+':'+title} delay={i*55} style={[ui.card,card,{flexBasis:desktop&&i>0?'45%':'100%',flexGrow:1,minWidth:0,padding:desktop?24:16}]}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{title}</Text>{!!note&&<Text style={[ui.small,{color:p.muted}]}>{note}</Text>}{report.available||title==='Work by type'?<Chart report={report} palette={p} motionKey={'reports:'+role+':chart:'+i}/>:<Text style={[ui.body,{color:p.muted}]}>- Task data unavailable.</Text>}</Entrance>)}</View>:<View style={[ui.card,card]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>Tasks in this period</Text>
      <Text style={[ui.small,{color:p.muted}]}>Same numbers as the charts and CSV. Scroll sideways for all columns.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator><View style={{minWidth:Math.max(540,430+metrics.sources.length*125)}}>
        <View style={[ui.row,{backgroundColor:p.elevated,minHeight:48,padding:12,gap:12}]}><Text style={{width:128,color:p.text,fontWeight:'600'}}>Date</Text>{['Tasks','Completed','Waiting',...metrics.sources.map(s=>s.name)].map(name=><Text key={name} style={{width:112,color:p.text,fontWeight:'600',textAlign:'right'}}>{name}</Text>)}</View>
        {metrics.trend.map(day=><View key={day.key} style={[ui.row,{minHeight:48,padding:12,gap:12,borderBottomWidth:1,borderColor:p.border}]}><Text style={{width:128,color:p.text,fontSize:13}}>{day.date}</Text>{[report.available?day.recorded:'-',report.available?day.completed:'-',report.available?day.waiting:'-',...metrics.sources.map(s=>s.available?(day[s.key]||0):'-')].map((value,i)=><Text key={i} style={{width:112,color:p.text,fontSize:13,textAlign:'right',fontVariant:['tabular-nums']}}>{value}</Text>)}</View>)}
      </View></ScrollView>
      <Text style={[ui.small,{color:p.text}]}>Tasks: {report.available?metrics.total:'-'}.</Text>
      <Text style={[ui.small,{color:p.muted}]}>{metrics.status.map(s=>s.name+' '+(report.available?s.value:'-')).join(', ')}.</Text>
      <Text style={[ui.small,{color:p.muted}]}>{report.queues.map(q=>q.name+' '+(q.available?q.value:'- (unavailable)')).join(', ')}.</Text>
    </View>}
    <Text accessibilityLiveRegion="polite" style={[ui.body,{color:p.text}]}>{report.summary}</Text>
    <MotionPress accessibilityRole="switch" accessibilityLabel="Show as table" accessibilityState={{checked:table}} onPress={()=>setTable(value=>!value)} style={[ui.button,card,{borderWidth:1,alignSelf:'flex-start'}]}><Feather name={table?'toggle-right':'toggle-left'} size={22} color={p.primary}/><Text style={[ui.buttonText,{color:p.text}]}>Show as table</Text></MotionPress>
    <Text style={[ui.small,{color:p.muted}]}>{report.comparisonNote}</Text>
  </View>;
}
