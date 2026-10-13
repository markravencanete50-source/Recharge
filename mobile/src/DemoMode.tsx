import React, { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Platform, Switch, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress, useReducedMotion } from "./motion";
import { depth, ui, type Palette } from "./theme";
import { demoInteractive, resetDemo, runDemoJobs } from "./backend/client";
import { subscribeDemoNotes } from "./demo/notes";
import { isDemoPerson } from "./demo/engine";
import { uploads } from "./uploadQueue";

// Demo mode's controls (lib/demo-data.ts). Only super admins see them.
const native = Platform.OS !== "web";

// Live | Demo, side by side in the header, with a thumb that slides to the one in use.
export function ModeSwitch({ palette: p, demo, busy, onChange }: { palette: Palette; demo: boolean; busy: boolean; onChange: (demo: boolean) => void }) {
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(demo ? 1 : 0));
  useEffect(() => {
    if (reduced) { x.setValue(demo ? 1 : 0); return; }
    const a = Animated.spring(x, { toValue: demo ? 1 : 0, speed: 16, bounciness: 5, useNativeDriver: native });
    a.start(); return () => a.stop();
  }, [demo, reduced, x]);
  const option = (on: boolean, label: string) => (
    <MotionPress accessibilityRole="radio" accessibilityState={{ selected: demo === on, busy: busy && demo !== on }} accessibilityLabel={on ? "Demo mode: show the sample business" : "Live: your real records"} disabled={busy} onPress={() => { if (demo !== on) onChange(on); }}
      style={[ui.row, { width: 76, height: 36, justifyContent: "center", gap: 6 }]}>
      {busy && demo !== on ? <ActivityIndicator size="small" color={p.headerControlText} /> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: on ? "#E8C27D" : "#86D99B", opacity: demo === on ? 1 : 0.55 }} />}
      <Text style={{ color: p.headerControlText, fontSize: 13, fontWeight: demo === on ? "700" : "500", opacity: demo === on ? 1 : 0.75 }}>{label}</Text>
    </MotionPress>
  );
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Live or demo" style={[ui.row, { padding: 4, borderRadius: 999, backgroundColor: p.headerControl, borderWidth: 1, borderColor: p.headerBorder }]}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 4, top: 4, width: 76, height: 36, borderRadius: 999, backgroundColor: demo ? "rgba(232,194,125,0.22)" : "rgba(134,217,155,0.18)", borderWidth: 1, borderColor: demo ? "rgba(232,194,125,0.5)" : "rgba(134,217,155,0.4)", transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 76] }) }] }} />
      {option(false, "Live")}
      {option(true, "Demo")}
    </View>
  );
}

// Shown at the top of every page while demo mode is on. In the interactive demo (the browser app)
// it also has Reset demo, "Run today's automatic jobs", and the quiet "In demo, this would be sent
// to …" notes for what Live would send to email, phones or Hostaway.
export function DemoBanner({ viewing, onViewAs, onLive }: { palette: Palette; viewing: string | null; onViewAs: () => void; onLive: () => void }) {
  const interactive = demoInteractive();
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"jobs" | "reset" | null>(null), [confirmReset, setConfirmReset] = useState(false), [status, setStatus] = useState(""), [menu, setMenu] = useState(false);
  useEffect(() => subscribeDemoNotes(next => setNotes(current => [...next, ...current].slice(0, 3))), []);
  useEffect(() => { if (!notes.length) return; const t = setTimeout(() => setNotes([]), 30000); return () => clearTimeout(t); }, [notes]);
  const runJobs = async () => {
    setBusy("jobs"); setStatus("");
    try {
      const done = await runDemoJobs();
      const failed = done.results.filter(r => !r.ok).length;
      setMenu(false);
      setStatus(failed ? `Today's automatic jobs ran; ${failed} could not run.` : "Today's automatic jobs ran: reminders, flags, to-dos and follow-ups are up to date.");
      refreshScreens();
    } catch (e) { setStatus(e instanceof Error ? e.message : "The jobs could not run."); } finally { setBusy(null); }
  };
  const reset = async () => {
    setBusy("reset"); setStatus(""); setConfirmReset(false);
    try {
      await resetDemo();
      // Photos the sample people took wait in this browser's upload line; they go too.
      for (const item of uploads.getSnapshot().items.filter(x => isDemoPerson(x.ownerId))) await uploads.remove(item.id);
      setNotes([]); setMenu(false); setStatus("The demo is back to how it started.");
      refreshScreens();
    } catch (e) { setStatus(e instanceof Error ? e.message : "The demo could not be reset."); } finally { setBusy(null); }
  };
  // All of the demo's controls sit in one small menu by the banner (house rule: as few buttons as possible).
  const item = (label: string, icon: React.ComponentProps<typeof Feather>["name"], onPress: () => void, working = false, detail = "") => (
    <MotionPress accessibilityRole="menuitem" accessibilityLabel={label} disabled={!!busy} onPress={onPress} style={[ui.row, { gap: 10, minHeight: 40, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, opacity: busy && !working ? 0.6 : 1 }]}>
      {working ? <ActivityIndicator size="small" color="#FFF6E2" /> : <Feather name={icon} size={15} color="#E8C27D" />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#FFF6E2", fontSize: 13, fontWeight: "500" }}>{label}</Text>
        {!!detail && <Text style={{ color: "#F3E2BD", fontSize: 12, lineHeight: 16 }}>{detail}</Text>}
      </View>
    </MotionPress>
  );
  const close = (then: () => void) => () => { setMenu(false); setConfirmReset(false); then(); };
  return (
    <View accessibilityRole="alert" style={{ gap: 10, padding: 12, paddingLeft: 14, borderRadius: 18, backgroundColor: "#3A2C15", borderWidth: 1, borderColor: "#6B5326", overflow: "hidden", ...depth.card }}>
      <View style={[ui.row, { gap: 12, flexWrap: "wrap" }]}>
        <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#E8C27D" }}><Feather name="play" size={12} color="#3A2C15" /></View>
        </View>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Text style={{ color: "#FFF6E2", fontSize: 14, fontWeight: "700" }}>{viewing ? `Demo mode · viewing as ${viewing}` : "Demo mode · a sample business"}</Text>
          <Text style={{ color: "#F3E2BD", fontSize: 12, lineHeight: 17 }}>{interactive
            ? "Try anything: it all works on a private copy of a sample business kept in this browser. Your real records aren\u2019t shown or changed, and nothing is sent to anyone."
            : "Every screen shows sample properties, people and money. Your real records aren\u2019t shown or changed, and nothing you do here is saved."}</Text>
        </View>
        <MotionPress accessibilityRole="button" accessibilityLabel="Demo options" accessibilityState={{ expanded: menu }} onPress={() => { setMenu(!menu); setConfirmReset(false); }} style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "#8C6E33", backgroundColor: menu ? "#4A3A1E" : "transparent" }]}>
          {busy ? <ActivityIndicator size="small" color="#FFF6E2" /> : <Feather name="sliders" size={14} color="#FFF6E2" />}
          <Text style={{ color: "#FFF6E2", fontSize: 13, fontWeight: "600" }}>Demo options</Text>
          <Feather name={menu ? "chevron-up" : "chevron-down"} size={14} color="#FFF6E2" />
        </MotionPress>
      </View>
      {menu && (
        <View accessibilityRole="menu" style={{ alignSelf: "flex-end", width: "100%", maxWidth: 360, padding: 4, borderRadius: 14, backgroundColor: "#2E2311", borderWidth: 1, borderColor: "#6B5326" }}>
          {item(viewing ? "Change person" : "View as someone", "eye", close(onViewAs))}
          {interactive && item(busy === "jobs" ? "Running today\u2019s automatic jobs…" : "Run today\u2019s automatic jobs", "clock", () => void runJobs(), busy === "jobs", "Reminders, flags, to-dos and follow-ups, as the schedule makes them.")}
          {interactive && (confirmReset
            ? item("Reset: start again", "rotate-ccw", () => void reset(), busy === "reset", "The sample business goes back as it started. Everything you did in the demo goes.")
            : item("Reset demo", "rotate-ccw", () => setConfirmReset(true), busy === "reset"))}
          {item("Switch to Live", "zap", close(onLive))}
        </View>
      )}
      {!!status && <Text accessibilityRole="alert" style={{ color: "#F3E2BD", fontSize: 12, lineHeight: 17 }}>{status}</Text>}
      {notes.map((note, i) => (
        <View key={i + note} style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
          <Feather name="send" size={12} color="#E8C27D" style={{ marginTop: 3 }} /><Text style={{ flex: 1, color: "#F3E2BD", fontSize: 12, lineHeight: 17 }}>{note}</Text>
        </View>
      ))}
    </View>
  );
}
// Screens reload when the app comes back into view (LiveWorkspace listens to AppState); the demo's
// jobs changed the records under them, so ask for that now. (onDemoChanged in ./demo/notes is the
// direct hook for screens that want it.)
function refreshScreens() {
  try { globalThis.document?.dispatchEvent(new Event("visibilitychange")); } catch { /* not in a browser */ }
}

// The same choice in Profile, with what it does spelled out.
export function DemoSwitchRow({ palette: p, demo, busy, note, onChange }: { palette: Palette; demo: boolean; busy: boolean; note: string; onChange: (demo: boolean) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Demo</Text>
      <View style={{ borderRadius: 20, borderWidth: 1, borderColor: demo ? "#C99A45" : p.border, backgroundColor: p.background }}>
        <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
          <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: demo ? "#F3E7CF" : p.wash }}><Feather name="play-circle" size={18} color={demo ? "#875A1C" : p.primary} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Demo mode</Text>
            <Text style={[ui.small, { color: p.muted }]}>{demo ? "Showing a sample business. Turn off to go back to Live." : "Fill every screen with a sample business to show the app and try every flow. Your real records stay untouched; the demo is kept in this browser only."}</Text>
          </View>
          {busy ? <ActivityIndicator color={p.primary} /> : <Switch accessibilityLabel="Demo mode" value={demo} onValueChange={onChange} trackColor={{ false: p.controlBorder, true: "#C99A45" }} thumbColor={p.surface} />}
        </View>
      </View>
      {!!note && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{note}</Text>}
    </View>
  );
}

// While the switch happens: the screen dims and a card turns over from Live to Demo (or back).
export function DemoSwitching({ palette: p, visible, toDemo }: { palette: Palette; visible: boolean; toDemo: boolean }) {
  const reduced = useReducedMotion();
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!visible || reduced) return;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: native }));
    loop.start(); return () => loop.stop();
  }, [visible, reduced, spin]);
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View {...(Platform.OS === "web" ? { dataSet: { overlay: "blur" } } : {})} style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.overlay }}>
        <View style={{ alignItems: "center", gap: 14, paddingVertical: 26, paddingHorizontal: 30, borderRadius: 28, backgroundColor: p.surface, ...depth.floating }}>
          <Animated.View style={{ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: toDemo ? "#F3E7CF" : p.wash,
            transform: [{ perspective: 400 }, { rotateY: spin.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "180deg", "360deg"] }) }] }}>
            <Feather name={toDemo ? "play-circle" : "zap"} size={28} color={toDemo ? "#875A1C" : p.primary} />
          </Animated.View>
          <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{toDemo ? "Opening the demo business…" : "Going back to Live…"}</Text>
          <Text style={[ui.small, { color: p.muted, maxWidth: 260, textAlign: "center" }]}>{toDemo ? "Sample properties, people, cleans, stays and money." : "Your real records, as they are now."}</Text>
        </View>
      </View>
    </Modal>
  );
}
