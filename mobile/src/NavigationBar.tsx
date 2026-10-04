import { useEffect, useState } from "react";
import { Animated, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { navigationFor, type WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceRole } from "./model";
import { MotionPress, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

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
  const slot = Math.max(0, (width - 18) / items.length);
  useEffect(() => {
    offset.stopAnimation();
    if (reduced) {
      offset.setValue(slot * index);
      return;
    }
    const animation = Animated.spring(offset, {
      toValue: slot * index,
      speed: 24,
      bounciness: 0,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [offset, slot, index, reduced]);
  return (
    <View style={{ backgroundColor: p.background, paddingTop: 4 }}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[
          ui.tabs,
          {
            backgroundColor: p.surface,
            borderColor: p.border,
            maxWidth: 736,
            alignSelf: "center",
            width: "94%",
            marginHorizontal: 0,
          },
        ]}
      >
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              bottom: 8,
              width: slot,
              backgroundColor: p.wash,
              borderRadius: 18,
              transform: [{ translateX: offset }],
            }}
          />
        ) : null}
        {items.map((item, i) => (
          <MotionPress
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: index === i }}
            onPress={() => onNavigate(item.value)}
            style={ui.tab}
          >
            <Feather
              name={item.icon}
              size={22}
              color={i === index ? p.primary : p.muted}
            />
            <Text
              style={[
                ui.tabLabel,
                { color: i === index ? p.primary : p.muted },
              ]}
            >
              {item.label}
            </Text>
          </MotionPress>
        ))}
      </View>
    </View>
  );
}
