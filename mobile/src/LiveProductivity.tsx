import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PauseRules } from "./LiveShifts";
import * as Crypto from "expo-crypto";
import { Animated, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { Text } from "./Typography";
import { Entrance, MotionPress, Pop, SwapIn, motionTokens, useReducedMotion } from "./motion";
import { Button, Field, Loading, Notice, StatGrid, StatTile, Tag, addDays, london, message, useRequestId } from "./LiveKit";
import { Initials } from "./LiveAccounts";
import { Segmented } from "./Segmented";
import { Sheet } from "./TeamFlows";
import { SheetTable, cellText } from "./SheetTable";
import { ShiftSheet, WeekNav, type ShiftTarget } from "./LiveTeamTime";
import { useCelebrate } from "./Celebrate";
import { exportReport } from "./exportReport";
import { depth, primaryFill, ui, web, type Palette } from "./theme";
import { ChartTip, useChartFocus } from "./ChartTip";
import { readTeams, writeTeams } from "./backend/client";
import { DEPARTMENT_LABEL } from "../../lib/hub";
import { ROLE_LABEL } from "../../lib/admin-live";
import { PAUSE_LABEL } from "../../lib/management-live";
import { ROTA_HOURS, ROTA_LABEL, londonClock, minutesLabel, mondayOf, shiftWeek, timesheetCsv } from "../../lib/team-time";
import {
  CHANGE_KIND, CHANGE_STATUS, averageWeek, dayWithYear, describeChange, hoursShort, minutesDelta, monthLabel, monthMinutes, monthsOf, moveMonth,
  productivityCsv, teamMonth, teamWeek, weekLabel, weekMinutes, weeksOfMonth, calendarWeeks, dayPeople, dayTotals, monthEnd, pauseSummary, ROTA_SPAN, ukHours, type DayTotal,
} from "../../lib/productivity";
import {
  productivitySchema, shiftChangesSchema, timesheetSchema,
  type Productivity, type ProductivityPerson, type ShiftChange, type ShiftChanges, type Timesheet, type TimesheetPerson,
} from "../../lib/workspace-teams-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// The Productivity Tool: every clock in and clock out, with hours that add up by week and by month.
// Clock in and out is locked: the team only clocks in and out, a super admin can change anyone's
// hours, and an admin's change waits for a super admin's approval before it counts anywhere.
type View_ = "days" | "weeks" | "months" | "log" | "changes";
const since = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};
// Big totals in whole hours ("340h"), so they fit a tile on a phone.
const hoursTile = (minutes: number) => minutes >= 6000 ? `${Math.round(minutes / 60).toLocaleString("en-GB")}h` : hoursShort(minutes);
// A tint of the chart colour for heat-map cells (0 to 1).
const tint = (hex: string, share: number) => {
  const n = parseInt(hex.replace("#", ""), 16), a = Math.max(0, Math.min(1, share)) * 0.32;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
};

export function LiveProductivity({ palette: p, account, initial = "days" }: { palette: Palette; account: WorkspaceAccount; initial?: View_ }) {
  const today = london(new Date());
  const [view, setView] = useState<View_>(initial);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<Productivity | null>(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<ProductivityPerson | null>(null);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(async () => {
    try { setData(productivitySchema.parse((await readTeams({ section: "productivity", from: `${year}-01-01`, to: `${year}-12-31` })).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [year]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, refresh]);
  const reload = () => setRefresh(n => n + 1);
  // Moving the month across New Year moves the year read with it.
  const goMonth = (next: string) => { setMonth(next); const y = Number(next.slice(0, 4)); if (y !== year) { setData(null); setYear(y); } };
  const goYear = (next: number) => { setData(null); setYear(next); setMonth(`${next}-${month.slice(5)}`); };
  const current = year === Number(today.slice(0, 4));
  const onShift = data?.people.filter(x => x.onShift) ?? [];
  const pending = data?.pending ?? 0;
  const yearMinutes = data?.people.reduce((sum, x) => sum + x.minutes, 0) ?? 0;
  const busiest = data ? monthsOf(year).reduce((best, m) => teamMonth(data, m) > teamMonth(data, best) ? m : best, `${year}-01`) : `${year}-01`;
  return (
    <View style={{ gap: 18 }}>
      <LockedHero p={p} onShift={onShift} direct={account.role === "super_admin"} />
      <StatGrid>
        {current
          ? [
            <StatTile key="week" p={p} icon="clock" tone="stays" label="Hours this week" value={data ? teamWeek(data, mondayOf(today)) : 0} format={hoursTile} detail="The whole team, from Monday" />,
            <StatTile key="month" p={p} icon="calendar" tone="clients" label="Hours this month" value={data ? teamMonth(data, today.slice(0, 7)) : 0} format={hoursTile} detail={monthLabel(today.slice(0, 7), "long")} />,
            <StatTile key="overtime" p={p} icon="clock" tone="ready" label="Overtime this month" value={data ? data.people.reduce((sum, x) => sum + (x.months.find(m => m.month === today.slice(0, 7))?.overtime ?? 0), 0) : 0} format={hoursTile} detail="Time after people switched to overtime" />,
          ]
          : [
            <StatTile key="year" p={p} icon="calendar" tone="stays" label={`Hours in ${year}`} value={yearMinutes} format={hoursTile} detail="The whole team" />,
            <StatTile key="busiest" p={p} icon="trending-up" tone="clients" label="Busiest month" value={data ? monthLabel(busiest, "long") : "–"} detail={data ? hoursShort(teamMonth(data, busiest)) : undefined} />,
          ]}
        <StatTile p={p} icon="activity" tone="cleans" label="On shift now" value={onShift.length} detail={onShift.length ? onShift.slice(0, 3).map(x => x.fullName.split(" ")[0]).join(", ") + (onShift.length > 3 ? "…" : "") : "Nobody is clocked in"} />
        <StatTile p={p} icon="shield" tone="accounts" label="Waiting approval" value={pending} attention={pending > 0}
          detail={pending ? data?.canApprove ? "Changes for you to decide" : "With a super admin" : "No changes waiting"} />
      </StatGrid>
      <Segmented p={p} label="Productivity views" value={view} onChange={setView} items={[
        { key: "days", label: "By day" }, { key: "weeks", label: "By week" }, { key: "months", label: "By month" }, { key: "log", label: "Clock-ins" },
        { key: "changes", label: "Approvals", count: pending || undefined, alert: !!data?.canApprove && pending > 0 },
      ]} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <SwapIn swapKey={view}>
        {view === "days" && <DayView p={p} account={account} today={today} onChanged={reload} />}
        {view === "weeks" && <WeekTotals p={p} data={data} month={month} today={today} onMonth={goMonth} onPerson={setPerson} />}
        {view === "months" && <MonthTotals p={p} data={data} year={year} today={today} onYear={goYear} onPerson={setPerson} />}
        {view === "log" && <ClockLog p={p} account={account} today={today} onChanged={reload} />}
        {view === "changes" && <Approvals p={p} onChanged={reload} />}
      </SwapIn>
      {(account.role === "admin" || account.role === "super_admin") && <PauseRules p={p} />}
      <PersonSheet p={p} person={person} data={data} today={today} onClose={() => setPerson(null)} />
    </View>
  );
}

// The forest card at the top: hours are locked, and who is clocked in right now.
function LockedHero({ p, onShift, direct }: { p: Palette; onShift: ProductivityPerson[]; direct: boolean }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== "web" }), Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: Platform.OS !== "web" })]));
    loop.start(); return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Entrance sessionKey="productivity:hero">
      <View style={{ borderRadius: 24, overflow: "hidden", backgroundColor: p.hero, padding: 20, gap: 14, ...depth.raised, ...web({ backgroundImage: "linear-gradient(140deg,#2A5248 0%,#1F3D38 52%,#17302B 100%)" }) }}>
        <View pointerEvents="none" style={{ position: "absolute", right: -90, top: -110 }}>
          <Svg width={280} height={280}><Defs><RadialGradient id="productivity-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#A7D9C1" stopOpacity={0.4} /><Stop offset="1" stopColor="#A7D9C1" stopOpacity={0} /></RadialGradient></Defs><Circle cx={140} cy={140} r={140} fill="url(#productivity-glow)" /></Svg>
        </View>
        <View style={[ui.row, { gap: 12, alignItems: "flex-start" }]}>
          <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" }}>
            <Feather name="lock" size={19} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text accessibilityRole="header" style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "800", letterSpacing: -0.6 }}>Productivity</Text>
            <Text style={{ color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 19 }}>
              Every clock in and clock out, adding up by week and by month. Hours are locked: nobody edits their own, {direct ? "you can change anyone's directly, and admins' changes wait for your approval." : "and your changes go to a super admin. They count only once approved."}
            </Text>
          </View>
        </View>
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          <View style={[ui.row, { gap: 8, paddingHorizontal: 12, minHeight: 32, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" }]}>
            <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
              {onShift.length > 0 && <Animated.View style={{ position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: "#7BE0A8", opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }] }} />}
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: onShift.length ? "#7BE0A8" : "rgba(255,255,255,0.4)" }} />
            </View>
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{onShift.length ? `${onShift.length} on shift now` : "Nobody on shift"}</Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            {onShift.slice(0, 6).map((x, i) => <View key={x.userId} style={{ marginLeft: i ? -6 : 0, borderRadius: 18, borderWidth: 2, borderColor: p.hero }}><Initials p={p} name={x.fullName} size={30} /></View>)}
          </View>
        </View>
      </View>
    </Entrance>
  );
}

// Columns that rise into place, one per week or month, the current one in forest.
function HoursColumns({ p, bars, sessionKey }: { p: Palette; bars: { key: string; label: string; minutes: number; now?: boolean }[]; sessionKey: string }) {
  const reduced = useReducedMotion();
  const max = Math.max(60, ...bars.map(b => b.minutes));
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { grow.setValue(1); return; }
    grow.setValue(0);
    const a = Animated.timing(grow, { toValue: 1, duration: motionTokens.reveal + 200, easing: motionTokens.entrance, useNativeDriver: false });
    a.start(); return () => a.stop();
  }, [sessionKey, reduced, grow]);
  const height = 150;
  const col = useChartFocus(), [width, setWidth] = useState(0), sum = bars.reduce((t, b) => t + b.minutes, 0);
  return (
    <View accessibilityRole="image" accessibilityLabel={bars.map(b => `${b.label} ${hoursShort(b.minutes)}`).join(", ")}
      style={{ padding: 16, paddingBottom: 12, borderRadius: 22, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, ...depth.card }}>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: height + 22, position: "relative" }}>
        {bars.map((b, i) => {
          const share = b.minutes / max;
          return (
            <MotionPress key={b.key} accessibilityRole="button" accessibilityLabel={`${b.label}: ${minutesLabel(b.minutes)}`} {...col.press(i)} style={{ flex: 1, minWidth: 0, alignItems: "center", justifyContent: "flex-end", height: height + 22, gap: 4, opacity: col.focus === null || col.focus === i ? 1 : 0.6 }}>
              <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "700", color: b.now ? p.primary : p.muted, fontVariant: ["tabular-nums"] }}>{b.minutes ? hoursShort(b.minutes).replace(/ \d+m$/, "") : ""}</Text>
              <Animated.View style={{
                width: "78%", maxWidth: 40, borderRadius: 8, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: b.now ? p.primary : p.chart, opacity: b.now ? 1 : 0.55,
                height: grow.interpolate({ inputRange: [0, Math.min(1, 0.4 + i * 0.05), 1], outputRange: [2, 2, Math.max(2, share * height)] }),
                ...(b.now ? web({ boxShadow: "0 10px 20px -12px rgba(21,45,40,.6)" }) : {}),
              }} />
            </MotionPress>
          );
        })}
        {col.focus !== null && bars[col.focus] && <ChartTip p={p} x={(col.focus + 0.5) / bars.length * width} width={width} top={0} title={bars[col.focus].label} rows={[{ label: "Hours worked", value: bars[col.focus].minutes ? minutesLabel(bars[col.focus].minutes) : "0h", color: p.primary }, { label: "Share of total", value: sum ? Math.round(bars[col.focus].minutes / sum * 100) + "%" : "0%" }]} />}
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, borderTopWidth: 1, borderColor: p.border, paddingTop: 6 }}>
        {bars.map(b => <Text key={b.key} numberOfLines={1} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: b.now ? "800" : "600", color: b.now ? p.primary : p.muted }}>{b.label}</Text>)}
      </View>
    </View>
  );
}

// A cell of hours: the figure, with a slim bar beneath that grows with it.
const heatCell = (p: Palette, minutes: number, max: number, strong = false, format: (m: number) => string = hoursShort) => (
  <View style={{ gap: 5, paddingRight: 6 }}>
    <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: strong ? "800" : "600", color: minutes ? p.text : p.muted, fontVariant: ["tabular-nums"] }}>{minutes ? format(minutes) : "–"}</Text>
    <View style={{ height: 3, borderRadius: 2, backgroundColor: minutes ? tint(p.chart, 0.5) : "transparent", overflow: "hidden" }}>
      {minutes > 0 && <View style={{ height: 3, borderRadius: 2, width: `${Math.max(6, Math.min(100, (minutes / max) * 100))}%`, backgroundColor: strong ? p.primary : p.chart }} />}
    </View>
  </View>
);
// Whole hours ("205h"), for the narrow month columns; the spreadsheet keeps the minutes.
const hoursWhole = (minutes: number) => `${Math.round(minutes / 60).toLocaleString("en-GB")}h`;
// People who clock in: anyone on the rota (with a department) or with hours in the period. The rest
// (cleaners paid per clean, owners' contacts) are named underneath rather than filling rows with dashes.
const clocking = (data: Productivity) => data.people.filter(x => x.department || x.minutes > 0);
function NotClocking({ p, data }: { p: Palette; data: Productivity }) {
  const rest = data.people.filter(x => !x.department && !x.minutes);
  if (!rest.length) return null;
  return <Text style={[ui.small, { color: p.muted }]}>Not on the rota and no hours: {rest.map(x => x.fullName || "Team member").join(", ")}.</Text>;
}
const personCell = (p: Palette, x: ProductivityPerson) => (
  <View style={[ui.row, { gap: 10 }]}>
    <Initials p={p} name={x.fullName || "Team member"} size={30} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "700", color: p.text }}>{(x.fullName || "Team member") + (x.active ? "" : " (left)")}</Text>
      <Text numberOfLines={1} style={{ fontSize: 11, color: x.onShift ? p.success : p.muted, fontWeight: x.onShift ? "700" : "400" }}>{x.onShift ? "● On shift now" : x.department ? DEPARTMENT_LABEL[x.department] : ROLE_LABEL[x.role as keyof typeof ROLE_LABEL] ?? x.role}</Text>
    </View>
  </View>
);

function WeekTotals({ p, data, month, today, onMonth, onPerson }: { p: Palette; data: Productivity | null; month: string; today: string; onMonth: (m: string) => void; onPerson: (x: ProductivityPerson) => void }) {
  const weeks = weeksOfMonth(month), thisWeek = mondayOf(today);
  const [note, setNote] = useState("");
  const max = Math.max(60, ...(data?.people ?? []).flatMap(x => weeks.map(w => weekMinutes(x, w))));
  const monthTotal = (x: ProductivityPerson) => monthMinutes(x, month);
  return (
    <View style={{ gap: 14 }}>
      <WeekNav p={p} label={monthLabel(month, "long")} onMove={step => onMonth(moveMonth(month, step))} onToday={() => onMonth(today.slice(0, 7))} />
      {!data ? <Loading p={p} /> : <>
        <HoursColumns p={p} sessionKey={"weeks:" + month} bars={weeks.map(w => ({ key: w, label: weekLabel(w), minutes: teamWeek(data, w), now: w === thisWeek }))} />
        <SheetTable p={p} rows={clocking(data)} keyOf={x => x.userId} onRow={onPerson} empty="Nobody on the rota yet."
          columns={[
            { label: "Person", width: 190, cell: x => personCell(p, x) },
            ...weeks.map(w => ({ label: weekLabel(w), width: 92, cell: (x: ProductivityPerson) => heatCell(p, weekMinutes(x, w), max) })),
            { label: monthLabel(month), width: 100, cell: x => heatCell(p, monthTotal(x), max * 4, true) },
          ]} />
        <NotClocking p={p} data={data} />
        <Text style={[ui.small, { color: p.muted }]}>Each week runs Monday to Sunday and shows all of its hours, so a week that crosses into the next month shows in both. The month column counts only {monthLabel(month, "long")}.</Text>
        {!!note && <Notice text={note} p={p} />}
        <Button label="Download as a spreadsheet" icon="download" p={p} onPress={() => void exportReport(productivityCsv(data, "week", weeks), `Recharge-hours-by-week-${month}.csv`).then(() => setNote("Spreadsheet ready."), e => setNote(message(e)))} />
      </>}
    </View>
  );
}

function MonthTotals({ p, data, year, today, onYear, onPerson }: { p: Palette; data: Productivity | null; year: number; today: string; onYear: (y: number) => void; onPerson: (x: ProductivityPerson) => void }) {
  const months = monthsOf(year), thisMonth = today.slice(0, 7);
  const [note, setNote] = useState("");
  const max = Math.max(60, ...(data?.people ?? []).flatMap(x => x.months.map(m => m.minutes)));
  return (
    <View style={{ gap: 14 }}>
      <WeekNav p={p} label={String(year)} onMove={step => onYear(year + step)} onToday={() => onYear(Number(today.slice(0, 4)))} />
      {!data ? <Loading p={p} /> : <>
        <HoursColumns p={p} sessionKey={"months:" + year} bars={months.map(m => ({ key: m, label: monthLabel(m).slice(0, 3), minutes: teamMonth(data, m), now: m === thisMonth }))} />
        <SheetTable p={p} rows={clocking(data)} keyOf={x => x.userId} onRow={onPerson} empty="Nobody on the rota yet."
          columns={[
            { label: "Person", width: 180, cell: x => personCell(p, x) },
            ...months.map(m => ({ label: monthLabel(m), width: 62, cell: (x: ProductivityPerson) => heatCell(p, monthMinutes(x, m), max, false, hoursWhole) })),
            { label: String(year), width: 84, cell: x => heatCell(p, x.minutes, max * 12, true, hoursWhole) },
            { label: "Avg week", width: 84, cell: x => cellText(p, hoursShort(averageWeek(x, `${year}-01-01`, `${year}-12-31`, today))) },
          ]} />
        <NotClocking p={p} data={data} />
        {!!note && <Notice text={note} p={p} />}
        <Button label="Download as a spreadsheet" icon="download" p={p} onPress={() => void exportReport(productivityCsv(data, "month", months), `Recharge-hours-by-month-${year}.csv`).then(() => setNote("Spreadsheet ready."), e => setNote(message(e)))} />
      </>}
    </View>
  );
}

// One person's year: their months, weeks so far and averages.
function PersonSheet({ p, person, data, today, onClose }: { p: Palette; person: ProductivityPerson | null; data: Productivity | null; today: string; onClose: () => void }) {
  const year = data ? Number(data.from.slice(0, 4)) : Number(today.slice(0, 4));
  const recentWeeks = person ? [...person.weeks].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 8) : [];
  const best = person?.months.reduce<{ month: string; minutes: number } | null>((top, m) => !top || m.minutes > top.minutes ? m : top, null);
  return (
    <Sheet palette={p} visible={!!person} onClose={onClose} title={person?.fullName || "Team member"} subtitle={person ? `${person.department ? DEPARTMENT_LABEL[person.department] + " · " : ""}${year}` : undefined} icon="hourglass">
      {person && <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {[["Hours", minutesLabel(person.minutes)], ["Shifts", String(person.shifts)], ["Days worked", String(person.days)], ["Average week", hoursShort(averageWeek(person, `${year}-01-01`, `${year}-12-31`, today))]].map(([label, value]) => (
            <View key={label} style={{ flexGrow: 1, flexBasis: 120, padding: 12, borderRadius: 16, backgroundColor: p.wash, gap: 2 }}>
              <Text style={[ui.label, { color: p.muted }]}>{label}</Text>
              <Text style={{ color: p.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4, fontVariant: ["tabular-nums"] }}>{value}</Text>
            </View>
          ))}
        </View>
        {person.onShift && <Tag label="On shift now" tone="good" p={p} />}
        <HoursColumns p={p} sessionKey={"person:" + person.userId} bars={monthsOf(year).map(m => ({ key: m, label: monthLabel(m).slice(0, 3), minutes: monthMinutes(person, m), now: m === today.slice(0, 7) }))} />
        {!!best && <Text style={[ui.small, { color: p.muted }]}>Busiest month: {monthLabel(best.month, "long")}, {minutesLabel(best.minutes)}.</Text>}
        <Text style={[ui.label, { color: p.muted }]}>Latest weeks</Text>
        {recentWeeks.length ? recentWeeks.map(w => (
          <View key={w.start} style={[ui.between, { paddingVertical: 8, borderBottomWidth: 1, borderColor: p.border }]}>
            <Text style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>{weekLabel(w.start)} {w.start.slice(0, 4)}</Text>
            <Text style={{ color: p.muted, fontSize: 12 }}>{w.shifts} shift{w.shifts === 1 ? "" : "s"} · {w.days} day{w.days === 1 ? "" : "s"}</Text>
            <Text style={{ color: p.text, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{minutesLabel(w.minutes)}</Text>
          </View>
        )) : <Notice text="No hours clocked this year." p={p} />}
      </>}
    </Sheet>
  );
}

// Every clock in and clock out in a week, newest first, with its date and year.
type LogRow = { key: string; person: TimesheetPerson; day: string; shift?: TimesheetPerson["days"][number]["shifts"][number]; change?: ShiftChange };
function ClockLog({ p, account, today, onChanged }: { p: Palette; account: WorkspaceAccount; today: string; onChanged: () => void }) {
  const celebrate = useCelebrate();
  const [start, setStart] = useState(mondayOf(today));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [error, setError] = useState(""), [note, setNote] = useState("");
  const [editing, setEditing] = useState<ShiftTarget | null>(null);
  const last = addDays(start, 6);
  const load = useCallback(async () => {
    try { setSheet(timesheetSchema.parse((await readTeams({ section: "timesheet", from: start, to: last })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [start, last]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setSheet(null); void load(); } }); return () => { active = false; }; }, [load]);
  const rows = useMemo<LogRow[]>(() => {
    if (!sheet) return [];
    const out: LogRow[] = sheet.people.flatMap(person => person.days.flatMap(d => d.shifts.map(shift => ({ key: shift.id, person, day: d.day, shift, change: sheet.pending.find(c => c.shiftId === shift.id) }))));
    // Forgotten shifts asked for and still waiting, shown where they would go.
    for (const change of sheet.pending.filter(c => c.kind === "add")) {
      const person = sheet.people.find(x => x.userId === change.userId);
      if (person) out.push({ key: change.id, person, day: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(change.clockedInAt)), change });
    }
    return out.sort((a, b) => (b.shift?.clockedInAt ?? b.change!.clockedInAt).localeCompare(a.shift?.clockedInAt ?? a.change!.clockedInAt));
  }, [sheet]);
  const label = `${new Date(start + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} – ${new Date(last + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  const canEdit = !!sheet?.canEdit;
  return (
    <View style={{ gap: 14 }}>
      <WeekNav p={p} label={label} onMove={step => setStart(shiftWeek(start, step))} onToday={() => setStart(mondayOf(today))} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!sheet && !error && <Loading p={p} />}
      {sheet && <>
        <SheetTable p={p} rows={rows} keyOf={r => r.key} empty="Nobody clocked in this week."
          onRow={canEdit ? r => { if (r.shift) setEditing({ person: r.person, shift: r.shift, day: r.day }); } : undefined}
          columns={[
            { label: "Date", width: 130, cell: r => cellText(p, dayWithYear(r.day), true) },
            { label: "Person", width: 150, cell: r => cellText(p, r.person.fullName || "Team member") },
            { label: "Department", width: 120, cell: r => cellText(p, DEPARTMENT_LABEL[(r.shift ?? r.change)!.department]) },
            { label: "Clock in", width: 80, cell: r => cellText(p, londonClock((r.shift ?? r.change)!.clockedInAt)) },
            { label: "Clock out", width: 90, cell: r => { const out = (r.shift ?? r.change)!.clockedOutAt; return out ? cellText(p, londonClock(out)) : <Tag label="On shift" tone="good" p={p} />; } },
            { label: "Hours", width: 80, cell: r => cellText(p, r.shift ? minutesLabel(r.shift.minutes) : "–", true) },
            { label: "", width: 150, cell: r => r.change ? <Tag label={r.change.kind === "add" ? "Added · waiting" : "Change waiting"} tone="wait" p={p} /> : r.shift?.edited ? <Tag label="Corrected" tone="plain" p={p} />
              : <View style={[ui.row, { gap: 6 }]}><Feather name="lock" size={12} color={p.muted} /><Text style={{ fontSize: 12, color: p.muted }}>As clocked</Text></View> },
          ]} />
        {canEdit && <Button label={account.role === "super_admin" ? "Add a shift someone forgot" : "Ask to add a shift someone forgot"} icon="plus" p={p} onPress={() => setEditing({})} />}
        {!!note && <Notice text={note} p={p} />}
        <Button label="Download this week" icon="download" p={p} onPress={() => void exportReport(timesheetCsv(sheet), `Recharge-clock-ins-${start}.csv`).then(() => setNote("Spreadsheet ready."), e => setError(message(e)))} />
      </>}
      <ShiftSheet p={p} target={editing} today={today} direct={account.role === "super_admin"} people={sheet?.people ?? []} pending={sheet?.pending ?? []}
        onClose={() => setEditing(null)} onSaved={async status => { setEditing(null); celebrate(status === "pending" ? "Sent for approval" : "Saved"); await load(); onChanged(); }} />
    </View>
  );
}

// Changes to hours: those waiting for a super admin first, then what was decided.
function Approvals({ p, onChanged }: { p: Palette; onChanged: () => void }) {
  const celebrate = useCelebrate();
  const [data, setData] = useState<ShiftChanges | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [declining, setDeclining] = useState<ShiftChange | null>(null);
  const load = useCallback(async () => {
    try { setData(shiftChangesSchema.parse((await readTeams({ section: "shiftChanges" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  async function act(change: ShiftChange, action: "approve" | "withdraw") {
    if (busy) return;
    setBusy(change.id); setError("");
    try {
      await writeTeams(action === "approve" ? { action: "decideShiftChange", requestId: Crypto.randomUUID(), changeId: change.id, decision: "approve" } : { action: "withdrawShiftChange", requestId: Crypto.randomUUID(), changeId: change.id });
      celebrate(action === "approve" ? "Approved" : "Withdrawn"); await load(); onChanged();
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  if (!data) return error ? <Notice text={error} p={p} tone="bad" /> : <Loading p={p} />;
  return (
    <View style={{ gap: 14 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Text style={[ui.label, { color: p.muted }]}>Waiting for a super admin · {data.pending.length}</Text>
      {!data.pending.length && <Notice text={data.canApprove ? "Nothing to approve. Admins' changes to anyone's hours appear here." : "No changes waiting. Changes you ask for appear here until a super admin decides."} p={p} />}
      {data.pending.map((c, i) => (
        <Entrance key={c.id} delay={Math.min(i, 8) * motionTokens.stagger}>
          <ChangeCard p={p} change={c}>
            <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
              {data.canApprove && <Button label={busy === c.id ? "Saving…" : "Approve"} icon="check" primary p={p} disabled={!!busy} onPress={() => void act(c, "approve")} />}
              {data.canApprove && <Button label="Decline" icon="x" p={p} disabled={!!busy} onPress={() => setDeclining(c)} />}
              {!data.canApprove && c.requestedBy === data.me && <Button label={busy === c.id ? "Saving…" : "Withdraw"} icon="corner-up-left" p={p} disabled={!!busy} onPress={() => void act(c, "withdraw")} />}
            </View>
          </ChangeCard>
        </Entrance>
      ))}
      <Text style={[ui.label, { color: p.muted, marginTop: 8 }]}>Decided and direct changes</Text>
      {!data.recent.length && <Notice text="No changes to anyone's hours yet." p={p} />}
      {data.recent.map(c => <ChangeCard key={c.id} p={p} change={c} quiet />)}
      <DeclineSheet p={p} change={declining} onClose={() => setDeclining(null)} onDone={async () => { setDeclining(null); celebrate("Declined"); await load(); onChanged(); }} />
    </View>
  );
}

const STATUS_TONE = { pending: "wait", approved: "good", declined: "bad", withdrawn: "plain", direct: "good" } as const;
function ChangeCard({ p, change: c, quiet = false, children }: { p: Palette; change: ShiftChange; quiet?: boolean; children?: ReactNode }) {
  const d = describeChange(c);
  return (
    <View {...(Platform.OS === "web" ? { dataSet: { hover: quiet ? "row" : "lift" } } : {})}
      style={{ padding: quiet ? 14 : 18, gap: 10, borderRadius: quiet ? 16 : 22, borderWidth: 1, borderColor: c.status === "pending" ? p.waiting : p.border, backgroundColor: p.surface, ...(quiet ? {} : depth.card) }}>
      <View style={[ui.row, { gap: 12 }]}>
        <Initials p={p} name={c.fullName || "Team member"} size={quiet ? 34 : 40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>{c.fullName || "Team member"}</Text>
          <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{CHANGE_KIND[c.kind]} · {d.day}</Text>
        </View>
        <Tag label={CHANGE_STATUS[c.status]} tone={STATUS_TONE[c.status]} p={p} />
      </View>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {d.before && <Text style={{ color: p.muted, fontSize: 14, fontWeight: "600", textDecorationLine: "line-through", fontVariant: ["tabular-nums"] }}>{d.before}</Text>}
        {d.before && <Feather name="arrow-right" size={14} color={p.muted} />}
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{d.after}</Text>
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: d.delta >= 0 ? p.successWash : p.dangerWash }}>
          <Text style={{ color: d.delta >= 0 ? p.success : p.danger, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{minutesDelta(d.delta)}</Text>
        </View>
        {!!d.moved && <Tag label={d.moved} tone="plain" p={p} />}
      </View>
      <Text style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>“{c.note}”</Text>
      <Text style={{ color: p.muted, fontSize: 12 }}>
        {c.status === "direct" ? `Changed by ${c.decidedByName ?? "a super admin"} ${since(c.decidedAt ?? c.requestedAt)}` : `Asked by ${c.requestedByName ?? "an admin"} ${since(c.requestedAt)}`}
        {c.status !== "pending" && c.status !== "direct" && c.decidedAt ? ` · ${CHANGE_STATUS[c.status].toLowerCase()} by ${c.decidedByName ?? "a super admin"} ${since(c.decidedAt)}` : ""}
        {c.decisionNote ? ` · “${c.decisionNote}”` : ""}
      </Text>
      {children}
    </View>
  );
}

function DeclineSheet({ p, change, onClose, onDone }: { p: Palette; change: ShiftChange | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [why, setWhy] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(change ? "decline:" + change.id + ":" + why.trim() : null);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setWhy(""); setError(""); } }); return () => { active = false; }; }, [change]);
  async function decline() {
    if (!change || busy) return;
    if (why.trim().length < 3) { setError("Say why, so the admin knows."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "decideShiftChange", requestId: request.get(), changeId: change.id, decision: "decline", note: why.trim() }); request.done(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!change} onClose={onClose} title="Decline this change" subtitle={change?.fullName ?? undefined} icon="hourglass">
      <Text style={[ui.small, { color: p.muted }]}>Their hours stay as they are. The admin who asked is told, with your reason.</Text>
      <Field label="Why" value={why} onChange={setWhy} p={p} multiline placeholder="The rota and the door log say four o'clock" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Decline"} icon="x" primary p={p} disabled={busy} onPress={() => void decline()} />
    </Sheet>
  );
}


// ---------------------------------------------------------------- by day: a calendar and the day's clock-ins
const TIMELINE_START = 6, TIMELINE_END = 24;
const along = (hours: number) => Math.max(0, Math.min(1, (hours - TIMELINE_START) / (TIMELINE_END - TIMELINE_START))) * 100;
// The calendar's shade for a day's hours: a fresh green that deepens with them.
const heat = (p: Palette, share: number) => `rgba(${p.isDark ? "143,211,194" : "47,143,111"},${(0.1 + Math.min(1, share) * (p.isDark ? 0.34 : 0.4)).toFixed(3)})`;
const longDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function DayView({ p, account, today, onChanged }: { p: Palette; account: WorkspaceAccount; today: string; onChanged: () => void }) {
  const celebrate = useCelebrate();
  const { width } = useWindowDimensions();
  const wide = width >= 1180;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ShiftTarget | null>(null);
  const load = useCallback(async () => {
    try { setSheet(timesheetSchema.parse((await readTeams({ section: "timesheet", from: month + "-01", to: monthEnd(month) })).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [month]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setSheet(null); void load(); } }); return () => { active = false; }; }, [load]);
  const totals = useMemo(() => sheet ? dayTotals(sheet, today) : new Map<string, DayTotal>(), [sheet, today]);
  // Moving the month keeps a day selected: today in this month, otherwise its 1st.
  const goMonth = (next: string) => { setMonth(next); setDay(next === today.slice(0, 7) ? today : next + "-01"); };
  const pick = (next: string) => { if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7)); setDay(next); };
  const calendar = (
    <View style={{ gap: 12, width: wide ? 470 : "100%", flexShrink: 0 }}>
      <WeekNav p={p} label={monthLabel(month, "long")} onMove={step => goMonth(moveMonth(month, step))} onToday={() => { setMonth(today.slice(0, 7)); setDay(today); }} />
      <MonthCalendar p={p} month={month} day={day} today={today} totals={totals} loading={!sheet} onPick={pick} />
      <View style={[ui.row, { gap: 14, flexWrap: "wrap", paddingHorizontal: 4 }]}>
        {[["Hours worked", heat(p, 1)], ["Change waiting", p.waiting], ["Planned, not clocked", p.danger]].map(([label, color]) => (
          <View key={label} style={[ui.row, { gap: 6 }]}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /><Text style={{ color: p.muted, fontSize: 12 }}>{label}</Text></View>
        ))}
      </View>
    </View>
  );
  return (
    <View style={{ gap: 16 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={{ flexDirection: wide ? "row" : "column", gap: 18, alignItems: "flex-start" }}>
        {calendar}
        <View style={{ flex: 1, minWidth: 0, width: wide ? undefined : "100%" }}>
          {sheet ? <DayDetail p={p} sheet={sheet} day={day} today={today} total={totals.get(day)} wide={width >= 700} canEdit={sheet.canEdit}
            onShift={(person, shift) => setEditing({ person, shift, day })} onAdd={() => setEditing({ day })} direct={account.role === "super_admin"} /> : !error && <Loading p={p} />}
        </View>
      </View>
      <ShiftSheet p={p} target={editing} today={today} direct={account.role === "super_admin"} people={sheet?.people ?? []} pending={sheet?.pending ?? []}
        onClose={() => setEditing(null)} onSaved={async status => { setEditing(null); celebrate(status === "pending" ? "Sent for approval" : "Saved"); await load(); onChanged(); }} />
    </View>
  );
}

// The month: each day shaded by the team's hours, the chosen day filled, today ringed, with a dot for
// a change waiting for a super admin and one for someone planned who didn't clock in.
function MonthCalendar({ p, month, day, today, totals, loading, onPick }: { p: Palette; month: string; day: string; today: string; totals: Map<string, DayTotal>; loading: boolean; onPick: (day: string) => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const max = Math.max(60, ...[...totals.values()].map(t => t.minutes));
  const [hovered, setHovered] = useState<string | null>(null), [rowWidth, setRowWidth] = useState(0);
  return (
    <View accessibilityLabel={`${monthLabel(month, "long")} calendar`} style={{ padding: compact ? 8 : 12, gap: compact ? 4 : 6, borderRadius: 22, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, ...depth.card }}>
      <View style={{ flexDirection: "row", gap: compact ? 4 : 6 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <Text key={d} style={{ flex: 1, textAlign: "center", color: p.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingVertical: 4 }}>{compact ? d.slice(0, 1) : d}</Text>)}
      </View>
      {calendarWeeks(month).map((week, wi, weeks) => (
        <View key={week[0]} onLayout={e => setRowWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", gap: compact ? 4 : 6, position: "relative", zIndex: hovered && week.includes(hovered) ? 10 : 0 }}>
          {week.map(d => {
            const t = totals.get(d), inMonth = d.slice(0, 7) === month, on = d === day, isToday = d === today, future = d > today;
            const share = t ? t.minutes / max : 0;
            return (
              <Pop key={d} active={on} style={{ flex: 1 }}>
                <MotionPress {...(Platform.OS === "web" && !on ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${longDay(d)}${t?.minutes ? `, ${minutesLabel(t.minutes)} worked by ${t.people}` : ""}${t?.waiting ? `, ${t.waiting} change waiting` : ""}${t?.missed ? `, ${t.missed} not clocked` : ""}`}
                  onPress={() => onPick(d)} onHoverIn={() => setHovered(d)} onHoverOut={() => setHovered(h => (h === d ? null : h))}
                  style={[{ minHeight: compact ? 50 : 66, borderRadius: compact ? 12 : 14, padding: compact ? 5 : 8, justifyContent: "space-between", opacity: inMonth ? 1 : 0.38,
                    backgroundColor: on ? undefined : share > 0 ? heat(p, share) : future ? "transparent" : p.background, borderWidth: isToday && !on ? 1.5 : 0, borderColor: p.primary }, on ? primaryFill(p) : null]}>
                  <View style={[ui.between, { gap: 2 }]}>
                    <Text style={{ color: on ? p.onPrimary : p.text, fontSize: compact ? 12 : 14, fontWeight: isToday || on ? "800" : "600", fontVariant: ["tabular-nums"] }}>{Number(d.slice(8))}</Text>
                    <View style={[ui.row, { gap: 3 }]}>
                      {!!t?.waiting && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.waiting }} />}
                      {!!t?.missed && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.danger }} />}
                    </View>
                  </View>
                  {!loading && !!t?.minutes && <Text numberOfLines={1} style={{ color: on ? p.onPrimary : p.text, fontSize: compact ? 10 : 12, fontWeight: "700", fontVariant: ["tabular-nums"], opacity: on ? 0.95 : 0.85 }}>{Math.round(t.minutes / 60)}h</Text>}
                </MotionPress>
              </Pop>
            );
          })}
          {hovered && week.includes(hovered) && (() => {
            const t = totals.get(hovered), i = week.indexOf(hovered), gap = compact ? 52 : 70;
            // The last two weeks hang the card above, so it stays inside the calendar.
            return <ChartTip p={p} x={(i + 0.5) / 7 * rowWidth} width={rowWidth} top={gap} bottom={wi >= weeks.length - 2 ? gap : undefined} tipWidth={220} title={longDay(hovered)} rows={[
              { label: "Hours", value: t?.minutes ? minutesLabel(t.minutes) : "0h", color: p.primary }, { label: "People", value: t?.people ?? 0 }, { label: "Shifts", value: t?.shifts ?? 0 },
              ...(t?.missed ? [{ label: "Not clocked", value: t.missed, color: p.danger }] : []), ...(t?.waiting ? [{ label: "Changes waiting", value: t.waiting, color: p.waiting }] : []),
            ]} />;
          })()}
        </View>
      ))}
    </View>
  );
}

// The chosen day: its figures, then each person on a timeline from 6am to midnight, with the rota's
// planned hours behind their clocked shifts.
function DayDetail({ p, sheet, day, today, total, wide, canEdit, direct, onShift, onAdd }: {
  p: Palette; sheet: Timesheet; day: string; today: string; total?: DayTotal; wide: boolean; canEdit: boolean; direct: boolean;
  onShift: (person: TimesheetPerson, shift: TimesheetPerson["days"][number]["shifts"][number]) => void; onAdd: () => void;
}) {
  const reduced = useReducedMotion();
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { grow.setValue(1); return; }
    grow.setValue(0);
    const a = Animated.timing(grow, { toValue: 1, duration: motionTokens.reveal + 260, easing: motionTokens.entrance, useNativeDriver: false });
    a.start(); return () => a.stop();
  }, [day, reduced, grow]);
  const people = dayPeople(sheet, day, today);
  const figures: [string, string][] = [
    ["Hours", total?.minutes ? minutesLabel(total.minutes) : "0h"], ["People", String(total?.people ?? 0)],
    ["Shifts", String(total?.shifts ?? 0)], ["Not clocked", String(total?.missed ?? 0)],
  ];
  const ticks = [6, 9, 12, 15, 18, 21, 24];
  const [hoverShift, setHoverShift] = useState<string | null>(null), [trackWidth, setTrackWidth] = useState(0);
  const shiftHover = (id: string) => Platform.OS === "web" ? { onMouseEnter: () => setHoverShift(id), onMouseLeave: () => setHoverShift(h => (h === id ? null : h)) } as object : {};
  return (
    <SwapIn swapKey={day} style={{ gap: 14 }}>
      <View style={{ padding: wide ? 20 : 16, gap: 14, borderRadius: 22, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, ...depth.card }}>
        <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
          <View style={{ gap: 2 }}>
            <Text style={[ui.label, { color: p.muted }]}>{day === today ? "Today" : day > today ? "Coming up" : "Day"}</Text>
            <Text accessibilityRole="header" style={{ color: p.text, fontSize: wide ? 22 : 18, fontWeight: "800", letterSpacing: -0.5 }}>{longDay(day)}</Text>
          </View>
          {canEdit && day <= today && <Button label={direct ? "Add a shift" : "Ask to add a shift"} icon="plus" p={p} onPress={onAdd} />}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {figures.map(([label, value]) => (
            <View key={label} style={{ flexGrow: 1, flexBasis: 110, padding: 12, borderRadius: 16, backgroundColor: label === "Not clocked" && value !== "0" ? p.dangerWash : p.wash, gap: 2 }}>
              <Text style={[ui.label, { color: p.muted }]}>{label}</Text>
              <Text style={{ color: p.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4, fontVariant: ["tabular-nums"] }}>{value}</Text>
            </View>
          ))}
        </View>
        {!people.length ? <Notice text={day > today ? "Nobody is on the rota for this day yet." : "Nobody clocked in or was on the rota this day."} p={p} /> : <>
          {/* The hours along the top. */}
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 4 }}>
            {wide && <View style={{ width: 176 }} />}
            <View style={{ flex: 1, height: 16 }}>
              {ticks.map(h => <Text key={h} style={{ position: "absolute", left: `${along(h)}%`, transform: [{ translateX: h === 24 ? -14 : h === 6 ? 0 : -7 }], color: p.muted, fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{String(h).padStart(2, "0")}</Text>)}
            </View>
            {wide && <View style={{ width: 128 }} />}
          </View>
          {people.map(({ person, row, waiting }) => {
            const shifts = row?.shifts ?? [], planned = row?.planned && row.planned.shift !== "off" ? ROTA_SPAN[row.planned.shift] : null;
            const status = waiting.length ? ["Change waiting", "wait"] as const : row?.missed ? ["Not clocked", "bad"] as const : row?.open ? ["On shift", "good"] as const
              : row?.edited ? ["Corrected", "plain"] as const : null;
            const name = (
              <View style={[ui.row, { gap: 10, width: wide ? 176 : undefined, flex: wide ? undefined : 1, minWidth: 0 }]}>
                <Initials p={p} name={person.fullName || "Team member"} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{person.fullName || "Team member"}</Text>
                  <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>{row?.planned && row.planned.shift !== "off" ? `${ROTA_LABEL[row.planned.shift]} · ${ROTA_HOURS[row.planned.shift]}` : person.department ? DEPARTMENT_LABEL[person.department] : "Not on the rota"}</Text>
                  {!!pauseSummary(shifts) && <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>{pauseSummary(shifts)}</Text>}
                </View>
              </View>
            );
            const figure = (
              <View style={{ width: wide ? 128 : undefined, alignItems: "flex-end", gap: 4 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{row?.minutes ? minutesLabel(row.minutes) : "–"}</Text>
                {status && <Tag label={status[0]} tone={status[1]} p={p} />}
              </View>
            );
            const tipShift = shifts.find(s => s.id === hoverShift);
            const track = (
              <View onLayout={e => setTrackWidth(e.nativeEvent.layout.width)} style={{ flex: wide ? 1 : undefined, alignSelf: wide ? undefined : "stretch", position: "relative", zIndex: tipShift ? 10 : 0 }}>
              <View style={{ height: 34, borderRadius: 10, backgroundColor: p.wash, overflow: "hidden" }}>
                {ticks.slice(1, -1).map(h => <View key={h} style={{ position: "absolute", left: `${along(h)}%`, top: 0, bottom: 0, width: 1, backgroundColor: p.border, opacity: 0.7 }} />)}
                {planned && <View style={{ position: "absolute", left: `${along(planned[0])}%`, width: `${along(planned[1]) - along(planned[0])}%`, top: 4, bottom: 4, borderRadius: 7, borderWidth: 1, borderStyle: "dashed", borderColor: tint(p.chart, 1), backgroundColor: tint(p.chart, 0.35) }} />}
                {waiting.map(c => { const from = ukHours(c.clockedInAt), to = c.clockedOutAt ? from + (Date.parse(c.clockedOutAt) - Date.parse(c.clockedInAt)) / 3600000 : from + 1; return (
                  <View key={c.id} style={{ position: "absolute", left: `${along(from)}%`, width: `${Math.max(1, along(to) - along(from))}%`, top: 3, bottom: 3, borderRadius: 7, borderWidth: 1.5, borderColor: p.waiting }} />); })}
                {shifts.map(s => {
                  // The bar runs from clock-in to clock-out (pauses are marked on it, not cut out of it).
                  const length = (iso: string | null) => ((iso ? Date.parse(iso) : Date.now()) - Date.parse(s.clockedInAt)) / 3600000;
                  const from = ukHours(s.clockedInAt), to = from + length(s.clockedOutAt), w = Math.max(1.2, along(to) - along(from));
                  const at = (iso: string) => w ? Math.min(100, Math.max(0, (along(from + length(iso)) - along(from)) / w * 100)) : 0;
                  return (
                    <Animated.View key={s.id} {...shiftHover(s.id)} style={{ position: "absolute", left: `${along(from)}%`, top: 8, bottom: 8, borderRadius: 6, overflow: "hidden", width: grow.interpolate({ inputRange: [0, 1], outputRange: ["0%", `${w}%`] }),
                      backgroundColor: s.clockedOutAt ? p.primary : p.success, ...web({ backgroundImage: "linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0))", boxShadow: "0 4px 10px -6px rgba(21,45,40,.55)" }) }}>
                      {!!s.overtimeFrom && <View accessibilityLabel={`Overtime from ${londonClock(s.overtimeFrom)}`} style={{ position: "absolute", left: `${at(s.overtimeFrom)}%`, right: 0, top: 0, bottom: 0, backgroundColor: p.waiting, opacity: 0.85 }} />}
                      {s.pauses.map(x => <View key={x.startedAt} accessibilityLabel={`${PAUSE_LABEL[x.kind]} ${londonClock(x.startedAt)}`} style={{ position: "absolute", left: `${at(x.startedAt)}%`, width: `${Math.max(1, at(x.endedAt ?? s.clockedOutAt ?? new Date().toISOString()) - at(x.startedAt))}%`, top: 0, bottom: 0, backgroundColor: x.kind === "emergency" ? p.danger : p.surface, opacity: x.kind === "emergency" ? 0.75 : 0.6 }} />)}
                      {w > 14 && <Text numberOfLines={1} style={{ color: p.onPrimary, fontSize: 10, fontWeight: "700", paddingHorizontal: 6, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{londonClock(s.clockedInAt)}–{s.clockedOutAt ? londonClock(s.clockedOutAt) : "now"}</Text>}
                    </Animated.View>
                  );
                })}
              </View>
              {tipShift && (() => {
                const from = ukHours(tipShift.clockedInAt), hours = ((tipShift.clockedOutAt ? Date.parse(tipShift.clockedOutAt) : Date.now()) - Date.parse(tipShift.clockedInAt)) / 3600000;
                const unpaid = tipShift.unpaidMinutes ?? 0, worked = Math.max(0, Math.round(hours * 60) - unpaid);
                return <ChartTip p={p} x={(along(from) + along(from + hours)) / 200 * trackWidth} width={trackWidth} top={38} tipWidth={190} title={`${londonClock(tipShift.clockedInAt)} – ${tipShift.clockedOutAt ? londonClock(tipShift.clockedOutAt) : "now"}`} rows={[
                  { label: "Worked", value: minutesLabel(worked), color: p.primary },
                  ...tipShift.pauses.map(x => ({ label: `${PAUSE_LABEL[x.kind]} ${londonClock(x.startedAt)}`, value: x.endedAt ? minutesLabel(Math.max(1, Math.round((Date.parse(x.endedAt) - Date.parse(x.startedAt)) / 60000))) : "now", color: x.kind === "emergency" ? p.danger : p.muted })),
                  ...(tipShift.overtimeFrom ? [{ label: "Overtime from", value: londonClock(tipShift.overtimeFrom), color: p.waiting }] : []),
                ]} />;
              })()}
              </View>
            );
            const first = shifts[0];
            return (
              <MotionPress key={person.userId} {...(Platform.OS === "web" && canEdit && first ? { dataSet: { hover: "tint" } } : {})} disabled={!canEdit || !first} accessibilityRole={canEdit && first ? "button" : undefined}
                accessibilityLabel={`${person.fullName}: ${shifts.map(s => `${londonClock(s.clockedInAt)} to ${s.clockedOutAt ? londonClock(s.clockedOutAt) : "now"}`).join(", ") || "nothing clocked"}`}
                onPress={() => first && onShift(person, first)} style={{ borderRadius: 14, paddingVertical: 6, paddingHorizontal: 4, zIndex: tipShift ? 10 : 0 }}>
                {wide ? <View style={[ui.row, { gap: 10 }]}>{name}{track}{figure}</View>
                  : <View style={{ gap: 8 }}><View style={[ui.row, { gap: 10 }]}>{name}{figure}</View>{track}</View>}
              </MotionPress>
            );
          })}
          <View style={[ui.row, { gap: 14, flexWrap: "wrap" }]}>
            {[["Clocked", p.primary, false], ["On shift now", p.success, false], ["Planned on the rota", tint(p.chart, 0.6), true]].map(([label, color, dashed]) => (
              <View key={String(label)} style={[ui.row, { gap: 6 }]}><View style={{ width: 16, height: 8, borderRadius: 3, backgroundColor: String(color), ...(dashed ? { borderWidth: 1, borderStyle: "dashed", borderColor: tint(p.chart, 1) } : {}) }} /><Text style={{ color: p.muted, fontSize: 12 }}>{String(label)}</Text></View>
            ))}
            {canEdit && <Text style={{ color: p.muted, fontSize: 12 }}>Tap someone to {direct ? "correct" : "ask to correct"} their shift.</Text>}
          </View>
        </>}
      </View>
    </SwapIn>
  );
}
