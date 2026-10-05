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
import { Artwork } from "./src/Artwork";
import { NavigationBar } from "./src/NavigationBar";
import { FilterBar } from "./src/FilterBar";
import { StateGraphic } from "./src/StateGraphic";
import { Reports } from "./src/Reports";
import { DesktopNavigation } from "./src/DesktopNavigation";
import { themes, headerPalette, ui, type Palette } from "./src/theme";
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
import { type WorkspaceSection } from "../lib/workspace-map";
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
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
  palette: p,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
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
      <View style={[ui.modalOverlay, { backgroundColor: p.overlay, justifyContent:desktop?"center":"flex-end", alignItems:desktop?"center":undefined }]}>
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
                { backgroundColor: p.surface, maxHeight: height * 0.9, borderRadius:desktop?28:undefined },
              ]}
              accessibilityViewIsModal
            >
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
              <View style={ui.between}>
                <Text
                  accessibilityRole="header"
                  style={[
                    ui.sectionTitle,
                    { color: p.text, flex: 1, marginRight: 12 },
                  ]}
                >
                  {title}
                </Text>
                <IconButton
                  label={`Close ${title}`}
                  icon="x"
                  onPress={onClose}
                  palette={p}
                />
              </View>
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
function DetailScreen({visible,onClose,title,palette,children}:{visible:boolean;onClose:()=>void;title:string;palette:Palette;children:ReactNode}) {
  return <Sheet visible={visible} title={title} onClose={onClose} palette={palette}>{children}</Sheet>;
}
function AppContent() {
  const { theme, setTheme, themeOpacity } = useThemePreference();
  const p = themes[theme];
  const {width: windowWidth} = useWindowDimensions();
  const desktop = windowWidth >= 1024;
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
      <Animated.View style={[ui.fill, { opacity: themeOpacity }]}>
        <SafeAreaView
          style={[ui.fill, { backgroundColor: p.background }]}
          edges={["top", "bottom"]}
        >
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <View style={[ui.fill,{flexDirection:"row"}]}>
          {desktop&&<DesktopNavigation role={role} section={tab} palette={p} onNavigate={setTab} onProfile={()=>setSettings(true)} onDepartment={(department)=>{setSearch("");setDepartment(department);setSavedOnly(false);setTab("workspace");}}/>}
          <View style={[ui.fill,{minWidth:0}]}>
          {offline&&<View accessibilityRole="alert" style={{backgroundColor:p.cautionWash,padding:12}}><Text style={[ui.small,{color:p.text}]}>You are offline. The sample workspace remains available. Live requests may fail until you reconnect.</Text></View>}
          <View style={{ backgroundColor: p.header, borderBottomWidth:desktop?1:0, borderColor:p.headerBorder, ...(Platform.OS === "web" && scrolled ? {boxShadow:"0 6px 18px var(--rc-shadow)"}: {}) }}>
            <View
              style={[
                ui.between,
                {
                  width: "100%",
                  maxWidth: desktop ? undefined : 760,
                  alignSelf: "center",
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  paddingBottom: 8,
                  gap: 12,
                },
              ]}
            >
              <View style={{flex:1,minWidth:0,gap:5}}>
                  <CompanyLogo palette={headerPalette(p)} width={windowWidth<360?104:144}/>
                  <Text
                    style={{ color: p.headerMuted, fontSize: 12, lineHeight: 17 }}
                  >
                    {roleLabel}
                  </Text>
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
                  accessibilityLabel="Open profile and preview roles"
                  onPress={() => setSettings(true)}
                  style={{
                    minHeight: 48,
                    minWidth: 44,
                    justifyContent: "center",
                  }}
                >
                  <Avatar profile={profile} />
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
                        backgroundColor: p.primary,
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
                {tab === "analytics" && <Reports snapshot={snapshot} period={period} role={role} palette={p} onDates={()=>{setDraft(period);setCalendar(true);}} onExport={exportCsv} exporting={exporting} exportMessage={exportMessage}/>}
                {(tab==='help'||tab==='activity')&&<View style={[ui.row,{gap:12}]}><IconButton label="Back to Today" icon="arrow-left" onPress={()=>setTab('home')} palette={p}/><Text style={[ui.small,{color:p.muted}]}>Your workspace</Text></View>}
                {tab==='help'&&<AccessHelp key={'help:'+role} role={role} palette={p} onOpen={openTool}/>}
                {tab==='activity'&&<View style={{gap:18}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>Recent activity</Text><RecentActivity items={activity.items} palette={p} error={activity.error} onOpen={event=>{const tool=tools.find(tool=>tool.id===event.moduleId);if(tool)openTool(tool);}}/></View>}
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
          <View style={{ alignItems: "center", paddingVertical: 4 }}>
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
            title={profile.displayName}
            palette={p}
          >
            <Action
              label="Customize preview profile"
              palette={p}
              secondary
              onPress={() => {
                setSettings(false);
                setAccountMode("preview");
              }}
            />
            <Action
              label="Create an account"
              palette={p}
              onPress={() => {
                setSettings(false);
                setAccountMode("register");
              }}
            />
            <View style={[ui.between,{gap:16,minHeight:56}]}><View style={{flex:1,gap:4}}><Text style={[ui.body,{color:p.text,fontWeight:"600"}]}>Reduce motion</Text><Text style={[ui.small,{color:p.muted}]}>{motionPreference.system?"Your device setting is respected.":"Use instant changes instead of decorative animation."}</Text></View><Switch accessibilityLabel="Reduce motion" value={reduced} disabled={motionPreference.system} onValueChange={motionPreference.setPreference} trackColor={{false:p.controlBorder,true:p.primary}} thumbColor={p.surface}/></View>
            <View style={[ui.between,{gap:16,minHeight:56}]}><Text style={[ui.body,{color:p.text,flex:1}]}>Show FAQ shortcut</Text><Switch accessibilityLabel="Show FAQ shortcut" value={!faqShortcut.hidden} onValueChange={value=>faqShortcut.setHidden(!value)} trackColor={{false:p.controlBorder,true:p.success}} thumbColor={p.surface}/></View>
            <Text style={[ui.body, { color: p.muted }]}>
              Explore the app as each role. This selector only changes sample
              screens and never grants real access.
            </Text>
            <View>
              {roles.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.value === role }}
                  onPress={() => switchRole(item.value)}
                  style={[
                    ui.between,
                    {
                      padding: 15,
                      marginBottom: 7,
                      borderRadius: 14,
                      backgroundColor:
                        item.value === role ? p.wash : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{ color: p.text, fontSize: 14, fontWeight: "600" }}
                  >
                    {item.label}
                  </Text>
                  {item.value === role && (
                    <Feather name="check" size={18} color={p.primary} />
                  )}
                </Pressable>
              ))}
            </View>
          </Sheet>
          {accountMode && (
            <AccountSetup
              mode={accountMode}
              palette={p}
              current={profile}
              onClose={() => setAccountMode(null)}
              onProfile={value=>{setProfile(value);activity.record('update_profile');}}
            />
          )}
          {commandOpen&&<Sheet visible title="Quick search" onClose={()=>setCommandOpen(false)} palette={p}><CommandSearch tools={tools} palette={p} onOpen={openTool} onNavigate={setTab} onProfile={()=>setSettings(true)} onClose={()=>setCommandOpen(false)}/></Sheet>}
          <Sheet
            visible={calendar}
            onClose={() => {
              setCalendar(false);
              setEditingDate(null);
            }}
            title="Choose your date range"
            palette={p}
          >
            <Text style={[ui.body, { color: p.muted }]}>
              All charts update together. Choose up to 366 days.
            </Text>
            <View style={[ui.row, { gap: 8 }]}>
              {[7, 30, 90].map((days) => (
                <Pressable
                  key={days}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected:
                      draft.from === presetPeriod(days).from &&
                      draft.to === presetPeriod(days).to,
                  }}
                  onPress={() => {
                    setDraft(presetPeriod(days));
                    setEditingDate(null);
                  }}
                  style={[
                    ui.button,
                    {
                      flex: 1,
                      paddingHorizontal: 6,
                      backgroundColor:
                        draft.from === presetPeriod(days).from &&
                        draft.to === presetPeriod(days).to
                          ? p.primary
                          : p.wash,
                    },
                  ]}
                >
                  <Text
                    style={[
                      ui.buttonText,
                      {
                        color:
                          draft.from === presetPeriod(days).from &&
                          draft.to === presetPeriod(days).to
                            ? p.onPrimary
                            : p.text,
                        fontSize: 12,
                      },
                    ]}
                  >
                    Last {days} days
                  </Text>
                </Pressable>
              ))}
            </View>
            {(["from", "to"] as const).map((field) => (
              <View key={field} style={{ gap: 7 }}>
                <Text style={[ui.small, { color: p.muted }]}>
                  {field === "from" ? "Start date" : "End date"}
                </Text>
                <Action
                  label={draft[field]}
                  palette={p}
                  secondary
                  onPress={() => setEditingDate(field)}
                />
              </View>
            ))}
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
              <Text
                accessibilityRole="alert"
                style={[ui.small, { color: p.waiting }]}
              >
                {draftError}
              </Text>
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
            palette={p}
          >
            <View style={{ gap: 14 }}>
              {selectedTool && (
                <>
                  <Artwork id={selectedTool.id} size={64} palette={p} />
                  <Text style={[ui.body, { color: p.muted }]}>
                    {selectedTool.description}
                  </Text>
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
                        { backgroundColor: p.wash, borderColor: p.border },
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
      </Animated.View>
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
