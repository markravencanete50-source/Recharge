import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useReducedMotion } from "./motion";
import type { Palette } from "./theme";

// A short confirmation after something is saved: a pill rises from the bottom, its tick springs in,
// then it slips away. Every sheet that saves (a stay, a review, an expense, a clean) uses it.
const Celebrate = createContext<(text?: string) => void>(() => undefined);
export const useCelebrate = () => useContext(Celebrate);
// Wraps a sheet's "done" handler: refresh as before, then confirm it worked.
export function useSaved() {
  const celebrate = useCelebrate();
  return useCallback(<A extends unknown[]>(fn: (...args: A) => unknown, text = "Saved") => async (...args: A) => { await fn(...args); celebrate(text); }, [celebrate]);
}

export function CelebrateProvider({ palette: p, bottom = 112, children }: { palette: Palette; bottom?: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const native = Platform.OS !== "web";
  const [shown, setShown] = useState<{ text: string; id: number } | null>(null);
  const [rise] = useState(() => new Animated.Value(0));
  const [tick] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text = "Saved") => setShown({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!shown) return;
    rise.setValue(reduced ? 1 : 0); tick.setValue(reduced ? 1 : 0);
    const enter = Animated.parallel([
      Animated.spring(rise, { toValue: 1, speed: 16, bounciness: 3, useNativeDriver: native }),
      Animated.sequence([Animated.delay(120), Animated.spring(tick, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: native })]),
    ]);
    if (!reduced) enter.start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(rise, { toValue: 0, duration: reduced ? 1 : 220, easing: Easing.in(Easing.quad), useNativeDriver: native }).start(() => setShown(null));
    }, 2200);
    return () => { enter.stop(); if (timer.current) clearTimeout(timer.current); };
  }, [shown, reduced, rise, tick, native]);
  return (
    <Celebrate.Provider value={show}>
      {children}
      {shown && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom, alignItems: "center", zIndex: 50 }}>
        <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingRight: 18, minHeight: 48, borderRadius: 999, backgroundColor: p.header, borderWidth: 1, borderColor: p.headerBorder,
          ...(Platform.OS === "web" ? { boxShadow: "0 18px 40px -18px rgba(8, 22, 18, 0.65)" } : { elevation: 8 }),
          opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
          <Animated.View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: p.success, transform: [{ scale: tick }, { rotate: tick.interpolate({ inputRange: [0, 1], outputRange: ["-40deg", "0deg"] }) }] }}>
            <Feather name="check" size={18} color={p.onSuccess} />
          </Animated.View>
          <Text style={{ color: p.headerText, fontSize: 14, fontWeight: "700" }}>{shown.text}</Text>
        </Animated.View>
      </View>}
    </Celebrate.Provider>
  );
}
