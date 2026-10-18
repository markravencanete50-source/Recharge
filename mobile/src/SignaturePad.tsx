import { useRef, useState } from "react";
import { Platform, Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { space, ui, type Palette } from "./theme";
import { hasSignature, signaturePng, type SignatureStroke } from "../../lib/signature-png";

// Sign here with a finger or the mouse (after houseoflettings' SignaturePad): the strokes are kept as points and, at
// the end of each stroke, turned into a small PNG (lib/signature-png.ts) handed to onChange, or "" while there is no
// signature yet. The pad is always ink on paper, in light and dark mode alike, as the signed copy shows it.
const INK = "#17302A", PAPER = "#FFFFFF", HEIGHT = 170;
const pathOf = (s: SignatureStroke) => s.length === 1 ? `M${s[0].x} ${s[0].y}l0.1 0` : s.map((pt, i) => `${i ? "L" : "M"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join("");

export function SignaturePad({ label, help, error, p, disabled, onChange }: { label: string; help?: string; error?: string; p: Palette; disabled?: boolean; onChange: (png: string) => void }) {
  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);
  const size = useRef({ width: 0, height: HEIGHT });
  const live = useRef<SignatureStroke[]>([]);
  const point = (e: GestureResponderEvent) => ({ x: Math.max(0, Math.min(size.current.width, e.nativeEvent.locationX)), y: Math.max(0, Math.min(size.current.height, e.nativeEvent.locationY)) });
  const finish = () => {
    const all = live.current;
    onChange(hasSignature(all) ? signaturePng(all, size.current.width, size.current.height) : "");
  };
  const grant = (e: GestureResponderEvent) => { live.current = [...live.current, [point(e)]]; setStrokes(live.current); };
  const move = (e: GestureResponderEvent) => {
    const all = live.current, last = all[all.length - 1], next = point(e), prev = last?.[last.length - 1];
    if (!last || (prev && Math.hypot(next.x - prev.x, next.y - prev.y) < 1.2)) return;
    live.current = [...all.slice(0, -1), [...last, next]]; setStrokes(live.current);
  };
  const clear = () => { live.current = []; setStrokes([]); onChange(""); };
  // A new size starts again, as the strokes no longer line up with the pad.
  const layout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    if (size.current.width && Math.abs(size.current.width - width) > 1 && live.current.length) clear();
    size.current = { width, height: HEIGHT };
  };
  const empty = !strokes.length;
  return (
    <View style={{ gap: space.tight }}>
      <Text style={[ui.small, { color: error ? p.danger : p.muted, fontWeight: "600" }]}>{label}</Text>
      <View onLayout={layout} accessibilityLabel={label + ". Draw your signature in the box"}
        // The pad keeps the touch: the page never scrolls away mid-signature.
        onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled} onStartShouldSetResponderCapture={() => !disabled} onMoveShouldSetResponderCapture={() => !disabled}
        onResponderTerminationRequest={() => false} onResponderGrant={grant} onResponderMove={move} onResponderRelease={finish} onResponderTerminate={finish}
        style={[{ height: HEIGHT, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: error ? p.danger : p.controlBorder, backgroundColor: PAPER, overflow: "hidden" },
          Platform.OS === "web" ? ({ touchAction: "none", cursor: disabled ? "default" : "crosshair", userSelect: "none" } as object) : null]}>
        <Svg width="100%" height={HEIGHT} pointerEvents="none">
          {strokes.map((s, i) => <Path key={i} d={pathOf(s)} stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Svg>
        <View pointerEvents="none" style={{ position: "absolute", left: 16, right: 16, bottom: 34, borderBottomWidth: 1, borderColor: "#C9C2B4" }} />
        {empty && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={[ui.small, { color: "#7A857F" }]}>Sign here with your finger or mouse</Text>
        </View>}
      </View>
      <View style={[ui.row, { justifyContent: "space-between", gap: 10 }]}>
        <Text style={[ui.small, { color: error ? p.danger : p.muted, flex: 1 }]}>{error || help || ""}</Text>
        {!empty && <Pressable accessibilityRole="button" onPress={clear} disabled={disabled} hitSlop={8} style={[ui.row, { gap: 6 }]}>
          <Feather name="rotate-ccw" size={14} color={p.primary} /><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Clear signature</Text>
        </Pressable>}
      </View>
    </View>
  );
}
