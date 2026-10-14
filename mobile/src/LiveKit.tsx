import { Children, createContext, isValidElement, useContext, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Entrance, MotionPress, Shimmer, Stagger, SwapIn, TweenNumber } from "./motion";
import { departmentColor, primaryFill, space, textSize, ui, web, type Palette } from "./theme";
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
export function Button({ label, onPress, p, primary = false, quiet = false, disabled = false, icon }: { label: string; onPress: () => void; p: Palette; primary?: boolean; quiet?: boolean; disabled?: boolean; icon?: ComponentProps<typeof Feather>["name"] }) {
  const ink = disabled ? p.disabled : primary ? p.onPrimary : quiet ? p.text : p.primary;
  const { width } = useWindowDimensions(), sheet = useContext(InSheet);
  const hug = width >= 900 && !sheet;
  // Primary: the solid fill. Secondary: a wash with a visible edge, so on a dark card it still reads as a button.
  // Quiet: an outline only, for the less used actions beside a page's main one, so one button leads.
  // Disabled: a raised strip with a quiet outline and the disabled label.
  return (
    <MotionPress {...(Platform.OS === "web" && !disabled ? { dataSet: { hover: primary ? "primary" : "tint" } } : {})} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[ui.button, hug ? { flexGrow: 0, alignSelf: "flex-start", minWidth: 180, paddingHorizontal: 22 } : { flexGrow: 1 }, disabled ? { backgroundColor: p.elevated, borderWidth: 1, borderColor: p.border } : primary ? primaryFill(p) : quiet ? { borderWidth: 1, borderColor: p.border } : { backgroundColor: p.wash, borderWidth: 1, borderColor: p.washBorder }]}>
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
    <View style={{ gap: space.tight }}>
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
    <Anchor id={sectionAnchor(title)}><Entrance style={{ gap: space.row }}>
      {/* The heading on its own: no accent bar, so the page has fewer marks competing for the eye. */}
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flexShrink: 1 }]}>{title}</Text>
        {/* A count of nothing says nothing: only a count that is waiting shows. */}
        {!!count && <Tag label={String(count)} tone="wait" p={p} />}
      </View>
      {/* Cards and rows inside a section arrive one after another. */}
      {Children.toArray(children).map((child, n) => <Stagger key={isValidElement(child) && child.key != null ? child.key : n} index={n}>{child}</Stagger>)}
    </Entrance></Anchor>
  );
}

// One request identifier per attempt, kept until it succeeds, so a retry after a
// lost response replays the original action instead of creating a duplicate.
// One id per attempt, kept until it is done so a retry after a lost reply reuses it. `action` (the button pressed,
// the status chosen) is part of the key when one screen offers several moves, so a different choice gets its own id.
export function useRequestId(key: string | null) {
  const ids = useRef(new Map<string, string>());
  const keyFor = (action?: string) => key && action ? key + "|" + action : key;
  return {
    get: (action?: string) => { const k = keyFor(action); if (!k) return Crypto.randomUUID(); if (!ids.current.has(k)) ids.current.set(k, Crypto.randomUUID()); return ids.current.get(k)!; },
    done: (action?: string) => { const k = keyFor(action); if (k) ids.current.delete(k); },
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
  // The figure is one even size (textSize.figure, 20 on phones), so numbers no longer jump out of the page.
  const figure = { color: p.text, fontSize: compact ? 20 : textSize.figure, lineHeight: compact ? 26 : 28, fontWeight: "700" as const, letterSpacing: -0.4, fontVariant: ["tabular-nums" as const] };
  const ink = tone ? departmentColor(tone, p).ink : p.primary;
  return (
    <View {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityLabel={[label, typeof value === "number" ? format(value) : value, detail].filter(Boolean).join(", ")}
      style={{ flex: 1, minWidth: 0, padding: compact ? 14 : 20, gap: compact ? 6 : 8, borderRadius: compact ? 18 : 20, borderWidth: 1, borderColor: p.border, backgroundColor: attention ? p.wash : p.surface, overflow: "hidden" }}>
      {/* Flat: one hairline border, no shadow and no coloured thread, so a row of tiles reads quietly. On a phone the
          label is in sentence case, so a word such as "Unassigned" fits a third of the screen on one line. */}
      <View style={[ui.between, { gap: 6, alignItems: "flex-start" }]}>
        <Text numberOfLines={2} style={{ color: p.muted, fontSize: textSize.caption, lineHeight: 16, fontWeight: "600", letterSpacing: compact ? 0 : 0.6, textTransform: compact ? "none" : "uppercase", flex: 1 }}>{label}</Text>
        {!compact && <Feather name={icon} size={16} color={ink} />}
      </View>
      {typeof value === "number"
        ? <TweenNumber value={value} format={format} numberOfLines={1} adjustsFontSizeToFit style={figure} />
        : <SwapIn swapKey={value}><Text numberOfLines={1} adjustsFontSizeToFit style={{ ...figure, fontSize: compact ? 17 : 20 }}>{value}</Text></SwapIn>}
      {compact ? <Feather name={icon} size={15} color={tone ? departmentColor(tone, p).ink : p.primary} /> : !!detail && <Text numberOfLines={2} style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{detail}</Text>}
    </View>
  );
}
// Counts of nothing are left out (Alex: "information overload"): a tile whose value is the number 0 does not show,
// and when every tile is 0 one calm line says so. Reports and other screens that must show zeros pass showZeros.
export const isZeroTile = (child: ReactNode) => isValidElement<{ value?: unknown }>(child) && child.props.value === 0;
export function StatGrid({ children, showZeros = false, empty = "Nothing waiting" }: { children: ReactNode; showZeros?: boolean; empty?: string }) {
  const { width } = useWindowDimensions();
  const all = Children.toArray(children);
  const items = showZeros ? all : all.filter(child => !isZeroTile(child));
  const compact = width < 600 && items.length <= 3;
  const first = all[0], palette = isValidElement<{ p?: Palette }>(first) ? first.props.p : undefined;
  if (!items.length && all.length) return palette ? <Calm p={palette} text={empty} /> : null;
  return (
    <StatCompact.Provider value={compact}>
      <View style={{ flexDirection: "row", flexWrap: compact ? "nowrap" : "wrap", gap: compact ? 8 : 12 }}>
        {items.map((child, n) => <Stagger key={isValidElement(child) && child.key != null ? child.key : n} index={n} style={compact ? { flex: 1, minWidth: 0 } : { flexGrow: 1, flexBasis: width < 600 ? 140 : 200, minWidth: 0 }}>{child}</Stagger>)}
      </View>
    </StatCompact.Provider>
  );
}

// The one calm line shown in place of a list of nothing ("Nothing waiting").
export function Calm({ p, text = "Nothing waiting" }: { p: Palette; text?: string }) {
  return <View accessible accessibilityLabel={text} style={[ui.row, { gap: 8, minHeight: 44 }]}>
    <Feather name="check" size={16} color={p.success} />
    <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{text}</Text>
  </View>;
}

// "Show 12 more" under a long list that shows its first few rows (lists keep the first LIST_PREVIEW).
export const LIST_PREVIEW = 6;
export function ShowMore({ p, hidden, onPress, noun = "more" }: { p: Palette; hidden: number; onPress: () => void; noun?: string }) {
  if (hidden <= 0) return null;
  return <MotionPress accessibilityRole="button" accessibilityLabel={`Show ${hidden} ${noun}`} onPress={onPress} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start", paddingHorizontal: 4 }]}>
    <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Show {hidden} {noun}</Text>
    <Feather name="chevron-down" size={16} color={p.primary} />
  </MotionPress>;
}
// The first `limit` items until "Show more" is pressed. One row over the limit just shows: "Show 1 more" is a
// button where the row itself would have fitted.
export function usePreview<T>(items: readonly T[], limit = LIST_PREVIEW) {
  const [all, setAll] = useState(false);
  const shown = all || items.length <= limit + 1 ? items : items.slice(0, limit);
  return { shown, hidden: items.length - shown.length, showAll: () => setAll(true) };
}

// A short list of counts, each line opening where the work is (the department cards). Lines counting 0 are left
// out, and when every line is 0 one calm line says "Nothing waiting"; screens that must show zeros pass showZeros.
// Long lists show their first few lines with "Show more".
export type CountRow = { key?: string; label: string; value: number | string; attention?: boolean; onPress?: () => void };
export function CountList({ p, rows, ink, showZeros = false, empty = "Nothing waiting", limit = LIST_PREVIEW }: {
  p: Palette; rows: CountRow[]; ink?: { ink: string; wash: string }; showZeros?: boolean; empty?: string; limit?: number;
}) {
  const visible = showZeros ? rows : rows.filter(r => r.value !== 0);
  const preview = usePreview(visible, limit);
  if (!visible.length) return <Calm p={p} text={empty} />;
  const colour = ink ?? { ink: p.primary, wash: p.wash };
  return <View style={{ gap: 2 }}>
    {preview.shown.map(m => (
      <MotionPress key={m.key ?? m.label} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole={m.onPress ? "button" : "text"} accessibilityLabel={`${m.label}: ${typeof m.value === "number" ? formatCount(m.value) : m.value}`} disabled={!m.onPress} onPress={() => m.onPress?.()}
        style={[ui.row, { gap: 12, minHeight: 44, paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12 }]}>
        <View style={{ minWidth: 40, alignItems: "flex-start" }}>
          <View style={{ paddingHorizontal: m.attention ? 8 : 0, paddingVertical: m.attention ? 1 : 0, borderRadius: 999, backgroundColor: m.attention ? colour.wash : "transparent" }}>
            {typeof m.value === "number"
              ? <TweenNumber value={m.value} format={formatCount} style={{ color: m.attention ? colour.ink : p.text, fontSize: textSize.heading, lineHeight: 24, fontWeight: "600", fontVariant: ["tabular-nums"] }} />
              : <Text style={{ color: m.attention ? colour.ink : p.text, fontSize: textSize.heading, lineHeight: 24, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{m.value}</Text>}
          </View>
        </View>
        <Text numberOfLines={2} style={[ui.small, { color: m.attention ? p.text : p.muted, flex: 1 }]}>{m.label}</Text>
      </MotionPress>
    ))}
    <ShowMore p={p} hidden={preview.hidden} onPress={preview.showAll} />
  </View>;
}
