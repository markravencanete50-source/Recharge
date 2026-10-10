import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SearchPicker } from "./SearchPicker";
import { MotionPress, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, london, message, Notice, Tag, useRequestId } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { PageHeading } from "./LivePages";
import { PropertyTeamChatButton } from "./PropertyTeamChat";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { DimensionalName } from "./DimensionalIcon";
import {
  calendarEntries, calendarPeople, calendarScheduleSchema, calendarTeamsFor, canPickPerson, ENTRY_KINDS, filterEntries, KIND_COLOUR, KIND_LABEL, kindCount,
  monthGrid, monthLabel, paymentSummary, periodLabel, shiftMonth, TEAM_LABEL, timeRange, type CalendarEntry, type CalendarSchedule, type EntryKind, type Team,
} from "../../lib/calendar-live";
import { CHANNEL_LABEL, type GuestChannel } from "../../lib/guest-inbox-policy";
import { workViewsFor, type WorkView } from "../../lib/tool-directory";
import { readableStage } from "../../lib/workspace-view";
import { formatMoney } from "../../lib/format";
import { validClock } from "../../lib/team-time";
import type { OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Work → Calendar: a month of cleans, arrivals and departures, repairs, routine visits, inspections,
// other dated work and (for admins and accounts) payment runs. Tap a day for its agenda, then an
// entry for its details. Filter by team, and admins and cleaning managers by person.
type IconName = ComponentProps<typeof Feather>["name"];
const KIND_ICON: Record<EntryKind, IconName> = { "check-out": "log-out", clean: "droplet", "check-in": "log-in", repair: "tool", routine: "repeat", inspection: "search", work: "clipboard", payment: "credit-card" };
const KIND_ART: Record<EntryKind, DimensionalName> = { "check-out": "key", clean: "spray", "check-in": "key", repair: "toolbox", routine: "calendar", inspection: "search", work: "clipboard", payment: "wallet" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAY_STATUS = { draft: ["To issue", "wait"], issued: ["Issued, payout due", "plain"], paid: ["Paid", "good"] } as const;
const longDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const nights = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000));
const channelName = (channel?: string | null) => channel ? CHANNEL_LABEL[channel as GuestChannel] ?? readableStage(channel) : "";

function kindsOf(entries: CalendarEntry[]) {
  const counts = new Map<EntryKind, number>();
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + (e.kind === "payment" ? e.payments?.length ?? 1 : 1));
  return ENTRY_KINDS.filter(k => counts.has(k)).map(k => [k, counts.get(k)!] as const);
}

function DayCell({ p, date, inMonth, isToday, isSelected, entries, roomy, first, onPress }: { p: Palette; date: string; inMonth: boolean; isToday: boolean; isSelected: boolean; entries: CalendarEntry[]; roomy: boolean; first: boolean; onPress: () => void }) {
  const kinds = kindsOf(entries);
  const colour = (k: EntryKind) => KIND_COLOUR[k][p.isDark ? "dark" : "light"];
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${longDate(date)}, ${kinds.length ? kinds.map(([k, n]) => kindCount(k, n)).join(", ") : "nothing scheduled"}`} onPress={onPress}
      style={{ flex: 1, minWidth: 0, minHeight: roomy ? 104 : 58, borderLeftWidth: first ? 0 : 1, borderColor: p.border, backgroundColor: isSelected ? p.wash : "transparent", padding: roomy ? 6 : 3, gap: roomy ? 4 : 3, alignItems: roomy ? "stretch" : "center", opacity: inMonth || isSelected ? 1 : 0.55 }}>
      <View style={{ width: roomy ? 26 : 24, height: roomy ? 26 : 24, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? p.primary : "transparent", borderWidth: isSelected && !isToday ? 1.5 : 0, borderColor: p.primary }}>
        <Text style={{ color: isToday ? p.onPrimary : p.text, fontSize: 12, fontWeight: isToday || isSelected ? "800" : "500", fontVariant: ["tabular-nums"] }}>{Number(date.slice(8))}</Text>
      </View>
      {roomy ? <>
        {kinds.slice(0, 3).map(([k, n]) => (
          <View key={k} style={[ui.row, { gap: 5, minWidth: 0 }]}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour(k) }} />
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, flexShrink: 1 }}>{kindCount(k, n)}</Text>
          </View>
        ))}
        {kinds.length > 3 && <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>+{kinds.length - 3} more</Text>}
      </> : !!kinds.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 3, maxWidth: 30 }}>
          {kinds.slice(0, 4).map(([k]) => <View key={k} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour(k) }} />)}
        </View>
      )}
    </MotionPress>
  );
}

function Fact({ p, icon, label, value }: { p: Palette; icon: IconName; label: string; value: string }) {
  return (
    <View style={[ui.row, { gap: 12, paddingVertical: 2 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon} size={16} color={p.text} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
        <Text selectable style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{value}</Text>
      </View>
    </View>
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setError("Enter the date as YYYY-MM-DD."); return; }
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
      <Field label="Date (YYYY-MM-DD)" value={day} onChange={setDay} p={p} placeholder={entry.date} />
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

export function LiveCalendar({ palette: p, account, work, desktop, onOpenWork, onOpenView }: { palette: Palette; account: WorkspaceAccount; work: OperationView[]; desktop: boolean; onOpenWork: (item: OperationView) => void; onOpenView?: (view: WorkView, sub?: string) => void }) {
  const { width } = useWindowDimensions();
  const roomy = width >= 700;
  const today = london(new Date());
  const [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState(today);
  const [team, setTeam] = useState<Team | "all">("all"), [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [schedule, setSchedule] = useState<CalendarSchedule | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [open, setOpen] = useState<CalendarEntry | null>(null);
  const grid = useMemo(() => monthGrid(month), [month]);
  const latest = useRef(0);
  // The six weeks on screen (42 days, inside the schedule's 62-day limit). A slower, older read never
  // replaces a newer one.
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true); setError("");
    try {
      const parsed = calendarScheduleSchema.parse((await readTeams({ section: "schedule", from: grid.from, to: grid.to })).data);
      if (ticket === latest.current) setSchedule(parsed);
    } catch (e) { if (ticket === latest.current) setError(message(e)); }
    finally { if (ticket === latest.current) setLoading(false); }
  }, [grid.from, grid.to]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const entries = useMemo(() => schedule ? calendarEntries(schedule) : [], [schedule]);
  const teams = calendarTeamsFor(account.role);
  const people = useMemo(() => {
    if (!canPickPerson(account.role)) return [];
    const list = calendarPeople(entries);
    return person && !list.some(([id]) => id === person.id) ? [...list, [person.id, person.name] as [string, string]] : list;
  }, [account.role, entries, person]);
  const shown = useMemo(() => filterEntries(entries, teams.length > 1 ? team : "all", person?.id ?? null), [entries, teams.length, team, person]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of shown) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [shown]);
  const ops = useMemo(() => new Map(work.map(w => [w.workId, w])), [work]);
  const dayEntries = byDay.get(selected) ?? [];
  const monthKinds = kindsOf(shown.filter(e => e.date.startsWith(month)));
  const move = (step: number) => { const next = shiftMonth(month, step); setMonth(next); setSelected(today.startsWith(next) ? today : next + "-01"); };
  const colour = (k: EntryKind) => KIND_COLOUR[k][p.isDark ? "dark" : "light"];
  const who = (e: CalendarEntry) => e.personId === account.userId ? "You" : e.personName ?? "Not assigned yet";
  const detailOf = (e: CalendarEntry) => e.stay ? [e.propertyName, e.stay.guests ? `${e.stay.guests} guests` : "", channelName(e.stay.channel)].filter(Boolean).join(" · ")
    : e.payments ? `${e.propertyName} · ${paymentSummary(e.payments)}`
    : [timeRange(e.time, e.endTime), e.propertyName, who(e)].filter(Boolean).join(" · ");
  const canChat = account.role !== "client" && account.role !== "accounts";
  const canTime = account.role !== "client" && account.role !== "cleans";

  const header = (
    <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
      <View style={[ui.row, { gap: 8, flexShrink: 1 }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel="Go to today" onPress={() => { setMonth(today.slice(0, 7)); setSelected(today); }} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Today</Text>
        </MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => move(-1)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel="Next month" onPress={() => move(1)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
        <SwapIn swapKey={month}><Text accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: p.text, fontSize: 18, fontWeight: "700", marginLeft: 4 }}>{monthLabel(month)}</Text></SwapIn>
      </View>
      <View style={[ui.row, { gap: 8 }]}>
        {loading && <ActivityIndicator accessibilityLabel="Loading the calendar" color={p.primary} />}
        <MotionPress accessibilityRole="button" accessibilityLabel="Refresh the calendar" disabled={loading} onPress={() => void load()} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}><Feather name="refresh-cw" size={16} color={p.text} /></MotionPress>
      </View>
    </View>
  );

  const monthView = (
    <SwapIn swapKey={month + team + (person?.id ?? "")}>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, overflow: "hidden", backgroundColor: p.surface }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: p.border }}>
          {WEEKDAYS.map(name => <Text key={name} accessibilityElementsHidden importantForAccessibility="no" style={{ flex: 1, textAlign: "center", paddingVertical: 8, color: p.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>{roomy ? name : name.slice(0, 1)}</Text>)}
        </View>
        {grid.weeks.map((days, row) => (
          <View key={days[0]} style={{ flexDirection: "row", borderTopWidth: row ? 1 : 0, borderColor: p.border }}>
            {days.map((date, col) => <DayCell key={date} p={p} date={date} first={col === 0} inMonth={date.startsWith(month)} isToday={date === today} isSelected={date === selected} entries={byDay.get(date) ?? []} roomy={roomy} onPress={() => setSelected(date)} />)}
          </View>
        ))}
      </View>
      {!!monthKinds.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 10 }}>
          {monthKinds.map(([k, n]) => (
            <View key={k} style={[ui.row, { gap: 6 }]}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: colour(k) }} />
              <Text style={[ui.small, { color: p.muted }]}>{kindCount(k, n)}</Text>
            </View>
          ))}
        </View>
      )}
    </SwapIn>
  );

  const agenda = (
    <SwapIn swapKey={selected + team + (person?.id ?? "")} style={{ gap: 10 }}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "700", flex: 1, minWidth: 0 }}>{longDate(selected)}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{dayEntries.length ? `${dayEntries.length} on this day` : ""}</Text>
      </View>
      {!!person && <Text style={[ui.small, { color: p.muted }]}>{person.name}’s day</Text>}
      {dayEntries.length ? (
        <View style={{ borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
          {dayEntries.map((e, i) => {
            const done = e.status === "completed", unassigned = !!e.work && !e.personId && e.kind === "clean" && account.role !== "cleans";
            return (
              <MotionPress key={e.id} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={`${KIND_LABEL[e.kind]}: ${e.title}, ${detailOf(e)}${done ? ", done" : ""}`} onPress={() => setOpen(e)}
                style={[ui.row, { gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: p.border, alignItems: "center" }]}>
                <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: colour(e.kind) }} />
                <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: p.background, alignItems: "center", justifyContent: "center" }}><Feather name={KIND_ICON[e.kind]} size={16} color={colour(e.kind)} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600", textDecorationLine: done ? "line-through" : "none" }}>{e.title}</Text>
                  <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{detailOf(e)}</Text>
                </View>
                {done ? <Tag label="Done" tone="good" p={p} /> : unassigned ? <Tag label="Unassigned" tone="wait" p={p} /> : null}
                <Feather name="chevron-right" size={17} color={p.muted} />
              </MotionPress>
            );
          })}
        </View>
      ) : (
        <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="sun" size={16} color={p.muted} />
          <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{loading && !schedule ? "Loading this day…" : person ? `Nothing for ${person.name} on this day.` : "Nothing on this day. Pick another date to see what is booked."}</Text>
        </View>
      )}
    </SwapIn>
  );

  const op = open?.work ? ops.get(open.work.workId) : undefined;
  return (
    <View style={{ gap: 16 }}>
      <PageHeading palette={p} title="Calendar" subtitle="Tap a day to see what is happening, then an entry for its details." />
      {teams.length > 1 && <Pills p={p} values={["all", ...teams] as (Team | "all")[]} value={team} onChange={setTeam} label={v => v === "all" ? "All teams" : TEAM_LABEL[v]} />}
      {people.length > 0 && <SearchPicker p={p} value={person?.id ?? ""} onChange={id => setPerson(id ? { id, name: people.find(([x]) => x === id)?.[1] ?? "" } : null)}
        fixed={[{ id: "", label: "Everyone" }]} options={people.map(([id, name]) => ({ id, label: name }))} placeholder="Search the team by name" nouns="people" />}
      {header}
      {!!error && <View style={{ gap: 8 }}><Notice text={error} p={p} tone="bad" /><Button label="Try again" icon="refresh-cw" p={p} onPress={() => void load()} /></View>}
      {desktop ? (
        <View style={{ flexDirection: "row", gap: 20, alignItems: "flex-start" }}>
          <View style={{ flex: 1.7, minWidth: 0 }}>{monthView}</View>
          <View style={{ flex: 1, minWidth: 300 }}>{agenda}</View>
        </View>
      ) : <>{monthView}{agenda}</>}

      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `${longDate(open.date)} · ${KIND_LABEL[open.kind]}` : undefined} icon={open ? KIND_ART[open.kind] : "calendar"}>
        {open?.work && <>
          <Fact p={p} icon={KIND_ICON[open.kind]} label="Type" value={open.kind === "work" && open.work.kind ? readableStage(open.work.kind) : KIND_LABEL[open.kind]} />
          <Fact p={p} icon="home" label="Property" value={open.propertyName} />
          <Fact p={p} icon="clock" label="Time" value={timeRange(open.time, open.endTime) ?? "Any time"} />
          <Fact p={p} icon="user" label="Assigned to" value={who(open)} />
          <Fact p={p} icon="activity" label="Status" value={readableStage(open.work.status)} />
          <Fact p={p} icon="users" label="Team" value={TEAM_LABEL[open.team]} />
          {op ? <Button label="Open" icon="arrow-right" primary p={p} onPress={() => { setOpen(null); onOpenWork(op); }} />
            : <Text style={[ui.small, { color: p.muted }]}>{open.status === "completed" ? "This is done. Its record stays on the calendar." : "Its full details open from Work → All work."}</Text>}
          {canTime && !["completed", "cancelled", "declined"].includes(open.work.status) && <WorkTimeEditor key={open.id + ":" + open.work.version} p={p} entry={open} onSaved={async () => { setOpen(null); await load(); }} />}
          {canChat && <PropertyTeamChatButton palette={p} propertyId={open.propertyId} workId={open.work.workId} />}
        </>}
        {open?.stay && <>
          <Fact p={p} icon="home" label="Property" value={open.propertyName} />
          <Fact p={p} icon="log-in" label="Guests arrive" value={longDate(open.stay.checkIn)} />
          <Fact p={p} icon="log-out" label="Guests leave" value={longDate(open.stay.checkOut)} />
          <Fact p={p} icon="moon" label="Nights" value={String(nights(open.stay.checkIn, open.stay.checkOut))} />
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
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700" }}>{x.propertyName}</Text>
                  <Text style={[ui.small, { color: p.muted }]}>Statement for {periodLabel(x.period)}{x.reference ? ` · ${x.reference}` : ""}</Text>
                  <Tag label={PAY_STATUS[x.status][0]} tone={PAY_STATUS[x.status][1]} p={p} />
                </View>
                <Text style={{ color: x.payoutMinor < 0 ? p.danger : p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(x.payoutMinor)}</Text>
              </View>
            ))}
          </View>
          {onOpenView && workViewsFor(account.role).includes("accounts") && <Button label="Open statements" icon="arrow-right" primary p={p} onPress={() => { setOpen(null); onOpenView("accounts", "statements"); }} />}
        </>}
      </Sheet>
    </View>
  );
}
