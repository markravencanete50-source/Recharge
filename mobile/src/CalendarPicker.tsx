import { useMemo, useState } from "react";
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
// day in solid green, the days between in a light wash, flat colours and nothing that moves on its own.
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
  const weeks = useMemo(() => pickerWeeks(month, { today, value, counts, dataFrom, dataTo }), [month, today, value, counts, dataFrom, dataTo]);
  const go = (next: string) => { setOwn(next); onMonthChange?.(next); };
  const choose = (day: string) => { setFocus(day); if (monthOf(day) !== month) go(monthOf(day)); onChange(pickDay(value, day, mode, clearable)); };
  const cell = phone ? 44 : 38;
  // Arrow keys move the focused day; Enter or Space chooses it. The month follows the focus.
  const keys = Platform.OS === "web" ? {
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      const from = focus ?? value.from ?? (today.startsWith(month) ? today : month + "-01");
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(from); return; }
      const next = moveFocus(from, e.key);
      if (!next || !isDay(next)) return;
      e.preventDefault(); setFocus(next);
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
            {week.map(c => <Day key={c.date} p={p} c={c} size={cell} stretch={phone} focused={focus === c.date} noun={countNoun} onPress={() => choose(c.date)} />)}
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

function Day({ p, c, size, stretch, focused, noun, onPress }: { p: Palette; c: PickerCell; size: number; stretch: boolean; focused: boolean; noun: string; onPress: () => void }) {
  const solid = c.selected;
  // Days outside the month (and days with no data) take the disabled ink rather than a see-through cell, so their
  // numbers and counts keep 3:1 on a dark card.
  const ink = solid ? p.onPrimary : !c.inMonth ? p.disabled : c.muted ? p.muted : p.text;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={cellLabel(c, noun)} accessibilityState={{ selected: c.selected || c.inRange }} onPress={onPress}
      style={{ width: stretch ? undefined : size, flex: stretch ? 1 : undefined, height: size, alignItems: "center", justifyContent: "center", padding: 2,
        backgroundColor: c.inRange && !solid ? p.wash : "transparent" }}>
      <View style={{ width: size - 6, height: size - 6, borderRadius: (size - 6) / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: solid ? p.primary : "transparent", borderWidth: c.isToday || focused ? 1 : 0, borderColor: focused ? p.text : p.primary }}>
        <Text style={{ color: ink, fontSize: 13, fontWeight: solid ? "600" : "400", fontVariant: ["tabular-nums"], lineHeight: 16 }}>{c.day}</Text>
        {c.count !== null && <Text style={{ color: solid ? p.onPrimary : c.inMonth ? p.primary : p.disabled, fontSize: 10, lineHeight: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{c.count > 99 ? "99+" : c.count}</Text>}
      </View>
    </MotionPress>
  );
}

// One field that shows the chosen period ("1 Oct 2026 to 31 Oct 2026") and opens the calendar under it. A range is only
// handed back once both ends are chosen, so a screen never reads half a range.
// `empty` is what the closed field says before anything is chosen ("Choose dates" by default; "Choose a date" for one day).
// `clearable` adds "Clear date" under a chosen value, for optional dates; it hands back empty strings.
export function DateField({ p, label, mode = "range", value, onChange, wholeMonthLink = true, today, empty, clearable = false }: { p: Palette; label: string; mode?: "single" | "range"; value: { from: string; to: string }; onChange: (next: { from: string; to: string }) => void; wholeMonthLink?: boolean; today?: string; empty?: string; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(null);
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
      {open && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 6 }]}>
        {mode === "range" && <Text style={[ui.small, { color: p.muted }]}>{draft?.from ? "Now choose the last day." : "Choose the first day, then the last."}</Text>}
        <CalendarPicker p={p} mode={mode} value={{ from: shown.from || null, to: shown.to || null }} onChange={change} wholeMonthLink={wholeMonthLink} clearable={false} today={today} />
      </View>}
      {clearable && !!value.from && !open && <MotionPress accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange({ from: "", to: "" })} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Clear date</Text>
      </MotionPress>}
    </View>
  );
}
