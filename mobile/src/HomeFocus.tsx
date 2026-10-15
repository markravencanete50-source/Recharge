import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { Loading, Notice } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ShiftCard } from "./LiveShifts";
import { MySchedule } from "./MySchedule";
import { SEARCH_SHORTCUT } from "./WorkspaceSearch";
import { readTeams } from "./backend/client";
import { myShiftSchema, PAUSE_LABEL } from "../../lib/management-live";
import { formatCount } from "../../lib/format";
import { needText, type DepartmentTile, type NeedLine } from "../../lib/home-needs";
import { figureText, seeAllLabel, shownNeeds, type BusinessFigure } from "../../lib/home-overview";
import type { HomeToolTarget } from "../../lib/home-tools";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// The calm Home (Alex's feedback, approved by Lee): a short greeting, one "What do you need?" box,
// "Needs you now" (at most five lines) and, for admins, one number per department. Nothing animates in
// and nothing shows at zero. The lines themselves are worked out in lib/home-needs.ts.

// One line: "Good afternoon, Sam" and the day, with an optional button on the right (the shift).
export function HomeGreeting({ palette: p, title, detail, action }: { palette: Palette; title: string; detail: string; action?: ReactNode }) {
  return (
    <View style={[ui.between, { gap: 12, flexWrap: "wrap" }]}>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 22, lineHeight: 28, fontWeight: "600" }}>{title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
      </View>
      {action}
    </View>
  );
}

// The search box: opens the workspace search (properties, work, tools and pages) and jumps there.
export function AskBox({ palette: p, desktop, onPress }: { palette: Palette; desktop: boolean; onPress: () => void }) {
  return (
    <MotionPress testID="home-ask" accessibilityRole="search" accessibilityLabel="What do you need? Search properties, work, tools and pages" onPress={onPress}
      style={[ui.row, { gap: 12, minHeight: 56, paddingHorizontal: 18, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
      <Feather name="search" size={18} color={p.primary} />
      <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 15 }}>What do you need?</Text>
      {desktop && Platform.OS === "web" && <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1, borderColor: p.border }}><Text style={{ color: p.muted, fontSize: 11, fontWeight: "600" }}>{SEARCH_SHORTCUT}</Text></View>}
    </MotionPress>
  );
}

// "Needs you now": each line a number and what it is, opening the place to act. One calm line when nothing waits.
// With `limit` (the admins' "Needs your attention"), the first lines show and "See all (n)" opens the rest in place.
export function NeedsList({ palette: p, lines, loading, error, onOpen, title = "Needs you now", limit, children }: { palette: Palette; lines: NeedLine[]; loading: boolean; error?: string; onOpen: (line: NeedLine) => void; title?: string; limit?: number; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit ? shownNeeds(lines, expanded, limit) : lines;
  const more = limit && !expanded ? seeAllLabel(lines.length, limit) : null;
  return (
    <View testID="home-needs" style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && !lines.length ? <Loading p={p} rows={2} /> : lines.length ? (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {shown.map((l, i) => (
            <MotionPress key={l.key} accessibilityRole="button" accessibilityLabel={`${needText(l)}. Open`} onPress={() => onOpen(l)}
              style={[ui.row, { gap: 14, minHeight: 52, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
              <View style={{ minWidth: 40, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: l.urgent ? p.cautionWash : p.wash }}>
                <Text style={{ color: l.urgent ? p.waiting : p.primary, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{formatCount(l.count)}</Text>
              </View>
              <Text numberOfLines={2} style={{ flex: 1, color: p.text, fontSize: 15, lineHeight: 21 }}>{l.label}</Text>
              <Feather name="chevron-right" size={18} color={p.muted} />
            </MotionPress>
          ))}
          {!!more && <MotionPress testID="home-needs-all" accessibilityRole="button" accessibilityLabel={`${more}. Show every line`} onPress={() => setExpanded(true)}
            style={[ui.row, { gap: 8, minHeight: 48, borderTopWidth: 1, borderColor: p.border }]}>
            <Text style={{ flex: 1, color: p.primary, fontSize: 14, fontWeight: "600" }}>{more}</Text>
            <Feather name="chevron-down" size={18} color={p.primary} />
          </MotionPress>}
        </View>
      ) : !error ? (
        <View style={[ui.row, { gap: 10, minHeight: 52, paddingHorizontal: 16, borderRadius: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="check-circle" size={18} color={p.success} />
          <Text style={{ flex: 1, color: p.text, fontSize: 15 }}>All clear. Nothing needs you right now.</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

// "This month": the business at a glance for admins (lib/home-overview.ts). Each figure a value, a short label and,
// where it means something, a quiet change against last month; tap one to open where its detail lives. Four to a
// row on a computer, two on a phone. A figure that can't load shows "–"; a zero is shown quietly. Every other role's
// Home uses the same tiles for its own figures (lib/role-home.ts), under its own title.
type FigureTile = Omit<BusinessFigure, "key"> & { key: string };
export function BusinessFigures({ palette: p, figures, desktop, loading, onOpen, title = "This month" }: { palette: Palette; figures: FigureTile[]; desktop: boolean; loading: boolean; onOpen: (figure: FigureTile) => void; title?: string }) {
  return (
    <View testID="home-business" style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {figures.map(f => {
          const waiting = loading && f.missing;
          return (
            <MotionPress key={f.key} testID={`home-figure-${f.key}`} accessibilityRole="button" accessibilityLabel={waiting ? `${f.label}: loading` : `${figureText(f)}. ${f.detail}. Open`} onPress={() => onOpen(f)}
              style={{ flexBasis: desktop ? "22%" : "46%", flexGrow: 1, minWidth: 0, gap: 2, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
              <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{f.label}</Text>
              <Text numberOfLines={1} style={{ color: f.missing || f.zero ? p.muted : p.text, fontSize: 20, lineHeight: 26, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{waiting ? "…" : f.value}</Text>
              <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, lineHeight: 17 }}>{f.change ? f.change.text : f.detail}</Text>
            </MotionPress>
          );
        })}
      </View>
    </View>
  );
}

// Stays, Cleans, Ready and Accounts: one number each, a 2 by 2 grid on phones and one row on a computer.
export function DepartmentTiles({ palette: p, tiles, desktop, onOpen }: { palette: Palette; tiles: DepartmentTile[]; desktop: boolean; onOpen: (target: HomeToolTarget) => void }) {
  if (!tiles.length) return null;
  return (
    <View testID="home-departments" style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Departments</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {tiles.map(t => {
          const colour = departmentColor(t.key, p);
          return (
            <MotionPress key={t.key} accessibilityRole="button" accessibilityLabel={`${t.title}: ${t.value} ${t.label}. Open ${t.title}`} onPress={() => onOpen(t.target)}
              style={{ flexBasis: desktop ? "22%" : "46%", flexGrow: 1, minWidth: 0, gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
              <View style={[ui.row, { gap: 8 }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour.ink }} />
                <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "600" }}>{t.title}</Text>
                <Feather name="chevron-right" size={16} color={p.muted} />
              </View>
              <Text style={{ color: p.text, fontSize: 22, lineHeight: 28, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{t.value}</Text>
              <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{t.label}</Text>
            </MotionPress>
          );
        })}
      </View>
    </View>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

// The shift, as a small button beside the greeting. It opens the full shift card (clock in and out,
// pauses, overtime) and the person's week in a sheet. Nothing shows for someone without a shift.
export function ShiftButton({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [shift, setShift] = useState<ReturnType<typeof myShiftSchema.parse> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { setShift(myShiftSchema.parse((await readTeams({ section: "shift" })).data)); setUnavailable(false); }
    catch { setUnavailable(true); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (unavailable) return null;
  const on = shift?.open ?? null;
  const label = !shift ? "Your shift" : !on ? "Clock in" : on.pause ? `On ${PAUSE_LABEL[on.pause.kind].toLowerCase()}` : `On shift since ${time(on.clockedInAt)}`;
  return (
    <>
      <MotionPress testID="home-shift" accessibilityRole="button" accessibilityLabel={on ? `${label}. Open your shift` : "Your shift: clocked out. Open it to clock in"} onPress={() => setOpen(true)}
        style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
        {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on.pause ? p.waiting : p.success }} /> : <Feather name="log-in" size={15} color={p.primary} />}
        <Text numberOfLines={1} style={{ color: on ? p.text : p.primary, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      </MotionPress>
      <Sheet palette={p} visible={open} onClose={() => { setOpen(false); void load(); }} title="Your shift" subtitle="Clock in and out, pauses and your week" icon="calendar">
        <ShiftCard palette={p} account={account} />
        <MySchedule palette={p} account={account} />
      </Sheet>
    </>
  );
}
