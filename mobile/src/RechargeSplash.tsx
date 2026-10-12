import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { CompanyLogo } from "./CompanyLogo";
import { MotionPress, useMotionPreference } from "./motion";
import { Text } from "./Typography";
import type { Palette } from "./theme";

const native = Platform.OS !== "web";
const DURATION = 3000;
// Scene coordinates are drawn on a 300 x 190 canvas, then scaled.
const W = 300;
const H = 190;
const FLOOR = 162;

const SKIN = "#E9B98F";
const HAIR = "#2B2420";
const SHIRT = "#2F6F5E";
const TROUSERS = "#1B3E38";

function Room() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <Rect x={0} y={0} width={W} height={H} fill="#143029" />
      {/* Window with moon and stars. */}
      <Rect x={26} y={24} width={66} height={56} rx={8} fill="#0B1A16" stroke="#3E6658" strokeWidth={3} />
      <Path d="M59 24 V80 M26 52 H92" stroke="#3E6658" strokeWidth={2} />
      <Circle cx={76} cy={38} r={8} fill="#F6E7BE" />
      <Circle cx={80} cy={35} r={7} fill="#0B1A16" />
      <Circle cx={38} cy={34} r={1.4} fill="#F6E7BE" />
      <Circle cx={48} cy={66} r={1.1} fill="#F6E7BE" />
      <Circle cx={72} cy={68} r={1.2} fill="#F6E7BE" />
      {/* Lamp tint and bedside table. */}
      <Ellipse cx={247} cy={86} rx={46} ry={40} fill="#F6D58A" opacity={0.14} />
      <Rect x={232} y={130} width={30} height={32} rx={4} fill="#3E6658" />
      <Rect x={244} y={98} width={4} height={32} fill="#C9BEA4" />
      <Path d="M234 98 L258 98 L252 82 L240 82 Z" fill="#F6D58A" />
      {/* Floor. */}
      <Rect x={0} y={FLOOR} width={W} height={H - FLOOR} fill="#0E211C" />
      <Rect x={0} y={FLOOR} width={W} height={2} fill="#3E6658" />
      {/* Bed: headboard, frame, mattress and pillow. */}
      <Rect x={212} y={96} width={14} height={66} rx={4} fill="#6B4A2B" />
      <Rect x={118} y={136} width={108} height={14} rx={4} fill="#6B4A2B" />
      <Rect x={120} y={150} width={8} height={12} fill="#5A3E24" />
      <Rect x={212} y={150} width={8} height={12} fill="#5A3E24" />
      <Rect x={120} y={124} width={96} height={14} rx={6} fill="#EFE9DB" />
      <Rect x={188} y={114} width={24} height={13} rx={6} fill="#FFFDF7" />
    </Svg>
  );
}

function Standing({ stride, scale }: { stride: 0 | 1; scale: number }) {
  // A simple walking figure; the stride swaps leg and arm positions.
  const leg = stride ? ["M17 48 L12 66", "M21 48 L27 66"] : ["M17 48 L22 66", "M21 48 L15 66"];
  const arm = stride ? ["M15 28 L9 42", "M23 28 L28 41"] : ["M15 28 L21 42", "M23 28 L17 41"];
  return (
    <Svg width={38 * scale} height={70 * scale} viewBox="0 0 38 70">
      <Path d={arm[0]} stroke={SKIN} strokeWidth={4} strokeLinecap="round" />
      <Path d={leg[0]} stroke={TROUSERS} strokeWidth={6} strokeLinecap="round" />
      <Rect x={12} y={24} width={14} height={26} rx={6} fill={SHIRT} />
      <Path d={leg[1]} stroke={TROUSERS} strokeWidth={6} strokeLinecap="round" />
      <Path d={arm[1]} stroke={SKIN} strokeWidth={4} strokeLinecap="round" />
      <Circle cx={19} cy={14} r={9} fill={SKIN} />
      <Path d="M10 13 C10 4 28 4 28 12 C24 9 15 9 10 13 Z" fill={HAIR} />
    </Svg>
  );
}

function Sleeping({ scale }: { scale: number }) {
  // Head on the pillow, blanket drawn up over the body.
  return (
    <Svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
      <Circle cx={199} cy={114} r={9} fill={SKIN} />
      <Path d="M206 108 C210 116 204 123 197 122 C203 119 206 114 206 108 Z" fill={HAIR} />
      <Path d="M194 113 Q196 115 198 113" stroke="#6B4A2B" strokeWidth={1.4} fill="none" strokeLinecap="round" />
      <Path d="M126 128 C126 115 150 113 172 116 C182 117 188 120 190 127 L190 136 L126 136 Z" fill="#CC7050" />
      <Path d="M130 124 C150 120 170 121 188 126" stroke="#F5C2A8" strokeWidth={2} fill="none" opacity={0.6} />
    </Svg>
  );
}

function Bolt({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G>
        <Path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" fill={color} />
      </G>
    </Svg>
  );
}

// Captions follow the story: walking ends at 8%, asleep by about 20%.
const MESSAGES = [
  [0, "Heading home"],
  [8, "Settling in for the night"],
  [22, "Recharging"],
  [85, "Almost there"],
  [100, "Fully charged"],
] as const;

// Entrance: a person walks home, climbs into bed and sleeps while the
// Recharge battery fills from 0% to 100%. Reduced motion shows the end state.
export function RechargeSplash({ palette: p, onDone }: { palette: Palette; onDone: () => void }) {
  // Wait for the stored motion preference before playing, so a brief default
  // of "reduced" at start-up does not skip straight to 100%.
  const { reduced, ready } = useMotionPreference();
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(360, width - 48);
  const scale = sceneWidth / W;
  const [t] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(1));
  const [percent, setPercent] = useState(0);
  const [stride, setStride] = useState<0 | 1>(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!ready) return;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const id = t.addListener(({ value }) => {
      // Low battery while walking home, then a steady charge once asleep.
      const pct = value < 0.4 ? (value / 0.4) * 8 : 8 + ((value - 0.4) / 0.6) * 92;
      setPercent(Math.min(100, Math.round(pct)));
    });
    t.setValue(reduced ? 1 : 0);
    const walk = setInterval(() => setStride(s => (s ? 0 : 1)), 220);
    const run = Animated.timing(t, { toValue: 1, duration: reduced ? 1 : DURATION, easing: Easing.linear, useNativeDriver: false });
    run.start(({ finished }) => {
      if (!finished) return;
      setPercent(100);
      exitTimer = setTimeout(() => {
        Animated.timing(exit, { toValue: 0, duration: reduced ? 1 : 360, useNativeDriver: native }).start(() => done.current());
      }, reduced ? 500 : 650);
    });
    return () => { t.removeListener(id); clearInterval(walk); clearTimeout(exitTimer); run.stop(); };
  }, [exit, ready, reduced, t]);

  // Walking 0 to 0.33 of the timeline, into bed by 0.42, then asleep.
  const walkerX = t.interpolate({ inputRange: [0, 0.33, 0.4], outputRange: [8, 150, 168], extrapolate: "clamp" });
  const walkerOpacity = t.interpolate({ inputRange: [0, 0.36, 0.42], outputRange: [1, 1, 0], extrapolate: "clamp" });
  const sleeperOpacity = t.interpolate({ inputRange: [0, 0.38, 0.46], outputRange: [0, 0, 1], extrapolate: "clamp" });
  const charged = percent >= 100;
  const fill = percent < 20 ? "#E9906A" : percent < 60 ? "#E8C27D" : "#86D99B";
  const message = [...MESSAGES].reverse().find(([at]) => percent >= at)?.[1] ?? MESSAGES[0][1];
  const zStyle = (delay: number) => ({
    position: "absolute" as const,
    left: (204 + delay * 14) * scale,
    top: (92 - delay * 10) * scale,
    opacity: sleeperOpacity,
  });
  const ink = p.isDark ? "#1B3E38" : "#FAF7F0";
  const track = p.isDark ? "#1B3E3829" : "#FFFFFF24";

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => done.current()}>
      <Animated.View accessibilityViewIsModal accessibilityLiveRegion="polite" accessibilityLabel={`${message}, ${percent} percent`} style={{ flex: 1, opacity: exit, backgroundColor: p.header, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: sceneWidth, height: H * scale, borderRadius: 26 * scale, overflow: "hidden", borderWidth: 1, borderColor: p.isDark ? "#C9BEA4" : "#3E6658" }}>
          <Room />
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: sceneWidth, height: H * scale, opacity: sleeperOpacity }}>
            <Sleeping scale={scale} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={{ position: "absolute", top: (FLOOR - 70) * scale, left: 0, opacity: walkerOpacity, transform: [{ translateX: Animated.multiply(walkerX, scale) }] }}>
            <Standing stride={stride} scale={scale} />
          </Animated.View>
          {[0, 1, 2].map(i => (
            <Animated.Text key={i} style={[zStyle(i), { color: "#F6E7BE", fontSize: (11 + i * 3) * scale, fontWeight: "700" }]}>z</Animated.Text>
          ))}
          {/* A small charge indicator on the bedside table, matching the battery. */}
          <View style={{ position: "absolute", left: 236 * scale, top: 138 * scale, width: 22 * scale, height: 12 * scale, borderRadius: 3 * scale, borderWidth: 1.5, borderColor: "#C9BEA4", overflow: "hidden" }}>
            <View style={{ width: `${percent}%`, height: "100%", backgroundColor: fill }} />
          </View>
        </View>

        <View style={{ marginTop: 28, alignItems: "center", gap: 12 }}>
          <View style={[{ flexDirection: "row", alignItems: "center" }]}>
            <View style={{ width: 220, height: 64, borderRadius: 18, borderWidth: 3, borderColor: ink, padding: 5, overflow: "hidden" }}>
              <View style={{ flex: 1, borderRadius: 11, backgroundColor: track, overflow: "hidden" }}>
                <View style={{ width: `${percent}%`, height: "100%", borderRadius: 11, backgroundColor: fill }} />
              </View>
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                <Bolt size={26} color={percent > 55 ? "#1B3E38" : ink} />
              </View>
            </View>
            <View style={{ width: 8, height: 24, marginLeft: 3, borderTopRightRadius: 5, borderBottomRightRadius: 5, backgroundColor: ink }} />
          </View>
          <Text style={{ color: p.headerText, fontSize: 40, lineHeight: 46, fontWeight: "700", letterSpacing: -1.2, fontVariant: ["tabular-nums"] }}>{percent}%</Text>
          <Text style={{ color: p.headerMuted, fontSize: 16, fontWeight: charged ? "700" : "500", marginTop: -6 }}>{message}{charged ? "" : "…"}</Text>
        </View>

        <View style={{ position: "absolute", bottom: 48 }}>
          <CompanyLogo palette={p} width={150} />
        </View>
        {/* The app loads underneath, so anyone in a hurry can go straight in. */}
        <MotionPress accessibilityRole="button" accessibilityLabel="Skip the intro" onPress={() => Animated.timing(exit, { toValue: 0, duration: reduced ? 1 : 200, useNativeDriver: Platform.OS !== "web" }).start(() => done.current())}
          style={{ position: "absolute", top: 52, right: 20, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: p.headerBorder, backgroundColor: p.headerControl }}>
          <Text style={{ color: p.headerControlText, fontSize: 14, fontWeight: "600" }}>Skip</Text>
        </MotionPress>
      </Animated.View>
    </Modal>
  );
}
