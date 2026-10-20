import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SearchPicker } from "./SearchPicker";
import { MotionPress } from "./motion";
import { Button, Field, Loading, message, Notice, Tag, london, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { Chip, SheetTable, cellText } from "./SheetTable";
import { Pills } from "./Pills";
import { useCelebrate, useSaved } from "./Celebrate";
import { exportReport } from "./exportReport";
import { DateField } from "./CalendarPicker";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { DEPARTMENT_LABEL } from "../../lib/hub";
import {
  DEPARTMENTS, RESPONSIBILITY_FREQUENCIES, ROTA_SHIFTS, responsibilitiesSchema, rotaPlanSchema, timesheetSchema,
  type Responsibilities, type Responsibility, type RotaPlan, type ShiftChange, type Timesheet, type TimesheetPerson,
} from "../../lib/workspace-teams-policy";
import { describeChange } from "../../lib/productivity";
import {
  FREQUENCY_LABEL, ROTA_HOURS, ROTA_LABEL, dayLabel, londonClock, londonInstant, minutesLabel, mondayOf, rotaCell, shiftWeek, timesheetCsv, timesheetRows,
  timesheetSummary, validClock, weekOf, type TimesheetRow,
} from "../../lib/team-time";
import { COUNTED_UNTIL_CORRECTED, LONG_SHIFT_HOURS, LONG_SHIFT_QUESTION, MAX_SHIFT_HOURS, NOT_CLOCKED_OUT, checkShiftTimes, fullStamp, shiftEnds, ukDayOf } from "../../lib/shift-hours";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { actualsByPerson, rotaActuals } from "../../lib/rota-actuals";

// Who does what (the responsibilities register), who works when (the rota by date) and the hours
// actually clocked (timesheets), as rows in the hub.
type Department = (typeof DEPARTMENTS)[number];
type RotaShift = (typeof ROTA_SHIFTS)[number];
const isAdmin = (role: string) => role === "admin" || role === "super_admin";
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function WeekNav({ p, label, onMove, onToday }: { p: Palette; label: string; onMove: (step: number) => void; onToday: () => void }) {
  const round = { width: 44, height: 44, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: p.elevated };
  return (
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <MotionPress accessibilityRole="button" accessibilityLabel="Back to now" onPress={onToday} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
        <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Now</Text>
      </MotionPress>
      <MotionPress accessibilityRole="button" accessibilityLabel="Earlier" onPress={() => onMove(-1)} style={round}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
      <MotionPress accessibilityRole="button" accessibilityLabel="Later" onPress={() => onMove(1)} style={round}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: p.text, fontSize: 16, fontWeight: "700", marginLeft: 4 }}>{label}</Text>
    </View>
  );
}
const weekLabel = (monday: string) => `${dayLabel(monday)} – ${dayLabel(addDays(monday, 6))}`;

// ---------------------------------------------------------------- responsibilities
export function ResponsibilitiesTab({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const saved = useSaved();
  const [data, setData] = useState<Responsibilities | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ item?: Responsibility } | null>(null);
  const load = useCallback(async () => {
    try { setData(responsibilitiesSchema.parse((await readTeams({ section: "responsibilities" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const departments = useMemo(() => DEPARTMENTS.filter(d => data?.items.some(i => i.department === d)), [data]);
  const rows = (data?.items ?? []).filter(i => filter === "all" ? true : filter === "mine" ? i.ownerId === account.userId || i.backupId === account.userId : i.department === filter);
  const mine = (data?.items ?? []).filter(i => i.ownerId === account.userId).length;
  return (
    <View style={{ gap: 12 }}>
      <Text style={[ui.small, { color: p.muted }]}>Who looks after each part of the business, and who covers when they are away.{mine ? ` You own ${mine}.` : ""}</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!data && !error && <Loading p={p} />}
      {data && <>
        {/* Everything, Mine and each department: more than five, so the shared Pills shows a dropdown (E's round 9 review). */}
        <Pills p={p} title="Show" values={["all", "mine", ...departments]} value={filter} onChange={setFilter} label={key => key === "all" ? "Everything" : key === "mine" ? "Mine" : DEPARTMENT_LABEL[key as typeof departments[number]]} />
        {data.canEdit && <Button label="Add a responsibility" icon="plus" primary p={p} onPress={() => setEditing({})} />}
        <SheetTable p={p} rows={rows} keyOf={r => r.id} onRow={r => setEditing({ item: r })} empty={data.canEdit ? "Nothing in the register yet. Add each regular duty and who owns it." : "Nothing here yet. Management keeps this register."}
          columns={[
            { label: "Responsibility", width: 230, cell: r => cellText(p, r.title, true) },
            { label: "Who", width: 130, cell: r => r.ownerName ? cellText(p, r.ownerId === account.userId ? "You" : r.ownerName) : <Tag label="Nobody yet" tone="wait" p={p} /> },
            { label: "Backup", width: 120, cell: r => cellText(p, r.backupId === account.userId ? "You" : r.backupName) },
            { label: "How often", width: 100, cell: r => cellText(p, FREQUENCY_LABEL[r.frequency]) },
            { label: "Department", width: 130, cell: r => cellText(p, DEPARTMENT_LABEL[r.department]) },
          ]} />
      </>}
      <ResponsibilitySheet p={p} data={data} target={editing} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await load(); })} />
    </View>
  );
}

function ResponsibilitySheet({ p, data, target, onClose, onSaved }: { p: Palette; data: Responsibilities | null; target: { item?: Responsibility } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const item = target?.item;
  const [title, setTitle] = useState(""), [details, setDetails] = useState("");
  const [department, setDepartment] = useState<Department>("management"), [frequency, setFrequency] = useState<Responsibility["frequency"]>("weekly");
  const [owner, setOwner] = useState(""), [backup, setBackup] = useState("");
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(target ? [item?.id ?? "new", item?.version ?? 0, title, details, department, frequency, owner, backup].join(":") : null);
  const remove = useRequestId(item ? "remove:" + item.id + ":" + item.version : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setTitle(item?.title ?? ""); setDetails(item?.details ?? ""); setDepartment(item?.department ?? "management"); setFrequency(item?.frequency ?? "weekly");
      setOwner(item?.ownerId ?? ""); setBackup(item?.backupId ?? ""); setConfirm(false); setError("");
    });
    return () => { active = false; };
  }, [item, target]);
  const editable = !!data?.canEdit;
  async function save() {
    if (busy) return;
    if (title.trim().length < 2) { setError("Say what the responsibility is."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "saveResponsibility", requestId: request.get(), ...(item ? { id: item.id, version: item.version } : {}), department, title: title.trim(), details: details.trim(),
        ownerId: owner || null, backupId: backup || null, frequency });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function drop() {
    if (!item || busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "removeResponsibility", requestId: remove.get(), id: item.id, version: item.version }); remove.done(); await onSaved(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const people = data?.people ?? [];
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={item ? item.title : "New responsibility"} subtitle={item ? `${DEPARTMENT_LABEL[item.department]} · ${FREQUENCY_LABEL[item.frequency]}` : "A regular duty and who owns it"} icon="clipboard">
      {editable ? <>
        <Field label="Responsibility" value={title} onChange={setTitle} p={p} placeholder="Check every listing is live each morning" />
        <Field label="Details (optional)" value={details} onChange={setDetails} p={p} multiline />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Department</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{DEPARTMENTS.map(d => <Chip key={d} p={p} label={DEPARTMENT_LABEL[d]} on={department === d} onPress={() => setDepartment(d)} />)}</View>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>How often</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{RESPONSIBILITY_FREQUENCIES.map(f => <Chip key={f} p={p} label={FREQUENCY_LABEL[f]} on={frequency === f} onPress={() => setFrequency(f)} />)}</View>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Who owns it</Text>
        <SearchPicker p={p} value={owner} onChange={id => { setOwner(id); if (backup === id) setBackup(""); }} clearable placeholder="Search the team by name" nouns="people"
          options={people.map(x => ({ id: x.userId, label: x.fullName || "Team member" }))} />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Backup (optional)</Text>
        <SearchPicker p={p} value={backup} onChange={setBackup} clearable placeholder="Search the team by name" nouns="people"
          options={people.filter(x => x.userId !== owner).map(x => ({ id: x.userId, label: x.fullName || "Team member" }))} />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : item ? "Save changes" : "Add to the register"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
        {item && (confirm
          ? <Button label={busy ? "Removing…" : "Yes, remove it from the register"} icon="trash-2" p={p} disabled={busy} onPress={() => void drop()} />
          : <Button label="Remove" icon="trash-2" p={p} disabled={busy} onPress={() => setConfirm(true)} />)}
      </> : item && <View style={{ gap: 8 }}>
        {!!item.details && <Text selectable style={{ color: p.text }}>{item.details}</Text>}
        <Text style={{ color: p.text }}>Owned by {item.ownerName ?? "nobody yet"}{item.backupName ? `, with ${item.backupName} as backup` : ""}.</Text>
        <Text style={[ui.small, { color: p.muted }]}>Management keeps this register. Ask an admin to change it.</Text>
      </View>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- rota
const SHIFT_TONE: Record<RotaShift, "good" | "wait" | "plain" | "bad"> = { early: "good", late: "plain", both: "wait", off: "bad" };
export function RotaTab({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const saved = useSaved();
  const today = london(new Date());
  const [monday, setMonday] = useState(mondayOf(today));
  const [plan, setPlan] = useState<RotaPlan | null>(null);
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<RotaPlan["people"][number] | null>(null);
  const days = useMemo(() => weekOf(monday), [monday]);
  const load = useCallback(async () => {
    // The clock in and out times come from the timesheet (the same read the Timesheets tab uses);
    // if that read fails the rota still shows, just without the actual times.
    const [planned, clocked] = await Promise.allSettled([readTeams({ section: "rotaPlan", from: days[0], to: days[6] }), readTeams({ section: "timesheet", from: days[0], to: days[6] })]);
    try { setSheet(clocked.status === "fulfilled" ? timesheetSchema.parse(clocked.value.data) : null); } catch { setSheet(null); }
    try { if (planned.status === "rejected") throw planned.reason; setPlan(rotaPlanSchema.parse(planned.value.data)); setError(""); } catch (e) { setError(message(e)); }
  }, [days]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setPlan(null); void load(); } }); return () => { active = false; }; }, [load]);
  const rows = (plan?.people ?? []).slice().sort((a, b) => Number(b.userId === account.userId) - Number(a.userId === account.userId));
  const clocked = useMemo(() => actualsByPerson(sheet), [sheet]);
  const now = new Date();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[ui.small, { color: p.muted }]}>Who is working each day: early is 8am–4pm, late is 3pm–11pm. Under each day are the times actually clocked in and out (UK time).{plan?.canEdit ? " Tap someone to plan their week." : ""}</Text>
      <WeekNav p={p} label={weekLabel(monday)} onMove={step => setMonday(shiftWeek(monday, step))} onToday={() => setMonday(mondayOf(today))} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!plan && !error && <Loading p={p} />}
      {plan && <SheetTable p={p} rows={rows} keyOf={r => r.userId} onRow={plan.canEdit ? r => setEditing(r) : undefined} empty="No one on the team yet."
        columns={[
          { label: "Person", width: 150, cell: r => <View style={{ gap: 2 }}>{cellText(p, r.userId === account.userId ? "You" : r.fullName || "Team member", true)}<Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{r.department ? DEPARTMENT_LABEL[r.department] : "No department"}</Text></View> },
          ...days.map(day => ({ label: dayLabel(day) + (day === today ? " · today" : ""), width: 150, cell: (r: RotaPlan["people"][number]) => {
            const cell = rotaCell(r, day);
            const actual = rotaActuals(clocked.get(r.userId), day, now);
            if (!cell && !actual.length) return cellText(p, null);
            return <View style={{ gap: 2, alignItems: "flex-start" }}>
              {cell && <Tag label={ROTA_LABEL[cell.shift]} tone={SHIFT_TONE[cell.shift]} p={p} />}
              {!!cell?.note && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{cell.note}</Text>}
              {actual.map(a => <Text key={a.id} numberOfLines={2} style={[ui.small, { color: a.state === "closed" ? p.text : a.state === "open" ? p.success : p.waiting, fontWeight: a.state === "closed" ? "400" : "700", fontVariant: ["tabular-nums"] }]}>{a.text}</Text>)}
            </View>;
          } })),
        ]} />}
      <RotaWeekSheet p={p} person={editing} days={days} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await load(); })} />
    </View>
  );
}

function RotaWeekSheet({ p, person, days, onClose, onSaved }: { p: Palette; person: RotaPlan["people"][number] | null; days: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [week, setWeek] = useState<Record<string, RotaShift | null>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(person ? [person.userId, ...days.map(d => (week[d] ?? "-") + (note[d] ?? ""))].join(":") : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !person) return;
      setWeek(Object.fromEntries(days.map(d => [d, rotaCell(person, d)?.shift ?? null])));
      setNote(Object.fromEntries(days.map(d => [d, rotaCell(person, d)?.note ?? ""])));
      setError("");
    });
    return () => { active = false; };
  }, [person, days]);
  const usual = person?.usualShift ?? null;
  async function save() {
    if (!person || busy) return;
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "planRota", requestId: request.get(), userId: person.userId, days: days.map(d => ({ day: d, shift: week[d] ?? null, ...(week[d] && note[d]?.trim() ? { note: note[d].trim() } : {}) })) });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!person} onClose={onClose} title={person?.fullName || "Team member"} subtitle={`Week of ${days[0] ? dayLabel(days[0]) : ""}${usual ? ` · usually ${ROTA_LABEL[usual].toLowerCase()}` : ""}`} icon="calendar">
      {usual && <Button label={`Mon–Fri ${ROTA_LABEL[usual].toLowerCase()}, weekend off`} icon="copy" p={p} onPress={() => setWeek(Object.fromEntries(days.map((d, i) => [d, i < 5 ? usual : "off"])))} />}
      {days.map(day => (
        <View key={day} style={{ gap: 6, paddingVertical: 4 }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{dayLabel(day)}{week[day] && week[day] !== "off" ? ` · ${ROTA_HOURS[week[day]!]}` : ""}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ROTA_SHIFTS.map(s => <Chip key={s} p={p} label={ROTA_LABEL[s]} on={week[day] === s} onPress={() => setWeek(w => ({ ...w, [day]: w[day] === s ? null : s }))} />)}
          </View>
          {!!week[day] && <Field label="Note (optional)" value={note[day] ?? ""} onChange={v => setNote(n => ({ ...n, [day]: v }))} p={p} placeholder={week[day] === "off" ? "Holiday" : "Covering for Sam"} />}
        </View>
      ))}
      <Text style={[ui.small, { color: p.muted }]}>Tap a chosen shift again to clear the day. They are told when their rota changes.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save the week"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- timesheets
const monthStart = (iso: string) => iso.slice(0, 7) + "-01";
const monthEnd = (first: string) => { const d = new Date(first + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
const moveMonth = (first: string, step: number) => { const d = new Date(first + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + step, 1); return d.toISOString().slice(0, 10); };
// A shift to correct, or (no shift) one to add; with no person yet, the sheet asks who it is for.
export type ShiftTarget = { person?: TimesheetPerson; shift?: TimesheetPerson["days"][number]["shifts"][number]; day?: string };

export function TimesheetTab({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const celebrate = useCelebrate();
  const today = london(new Date());
  const [span, setSpan] = useState<"week" | "month">("week");
  const [start, setStart] = useState(mondayOf(today));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [error, setError] = useState(""), [note, setNote] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShiftTarget | null>(null);
  const end = span === "week" ? addDays(start, 6) : monthEnd(start);
  const load = useCallback(async () => {
    try { setSheet(timesheetSchema.parse((await readTeams({ section: "timesheet", from: start, to: end })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [start, end]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setSheet(null); void load(); } }); return () => { active = false; }; }, [load]);
  const admin = isAdmin(account.role);
  const chosen = sheet?.people.find(x => x.userId === (admin ? person : account.userId)) ?? (!admin ? sheet?.people[0] : undefined);
  async function download() {
    if (!sheet) return;
    setNote("");
    try { await exportReport(timesheetCsv(chosen && !admin ? { ...sheet, people: [chosen] } : sheet), `Recharge-timesheet-${start}-to-${end}.csv`); setNote(Platform.OS === "web" ? "Spreadsheet downloaded." : "Spreadsheet ready to save or share."); }
    catch (e) { setError(message(e)); }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={[ui.small, { color: p.muted }]}>Hours clocked in and out each day, next to the rota.{admin ? account.role === "super_admin" ? " Tap someone to see their days, correct a shift or add one they forgot." : " Tap someone to see their days. Corrections go to a super admin for approval." : " Only management can change your hours."}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip p={p} label="Week" on={span === "week"} onPress={() => { setSpan("week"); setStart(mondayOf(today)); }} />
        <Chip p={p} label="Month" on={span === "month"} onPress={() => { setSpan("month"); setStart(monthStart(today)); }} />
      </View>
      <WeekNav p={p} label={span === "week" ? weekLabel(start) : new Date(start + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
        onMove={step => setStart(span === "week" ? shiftWeek(start, step) : moveMonth(start, step))} onToday={() => setStart(span === "week" ? mondayOf(today) : monthStart(today))} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!note && <Notice text={note} p={p} />}
      {!sheet && !error && <Loading p={p} />}
      {sheet && <>
        <Button label="Download as a spreadsheet" icon="download" p={p} onPress={() => void download()} />
        {admin && <SheetTable p={p} rows={sheet.people} keyOf={r => r.userId} onRow={r => setPerson(r.userId)} empty="No one clocked in or was on the rota."
          columns={[
            { label: "Person", width: 150, cell: r => cellText(p, (r.fullName || "Team member") + (r.active ? "" : " (left)"), true) },
            { label: "Department", width: 120, cell: r => cellText(p, r.department ? DEPARTMENT_LABEL[r.department] : null) },
            { label: "Days worked", width: 90, cell: r => cellText(p, String(timesheetSummary(r, today).daysWorked)) },
            { label: "Planned", width: 80, cell: r => cellText(p, String(timesheetSummary(r, today).plannedDays)) },
            { label: "Missed", width: 70, cell: r => { const n = timesheetSummary(r, today).missed; return n ? <Tag label={String(n)} tone="bad" p={p} /> : cellText(p, "0"); } },
            { label: "Hours", width: 90, cell: r => cellText(p, minutesLabel(r.totalMinutes), true) },
          ]} />}
        {!admin && chosen && <PersonDays p={p} person={chosen} today={today} />}
        {!admin && !chosen && <Notice text="Nothing clocked or planned in this period." p={p} />}
      </>}
      <Sheet palette={p} visible={admin && !!chosen && !editing} onClose={() => setPerson(null)} title={chosen?.fullName || "Team member"} subtitle={chosen ? `${minutesLabel(chosen.totalMinutes)} · ${span === "week" ? weekLabel(start) : "this month"}` : undefined} icon="hourglass">
        {chosen && <PersonDays p={p} person={chosen} today={today} pending={sheet?.pending ?? []} onShift={(shift, day) => setEditing({ person: chosen, shift, day })} />}
        {chosen && <Button label="Add a shift they forgot" icon="plus" p={p} onPress={() => setEditing({ person: chosen })} />}
      </Sheet>
      {/* One sheet at a time: their days step aside while a shift is corrected, then come back. */}
      <ShiftSheet p={p} target={editing} today={today} direct={account.role === "super_admin"} pending={sheet?.pending ?? []} onClose={() => setEditing(null)}
        onSaved={async status => { setEditing(null); celebrate(status === "pending" ? "Sent for approval" : "Saved"); await load(); }} />
    </View>
  );
}

export function PersonDays({ p, person, today, pending = [], onShift }: { p: Palette; person: TimesheetPerson; today: string; pending?: ShiftChange[]; onShift?: (shift: TimesheetPerson["days"][number]["shifts"][number], day: string) => void }) {
  const waiting = new Set(pending.map(c => c.shiftId));
  type Shift = TimesheetPerson["days"][number]["shifts"][number];
  const rows = timesheetRows(person, today).flatMap((d): { key: string; d: TimesheetRow; s: Shift | null; first: boolean }[] =>
    d.shifts.length ? d.shifts.map((s, i) => ({ key: d.day + ":" + s.id, d, s, first: i === 0 })) : [{ key: d.day, d, s: null, first: true }]);
  return (
    <View style={{ gap: 8 }}>
      <SheetTable p={p} rows={rows} keyOf={r => r.key} onRow={onShift ? r => { if (r.s) onShift(r.s, r.d.day); } : undefined} empty="Nothing clocked or planned in this period."
        columns={[
          { label: "Day", width: 100, cell: r => cellText(p, r.first ? dayLabel(r.d.day) : "", true) },
          { label: "Rota", width: 90, cell: r => r.first && r.d.planned ? <Tag label={ROTA_LABEL[r.d.planned.shift]} tone={SHIFT_TONE[r.d.planned.shift]} p={p} /> : cellText(p, null) },
          { label: "In", width: 90, cell: r => cellText(p, r.s ? shiftEnds(r.s).in : null) },
          { label: "Out", width: 130, cell: r => cellText(p, r.s ? shiftEnds(r.s).out : null) },
          { label: "Hours", width: 80, cell: r => cellText(p, r.s ? minutesLabel(r.s.minutes) : null) },
          { label: "", width: 140, cell: r => r.s && waiting.has(r.s.id) ? <Tag label="Change waiting" tone="wait" p={p} /> : r.d.missed ? <Tag label="Not clocked" tone="bad" p={p} /> : r.s?.stale ? <Tag label={NOT_CLOCKED_OUT} tone="wait" p={p} /> : r.s?.edited ? <Tag label="Corrected" tone="plain" p={p} /> : r.first && r.d.unplanned ? <Tag label="Not on rota" tone="plain" p={p} /> : null },
        ]} />
      <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>Total {minutesLabel(person.totalMinutes)}</Text>
      <Text style={[ui.small, { color: p.muted }]}>Each day counts only its own hours: a shift past midnight shows on both days.{rows.some(r => r.s?.stale) ? ` ${NOT_CLOCKED_OUT}: ${COUNTED_UNTIL_CORRECTED.toLowerCase()}.` : ""}</Text>
    </View>
  );
}

// Correcting a shift (or adding a forgotten one): clock in and clock out each have their own UK date and time, so
// a night shift or one over several days is plain (lib/shift-hours.ts checks them: clock out after clock in, over 16
// hours only with a yes, never over 24). Hours are locked: a super admin's change applies at once (direct); an admin's waits for a super
// admin's approval and reaches the hours only then.
export function ShiftSheet({ p, target, today, direct, people = [], pending = [], onClose, onSaved }: {
  p: Palette; target: ShiftTarget | null; today: string; direct: boolean; people?: TimesheetPerson[]; pending?: ShiftChange[];
  onClose: () => void; onSaved: (status: "pending" | "direct") => Promise<void>;
}) {
  const shift = target?.shift;
  const [who, setWho] = useState("");
  const [day, setDay] = useState(""), [from, setFrom] = useState(""), [outDay, setOutDay] = useState(""), [to, setTo] = useState("");
  const [confirmLong, setConfirmLong] = useState(false);
  const [department, setDepartment] = useState<Department>("guest_relations"), [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const person = target?.person ?? people.find(x => x.userId === who);
  const waiting = shift ? pending.find(c => c.shiftId === shift.id) : undefined;
  const request = useRequestId(target ? [shift?.id ?? "add:" + (person?.userId ?? ""), day, from, outDay, to, department, why, confirmLong].join(":") : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !target) return;
      // The shift's own dates (it may be listed on a later day it ran into), else the day chosen.
      const inDay = shift ? ukDayOf(shift.clockedInAt) : target.day ?? today;
      setWho(""); setDay(inDay); setFrom(shift ? londonClock(shift.clockedInAt) : "");
      setOutDay(shift?.clockedOutAt ? ukDayOf(shift.clockedOutAt) : inDay); setTo(shift?.clockedOutAt ? londonClock(shift.clockedOutAt) : ""); setConfirmLong(false);
      setDepartment((shift?.department ?? target.person?.department ?? "guest_relations") as Department); setWhy(""); setError("");
    });
    return () => { active = false; };
  }, [target, shift, today]);
  async function save() {
    if (!target || busy) return;
    if (!person) { setError("Choose who the shift is for."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setError("Choose the clock in date."); return; }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(outDay)) { setError("Choose the clock out date."); return; }
    if (!validClock(from) || (to && !validClock(to))) { setError("Enter times as HH:MM, for example 08:00."); return; }
    const inAt = londonInstant(day, from), outAt = to ? londonInstant(outDay, to) : null;
    const check = checkShiftTimes({ clockedInAt: inAt, clockedOutAt: outAt, confirmedLong: confirmLong, open: !!shift && !shift.clockedOutAt });
    if (check.error) { setError(check.needsConfirm ? "" : check.error); return; }
    if (why.trim().length < 3) { setError("Say why it changed, for example “Forgot to clock out”."); return; }
    const long = confirmLong && !!check.minutes && check.minutes > LONG_SHIFT_HOURS * 60 ? { confirmLong: true } : {};
    setBusy(true); setError("");
    try {
      const result = shift
        ? await writeTeams({ action: "editShift", requestId: request.get(), shiftId: shift.id, clockedInAt: inAt, clockedOutAt: outAt, department, note: why.trim(), ...long })
        : await writeTeams({ action: "addShift", requestId: request.get(), userId: person.userId, clockedInAt: inAt, clockedOutAt: outAt!, department, note: why.trim(), ...long });
      request.done();
      await onSaved((result.data as { status?: string } | null)?.status === "pending" ? "pending" : "direct");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const changed = waiting ? describeChange(waiting) : null;
  // What will be saved, with dates, checked as they type.
  const clockedInAt = /^\d{4}-\d{2}-\d{2}$/.test(day) && validClock(from) ? londonInstant(day, from) : null;
  const clockedOutAt = to && /^\d{4}-\d{2}-\d{2}$/.test(outDay) && validClock(to) ? londonInstant(outDay, to) : null;
  const preview = clockedInAt && (clockedOutAt || !to) ? checkShiftTimes({ clockedInAt, clockedOutAt, confirmedLong: confirmLong, open: !!shift && !shift.clockedOutAt }) : null;
  const askLong = !!preview?.needsConfirm || (confirmLong && !!preview?.minutes && preview.minutes > LONG_SHIFT_HOURS * 60);
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={shift ? (direct ? "Correct this shift" : "Ask to correct this shift") : direct ? "Add a shift" : "Ask to add a shift"} subtitle={person?.fullName || undefined} icon="hourglass">
      {waiting && changed ? <>
        <Notice text={`A change is already waiting for a super admin: ${changed.before ?? "no shift"} → ${changed.after}, asked by ${waiting.requestedByName ?? "an admin"} (“${waiting.note}”). Approve, decline or withdraw it in Productivity → Approvals.`} p={p} />
      </> : <>
        {!target?.person && <>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Who is it for?</Text>
          <SearchPicker p={p} options={people.map(x => ({ id: x.userId, label: x.fullName || "Team member", keywords: x.department ? DEPARTMENT_LABEL[x.department] : undefined }))} value={who} onChange={setWho} placeholder="Search the team" nouns="people" />
        </>}
        {!!shift?.editNote && <Notice text={`Changed before: ${shift.editNote}`} p={p} />}
        {!!shift && <Text style={[ui.small, { color: p.muted }]}>As it stands: in {fullStamp(shift.clockedInAt)}, out {shift.clockedOutAt ? fullStamp(shift.clockedOutAt) : shiftEnds(shift).out.toLowerCase()}.</Text>}
        <DateField p={p} label="Clock in date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today} value={{ from: day, to: day }}
          onChange={next => { setDay(next.from); if (!outDay || outDay < next.from || outDay === day) setOutDay(next.from); setConfirmLong(false); }} />
        <Field label="Clock in time (HH:MM)" value={from} onChange={v => { setFrom(v); setConfirmLong(false); }} p={p} placeholder="08:00" />
        <DateField p={p} label="Clock out date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today} value={{ from: outDay, to: outDay }} onChange={next => { setOutDay(next.from); setConfirmLong(false); }} />
        <Field label={shift && !shift.clockedOutAt ? "Clock out time (HH:MM, leave empty if still on shift)" : "Clock out time (HH:MM)"} value={to} onChange={v => { setTo(v); setConfirmLong(false); }} p={p} placeholder="16:00" />
        {!!clockedInAt && <View style={[ui.card, { backgroundColor: p.wash, borderColor: p.border, gap: 4, padding: 12 }]}>
          <Text style={[ui.small, { color: p.text, fontVariant: ["tabular-nums"] }]}>Clock in: {fullStamp(clockedInAt)}</Text>
          <Text style={[ui.small, { color: p.text, fontVariant: ["tabular-nums"] }]}>Clock out: {clockedOutAt ? fullStamp(clockedOutAt) : to ? "–" : shift && !shift.clockedOutAt ? "still open" : "–"}</Text>
          {!!preview?.minutes && <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>{minutesLabel(preview.minutes)}</Text>}
          {!!preview?.error && !preview.needsConfirm && <Text style={[ui.small, { color: p.danger, fontWeight: "700" }]}>{preview.error}</Text>}
        </View>}
        {askLong && <View style={{ gap: 8 }}>
          <Notice text={`${LONG_SHIFT_QUESTION} ${minutesLabel(preview?.minutes ?? 0)} from ${clockedInAt ? fullStamp(clockedInAt) : ""} to ${clockedOutAt ? fullStamp(clockedOutAt) : ""}.`} p={p} />
          <Chip p={p} label="Yes, that is right" on={confirmLong} onPress={() => setConfirmLong(v => !v)} />
        </View>}
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Department</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{DEPARTMENTS.map(d => <Chip key={d} p={p} label={DEPARTMENT_LABEL[d]} on={department === d} onPress={() => setDepartment(d)} />)}</View>
        <Field label="Why it changed" value={why} onChange={setWhy} p={p} placeholder="Forgot to clock out" />
        <Text style={[ui.small, { color: p.muted }]}>UK time. A shift lasts at most {MAX_SHIFT_HOURS} hours; over {LONG_SHIFT_HOURS} hours needs a yes.{direct ? " It applies straight away, and they are told their timesheet was corrected." : ""}</Text>
        {!direct && <Notice text="Clock in and out is locked. This goes to a super admin; their hours, productivity and performance change only once it is approved." p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : direct ? (shift ? "Save the correction" : "Add the shift") : "Send for approval"} icon={direct ? "check" : "send"} primary p={p} disabled={busy || (askLong && !confirmLong)} onPress={() => void save()} />
      </>}
    </Sheet>
  );
}
