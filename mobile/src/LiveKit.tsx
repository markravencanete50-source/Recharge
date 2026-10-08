import { Children, createContext, isValidElement, useContext, useRef, type ComponentProps, type ReactNode } from "react";
import { TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Entrance, MotionPress, Shimmer, Stagger, SwapIn, TweenNumber } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { formatCount } from "../../lib/format";
import { sectionAnchor } from "../../lib/home-tools";

// Where a Home tool asked to land: a tab inside a Work view (sub) and a section to scroll to (anchor).
// The nonce changes on every tap, so tapping the same tool again lands again.
export type WorkFocus = { sub?: string; anchor?: string; open?: string; nonce: number };
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
export const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
export const london = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const addDays = (iso: string, days: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const dayLabel = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export function Button({ label, onPress, p, primary = false, disabled = false, icon }: { label: string; onPress: () => void; p: Palette; primary?: boolean; disabled?: boolean; icon?: ComponentProps<typeof Feather>["name"] }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, { backgroundColor: disabled ? p.elevated : primary ? p.primary : p.wash, flexGrow: 1 }]}>
      {!!icon && <Feather name={icon} size={16} color={disabled ? p.muted : primary ? p.onPrimary : p.primary} />}
      <Text style={[ui.buttonText, { color: disabled ? p.muted : primary ? p.onPrimary : p.primary }]}>{label}</Text>
    </MotionPress>
  );
}
export function Field({ label, value, onChange, p, multiline = false, placeholder, email = false }: { label: string; value: string; onChange: (v: string) => void; p: Palette; multiline?: boolean; placeholder?: string; email?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} multiline={multiline} accessibilityLabel={label}
        {...(email ? { autoCapitalize: "none" as const, autoCorrect: false, keyboardType: "email-address" as const, autoComplete: "email" as const } : {})}
        style={{ minHeight: multiline ? 88 : 48, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, textAlignVertical: multiline ? "top" : "center", fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
    </View>
  );
}
export function Tag({ label, tone, p }: { label: string; tone: "good" | "wait" | "bad" | "plain"; p: Palette }) {
  const [bg, fg] = { good: [p.successWash, p.success], wait: [p.cautionWash, p.waiting], bad: ["#F6DEDA", "#A63A32"], plain: [p.wash, p.primary] }[tone];
  return <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}><Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text></View>;
}
// Messages slide in, and again whenever their wording changes, so a new result is noticed.
export function Notice({ text, p, tone = "plain" }: { text: string; p: Palette; tone?: "plain" | "bad" }) {
  return <SwapIn swapKey={text}><View style={{ padding: 12, borderRadius: 14, backgroundColor: tone === "bad" ? "#F6DEDA" : p.wash }}><Text accessibilityLiveRegion="polite" style={[ui.small, { color: tone === "bad" ? "#A63A32" : p.text }]}>{text}</Text></View></SwapIn>;
}
// Shimmering placeholder rows while a tool loads.
export function Loading({ p, rows = 3 }: { p: Palette; rows?: number }) {
  return <Shimmer rows={rows} color={p.surface} highlight={p.elevated} />;
}
export function Section({ title, count, p, children }: { title: string; count?: number; p: Palette; children: ReactNode }) {
  // Each section can be opened directly from a Home tool by its heading (section-daily-checks).
  return (
    <Anchor id={sectionAnchor(title)}><Entrance style={{ gap: 10 }}>
      <View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>{count !== undefined && <Tag label={String(count)} tone={count ? "wait" : "good"} p={p} />}</View>
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
export function IconChip({ icon, tone, p, size = 40 }: { icon: IconName; tone?: Tone; p: Palette; size?: number }) {
  const colour = tone ? departmentColor(tone, p) : { ink: p.primary, wash: p.wash };
  return <View style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: "center", justifyContent: "center", backgroundColor: colour.wash }}><Feather name={icon} size={Math.round(size * 0.45)} color={colour.ink} /></View>;
}

// Headline figures: label, a value that glides, and a supporting line. Laid out in a grid that
// keeps every tile the same width and wraps to two per row on phones, never squashing labels.
const StatCompact = createContext(false);
export function StatTile({ p, icon, tone, label, value, format = formatCount, detail, attention = false }: {
  p: Palette; icon: IconName; tone?: Tone; label: string; value: number | string; format?: (n: number) => string; detail?: string; attention?: boolean;
}) {
  // Phones show three compact tiles across (label, figure, icon); wider screens add the supporting line.
  const compact = useContext(StatCompact);
  const figure = { color: p.text, fontSize: compact ? 24 : 28, lineHeight: compact ? 28 : 32, fontWeight: "700" as const, letterSpacing: -0.5, fontVariant: ["tabular-nums" as const] };
  return (
    <View accessibilityLabel={[label, typeof value === "number" ? format(value) : value, detail].filter(Boolean).join(", ")}
      style={{ flex: 1, minWidth: 0, padding: compact ? 12 : 16, gap: compact ? 6 : 10, borderRadius: compact ? 18 : 20, borderWidth: 1, borderColor: attention ? p.primary : p.border, backgroundColor: attention ? p.wash : p.surface }}>
      <View style={[ui.between, { gap: 6, alignItems: "flex-start" }]}>
        <Text numberOfLines={2} style={{ color: p.muted, fontSize: compact ? 11 : 12, lineHeight: compact ? 14 : 16, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", flex: 1 }}>{label}</Text>
        {!compact && <IconChip icon={icon} tone={tone} p={p} size={32} />}
      </View>
      {typeof value === "number"
        ? <TweenNumber value={value} format={format} numberOfLines={1} adjustsFontSizeToFit style={figure} />
        : <SwapIn swapKey={value}><Text numberOfLines={1} adjustsFontSizeToFit style={{ ...figure, fontSize: compact ? 17 : 22 }}>{value}</Text></SwapIn>}
      {compact ? <Feather name={icon} size={15} color={tone ? departmentColor(tone, p).ink : p.primary} /> : !!detail && <Text numberOfLines={1} style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{detail}</Text>}
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
