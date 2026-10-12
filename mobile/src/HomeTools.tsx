import { useState } from "react";
import { Animated, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { DimensionalIcon } from "./DimensionalIcon";
import { MotionPress, Stagger, useReducedMotion } from "./motion";
import { TrackerSheet } from "./LiveTools";
import { FurnishingSheet } from "./LiveFurnishing";
import { ui, type Palette } from "./theme";
import { homeActionsFor, homeToolsFor, type HomeTool, type HomeToolTarget } from "../../lib/home-tools";
import { toolsFor, type Tool } from "../../lib/tool-directory";
import type { PropertyView } from "../../lib/workspace-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// One tool: its illustration lifts and tilts as it is pressed, then settles.
function ToolTile({ tool, palette: p, compact, onPress }: { tool: HomeTool; palette: Palette; compact: boolean; onPress: () => void }) {
  const reduced = useReducedMotion();
  const [lift] = useState(() => new Animated.Value(0));
  const native = Platform.OS !== "web";
  const press = (to: number) => { if (reduced) return; Animated.spring(lift, { toValue: to, speed: 26, bounciness: to ? 4 : 12, useNativeDriver: native }).start(); };
  const icon = compact ? 38 : 44;
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button" accessibilityLabel={`${tool.label}. ${tool.detail}`} onPress={onPress} onPressIn={() => press(1)} onPressOut={() => press(0)} onHoverIn={() => press(1)} onHoverOut={() => press(0)}
      style={{ flex: 1, minWidth: 0, minHeight: compact ? 112 : 132, padding: compact ? 10 : 14, gap: compact ? 8 : 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, alignItems: compact ? "center" : "flex-start",
        ...(Platform.OS === "web" ? { boxShadow: "var(--rc-elev-1),var(--rc-sheen)" } : { elevation: 1 }) }}>
      <Animated.View style={{ width: icon + 14, height: icon + 14, borderRadius: 18, backgroundColor: p.wash, alignItems: "center", justifyContent: "center",
        transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }, { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }, { rotate: lift.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-6deg"] }) }] }}>
        <DimensionalIcon name={tool.art} size={icon} color={p.primary} />
      </Animated.View>
      <View style={{ gap: 2, alignSelf: "stretch" }}>
        <Text numberOfLines={2} style={{ color: p.text, fontSize: compact ? 13 : 14, lineHeight: compact ? 17 : 19, fontWeight: "700", textAlign: compact ? "center" : "left" }}>{tool.label}</Text>
        {!compact && <Text numberOfLines={2} style={{ color: p.muted, fontSize: 12, lineHeight: 16 }}>{tool.detail}</Text>}
      </View>
    </MotionPress>
  );
}

// Home's "Your tools": the tools for this person's role, one tap from where they start the day.
export function HomeTools({ palette: p, account, properties, desktop, onOpen, onAll }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; desktop: boolean; onOpen: (target: HomeToolTarget) => void; onAll: () => void }) {
  const { width } = useWindowDimensions();
  const tools = homeToolsFor(account.role, account.modules), actions = homeActionsFor(account.role, account.modules);
  const [tracker, setTracker] = useState<Tool | null>(null);
  const [calculator, setCalculator] = useState(false);
  if (!tools.length) return null;
  const columns = desktop ? Math.min(5, Math.max(3, tools.length)) : width >= 600 ? 4 : 3;
  const rows = Array.from({ length: Math.ceil(tools.length / columns) }, (_, r) => tools.slice(r * columns, r * columns + columns));
  const open = (target: HomeToolTarget) => {
    if (target.kind === "tracker") setTracker(toolsFor(account.role, account.modules).find(t => t.id === target.module) ?? null);
    else if (target.kind === "calculator") setCalculator(true);
    else onOpen(target);
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={ui.between}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Your tools</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="See all your tools" onPress={onAll} style={[ui.row, { gap: 6, minHeight: 44, paddingLeft: 12, paddingRight: 10, borderRadius: 999, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="grid" size={15} color={p.primary} />
          <Text style={{ color: p.primary, fontSize: 13, fontWeight: "700" }}>All tools</Text>
          <Feather name="chevron-right" size={15} color={p.muted} />
        </MotionPress>
      </View>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 10 }}>
          {row.map((tool, i) => <Stagger key={tool.key} index={r * columns + i} style={{ flex: 1, minWidth: 0 }}><ToolTile tool={tool} palette={p} compact={!desktop} onPress={() => open(tool.target)} /></Stagger>)}
          {Array.from({ length: columns - row.length }, (_, i) => <View key={"gap" + i} style={{ flex: 1 }} />)}
        </View>
      ))}
      {/* The things this role starts most often, one tap from Home. */}
      {!!actions.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 2 }}>
        {actions.map((a, i) => <Stagger key={a.key} index={tools.length + i}><MotionPress accessibilityRole="button" accessibilityLabel={a.label} onPress={() => open(a.target)}
          style={[ui.row, { gap: 8, minHeight: 44, paddingLeft: 10, paddingRight: 16, borderRadius: 999, backgroundColor: p.primary }]}>
          <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: p.onPrimary }}><Feather name={a.icon} size={15} color={p.primary} /></View>
          <Text style={{ color: p.onPrimary, fontSize: 14, fontWeight: "700" }}>{a.label}</Text>
        </MotionPress></Stagger>)}
      </View>}
      <TrackerSheet palette={p} tool={tracker} properties={properties} onClose={() => setTracker(null)} />
      <FurnishingSheet palette={p} visible={calculator} onClose={() => setCalculator(false)} />
    </View>
  );
}
