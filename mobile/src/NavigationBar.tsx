import { useEffect, useState } from "react";
import { Animated, Platform, View } from "react-native";
import { navigationFor, type WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceRole } from "./model";
import { MotionPress, NavSymbol, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

// Floating forest dock: it echoes the green header so bone content sits
// between two brand surfaces. The active tab is a bone pill that springs
// between positions.
export function NavigationBar({
  role,
  section,
  onNavigate,
  palette: p,
}: {
  role: WorkspaceRole;
  section: WorkspaceSection;
  onNavigate: (section: WorkspaceSection) => void;
  palette: Palette;
}) {
  const items = navigationFor(role);
  const active = items.findIndex((item) => item.value === section);
  const index = active < 0 ? items.length - 1 : active;
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [offset] = useState(() => new Animated.Value(0));
  const inset = 6;
  const slot = Math.max(0, (width - inset * 2) / items.length);
  useEffect(() => {
    offset.stopAnimation();
    if (reduced) {
      offset.setValue(slot * index);
      return;
    }
    const animation = Animated.spring(offset, {
      toValue: slot * index,
      speed: 16,
      bounciness: 7,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [offset, slot, index, reduced]);
  return (
    <View style={{ backgroundColor: p.background, paddingTop: 6, paddingBottom: 6 }}>
      <View
        testID="workspace-dock"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{
          flexDirection: "row",
          padding: inset,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: p.headerBorder,
          backgroundColor: p.header,
          maxWidth: 736,
          alignSelf: "center",
          width: "94%",
          ...(Platform.OS === "web"
            ? { boxShadow: "0 18px 40px -16px rgba(8, 22, 18, 0.55)" }
            : { elevation: 8 }),
        }}
      >
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: inset,
              top: inset,
              bottom: inset,
              width: slot,
              backgroundColor: p.headerMuted,
              borderRadius: 22,
              transform: [{ translateX: offset }],
            }}
          />
        ) : null}
        {items.map((item, i) => {
          const selected = i === index;
          const color = selected ? p.header : p.headerMuted;
          return (
            <MotionPress
              key={item.value}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => onNavigate(item.value)}
              style={[ui.tab, { minHeight: 58, borderRadius: 22 }]}
            >
              <NavSymbol name={item.icon} active={selected} color={color} />
              <Text
                numberOfLines={1}
                style={[ui.tabLabel, { color, fontWeight: selected ? "600" : "500" }]}
              >
                {item.label}
              </Text>
            </MotionPress>
          );
        })}
      </View>
    </View>
  );
}
