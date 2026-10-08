import { useEffect, useState, useRef } from "react";
import Feather from "@expo/vector-icons/Feather";
import { Animated, ScrollView, View } from "react-native";
import { MotionPress, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

export function FilterBar({
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
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [boxes, setBoxes] = useState<
    Record<string, { x: number; width: number }>
  >({});
  const [x] = useState(() => new Animated.Value(0));
  const [width] = useState(() => new Animated.Value(0));
  const box = boxes[selected];
  useEffect(() => {
    if (!box) return;
    x.stopAnimation();
    width.stopAnimation();
    if (reduced) {
      x.setValue(box.x + box.width / 2 - 50);
      width.setValue(box.width);
      return;
    }
    const animation = Animated.parallel([
      Animated.spring(x, {
        toValue: box.x + box.width / 2 - 50,
        speed: 16,
        bounciness: 2,
        useNativeDriver: false,
      }),
      Animated.spring(width, {
        toValue: box.width,
        speed: 16,
        bounciness: 2,
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [box, reduced, width, x]);
  useEffect(() => {
    if (!box || !viewportWidth) return;
    if (
      box.x < scrollX.current ||
      box.x + box.width > scrollX.current + viewportWidth
    ) {
      scroll.current?.scrollTo({
        x: Math.max(0, box.x - (viewportWidth - box.width) / 2),
        animated: !reduced,
      });
    }
  }, [box, viewportWidth, reduced]);
  return (
    <View
      style={[
        ui.row,
        // Hug the options rather than stretching across the page.
        { backgroundColor: p.elevated, borderRadius: 999, overflow: "hidden", alignSelf: "flex-start", maxWidth: "100%" },
      ]}
    >
      <ScrollView
        ref={scroll}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        onScroll={(event) => {
          scrollX.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        style={{ flexGrow: 0, flexShrink: 1 }}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 1 }}
      >
        <View
          style={[
            ui.row,
            {
              gap: 2,
              padding: 4,
              backgroundColor: p.elevated,
              borderRadius: 999,
            },
          ]}
        >
          {box ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 4,
                bottom: 4,
                left: 0,
                borderRadius: 999,
                backgroundColor: p.primary,
                width:100,
                transform: [{ translateX: x }, {scaleX:width.interpolate({inputRange:[0,100],outputRange:[0,1]})}],
              }}
            />
          ) : null}
          {values.map((value) => (
            <MotionPress
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === value }}
              onPress={() => onSelect(value)}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                setBoxes((current) =>
                  current[value]?.x === x && current[value]?.width === width
                    ? current
                    : { ...current, [value]: { x, width } },
                );
              }}
              style={{
                minHeight: 40,
                paddingHorizontal: 16,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 20,
                  fontWeight: "600",
                  color: selected === value ? p.onPrimary : p.muted,
                }}
              >
                {value}
              </Text>
            </MotionPress>
          ))}
        </View>
      </ScrollView>
      {values.length > 4 ? (
        <View pointerEvents="none" style={{ width: 22, alignItems: "center" }}>
          <Feather name="chevron-right" size={15} color={p.muted} />
        </View>
      ) : null}
    </View>
  );
}
