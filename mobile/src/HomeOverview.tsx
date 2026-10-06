import { useEffect, useState } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Path } from "react-native-svg";
import { designTokens } from "../../lib/design-tokens";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { CountUp, Entrance, MotionPress, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

const hover = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "R";
}

// Mobile Home opens with the green bar flowing into a curved welcome panel,
// so the greeting, the person and their properties read as one moment.
export function WelcomeHeader({
  palette: p,
  name,
  dateLabel,
  subtitle,
  onCalendar,
}: {
  palette: Palette;
  name: string;
  dateLabel: string;
  subtitle: string;
  onCalendar: () => void;
}) {
  const reduced = useReducedMotion();
  const [float] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduced]);
  const t = designTokens[p.isDark ? "dark" : "light"];
  const bob = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const drift = float.interpolate({ inputRange: [0, 1], outputRange: [0, 8] });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <View testID="home-welcome" style={{ marginHorizontal: -20, marginTop: -24, backgroundColor: p.header, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 58, overflow: "hidden" }}>
      {/* Drifting clouds and the property pair sit behind the text on the right. */}
      <Animated.View pointerEvents="none" style={{ position: "absolute", right: 96, top: 24, opacity: 0.16, transform: [{ translateX: drift }] }}>
        <View style={{ width: 54, height: 18, borderRadius: 9, backgroundColor: "#FAF7F0" }} />
        <View style={{ position: "absolute", left: 12, top: -9, width: 26, height: 22, borderRadius: 11, backgroundColor: "#FAF7F0" }} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={{ position: "absolute", right: 4, bottom: 18, flexDirection: "row", alignItems: "flex-end", transform: [{ translateY: bob }] }}>
        <View style={{ marginRight: -22, marginBottom: 2 }}><DimensionalIcon name="house" size={84} /></View>
        <DimensionalIcon name="building" size={104} />
      </Animated.View>
      <View style={[ui.row, { gap: 14, paddingRight: 120 }]}>
        <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "#FAF7F0", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: p.isDark ? "#2E6B5E" : "#A7D9C1" }}>
          <Text style={{ color: "#1F3D38", fontSize: 22, fontWeight: "700", letterSpacing: -0.5 }}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.headerMuted, fontSize: 14, fontWeight: "500" }}>{greeting},</Text>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: p.headerText, fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.6 }}>{name.split(" ")[0]}</Text>
        </View>
      </View>
      <Text style={{ color: p.headerMuted, fontSize: 14, lineHeight: 21, marginTop: 14, paddingRight: 130 }}>{subtitle}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Open calendar, " + dateLabel}
        onPress={onCalendar}
        style={[ui.row, { alignSelf: "flex-start", marginTop: 14, minHeight: 36, gap: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: p.headerControl, borderWidth: 1, borderColor: p.headerBorder }]}
      >
        <Feather name="calendar" size={14} color={p.headerText} />
        <Text style={{ color: p.headerText, fontSize: 13, fontWeight: "600" }}>{dateLabel}</Text>
      </Pressable>
      <Svg pointerEvents="none" width="100%" height={44} viewBox="0 0 390 44" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: -1 }}>
        <Path d="M0 8 C 110 50, 250 46, 390 2 L390 44 L0 44 Z" fill={p.isDark ? "#2E6B5E" : "#A7D9C1"} opacity={0.35} />
        <Path d="M0 18 C 120 54, 260 50, 390 12 L390 44 L0 44 Z" fill={t.background} />
      </Svg>
    </View>
  );
}

export type OverviewItem = {
  key: string;
  icon: DimensionalName;
  value: number | null;
  suffix?: string;
  label: string;
  hint: string;
  onPress: () => void;
};

export function QuickOverview({
  palette: p,
  items,
  sessionKey,
  onReports,
}: {
  palette: Palette;
  items: OverviewItem[];
  sessionKey: string;
  onReports: () => void;
}) {
  const rows = [items.slice(0, 2), items.slice(2, 4)];
  return (
    <Entrance sessionKey={sessionKey} style={{ gap: 14, marginTop: -6 }}>
      <View style={ui.between}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Quick overview</Text>
        <MotionPress
          accessibilityRole="button"
          accessibilityLabel="Open reports"
          onPress={onReports}
          style={[ui.row, { gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 12, borderRadius: 999, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}
        >
          <DimensionalIcon name="chart" size={32} />
          <Text style={{ color: p.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Reports</Text>
          <Feather name="chevron-right" size={16} color={p.muted} />
        </MotionPress>
      </View>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 12 }}>
          {row.map(item => (
            <MotionPress
              key={item.key}
              {...hover}
              accessibilityRole="button"
              accessibilityLabel={`${item.value ?? "Unavailable"}${item.suffix ?? ""} ${item.label}. ${item.hint}`}
              onPress={item.onPress}
              style={{
                flex: 1,
                minWidth: 0,
                padding: 16,
                gap: 12,
                borderRadius: 24,
                backgroundColor: p.surface,
                borderWidth: 1,
                borderColor: p.border,
                ...(Platform.OS === "web" ? { boxShadow: "0 14px 30px -24px rgba(21, 45, 40, 0.45)" } : { elevation: 2 }),
              }}
            >
              <View style={[ui.between, { alignItems: "flex-start" }]}>
                <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
                  <DimensionalIcon name={item.icon} size={42} />
                </View>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </View>
              <View style={{ gap: 2 }}>
                <View style={[ui.row, { gap: 1, alignItems: "flex-end" }]}>
                  {item.value === null ? (
                    <Text style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>—</Text>
                  ) : (
                    <CountUp value={item.value} sessionKey={sessionKey + ":" + item.key} style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -1 }} />
                  )}
                  {!!item.suffix && item.value !== null && <Text style={{ color: p.text, fontSize: 18, lineHeight: 30, fontWeight: "700" }}>{item.suffix}</Text>}
                </View>
                <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>{item.label}</Text>
              </View>
            </MotionPress>
          ))}
        </View>
      ))}
    </Entrance>
  );
}
