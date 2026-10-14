import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { radius, ui, type Palette } from "./theme";
import {
  WEEKDAYS, cellLabel, isDay, monthLabel, monthOf, moveFocus, pickDay, pickerWeeks, rangeLabel, shiftMonth, wholeMonth, type DateRange, type PickerCell,
} from "../../lib/calendar-picker";

// A compact month calendar for choosing one day or a date range (lib/calendar-picker.ts holds the rules). Optional counts on
// each day, month arrows and a "Today" link, 44pt day cells on the phone, arrow keys on the web. Calm: thin type, the chosen
// day in the selected colour (forest in light mode; deep green with a mint edge in dark, like a chosen pill), the days between in a light wash, flat colours and nothing that moves on its own.
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

export type CalendarPickerProps = {
  p: Palette; mode: "single" | "range"; value: DateRange; onChange: (next: DateRange) => void;
  counts?: Readonly<Record<string, number>>;
  // Days outside these are shown muted (the screen has no data there); they can still be picked.
  dataFrom?: string | null; dataTo?: string | null;
  // The month shown first; otherwise the chosen day's, else today's.
  month?: string; onMonthChange?: (month: string) => void;
  // The month shown first when `month` is not controlled.
  initialMonth?: string;
  // Range mode: a "Whole month" link that picks the month on screen.
  wholeMonthLink?: boolean;
  // Single mode: choosing the chosen day again clears it.
  clearable?: boolean;
  // What the counts are, for screen readers: "to approve".
  countNoun?: string;
  today?: string;
};

export function CalendarPicker({ p, mode, value, onChange, counts, dataFrom, dataTo, month: start, onMonthChange, initialMonth, wholeMonthLink = false, clearable = true, countNoun = "", today: fixedToday }: CalendarPickerProps) {
  const today = fixedToday ?? londonToday();
  const { width } = useWindowDimensions();
  const phone = width < 600;
  const [own, setOwn] = useState(() => start ?? initialMonth ?? monthOf(value.from ?? today));
  const month = start ?? own;
  const [focus, setFocus] = useState<string | null>(null);
  // Web: one day in the grid takes Tab (the focused day, else the chosen day, today or the 1st), and the arrow keys
  // move the browser's focus with the ring, so Enter or Space presses the day that is ringed, once.
  const ids = useId(), cellId = (day: string) => `day${ids}${day}`;
  const keyed = useRef(false);
  const tabStop = [focus, value.from, today].find(d => d && monthOf(d) === month) ?? month + "-01";
  useEffect(() => {
    if (Platform.OS !== "web" || !keyed.current || !focus) return;
    keyed.current = false;
    (globalThis as { document?: { getElementById: (id: string) => { focus: () => void } | null } }).document?.getElementById(cellId(focus))?.focus();
  });
  const weeks = useMemo(() => pickerWeeks(month, { today, value, counts, dataFrom, dataTo }), [month, today, value, counts, dataFrom, dataTo]);
  const go = (next: string) => { setOwn(next); onMonthChange?.(next); };
  const choose = (day: string) => { setFocus(day); if (monthOf(day) !== month) go(monthOf(day)); onChange(pickDay(value, day, mode, clearable)); };
  const cell = phone ? 44 : 38;
  // Arrow keys move the focused day (Enter and Space are the day button's own press). The month follows the focus.
  const keys = Platform.OS === "web" ? {
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      const next = moveFocus(focus ?? tabStop, e.key);
      if (!next || !isDay(next)) return;
      e.preventDefault(); keyed.current = true; setFocus(next);
      if (monthOf(next) !== month) go(monthOf(next));
    },
  } : {};

  return (
    <View style={{ gap: 8, alignSelf: phone ? "stretch" : "flex-start", width: phone ? undefined : cell * 7 + 12 }}>
      <View style={[ui.row, { gap: 4 }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => go(shiftMonth(month, -1))} style={arrow(p)}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: "center", color: p.text, fontSize: 15, fontWeight: "500" }}>{monthLabel(month)}</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="Next month" onPress={() => go(shiftMonth(month, 1))} style={arrow(p)}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
      </View>
      <View style={[ui.row, { gap: 14, justifyContent: "center" }]}>
        <Link p={p} label="Today" onPress={() => { go(monthOf(today)); setFocus(today); }} />
        {mode === "range" && wholeMonthLink && <Link p={p} label="Whole month" onPress={() => onChange(wholeMonth(month))} />}
      </View>
      <View accessibilityLabel={`${monthLabel(month)}. Use the arrow keys to move between days.`} {...(keys as object)} style={{ gap: 2 }}>
        <View style={{ flexDirection: "row" }}>
          {WEEKDAYS.map(d => <Text key={d} style={{ width: phone ? undefined : cell, flex: phone ? 1 : undefined, textAlign: "center", color: p.muted, fontSize: 11, fontWeight: "500" }}>{d.slice(0, 2)}</Text>)}
        </View>
        {weeks.map(week => (
          <View key={week[0].date} style={{ flexDirection: "row" }}>
            {week.map(c => <Day key={c.date} p={p} c={c} size={cell} stretch={phone} focused={focus === c.date} noun={countNoun} onPress={() => choose(c.date)}
              id={cellId(c.date)} tabStop={c.date === tabStop} onFocus={() => setFocus(c.date)} />)}
          </View>
        ))}
      </View>
    </View>
  );
}

const arrow = (p: Palette) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: p.elevated });

function Link({ p, label, onPress }: { p: Palette; label: string; onPress: () => void }) {
  return <MotionPress accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 6 }}>
    <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{label}</Text>
  </MotionPress>;
}

function Day({ p, c, size, stretch, focused, noun, onPress, id, tabStop, onFocus }: { p: Palette; c: PickerCell; size: number; stretch: boolean; focused: boolean; noun: string; onPress: () => void; id: string; tabStop: boolean; onFocus: () => void }) {
  const solid = c.selected;
  // Days outside the month (and days with no data) take the disabled ink rather than a see-through cell, so their
  // numbers and counts keep 3:1 on a dark card.
  const ink = solid ? p.onSelected : !c.inMonth ? p.disabled : c.muted ? p.muted : p.text;
  // The wash runs under the half of each end day that faces the range, so first day, days between and last day read as one band.
  const half = c.rangeStart && !c.rangeEnd ? { left: "50%", right: 0 } : c.rangeEnd && !c.rangeStart ? { left: 0, right: "50%" } : null;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={cellLabel(c, noun)} accessibilityState={{ selected: c.selected || c.inRange }} onPress={onPress}
      nativeID={id} focusable={tabStop} onFocus={onFocus}
      style={{ width: stretch ? undefined : size, flex: stretch ? 1 : undefined, height: size, alignItems: "center", justifyContent: "center", padding: 2,
        backgroundColor: c.inRange && !solid ? p.wash : "transparent", ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : {}) }}>
      {half && <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, ...half, backgroundColor: p.wash } as object} />}
      <View style={{ width: size - 6, height: size - 6, borderRadius: (size - 6) / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: solid ? p.selected : "transparent", borderWidth: solid || c.isToday || focused ? 1 : 0, borderColor: focused ? p.text : solid ? p.selectedBorder : p.primary }}>
        <Text style={{ color: ink, fontSize: 13, fontWeight: solid ? "600" : "400", fontVariant: ["tabular-nums"], lineHeight: 16 }}>{c.day}</Text>
        {c.count !== null && <Text style={{ color: solid ? p.onSelected : c.inMonth ? p.primary : p.disabled, fontSize: 10, lineHeight: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{c.count > 99 ? "99+" : c.count}</Text>}
      </View>
    </MotionPress>
  );
}

// One field that shows the chosen period ("1 Oct 2026 to 31 Oct 2026") and opens the calendar under it. A range is only
// handed back once both ends are chosen, so a screen never reads half a range.
// `empty` is what the closed field says before anything is chosen ("Choose dates" by default; "Choose a date" for one day).
// `clearable` adds "Clear date" under a chosen value, for optional dates; it hands back empty strings.
// `hint` is the range helper shown in the open calendar before the first day is chosen; the label stays a plain name.
export function DateField({ p, label, mode = "range", value, onChange, wholeMonthLink = true, today, empty, clearable = false, hint = "Choose the first day, then the last." }: { p: Palette; label: string; mode?: "single" | "range"; value: { from: string; to: string }; onChange: (next: { from: string; to: string }) => void; wholeMonthLink?: boolean; today?: string; empty?: string; clearable?: boolean; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(null);
  // Web: a field near the bottom of a sheet opens its calendar below the fold; bring it into view.
  const cardId = `calendar${useId()}`;
  useEffect(() => {
    if (open && Platform.OS === "web") (globalThis as { document?: { getElementById: (id: string) => { scrollIntoView: (o: object) => void } | null } }).document?.getElementById(cardId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, cardId]);
  const shown = draft ?? value;
  const change = (next: DateRange) => {
    if (next.from && (next.to || mode === "single")) { setDraft(null); onChange({ from: next.from, to: next.to ?? next.from }); setOpen(false); }
    else setDraft(next);
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
      <MotionPress accessibilityRole="button" accessibilityLabel={`${label}: ${rangeLabel(value, empty)}. ${open ? "Close" : "Open"} the calendar`} accessibilityState={{ expanded: open }} onPress={() => { setOpen(o => !o); setDraft(null); }}
        style={[ui.row, { gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: radius.control, borderWidth: 1, borderColor: open ? p.primary : p.controlBorder, backgroundColor: p.surface }]}>
        <Feather name="calendar" size={16} color={p.muted} />
        <Text style={{ flex: 1, color: shown.from ? p.text : p.muted, fontSize: 15 }}>{rangeLabel(shown, empty)}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={p.muted} />
      </MotionPress>
      {open && <View nativeID={cardId} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 6 }]}>
        {mode === "range" && <Text style={[ui.small, { color: p.muted }]}>{draft?.from ? "Now choose the last day." : hint}</Text>}
        <CalendarPicker p={p} mode={mode} value={{ from: shown.from || null, to: shown.to || null }} onChange={change} wholeMonthLink={wholeMonthLink} clearable={false} today={today} />
      </View>}
      {clearable && !!value.from && !open && <MotionPress accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange({ from: "", to: "" })} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Clear date</Text>
      </MotionPress>}
    </View>
  );
}
