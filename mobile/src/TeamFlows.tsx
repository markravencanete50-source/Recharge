import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flattenSheetChildren } from "../../lib/sheet-children";
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { Artwork } from "./Artwork";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { Entrance, MotionPress, Stagger, usePresence, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { depth, space, ui, web, type Palette } from "./theme";
import { InSheet } from "./LiveKit";
import { WORKSPACE_MAP } from "../../lib/workspace-map";
import type { Tool, WorkspaceRole } from "./model";
import { pillBox, pillInk } from "./Pills";
import {
  CHANNELS, CLEANER_PERFORMANCE, CLEANER_THREADS, CLEANS_TO_APPROVE, CLEAN_CHECKLIST, COURSES, DAILY_ROUTINE,
  QUICK_TOOLS, REPAIR_STAGES, ROUTINE_VISITS, TEAM_THREADS, type Course, type InboxChannel, type Thread,
} from "./teamSamples";

const hover = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};
const tint = Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {};

function SectionTitle({ palette: p, title, detail, action }: { palette: Palette; title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={ui.between}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
        {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}

// width: the widest the panel grows on a large screen (580 by default; the to-do task page opens wider, like ClickUp).
export function Sheet({ palette: p, visible, onClose, title, subtitle, icon, children, width: widest = 580 }: { palette: Palette; visible: boolean; onClose: () => void; title: string; subtitle?: string; icon?: DimensionalName; children: ReactNode; width?: number }) {
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  const reduced = useReducedMotion();
  // The backdrop fades and blurs while the panel rises from the bottom (phones) or settles in the
  // middle (larger screens), and both run back out on close before the panel is removed.
  const { shown, progress } = usePresence(visible, wide ? 300 : 380, 200);
  // While closing, keep showing what was there: callers often clear the content as they close.
  const [kept, setKept] = useState({ title, subtitle, icon, children });
  if (visible && (kept.title !== title || kept.subtitle !== subtitle || kept.icon !== icon || kept.children !== children)) setKept({ title, subtitle, icon, children });
  const content = visible ? { title, subtitle, icon, children } : kept;
  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [wide ? 18 : Math.min(560, height * 0.6), 0] });
  // On phones the sheet follows a finger pulling its top edge down, and closes past a short pull.
  const [drag] = useState(() => new Animated.Value(0));
  useEffect(() => { if (visible) drag.setValue(0); }, [visible, drag]);
  const pull = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 110 || g.vy > 1.1) onClose();
      else Animated.spring(drag, { toValue: 0, speed: 18, bounciness: 6, useNativeDriver: Platform.OS !== "web" }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== "web" }).start(),
  }), [drag, onClose]);
  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: wide ? "center" : "flex-end", alignItems: "center", padding: wide ? 24 : 0 }}>
        <Animated.View {...(Platform.OS === "web" ? { dataSet: { overlay: "blur" } } : {})} style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay, opacity: progress }]}>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} disabled={!visible} style={StyleSheet.absoluteFill} {...(Platform.OS === "web" ? { tabIndex: -1 } : {})} />
        </Animated.View>
        <Animated.View accessibilityViewIsModal pointerEvents={visible ? "auto" : "none"} style={{ width: "100%", maxWidth: Math.min(widest, width), minWidth: 0, maxHeight: wide ? "92%" : "92%", borderRadius: 30, borderBottomLeftRadius: wide ? 30 : 0, borderBottomRightRadius: wide ? 30 : 0, backgroundColor: p.surface, overflow: "hidden", ...depth.floating,
          opacity: wide ? progress : progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
          transform: [{ translateY: wide || reduced ? lift : Animated.add(lift, drag) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [wide ? 0.96 : 1, 1] }) }] }}>
          <View {...(wide ? {} : pull.panHandlers)}>
            {!wide && <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 2 }}><View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: p.controlBorder, opacity: 0.45 }} /></View>}
            <View style={[ui.between, { gap: 12, paddingHorizontal: 20, paddingVertical: 16, paddingTop: wide ? 20 : 10, borderBottomWidth: 1, borderColor: p.border }]}>
              <View style={[ui.row, { gap: 14, flex: 1 }]}>
                {!!content.icon && <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={content.icon} size={36} color={p.primary} /></View>}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text accessibilityRole="header" numberOfLines={2} style={{ color: p.text, fontSize: 18, lineHeight: 24, fontWeight: "700", letterSpacing: -0.3 }}>{content.title}</Text>
                  {!!content.subtitle && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{content.subtitle}</Text>}
                </View>
              </View>
              <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={4} style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}>
                <Feather name="x" size={18} color={p.text} />
              </MotionPress>
            </View>
          </View>
          <ScrollView style={{ width: "100%" }} contentContainerStyle={{ padding: 20, gap: space.section, minWidth: 0, maxWidth: "100%" }} keyboardShouldPersistTaps="handled">
            <InSheet.Provider value>{shown && flattenSheetChildren(content.children).map(({ key, node }, n) => <Stagger key={key} index={n}>{node as ReactNode}</Stagger>)}</InSheet.Provider>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PrimaryButton({ palette: p, label, icon = "arrow-right", onPress, tone = "primary" }: { palette: Palette; label: string; icon?: "arrow-right" | "check" | "send" | "x" | "upload"; onPress: () => void; tone?: "primary" | "quiet" }) {
  const quiet = tone === "quiet";
  return (
    <MotionPress accessibilityRole="button" onPress={onPress} style={[ui.between, { minHeight: 50, paddingHorizontal: 18, borderRadius: 16, backgroundColor: quiet ? p.elevated : p.primary }]}>
      <Text style={{ color: quiet ? p.text : p.onPrimary, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <Feather name={icon} size={18} color={quiet ? p.text : p.onPrimary} />
    </MotionPress>
  );
}

function Check({ palette: p, checked, label, onToggle }: { palette: Palette; checked: boolean; label: string; onToggle: () => void }) {
  return (
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onToggle} style={[ui.row, { gap: 12, minHeight: 46 }]}>
      <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: checked ? p.primary : p.controlBorder, backgroundColor: checked ? p.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
        {checked && <Feather name="check" size={15} color={p.onPrimary} />}
      </View>
      <Text style={{ flex: 1, color: p.text, fontSize: 14 }}>{label}</Text>
    </MotionPress>
  );
}

// Staff Home: quick access to the tools each role uses most.
export function QuickAccess({ palette: p, role, tools, onOpen, onAll, columns = 2 }: { palette: Palette; role: WorkspaceRole; tools: Tool[]; onOpen: (tool: Tool) => void; onAll: () => void; columns?: 2 | 4 }) {
  const picked = QUICK_TOOLS[role].map(id => tools.find(tool => tool.id === id)).filter((tool): tool is Tool => !!tool);
  const list = [...picked, ...tools.filter(tool => !picked.includes(tool))].slice(0, 4);
  const rows = columns === 4 ? [list] : [list.slice(0, 2), list.slice(2, 4)];
  return (
    <Entrance sessionKey={"quick-access:" + role} style={{ gap: 14 }}>
      <SectionTitle palette={p} title="Quick access" detail="Your most used tools, one tap away" action={
        <MotionPress accessibilityRole="button" onPress={onAll} style={[ui.row, { gap: 4, minHeight: 44, paddingHorizontal: 6 }]}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>All tools</Text>
          <Feather name="chevron-right" size={16} color={p.muted} />
        </MotionPress>
      } />
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", gap: 12 }}>
          {row.map(tool => (
            <MotionPress key={tool.id} {...hover} accessibilityRole="button" accessibilityLabel={"Open " + tool.name} onPress={() => onOpen(tool)} style={{ flex: 1, minWidth: 0, padding: 16, gap: 12, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
              <View style={[ui.between, { alignItems: "flex-start" }]}>
                <Artwork id={tool.id} size={48} palette={p} />
                <Feather name="arrow-up-right" size={17} color={p.muted} />
              </View>
              <View style={{ gap: 2 }}>
                <Text numberOfLines={2} style={{ color: p.text, fontSize: 14, fontWeight: "700", lineHeight: 19 }}>{tool.name}</Text>
                <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{WORKSPACE_MAP[tool.id].area}</Text>
              </View>
            </MotionPress>
          ))}
          {row.length < (columns === 4 ? 4 : 2) && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </Entrance>
  );
}

// Work: the Stays team's daily routine, compact until opened.
export function DailyRoutine({ palette: p, tools, onOpen }: { palette: Palette; tools: Tool[]; onOpen: (tool: Tool) => void }) {
  const monday = new Date().getDay() === 1;
  const items = DAILY_ROUTINE.filter(item => item.cadence !== "Mondays" || monday).filter(item => tools.some(tool => tool.id === item.id));
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const shown = open ? items : items.filter(item => !done.includes(item.id)).slice(0, 3);
  return (
    <View style={{ padding: 16, gap: 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.row, { gap: 12 }]}>
        <DimensionalIcon name="clipboard" size={40} color={p.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Today&apos;s routine</Text>
          <Text style={[ui.small, { color: p.muted }]}>{done.length} of {items.length} daily reports done</Text>
        </View>
        <MotionPress accessibilityRole="button" accessibilityLabel={open ? "Show fewer routine items" : "Show all routine items"} onPress={() => setOpen(!open)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{open ? "Less" : "All"}</Text>
        </MotionPress>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: p.background, overflow: "hidden" }}>
        <View style={{ width: `${(done.length / items.length) * 100}%`, height: 6, borderRadius: 3, backgroundColor: p.primary }} />
      </View>
      {shown.map(item => {
        const tool = tools.find(entry => entry.id === item.id);
        const checked = done.includes(item.id);
        return (
          <View key={item.id} style={[ui.row, { gap: 8 }]}>
            <View style={{ flex: 1 }}><Check palette={p} checked={checked} label={item.label + (item.cadence === "Mondays" ? " (Mondays)" : "")} onToggle={() => setDone(checked ? done.filter(id => id !== item.id) : [...done, item.id])} /></View>
            {tool && <MotionPress accessibilityRole="button" accessibilityLabel={"Open " + tool.name} onPress={() => onOpen(tool)} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.background }}><Feather name="arrow-up-right" size={16} color={p.muted} /></MotionPress>}
          </View>
        );
      })}
      {!open && done.length === items.length && <Text style={[ui.small, { color: p.muted }]}>All done for today. Nice work.</Text>}
    </View>
  );
}

// Work: cleans submitted today, waiting for the Stays team's decision.
export function CleansToApprove({ palette: p }: { palette: Palette }) {
  const [decisions, setDecisions] = useState<Record<string, { approved: boolean; reason?: string }>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle palette={p} title="Cleans to approve" detail="Approve so the cleaner is paid, or reject with a reason" />
      {CLEANS_TO_APPROVE.map(clean => {
        const decision = decisions[clean.id];
        return (
          <View key={clean.id} style={{ padding: 16, gap: 12, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
            <View style={[ui.row, { gap: 12 }]}>
              <DimensionalIcon name="spray" size={40} color={p.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{clean.property}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{clean.cleaner} · {clean.date} · {clean.photos} photos</Text>
              </View>
            </View>
            {!!clean.issue && <View style={[ui.row, { gap: 8, padding: 10, borderRadius: 12, backgroundColor: p.cautionWash }]}><Feather name="tool" size={14} color={p.text} /><Text style={[ui.small, { flex: 1, color: p.text }]}>Maintenance flagged: {clean.issue}</Text></View>}
            {decision ? (
              <View style={[ui.row, { gap: 8, padding: 10, borderRadius: 12, backgroundColor: decision.approved ? p.successWash : p.cautionWash }]}>
                <Feather name={decision.approved ? "check-circle" : "alert-circle"} size={15} color={p.text} />
                <Text style={[ui.small, { flex: 1, color: p.text }]}>{decision.approved ? "Approved. Added to the cleaner's invoice and they have been notified." : `Rejected: ${decision.reason}. The cleaner is notified and the clean goes to management review.`}</Text>
              </View>
            ) : rejecting === clean.id ? (
              <View style={{ gap: 8 }}>
                <TextInput accessibilityLabel="Reason for rejecting this clean" value={reason} onChangeText={setReason} placeholder="What wasn't guest ready?" placeholderTextColor={p.muted} style={[ui.input, { color: p.text, backgroundColor: p.background, borderColor: p.border }]} />
                <View style={[ui.row, { gap: 8 }]}>
                  <View style={{ flex: 1 }}><PrimaryButton palette={p} tone="quiet" label="Cancel" icon="x" onPress={() => { setRejecting(null); setReason(""); }} /></View>
                  <View style={{ flex: 1 }}><PrimaryButton palette={p} label="Reject" icon="send" onPress={() => { if (!reason.trim()) return; setDecisions({ ...decisions, [clean.id]: { approved: false, reason: reason.trim() } }); setRejecting(null); setReason(""); }} /></View>
                </View>
              </View>
            ) : (
              <View style={[ui.row, { gap: 8 }]}>
                <View style={{ flex: 1 }}><PrimaryButton palette={p} tone="quiet" label="Reject" icon="x" onPress={() => setRejecting(clean.id)} /></View>
                <View style={{ flex: 1 }}><PrimaryButton palette={p} label="Approve" icon="check" onPress={() => setDecisions({ ...decisions, [clean.id]: { approved: true } })} /></View>
              </View>
            )}
          </View>
        );
      })}
      <Text style={[ui.small, { color: p.muted }]}>Preview only. Decisions are not saved.</Text>
    </View>
  );
}

// Cleaner Home and management view: approved and rejected cleans, warnings.
export function CleanerPerformance({ palette: p, mine }: { palette: Palette; mine: boolean }) {
  if (mine) {
    const me = CLEANER_PERFORMANCE[0];
    return (
      <View style={{ gap: 12 }}>
        <SectionTitle palette={p} title="Your performance" detail="This month, from approved and rejected cleans" />
        <View style={{ flexDirection: "row", gap: 12 }}>
          {[["medal", String(me.approved), "Approved cleans"], ["clipboard", String(me.rejected), "Rejected"], ["coins", "£" + (me.approved * 65).toLocaleString("en-GB"), "On your invoice"]].map(([icon, value, label]) => (
            <View key={label} style={{ flex: 1, padding: 14, gap: 8, borderRadius: 20, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
              <DimensionalIcon name={icon as DimensionalName} size={32} color={p.primary} />
              <Text style={{ color: p.text, fontSize: 22, fontWeight: "700" }}>{value}</Text>
              <Text numberOfLines={2} style={{ color: p.muted, fontSize: 12 }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle palette={p} title="Cleaner performance" detail="Two rejected cleans in a month triggers a warning and a management chat" />
      <View style={{ borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
        {CLEANER_PERFORMANCE.map((cleaner, index) => (
          <View key={cleaner.name} style={[ui.row, { gap: 12, padding: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.text, fontWeight: "700" }}>{cleaner.name.split(" ").pop()?.slice(0, 2).toUpperCase()}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{cleaner.name}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{cleaner.approved} approved · {cleaner.rejected} rejected</Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: cleaner.warning === "warning" ? p.cautionWash : p.successWash }}>
              <Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{cleaner.warning === "warning" ? "Warning" : "Good standing"}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// Cleaner: complete a job with checklist, connectivity checks, photos or video and issues.
export function CleanJobSheet({ palette: p, visible, onClose, property, guests }: { palette: Palette; visible: boolean; onClose: () => void; property: string; guests: number }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [wifi, setWifi] = useState(false);
  const [broadband, setBroadband] = useState(false);
  const [media, setMedia] = useState<number>(0);
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const close = () => { setChecked([]); setWifi(false); setBroadband(false); setMedia(0); setIssue(""); setError(""); setSubmitted(false); onClose(); };
  const pick = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 0.8 });
      if (!result.canceled) setMedia(count => count + result.assets.length);
    } catch { setError("Your photos could not be opened. Please try again."); }
  };
  const submit = () => {
    if (checked.length < CLEAN_CHECKLIST.length) { setError("Tick every checklist item first."); return; }
    if (!wifi || !broadband) { setError("Confirm the Wi-Fi and broadband are working."); return; }
    if (!media) { setError("Add photos or a video of every room."); return; }
    setError(""); setSubmitted(true);
  };
  return (
    <Sheet palette={p} visible={visible} onClose={close} title={property} subtitle={`Turnover clean · next stay: ${guests} guests`} icon="spray">
      {submitted ? (
        <View style={{ gap: 14 }}>
          <View style={{ alignItems: "center", gap: 8 }}><DimensionalIcon name="medal" size={80} color={p.primary} /><Text style={{ color: p.text, fontSize: 19, fontWeight: "700" }}>Clean submitted</Text></View>
          {[["check-circle", "Submitted with " + media + " photos or videos", true], ["clock", "The Stays team reviews it today", false], ["dollar-sign", "Once approved, it is added to your invoice and you are notified", false], ["alert-circle", "If rejected, you see the reason and management reviews it", false]].map(([icon, text, doneNow]) => (
            <View key={String(text)} style={[ui.row, { gap: 10 }]}>
              <Feather name={icon as "clock"} size={16} color={doneNow ? p.primary : p.muted} />
              <Text style={[ui.small, { flex: 1, color: doneNow ? p.text : p.muted }]}>{String(text)}</Text>
            </View>
          ))}
          {!!issue.trim() && <Text style={[ui.small, { color: p.text }]}>Maintenance issue sent to the Ready team: {issue.trim()}</Text>}
          <PrimaryButton palette={p} label="Done" icon="check" onPress={close} />
        </View>
      ) : (
        <>
          <Text style={[ui.small, { color: p.muted, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }]}>Checklist</Text>
          {CLEAN_CHECKLIST.map(item => <Check key={item} palette={p} label={item} checked={checked.includes(item)} onToggle={() => setChecked(checked.includes(item) ? checked.filter(entry => entry !== item) : [...checked, item])} />)}
          <Text style={[ui.small, { color: p.muted, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }]}>Before you leave</Text>
          <Check palette={p} label="Wi-Fi is working" checked={wifi} onToggle={() => setWifi(!wifi)} />
          <Check palette={p} label="Broadband is working" checked={broadband} onToggle={() => setBroadband(!broadband)} />
          <MotionPress accessibilityRole="button" onPress={pick} style={[ui.row, { gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: p.controlBorder, backgroundColor: p.background }]}>
            <Feather name="camera" size={20} color={p.text} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{media ? `${media} photos or videos added` : "Add photos or a walkthrough video"}</Text>
              <Text style={[ui.small, { color: p.muted }]}>Every room, from the doorway</Text>
            </View>
            <Feather name="plus" size={18} color={p.muted} />
          </MotionPress>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Maintenance issues (optional)</Text>
          <TextInput accessibilityLabel="Maintenance issues found" value={issue} onChangeText={setIssue} placeholder="For example, dripping kitchen tap" placeholderTextColor={p.muted} multiline style={[ui.input, { color: p.text, backgroundColor: p.background, borderColor: p.border, minHeight: 70, textAlignVertical: "top" }]} />
          {!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{error}</Text>}
          <PrimaryButton palette={p} label="Submit clean for approval" icon="send" onPress={submit} />
          <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>Preview only. Nothing is uploaded or sent.</Text>
        </>
      )}
    </Sheet>
  );
}

// Ready Home: how repairs move, plus routine visits this month.
export function RepairPipeline({ palette: p }: { palette: Palette }) {
  const max = Math.max(...REPAIR_STAGES.map(stage => stage.count));
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle palette={p} title="Repairs in progress" detail="From the Stays report to payment by Accounts" />
      <View style={{ padding: 16, gap: 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
        {REPAIR_STAGES.map((stage, index) => (
          <View key={stage.key} style={[ui.row, { gap: 10 }]}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.text, fontSize: 11, fontWeight: "700" }}>{index + 1}</Text></View>
            <Text numberOfLines={1} style={{ width: 132, color: p.text, fontSize: 13 }}>{stage.label}</Text>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: p.background, overflow: "hidden" }}><View style={{ width: `${(stage.count / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: p.primary }} /></View>
            <Text style={{ width: 20, textAlign: "right", color: p.text, fontSize: 13, fontWeight: "700" }}>{stage.count}</Text>
          </View>
        ))}
      </View>
      <SectionTitle palette={p} title="Preventative maintenance" detail="One visit per assigned property each month" />
      <View style={{ borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
        {ROUTINE_VISITS.map((visit, index) => (
          <View key={visit.property} style={[ui.row, { gap: 12, padding: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border }]}>
            <DimensionalIcon name={visit.status === "done" ? "medal" : visit.status === "booked" ? "calendar" : "toolbox"} size={34} color={p.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{visit.property}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{visit.when}</Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: visit.status === "due" ? p.cautionWash : p.successWash }}>
              <Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{visit.status === "due" ? "To book" : visit.status === "booked" ? "Booked" : "Done"}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ThreadBody({ palette: p, thread, draft, setDraft, onSent }: { palette: Palette; thread: Thread; draft: string; setDraft: (value: string) => void; onSent: () => void }) {
  const open = thread;
  return (
    <>
        {open?.messages.map((message, index) => (
          <View key={index} style={{ alignSelf: message.from === "us" ? "flex-end" : "flex-start", maxWidth: "86%", padding: 12, borderRadius: 18, borderBottomRightRadius: message.from === "us" ? 4 : 18, borderBottomLeftRadius: message.from === "us" ? 18 : 4, backgroundColor: message.from === "us" ? p.primary : p.background, gap: 4 }}>
            <Text style={{ color: message.from === "us" ? p.onPrimary : p.text, fontSize: 14, lineHeight: 20 }}>{message.body}</Text>
            <Text style={{ color: message.from === "us" ? p.onPrimary : p.muted, fontSize: 11, opacity: 0.8 }}>{message.author} · {message.time}</Text>
          </View>
        ))}
        {!!open?.suggestion && (
          <View style={{ padding: 14, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.wash }}>
            <View style={[ui.row, { gap: 8 }]}><Feather name="zap" size={15} color={p.text} /><Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Suggested reply</Text><Text style={[ui.small, { color: p.muted }]}>from your workflows</Text></View>
            <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{open.suggestion}</Text>
            <MotionPress accessibilityRole="button" onPress={() => setDraft(open.suggestion ?? "")} style={{ alignSelf: "flex-start", minHeight: 38, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
              <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Use this reply</Text>
            </MotionPress>
          </View>
        )}
        <TextInput accessibilityLabel="Your reply" value={draft} onChangeText={setDraft} placeholder="Write a reply…" placeholderTextColor={p.muted} multiline style={[ui.input, { color: p.text, backgroundColor: p.background, borderColor: p.border, minHeight: 90, textAlignVertical: "top" }]} />
        <PrimaryButton palette={p} label="Send" icon="send" onPress={() => { setDraft(""); onSent(); }} />
        <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>Preview only. Nothing is sent.</Text>
    </>
  );
}

// Inbox split by channel, with an AI-suggested reply for guest messages.
export function TeamInbox({ palette: p, role }: { palette: Palette; role: WorkspaceRole }) {
  const cleaner = role === "cleans" || role === "cleaning_manager";
  const threads = cleaner ? CLEANER_THREADS : TEAM_THREADS;
  const channels = cleaner ? [] : CHANNELS;
  const [channel, setChannel] = useState<InboxChannel | "all">("all");
  const [open, setOpen] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const shown = threads.filter(thread => channel === "all" || thread.channel === channel);
  const icon = (key: InboxChannel) => CHANNELS.find(entry => entry.key === key)?.icon ?? "message-circle";
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  // Desktop keeps the conversation beside the list instead of in a sheet.
  const active = wide ? (open && shown.includes(open) ? open : shown[0] ?? null) : open;
  return (
    <View style={{ gap: 14 }}>
      {!!channels.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ key: "all" as const, label: "All", icon: "inbox" as const }, ...channels].map(entry => {
            const selected = channel === entry.key;
            const unread = threads.filter(thread => thread.unread && (entry.key === "all" || thread.channel === entry.key)).length;
            return (
              <MotionPress key={entry.key} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setChannel(entry.key)} style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, ...pillBox(p, selected) }]}>
                <Feather name={entry.icon} size={14} color={pillInk(p, selected)} />
                <Text style={{ color: pillInk(p, selected), fontSize: 13, fontWeight: "600" }}>{entry.label}</Text>
                {!!unread && <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: selected ? p.onSelected : p.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: selected ? p.selected : p.onPrimary, fontSize: 11, fontWeight: "700" }}>{unread}</Text></View>}
              </MotionPress>
            );
          })}
        </ScrollView>
      )}
      <View style={{ flexDirection: wide ? "row" : "column", gap: 16, alignItems: "flex-start" }}>
      <View style={{ flex: wide ? 5 : undefined, alignSelf: "stretch", borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
        {shown.map((thread, index) => (
          <MotionPress key={thread.id} {...tint} accessibilityRole="button" accessibilityLabel={`${thread.name}, ${thread.property}, ${thread.unread ? "unread" : "read"}`} onPress={() => { setOpen(thread); setDraft(""); }} style={[ui.row, { gap: 12, padding: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border, backgroundColor: wide && active?.id === thread.id ? p.wash : "transparent" }]}>
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon(thread.channel)} size={18} color={p.text} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={ui.between}>
                <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: thread.unread ? "700" : "600" }}>{thread.name}</Text>
                <Text style={{ color: p.muted, fontSize: 12 }}>{thread.time}</Text>
              </View>
              <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{thread.property} · {thread.source}</Text>
              <Text numberOfLines={1} style={{ color: thread.unread ? p.text : p.muted, fontSize: 13 }}>{thread.messages[thread.messages.length - 1].body}</Text>
            </View>
            {thread.unread && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.primary }} />}
          </MotionPress>
        ))}
        {!shown.length && <Text style={[ui.small, { color: p.muted, padding: 16 }]}>No conversations in this channel yet.</Text>}
      </View>
      {wide && active && (
        <View style={{ flex: 7, alignSelf: "stretch", padding: 18, gap: 14, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.row, { gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: p.border }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon(active.channel)} size={18} color={p.text} /></View>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "700" }}>{active.name}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{active.property} · {active.source}</Text>
            </View>
          </View>
          <ThreadBody palette={p} thread={active} draft={draft} setDraft={setDraft} onSent={() => setDraft("")} />
        </View>
      )}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>Sample conversations. Guest messages arrive from Hostaway, and email connects when its account is linked.</Text>
      {wide ? null : (
        <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} subtitle={open ? `${open.property} · ${open.source}` : ""} icon="chat">
          {open && <ThreadBody palette={p} thread={open} draft={draft} setDraft={setDraft} onSent={() => { setDraft(""); setOpen(null); }} />}
        </Sheet>
      )}
    </View>
  );
}

// Training centre: courses the team can read, with uploads for admins.
export function TrainingCentre({ palette: p, role }: { palette: Palette; role: WorkspaceRole }) {
  const [open, setOpen] = useState<Course | null>(null);
  const [category, setCategory] = useState("All");
  const [uploaded, setUploaded] = useState(0);
  const admin = role === "admin" || role === "super_admin";
  const categories = ["All", ...Array.from(new Set(COURSES.map(course => course.category)))];
  const shown = COURSES.filter(course => category === "All" || course.category === category);
  const upload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true });
      if (!result.canceled) setUploaded(count => count + result.assets.length);
    } catch { /* picker unavailable */ }
  };
  return (
    <View style={{ gap: 18 }}>
      <Entrance sessionKey="training:heading" style={{ gap: 6 }}>
        <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Recharge academy</Text>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Training centre</Text>
        <Text style={[ui.body, { color: p.muted }]}>Short guides that keep every team working the Recharge way.</Text>
      </Entrance>
      {admin && (
        <MotionPress accessibilityRole="button" onPress={upload} style={[ui.row, { gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: p.controlBorder, backgroundColor: p.surface }]}>
          <DimensionalIcon name="toolbox" size={40} color={p.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Upload training material</Text>
            <Text style={[ui.small, { color: p.muted }]}>{uploaded ? `${uploaded} files ready (preview only)` : "Videos and images now; documents when storage is connected"}</Text>
          </View>
          <Feather name="upload" size={18} color={p.muted} />
        </MotionPress>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {categories.map(entry => {
          const selected = entry === category;
          return (
            <MotionPress key={entry} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setCategory(entry)} style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, ...pillBox(p, selected) }}>
              <Text style={{ color: pillInk(p, selected), fontSize: 13, fontWeight: "600" }}>{entry}</Text>
            </MotionPress>
          );
        })}
      </ScrollView>
      {shown.map(course => (
        <MotionPress key={course.id} {...hover} accessibilityRole="button" accessibilityLabel={`${course.title}, ${course.minutes} minutes, ${Math.round(course.progress * 100)}% complete`} onPress={() => setOpen(course)} style={{ padding: 16, gap: 12, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.row, { gap: 12 }]}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={course.category === "Cleans" ? "spray" : course.category === "Ready" ? "hardhat" : course.category === "Stays" ? "chat" : "compass"} size={40} color={p.primary} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{course.title}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{course.category} · {course.minutes} min read</Text>
            </View>
            <Feather name="chevron-right" size={18} color={p.muted} />
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: p.background, overflow: "hidden" }}><View style={{ width: `${course.progress * 100}%`, height: 6, borderRadius: 3, backgroundColor: p.primary }} /></View>
          <Text style={[ui.small, { color: p.muted }]}>{course.progress >= 1 ? "Completed" : course.progress > 0 ? `${Math.round(course.progress * 100)}% complete` : "Not started"}</Text>
        </MotionPress>
      ))}
      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `${open.category} · ${open.minutes} min read` : ""} icon="compass">
        <Text style={[ui.body, { color: p.text }]}>{open?.summary}</Text>
        {open?.points.map((point, index) => (
          <View key={index} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{index + 1}</Text></View>
            <Text style={[ui.body, { flex: 1, color: p.text }]}>{point}</Text>
          </View>
        ))}
        <PrimaryButton palette={p} label="Mark as complete" icon="check" onPress={() => setOpen(null)} />
      </Sheet>
    </View>
  );
}
