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
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable as NativePressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
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
import { LineChart, QueueChart, StatusChart } from "./src/Charts";
import { themes, ui, type Palette } from "./src/theme";
import { WorkspaceScreens } from "./src/WorkspaceScreens";
import { ToolDirectory } from "./src/ToolDirectory";
import { usePreviewBookmarks } from "./src/usePreviewPreferences";
import { navigationFor, type WorkspaceSection } from "../lib/workspace-map";
import {
  Entrance,
  MotionPress as Pressable,
  MotionProvider,
  useReducedMotion,
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
  const { height } = useWindowDimensions();
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
      animationType={reduced ? "none" : "slide"}
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={ui.modalOverlay}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${title}`}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={{ maxHeight: height * 0.9 }}
        >
          <Animated.View
            style={{
              maxHeight: height * 0.9,
              transform: [{ translateY: drag }],
            }}
          >
            <SafeAreaView
              edges={["bottom"]}
              style={[
                ui.modalSheet,
                { backgroundColor: p.surface, maxHeight: height * 0.9 },
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
          <Text style={{ color: p.muted, fontSize: 10 }}>{record.date}</Text>
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
function DetailScreen({ visible, onClose, title, palette: p, children }: { visible: boolean; onClose: () => void; title: string; palette: Palette; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <Modal visible={visible} animationType={reduced ? "none" : "slide"} onRequestClose={onClose}>
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]}>
      <View style={[ui.row, { paddingHorizontal: 20, paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
        <IconButton label="Back to workspace" icon="arrow-left" onPress={onClose} palette={p} />
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flex: 1 }]}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">{children}</ScrollView>
    </SafeAreaView>
  </Modal>;
}
function AppContent() {
  const systemTheme = useColorScheme();
  const [theme, setTheme] = useState<"light" | "dark">(
    systemTheme === "dark" ? "dark" : "light",
  );
  const p = themes[theme];
  const [role, setRole] = useState<WorkspaceRole>("super_admin");
  const { section } = useLocalSearchParams<{ section: string }>();
  const sections: WorkspaceSection[] = ["home", "work", "properties", "inbox", "more", "workspace", "analytics", "calendar", "approvals"];
  const tab: Tab = sections.includes(section as Tab) ? section as Tab : "home";
  const setTab = (value: Tab) => router.setParams({ section: value });
  const [profile, setProfile] = useState<Profile>({
    displayName: "Preview User",
    avatar: "forest",
  });
  const [accountMode, setAccountMode] = useState<"register" | "preview" | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [savedOnly, setSavedOnly] = useState(false);
  const { saved: savedTools, toggle: toggleSaved, error: bookmarkError, loaded: bookmarksLoaded } = usePreviewBookmarks(role);
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
  const [fade] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const snapshot = useMemo(() => snapshotFor(role), [role]);
  const data = useMemo(
    () => buildAnalytics(snapshot, period),
    [snapshot, period],
  );
  const tools = useMemo(() => toolsFor(role), [role]);
  const savedCount = tools.filter((tool) =>
    savedTools.includes(tool.id),
  ).length;
  const toolRecords = selectedTool ? recordsFor(role, selectedTool.id) : [];
  const visibleRecords = toolRecords.filter(
    (record) =>
      record.title.toLowerCase().includes(recordSearch.trim().toLowerCase()) &&
      (recordStatus === "All" || record.status === recordStatus),
  );
  const openTool = (tool: Tool, record: PreviewRecord | null = null) => {
    if (!tools.some(allowed => allowed.id === tool.id)) return;
    Keyboard.dismiss();
    setRecordSearch("");
    setRecordStatus("All");
    setSelectedTool(tool);
    setSelectedRecord(record);
  };
  const roleLabel = roles.find((item) => item.value === role)!.label;
  const draftError = periodError(draft);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    Keyboard.dismiss();
    if (reduced) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    return () => {
      fade.stopAnimation();
    };
  }, [tab, role, fade, reduced]);
  const card = { backgroundColor: p.surface, borderColor: p.border };
  const switchRole = (value: WorkspaceRole) => {
    setRole(value);
    setSettings(false);
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
  const statItems = [
    { label: "Recorded items", value: data.total, icon: "activity" as const },
    { label: "Completed", value: data.complete, icon: "check-circle" as const },
    { label: "Waiting", value: data.waiting, icon: "clock" as const },
    {
      label: snapshot.propertyLabel,
      value: snapshot.propertyCount,
      icon: "home" as const,
    },
  ];
  return (
    <SafeAreaView
      style={[ui.fill, { backgroundColor: p.background }]}
      edges={["top", "bottom"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <View
        style={[
          ui.between,
          {
            paddingHorizontal: 22,
            paddingVertical: 13,
            borderBottomWidth: 1,
            borderBottomColor: p.border,
            backgroundColor: p.surface,
          },
        ]}
      >
        <View>
          <Text
            style={{
              color: p.text,
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: -0.6,
            }}
          >
            RECHARGE
          </Text>
          <Text
            style={{
              color: p.muted,
              fontSize: 12,
              letterSpacing: 0,
              marginTop: 3,
            }}
          >
            {roleLabel} · Sample workspace
          </Text>
        </View>
        <View style={[ui.row, { gap: 10 }]}>
          <IconButton
            label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            icon={theme === "dark" ? "sun" : "moon"}
            palette={p}
            onPress={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile and preview roles"
            onPress={() => setSettings(true)}
          >
            <Avatar profile={profile} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={ui.fill}
        contentContainerStyle={ui.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={{
            opacity: fade,
            gap: 22,
            transform: [
              {
                translateY: fade.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          }}
        >
          {tab === "analytics" && <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{snapshot.title}</Text><Text style={[ui.body, { color: p.muted }]}>{snapshot.description}</Text></View>}
          {tab === "analytics" && (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose analytics date range"
                onPress={() => {
                  setDraft(period);
                  setCalendar(true);
                }}
                style={[
                  ui.between,
                  ui.button,
                  {
                    backgroundColor: p.surface,
                    borderWidth: 1,
                    borderColor: p.border,
                  },
                ]}
              >
                <View style={[ui.row, { gap: 8 }]}>
                  <Feather name="calendar" size={17} color={p.text} />
                  <Text
                    style={{ color: p.text, fontSize: 12, fontWeight: "600" }}
                  >
                    {periodLabel(period)}
                  </Text>
                </View>
                <Feather name="chevron-down" size={16} color={p.muted} />
              </Pressable>
              <View style={ui.statGrid}>
                {statItems.map((item) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}: ${item.value}. Open analytics`}
                    onPress={() => setTab("analytics")}
                    style={[ui.stat, card]}
                  >
                    <View style={ui.between}>
                      <Text
                        style={{
                          color: p.muted,
                          fontSize: 13,
                          fontWeight: "600",
                          flex: 1,
                          marginRight: 8,
                        }}
                      >
                        {item.label}
                      </Text>
                      <Feather name={item.icon} size={17} color={p.muted} />
                    </View>
                    <Text style={[ui.statValue, { color: p.text }]}>
                      {item.value}
                    </Text>
                    <Text style={{ color: p.muted, fontSize: 10 }}>
                      {item.icon === "home"
                        ? "Current property snapshot"
                        : "In the selected period"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <WorkspaceScreens key={role} section={tab} role={role} palette={p} onNavigate={setTab} onOpen={openTool} onProfile={() => setSettings(true)} savedCount={savedCount} />
          {tab === "workspace" && <ToolDirectory role={role} palette={p} query={search} onQuery={setSearch} area={department} onArea={setDepartment} saved={savedTools} onlySaved={savedOnly} onOnlySaved={() => setSavedOnly(!savedOnly)} onSave={toggleSaved} onOpen={openTool} storageError={bookmarksLoaded ? bookmarkError : "Loading saved tools"} />}
          {tab === "analytics" && (
            <>
              <Entrance
                trigger={`${period.from}:${period.to}:${role}`}
                style={[ui.card, card]}
              >
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Activity over time
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Daily records within your access
                </Text>
                <LineChart
                  key={`${period.from}:${period.to}:${role}`}
                  data={data}
                  palette={p}
                />
              </Entrance>
              <Entrance
                delay={60}
                trigger={`${period.from}:${period.to}:${role}`}
                style={[ui.card, card]}
              >
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Work status
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Current status in this period
                </Text>
                <StatusChart
                  key={`${period.from}:${period.to}:${role}`}
                  data={data}
                  palette={p}
                />
              </Entrance>
              <Entrance
                delay={120}
                trigger={`${period.from}:${period.to}:${role}`}
                style={[ui.card, card]}
              >
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Queue volume
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Records by source
                </Text>
                <QueueChart data={data} palette={p} />
              </Entrance>
              <Action
                label="View chart data"
                secondary
                palette={p}
                onPress={() => setChartData(true)}
              />
              <Text style={[ui.small, { color: p.muted }]}>
                Charts use fictional records and current status. Property counts
                show the current snapshot. Both range dates are included, using
                UK calendar dates.
              </Text>
            </>
          )}
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
      <View
        style={[
          ui.tabs,
          { backgroundColor: p.surface, borderTopColor: p.border },
        ]}
      >
        {navigationFor(role).map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.value || (item.value === "more" && tab === "workspace") }}
            onPress={() => setTab(item.value)}
            style={({ pressed }) => [
              ui.tab,
              {
                backgroundColor: (tab === item.value || (item.value === "more" && tab === "workspace")) ? p.wash : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Entrance
              trigger={(tab === item.value || (item.value === "more" && tab === "workspace")) ? "active" : "inactive"}
              style={{ alignItems: "center", gap: 5 }}
            >
              <Feather
                name={item.icon}
                size={21}
                color={(tab === item.value || (item.value === "more" && tab === "workspace")) ? p.primary : p.muted}
              />
              <Text
                style={[
                  ui.tabLabel,
                  { color: (tab === item.value || (item.value === "more" && tab === "workspace")) ? p.text : p.muted },
                ]}
              >
                {item.label}
              </Text>
            </Entrance>
          </Pressable>
        ))}
      </View>
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
                  backgroundColor: item.value === role ? p.wash : "transparent",
                },
              ]}
            >
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>
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
          onProfile={setProfile}
        />
      )}
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
        {editingDate && (
          <DateTimePicker
            value={parseAnalyticsDate(draft[editingDate])!}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={changeDate}
            themeVariant={theme}
          />
        )}
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
              <Artwork id={selectedTool.id} size={86} />
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
                        borderColor: p.border,
                        backgroundColor: p.wash,
                      },
                    ]}
                  />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                  >
                    {[
                      "All",
                      ...new Set(toolRecords.map((record) => record.status)),
                    ].map((status) => (
                      <Pressable
                        key={status}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: recordStatus === status,
                        }}
                        onPress={() => setRecordStatus(status)}
                        style={[
                          ui.button,
                          {
                            paddingHorizontal: 12,
                            backgroundColor:
                              recordStatus === status ? p.primary : p.wash,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            ui.small,
                            {
                              color:
                                recordStatus === status ? p.onPrimary : p.text,
                              fontWeight: "600",
                            },
                          ]}
                        >
                          {status.replaceAll("_", " ")}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={[ui.small, { color: p.muted }]}>
                    {visibleRecords.length} of {toolRecords.length} records
                  </Text>
                  {visibleRecords.map((record) => (
                    <RecordRow
                      key={record.id}
                      record={record}
                      palette={p}
                      onPress={() => setSelectedRecord(record)}
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
                  <Text style={[ui.sectionTitle, { color: p.text }]}>
                    No sample records
                  </Text>
                  <Text style={[ui.body, { color: p.muted }]}>
                    This native preview does not yet connect the live workflow
                    for this tool. Its detailed editing screens will be added
                    during the mobile build.
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
