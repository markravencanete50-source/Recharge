import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Avatar, type Profile } from "./AccountSetup";
import { CompanyLogo } from "./CompanyLogo";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { HomeScene } from "./HomeScene";
import { MotionPress, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

const native = Platform.OS !== "web";
const STEPS = ["Opening your workspace", "Gathering your properties", "Lining up today's tasks", "Almost there"];

// Signing in: the brand scene rises, a ring pulses and a progress line fills
// while short status lines rotate. Reduced motion shows a brief static frame.
export function LoginSplash({ palette: p, onDone }: { palette: Palette; onDone: () => void }) {
  const reduced = useReducedMotion();
  const duration = reduced ? 700 : 2400;
  const [progress] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [rise] = useState(() => new Animated.Value(reduced ? 1 : 0));
  const [exit] = useState(() => new Animated.Value(1));
  const [step, setStep] = useState(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    const fill = Animated.timing(progress, { toValue: 1, duration, easing: Easing.bezier(0.45, 0, 0.2, 1), useNativeDriver: false });
    const up = Animated.spring(rise, { toValue: 1, speed: 6, bounciness: 8, useNativeDriver: native });
    const ring = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: native }));
    if (!reduced) { up.start(); ring.start(); }
    fill.start(({ finished }) => {
      if (!finished) return;
      Animated.timing(exit, { toValue: 0, duration: reduced ? 1 : 320, useNativeDriver: native }).start(() => done.current());
    });
    const ticker = setInterval(() => setStep(value => Math.min(STEPS.length - 1, value + 1)), duration / STEPS.length);
    return () => { fill.stop(); up.stop(); ring.stop(); clearInterval(ticker); };
  }, [duration, exit, progress, pulse, reduced, rise]);
  const ringStyle = (delay: number) => ({
    position: "absolute" as const,
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 2,
    borderColor: "#A7D9C1",
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [delay ? 0.25 : 0.45, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.62 + delay, 1.15 + delay] }) }],
  });
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => done.current()}>
      <Animated.View accessibilityViewIsModal accessibilityLiveRegion="polite" accessibilityLabel={STEPS[step]} style={{ flex: 1, opacity: exit, backgroundColor: p.header, alignItems: "center", justifyContent: "center", padding: 24, overflow: "hidden" }}>
        <Svg pointerEvents="none" width="100%" height="100%" style={{ position: "absolute" }}>
          <Defs>
            <RadialGradient id="splashGlow" cx="0.5" cy="0.42" r="0.6">
              <Stop offset="0" stopColor="#A7D9C1" stopOpacity={0.22} />
              <Stop offset="1" stopColor="#A7D9C1" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#splashGlow)" />
        </Svg>
        <View style={{ width: 230, height: 210, alignItems: "center", justifyContent: "center" }}>
          {!reduced && <Animated.View style={ringStyle(0)} />}
          {!reduced && <Animated.View style={ringStyle(0.22)} />}
          <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }, { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
            <HomeScene width={200} />
          </Animated.View>
        </View>
        <View style={{ marginTop: 18, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "#1B3E38", borderWidth: 1, borderColor: "#3E6658" }}><CompanyLogo palette={{ ...p, isDark: false }} width={170} /></View>
        <View style={{ width: 220, height: 6, borderRadius: 3, marginTop: 28, backgroundColor: "#FFFFFF1F", overflow: "hidden" }}>
          <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: "#A7D9C1", width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
        </View>
        <Text style={{ marginTop: 14, color: p.headerMuted, fontSize: 14, fontWeight: "500" }}>{STEPS[step]}…</Text>
      </Animated.View>
    </Modal>
  );
}

type Moment = { icon: DimensionalName; greeting: string; line: string; band: [string, string] };
export function momentFor(hour: number): Moment {
  if (hour >= 5 && hour < 12) return { icon: "sun", greeting: "Good morning", line: "Hope your day gets off to a great start.", band: ["#F6E3B4", "#EFE9DB"] };
  if (hour >= 12 && hour < 17) return { icon: "sun", greeting: "Good afternoon", line: "Hope your day is going smoothly.", band: ["#CFE8DA", "#EFE9DB"] };
  if (hour >= 17 && hour < 21) return { icon: "sunset", greeting: "Good evening", line: "Hope you had a great day. Here is where things stand.", band: ["#F2C7A9", "#EDE1EA"] };
  return { icon: "moon", greeting: "Working late", line: "Hope you get some rest soon. Here is a quick look before you do.", band: ["#3B5866", "#1F3D38"] };
}

// The greeting card that follows sign-in: who you are, the time of day and a
// short summary, then straight into the workspace.
export function GreetingCard({ palette: p, profile, openTasks, waiting, onClose, onWork }: { palette: Palette; profile: Profile; openTasks: number; waiting: number; onClose: () => void; onWork: () => void }) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [enter] = useState(() => new Animated.Value(reduced ? 1 : 0));
  const [bob] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const a = Animated.spring(enter, { toValue: 1, speed: 9, bounciness: 9, useNativeDriver: native });
    const b = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      Animated.timing(bob, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [bob, enter, reduced]);
  const moment = momentFor(new Date().getHours());
  const night = moment.icon === "moon";
  const first = profile.displayName.trim().split(/\s+/)[0] || "there";
  return (
    <Modal visible transparent animationType={reduced ? "none" : "fade"} onRequestClose={onClose}>
      <View {...(Platform.OS === "web" ? { dataSet: { overlay: "blur" } } : {})} style={{ flex: 1, backgroundColor: p.overlay, alignItems: "center", justifyContent: "center", padding: 20 }}>
        <Animated.View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{
            width: Math.min(420, width - 40),
            borderRadius: 30,
            backgroundColor: p.surface,
            overflow: "hidden",
            opacity: enter,
            transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }, { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            ...(Platform.OS === "web" ? { boxShadow: "0 40px 80px -30px rgba(8, 22, 18, 0.65)" } : { elevation: 16 }),
          }}
        >
          <View style={{ height: 132, backgroundColor: moment.band[0], alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <View style={{ position: "absolute", left: -40, bottom: -60, width: 220, height: 140, borderRadius: 110, backgroundColor: moment.band[1], opacity: night ? 0.35 : 0.6 }} />
            <View style={{ position: "absolute", right: -30, top: -50, width: 160, height: 120, borderRadius: 80, backgroundColor: "#FFFFFF", opacity: night ? 0.06 : 0.35 }} />
            <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
              <DimensionalIcon name={moment.icon} size={96} />
            </Animated.View>
            <MotionPress accessibilityRole="button" accessibilityLabel="Close greeting" onPress={onClose} style={{ position: "absolute", right: 14, top: 14, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: night ? "#FFFFFF1F" : "#FFFFFF99" }}>
              <Feather name="x" size={17} color={night ? "#FAF7F0" : "#1F3D38"} />
            </MotionPress>
          </View>
          <View style={{ alignItems: "center", marginTop: -38 }}>
            <View style={{ borderRadius: 44, borderWidth: 4, borderColor: p.surface }}>
              <Avatar profile={profile} size={76} />
            </View>
          </View>
          <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 16, alignItems: "center" }}>
            <View style={{ alignItems: "center", gap: 6 }}>
              <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>{moment.greeting}</Text>
              <Text accessibilityRole="header" style={{ color: p.text, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.8, textAlign: "center" }}>Hi, {first}!</Text>
              <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>{moment.line}</Text>
            </View>
            <View style={[ui.row, { gap: 10, alignSelf: "stretch" }]}>
              {[["clipboard", openTasks, "open tasks"], ["hourglass", waiting, "waiting"]].map(([icon, value, label]) => (
                <View key={String(label)} style={[ui.row, { flex: 1, gap: 10, padding: 12, borderRadius: 18, backgroundColor: p.background, borderWidth: 1, borderColor: p.border }]}>
                  <DimensionalIcon name={icon as DimensionalName} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: p.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.5 }}>{value}</Text>
                    <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{label}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ alignSelf: "stretch", gap: 8 }}>
              <MotionPress accessibilityRole="button" onPress={onClose} style={[ui.between, { minHeight: 52, paddingHorizontal: 18, borderRadius: 18, backgroundColor: p.primary }]}>
                <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>Let&apos;s go</Text>
                <Feather name="arrow-right" size={18} color={p.onPrimary} />
              </MotionPress>
              <MotionPress accessibilityRole="button" onPress={onWork} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 14 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>See what needs me</Text>
              </MotionPress>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
