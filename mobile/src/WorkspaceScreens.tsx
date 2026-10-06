import { Text, FontsReady } from "./Typography";
import {
  useMemo,
  useContext,
  useState,
  useEffect,
  type ComponentProps,
} from "react";
import {
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Artwork, FeatureTile } from "./Artwork";
import { ClientPropertyProgress, EnquiryCard, EnquirySheet, JumpBackIn, QuickOverview, WelcomeHeader } from "./HomeOverview";
import { clientPortfolio } from "./clientPortfolio";
import { CleanJobSheet, CleanerPerformance, CleansToApprove, DailyRoutine, QuickAccess, RepairPipeline, TeamInbox, TrainingCentre } from "./TeamFlows";

// Each role gets its own line under the greeting.
const HOME_SUBTITLE: Record<string, string> = {
  super_admin: "Here is what needs you across the business today.",
  admin: "Here is what needs you across the business today.",
  stays: "Your guests, listings and bookings at a glance.",
  ready: "Your inspections, repairs and orders for today.",
  cleans: "Your cleans, schedule and updates in one place.",
  cleaning_manager: "Your team's cleans and quality checks today.",
  client: "Here is how your properties are doing today.",
};
import { FilterBar } from "./FilterBar";
import { StateGraphic } from "./StateGraphic";
import { Entrance, CountUp, SlidingPill, MotionPress as Pressable, useReducedMotion } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import {
  approvalItems,
  inboxFor,
  isComplete,
  isWaiting,
  propertiesFor,
  toolsFor,
  workFor,
  type PreviewRecord,
  type Tool,
  type ModuleId,
  type WorkspaceRole,
  type WorkItem,
} from "./model";
import {
  calendarCells,
  WORKSPACE_MAP,
  type WorkspaceSection,
} from "../../lib/workspace-map";
import { presetPeriod, periodLabel } from "../../lib/analytics";
import { scheduleWeek, scheduleWeekLabel, moveScheduleDay, fullScheduleDate } from "../../lib/schedule-presentation";
import { HeroGlow, TodayRing, TodayTiles, OpenTasksTrend } from "./TodayAnalytics";
import { todayPresentation, todayColors } from "../../lib/today-presentation";
import type { AnalyticsSnapshot, AnalyticsPeriod } from "../../lib/analytics";
import { DepartmentGrid } from "./DepartmentGrid";
import { BuildingGlyph } from "./BuildingGlyph";
import { orderedPins } from "../../lib/pinned-tools";
import { type PersonalActivity } from '../../lib/recent-activity';
import { RecentActivity } from './AccessHelp';

type IconName = ComponentProps<typeof Feather>["name"];
type Props = {
  section: WorkspaceSection;
  role: WorkspaceRole;
  palette: Palette;
  onNavigate: (section: WorkspaceSection) => void;
  onOpen: (tool: Tool, record?: PreviewRecord) => void;
  onProfile: () => void;
  onDepartment: (department: string) => void;
  savedTools: string[];
  profileName: string;
  activity?: PersonalActivity[];
  activityError?: string;
  analyticsSnapshot: AnalyticsSnapshot;
  analyticsPeriod: AnalyticsPeriod;
};

const hoverTint = Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {};
const hoverLift = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};

function displayDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "No date set";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PropertyScene({
  palette: p,
  variant,
}: {
  palette: Palette;
  variant: number;
}) {
  return (
    <View
      accessible={false}
      style={{
        width: 92,
        height: 100,
        backgroundColor: p.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: p.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <BuildingGlyph palette={p} variant={variant}/>
    </View>
  );
}

function LinkRow({
  title,
  subtitle,
  icon,
  toolId,
  palette: p,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  toolId?: ModuleId;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      {...hoverTint}
      accessibilityRole="button"
      onPress={onPress}
      style={[ui.row, { gap: 14, minHeight: 68, paddingVertical: 12, paddingHorizontal: 12, marginHorizontal: -12, borderRadius: 18 }]}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {toolId ? (
          <Artwork id={toolId} size={44} palette={p} />
        ) : (
          <FeatureTile icon={icon || "grid"} size={44} palette={p} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[ui.small, { color: p.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={p.muted} />
    </Pressable>
  );
}
export function WorkRow({
  item,
  palette: p,
  onPress,
}: {
  item: WorkItem;
  palette: Palette;
  onPress: () => void;
}) {
  const tone = departmentColor(WORKSPACE_MAP[item.tool.id].tone, p);
  const done = isComplete(item.record.status), waiting = isWaiting(item.record.status);
  const status = done
    ? { icon: "check-circle" as const, ink: p.success, wash: p.successWash }
    : waiting
      ? { icon: "clock" as const, ink: p.waiting, wash: p.cautionWash }
      : { icon: "activity" as const, ink: p.primary, wash: p.wash };
  return (
    <Pressable
      {...hoverTint}
      accessibilityRole="button"
      accessibilityLabel={`${item.record.title}, ${item.tool.name}, ${item.record.status.replaceAll("_", " ")}`}
      onPress={onPress}
      style={[ui.row, { gap: 14, paddingVertical: 14, paddingHorizontal: 12, marginHorizontal: -12, borderRadius: 18 }]}
    >
      <View style={{ backgroundColor: tone.wash, width: 48, height: 48, borderRadius: 16, justifyContent: "center", alignItems: "center" }}>
        <Artwork id={item.tool.id} size={44} palette={p} />
      </View>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>
          {item.record.title}
        </Text>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{item.tool.name}</Text>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap", marginTop: 2 }]}>
          <View style={[ui.row, { backgroundColor: status.wash, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, gap: 5 }]}>
            <Feather name={status.icon} size={12} color={status.ink} />
            <Text style={{ fontSize: 12, lineHeight: 18, color: p.text, fontWeight: "600", textTransform: "capitalize" }}>
              {item.record.status.replaceAll("_", " ")}
            </Text>
          </View>
          <Text style={{ fontSize: 12, lineHeight: 18, color: p.muted }}>
            {displayDate(item.record.date)}
          </Text>
        </View>
      </View>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.elevated, alignItems: "center", justifyContent: "center" }}>
        <Feather name="chevron-right" size={16} color={p.text} />
      </View>
    </Pressable>
  );
}
function Empty({
  title,
  detail,
  palette: p,
  icon = "check-circle",
}: {
  title: string;
  detail: string;
  palette: Palette;
  icon?: IconName;
}) {
  return (
    <View
      style={[
        ui.card,
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          alignItems: "center",
          paddingVertical: 30,
        },
      ]}
    >
      <StateGraphic palette={p} success={icon === "check-circle"} icon={icon} />
      <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>
        {title}
      </Text>
      <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>
        {detail}
      </Text>
    </View>
  );
}
function Chips({
  values,
  selected,
  onSelect,
  palette: p,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
  palette: Palette;
}) {
  return (
    <FilterBar
      values={values}
      selected={selected}
      onSelect={onSelect}
      palette={p}
    />
  );
}
function WeekStrip({selected,onSelect,palette:p,items}:{selected:string;onSelect:(date:string)=>void;palette:Palette;items:WorkItem[]}) {
  const {width}=useWindowDimensions(),[gridWidth,setGridWidth]=useState(0);
  const gap=width<400?4:width<=600?6:8, days=scheduleWeek(selected), today=presetPeriod(1).to;
  const selectedIndex=days.indexOf(selected), stride=(gridWidth+gap)/7;
  const webGrid=Platform.OS==='web'?{display:'grid',gridTemplateColumns:'repeat(7, minmax(0, 1fr))',columnGap:gap} as unknown as ViewStyle:{};
  return <View onLayout={event=>setGridWidth(event.nativeEvent.layout.width)} {...(Platform.OS==='web'?{dataSet:{scheduleWeek:'true'}}:{})} style={[{flexDirection:'row',gap,marginHorizontal:gap/2,maxWidth:520-gap},webGrid]}>
    <SlidingPill x={selectedIndex*stride} width={Math.max(0,stride-gap)} height={72} color={p.hero} visible={gridWidth>0}/>
    {days.map(key=>{const active=key===selected,hasTasks=items.some(item=>item.record.date===key);return <View key={key} style={{flex:1,minWidth:0}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Schedule for ${fullScheduleDate(key)}${key===today?', today':''}${hasTasks?', has tasks':''}`} accessibilityState={{selected:active}} onPress={()=>onSelect(key)} style={{minHeight:72,marginHorizontal:-gap/2,alignItems:'center',justifyContent:'center',gap:5}}>
        <View pointerEvents="none" style={{position:'absolute',top:0,bottom:0,left:gap/2,right:gap/2,borderRadius:999,borderWidth:active?0:key===today?1.5:1,borderColor:key===today?p.primary:p.border,backgroundColor:active?'transparent':p.surface}}/>
        <Text style={{color:active?p.heroText:p.muted,fontSize:12,fontWeight:'500'}}>{new Date(key+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}).slice(0,2)}</Text>
        <Text style={{color:active?p.heroText:p.text,fontSize:16,fontWeight:'600',fontVariant:['tabular-nums']}}>{Number(key.slice(-2))}</Text>
        <View style={{width:4,height:4,borderRadius:2,backgroundColor:hasTasks?active?p.heroText:p.primary:'transparent'}}/>
      </Pressable>
    </View>;})}
  </View>;
}
export function Calendar({
  selected,
  onSelect,
  palette: p,
  items,
}: {
  selected: string;
  onSelect: (value: string) => void;
  palette: Palette;
  items?: WorkItem[];
}) {
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [gridWidth,setGridWidth]=useState(0);
  const selectedCell=calendarCells(month).findIndex(day=>day===selected);
  useEffect(()=>{queueMicrotask(()=>setMonth(selected.slice(0,7)));},[selected]);
  const moveMonth = (step: number) => {
    const date = new Date(`${month}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
  };
  const dates = new Set((items || []).map((item) => item.record.date));
  return (
    <View
      style={[
        ui.card,
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          paddingHorizontal: width < 350 ? 4 : 16,
          marginHorizontal: width < 350 ? -20 : 0,
        },
      ]}
    >
      <View style={ui.between}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => moveMonth(-1)}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
        >
          <Feather name="chevron-left" size={18} color={p.text} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: "700", letterSpacing: -0.3, color: p.text }}>
          {new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => moveMonth(1)}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
        >
          <Feather name="chevron-right" size={18} color={p.text} />
        </Pressable>
      </View>
      <View style={ui.row}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <Text
            key={index}
            style={{
              width: "14.2857%",
              textAlign: "center",
              fontSize: 11,
              fontWeight: "600",
              letterSpacing: 1,
              color: p.muted,
              paddingVertical: 8,
            }}
          >
            {day}
          </Text>
        ))}
      </View>
      <View onLayout={event=>setGridWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {/* A day-sized circle, centred in its cell, rather than a cell-wide bar. */}
        <SlidingPill x={Math.max(0,selectedCell)%7*gridWidth/7+(gridWidth/7-44)/2} y={Math.floor(Math.max(0,selectedCell)/7)*48+2} width={44} height={44} color={p.primary} visible={selectedCell>=0&&gridWidth>0}/>
        {calendarCells(month).map((day, index) => (
          <View
            key={day || `blank-${index}`}
            style={{ width: "14.2857%", minHeight: 48 }}
          >
            {day ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${day}${items ? (dates.has(day) ? ", has work" : ", no work") : ""}`}
                accessibilityState={{ selected: selected === day }}
                onPress={() => onSelect(day)}
                style={{
                  width: 44,
                  height: 44,
                  marginTop: 2,
                  alignSelf: "center",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 22,
                  borderWidth:day===presetPeriod(1).to&&selected!==day?1.5:0,
                  borderColor:p.primary,
                  backgroundColor: "transparent",
                  gap: 2,
                }}
              >
                <Text
                  style={{
                    color: selected === day ? p.onPrimary : p.text,
                    fontSize: 15,
                    fontWeight: selected === day ? "700" : "400",
                  }}
                >
                  {Number(day.slice(-2))}
                </Text>
                <View
                  style={{
                    height: 4,
                    width: 4,
                    borderRadius: 2,
                    backgroundColor: dates.has(day)
                      ? selected === day
                        ? p.onPrimary
                        : p.primary
                      : "transparent",
                  }}
                />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function WorkspaceScreens({
  section,
  role,
  palette: p,
  onNavigate,
  onOpen,
  onProfile,
  onDepartment,
  savedTools,
  profileName,
  activity=[],
  activityError='',
  analyticsSnapshot,
  analyticsPeriod,
}: Props) {
  const items = useMemo(() => workFor(role), [role]);
  const {width}=useWindowDimensions();
  const desktop=width>=1024;
  const fontsReady=useContext(FontsReady);
  const [compactFilters,setCompactFilters]=useState(false);
  const homeTone=todayColors[p.isDark?"dark":"light"];
  const today=useMemo(()=>todayPresentation(analyticsSnapshot,analyticsPeriod),[analyticsSnapshot,analyticsPeriod]);
  const properties = useMemo(() => propertiesFor(role), [role]);
  const [query, setQuery] = useState("");
  const [propertyQuery, setPropertyQuery] = useState("");
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [cleanJob, setCleanJob] = useState<WorkItem | null>(null);
  const [team, setTeam] = useState("Everyone");
  const client = useMemo(() => clientPortfolio(), []);
  const [filter, setFilter] = useState("Active");
  const [homeDate, setHomeDate] = useState(() => presetPeriod(1).to);
  const [date, setDate] = useState(() => presetPeriod(1).from);
  const [view, setView] = useState("List");
  const [selectedProperty, setSelectedProperty] = useState<
    (typeof properties)[number] | null
  >(null);
  const [pendingTool, setPendingTool] = useState<Tool | null>(null);
  const openPropertyTool = (tool: Tool) => {
    if (Platform.OS === "ios") setPendingTool(tool);
    setSelectedProperty(null);
    if (Platform.OS !== "ios") onOpen(tool);
  };
  const reduced = useReducedMotion();
  const pending = items.filter((item) => !isComplete(item.record.status));
  const inbox = inboxFor(role);
  const card = { backgroundColor: p.surface, borderColor: p.border };
  const searchQuery = section === "properties" ? propertyQuery : query;
  const updateQuery = section === "properties" ? setPropertyQuery : setQuery;
  const openQueue = (status = "Active") => {
    setQuery("");
    setFilter(status);
    setView("List");
    onNavigate("work");
  };
  const heading = (title: string, subtitle: string) => (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>
        {title}
      </Text>
      <Text style={[ui.body, { color: p.muted }]}>{subtitle}</Text>
    </View>
  );
  const search = (placeholder: string) => (
    <View
      {...(Platform.OS==="web"?{dataSet:{searchShell:"true"}}:{})}
      style={[
        ui.row,
        {
          borderRadius: 14,
          minHeight: 50,
          borderWidth: 1,
          borderColor: p.controlBorder,
          paddingHorizontal: 14,
          backgroundColor: p.surface,
          gap: 10,
        },
      ]}
    >
      <Feather name="search" size={18} color={p.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={p.muted}
        value={searchQuery}
        onChangeText={updateQuery}
        autoCorrect={false}
        style={{
          flex: 1,
          color: p.text,
          fontSize: 15,
          fontFamily: "Montserrat_400Regular",
          minHeight: 48,
        }}
      />
      {searchQuery ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          onPress={() => updateQuery("")}
          style={{
            minHeight: 48,
            width: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="x" color={p.text} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
  const openRow = (item: WorkItem) => (
    <WorkRow
      key={`${item.tool.id}:${item.record.id}`}
      item={item}
      palette={p}
      onPress={() => role === "cleans" && item.tool.id === "cleaning-schedule" ? setCleanJob(item) : onOpen(item.tool, item.record)}
    />
  );
  const saved = orderedPins(toolsFor(role).map(tool=>({key:tool.id,name:tool.name,tone:WORKSPACE_MAP[tool.id].tone,tool})),savedTools).map(entry=>entry.tool);


  if(section==='work'||section==='calendar') {
    const calendarView=section==='calendar'||view==='Calendar';
    const teamItems=calendarView&&team!=='Everyone'?items.filter(item=>WORKSPACE_MAP[item.tool.id].tone===team.toLowerCase()):items;
    const results=teamItems.filter(item=>(item.record.title+' '+(item.record.propertyName||'')).toLowerCase().includes(query.trim().toLowerCase())).filter(item=>calendarView?item.record.date===date:filter==='All'||(filter==='Completed'?isComplete(item.record.status):filter==='Waiting'?isWaiting(item.record.status):!isComplete(item.record.status)));
    return <ScrollView testID="workspace-scroll" style={{flex:1}} stickyHeaderIndices={[1]} onScroll={event=>setCompactFilters(event.nativeEvent.contentOffset.y>90)} scrollEventThrottle={32} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={Platform.OS==='web'} contentContainerStyle={{width:'100%',maxWidth:desktop?1400:760,alignSelf:'center',paddingBottom:112}}>
      <Entrance sessionKey={'work:'+role+':heading'} style={{padding:20,gap:16}}>{heading(role==='cleans'?'Your jobs':'Your work','Find the next action, then keep things moving.')}<Chips values={['List','Calendar']} selected={calendarView?'Calendar':'List'} onSelect={value=>{setView(value);if(section==='calendar'&&value==='List')onNavigate('work');}} palette={p}/></Entrance>
      <View style={{gap:8,paddingHorizontal:20,paddingVertical:compactFilters?8:16,backgroundColor:p.background,borderBottomWidth:compactFilters?1:0,borderColor:p.border}}>{search('Search job or property titles')}{!calendarView&&<Chips values={['Active','Waiting','Completed','All']} selected={filter} onSelect={setFilter} palette={p}/>}</View>
      <View style={{padding:20,gap:20}}>
        {calendarView&&<><WeekStrip selected={date} onSelect={setDate} items={teamItems} palette={p}/><Calendar selected={date} onSelect={setDate} items={teamItems} palette={p}/><View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>{displayDate(date)}</Text><Pressable accessibilityRole="button" accessibilityLabel="Return to today" onPress={()=>setDate(presetPeriod(1).to)} style={[ui.button,{backgroundColor:p.wash}]}><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>Today</Text></Pressable></View></>}
        {!calendarView&&filter==='Active'&&(role==='stays'||role==='admin'||role==='super_admin')&&<><DailyRoutine palette={p} tools={toolsFor(role)} onOpen={tool=>onOpen(tool)}/><CleansToApprove palette={p}/></>}
        {calendarView&&role!=='cleans'&&role!=='client'&&<View style={{gap:8}}><Text style={[ui.small,{color:p.muted,fontWeight:'600'}]}>Show the schedule for</Text><Chips values={['Everyone','Stays','Ready','Cleans']} selected={team} onSelect={setTeam} palette={p}/></View>}
        <Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.muted}]}>{results.length} {results.length===1?'item':'items'} within your access</Text>
        <Entrance trigger={calendarView?date:filter} style={{gap:12}}>{results.length?(!calendarView&&filter==='Active'?(()=>{const todayKey=presetPeriod(1).to;const due=results.filter(item=>(item.record.date||'9999')<=todayKey),ongoing=results.filter(item=>(item.record.date||'9999')>todayKey);return <>{!!due.length&&<View style={{gap:8}}><Text accessibilityRole="header" style={{color:p.text,fontSize:15,fontWeight:'700'}}>Due today or overdue · {due.length}</Text><View style={[ui.card,card,{paddingVertical:6,gap:0}]}>{due.map(openRow)}</View></View>}{!!ongoing.length&&<View style={{gap:8}}><Text accessibilityRole="header" style={{color:p.text,fontSize:15,fontWeight:'700'}}>Ongoing · {ongoing.length}</Text><View style={[ui.card,card,{paddingVertical:6,gap:0}]}>{ongoing.map(openRow)}</View></View>}</>;})():<View style={[ui.card,card,{paddingVertical:6,gap:0}]}>{results.map(openRow)}</View>):<View style={{gap:12}}><Empty title="No work in this view" detail="Try another status, search or calendar date." palette={p}/><Pressable accessibilityRole="button" onPress={()=>{setQuery('');setFilter('All');setDate(presetPeriod(1).to);}} style={[ui.button,{backgroundColor:p.wash}]}><Text style={[ui.buttonText,{color:p.text}]}>Reset work filters</Text></Pressable></View>}</Entrance>
      </View>
      <CleanJobSheet palette={p} visible={!!cleanJob} onClose={()=>setCleanJob(null)} property={cleanJob?.record.propertyName||cleanJob?.record.title||''} guests={2}/>
    </ScrollView>;
  }
  return (
    <>
      {section === "home" ? (
        <>
          {(role==="client"||!desktop)&&<WelcomeHeader
            palette={p}
            name={profileName}
            dateLabel={displayDate(presetPeriod(1).to).replace(/ \d{4}$/, "")}
            subtitle={HOME_SUBTITLE[role]}
            onCalendar={() => onNavigate("calendar")}
          />}
          {role==="client"&&<>
            <QuickOverview
              palette={p}
              columns={desktop?4:2}
              sessionKey={"home:client:overview"}
              onReports={() => onNavigate("analytics")}
              items={[
                { key: "properties", icon: "house", value: client.properties.length, label: "Properties", hint: "Open your properties", onPress: () => onNavigate("properties") },
                { key: "approvals", icon: "clipboard", value: approvalItems(role).length, label: "To approve", hint: "Open approvals", onPress: () => onNavigate("approvals") },
                { key: "messages", icon: "chat", value: inboxFor(role).filter(item => ["new", "unread"].includes(item.record.status)).length, label: "New messages", hint: "Open your inbox", onPress: () => onNavigate("inbox") },
                { key: "earnings", icon: "coins", value: Math.round(client.earningsMinor / 100), prefix: "£", label: "Earned this month", hint: "Open reports", onPress: () => onNavigate("analytics") },
              ]}
            />
            <EnquiryCard palette={p} onStart={() => setEnquiryOpen(true)}/>
            <ClientPropertyProgress palette={p} properties={client.properties} onOpen={() => onNavigate("properties")}/>
            <LinkRow title="All tools" subtitle="Documents, quotes, maintenance and more for your properties" icon="grid" palette={p} onPress={() => onNavigate("more")}/>
            <EnquirySheet palette={p} visible={enquiryOpen} onClose={() => setEnquiryOpen(false)}/>
          </>}
          {role!=="client"&&!desktop&&<QuickAccess palette={p} role={role} tools={toolsFor(role)} onOpen={tool=>onOpen(tool)} onAll={()=>onNavigate("more")}/>}
          {role!=="client"&&<View testID="home-task-summary" style={{flexDirection:desktop?'row':'column',gap:20,alignItems:'stretch'}}>
          <Entrance sessionKey={"home:"+role+":hero"} style={desktop?{flex:2,minWidth:0}:undefined}>
            <View
              style={{
                borderRadius: 30,
                padding: desktop?28:20,
                gap: desktop?22:18,
                overflow: "hidden",
                ...(Platform.OS==="web"?{boxShadow:"0 30px 60px -32px rgba(16, 39, 31, 0.6)"}:{elevation:6}),
              }}
            >
              <HeroGlow palette={p}/>
              {desktop&&<>
              <View style={[ui.between,{gap:12}]}>
                <Text style={{color:homeTone.heroMuted,fontSize:13,fontWeight:"500",flex:1}}>
                  {new Date().getHours() < 12
                    ? "Good morning"
                    : new Date().getHours() < 18
                      ? "Good afternoon"
                      : "Good evening"}
                  , {profileName.split(" ")[0]}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open calendar"
                  onPress={() => onNavigate("calendar")}
                  style={[ui.row,{minHeight:40,gap:7,paddingHorizontal:12,borderRadius:999,backgroundColor:homeTone.chipBg,borderWidth:1,borderColor:homeTone.heroBorder}]}
                >
                  <Feather name="calendar" size={14} color={homeTone.heroText} />
                  <Text style={{ color: homeTone.heroText, fontSize: 13, fontWeight: "600" }}>
                    {displayDate(presetPeriod(1).to).replace(/ \d{4}$/, "")}
                  </Text>
                </Pressable>
              </View>
              <View style={{gap:6,marginTop:-6}}>
                <Text accessibilityRole="header" style={[ui.title,{color:homeTone.heroText,fontSize:desktop?38:30,lineHeight:desktop?44:36}]}>
                  Let&apos;s make progress.
                </Text>
                <Text style={[ui.body,{color:homeTone.heroMuted}]}>
                  {HOME_SUBTITLE[role]}
                </Text>
              </View>
              <View style={[ui.row, { gap: 18, paddingTop: 4 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{color:homeTone.heroMuted,fontSize:12,fontWeight:"600",letterSpacing:1.2,textTransform:"uppercase"}}>Open tasks</Text>
                  <View style={[ui.row,{gap:10,alignItems:"flex-end"}]}>
                    <CountUp value={today.open} sessionKey={"overview:"+role+":pending:"+analyticsPeriod.from+":"+analyticsPeriod.to}
                      style={{color:homeTone.heroText,fontSize:desktop?60:48,lineHeight:desktop?66:54,fontWeight:"700",letterSpacing:-2.4}}
                    />
                    <Text style={{color:homeTone.heroMuted,fontSize:14,lineHeight:21,paddingBottom:desktop?10:8}}>tasks open</Text>
                  </View>
                  <Text style={{color:homeTone.heroMuted,fontSize:12,lineHeight:18}}>{periodLabel(analyticsPeriod)}</Text>
                </View>
                <TodayRing palette={p} size={desktop?116:92} motionKey={"overview:"+role+":ring:"+analyticsPeriod.from+":"+analyticsPeriod.to}
                  completed={today.current.complete} total={today.current.total}/>
              </View>
              </>}
              <OpenTasksTrend palette={p} wide={desktop} data={today} motionKey={"overview:"+role+":trend:"+analyticsPeriod.to}/>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open your work queue"
                onPress={() => openQueue()}
                style={[ui.between,{minHeight:52,paddingHorizontal:18,borderRadius:18,backgroundColor:homeTone.heroText}]}
              >
                <Text style={{ color: homeTone.heroStart, fontSize: 14, fontWeight: "700" }}>
                  View all tasks
                </Text>
                <View style={{width:32,height:32,borderRadius:16,alignItems:"center",justifyContent:"center",backgroundColor:homeTone.heroStart}}>
                  <Feather name="arrow-right" size={17} color={homeTone.heroText} />
                </View>
              </Pressable>
            </View>
          </Entrance>
          {desktop&&<TodayTiles vertical={desktop} data={today} palette={p} onWaiting={()=>openQueue("Waiting")} onProperties={()=>onNavigate("properties")}>
            <JumpBackIn palette={p} links={[
              { key: "calendar", icon: "calendar", title: "Calendar", detail: "Your schedule and due dates", onPress: () => onNavigate("calendar") },
              { key: "inbox", icon: "chat", title: "Inbox", detail: "Messages and updates", onPress: () => onNavigate("inbox") },
              { key: "tools", icon: "toolbox", title: "All tools", detail: "Every centre within your access", onPress: () => onNavigate("more") },
            ]}/>
          </TodayTiles>}
          </View>}
          {role!=="client"&&desktop&&<QuickAccess palette={p} role={role} tools={toolsFor(role)} columns={4} onOpen={tool=>onOpen(tool)} onAll={()=>onNavigate("more")}/>}
          {role==="cleans"&&<CleanerPerformance palette={p} mine/>}
          {(role==="cleaning_manager"||role==="admin"||role==="super_admin")&&<CleanerPerformance palette={p} mine={false}/>}
          {role==="ready"&&<RepairPipeline palette={p}/>}
          {role!=="client"&&<LinkRow title="Training centre" subtitle="Guides and standards for every team" icon="book-open" palette={p} onPress={() => onNavigate("training")}/>}
          <Entrance sessionKey={"home:"+role+":schedule"} delay={55} style={{ gap: 10 }}>
            <View style={ui.between}>
              <View style={{flex:1,gap:4}}><Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                This week
              </Text>
              <Text style={[ui.small,{color:p.muted}]}>{scheduleWeekLabel(homeDate)}</Text></View>
              <View style={[ui.row,{gap:0}]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={()=>setHomeDate(moveScheduleDay(homeDate,-7))} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="chevron-left" size={19} color={p.primary}/></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={()=>setHomeDate(moveScheduleDay(homeDate,7))} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="chevron-right" size={19} color={p.primary}/></Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open calendar"
                onPress={() => onNavigate("calendar")}
                style={{ width:44,height:44,alignItems:'center',justifyContent: "center" }}
              >
                <Feather name="arrow-up-right" size={20} color={p.primary} />
              </Pressable>
              </View>
            </View>
            {scheduleWeek(homeDate)[0]!==scheduleWeek(presetPeriod(1).to)[0]&&<Pressable accessibilityRole="button" accessibilityLabel="Return schedule to today" onPress={()=>setHomeDate(presetPeriod(1).to)} style={{minHeight:44,justifyContent:'center',alignSelf:'flex-start'}}><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>Today</Text></Pressable>}
            <WeekStrip
              selected={homeDate}
              onSelect={setHomeDate}
              palette={p}
              items={items}
            />
            <Entrance trigger={homeDate}>
              <Text
                accessibilityLiveRegion="polite"
                style={[ui.small, { color: p.muted }]}
              >
                {fullScheduleDate(homeDate)}{items.some(item=>item.record.date===homeDate)?` · ${items.filter(item=>item.record.date===homeDate).length} ${items.filter(item=>item.record.date===homeDate).length===1?'task':'tasks'}`:''}
              </Text>
              {items.some((item) => item.record.date === homeDate) ? (
                items
                  .filter((item) => item.record.date === homeDate)
                  .slice(0, 3)
                  .map(openRow)
              ) : (
                <View style={[ui.row, { paddingVertical: 16, gap: 12 }]}>
                  <View
                    style={{
                      padding: 10,
                      backgroundColor: p.successWash,
                      borderRadius: 13,
                    }}
                  >
                    <Feather name="calendar" size={21} color={p.success} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{ color: p.text, fontSize: 14, fontWeight: "500" }}
                    >
                      No tasks on this day
                    </Text>
                    <Text style={[ui.small, { color: p.muted }]}>
                      {role==='client'?'Your requests will appear here.':'Scheduled work will appear here.'}
                    </Text>
                  </View>
                </View>
              )}
              {!items.some(item=>item.record.date===homeDate)&&role!=='client'&&<Pressable accessibilityRole="button" accessibilityLabel="View your work" onPress={()=>openQueue('All')} style={[ui.button,{backgroundColor:p.wash,alignSelf:'flex-start'}]}><Text style={[ui.buttonText,{color:p.primary}]}>View your work</Text><Feather name="arrow-right" size={16} color={p.primary}/></Pressable>}
            </Entrance>
          </Entrance>
          <Entrance sessionKey={"home:"+role+":departments"} delay={110} style={{ gap: 10 }}>
            <View style={ui.between}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                Your departments
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse all tools"
                onPress={() => onDepartment("All")}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text
                  style={[ui.small, { color: p.primary, fontWeight: "600" }]}
                >
                  Explore
                </Text>
              </Pressable>
            </View>
            <DepartmentGrid
              compact
              role={role}
              palette={p}
              onSelect={onDepartment}
            />
          </Entrance>
          <Entrance sessionKey={"home:"+role+":attention"} delay={165} style={{ gap: 8 }}>
            <View style={ui.between}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                Needs attention
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="See all work"
                onPress={() => openQueue()}
                style={{
                  minHeight: 48,
                  justifyContent: "center",
                  paddingLeft: 12,
                }}
              >
                <Text
                  style={[ui.small, { color: p.primary, fontWeight: "600" }]}
                >
                  View all
                </Text>
              </Pressable>
            </View>
            {pending.length ? (
              <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>{pending.slice(0, 3).map(openRow)}</View>
            ) : (
              <Empty
                title="You're up to date"
                detail="There are no active sample tasks in this workspace."
                palette={p}
              />
            )}
          </Entrance>
        </>
      ) : null}

      {section === 'home' && <View style={{gap:16}}>
        <View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text}]}>Recent activity</Text><Pressable accessibilityRole="button" accessibilityLabel="View all recent activity" onPress={()=>onNavigate('activity')} style={{minHeight:44,justifyContent:'center'}}><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>View all</Text></Pressable></View>
        <RecentActivity items={activity.slice(0,3)} palette={p} error={activityError} onOpen={event=>{const tool=toolsFor(role).find(tool=>tool.id===event.moduleId);if(tool)onOpen(tool);}}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Help and FAQs" onPress={()=>onNavigate('help')} style={[ui.button,{backgroundColor:p.wash}]}><Feather name="help-circle" size={20} color={p.primary}/><Text style={[ui.buttonText,{color:p.primary}]}>Help for your role</Text><Feather name="arrow-right" size={18} color={p.primary}/></Pressable>
      </View>}

      {section === "properties" ? (
        <>
          {heading(
            role === "client"
              ? "Your properties"
              : role === "cleans"
                ? "Assigned properties"
                : "Properties",
            "One place for the details and work you can access.",
          )}
          {(role==="admin"||role==="super_admin"||role==="stays")&&<ClientPropertyProgress palette={p} properties={client.properties} title="Onboarding pipeline" detail="New enquiries and the next action to move each one forward" onOpen={() => { const tool = toolsFor(role).find(entry => entry.id === "property-onboarding"); if (tool) onOpen(tool); }}/>}
          {search("Search property names")}

          <View style={{flexDirection:desktop?'row':'column',flexWrap:'wrap',gap:20}}>
          {!fontsReady?[0,1].map(i=><View key={i} accessibilityLabel="Loading property card" style={[ui.card,card,{flexGrow:1,flexBasis:desktop?'45%':undefined,gap:16}]}><View style={{height:160,backgroundColor:p.elevated,borderRadius:16}}/><View style={{height:22,width:'70%',backgroundColor:p.elevated,borderRadius:8}}/><View style={{height:16,width:'45%',backgroundColor:p.elevated,borderRadius:8}}/></View>):properties.filter(property=>property.propertyName.toLowerCase().includes(propertyQuery.trim().toLowerCase())).map((property,index)=><Entrance key={property.id} sessionKey={'properties:'+role+':'+property.id} delay={index*55} style={{flexGrow:1,flexBasis:desktop?'45%':undefined,minWidth:0}}>
            <Pressable {...hoverLift} accessibilityRole="button" accessibilityLabel={'Open '+property.propertyName} onPress={()=>setSelectedProperty(property)} style={[ui.card,card,{padding:0,overflow:'hidden',borderRadius:26}]}>
              <View style={{minHeight:168,alignItems:'center',justifyContent:'center',backgroundColor:departmentColor(index%2?'clients':'stays',p).wash}}><PropertyScene palette={p} variant={index}/><View style={{position:'absolute',left:16,top:16,backgroundColor:p.surface,borderRadius:999,paddingHorizontal:10,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:6}}><Feather name={property.status==='live'?'check-circle':'clock'} size={14} color={property.status==='live'?p.success:p.waiting}/><Text style={[ui.small,{color:p.text,fontWeight:'600'}]}>{property.status.replaceAll('_',' ')}</Text></View></View>
              <View style={{padding:20,gap:12}}><View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle,{color:p.text,flex:1}]}>{property.propertyName}</Text><Feather name="arrow-up-right" size={20} color={p.primary}/></View><View style={[ui.row,{gap:7}]}><Feather name="map-pin" size={15} color={p.muted}/><Text style={[ui.small,{color:p.muted,flex:1}]}>{property.region}</Text></View><View style={[ui.between,{borderTopWidth:1,borderColor:p.border,paddingTop:12}]}><Text style={[ui.small,{color:p.muted}]}>{property.bedrooms} bedrooms, {property.bathrooms} {Number(property.bathrooms)===1?'bathroom':'bathrooms'}</Text><Text style={[ui.small,{color:p.primary,fontWeight:'600'}]}>View property</Text></View></View>
            </Pressable>
          </Entrance>)}
          </View>
          {!properties.some((property) =>
            property.propertyName
              .toLowerCase()
              .includes(propertyQuery.trim().toLowerCase()),
          ) ? (
            <Empty
              title="No matching properties"
              detail="Your property list only includes your accessible sample records."
              palette={p}
              icon="home"
            />
          ) : null}
        </>
      ) : null}

      {section === "approvals" ? (
        <>
          {heading(
            "Your approvals",
            "Review the decisions waiting for your attention.",
          )}
          {approvalItems(role).length ? (
            <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
              {approvalItems(role).map(openRow)}
            </View>
          ) : (
            <Empty
              title="You're up to date"
              detail="There are no sample quotes or approvals waiting for you."
              palette={p}
            />
          )}
          <LinkRow
            title="Purchase Order Quotes"
            subtitle="View the quote workflow"
            icon="file-text"
            palette={p}
            onPress={() => {
              const tool = toolsFor(role).find(
                (tool) => tool.id === "client-purchase-order-quotes",
              );
              if (tool) onOpen(tool);
            }}
          />
        </>
      ) : null}

      {section === "training" ? <TrainingCentre palette={p} role={role}/> : null}
      {section === "inbox" && role !== "client" ? (
        <>
          {heading("Inbox", role === "cleans" || role === "cleaning_manager" ? "Conversations about your properties with the Stays and Ready teams." : "Guests, clients, team, WhatsApp and email in one place.")}
          <TeamInbox palette={p} role={role}/>
        </>
      ) : null}
      {section === "inbox" && role === "client" ? (
        <>
          {heading(
            "Inbox",
            "Property mail and conversations within your access.",
          )}
          {inbox.length ? (
            <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
              {inbox.map(openRow)}
            </View>
          ) : (
            <Empty
              title="No sample messages"
              detail="Connected conversation channels will appear here when configured."
              palette={p}
              icon="message-circle"
            />
          )}
        </>
      ) : null}

      {section === "more" ? (
        <>
          {heading(
            "Your workspace.",
            "The right tools. A simpler way to work.",
          )}
          <DepartmentGrid role={role} palette={p} onSelect={onDepartment} />
          <View style={{ gap: 12 }}>
            <View style={ui.between}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                Pinned tools
              </Text>
              <Feather name="bookmark" color={p.primary} size={18} />
            </View>
            {saved.length ? (
              <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
                {saved.map((tool) => (
                  <LinkRow
                    key={tool.id}
                    title={tool.name}
                    toolId={tool.id}
                    palette={p}
                    onPress={() => onOpen(tool)}
                  />
                ))}
              </View>
            ) : (
              <View
                style={[
                  ui.card,
                  card,
                  { flexDirection: "row", alignItems: "center", gap: 14 },
                ]}
              >
                <View
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    backgroundColor: p.wash,
                  }}
                >
                  <Feather name="bookmark" color={p.primary} size={22} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{ color: p.text, fontSize: 16, fontWeight: "600" }}
                  >
                    Make it yours
                  </Text>
                  <Text style={[ui.small, { color: p.muted }]}>
                    Save frequently used tools to find them here.
                  </Text>
                </View>
              </View>
            )}
          </View>
          <View style={{ gap: 12 }}>
            <Text
              accessibilityRole="header"
              style={[ui.sectionTitle, { color: p.text }]}
            >
              Quick access
            </Text>
            <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
              <LinkRow
                title="Reports and analytics"
                subtitle="Date ranges, trends and reporting"
                icon="bar-chart-2"
                palette={p}
                onPress={() => onNavigate("analytics")}
              />
              <LinkRow
                title="Calendar"
                subtitle="Plan your work and property visits"
                icon="calendar"
                palette={p}
                onPress={() => onNavigate("calendar")}
              />
              <LinkRow
                title="Inbox"
                subtitle={inbox.length + " sample items"}
                icon="message-circle"
                palette={p}
                onPress={() => onNavigate("inbox")}
              />
              <LinkRow
                title="Profile and preferences"
                subtitle="Personalize your workspace"
                icon="user"
                palette={p}
                onPress={onProfile}
              />
            </View>
          </View>
        </>
      ) : null}

      <Modal
        visible={Boolean(selectedProperty)}
        animationType={reduced ? "none" : "slide"}
        onRequestClose={() => setSelectedProperty(null)}
        onDismiss={() => {
          if (pendingTool) {
            setPendingTool(null);
            onOpen(pendingTool);
          }
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]}>
            <View
              style={[
                ui.row,
                {
                  gap: 12,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  backgroundColor: p.header,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to properties"
                onPress={() => setSelectedProperty(null)}
                style={[
                  ui.iconButton,
                  { backgroundColor: p.headerControl, borderColor: p.headerBorder },
                ]}
              >
                <Feather name="arrow-left" size={20} color={p.headerControlText} />
              </Pressable>
              <Text style={[ui.sectionTitle, { color: p.headerText, flex: 1 }]}>
                Property overview
              </Text>
            </View>
            <ScrollView contentContainerStyle={ui.page}>
              {selectedProperty ? (
                <>
                  <Entrance sessionKey={"property:"+selectedProperty.id} style={{ borderRadius: 28, overflow: "hidden", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
                    <View style={{ minHeight: 180, alignItems: "center", justifyContent: "center", backgroundColor: departmentColor(properties.indexOf(selectedProperty) % 2 ? "clients" : "stays", p).wash }}>
                      <PropertyScene palette={p} variant={Math.max(0, properties.indexOf(selectedProperty))} />
                      <View style={{ position: "absolute", left: 16, top: 16, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: p.surface }}>
                        <Feather name={selectedProperty.status === "live" ? "check-circle" : "clock"} size={14} color={selectedProperty.status === "live" ? p.success : p.waiting} />
                        <Text style={[ui.small, { color: p.text, fontWeight: "600", textTransform: "capitalize" }]}>{selectedProperty.status.replaceAll("_", " ")}</Text>
                      </View>
                    </View>
                    <View style={{ padding: 20, gap: 6 }}>
                      <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: 28, lineHeight: 34 }]}>{selectedProperty.propertyName}</Text>
                      <View style={[ui.row, { gap: 7 }]}>
                        <Feather name="map-pin" size={15} color={p.muted} />
                        <Text style={[ui.body, { color: p.muted, flex: 1 }]}>{selectedProperty.region}</Text>
                      </View>
                    </View>
                  </Entrance>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {([
                      ["moon", "Bedrooms", String(selectedProperty.bedrooms)],
                      ["droplet", "Bathrooms", String(selectedProperty.bathrooms)],
                    ] as const).map(([icon, label, value]) => (
                      <View key={label} style={[ui.card, card, { flex: 1, gap: 8, padding: 16 }]}>
                        <FeatureTile icon={icon} size={36} palette={p} />
                        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.8, color: p.text }}>{value}</Text>
                        <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={[ui.card, card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
                    <FeatureTile icon="map" size={36} palette={p} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", color: p.muted }}>Address</Text>
                      <Text style={[ui.body, { color: p.text }]}>{selectedProperty.propertyAddress}</Text>
                    </View>
                  </View>
                  <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
                    <LinkRow
                      title="Work for this property"
                      subtitle={`${items.filter((item) => item.record.propertyName === selectedProperty.propertyName).length} sample items`}
                      icon="check-square"
                      palette={p}
                      onPress={() => {
                        setQuery(selectedProperty.propertyName);
                        setFilter("All");
                        setView("List");
                        setSelectedProperty(null);
                        onNavigate("work");
                      }}
                    />
                  </View>
                  <Text
                    accessibilityRole="header"
                    style={[ui.sectionTitle, { color: p.text }]}
                  >
                    Property tools
                  </Text>
                  <View style={[ui.card, card, { paddingVertical: 6, gap: 0 }]}>
                    {toolsFor(role)
                      .filter((tool) =>
                        [
                          "properties",
                          "onboarding",
                          "maintenance",
                          "purchase-order",
                          "licensing",
                          "external-calculator",
                        ].includes(WORKSPACE_MAP[tool.id].service),
                      )
                      .map((tool) => (
                        <LinkRow
                          key={tool.id}
                          title={tool.name}
                          toolId={tool.id}
                          palette={p}
                          onPress={() => openPropertyTool(tool)}
                        />
                      ))}
                  </View>
                  <Text style={[ui.small, { color: p.muted }]}>
                    Sample property. Connected documents and financial records
                    are not available in this preview.
                  </Text>
                </>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}
