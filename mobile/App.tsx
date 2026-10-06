import { Text } from "./src/Typography";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Animated,
  Switch,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable as NativePressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { AccountSetup, Avatar, type Profile } from "./src/AccountSetup";
import { Artwork, FeatureTile } from "./src/Artwork";
import { GreetingCard } from "./src/WelcomeMoment";
import { RechargeSplash } from "./src/RechargeSplash";
import { ClientReports } from "./src/ClientReports";
import { OwnerStatements } from "./src/AccountsFlows";

// The Supabase-backed web workspace served by the recharge-backend Worker.
const LIVE_WORKSPACE_SIGN_IN = process.env.EXPO_PUBLIC_LIVE_WORKSPACE_URL || "https://recharge-backend.markravencanete50.workers.dev/sign-in";
import { NavigationBar } from "./src/NavigationBar";
import { FilterBar } from "./src/FilterBar";
import { StateGraphic } from "./src/StateGraphic";
import { Reports } from "./src/Reports";
import { DesktopNavigation } from "./src/DesktopNavigation";
import { themes, headerPalette, departmentColor, ui, type Palette } from "./src/theme";
import { DEPARTMENTS } from "./src/DepartmentGrid";
import { WorkspaceScreens, Calendar } from "./src/WorkspaceScreens";
import { ToolDirectory } from "./src/ToolDirectory";
import { CommandSearch } from "./src/CommandSearch";
import { CompanyLogo } from "./src/CompanyLogo";
import { FaqShortcut, useFaqShortcut } from "./src/FaqShortcut";
import { useRecentActivity } from "./src/useRecentActivity";
import { AccessHelp, RecentActivity } from "./src/AccessHelp";
import { exportReport } from "./src/exportReport";
import { analyticsCsv, analyticsFilename } from "../lib/analytics-export";
import { isWorkspaceAdmin } from "../lib/modules";
import {
  usePreviewBookmarks,
  useThemePreference,
} from "./src/usePreviewPreferences";
import { navigationFor, WORKSPACE_MAP, type WorkspaceSection } from "../lib/workspace-map";
import {
  MotionPress as Pressable,
  MotionProvider,
  useReducedMotion,
  useMotionPreference,
} from "./src/motion";
import {
  buildAnalytics,
  dateKey,
  parseAnalyticsDate,
  periodError,
  periodLabel,
  presetPeriod,
  recordsFor,
  roles,
  snapshotFor,
  toolsFor,
  type AnalyticsPeriod,
  type PreviewRecord,
  type Tool,
  type WorkspaceRole,
} from "./src/model";

type Tab = WorkspaceSection;
type IconName = ComponentProps<typeof Feather>["name"];
function IconButton({
  label,
  icon,
  onPress,
  palette: p,
  expanded,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  palette: Palette;
  expanded?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        ui.iconButton,
        {
          borderColor: p.border,
          backgroundColor: p.surface,
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <Feather name={icon} size={19} color={p.text} />
    </Pressable>
  );
}
function Action({
  label,
  onPress,
  palette: p,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  palette: Palette;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        {
          backgroundColor: secondary ? p.wash : p.primary,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[ui.buttonText, { color: secondary ? p.text : p.onPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  icon,
  palette: p,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  palette: Palette;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const desktop = width >= 768;
  const [enter] = useState(()=>new Animated.Value(1));
  useEffect(()=>{if(!visible)return;enter.setValue(reduced?1:0);if(!reduced)Animated.spring(enter,{toValue:1,speed:18,bounciness:desktop?0:3,useNativeDriver:Platform.OS!=="web"}).start();return()=>enter.stopAnimation();},[visible,reduced,enter,desktop]);
  const drag = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      drag.setValue(0);
    }
  }, [visible, drag]);
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, movement) =>
          movement.dy > 8 && Math.abs(movement.dy) > Math.abs(movement.dx),
        onPanResponderMove: (_, movement) => {
          if (!reduced) drag.setValue(Math.max(0, movement.dy));
        },
        onPanResponderRelease: (_, movement) => {
          if (movement.dy > 65 || (movement.dy > 20 && movement.vy > 0.8))
            onClose();
          Animated.spring(drag, {
            toValue: 0,
            bounciness: 0,
            useNativeDriver: Platform.OS !== "web",
          }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, {
            toValue: 0,
            bounciness: 0,
            useNativeDriver: Platform.OS !== "web",
          }).start(),
      }),
    [drag, onClose, reduced],
  );
  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View {...(Platform.OS==="web"?{dataSet:{overlay:"blur"}}:{})} style={[ui.modalOverlay, { backgroundColor: p.overlay, justifyContent:desktop?"center":"flex-end", alignItems:desktop?"center":undefined }]}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${title}`}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={{ maxHeight: height * 0.9, width:desktop?Math.min(600,width-48):"100%" }}
        >
          <Animated.View
            style={{
              maxHeight: height * 0.9,
              opacity:enter, transform: [{ translateY:drag },{ translateY:enter.interpolate({inputRange:[0,1],outputRange:[desktop?8:100,0]}) }],
            }}
          >
            <SafeAreaView
              edges={["bottom"]}
              style={[
                ui.modalSheet,
                {
                  backgroundColor: p.surface,
                  maxHeight: height * 0.9,
                  borderRadius: desktop ? 30 : undefined,
                  borderWidth: desktop ? 1 : 0,
                  borderColor: p.border,
                  ...(Platform.OS === "web" ? { boxShadow: "0 40px 100px -30px rgba(8, 22, 18, 0.55)" } : {}),
                },
              ]}
              accessibilityViewIsModal
            >
              {/* The drag handle is a touch affordance; desktop dialogs omit it. */}
              {!desktop && (
                <View
                  {...gesture.panHandlers}
                  style={{
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: -12,
                    marginBottom: -10,
                  }}
                >
                  <View style={[ui.handle, { backgroundColor: p.muted }]} />
                </View>
              )}
              <View style={[ui.row, { gap: 14 }]}>
                {icon && (
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.header, alignItems: "center", justifyContent: "center" }}>
                    <Feather name={icon} size={19} color={p.headerText} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, fontSize: 20, letterSpacing: -0.6 }]}>
                    {title}
                  </Text>
                  {subtitle ? <Text style={[ui.small, { color: p.muted }]}>{subtitle}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Close ${title}`}
                  onPress={onClose}
                  {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})}
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
                >
                  <Feather name="x" size={18} color={p.text} />
                </Pressable>
              </View>
              <View style={{ height: 1, backgroundColor: p.border, marginHorizontal: -22 }} />
              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ gap: 18, paddingBottom: 4 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
function RecordRow({
  record,
  palette: p,
  onPress,
}: {
  record: PreviewRecord;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        ui.row,
        {
          gap: 12,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            color: p.text,
            fontWeight: "600",
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {record.title}
        </Text>
        <Text style={[ui.small, { color: p.muted }]}>{record.subtitle}</Text>
        {record.date ? (
          <Text style={{ color: p.muted, fontSize: 12 }}>{record.date}</Text>
        ) : null}
      </View>
      <View style={[ui.tag, { backgroundColor: p.wash, maxWidth: 100 }]}>
        <Text style={[ui.tagText, { color: p.text }]}>
          {record.status.replaceAll("_", " ")}
        </Text>
      </View>
    </Pressable>
  );
}
function DetailScreen({visible,onClose,title,subtitle,palette,children}:{visible:boolean;onClose:()=>void;title:string;subtitle?:string;palette:Palette;children:ReactNode}) {
  return <Sheet visible={visible} title={title} subtitle={subtitle} onClose={onClose} palette={palette}>{children}</Sheet>;
}
function AppContent() {
  const { theme, setTheme } = useThemePreference();
  const p = themes[theme];
  const {width: windowWidth} = useWindowDimensions();
  const desktop = windowWidth >= 1024;
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const motionPreference = useMotionPreference();
  const [scrolled,setScrolled] = useState(false);
  const [offline,setOffline] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const update=()=>setOffline(!navigator.onLine);update();
    window.addEventListener("online",update);window.addEventListener("offline",update);
    return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};
  },[]);
  const [role, setRole] = useState<WorkspaceRole>("super_admin");
  const activity = useRecentActivity(role);
  const faqShortcut = useFaqShortcut();
  const { section } = useLocalSearchParams<{ section: string }>();
  const sections: WorkspaceSection[] = [
    "home",
    "work",
    "properties",
    "inbox",
    "more",
    "workspace",
    "analytics",
    "calendar",
    "approvals",
    "help",
    "activity",
    "training",
  ];
  const tab: Tab = sections.includes(section as Tab)
    ? (section as Tab)
    : "home";
  const setTab = (value: Tab) => router.setParams({ section: value });
  const [profile, setProfile] = useState<Profile>({
    displayName: "Preview User",
    avatar: "ocean",
  });
  const [accountMode, setAccountMode] = useState<"register" | "preview" | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  // Signing in plays the loading moment, then a time-of-day greeting. Web
  // shows it once per browser session; apps once per launch.
  const [welcome, setWelcome] = useState<"splash" | "greeting" | null>(() => {
    if (Platform.OS !== "web") return "splash";
    try { return globalThis.sessionStorage?.getItem("rc-welcomed") ? null : "splash"; } catch { return "splash"; }
  });
  const finishWelcome = () => {
    setWelcome(null);
    if (Platform.OS === "web") { try { globalThis.sessionStorage?.setItem("rc-welcomed", "1"); } catch { /* storage unavailable */ } }
  };
  const [commandOpen,setCommandOpen]=useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [savedOnly, setSavedOnly] = useState(false);
  const {
    saved: savedTools,
    toggle: toggleSaved,
    move: moveSaved,
    error: bookmarkError,
    loaded: bookmarksLoaded,
  } = usePreviewBookmarks(role);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PreviewRecord | null>(
    null,
  );
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatus, setRecordStatus] = useState("All");
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => presetPeriod(30));
  const [draft, setDraft] = useState(period);
  const [calendar, setCalendar] = useState(false);
  const [editingDate, setEditingDate] = useState<"from" | "to" | null>(null);
  const [chartData, setChartData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [fade] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const snapshot = useMemo(() => snapshotFor(role), [role]);
  const data = useMemo(
    () => buildAnalytics(snapshot, period),
    [snapshot, period],
  );
  const tools = useMemo(() => toolsFor(role), [role]);
  useEffect(()=>{
    if(Platform.OS!=="web")return;
    const listener=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){
        if(settings||selectedTool||accountMode||calendar)return;
        event.preventDefault();setCommandOpen(value=>!value);
      }
    };
    document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);
  },[settings,selectedTool,accountMode,calendar]);
  async function exportCsv() {
    if (!isWorkspaceAdmin(role) || exporting) return;
    setExporting(true);
    setExportMessage("");
    try {
      await exportReport(
        analyticsCsv(snapshot, period, true),
        analyticsFilename(period),
      );
      activity.record('export_report');
      setExportMessage(
        Platform.OS === "web"
          ? "Sample report download started."
          : "Sample report ready to save or share.",
      );
    } catch (error) {
      setExportMessage(
        error instanceof Error
          ? error.message
          : "Could not export. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  const toolRecords = selectedTool ? recordsFor(role, selectedTool.id) : [];
  const visibleRecords = toolRecords.filter(
    (record) =>
      record.title.toLowerCase().includes(recordSearch.trim().toLowerCase()) &&
      (recordStatus === "All" || record.status === recordStatus),
  );
  const openTool = (tool: Tool, record: PreviewRecord | null = null) => {
    if (!tools.some((allowed) => allowed.id === tool.id)) return;
    Keyboard.dismiss();
    setRecordSearch("");
    setRecordStatus("All");
    setSelectedTool(tool);
    setSelectedRecord(record);
    activity.record(record?'view_record':'open_tool',tool.id);
  };
  const roleLabel = roles.find((item) => item.value === role)!.label;
  const draftError = periodError(draft);
  useEffect(() => {
    let cancelled = false;
    scroll.current?.scrollTo({ y: 0, animated: false });
    Keyboard.dismiss();
    queueMicrotask(() => { if (!cancelled) setScrolled(false); });
    if (reduced) {
      fade.setValue(1);
      return () => { cancelled = true; };
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    return () => {
      cancelled = true;
      fade.stopAnimation();
    };
  }, [tab, role, fade, reduced]);
  const card = { backgroundColor: p.surface, borderColor: p.border };
  const switchRole = (value: WorkspaceRole) => {
    setRole(value);
    setExportMessage("");
    setSettings(false);
    setCommandOpen(false);
    setSearch("");
    setDepartment("All");
    setSavedOnly(false);
    setSelectedTool(null);
    setSelectedRecord(null);
    setTab("home");
  };
  const changeDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setEditingDate(null);
    if (event.type === "set" && date && editingDate)
      setDraft((current) => ({ ...current, [editingDate]: dateKey(date) }));
  };
  return (
    <View style={[ui.fill, { backgroundColor: p.background }]}>
      <View style={ui.fill}>
        <SafeAreaView
          style={[ui.fill, { backgroundColor: p.background }]}
          edges={["top", "bottom"]}
        >
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <View style={[ui.fill,{flexDirection:"row"}]}>
          {desktop&&!sidebarHidden&&<DesktopNavigation role={role} section={tab} palette={p} onNavigate={setTab} onProfile={()=>setSettings(true)} onCollapse={()=>setSidebarHidden(true)} onDepartment={(department)=>{setSearch("");setDepartment(department);setSavedOnly(false);setTab("workspace");}}/>}
          {desktop&&sidebarHidden&&<View testID="workspace-sidebar-collapsed" style={{width:64,backgroundColor:p.isDark?p.surface:p.background,borderRightWidth:1,borderColor:p.border}}><View style={{height:81,alignItems:"center",justifyContent:"center",backgroundColor:p.header}}><IconButton label="Show left panel" icon="chevrons-right" palette={headerPalette(p)} expanded={false} onPress={()=>setSidebarHidden(false)}/></View></View>}
          <View style={[ui.fill,{minWidth:0}]}>
          {offline&&<View accessibilityRole="alert" style={{backgroundColor:p.cautionWash,padding:12}}><Text style={[ui.small,{color:p.text}]}>You are offline. The sample workspace remains available. Live requests may fail until you reconnect.</Text></View>}
          <View testID="workspace-toolbar" style={{ backgroundColor: p.header, borderBottomWidth:1, borderColor:scrolled?p.headerBorder:p.isDark&&desktop?p.border:'transparent' }}>
            <View
              style={[
                ui.between,
                {
                  width: "100%",
                  maxWidth: desktop ? undefined : 760,
                  alignSelf: "center",
                  paddingHorizontal: 20,
                  paddingVertical: 16,
                  gap: 12,
                },
              ]}
            >
              <View style={[ui.row,{flex:1,minWidth:0,gap:16}]}>
                  {desktop&&sidebarHidden&&<CompanyLogo palette={headerPalette(p)} width={144}/>}
                  {desktop?<Text style={{color:p.headerText,fontSize:16,fontWeight:"600",flexShrink:1}}>{navigationFor(role).find(item=>item.value===tab)?.label??(tab==="workspace"?"Tools":tab==="analytics"?"Reports":tab.charAt(0).toUpperCase()+tab.slice(1))}</Text>:<CompanyLogo palette={headerPalette(p)} width={windowWidth<360?104:144}/>}
              </View>
              <View style={[ui.row, { gap: 8 }]}>
                <IconButton label="Open quick search" icon="search" palette={headerPalette(p)} onPress={()=>setCommandOpen(true)}/>
                <IconButton
                  label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                  icon={theme === "dark" ? "sun" : "moon"}
                  palette={headerPalette(p)}
                  onPress={() =>
                    setTheme(theme === "dark" ? "light" : "dark", reduced)
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open profile and preview roles, ${roleLabel}`}
                  onPress={() => setSettings(true)}
                  style={{
                    minHeight: 48,
                    minWidth: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingLeft: desktop ? 14 : 0,
                    borderRadius: 999,
                    backgroundColor: desktop ? p.headerControl : "transparent",
                    borderWidth: desktop ? 1 : 0,
                    borderColor: p.headerBorder,
                  }}
                >
                  {desktop && (
                    <View style={{ maxWidth: 180 }}>
                      <Text numberOfLines={1} style={{ color: p.headerText, fontSize: 14, fontWeight: "600" }}>{profile.displayName.trim() || "Your profile"}</Text>
                      <Text numberOfLines={1} style={{ color: p.headerMuted, fontSize: 11 }}>{roleLabel}</Text>
                    </View>
                  )}
                  <Avatar profile={profile} backgroundColor={desktop ? undefined : p.headerControl} textColor={desktop ? "#FFFFFF" : p.headerControlText}/>
                  {data.waiting > 0 && (
                    <View
                      accessible
                      accessibilityLabel="Items need attention"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 3,
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        borderWidth: 2,
                        borderColor: p.header,
                        backgroundColor: p.waiting,
                      }}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
          {(tab === "workspace" || tab === "more") && (
            <ToolDirectory
              key={role}
              onNavigate={setTab}
              onProfile={() => setSettings(true)}
              role={role}
              palette={p}
              query={search}
              onQuery={setSearch}
              area={department}
              onArea={setDepartment}
              saved={savedTools}
              onlySaved={savedOnly}
              onOnlySaved={() => setSavedOnly(!savedOnly)}
              onSave={id=>{activity.record(savedTools.includes(id)?'unsave_tool':'save_tool',id as Tool['id']);toggleSaved(id);}}
              onMovePin={moveSaved}
              onOpen={openTool}
              storageError={
                bookmarksLoaded ? bookmarkError : "Loading saved tools..."
              }
            />
          )}

          {(tab === "work" || tab === "calendar") && <WorkspaceScreens key={role} section={tab} role={role} palette={p} analyticsSnapshot={snapshot} analyticsPeriod={period} onNavigate={setTab} onOpen={openTool} onProfile={()=>setSettings(true)} savedTools={savedTools} profileName={profile.displayName} onDepartment={department=>{setDepartment(department);setTab("workspace");}}/>}
          {tab !== "workspace" && tab !== "more" && tab !== "work" && tab !== "calendar" && (
            <ScrollView
              ref={scroll}
              testID="workspace-scroll"
              style={ui.fill}
              contentContainerStyle={[ui.page,{maxWidth:desktop?1400:760}]}
              onScroll={event=>setScrolled(event.nativeEvent.contentOffset.y>12)}
              scrollEventThrottle={32}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={Platform.OS === "web"}
            >
              <Animated.View
                style={{
                  opacity: fade,
                  gap: 24,
                  transform: desktop ? [{translateY:fade.interpolate({inputRange:[0,1],outputRange:[8,0]})}] : [{translateX:fade.interpolate({inputRange:[0,1],outputRange:[14,0]})}],
                }}
              >
                {tab === "analytics" && role === "client" && <ClientReports palette={p}/>}
                {tab === "analytics" && role === "accounts" && <OwnerStatements palette={p} desktop={desktop}/>}
                {tab === "analytics" && role !== "client" && role !== "accounts" && <Reports snapshot={snapshot} period={period} role={role} palette={p} onDates={()=>{setDraft(period);setCalendar(true);}} onExport={exportCsv} exporting={exporting} exportMessage={exportMessage}/>}
                {(tab==='help'||tab==='activity')&&<View style={[ui.row,{gap:12}]}><IconButton label="Back to Home" icon="arrow-left" onPress={()=>setTab('home')} palette={p}/><Text style={[ui.small,{color:p.muted}]}>Your workspace</Text></View>}
                {tab==='help'&&<AccessHelp key={'help:'+role} role={role} palette={p} onOpen={openTool}/>}
                {tab==='activity'&&<View style={{gap:18}}><View style={{gap:6}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>Recent activity</Text><Text style={[ui.body,{color:p.muted}]}>What you have opened, saved and changed on this device.</Text></View><RecentActivity framed items={activity.items} palette={p} error={activity.error} onOpen={event=>{const tool=tools.find(tool=>tool.id===event.moduleId);if(tool)openTool(tool);}}/></View>}
                <WorkspaceScreens
                  key={role}
                  section={tab}
                  role={role}
                  palette={p}
                  analyticsSnapshot={snapshot}
                  analyticsPeriod={period}
                  onNavigate={setTab}
                  onOpen={openTool}
                  onProfile={() => setSettings(true)}
                  savedTools={savedTools}
                  profileName={profile.displayName}
                  activity={activity.items}
                  activityError={activity.error}
                  onDepartment={(department) => {
                    setSearch("");
                    setDepartment(department);
                    setSavedOnly(false);
                    setTab("workspace");
                  }}
                />
                <Text
                  style={{
                    color: p.muted,
                    fontSize: 12,
                    lineHeight: 16,
                    textAlign: "center",
                  }}
                >
                  Sample data only. Live accounts and changes are disabled.
                </Text>
              </Animated.View>
            </ScrollView>
          )}
          {!faqShortcut.hidden&&<FaqShortcut palette={p} onOpen={()=>setTab('help')} onHide={()=>faqShortcut.setHidden(true)}/>}
          <View style={{ alignItems: "center", paddingTop: 4, paddingBottom: desktop ? 4 : 30 }}>
            <Text
              style={{
                fontSize: 11,
                lineHeight: 16,
                color: p.muted,
                backgroundColor: p.elevated,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
            >
              Sample data only. Live changes disabled.
            </Text>
          </View>
          {!desktop&&<NavigationBar
            role={role}
            section={tab}
            onNavigate={setTab}
            palette={p}
          />}
          </View></View>
          <Sheet
            visible={settings}
            onClose={() => setSettings(false)}
            title="Profile & preferences"
            subtitle="Your preview identity, comfort settings and role"
            icon="settings"
            palette={p}
          >
            {/* Identity card echoes the forest header. */}
            <View style={{ borderRadius: 22, padding: 18, gap: 16, backgroundColor: p.header, overflow: "hidden" }}>
              <View style={[ui.row, { gap: 14 }]}>
                <Avatar profile={profile} size={56} backgroundColor={p.headerControl} textColor={p.headerControlText} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: p.headerText, fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }}>{profile.displayName}</Text>
                  <Text style={{ color: p.headerMuted, fontSize: 13 }}>{roleLabel}</Text>
                </View>
              </View>
              <View style={[ui.row, { gap: 10 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setSettings(false); setAccountMode("preview"); }}
                  style={[ui.button, { flex: 1, minHeight: 44, backgroundColor: p.headerControl, borderWidth: 1, borderColor: p.headerBorder }]}
                >
                  <Feather name="edit-3" size={15} color={p.headerControlText} />
                  <Text style={[ui.buttonText, { color: p.headerControlText }]}>Customize</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setSettings(false); setAccountMode("register"); }}
                  style={[ui.button, { flex: 1, minHeight: 44, backgroundColor: p.headerText }]}
                >
                  <Feather name="user-plus" size={15} color={p.header} />
                  <Text style={[ui.buttonText, { color: p.header }]}>Create account</Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open the live workspace sign-in in a new tab"
              onPress={() => { void Linking.openURL(LIVE_WORKSPACE_SIGN_IN); }}
              style={[ui.between, { gap: 14, minHeight: 72, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }]}
            >
              <FeatureTile icon="log-in" hue="forest" size={40} palette={p} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Live workspace</Text>
                <Text style={[ui.small, { color: p.muted }]}>Sign in with a real account to test with live data.</Text>
              </View>
              <Feather name="external-link" size={17} color={p.muted} />
            </Pressable>

            <View style={{ gap: 8 }}>
              <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Comfort</Text>
              <View style={{ borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
                <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
                  <FeatureTile icon="wind" size={36} palette={p} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Reduce motion</Text>
                    <Text style={[ui.small, { color: p.muted }]}>{motionPreference.system ? "Your device setting is respected." : "Use instant changes instead of decorative animation."}</Text>
                  </View>
                  <Switch accessibilityLabel="Reduce motion" value={reduced} disabled={motionPreference.system} onValueChange={motionPreference.setPreference} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
                </View>
                <View style={{ height: 1, backgroundColor: p.border, marginLeft: 68 }} />
                <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
                  <FeatureTile icon="help-circle" size={36} palette={p} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Show FAQ shortcut</Text>
                    <Text style={[ui.small, { color: p.muted }]}>A Help button in the corner of every page.</Text>
                  </View>
                  <Switch accessibilityLabel="Show FAQ shortcut" value={!faqShortcut.hidden} onValueChange={value=>faqShortcut.setHidden(!value)} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
                </View>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Preview as</Text>
              <Text style={[ui.small, { color: p.muted }]}>
                Explore the app as each role. This only changes sample screens and never grants real access.
              </Text>
              <View style={{ gap: 6, marginTop: 4 }}>
                {roles.map((item) => {
                  const checked = item.value === role;
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked }}
                      onPress={() => switchRole(item.value)}
                      {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})}
                      style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: checked ? p.primary : p.border, backgroundColor: checked ? p.wash : "transparent" }]}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: checked ? p.primary : p.controlBorder, alignItems: "center", justifyContent: "center" }}>
                        {checked && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.primary }} />}
                      </View>
                      <Text style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: checked ? "700" : "500" }}>{item.label}</Text>
                      {checked && <Text style={{ color: p.primary, fontSize: 12, fontWeight: "600" }}>Current</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Sheet>
          {accountMode && (
            <AccountSetup
              mode={accountMode}
              palette={p}
              current={profile}
              onClose={() => setAccountMode(null)}
              onProfile={value=>{setProfile(value);activity.record('update_profile');if(accountMode==='register')setWelcome('splash');}}
            />
          )}
          {welcome==="splash"&&<RechargeSplash palette={p} onDone={()=>setWelcome("greeting")}/>}
          {welcome==="greeting"&&<GreetingCard palette={p} profile={profile} openTasks={Math.max(0,data.total-data.complete)} waiting={data.waiting} onClose={finishWelcome} onWork={()=>{finishWelcome();setTab("work");}}/>}
          {commandOpen&&<Sheet visible title="Quick search" subtitle="Jump to any tool or page within your access" icon="search" onClose={()=>setCommandOpen(false)} palette={p}><CommandSearch tools={tools} palette={p} onOpen={openTool} onNavigate={setTab} onProfile={()=>setSettings(true)} onClose={()=>setCommandOpen(false)}/></Sheet>}
          <Sheet
            visible={calendar}
            onClose={() => {
              setCalendar(false);
              setEditingDate(null);
            }}
            title="Date range"
            subtitle="All charts update together. Up to 366 days."
            icon="calendar"
            palette={p}
          >
            <View style={{ flexDirection: "row", gap: 6, padding: 4, borderRadius: 999, backgroundColor: p.elevated }}>
              {[7, 30, 90].map((days) => {
                const active = draft.from === presetPeriod(days).from && draft.to === presetPeriod(days).to;
                return (
                  <Pressable
                    key={days}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setDraft(presetPeriod(days));
                      setEditingDate(null);
                    }}
                    style={{ flex: 1, minHeight: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? p.primary : "transparent" }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: active ? p.onPrimary : p.muted }}>
                      Last {days} days
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["from", "to"] as const).map((field) => {
                const active = editingDate === field;
                const value = parseAnalyticsDate(draft[field]);
                return (
                  <Pressable
                    key={field}
                    accessibilityRole="button"
                    accessibilityLabel={`${field === "from" ? "Start" : "End"} date, ${draft[field]}`}
                    accessibilityState={{ expanded: active }}
                    onPress={() => setEditingDate(active ? null : field)}
                    {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})}
                    style={{ flex: 1, gap: 6, padding: 14, borderRadius: 18, borderWidth: active ? 2 : 1, borderColor: active ? p.primary : p.border, backgroundColor: active ? p.wash : p.background }}
                  >
                    <View style={[ui.row, { gap: 6 }]}>
                      <Feather name={field === "from" ? "log-in" : "log-out"} size={13} color={p.muted} />
                      <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", color: p.muted }}>{field === "from" ? "Start" : "End"}</Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: p.text, letterSpacing: -0.3 }}>
                      {value ? value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : draft[field]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {editingDate &&
              (Platform.OS === "web" ? (
                <Calendar
                  key={editingDate}
                  selected={draft[editingDate]}
                  palette={p}
                  onSelect={(date) =>
                    setDraft((current) => ({ ...current, [editingDate]: date }))
                  }
                />
              ) : (
                <DateTimePicker
                  value={parseAnalyticsDate(draft[editingDate])!}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  onChange={changeDate}
                  themeVariant={theme}
                />
              ))}
            {draftError ? (
              <View accessibilityRole="alert" style={[ui.row, { gap: 8, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
                <Feather name="alert-circle" size={16} color={p.waiting} />
                <Text style={[ui.small, { color: p.text, flex: 1 }]}>{draftError}</Text>
              </View>
            ) : (
              <Text style={[ui.small, { color: p.muted }]}>
                {periodLabel(draft)}
              </Text>
            )}
            <Action
              label="Apply dates"
              palette={p}
              disabled={Boolean(draftError)}
              onPress={() => {
                setPeriod(draft);
                setCalendar(false);
                setEditingDate(null);
              }}
            />
          </Sheet>
          <DetailScreen
            visible={Boolean(selectedTool)}
            onClose={() => {
              setSelectedTool(null);
              setSelectedRecord(null);
            }}
            title={selectedTool?.name ?? "Workspace tool"}
            subtitle={selectedTool ? (()=>{const department=DEPARTMENTS.find(d=>d.id===WORKSPACE_MAP[selectedTool.id].tone)?.name??"";return department&&department!==selectedTool.category?department+" · "+selectedTool.category:selectedTool.category;})() : undefined}
            palette={p}
          >
            <View style={{ gap: 14 }}>
              {selectedTool && (
                <>
                  <View style={[ui.row,{gap:16,padding:16,borderRadius:22,backgroundColor:departmentColor(WORKSPACE_MAP[selectedTool.id].tone,p).wash}]}>
                    <View style={{padding:6,borderRadius:20,backgroundColor:p.surface}}><Artwork id={selectedTool.id} size={56} palette={p} /></View>
                    <Text style={[ui.body, { color: p.text, flex: 1 }]}>
                      {selectedTool.description}
                    </Text>
                  </View>
                  {selectedRecord ? (
                    <>
                      <Text style={[ui.sectionTitle, { color: p.text }]}>
                        {selectedRecord.title}
                      </Text>
                      <Text style={[ui.body, { color: p.muted }]}>
                        {selectedRecord.subtitle}
                      </Text>
                      <View style={[ui.tag, { backgroundColor: p.wash }]}>
                        <Text style={[ui.tagText, { color: p.text }]}>
                          {selectedRecord.status.replaceAll("_", " ")}
                        </Text>
                      </View>
                      {selectedRecord.date ? (
                        <Text style={[ui.small, { color: p.muted }]}>
                          {selectedRecord.date}
                        </Text>
                      ) : null}
                      {selectedRecord.details ? (
                        <View style={[ui.card, card]}>
                          <Text style={[ui.sectionTitle, { color: p.text }]}>
                            Details
                          </Text>
                          <Text style={[ui.body, { color: p.muted }]}>
                            {selectedRecord.details}
                          </Text>
                        </View>
                      ) : null}
                      <Action
                        label="Back to records"
                        palette={p}
                        secondary
                        onPress={() => setSelectedRecord(null)}
                      />
                    </>
                  ) : toolRecords.length ? (
                    <>
                      <TextInput
                        accessibilityLabel="Search record titles"
                        placeholder="Search record titles"
                        placeholderTextColor={p.muted}
                        value={recordSearch}
                        onChangeText={setRecordSearch}
                        autoCorrect={false}
                        returnKeyType="search"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        style={[
                          ui.input,
                          {
                            color: p.text,
                            borderColor: p.controlBorder,
                            backgroundColor: p.wash,
                          },
                        ]}
                      />
                      <FilterBar
                        values={[
                          "All",
                          ...new Set(
                            toolRecords.map((record) => record.status),
                          ),
                        ].map((status) => status.replaceAll("_", " "))}
                        selected={recordStatus.replaceAll("_", " ")}
                        onSelect={(status) =>
                          setRecordStatus(
                            status === "All"
                              ? "All"
                              : status.replaceAll(" ", "_"),
                          )
                        }
                        palette={p}
                      />
                      <Text style={[ui.small, { color: p.muted }]}>
                        {visibleRecords.length} of {toolRecords.length} records
                      </Text>
                      {visibleRecords.map((record) => (
                        <RecordRow
                          key={record.id}
                          record={record}
                          palette={p}
                          onPress={() => {setSelectedRecord(record);if(selectedTool)activity.record('view_record',selectedTool.id);}}
                        />
                      ))}
                      {!visibleRecords.length && (
                        <Action
                          label="Reset record filters"
                          palette={p}
                          secondary
                          onPress={() => {
                            setRecordSearch("");
                            setRecordStatus("All");
                            Keyboard.dismiss();
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <View
                      style={[
                        ui.card,
                        { backgroundColor: p.background, borderColor: p.controlBorder, borderStyle: "dashed", alignItems: "center", paddingVertical: 24 },
                      ]}
                    >
                      <StateGraphic palette={p} icon="inbox" />
                      <Text style={[ui.sectionTitle, { color: p.text }]}>
                        No sample records
                      </Text>
                      <Text style={[ui.body, { color: p.muted }]}>
                        This native preview does not yet connect the live
                        workflow for this tool. Its detailed editing screens
                        will be added during the mobile build.
                      </Text>
                      <Action
                        label={`Explore ${selectedTool.category} tools`}
                        palette={p}
                        secondary
                        onPress={() => {
                          setDepartment("All");
                          setSearch("");
                          setSavedOnly(false);
                          setSelectedTool(null);
                          setTab("workspace");
                        }}
                      />
                    </View>
                  )}
                  <Text style={[ui.small, { color: p.muted }]}>
                    Preview records are read-only.
                  </Text>
                </>
              )}
            </View>
          </DetailScreen>
          <Sheet
            visible={chartData}
            onClose={() => setChartData(false)}
            title="Daily chart data"
            subtitle="Records per day in the selected range"
            icon="bar-chart-2"
            palette={p}
          >
            <View>
              {data.trend.map((day) => (
                <View
                  key={day.key}
                  style={[
                    ui.between,
                    {
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: p.border,
                    },
                  ]}
                >
                  <Text style={[ui.small, { color: p.text }]}>{day.date}</Text>
                  <Text style={[ui.small, { color: p.muted }]}>
                    {Object.entries(day).reduce(
                      (total, [key, value]) =>
                        total +
                        (key !== "key" &&
                        key !== "date" &&
                        typeof value === "number"
                          ? value
                          : 0),
                      0,
                    )}{" "}
                    records
                  </Text>
                </View>
              ))}
            </View>
          </Sheet>
        </SafeAreaView>
      </View>
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <MotionProvider>
        <AppContent />
      </MotionProvider>
    </SafeAreaProvider>
  );
}
