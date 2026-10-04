import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { AccountSetup, Avatar, type Profile } from "./src/AccountSetup";
import { Artwork } from "./src/Artwork";
import { LineChart, QueueChart, StatusChart } from "./src/Charts";
import { themes, ui, type Palette } from "./src/theme";
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
  upcomingFor,
  type AnalyticsPeriod,
  type PreviewRecord,
  type Tool,
  type WorkspaceRole,
} from "./src/model";

type Tab = "home" | "workspace" | "analytics";
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
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={ui.modalOverlay}>
        <SafeAreaView
          edges={["bottom"]}
          style={[ui.modalSheet, { backgroundColor: p.surface }]}
          accessibilityViewIsModal
        >
          <View style={[ui.handle, { backgroundColor: p.muted }]} />
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
          {children}
        </SafeAreaView>
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
function AppContent() {
  const systemTheme = useColorScheme();
  const [theme, setTheme] = useState<"light" | "dark">(
    systemTheme === "dark" ? "dark" : "light",
  );
  const p = themes[theme];
  const [role, setRole] = useState<WorkspaceRole>("super_admin");
  const { section } = useLocalSearchParams<{ section: string }>();
  const tab: Tab =
    section === "analytics" || section === "workspace" ? section : "home";
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
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PreviewRecord | null>(
    null,
  );
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => presetPeriod(30));
  const [draft, setDraft] = useState(period);
  const [calendar, setCalendar] = useState(false);
  const [editingDate, setEditingDate] = useState<"from" | "to" | null>(null);
  const [chartData, setChartData] = useState(false);
  const [fade] = useState(() => new Animated.Value(1));
  const scroll = useRef<ScrollView>(null);
  const snapshot = useMemo(() => snapshotFor(role), [role]);
  const data = useMemo(
    () => buildAnalytics(snapshot, period),
    [snapshot, period],
  );
  const tools = useMemo(() => toolsFor(role), [role]);
  const upcoming = useMemo(() => upcomingFor(role), [role]);
  const roleLabel = roles.find((item) => item.value === role)!.label;
  const draftError = periodError(draft);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      scroll.current?.scrollTo({ y: 0, animated: false });
      if (reduce) {
        fade.setValue(1);
        return;
      }
      fade.setValue(0);
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelled = true;
      fade.stopAnimation();
    };
  }, [tab, role, fade]);
  const card = { backgroundColor: p.surface, borderColor: p.border };
  const switchRole = (value: WorkspaceRole) => {
    setRole(value);
    setSettings(false);
    setSearch("");
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
              fontSize: 9,
              letterSpacing: 2,
              marginTop: 3,
            }}
          >
            YOUR WORKSPACE
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
      <View
        style={[
          ui.between,
          {
            paddingHorizontal: 22,
            paddingVertical: 8,
            backgroundColor: p.wash,
          },
        ]}
      >
        <Text style={{ color: p.muted, fontSize: 10 }}>LOCAL APP PREVIEW</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change preview role"
          onPress={() => setSettings(true)}
          style={[ui.row, { gap: 5, minHeight: 28 }]}
        >
          <Text style={{ color: p.text, fontSize: 11, fontWeight: "600" }}>
            {roleLabel}
          </Text>
          <Feather name="chevron-down" size={13} color={p.text} />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        style={ui.fill}
        contentContainerStyle={ui.page}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fade, gap: 22 }}>
          <View>
            <Text style={[ui.eyebrow, { color: p.muted }]}>
              {tab === "home"
                ? "AT A GLANCE"
                : tab === "workspace"
                  ? "YOUR TOOLS"
                  : "WORKSPACE INTELLIGENCE"}
            </Text>
            <Text
              accessibilityRole="header"
              style={[ui.title, { color: p.text }]}
            >
              {tab === "home"
                ? "Welcome back."
                : tab === "workspace"
                  ? "Your workspace."
                  : snapshot.title}
            </Text>
            <Text style={[ui.body, { color: p.muted, marginTop: 8 }]}>
              {tab === "home"
                ? "Every property. Every team. One clear picture."
                : tab === "workspace"
                  ? "Everything you need to keep your day moving."
                  : snapshot.description}
            </Text>
          </View>
          {tab !== "workspace" && (
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
                  <View key={item.label} style={[ui.stat, card]}>
                    <View style={ui.between}>
                      <Text
                        style={{
                          color: p.muted,
                          fontSize: 11,
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
                  </View>
                ))}
              </View>
            </>
          )}
          {tab === "home" && (
            <>
              <View
                style={[
                  ui.card,
                  {
                    backgroundColor: p.primary,
                    borderColor: p.primary,
                    padding: 22,
                  },
                ]}
              >
                <Text
                  style={{
                    color: p.onPrimary,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    fontWeight: "600",
                  }}
                >
                  PERFECTION AT EVERY STAGE
                </Text>
                <Text
                  style={{
                    color: p.onPrimary,
                    fontSize: 23,
                    fontWeight: "600",
                    lineHeight: 30,
                    letterSpacing: -0.5,
                  }}
                >
                  A simpler way to manage your day.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTab("workspace")}
                  style={[ui.between, { marginTop: 8, paddingVertical: 8 }]}
                >
                  <Text
                    style={{
                      color: p.onPrimary,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    Explore your tools
                  </Text>
                  <Feather
                    name="arrow-up-right"
                    size={20}
                    color={p.onPrimary}
                  />
                </Pressable>
              </View>
              <View style={ui.between}>
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Your next steps
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Sample activity
                </Text>
              </View>
              <View style={[ui.card, card]}>
                {upcoming.records.length ? (
                  upcoming.records.map((record) => (
                    <RecordRow
                      key={record.id}
                      record={record}
                      palette={p}
                      onPress={() => {
                        setSelectedTool(upcoming.tool ?? null);
                        setSelectedRecord(record);
                      }}
                    />
                  ))
                ) : (
                  <Text style={[ui.body, { color: p.muted }]}>
                    No sample tasks in this workspace. Explore your tools to
                    review the available areas.
                  </Text>
                )}
              </View>
              <Action
                label="View your analytics"
                palette={p}
                secondary
                onPress={() => setTab("analytics")}
              />
            </>
          )}
          {tab === "workspace" && (
            <>
              <TextInput
                accessibilityLabel="Search workspace tools"
                placeholder="Search your tools"
                placeholderTextColor={p.muted}
                value={search}
                onChangeText={setSearch}
                style={[
                  ui.input,
                  {
                    color: p.text,
                    backgroundColor: p.surface,
                    borderColor: p.border,
                  },
                ]}
              />
              {tools
                .filter((tool) =>
                  tool.name
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                )
                .map((tool) => (
                  <Pressable
                    key={tool.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${tool.name}`}
                    onPress={() => {
                      setSelectedRecord(null);
                      setSelectedTool(tool);
                    }}
                    style={({ pressed }) => [
                      ui.card,
                      card,
                      { opacity: pressed ? 0.75 : 1 },
                    ]}
                  >
                    <View style={ui.between}>
                      <Artwork id={tool.id} />
                      <View style={[ui.tag, { backgroundColor: p.wash }]}>
                        <Text style={[ui.tagText, { color: p.muted }]}>
                          {tool.category}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={{
                        color: p.text,
                        fontSize: 19,
                        fontWeight: "700",
                        lineHeight: 25,
                        letterSpacing: -0.3,
                      }}
                    >
                      {tool.name}
                    </Text>
                    <Text style={[ui.body, { color: p.muted }]}>
                      {tool.description}
                    </Text>
                    <View
                      style={[
                        ui.between,
                        {
                          marginTop: 4,
                          paddingTop: 14,
                          borderTopWidth: 1,
                          borderTopColor: p.border,
                        },
                      ]}
                    >
                      <Text style={[ui.small, { color: p.muted }]}>
                        {tool.audience}
                      </Text>
                      <View style={[ui.row, { gap: 10 }]}>
                        <Text
                          style={{
                            color: p.text,
                            fontWeight: "600",
                            fontSize: 12,
                          }}
                        >
                          Open centre
                        </Text>
                        <Feather
                          name="arrow-up-right"
                          size={18}
                          color={p.text}
                        />
                      </View>
                    </View>
                  </Pressable>
                ))}
              {!tools.some((tool) =>
                tool.name
                  .toLowerCase()
                  .includes(search.trim().toLowerCase()),
              ) && (
                <View style={[ui.card, card]}>
                  <Text style={[ui.sectionTitle, { color: p.text }]}>
                    No matching tools
                  </Text>
                  <Text style={[ui.body, { color: p.muted }]}>
                    Try another feature title.
                  </Text>
                  <Action
                    label="Clear search"
                    secondary
                    palette={p}
                    onPress={() => setSearch("")}
                  />
                </View>
              )}
            </>
          )}
          {tab === "analytics" && (
            <>
              <View style={[ui.card, card]}>
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Activity over time
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Daily records within your access
                </Text>
                <LineChart data={data} palette={p} />
              </View>
              <View style={[ui.card, card]}>
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  Work status
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  Current status in this period
                </Text>
                <StatusChart data={data} palette={p} />
              </View>
              <View style={[ui.card, card]}>
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
              </View>
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
              fontSize: 10,
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
        {(
          [
            { value: "home", label: "Home", icon: "home" },
            { value: "workspace", label: "Workspace", icon: "grid" },
            { value: "analytics", label: "Analytics", icon: "bar-chart-2" },
          ] as const
        ).map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.value }}
            onPress={() => setTab(item.value)}
            style={({ pressed }) => [
              ui.tab,
              {
                backgroundColor: tab === item.value ? p.wash : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name={item.icon}
              size={21}
              color={tab === item.value ? p.primary : p.muted}
            />
            <Text
              style={[
                ui.tabLabel,
                { color: tab === item.value ? p.text : p.muted },
              ]}
            >
              {item.label}
            </Text>
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
        <ScrollView>
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
        </ScrollView>
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
              onPress={() => setDraft(presetPeriod(days))}
              style={[
                ui.button,
                { flex: 1, paddingHorizontal: 6, backgroundColor: p.wash },
              ]}
            >
              <Text style={[ui.buttonText, { color: p.text, fontSize: 11 }]}>
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
      <Sheet
        visible={Boolean(selectedTool)}
        onClose={() => {
          setSelectedTool(null);
          setSelectedRecord(null);
        }}
        title={selectedTool?.name ?? "Workspace tool"}
        palette={p}
      >
        <ScrollView contentContainerStyle={{ gap: 14 }}>
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
              ) : recordsFor(role, selectedTool.id).length ? (
                recordsFor(role, selectedTool.id).map((record) => (
                  <RecordRow
                    key={record.id}
                    record={record}
                    palette={p}
                    onPress={() => setSelectedRecord(record)}
                  />
                ))
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
                </View>
              )}
              <Text style={[ui.small, { color: p.muted }]}>
                Preview records are read-only.
              </Text>
            </>
          )}
        </ScrollView>
      </Sheet>
      <Sheet
        visible={chartData}
        onClose={() => setChartData(false)}
        title="Daily chart data"
        palette={p}
      >
        <ScrollView>
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
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
