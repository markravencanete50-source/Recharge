import { Text } from "./Typography";
import {
  useMemo,
  useState,
  useRef,
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
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { FEATURE_ICONS } from "./Artwork";
import { FilterBar } from "./FilterBar";
import { ProgressRing, StateGraphic } from "./StateGraphic";
import Svg, { Path, Rect, Line } from "react-native-svg";
import { Entrance, MotionPress as Pressable, useReducedMotion } from "./motion";
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
  type WorkspaceRole,
  type WorkItem,
} from "./model";
import {
  calendarCells,
  WORKSPACE_MAP,
  type WorkspaceSection,
} from "../../lib/workspace-map";
import { presetPeriod } from "../../lib/analytics";
import { DepartmentGrid } from "./DepartmentGrid";

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
};

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
  const tone = departmentColor(variant % 2 ? "clients" : "stays", p);
  return (
    <View
      accessible={false}
      style={{
        width: 76,
        height: 88,
        backgroundColor: tone.wash,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={64} height={74} viewBox="0 0 64 74">
        <Rect x="12" y="28" width="40" height="35" rx="2" fill={p.surface} />
        <Path
          d={variant % 2 ? "M6 29L32 8L58 29Z" : "M8 30L18 14H46L56 30Z"}
          fill={tone.ink}
        />
        <Rect x="29" y="47" width="11" height="16" rx="2" fill={tone.ink} />
        <Rect
          x="19"
          y="36"
          width="8"
          height="8"
          rx="1"
          fill={tone.ink}
          opacity="0.6"
        />
        <Rect
          x="37"
          y="36"
          width="8"
          height="8"
          rx="1"
          fill={tone.ink}
          opacity="0.6"
        />
        <Line
          x1="6"
          x2="58"
          y1="64"
          y2="64"
          stroke={tone.ink}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function LinkRow({
  title,
  subtitle,
  icon,
  palette: p,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[ui.row, { gap: 14, minHeight: 68, paddingVertical: 12 }]}
    >
      <View
        style={{
          backgroundColor: p.wash,
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={20} color={p.primary} />
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.record.title}, ${item.tool.name}, ${item.record.status.replaceAll("_", " ")}`}
      onPress={onPress}
      style={[
        ui.row,
        {
          gap: 12,
          paddingVertical: 15,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
        },
      ]}
    >
      <View
        style={{
          backgroundColor: tone.wash,
          width: 44,
          height: 44,
          borderRadius: 14,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Feather
          name={FEATURE_ICONS[item.tool.id]}
          size={20}
          color={tone.ink}
        />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            color: p.text,
            fontSize: 16,
            lineHeight: 22,
            fontWeight: "600",
          }}
        >
          {item.record.title}
        </Text>
        <Text style={[ui.small, { color: p.muted }]}>{item.tool.name}</Text>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <View
            style={[
              ui.row,
              {
                backgroundColor: tone.wash,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 7,
                gap: 5,
              },
            ]}
          >
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: isWaiting(item.record.status)
                  ? p.waiting
                  : p.chart,
              }}
            />
            <Text
              style={{
                fontSize: 12,
                lineHeight: 18,
                color: tone.ink,
                fontWeight: "500",
              }}
            >
              {item.record.status.replaceAll("_", " ")}
            </Text>
          </View>
          <Text style={{ fontSize: 12, lineHeight: 18, color: p.muted }}>
            {displayDate(item.record.date)}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={p.muted} />
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
function WeekStrip({
  selected,
  onSelect,
  palette: p,
  items,
}: {
  selected: string;
  onSelect: (date: string) => void;
  palette: Palette;
  items: WorkItem[];
}) {
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const dayWidth = Math.max(44, (Math.min(width, 760) - 40 - 36) / 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(`${presetPeriod(1).to}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + i);
    return { date: day, key: day.toISOString().slice(0, 10) };
  });
  const selectedIndex = days.findIndex((day) => day.key === selected);
  useEffect(() => {
    scroll.current?.scrollTo({
      x: Math.max(
        0,
        selectedIndex * (dayWidth + 6) -
          (Math.min(width, 760) - 40 - dayWidth) / 2,
      ),
      animated: !reduced,
    });
  }, [dayWidth, width, selectedIndex, reduced]);
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingVertical: 1 }}
    >
      {days.map(({ date, key }) => {
        const active = selected === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Schedule for ${displayDate(key)}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(key)}
            style={{
              width: dayWidth,
              minHeight: 72,
              borderRadius: 15,
              backgroundColor: active ? p.primary : p.surface,
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
            }}
          >
            <Text
              style={{ color: active ? p.onPrimary : p.muted, fontSize: 12 }}
            >
              {date
                .toLocaleDateString("en-GB", {
                  weekday: "short",
                  timeZone: "UTC",
                })
                .slice(0, 2)}
            </Text>
            <Text
              style={{
                color: active ? p.onPrimary : p.text,
                fontSize: 17,
                fontWeight: "600",
              }}
            >
              {date.getUTCDate()}
            </Text>
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: items.some((item) => item.record.date === key)
                  ? active
                    ? p.onPrimary
                    : p.primary
                  : "transparent",
              }}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
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
          style={[
            ui.iconButton,
            { backgroundColor: p.wash, borderColor: p.border },
          ]}
        >
          <Feather name="chevron-left" size={20} color={p.text} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: "600", color: p.text }}>
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
          style={[
            ui.iconButton,
            { backgroundColor: p.wash, borderColor: p.border },
          ]}
        >
          <Feather name="chevron-right" size={20} color={p.text} />
        </Pressable>
      </View>
      <View style={ui.row}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <Text
            key={index}
            style={{
              width: "14.2857%",
              textAlign: "center",
              fontSize: 13,
              color: p.muted,
              paddingVertical: 8,
            }}
          >
            {day}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
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
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  backgroundColor: selected === day ? p.primary : "transparent",
                  gap: 3,
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
}: Props) {
  const items = useMemo(() => workFor(role), [role]);
  const properties = useMemo(() => propertiesFor(role), [role]);
  const [query, setQuery] = useState("");
  const [propertyQuery, setPropertyQuery] = useState("");
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
  const waiting = pending.filter((item) => isWaiting(item.record.status));
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
      style={[
        ui.row,
        {
          borderRadius: 14,
          minHeight: 50,
          borderWidth: 1,
          borderColor: p.border,
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
          fontFamily: "Inter_400Regular",
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
            width: 40,
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
      onPress={() => onOpen(item.tool, item.record)}
    />
  );
  const saved = toolsFor(role).filter((tool) => savedTools.includes(tool.id));

  return (
    <>
      {section === "home" ? (
        <>
          <View style={{ gap: 7 }}>
            <View style={ui.between}>
              <Text style={[ui.small, { color: p.muted, flex: 1 }]}>
                Hello, {profileName.split(" ")[0]}.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open calendar"
                onPress={() => onNavigate("calendar")}
                style={[ui.row, { minHeight: 44, gap: 7 }]}
              >
                <Feather name="calendar" size={15} color={p.primary} />
                <Text
                  style={{ color: p.primary, fontSize: 13, fontWeight: "500" }}
                >
                  {displayDate(presetPeriod(1).to).replace(/ \d{4}$/, "")}
                </Text>
              </Pressable>
            </View>
            <Text
              accessibilityRole="header"
              style={[ui.title, { color: p.text }]}
            >
              {role === "client"
                ? "A clearer picture."
                : "Let's make progress."}
            </Text>
            <Text style={[ui.body, { color: p.muted }]}>
              {role === "cleans"
                ? "Your jobs, schedule and updates in one place."
                : role === "client"
                  ? "Your properties, decisions and latest updates."
                  : "Your people and properties, working together."}
            </Text>
          </View>
          <Entrance>
            <View
              style={{
                backgroundColor: p.hero,
                borderRadius: 24,
                padding: 22,
                gap: 20,
                overflow: "hidden",
              }}
            >
              <View
                accessible={false}
                style={{
                  position: "absolute",
                  right: -55,
                  top: -80,
                  width: 240,
                  height: 240,
                  borderRadius: 120,
                  borderWidth: 1,
                  borderColor: p.heroLine,
                  opacity: 0.35,
                }}
              />
              <View style={[ui.row, { gap: 18 }]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text
                    style={{
                      color: p.heroMuted,
                      fontSize: 13,
                      fontWeight: "500",
                    }}
                  >
                    {role === "client"
                      ? "Waiting for your decision"
                      : "Your work at a glance"}
                  </Text>
                  <Text
                    style={{
                      color: p.heroText,
                      fontSize: 42,
                      lineHeight: 50,
                      fontWeight: "600",
                      letterSpacing: -1.5,
                    }}
                  >
                    {role === "client"
                      ? approvalItems(role).length
                      : pending.length}
                  </Text>
                  <Text
                    style={{ color: p.heroMuted, fontSize: 14, lineHeight: 21 }}
                  >
                    {role === "client"
                      ? "approvals to review"
                      : "open work items"}
                  </Text>
                </View>
                <View style={{ gap: 5, alignItems: "center" }}>
                  <ProgressRing
                    completed={
                      items.filter((item) => isComplete(item.record.status))
                        .length
                    }
                    total={items.length}
                  />
                  <Text style={{ fontSize: 12, color: p.heroMuted }}>
                    {items.length ? "Work completed" : "No work yet"}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  role === "client"
                    ? "Review your approvals"
                    : "Open your work queue"
                }
                onPress={() =>
                  role === "client" ? onNavigate("approvals") : openQueue()
                }
                style={[
                  ui.between,
                  {
                    borderTopWidth: 1,
                    borderColor: p.heroLine,
                    paddingTop: 16,
                    minHeight: 48,
                  },
                ]}
              >
                <Text
                  style={{ color: p.heroText, fontSize: 14, fontWeight: "600" }}
                >
                  {role === "client" ? "Review approvals" : "See your work"}
                </Text>
                <Feather name="arrow-right" size={20} color={p.heroText} />
              </Pressable>
            </View>
          </Entrance>
          <View style={[ui.row, { gap: 12 }]}>
            {[
              {
                label: "Waiting",
                value: waiting.length,
                icon: "clock" as const,
                bg: p.cautionWash,
                action: () => openQueue("Waiting"),
              },
              {
                label: "Properties",
                value: properties.length,
                icon: "home" as const,
                bg: p.utilityArt,
                action: () => onNavigate("properties"),
              },
            ].map((stat) => (
              <Pressable
                key={stat.label}
                accessibilityRole="button"
                accessibilityLabel={stat.label + ": " + stat.value}
                onPress={stat.action}
                style={{
                  flex: 1,
                  padding: 16,
                  backgroundColor: stat.bg,
                  borderRadius: 18,
                  gap: 10,
                }}
              >
                <View style={ui.between}>
                  <Feather name={stat.icon} size={19} color={p.text} />
                  <Feather name="arrow-up-right" size={16} color={p.text} />
                </View>
                <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                  <Text
                    style={{
                      fontSize: 26,
                      fontWeight: "600",
                      letterSpacing: -0.8,
                      color: p.text,
                    }}
                  >
                    {stat.value}
                  </Text>
                  <Text style={{ color: p.text, fontSize: 13 }}>
                    {stat.label}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 10 }}>
            <View style={ui.between}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                Your schedule
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open calendar"
                onPress={() => onNavigate("calendar")}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Feather name="arrow-up-right" size={20} color={p.primary} />
              </Pressable>
            </View>
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
                {displayDate(homeDate)}
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
                    <Feather name="coffee" size={21} color={p.success} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{ color: p.text, fontSize: 14, fontWeight: "500" }}
                    >
                      A little breathing room
                    </Text>
                    <Text style={[ui.small, { color: p.muted }]}>
                      No sample work scheduled for this day.
                    </Text>
                  </View>
                </View>
              )}
            </Entrance>
          </View>
          <View style={{ gap: 10 }}>
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
          </View>
          <View style={{ gap: 8 }}>
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
              <View>{pending.slice(0, 3).map(openRow)}</View>
            ) : (
              <Empty
                title="You're up to date"
                detail="There are no active sample tasks in this workspace."
                palette={p}
              />
            )}
          </View>
        </>
      ) : null}

      {section === "work" || section === "calendar" ? (
        <>
          {heading(
            role === "cleans" ? "Your jobs" : "Your work",
            "Find the next action, then keep things moving.",
          )}
          {search("Search job or property titles")}
          <Chips
            values={["List", "Calendar"]}
            selected={section === "calendar" ? "Calendar" : view}
            onSelect={(value) => {
              setView(value);
              if (section === "calendar" && value === "List")
                onNavigate("work");
            }}
            palette={p}
          />
          {section === "calendar" || view === "Calendar" ? (
            <>
              <Calendar
                selected={date}
                onSelect={setDate}
                items={items}
                palette={p}
              />
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                {displayDate(date)}
              </Text>
            </>
          ) : (
            <Chips
              values={["Active", "Waiting", "Completed", "All"]}
              selected={filter}
              onSelect={setFilter}
              palette={p}
            />
          )}
          {(() => {
            const results = items
              .filter((item) =>
                `${item.record.title} ${item.record.propertyName || ""}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
              )
              .filter((item) =>
                section === "calendar" || view === "Calendar"
                  ? item.record.date === date
                  : filter === "All" ||
                    (filter === "Completed"
                      ? isComplete(item.record.status)
                      : filter === "Waiting"
                        ? isWaiting(item.record.status)
                        : !isComplete(item.record.status)),
              );
            return (
              <>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[ui.small, { color: p.muted }]}
                >
                  {results.length} {results.length === 1 ? "item" : "items"}
                </Text>
                {results.length ? (
                  <View style={[ui.card, card, { paddingVertical: 0 }]}>
                    {results.map(openRow)}
                  </View>
                ) : (
                  <Empty
                    title="No work in this view"
                    detail="Try another status, search or calendar date."
                    palette={p}
                  />
                )}
              </>
            );
          })()}
        </>
      ) : null}

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
          {search("Search property names")}
          {properties
            .filter((property) =>
              property.propertyName
                .toLowerCase()
                .includes(propertyQuery.trim().toLowerCase()),
            )
            .map((property, index) => (
              <Entrance key={property.id} delay={index * 40}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${property.propertyName}`}
                  onPress={() => setSelectedProperty(property)}
                  style={[ui.card, card]}
                >
                  <View style={[ui.row, { gap: 14 }]}>
                    <PropertyScene palette={p} variant={index} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text
                        style={{
                          color: p.text,
                          fontSize: 18,
                          lineHeight: 24,
                          fontWeight: "700",
                        }}
                      >
                        {property.propertyName}
                      </Text>
                      <Text style={[ui.small, { color: p.muted }]}>
                        {property.region}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      ui.between,
                      {
                        borderTopWidth: 1,
                        borderColor: p.border,
                        paddingTop: 12,
                      },
                    ]}
                  >
                    <Text style={[ui.small, { color: p.muted }]}>
                      {property.bedrooms} bedrooms, {property.bathrooms}{" "}
                      {Number(property.bathrooms) === 1 ? "bathroom" : "bathrooms"}
                    </Text>
                    <Feather
                      name="arrow-up-right"
                      color={p.primary}
                      size={20}
                    />
                  </View>
                </Pressable>
              </Entrance>
            ))}
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
            <View style={[ui.card, card, { paddingVertical: 0 }]}>
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

      {section === "inbox" ? (
        <>
          {heading(
            "Inbox",
            "Property mail and conversations within your access.",
          )}
          {inbox.length ? (
            <View style={[ui.card, card, { paddingVertical: 0 }]}>
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
              <View style={[ui.card, card, { paddingVertical: 0 }]}>
                {saved.map((tool) => (
                  <LinkRow
                    key={tool.id}
                    title={tool.name}
                    icon={FEATURE_ICONS[tool.id]}
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
            <View style={[ui.card, card, { paddingVertical: 0 }]}>
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
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderColor: p.border,
                  backgroundColor: p.surface,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to properties"
                onPress={() => setSelectedProperty(null)}
                style={[
                  ui.iconButton,
                  { backgroundColor: p.wash, borderColor: p.border },
                ]}
              >
                <Feather name="arrow-left" size={22} color={p.text} />
              </Pressable>
              <Text style={[ui.sectionTitle, { color: p.text, flex: 1 }]}>
                Property overview
              </Text>
            </View>
            <ScrollView contentContainerStyle={ui.page}>
              {selectedProperty ? (
                <>
                  {heading(
                    selectedProperty.propertyName,
                    selectedProperty.region,
                  )}
                  <View style={[ui.card, card]}>
                    <Text style={[ui.sectionTitle, { color: p.text }]}>
                      Property details
                    </Text>
                    <Text style={[ui.body, { color: p.muted }]}>
                      {selectedProperty.propertyAddress}
                    </Text>
                    <Text style={[ui.body, { color: p.text }]}>
                      {selectedProperty.bedrooms} bedrooms,{" "}
                      {selectedProperty.bathrooms}{" "}
                      {Number(selectedProperty.bathrooms) === 1
                        ? "bathroom"
                        : "bathrooms"}
                    </Text>
                    <Text style={[ui.small, { color: p.muted }]}>
                      Status: {selectedProperty.status}
                    </Text>
                  </View>
                  <View style={[ui.card, card, { paddingVertical: 0 }]}>
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
                  <View style={[ui.card, card, { paddingVertical: 0 }]}>
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
                          icon={FEATURE_ICONS[tool.id]}
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
