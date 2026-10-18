import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { reportPresentation } from '../../lib/report-presentation';
import { periodLabel, presetPeriod, type AnalyticsPeriod, type AnalyticsSnapshot } from '../../lib/analytics';
import { PERIOD_LABEL, periodRange, type PeriodKey } from '../../lib/report-analytics';
import { overviewModel } from '../../lib/report-analytics-models';
import { AnalyticsPanel } from './AnalyticsKit';
import { Pills } from "./Pills";
import { isWorkspaceAdmin, type WorkspaceRole } from '../../lib/modules';
import { Entrance, MotionPress } from './motion';
import { Text } from './Typography';
import { primaryFill, ui, type Palette } from './theme';
import { MyPerformance } from './MyPerformance';
import { TimesheetTab } from './LiveTeamTime';
import { VaPayPanel } from './VaPay';
import { useToolTitled } from './ToolPage';
import type { WorkspaceAccount } from '../../lib/workspace-account-policy';
import type { OperationView } from '../../lib/workflow-forms';
// The team's "My performance" page: the person's own numbers first (when the host passes `account`), then the
// task trends within their access (admins can still export them). Without `account` it is the plain reports page.
// In the admins' Reports hub (ReportsHub.tsx) each half is a report of its own: `part` "mine" is My performance and
// "trends" the Business overview, and the hub's page heading stands in for this one's.
const OVERVIEW_PERIODS:readonly PeriodKey[]=['30d','90d','12m','custom'];
export function Reports({snapshot,period,role,palette:p,onDates,onPeriod,onExport,exporting,exportMessage,account:person,work,part='all'}:{snapshot:AnalyticsSnapshot;period:AnalyticsPeriod;role:WorkspaceRole;palette:Palette;onDates:()=>void;onPeriod?:(period:AnalyticsPeriod)=>void;onExport:()=>void;exporting:boolean;exportMessage:string;account?:WorkspaceAccount;work?:OperationView[];part?:'all'|'mine'|'trends'}) {
  const titled=useToolTitled(),account=part==='trends'?undefined:person,trends=part!=='mine';
  const report=useMemo(()=>reportPresentation(snapshot,period),[snapshot,period]);
  const {width}=useWindowDimensions(),desktop=width>=1024;
  const [table,setTable]=useState(false),metrics=report.current,card={backgroundColor:p.surface,borderColor:p.border};
  const today=presetPeriod(1).to;
  const chosen=OVERVIEW_PERIODS.find(k=>k!=='custom'&&periodRange(k,today).from===period.from&&periodRange(k,today).to===period.to)??'custom';
  const model=overviewModel(report.current,report.previous,report.available,period,`vs the previous ${report.duration} ${report.duration===1?'day':'days'}`,snapshot.propertyLabel||'Properties');
  return <View style={{gap:24}}>
    {!titled&&<Entrance sessionKey={'reports:'+role+':heading'}><View style={{gap:8}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>{account?'My performance':snapshot.title}</Text><Text style={[ui.body,{color:p.muted}]}>{account?'Your own numbers: replies, tasks done, time worked and your bonus tier.':snapshot.description}</Text></View></Entrance>}
    {account&&<MyPerformance palette={p} account={account} work={work} page/>}
    {account&&account.role!=='client'&&<View style={{gap:12}}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>My timesheet</Text><TimesheetTab p={p} account={account}/></View>}
    {/* VA pay (20261022200000): a VA's own requests for invoice; the database answers nothing to anyone else. */}
    {account&&account.role!=='client'&&<VaPayPanel p={p} account={account} place="mine"/>}
    {account&&trends&&<View style={{gap:4}}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{snapshot.title}</Text><Text style={[ui.small,{color:p.muted}]}>{snapshot.description}</Text></View>}
    {trends&&<>
    <View style={[ui.row,{gap:12,flexWrap:'wrap'}]}>
      <MotionPress accessibilityRole="button" accessibilityLabel="Choose analytics date range" onPress={onDates} style={[ui.button,card,{borderWidth:1,flexGrow:desktop?0:1,gap:10}]}><Feather name="calendar" size={18} color={p.primary}/><Text style={[ui.small,{color:p.text,flexShrink:1,fontWeight:'600'}]}>{periodLabel(period)}</Text><Feather name="chevron-down" size={16} color={p.muted}/></MotionPress>
      {isWorkspaceAdmin(role)&&<MotionPress accessibilityRole="button" accessibilityLabel="Export analytics CSV" accessibilityState={{busy:exporting,disabled:exporting}} disabled={exporting} onPress={onExport} {...(Platform.OS==='web'?{dataSet:{sheen:''}}:{})} style={[ui.button,primaryFill(p),{flexGrow:desktop?0:1}]}>{exporting?<ActivityIndicator color={p.onPrimary}/>:<Feather name="download" size={18} color={p.onPrimary}/>}<Text style={[ui.buttonText,{color:p.onPrimary}]}>{exporting?'Preparing report...':'Export CSV report'}</Text></MotionPress>}
    </View>
    {!!exportMessage&&isWorkspaceAdmin(role)&&<Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.text}]}>{exportMessage}</Text>}
    {/* The analytics (Lee: "Every reporting should have an analytics"): headline figures against the previous period of the
        same length, the trend, the status mix and the work by type, drawn by the shared kit (AnalyticsKit.tsx). */}
    <AnalyticsPanel p={p} model={model} title={report.headline} caption={`${periodLabel(period)}. Counts include the first and last day. ${report.comparisonNote}`}
      controls={onPeriod?<Pills p={p} title="Period" values={OVERVIEW_PERIODS} value={chosen} onChange={k=>k==='custom'?onDates():onPeriod(periodRange(k,today))} label={k=>PERIOD_LABEL[k]}/>:undefined}/>
    {report.partial&&<Text style={[ui.small,{color:p.muted}]}>Some task data is unavailable. Totals include available tasks.</Text>}
    {table&&<View style={[ui.card,card]}>
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
    </>}
  </View>;
}
