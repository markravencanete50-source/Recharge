import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View, useWindowDimensions } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { reportPresentation } from '../../lib/report-presentation';
import { periodLabel, type AnalyticsPeriod, type AnalyticsSnapshot } from '../../lib/analytics';
import { isWorkspaceAdmin, type WorkspaceRole } from '../../lib/modules';
import { LineChart, StatusChart, QueueChart } from './Charts';
import { CountUp, Entrance, MotionPress } from './motion';
import { FilterBar } from './FilterBar';
import { Text } from './Typography';
import { ui, type Palette } from './theme';
export function Reports({snapshot,period,role,palette:p,onDates,onExport,exporting,exportMessage}:{snapshot:AnalyticsSnapshot;period:AnalyticsPeriod;role:WorkspaceRole;palette:Palette;onDates:()=>void;onExport:()=>void;exporting:boolean;exportMessage:string}) {
  const report=useMemo(()=>reportPresentation(snapshot,period),[snapshot,period]);
  const [view,setView]=useState('Chart'); const {width}=useWindowDimensions();
  const metrics=report.current, card={backgroundColor:p.surface,borderColor:p.border};
  const summary=[{label:'Recorded items',value:report.available?metrics.total:null,note:report.deltas.total},{label:'Completed',value:report.available?metrics.complete:null,note:report.deltas.complete},{label:'Waiting',value:report.available?metrics.waiting:null,note:report.deltas.waiting},{label:snapshot.propertyLabel,value:snapshot.propertyCount,note:'Current property snapshot'}];
  return <View style={{gap:24}}>
    <Entrance sessionKey={'reports:'+role+':heading'}><View style={{gap:8}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>{snapshot.title}</Text><Text style={[ui.body,{color:p.muted}]}>{snapshot.description}</Text></View></Entrance>
    <View style={[ui.row,{gap:12,flexWrap:'wrap'}]}>
      <MotionPress accessibilityRole="button" accessibilityLabel="Choose analytics date range" onPress={onDates} style={[ui.button,card,{borderWidth:1,flexGrow:1,gap:10}]}><Feather name="calendar" size={18} color={p.primary}/><Text style={[ui.small,{color:p.text,flexShrink:1,fontWeight:'600'}]}>{periodLabel(period)}</Text><Feather name="chevron-down" size={16} color={p.muted}/></MotionPress>
      {isWorkspaceAdmin(role)&&<MotionPress accessibilityRole="button" accessibilityLabel="Export analytics CSV" accessibilityState={{busy:exporting,disabled:exporting}} disabled={exporting} onPress={onExport} style={[ui.button,{backgroundColor:p.primary,flexGrow:1}]}>{exporting?<ActivityIndicator color={p.onPrimary}/>:<Feather name="download" size={18} color={p.onPrimary}/>}<Text style={[ui.buttonText,{color:p.onPrimary}]}>{exporting?'Preparing report...':'Export CSV report'}</Text></MotionPress>}
    </View>
    {!!exportMessage&&isWorkspaceAdmin(role)&&<Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.text}]}>{exportMessage}</Text>}
    <Text style={[ui.small,{color:p.muted}]}>Sample records within your access. UK calendar dates, both dates included.</Text>
    <Entrance sessionKey={'reports:'+role+':summary'} delay={55}><View style={{gap:18}}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{report.headline}</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{summary.map(item=><View key={item.label} style={[ui.card,card,{flexBasis:width>=1100?'22%':'45%',flexGrow:1,minHeight:150}]}><Text style={[ui.small,{color:p.muted,fontWeight:'600'}]}>{item.label}</Text>{item.value===null?<Text style={[ui.statValue,{color:p.text}]}>-</Text>:<CountUp value={item.value} sessionKey={'reports:'+role+':'+item.label} style={[ui.statValue,{color:p.text}]}/>}<Text style={[ui.small,{color:p.muted}]}>{item.note}</Text></View>)}</View><Text style={[ui.small,{color:p.muted}]}>{report.comparisonNote}</Text></View></Entrance>
    {report.partial&&<View style={[ui.card,{backgroundColor:p.cautionWash,borderColor:p.border}]}><Text style={[ui.body,{color:p.text}]}>Some permitted sources are not connected. Their values are shown as a dash and excluded from totals.</Text></View>}
    <FilterBar values={['Chart','Table']} selected={view} onSelect={setView} palette={p}/>
    {view==='Chart'?<View style={{gap:20,flexDirection:width>=1100?'row':'column',flexWrap:'wrap'}}>
      {([['Activity over time','Daily recorded items',LineChart],['Work status','Current status in the selected period',StatusChart],['Queue volume','Highest volume first',QueueChart]] as const).map(([title,note,Chart],i)=><Entrance key={title} sessionKey={'reports:'+role+':'+title} delay={i*55} style={[ui.card,card,{flexGrow:1,flexBasis:width>=1100?'46%':undefined,minWidth:0}]}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{title}</Text><Text style={[ui.small,{color:p.muted}]}>{note}</Text>{report.available?<Chart data={metrics} palette={p} motionKey={'reports:'+role+':chart:'+i}/>:<Text style={[ui.body,{color:p.muted}]}>No connected source for this chart.</Text>}</Entrance>)}
    </View>:<View style={[ui.card,card]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>Exact report data</Text><Text style={[ui.small,{color:p.muted}]}>Same dates and records as your CSV export. Scroll sideways for all sources.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator><View style={{minWidth:Math.max(450,140+metrics.sources.length*125)}}>
        <View style={[ui.row,{backgroundColor:p.elevated,minHeight:48,padding:12,gap:12}]}><Text style={{width:128,color:p.text,fontWeight:'600'}}>Date</Text>{metrics.sources.map(s=><Text key={s.key} style={{width:112,color:p.text,fontWeight:'600',textAlign:'right'}}>{s.name}</Text>)}</View>
        {metrics.trend.map(day=><View key={day.key} style={[ui.row,{minHeight:48,padding:12,gap:12,borderBottomWidth:1,borderColor:p.border}]}><Text style={{width:128,color:p.text,fontSize:13}}>{day.date}</Text>{metrics.sources.map(s=><Text accessibilityLabel={day.date+', '+s.name+': '+(s.available?(day[s.key]||0):'not connected')} key={s.key} style={{width:112,color:p.text,fontSize:13,textAlign:'right'}}>{s.available?(day[s.key]||0):'-'}</Text>)}</View>)}
      </View></ScrollView>
      <Text style={[ui.small,{color:p.muted}]}>Status totals: {metrics.status.map(s=>s.name+' '+(report.available?s.value:'-')).join(', ')}.</Text>
      <Text style={[ui.small,{color:p.muted}]}>Queue totals: {report.queues.map(q=>q.name+' '+(q.available?q.value:'not connected')).join(', ')}.</Text>
    </View>}
    <View style={[ui.card,card]}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>Source coverage</Text>{metrics.sources.map(s=><View key={s.key} style={[ui.between,{gap:12,minHeight:44}]}><Text style={[ui.small,{color:p.text,flex:1}]}>{s.name}</Text><Text style={[ui.small,{color:p.muted}]}>{s.available?'Available':'Not connected'}</Text></View>)}<Text style={[ui.small,{color:p.muted}]}>Counts use current source snapshots. Linked records can appear in more than one queue. Property counts are a current snapshot, not a period trend.</Text></View>
  </View>;
}
