import { useState } from "react";
import { Animated, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { DimensionalIcon } from "./DimensionalIcon";
import { MotionPress, Stagger, useReducedMotion } from "./motion";
import { TrackerSheet } from "./LiveTools";
import { FurnishingSheet } from "./LiveFurnishing";
import { ui, type Palette } from "./theme";
import { homeToolsFor, type HomeTool, type HomeToolTarget } from "../../lib/home-tools";
import { resolveFavorites, suggestedFavorites, type SearchEntry } from "../../lib/workspace-search";
import { useFavorites } from "./Favorites";
import type { WorkspaceSection } from "../../lib/workspace-map";
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

// Owners' "Your tools": the tools for their role, one tap from where they start the day. (The quick-action
// pills that used to sit under the tiles are gone: team members get their Favorites instead, below.)
export function HomeTools({ palette: p, account, properties, desktop, onOpen, onAll }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; desktop: boolean; onOpen: (target: HomeToolTarget) => void; onAll: () => void }) {
  const { width } = useWindowDimensions();
  const tools = homeToolsFor(account.role, account.modules);
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
      <TrackerSheet palette={p} tool={tracker} properties={properties} onClose={() => setTracker(null)} />
      <FurnishingSheet palette={p} visible={calculator} onClose={() => setCalculator(false)} />
    </View>
  );
}

const FAVORITES_SHOWN = 6;
type FavoriteRow = { key: string; label: string; detail: string; saved: boolean; open: () => void };

// A team member's Home: their own Favorites as a compact list (not pills or tiles). Until they have
// saved any, the tools suggested for their role fill the list, with a hint to star the ones they use.
export function HomeFavorites({ palette: p, account, properties, entries, onOpenEntry, onTool, onSection }: {
  palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; entries?: SearchEntry[]; onOpenEntry?: (entry: SearchEntry) => void;
  onTool: (target: HomeToolTarget) => void; onSection: (section: WorkspaceSection) => void;
}) {
  const favorites = useFavorites();
  const [tracker, setTracker] = useState<Tool | null>(null);
  const [calculator, setCalculator] = useState(false);
  const openTarget = (target: HomeToolTarget) => {
    if (target.kind === "tracker") setTracker(toolsFor(account.role, account.modules).find(t => t.id === target.module) ?? null);
    else if (target.kind === "calculator") setCalculator(true);
    else onTool(target);
  };
  // Without the host's own opener, only places that can be opened from here are listed.
  const openEntry = (entry: SearchEntry) => {
    if (onOpenEntry) onOpenEntry(entry);
    else if (entry.target.kind === "section") onSection(entry.target.section);
    else if (entry.target.kind === "tool") openTarget(entry.target.target);
  };
  const openable = (entry: SearchEntry) => !!onOpenEntry || entry.target.kind === "section" || entry.target.kind === "tool";
  if (favorites && !favorites.loaded) return null;
  const saved: FavoriteRow[] = entries && favorites ? resolveFavorites(favorites.items, entries).flatMap(({ entry }) => entry && openable(entry) ? [{ key: entry.key, label: entry.label, detail: entry.detail, saved: true, open: () => openEntry(entry) }] : []) : [];
  const suggested: FavoriteRow[] = saved.length ? [] : entries
    ? suggestedFavorites(entries, favorites?.items ?? [], FAVORITES_SHOWN).filter(openable).map(entry => ({ key: entry.key, label: entry.label, detail: entry.detail, saved: false, open: () => openEntry(entry) }))
    : homeToolsFor(account.role, account.modules).slice(0, FAVORITES_SHOWN).map(tool => ({ key: tool.key, label: tool.label, detail: tool.detail, saved: false, open: () => openTarget(tool.target) }));
  const rows = (saved.length ? saved : suggested).slice(0, FAVORITES_SHOWN);
  if (!rows.length) return null;
  return (
    <View testID="home-favorites" style={{ gap: 8 }}>
      <View style={ui.between}>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{saved.length ? "Favorites" : "Suggested for you"}</Text>
          {!saved.length && !!favorites && <Text style={[ui.small, { color: p.muted }]}>Star a place anywhere and it is kept here.</Text>}
        </View>
        {!!favorites && <MotionPress accessibilityRole="button" accessibilityLabel="See all favorites" onPress={() => onSection("favorites")} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>See all</Text></MotionPress>}
      </View>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {rows.map((row, i) => (
          <MotionPress key={row.key} accessibilityRole="button" accessibilityLabel={`${row.label}. ${row.detail}`} onPress={row.open} style={[ui.row, { gap: 12, minHeight: 52, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <Feather name={row.saved ? "star" : "arrow-right-circle"} size={17} color={row.saved ? p.primary : p.muted} />
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{row.label}</Text>
              {!!row.detail && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{row.detail}</Text>}
            </View>
            <Feather name="chevron-right" size={17} color={p.muted} />
          </MotionPress>
        ))}
      </View>
      <TrackerSheet palette={p} tool={tracker} properties={properties} onClose={() => setTracker(null)} />
      <FurnishingSheet palette={p} visible={calculator} onClose={() => setCalculator(false)} />
    </View>
  );
}
