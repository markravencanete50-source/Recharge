import { Children, createContext, isValidElement, useContext, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Entrance, MotionPress, Shimmer, Stagger, SwapIn, TweenNumber } from "./motion";
import { departmentColor, depth, primaryFill, ui, web, type Palette } from "./theme";
import { formatCount } from "../../lib/format";
import { sectionAnchor } from "../../lib/home-tools";
import { readableError } from "../../lib/error-copy";

// Where a Home tool asked to land: a tab inside a Work view (sub) and a section to scroll to (anchor).
// The nonce changes on every tap, so tapping the same tool again lands again.
// workId opens one job straight away (Home's Today board).
export type WorkFocus = { sub?: string; anchor?: string; open?: string; workId?: string; nonce: number };
export const WorkFocusContext = createContext<WorkFocus | null>(null);
export const useWorkFocus = () => useContext(WorkFocusContext);
// Places a Home tool can scroll to. On the web they are found by id; in the phone app each one
// registers itself so the page can measure where it is.
export const AnchorRegistry = createContext<Map<string, View> | null>(null);
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  const registry = useContext(AnchorRegistry);
  return <View nativeID={id} collapsable={false} ref={node => { if (!registry) return; if (node) registry.set(id, node); else registry.delete(id); }}>{children}</View>;
}

// Shared building blocks for the live (backend-connected) screens.
export const message = (error: unknown) => readableError(error);
export const london = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const addDays = (iso: string, days: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const dayLabel = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// The primary action is a flat forest fill; the others are a quiet mint wash that deepens on hover. On phones and inside sheets buttons span the width;
// on a computer's page they size to their label, so a lone action doesn't stretch across the screen.
export const InSheet = createContext(false);
export function Button({ label, onPress, p, primary = false, disabled = false, icon }: { label: string; onPress: () => void; p: Palette; primary?: boolean; disabled?: boolean; icon?: ComponentProps<typeof Feather>["name"] }) {
  const ink = disabled ? p.muted : primary ? p.onPrimary : p.primary;
  const { width } = useWindowDimensions(), sheet = useContext(InSheet);
  const hug = width >= 900 && !sheet;
  return (
    <MotionPress {...(!primary && Platform.OS === "web" && !disabled ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[ui.button, hug ? { flexGrow: 0, alignSelf: "flex-start", minWidth: 180, paddingHorizontal: 22 } : { flexGrow: 1 }, disabled ? { backgroundColor: p.elevated } : primary ? primaryFill(p) : { backgroundColor: p.wash, borderWidth: 1, borderColor: "transparent" }]}>
      {!!icon && <Feather name={icon} size={16} color={ink} />}
      <Text style={[ui.buttonText, { color: ink, letterSpacing: 0.1 }]}>{label}</Text>
    </MotionPress>
  );
}
// Pages reload on their own; this is the quiet manual reload, kept small beside the page's main action.
export function RefreshButton({ p, loading = false, onPress }: { p: Palette; loading?: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={loading ? "Refreshing" : "Refresh"} accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={onPress}
      style={[ui.row, { alignSelf: "flex-start", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: p.border }]}>
      <Feather name="refresh-cw" size={14} color={p.muted} />
      <Text style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>{loading ? "Refreshing…" : "Refresh"}</Text>
    </MotionPress>
  );
}
// The label sits above; the field brightens and takes the brand colour while you type in it.
export function Field({ label, value, onChange, p, multiline = false, placeholder, email = false }: { label: string; value: string; onChange: (v: string) => void; p: Palette; multiline?: boolean; placeholder?: string; email?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 7 }}>
      <Text style={[ui.small, { color: focused ? p.primary : p.muted, fontWeight: "600" }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} multiline={multiline} accessibilityLabel={label} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        {...(email ? { autoCapitalize: "none" as const, autoCorrect: false, keyboardType: "email-address" as const, autoComplete: "email" as const } : {})}
        style={{ minHeight: multiline ? 96 : 50, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: focused ? p.primary : p.controlBorder, color: p.text, backgroundColor: focused ? p.surface : p.background, textAlignVertical: multiline ? "top" : "center", fontFamily: "Montserrat_500Medium", fontSize: 14, ...web({ transition: "border-color 160ms ease, background-color 160ms ease, box-shadow 200ms ease" }) }} />
    </View>
  );
}
// A status pill with a dot in its colour, so the state reads before the word does.
export function Tag({ label, tone, p }: { label: string; tone: "good" | "wait" | "bad" | "plain"; p: Palette }) {
  const [bg, fg] = { good: [p.successWash, p.success], wait: [p.cautionWash, p.waiting], bad: [p.dangerWash, p.danger], plain: [p.wash, p.primary] }[tone];
  return <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
    <Text style={{ color: fg, fontSize: 12, lineHeight: 16, fontWeight: "700" }}>{label}</Text>
  </View>;
}
// Messages slide in, and again whenever their wording changes, so a new result is noticed.
export function Notice({ text, p, tone = "plain" }: { text: string; p: Palette; tone?: "plain" | "bad" }) {
  // A leading icon and a side rule keep notices reading as information, not as a button.
  const bad = tone === "bad", ink = bad ? p.danger : p.primary;
  return <SwapIn swapKey={text}><View style={[ui.row, { alignItems: "flex-start", gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: bad ? "transparent" : p.border, backgroundColor: bad ? p.dangerWash : p.background }]}>
    <View style={{ width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: bad ? p.surface : p.wash }}><Feather name={bad ? "alert-circle" : "info"} size={14} color={ink} /></View>
    <Text accessibilityLiveRegion="polite" style={[ui.small, { flex: 1, color: bad ? p.danger : p.text, paddingTop: 2 }]}>{text}</Text>
  </View></SwapIn>;
}
// Shimmering placeholder rows while a tool loads.
export function Loading({ p, rows = 3 }: { p: Palette; rows?: number }) {
  return <Shimmer rows={rows} color={p.surface} highlight={p.elevated} />;
}
export function Section({ title, count, p, children }: { title: string; count?: number; p: Palette; children: ReactNode }) {
  // Each section can be opened directly from a Home tool by its heading (section-daily-checks).
  return (
    <Anchor id={sectionAnchor(title)}><Entrance style={{ gap: 10 }}>
      <View style={[ui.between, { gap: 12 }]}>
        <View style={[ui.row, { gap: 10, flexShrink: 1 }]}>
          <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: p.primary, opacity: 0.85 }} />
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flexShrink: 1 }]}>{title}</Text>
        </View>
        {count !== undefined && <Tag label={String(count)} tone={count ? "wait" : "good"} p={p} />}
      </View>
      {/* Cards and rows inside a section arrive one after another. */}
      {Children.toArray(children).map((child, n) => <Stagger key={isValidElement(child) && child.key != null ? child.key : n} index={n}>{child}</Stagger>)}
    </Entrance></Anchor>
  );
}

// One request identifier per attempt, kept until it succeeds, so a retry after a
// lost response replays the original action instead of creating a duplicate.
export function useRequestId(key: string | null) {
  const ids = useRef(new Map<string, string>());
  return {
    get: () => { if (!key) return Crypto.randomUUID(); if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID()); return ids.current.get(key)!; },
    done: () => { if (key) ids.current.delete(key); },
  };
}


// A small coloured icon tile: department colour behind a line icon. Used on rows and stats.
export type IconName = ComponentProps<typeof Feather>["name"];
export type Tone = "cleans" | "ready" | "stays" | "clients" | "accounts";
// A flat neutral tile behind a line icon; `tone` is kept so callers need no change.
export function IconChip({ icon, p, size = 40 }: { icon: IconName; tone?: Tone; p: Palette; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size * 0.34, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}>
    <Feather name={icon} size={Math.round(size * 0.45)} color={p.primary} />
  </View>;
}

// Headline figures: label, a value that glides, and a supporting line. Laid out in a grid that
// keeps every tile the same width and wraps to two per row on phones, never squashing labels.
const StatCompact = createContext(false);
export function StatTile({ p, icon, tone, label, value, format = formatCount, detail, attention = false }: {
  p: Palette; icon: IconName; tone?: Tone; label: string; value: number | string; format?: (n: number) => string; detail?: string; attention?: boolean;
}) {
  // Phones show three compact tiles across (label, figure, icon); wider screens add the supporting line.
  const compact = useContext(StatCompact);
  const figure = { color: p.text, fontSize: compact ? 24 : 30, lineHeight: compact ? 28 : 36, fontWeight: "700" as const, letterSpacing: compact ? -0.6 : -1, fontVariant: ["tabular-nums" as const] };
  const ink = tone ? departmentColor(tone, p).ink : p.primary;
  return (
    <View {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityLabel={[label, typeof value === "number" ? format(value) : value, detail].filter(Boolean).join(", ")}
      style={{ flex: 1, minWidth: 0, padding: compact ? 12 : 18, gap: compact ? 6 : 10, borderRadius: compact ? 18 : 22, borderWidth: 1, borderColor: attention ? p.primary : p.border, backgroundColor: attention ? p.wash : p.surface, overflow: "hidden", ...depth.card }}>
      {/* A thread of the tile's colour along its top edge. */}
      {!compact && <View pointerEvents="none" style={{ position: "absolute", left: 18, right: 18, top: 0, height: 2, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: ink, opacity: attention ? 0.9 : 0.35 }} />}
      <View style={[ui.between, { gap: 6, alignItems: "flex-start" }]}>
        <Text numberOfLines={2} style={{ color: p.muted, fontSize: compact ? 11 : 11, lineHeight: compact ? 14 : 16, fontWeight: "700", letterSpacing: compact ? 0.4 : 1, textTransform: "uppercase", flex: 1 }}>{label}</Text>
        {!compact && <IconChip icon={icon} tone={tone} p={p} size={34} />}
      </View>
      {typeof value === "number"
        ? <TweenNumber value={value} format={format} numberOfLines={1} adjustsFontSizeToFit style={figure} />
        : <SwapIn swapKey={value}><Text numberOfLines={1} adjustsFontSizeToFit style={{ ...figure, fontSize: compact ? 17 : 22 }}>{value}</Text></SwapIn>}
      {compact ? <Feather name={icon} size={15} color={tone ? departmentColor(tone, p).ink : p.primary} /> : !!detail && <Text numberOfLines={2} style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{detail}</Text>}
    </View>
  );
}
export function StatGrid({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const items = Children.toArray(children);
  const compact = width < 600 && items.length <= 3;
  return (
    <StatCompact.Provider value={compact}>
      <View style={{ flexDirection: "row", flexWrap: compact ? "nowrap" : "wrap", gap: compact ? 8 : 12 }}>
        {items.map((child, n) => <Stagger key={isValidElement(child) && child.key != null ? child.key : n} index={n} style={compact ? { flex: 1, minWidth: 0 } : { flexGrow: 1, flexBasis: width < 600 ? 140 : 200, minWidth: 0 }}>{child}</Stagger>)}
      </View>
    </StatCompact.Provider>
  );
}
