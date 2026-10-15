import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Dropdown } from "./Dropdown";
import { SearchPicker } from "./SearchPicker";
import { MotionPress, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, london, message, Notice, Tag, useRequestId } from "./LiveKit";
import { Segmented } from "./Segmented";
import { PageHeading } from "./LivePages";
import { PropertyTeamChatButton } from "./PropertyTeamChat";
import { EventRow, TeamEventSheet, WhoIsWhere } from "./TeamEvents";
import { readTeams, writeTeams } from "./backend/client";
import { DateField } from "./CalendarPicker";
import { radius, icon, ui, type Palette } from "./theme";
import type { DimensionalName } from "./DimensionalIcon";
import {
  calendarEntries, calendarPeople, calendarProperties, calendarScheduleSchema, calendarTeamsFor, changeoversBetween, CLEAN_STATE_LABEL, CLEAN_STATE_TONE, ENTRY_KINDS, entryTitle,
  eventsOn, filterEntries, filterProperty, guestNameOf, KIND_COLOUR, KIND_LABEL, kindCount, monthCounts, monthGrid, monthLabel, paymentSummary, periodLabel, scheduleFor, shiftMonth, shiftWeekDay,
  shortDay, stayDates, stayDetail, stayLabel, stayNights, teamEventsSchema, TEAM_EVENT_COLOUR, TEAM_LABEL, teamPeople, timelineRows, timeRange, weekDays, weekRangeLabel, weekStart,
  type CalendarEntry, type CalendarSchedule, type Changeover, type DayCounts, type EntryKind, type Team, type TeamEvent, type TeamEvents, type TimelineRow,
} from "../../lib/calendar-live";
import { CHANNEL_LABEL, type GuestChannel } from "../../lib/guest-inbox-policy";
import { workViewsFor, type WorkView } from "../../lib/tool-directory";
import { readableStage, type PropertyView } from "../../lib/workspace-view";
import { rotaPlanSchema, type RotaPlan } from "../../lib/workspace-teams-policy";
import { formatMoney } from "../../lib/format";
import { cleanTimesLine } from "../../lib/cleans-live";
import { validClock } from "../../lib/team-time";
import type { OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Work → Calendar. Staff get four views of one schedule: Month (every booking with the guest's name and
// dates, cleans, booked maintenance and team events), Week (the same by day, with a bar per booking on
// wide screens), Changeovers (each departure with the next arrival and who cleans) and Team (where
// everyone is: rota shifts, absences, meetings, time away). Filter by property, by person and, for
// teams that work across several, by team. Owners have no calendar here.
type IconName = ComponentProps<typeof Feather>["name"];
const KIND_ICON: Record<EntryKind, IconName> = { "check-out": "log-out", clean: "droplet", "check-in": "log-in", repair: "tool", routine: "repeat", inspection: "search", work: "clipboard", payment: "credit-card" };
const KIND_ART: Record<EntryKind, DimensionalName> = { "check-out": "key", clean: "spray", "check-in": "key", repair: "toolbox", routine: "calendar", inspection: "search", work: "clipboard", payment: "wallet" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAY_STATUS = { draft: ["To issue", "wait"], issued: ["Issued, payout due", "plain"], paid: ["Paid", "good"] } as const;
const MODES = ["month", "week", "changeovers", "team"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABEL: Record<Mode, string> = { month: "Month", week: "Week", changeovers: "Changeovers", team: "Team" };
const longDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const channelName = (channel?: string | null) => channel ? CHANNEL_LABEL[channel as GuestChannel] ?? readableStage(channel) : "";

type CountKey = EntryKind | "event";
const kindsOf = (counts: DayCounts["counts"]) => ([...ENTRY_KINDS, "event"] as CountKey[]).filter(k => counts[k]).map(k => [k, counts[k]!] as const);
const countText = (k: CountKey, n: number) => k === "event" ? `${n} team ${n === 1 ? "event" : "events"}` : kindCount(k, n);
const colourOf = (p: Palette, k: CountKey) => (k === "event" ? TEAM_EVENT_COLOUR : KIND_COLOUR[k])[p.isDark ? "dark" : "light"];

function DayCell({ p, date, inMonth, isToday, isSelected, counts, roomy, first, onPress }: { p: Palette; date: string; inMonth: boolean; isToday: boolean; isSelected: boolean; counts: DayCounts["counts"]; roomy: boolean; first: boolean; onPress: () => void }) {
  const kinds = kindsOf(counts);
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${longDate(date)}, ${kinds.length ? kinds.map(([k, n]) => countText(k, n)).join(", ") : "nothing scheduled"}`} onPress={onPress}
      style={{ flex: 1, minWidth: 0, minHeight: roomy ? 104 : 58, borderLeftWidth: first ? 0 : 1, borderColor: p.border, backgroundColor: isSelected ? p.wash : "transparent", padding: roomy ? 6 : 3, gap: roomy ? 4 : 3, alignItems: roomy ? "stretch" : "center", opacity: inMonth || isSelected ? 1 : 0.55 }}>
      <View style={{ width: roomy ? 26 : 24, height: roomy ? 26 : 24, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? p.primary : "transparent", borderWidth: isSelected && !isToday ? 1.5 : 0, borderColor: p.primary }}>
        <Text style={{ color: isToday ? p.onPrimary : p.text, fontSize: 12, fontWeight: isToday || isSelected ? "600" : "500", fontVariant: ["tabular-nums"] }}>{Number(date.slice(8))}</Text>
      </View>
      {roomy ? <>
        {kinds.slice(0, 3).map(([k, n]) => (
          <View key={k} style={[ui.row, { gap: 5, minWidth: 0 }]}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colourOf(p, k) }} />
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, flexShrink: 1 }}>{countText(k, n)}</Text>
          </View>
        ))}
        {kinds.length > 3 && <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>+{kinds.length - 3} more</Text>}
      </> : !!kinds.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 3, maxWidth: 30 }}>
          {kinds.slice(0, 4).map(([k]) => <View key={k} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colourOf(p, k) }} />)}
        </View>
      )}
    </MotionPress>
  );
}

function Fact({ p, icon, label, value }: { p: Palette; icon: IconName; label: string; value: string }) {
  return (
    <View style={[ui.row, { gap: 12, paddingVertical: 2 }]}>
      <View style={{ width: 36, height: 36, borderRadius: radius.control, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon} size={16} color={p.text} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
        <Text selectable style={{ color: p.text, fontSize: 15, fontWeight: "500" }}>{value}</Text>
      </View>
    </View>
  );
}

// A filter as a pill that opens its choices underneath.
function FilterChip({ p, icon, label, active, open, onPress }: { p: Palette; icon: IconName; label: string; active: boolean; open: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} onPress={onPress}
      style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: active ? p.primary : p.border, backgroundColor: active ? p.wash : p.surface }]}>
      <Feather name={icon} size={14} color={active ? p.primary : p.muted} />
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 13, fontWeight: "500", flexShrink: 1 }}>{label}</Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={p.muted} />
    </MotionPress>
  );
}

// Moving work to another day or giving it a time of day (UK time). The person it is assigned to is told.
function WorkTimeEditor({ p, entry, onSaved }: { p: Palette; entry: CalendarEntry; onSaved: () => Promise<void> }) {
  const w = entry.work!;
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(w.dueOn ?? entry.date), [start, setStart] = useState(w.dueTime ?? ""), [end, setEnd] = useState(w.endTime ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(editing ? [w.workId, w.version, day, start, end].join(":") : null);
  async function save() {
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setError("Choose the date."); return; }
    if ((start && !validClock(start)) || (end && !validClock(end))) { setError("Enter times as HH:MM, for example 10:30."); return; }
    if (end && !start) { setError("Add a start time as well as an end time."); return; }
    if (start && end && end <= start) { setError("The end time must be after the start time."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "setWorkTime", requestId: request.get(), workId: w.workId, version: w.version, dueOn: day, startTime: start || null, endTime: end || null });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (!editing) return <Button label={entry.time ? "Change the day or time" : "Set the day and time"} icon="clock" p={p} onPress={() => setEditing(true)} />;
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: p.border }}>
      <DateField p={p} label="Date" mode="single" wholeMonthLink={false} empty="Choose a date" value={{ from: day, to: day }} onChange={next => setDay(next.from)} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 120 }}><Field label="Starts (HH:MM)" value={start} onChange={setStart} p={p} placeholder="10:00" /></View>
        <View style={{ flex: 1, minWidth: 120 }}><Field label="Ends (optional)" value={end} onChange={setEnd} p={p} placeholder="14:00" /></View>
      </View>
      <Text style={[ui.small, { color: p.muted }]}>UK time. Leave the times empty for any time that day.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    </View>
  );
}

// Wide screens: one row per property across the seven days, a bar for each booking (its nights) and a
// dot for each clean or repair. Tap a bar or a dot for its details.
function WeekTimeline({ p, days, today, rows, onStay, onWork }: { p: Palette; days: string[]; today: string; rows: TimelineRow[]; onStay: (reservationId: string) => void; onWork: (workId: string) => void }) {
  const LABEL = 170;
  const dayHead = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
  return (
    <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, overflow: "hidden", backgroundColor: p.surface }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: p.border }}>
        <View style={{ width: LABEL }} />
        {days.map(d => (
          <View key={d} style={{ flex: 1, minWidth: 0, alignItems: "center", paddingVertical: 8, borderLeftWidth: 1, borderColor: p.border, backgroundColor: d === today ? p.wash : "transparent" }}>
            <Text numberOfLines={1} style={{ color: d === today ? p.text : p.muted, fontSize: 12, fontWeight: d === today ? "600" : "500" }}>{dayHead(d)}</Text>
          </View>
        ))}
      </View>
      {rows.length ? rows.map((r, i) => (
        <View key={r.propertyId} style={{ flexDirection: "row", minHeight: 64, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
          <View style={{ width: LABEL, padding: 10, justifyContent: "center" }}><Text numberOfLines={2} style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>{r.propertyName}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, flexDirection: "row" }}>
              {days.map(d => <View key={d} style={{ flex: 1, borderLeftWidth: 1, borderColor: p.border, backgroundColor: d === today ? p.wash : "transparent" }} />)}
            </View>
            {r.bars.map(b => (
              <MotionPress key={b.reservationId} accessibilityRole="button" accessibilityLabel={`${b.label}, ${stayDates(b.stay)}, ${b.nights} ${b.nights === 1 ? "night" : "nights"}${b.channel ? ", " + channelName(b.channel) : ""}`} onPress={() => onStay(b.reservationId)}
                style={{ position: "absolute", top: 8, height: 28, left: `${(b.startCol / days.length) * 100}%`, width: `${(b.span / days.length) * 100}%`, paddingHorizontal: 8, justifyContent: "center", backgroundColor: p.primary,
                  borderTopLeftRadius: b.fromBefore ? 0 : 8, borderBottomLeftRadius: b.fromBefore ? 0 : 8, borderTopRightRadius: b.toAfter ? 0 : 8, borderBottomRightRadius: b.toAfter ? 0 : 8 }}>
                <Text numberOfLines={1} style={{ color: p.onPrimary, fontSize: 12, fontWeight: "500" }}>{b.label}</Text>
              </MotionPress>
            ))}
            {r.marks.map((m, n) => (
              <MotionPress key={m.workId} accessibilityRole="button" accessibilityLabel={`${KIND_LABEL[m.kind]}: ${m.title}`} onPress={() => onWork(m.workId)}
                style={{ position: "absolute", bottom: 8, left: `${((m.col + 0.5) / days.length) * 100}%`, marginLeft: -6 + (r.marks.slice(0, n).filter(x => x.col === m.col).length * 14), width: 12, height: 12, borderRadius: 6, backgroundColor: KIND_COLOUR[m.kind][p.isDark ? "dark" : "light"] }}>
                <View />
              </MotionPress>
            ))}
          </View>
        </View>
      )) : <Text style={[ui.small, { color: p.muted, padding: 14 }]}>No bookings, cleans or repairs this week.</Text>}
    </View>
  );
}

export function LiveCalendar({ palette: p, account, work, desktop, onOpenWork, onOpenView, properties = [] }: {
  palette: Palette; account: WorkspaceAccount; work: OperationView[]; desktop: boolean; onOpenWork: (item: OperationView) => void; onOpenView?: (view: WorkView, sub?: string) => void;
  // Optional: with the property list the Changeovers view shows each full address.
  properties?: PropertyView[];
}) {
  const { width } = useWindowDimensions();
  const roomy = width >= 700;
  const staff = account.role !== "client";
  const today = london(new Date());
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState(today);
  const [team, setTeam] = useState<Team | "all">("all"), [person, setPerson] = useState<{ id: string; name: string } | null>(null), [propertyId, setPropertyId] = useState("");
  const [filter, setFilter] = useState<"property" | "person" | null>(null);
  const [schedule, setSchedule] = useState<CalendarSchedule | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [events, setEvents] = useState<TeamEvents | null>(null), [eventsMissing, setEventsMissing] = useState(false), [rota, setRota] = useState<RotaPlan | null>(null);
  const [open, setOpen] = useState<CalendarEntry | null>(null), [eventSheet, setEventSheet] = useState<{ event: TeamEvent | null; day: string } | null>(null);
  const grid = useMemo(() => monthGrid(month), [month]);
  const latest = useRef(0);
  // The six weeks on screen (42 days, inside the schedule's 62-day limit), and for staff the team events
  // in the same window. A slower, older read never replaces a newer one. The team events are optional:
  // a database without them still shows the schedule.
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true); setError("");
    try {
      const [sched, evs] = await Promise.allSettled([
        readTeams({ section: "schedule", from: grid.from, to: grid.to }),
        staff ? readTeams({ section: "teamEvents", from: grid.from, to: grid.to }) : Promise.resolve(null),
      ]);
      if (ticket !== latest.current) return;
      if (sched.status === "rejected") throw sched.reason;
      setSchedule(calendarScheduleSchema.parse(sched.value.data));
      if (evs.status === "fulfilled" && evs.value) {
        const parsed = teamEventsSchema.safeParse(evs.value.data);
        setEvents(parsed.success ? parsed.data : null); setEventsMissing(!parsed.success);
      } else setEventsMissing(evs.status === "rejected");
    } catch (e) { if (ticket === latest.current) setError(message(e)); }
    finally { if (ticket === latest.current) setLoading(false); }
  }, [grid.from, grid.to, staff]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  // The rota for the week on screen: every team role can read it. Optional like the events.
  const weekList = useMemo(() => weekDays(selected), [selected]);
  const rotaFrom = weekList[0], rotaTo = weekList[6];
  useEffect(() => {
    if (!staff) return;
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const parsed = rotaPlanSchema.parse((await readTeams({ section: "rotaPlan", from: rotaFrom, to: rotaTo })).data);
        if (active) setRota(parsed);
      } catch { if (active) setRota(null); }
    });
    return () => { active = false; };
  }, [staff, rotaFrom, rotaTo]);

  const entries = useMemo(() => schedule ? calendarEntries(schedule) : [], [schedule]);
  // Each clean's checkout time and next guests ("Checkout 10:00 · next guests 15:00"), for cleaners too: times, never names.
  const cleanTimes = useMemo(() => new Map((schedule?.cleanGuests ?? []).map(g => [g.workId, g])), [schedule]);
  const timesOf = (e: CalendarEntry) => e.work && e.kind === "clean" ? cleanTimesLine(cleanTimes.get(e.work.workId), e.date) : null;
  const evList = useMemo(() => events?.events ?? [], [events]);
  const teams = calendarTeamsFor(account.role);
  const propertyList = useMemo(() => {
    const list = new Map(schedule ? calendarProperties(schedule) : []);
    if (propertyId && !list.has(propertyId)) list.set(propertyId, properties.find(x => x.id === propertyId)?.name ?? "This property");
    return Array.from(list.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [schedule, propertyId, properties]);
  const people = useMemo(() => {
    if (!staff) return [];
    const list = new Map(calendarPeople(entries));
    for (const [id, name] of teamPeople(rota, evList)) if (!list.has(id)) list.set(id, name);
    if (person && !list.has(person.id)) list.set(person.id, person.name);
    return Array.from(list.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [staff, entries, rota, evList, person]);
  const propertyLabel = propertyList.find(([id]) => id === propertyId)?.[1];
  const shown = useMemo(() => filterEntries(filterProperty(entries, propertyId || null), teams.length > 1 ? team : "all", person?.id ?? null), [entries, propertyId, teams.length, team, person]);
  // Team events have no property, so a property filter leaves them out.
  const eventsShown = useMemo(() => propertyId ? [] : person ? evList.filter(e => e.userId === person.id) : evList, [evList, propertyId, person]);
  const cells = useMemo(() => monthCounts(month, shown, eventsShown), [month, shown, eventsShown]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of shown) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [shown]);
  const ops = useMemo(() => new Map(work.map(w => [w.workId, w])), [work]);
  const entryById = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const dayEntries = byDay.get(selected) ?? [];
  const dayEvents = eventsOn(selected, eventsShown);
  const legend = useMemo(() => {
    const totals = new Map<CountKey, number>();
    for (const cell of cells.weeks.flat()) if (cell.inMonth) for (const k of ENTRY_KINDS) if (cell.counts[k]) totals.set(k, (totals.get(k) ?? 0) + cell.counts[k]!);
    const inMonth = eventsShown.filter(e => e.endsOn >= month + "-01" && e.startsOn <= month + "-31").length;
    if (inMonth) totals.set("event", inMonth);
    return ([...ENTRY_KINDS, "event"] as CountKey[]).filter(k => totals.has(k)).map(k => [k, totals.get(k)!] as const);
  }, [cells, eventsShown, month]);

  // Week, Changeovers and Team move by the week; Month by the month. The month on screen always holds the week.
  const goTo = (day: string) => { setSelected(day); setMonth(day.slice(0, 7)); };
  const move = (step: number) => {
    if (mode === "month") { const next = shiftMonth(month, step); setMonth(next); setSelected(today.startsWith(next) ? today : next + "-01"); }
    else goTo(shiftWeekDay(selected, step));
  };
  const who = (e: CalendarEntry) => e.personId === account.userId ? "You" : e.personName ?? "Not assigned yet";
  const detailOf = (e: CalendarEntry) => e.stay ? [e.propertyName, stayDetail(e.stay), channelName(e.stay.channel)].filter(Boolean).join(" · ")
    : e.payments ? `${e.propertyName} · ${paymentSummary(e.payments)}`
    : [timeRange(e.time, e.endTime), e.propertyName, timesOf(e), who(e)].filter(Boolean).join(" · ");
  const addressOf = (id: string, name: string) => { const a = properties.find(x => x.id === id)?.address; return a && a !== name ? a : ""; };
  const canChat = account.role !== "client" && account.role !== "accounts";
  const canTime = account.role !== "client" && account.role !== "cleans";
  const sheetPeople = useMemo(() => (rota?.people ?? []).map(x => ({ userId: x.userId, fullName: x.fullName })), [rota]);
  const openEvent = (event: TeamEvent | null, day = selected) => setEventSheet({ event, day });
  const openStay = (reservationId: string) => { const entry = entryById.get("in:" + reservationId); if (entry) setOpen(entry); };
  const openWorkId = (workId: string) => { const entry = entryById.get("w:" + workId); if (entry) setOpen(entry); };

  const header = (
    <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
      <View style={[ui.row, { gap: 8, flexShrink: 1 }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel="Go to today" onPress={() => goTo(today)} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>Today</Text>
        </MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel={mode === "month" ? "Previous month" : "Previous week"} onPress={() => move(-1)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel={mode === "month" ? "Next month" : "Next week"} onPress={() => move(1)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
        <SwapIn swapKey={mode === "month" ? month : weekStart(selected)}><Text accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: p.text, fontSize: 18, fontWeight: "600", marginLeft: 4 }}>{mode === "month" ? monthLabel(month) : weekRangeLabel(selected)}</Text></SwapIn>
      </View>
      <View style={[ui.row, { gap: 8 }]}>
        {loading && <ActivityIndicator accessibilityLabel="Loading the calendar" color={p.primary} />}
        {staff && (
          <MotionPress accessibilityRole="button" accessibilityLabel="Add an absence, meeting or time away" onPress={() => openEvent(null)} style={[ui.row, { gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
            <Feather name="plus" size={icon.row} color={p.text} /><Text style={{ color: p.text, fontSize: 13, fontWeight: "500" }}>Add</Text>
          </MotionPress>
        )}
        <MotionPress accessibilityRole="button" accessibilityLabel="Refresh the calendar" disabled={loading} onPress={() => void load()} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}><Feather name="refresh-cw" size={16} color={p.text} /></MotionPress>
      </View>
    </View>
  );

  // One entry of the schedule as a row; a tap opens its details.
  const entryRow = (e: CalendarEntry, i: number) => {
    const done = e.status === "completed", unassigned = !!e.work && !e.personId && e.kind === "clean" && account.role !== "cleans";
    return (
      <MotionPress key={e.id} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={`${KIND_LABEL[e.kind]}: ${entryTitle(e)}, ${detailOf(e)}${done ? ", done" : ""}`} onPress={() => setOpen(e)}
        style={[ui.row, { gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: p.border, alignItems: "center" }]}>
        <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: colourOf(p, e.kind) }} />
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: p.background, alignItems: "center", justifyContent: "center" }}><Feather name={KIND_ICON[e.kind]} size={16} color={colourOf(p, e.kind)} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600", textDecorationLine: done ? "line-through" : "none" }}>{entryTitle(e)}</Text>
          <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{detailOf(e)}</Text>
        </View>
        {done ? <Tag label="Done" tone="good" p={p} /> : unassigned ? <Tag label="Unassigned" tone="wait" p={p} /> : null}
        <Feather name="chevron-right" size={icon.row} color={p.muted} />
      </MotionPress>
    );
  };
  // A day's entries and team events together, in one card.
  const dayCard = (entriesOfDay: CalendarEntry[], eventsOfDay: TeamEvent[], day: string) => (
    <View style={{ borderRadius: radius.card, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
      {entriesOfDay.map((e, i) => entryRow(e, i))}
      {eventsOfDay.map((e, i) => <EventRow key={e.id} p={p} event={e} day={day} first={!entriesOfDay.length && !i} onPress={() => openEvent(e, day)} />)}
    </View>
  );

  const monthView = (
    <SwapIn swapKey={month + team + (person?.id ?? "") + propertyId}>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, overflow: "hidden", backgroundColor: p.surface }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: p.border }}>
          {WEEKDAYS.map(name => <Text key={name} accessibilityElementsHidden importantForAccessibility="no" style={{ flex: 1, textAlign: "center", paddingVertical: 8, color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>{roomy ? name : name.slice(0, 1)}</Text>)}
        </View>
        {cells.weeks.map((days, row) => (
          <View key={days[0].date} style={{ flexDirection: "row", borderTopWidth: row ? 1 : 0, borderColor: p.border }}>
            {days.map((cell, col) => <DayCell key={cell.date} p={p} date={cell.date} first={col === 0} inMonth={cell.inMonth} isToday={cell.date === today} isSelected={cell.date === selected} counts={cell.counts} roomy={roomy} onPress={() => setSelected(cell.date)} />)}
          </View>
        ))}
      </View>
      {!!legend.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 10 }}>
          {legend.map(([k, n]) => (
            <View key={k} style={[ui.row, { gap: 6 }]}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: colourOf(p, k) }} />
              <Text style={[ui.small, { color: p.muted }]}>{countText(k, n)}</Text>
            </View>
          ))}
        </View>
      )}
    </SwapIn>
  );

  const agenda = (
    <SwapIn swapKey={selected + team + (person?.id ?? "") + propertyId} style={{ gap: 10 }}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "600", flex: 1, minWidth: 0 }}>{longDate(selected)}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{dayEntries.length + dayEvents.length ? `${dayEntries.length + dayEvents.length} on this day` : ""}</Text>
      </View>
      {!!person && <Text style={[ui.small, { color: p.muted }]}>{person.name}’s day</Text>}
      {dayEntries.length || dayEvents.length ? dayCard(dayEntries, dayEvents, selected) : (
        <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="sun" size={16} color={p.muted} />
          <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{loading && !schedule ? "Loading this day…" : person ? `Nothing for ${person.name} on this day.` : "Nothing on this day. Pick another date to see what is booked."}</Text>
        </View>
      )}
    </SwapIn>
  );

  // Week: on wide screens a bar per booking for each property, then each day of the week as a card.
  const timeline = useMemo(() => {
    if (!schedule) return [];
    const base = scheduleFor(schedule, propertyId || null);
    return timelineRows(weekList, person ? { ...base, stays: [], work: base.work.filter(w => w.assigneeId === person.id) } : base);
  }, [schedule, propertyId, person, weekList]);
  const weekView = (
    <SwapIn swapKey={weekStart(selected) + team + (person?.id ?? "") + propertyId} style={{ gap: 16 }}>
      {roomy && <WeekTimeline p={p} days={weekList} today={today} rows={timeline} onStay={openStay} onWork={openWorkId} />}
      {weekList.map(day => {
        const list = byDay.get(day) ?? [], evs = eventsOn(day, eventsShown);
        return (
          <View key={day} style={{ gap: 8 }}>
            <View style={[ui.row, { gap: 10 }]}>
              <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{longDate(day)}</Text>
              {day === today && <Tag label="Today" tone="plain" p={p} />}
            </View>
            {list.length || evs.length ? dayCard(list, evs, day) : <Text style={[ui.small, { color: p.muted }]}>{loading && !schedule ? "Loading…" : "Nothing on this day."}</Text>}
          </View>
        );
      })}
    </SwapIn>
  );

  // Changeovers: each departure this week with the guests out and in, who cleans, and how the clean stands.
  const changeovers = useMemo(() => {
    if (!schedule) return [];
    return changeoversBetween(weekList[0], weekList[6], scheduleFor(schedule, propertyId || null)).filter(c => !person || c.clean?.assigneeId === person.id);
  }, [schedule, propertyId, person, weekList]);
  const changeoverCard = (c: Changeover) => {
    const address = addressOf(c.propertyId, c.propertyName), cleaner = c.clean ? (c.clean.assigneeId === account.userId ? "You" : c.clean.assigneeName ?? "No cleaner yet") : "";
    const nextGuests = c.next ? stayLabel(c.next) : "";
    const target = (c.clean && entryById.get("w:" + c.clean.workId)) ?? entryById.get("out:" + c.out.reservationId);
    return (
      <MotionPress key={c.out.reservationId} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" disabled={!target} onPress={() => target && setOpen(target)}
        accessibilityLabel={`Changeover at ${c.propertyName}: ${stayLabel(c.out)} out, ${c.next ? `${nextGuests} in ${c.sameDay ? "the same day" : "on " + shortDay(c.next.checkIn)}` : "no arrival booked"}, ${CLEAN_STATE_LABEL[c.cleanState]}`}
        style={{ gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
        <View style={[ui.between, { gap: 10, alignItems: "flex-start" }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{c.propertyName}</Text>
            {!!address && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{address}</Text>}
          </View>
          <Tag label={c.sameDay ? "Same-day changeover" : c.gapDays === null ? "No arrival booked" : c.gapDays === 1 ? "Empty one night" : `Empty ${c.gapDays} nights`} tone={c.sameDay ? "wait" : "plain"} p={p} />
        </View>
        <View style={{ gap: 10 }}>
          <Fact p={p} icon="log-out" label="Guests out" value={[stayLabel(c.out), stayDetail(c.out)].join(" · ")} />
          <Fact p={p} icon="log-in" label={c.sameDay ? "Guests in, the same day" : "Next guests in"}
            value={c.next ? [nextGuests, `arrives ${shortDay(c.next.checkIn)}`, `${stayNights(c.next)} ${stayNights(c.next) === 1 ? "night" : "nights"}`].join(" · ") : "Nothing booked in this period"} />
          <Fact p={p} icon="droplet" label="Cleaner" value={c.clean ? [cleaner, timeRange(c.clean.dueTime, c.clean.endTime) ?? "any time", c.clean.dueOn !== c.day && c.clean.dueOn ? `due ${shortDay(c.clean.dueOn)}` : ""].filter(Boolean).join(" · ") : "No clean booked yet"} />
        </View>
        <Tag label={CLEAN_STATE_LABEL[c.cleanState]} tone={CLEAN_STATE_TONE[c.cleanState]} p={p} />
      </MotionPress>
    );
  };
  const sameDayCount = changeovers.filter(c => c.sameDay).length, uncovered = changeovers.filter(c => c.cleanState === "none" || c.cleanState === "unassigned").length;
  const changeoverView = (
    <SwapIn swapKey={"c" + weekStart(selected) + (person?.id ?? "") + propertyId} style={{ gap: 14 }}>
      <Text style={[ui.small, { color: p.muted }]}>
        {changeovers.length ? `${changeovers.length} ${changeovers.length === 1 ? "changeover" : "changeovers"} this week · ${sameDayCount} the same day · ${uncovered} without a cleaner` : ""}
      </Text>
      {changeovers.length ? weekList.filter(d => changeovers.some(c => c.day === d)).map(d => (
        <View key={d} style={{ gap: 8 }}>
          <View style={[ui.row, { gap: 10 }]}>
            <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{longDate(d)}</Text>
            {d === today && <Tag label="Today" tone="plain" p={p} />}
          </View>
          <View style={{ gap: 10, flexDirection: roomy ? "row" : "column", flexWrap: "wrap" }}>
            {changeovers.filter(c => c.day === d).map(c => <View key={c.out.reservationId} style={{ flexGrow: 1, flexBasis: roomy ? 340 : "auto", minWidth: 0 }}>{changeoverCard(c)}</View>)}
          </View>
        </View>
      )) : (
        <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="key" size={16} color={p.muted} />
          <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{loading && !schedule ? "Loading the changeovers…" : person ? `No changeovers cleaned by ${person.name} this week.` : "No guests leave this week, so there are no changeovers."}</Text>
        </View>
      )}
    </SwapIn>
  );

  const teamView = (
    <View style={{ gap: 12 }}>
      {eventsMissing && <Notice text="The team calendar is not available yet, so only the rota is shown." p={p} />}
      <WhoIsWhere p={p} rota={rota} events={evList} days={weekList} day={selected} today={today} myId={account.userId} loading={loading} personId={person?.id ?? null}
        onDay={setSelected} onOpenEvent={e => openEvent(e, selected)} />
    </View>
  );

  const op = open?.work ? ops.get(open.work.workId) : undefined;
  const filters = staff && (propertyList.length > 1 || !!propertyId || people.length > 1 || !!person);
  return (
    <View style={{ gap: 16 }}>
      <PageHeading palette={p} title="Calendar" subtitle={staff ? "Bookings with guest names, changeovers, cleans, maintenance and where the team is. Tap a day or a booking for its details." : "Tap a day to see what is happening, then an entry for its details."} />
      {staff && <Segmented p={p} label="Calendar view" items={MODES.map(m => ({ key: m, label: MODE_LABEL[m] }))} value={mode} onChange={setMode} />}
      {(mode === "month" || mode === "week") && teams.length > 1 && <Dropdown p={p} label="Team" hideLabel value={team} onChange={setTeam}
        options={(["all", ...teams] as (Team | "all")[]).map(v => ({ value: v, label: v === "all" ? "All teams" : TEAM_LABEL[v] }))} />}
      {filters && (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {mode !== "team" && (propertyList.length > 1 || !!propertyId) && <FilterChip p={p} icon="home" label={propertyLabel ? `Property: ${propertyLabel}` : "All properties"} active={!!propertyId} open={filter === "property"} onPress={() => setFilter(filter === "property" ? null : "property")} />}
            {(people.length > 1 || !!person) && <FilterChip p={p} icon="user" label={person ? `Person: ${person.name}` : "Everyone"} active={!!person} open={filter === "person"} onPress={() => setFilter(filter === "person" ? null : "person")} />}
          </View>
          {filter === "property" && <SearchPicker p={p} value={propertyId} onChange={id => { setPropertyId(id); setFilter(null); }} fixed={[{ id: "", label: "All properties" }]} options={propertyList.map(([id, name]) => ({ id, label: name }))} placeholder="Search properties by name" nouns="properties" />}
          {filter === "person" && <SearchPicker p={p} value={person?.id ?? ""} onChange={id => { setPerson(id ? { id, name: people.find(([x]) => x === id)?.[1] ?? "" } : null); setFilter(null); }}
            fixed={[{ id: "", label: "Everyone" }]} options={people.map(([id, name]) => ({ id, label: name }))} placeholder="Search the team by name" nouns="people" />}
        </View>
      )}
      {header}
      {!!error && <View style={{ gap: 8 }}><Notice text={error} p={p} tone="bad" /><Button label="Try again" icon="refresh-cw" p={p} onPress={() => void load()} /></View>}
      {mode === "month" && (desktop ? (
        <View style={{ flexDirection: "row", gap: 20, alignItems: "flex-start" }}>
          <View style={{ flex: 1.7, minWidth: 0 }}>{monthView}</View>
          <View style={{ flex: 1, minWidth: 300 }}>{agenda}</View>
        </View>
      ) : <>{monthView}{agenda}</>)}
      {mode === "week" && weekView}
      {mode === "changeovers" && changeoverView}
      {mode === "team" && teamView}

      <TeamEventSheet palette={p} visible={!!eventSheet} event={eventSheet?.event ?? null} day={eventSheet?.day ?? selected} canEditAll={events?.canEditAll ?? false} myId={account.userId} people={sheetPeople}
        onClose={() => setEventSheet(null)} onSaved={load} />

      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open ? entryTitle(open) : ""} subtitle={open ? `${longDate(open.date)} · ${KIND_LABEL[open.kind]}` : undefined} icon={open ? KIND_ART[open.kind] : "calendar"}>
        {open?.work && <>
          <Fact p={p} icon={KIND_ICON[open.kind]} label="Type" value={open.kind === "work" && open.work.kind ? readableStage(open.work.kind) : KIND_LABEL[open.kind]} />
          <Fact p={p} icon="home" label="Property" value={open.propertyName} />
          <Fact p={p} icon="clock" label="Time" value={timeRange(open.time, open.endTime) ?? "Any time"} />
          {open.kind === "clean" && <Fact p={p} icon="log-out" label="Guests" value={timesOf(open) ?? "No checkout or arrival time known yet"} />}
          <Fact p={p} icon="user" label="Assigned to" value={who(open)} />
          <Fact p={p} icon="activity" label="Status" value={readableStage(open.work.status)} />
          <Fact p={p} icon="users" label="Team" value={TEAM_LABEL[open.team]} />
          {op ? <Button label="Open" icon="arrow-right" primary p={p} onPress={() => { setOpen(null); onOpenWork(op); }} />
            : <Text style={[ui.small, { color: p.muted }]}>{open.status === "completed" ? "This is done. Its record stays on the calendar." : "Its full details open from Work → All work."}</Text>}
          {canTime && !["completed", "cancelled", "declined"].includes(open.work.status) && <WorkTimeEditor key={open.id + ":" + open.work.version} p={p} entry={open} onSaved={async () => { setOpen(null); await load(); }} />}
          {canChat && <PropertyTeamChatButton palette={p} propertyId={open.propertyId} workId={open.work.workId} />}
        </>}
        {open?.stay && <>
          {!!guestNameOf(open.stay) && <Fact p={p} icon="user" label="Guest" value={guestNameOf(open.stay)} />}
          <Fact p={p} icon="home" label="Property" value={open.propertyName} />
          <Fact p={p} icon="log-in" label="Guests arrive" value={longDate(open.stay.checkIn)} />
          <Fact p={p} icon="log-out" label="Guests leave" value={longDate(open.stay.checkOut)} />
          <Fact p={p} icon="moon" label="Nights" value={String(stayNights(open.stay))} />
          {!!open.stay.guests && <Fact p={p} icon="users" label="Guests" value={String(open.stay.guests)} />}
          {!!open.stay.channel && <Fact p={p} icon="globe" label="Booked on" value={channelName(open.stay.channel)} />}
          {canChat && <PropertyTeamChatButton palette={p} propertyId={open.propertyId} />}
        </>}
        {open?.payments && <>
          <Fact p={p} icon="credit-card" label="Owner payouts on this day" value={formatMoney(open.payments.reduce((sum, x) => sum + x.payoutMinor, 0))} />
          <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, paddingHorizontal: 14 }}>
            {open.payments.map((x, i) => (
              <View key={x.statementId} style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border, alignItems: "flex-start" }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{x.propertyName}</Text>
                  <Text style={[ui.small, { color: p.muted }]}>Statement for {periodLabel(x.period)}{x.reference ? ` · ${x.reference}` : ""}</Text>
                  <Tag label={PAY_STATUS[x.status][0]} tone={PAY_STATUS[x.status][1]} p={p} />
                </View>
                <Text style={{ color: x.payoutMinor < 0 ? p.danger : p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{formatMoney(x.payoutMinor)}</Text>
              </View>
            ))}
          </View>
          {onOpenView && workViewsFor(account.role).includes("accounts") && <Button label="Open statements" icon="arrow-right" primary p={p} onPress={() => { setOpen(null); onOpenView("accounts", "statements"); }} />}
        </>}
      </Sheet>
    </View>
  );
}
