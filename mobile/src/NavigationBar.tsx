import { useEffect, useState, type ComponentProps } from "react";
import { Animated, Platform, View } from "react-native";
import { PHONE_BAR_MAX, navigationFor, phoneBarFor, type WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceRole } from "./model";
import { MotionPress, NavSymbol, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

// Bone tab bar with a raised centre action. The active tab sits on a tinted
// pill that springs in; the centre item lifts out of the bar as a forest disc.
function ActivePill({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(reduced ? 1 : 0.6));
  useEffect(() => {
    if (reduced) return;
    const a = Animated.spring(scale, { toValue: 1, speed: 18, bounciness: 3, useNativeDriver: Platform.OS !== "web" });
    a.start();
    return () => a.stop();
  }, [scale, reduced]);
  return <Animated.View pointerEvents="none" style={{ position: "absolute", width: 58, height: 34, borderRadius: 17, backgroundColor: color, transform: [{ scaleX: scale }] }} />;
}

export type NavigationItem = { value: WorkspaceSection; label: string; icon: ComponentProps<typeof NavSymbol>["name"] };

// The live workspace's bar on phones (lib/workspace-map.ts phoneBarFor): the team gets Home, To-do, Work,
// Calendar and Messages (Ready: Home, Maintenance, Calendar, To-do, Messages; Accounts keep Invoices and
// Statements), five items at most, the middle one the raised action. Hub, Stays and Updates are not on it:
// Updates is a tab inside Messages. Owners keep theirs. Favorites floats next to Help, not in the bar.
export function liveNavigationFor(role: string): NavigationItem[] {
  return phoneBarFor(role).slice(0, PHONE_BAR_MAX) as NavigationItem[];
}
export function NavigationBar({
  role,
  section,
  onNavigate,
  palette: p,
  items: custom,
}: {
  role: WorkspaceRole;
  section: WorkspaceSection;
  onNavigate: (section: WorkspaceSection) => void;
  palette: Palette;
  // The live workspace passes its own destinations; the preview uses the role's.
  items?: readonly NavigationItem[];
}) {
  const items = custom ?? navigationFor(role);
  const active = items.findIndex((item) => item.value === section);
  // A page outside the bar (such as Help in the live workspace) highlights nothing.
  const index = active < 0 ? (custom ? -1 : items.length - 1) : active;
  const centre = items.length % 2 ? Math.floor(items.length / 2) : -1;
  return (
    <View
      testID="workspace-dock"
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: 6,
        paddingTop: 6,
        paddingBottom: 6,
        backgroundColor: p.surface,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        borderTopWidth: 1,
        borderColor: p.border,
        ...(Platform.OS === "web"
          ? { boxShadow: "0 -12px 30px -18px rgba(21, 45, 40, 0.35)" }
          : { elevation: 10 }),
      }}
    >
      {items.map((item, i) => {
        const selected = i === index;
        const color = selected ? p.primary : p.muted;
        if (i === centre)
          return (
            <MotionPress
              key={item.value}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => onNavigate(item.value)}
              style={{ flex: 1, alignItems: "center", gap: 4, minHeight: 58 }}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  marginTop: -30,
                  borderRadius: 30,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: p.primary,
                  borderWidth: 5,
                  borderColor: p.background,
                  ...(Platform.OS === "web"
                    ? { boxShadow: "0 12px 22px -10px rgba(16, 39, 31, 0.6)" }
                    : { elevation: 8 }),
                }}
              >
                <NavSymbol name={item.icon} active={selected} color={p.onPrimary} />
              </View>
              <Text numberOfLines={1} style={[ui.tabLabel, { color, fontWeight: selected ? "700" : "500" }]}>
                {item.label}
              </Text>
            </MotionPress>
          );
        return (
          <MotionPress
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => onNavigate(item.value)}
            style={[ui.tab, { minHeight: 58, gap: 5 }]}
          >
            <View style={{ width: 58, height: 34, alignItems: "center", justifyContent: "center" }}>
              {selected ? <ActivePill key={item.value} color={p.wash} /> : null}
              <NavSymbol name={item.icon} active={selected} color={color} />
            </View>
            <Text numberOfLines={1} style={[ui.tabLabel, { color, fontWeight: selected ? "700" : "500" }]}>
              {item.label}
            </Text>
          </MotionPress>
        );
      })}
    </View>
  );
}
