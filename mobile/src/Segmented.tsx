import { useEffect, useState } from "react";
import { Animated, Platform, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./Typography";
import { MotionPress, useReducedMotion } from "./motion";
import { primaryFill, ui, type Palette } from "./theme";

// A row of equal segments (Today · Tomorrow · Overdue) with a thumb that slides to the one chosen,
// springing a little as it lands. Counts ride along in small badges; an alert badge is red.
export type Segment<T extends string> = { key: T; label: string; count?: number; alert?: boolean };
export function Segmented<T extends string>({ p, items, value, onChange, stretch = true, label }: { p: Palette; items: Segment<T>[]; value: T; onChange: (key: T) => void; stretch?: boolean; label?: string }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const gap = 4, pad = 4, index = Math.max(0, items.findIndex(item => item.key === value));
  const segment = width ? (width - pad * 2 - gap * (items.length - 1)) / items.length : 0;
  useEffect(() => {
    const to = index * (segment + gap);
    if (reduced || !segment) { x.setValue(to); return; }
    const a = Animated.spring(x, { toValue: to, speed: 16, bounciness: 6, useNativeDriver: Platform.OS !== "web" });
    a.start(); return () => a.stop();
  }, [index, segment, reduced, x]);
  // Too narrow for equal segments (four or more on a phone): a row of pills that scrolls sideways.
  if (stretch && segment > 0 && segment < 96) return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={label} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={{ gap: 6, padding: pad, borderRadius: 999, backgroundColor: p.wash }}>
      {items.map(item => {
        const on = item.key === value;
        return (
          <MotionPress key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={item.count === undefined ? item.label : `${item.label}, ${item.count}`} onPress={() => onChange(item.key)}
            style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999 }, on ? primaryFill(p) : null]}>
            <Text numberOfLines={1} style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "700" }}>{item.label}</Text>
            {item.count !== undefined && <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: item.alert ? p.danger : on ? p.onPrimary : p.surface }}>
              <Text style={{ color: item.alert ? "#FFFFFF" : p.primary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{item.count}</Text>
            </View>}
          </MotionPress>
        );
      })}
    </ScrollView>
  );
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: "row", gap, padding: pad, borderRadius: 999, backgroundColor: p.wash, alignSelf: stretch ? "stretch" : "flex-start", minWidth: stretch ? undefined : items.length * 152 }}>
      {!!segment && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: pad, top: pad, bottom: pad, width: segment, borderRadius: 999, transform: [{ translateX: x }] }, primaryFill(p)]} />}
      {items.map(item => {
        const on = item.key === value;
        return (
          <MotionPress key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={item.count === undefined ? item.label : `${item.label}, ${item.count}`} onPress={() => onChange(item.key)}
            style={[ui.row, { flex: 1, minWidth: 0, justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999 }]}>
            <Text numberOfLines={1} style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "700" }}>{item.label}</Text>
            {item.count !== undefined && <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: item.alert ? p.danger : on ? p.onPrimary : p.surface }}>
              <Text style={{ color: item.alert ? "#FFFFFF" : p.primary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{item.count}</Text>
            </View>}
          </MotionPress>
        );
      })}
    </View>
  );
}
