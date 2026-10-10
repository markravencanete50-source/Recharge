import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SearchPicker } from "./SearchPicker";
import { MotionPress } from "./motion";
import { Button, Field, Loading, message, Notice, Tag, london, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { Chip, SheetTable, cellText } from "./SheetTable";
import { useSaved } from "./Celebrate";
import { exportReport } from "./exportReport";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { DEPARTMENT_LABEL } from "../../lib/hub";
import {
  DEPARTMENTS, RESPONSIBILITY_FREQUENCIES, ROTA_SHIFTS, responsibilitiesSchema, rotaPlanSchema, timesheetSchema,
  type Responsibilities, type Responsibility, type RotaPlan, type Timesheet, type TimesheetPerson,
} from "../../lib/workspace-teams-policy";
import {
  FREQUENCY_LABEL, ROTA_HOURS, ROTA_LABEL, dayLabel, londonClock, londonInstant, minutesLabel, mondayOf, rotaCell, shiftWeek, timesheetCsv, timesheetRows,
  timesheetSummary, validClock, weekOf, type TimesheetRow,
} from "../../lib/team-time";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Who does what (the responsibilities register), who works when (the rota by date) and the hours
// actually clocked (timesheets), as rows in the hub.
type Department = (typeof DEPARTMENTS)[number];
type RotaShift = (typeof ROTA_SHIFTS)[number];
const isAdmin = (role: string) => role === "admin" || role === "super_admin";
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function WeekNav({ p, label, onMove, onToday }: { p: Palette; label: string; onMove: (step: number) => void; onToday: () => void }) {
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[["all", "Everything"], ["mine", "Mine"], ...departments.map(d => [d, DEPARTMENT_LABEL[d]])].map(([key, label]) => <Chip key={key} p={p} label={label} on={filter === key} onPress={() => setFilter(key)} />)}
        </View>
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
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<RotaPlan["people"][number] | null>(null);
  const days = useMemo(() => weekOf(monday), [monday]);
  const load = useCallback(async () => {
    try { setPlan(rotaPlanSchema.parse((await readTeams({ section: "rotaPlan", from: days[0], to: days[6] })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [days]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setPlan(null); void load(); } }); return () => { active = false; }; }, [load]);
  const rows = (plan?.people ?? []).slice().sort((a, b) => Number(b.userId === account.userId) - Number(a.userId === account.userId));
  return (
    <View style={{ gap: 12 }}>
      <Text style={[ui.small, { color: p.muted }]}>Who is working each day: early is 8am–4pm, late is 3pm–11pm.{plan?.canEdit ? " Tap someone to plan their week." : ""}</Text>
      <WeekNav p={p} label={weekLabel(monday)} onMove={step => setMonday(shiftWeek(monday, step))} onToday={() => setMonday(mondayOf(today))} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!plan && !error && <Loading p={p} />}
      {plan && <SheetTable p={p} rows={rows} keyOf={r => r.userId} onRow={plan.canEdit ? r => setEditing(r) : undefined} empty="No one on the team yet."
        columns={[
          { label: "Person", width: 150, cell: r => <View style={{ gap: 2 }}>{cellText(p, r.userId === account.userId ? "You" : r.fullName || "Team member", true)}<Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{r.department ? DEPARTMENT_LABEL[r.department] : "No department"}</Text></View> },
          ...days.map(day => ({ label: dayLabel(day) + (day === today ? " · today" : ""), width: 96, cell: (r: RotaPlan["people"][number]) => {
            const cell = rotaCell(r, day);
            return cell ? <View style={{ gap: 2, alignItems: "flex-start" }}><Tag label={ROTA_LABEL[cell.shift]} tone={SHIFT_TONE[cell.shift]} p={p} />{!!cell.note && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{cell.note}</Text>}</View> : cellText(p, null);
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
type ShiftTarget = { person: TimesheetPerson; shift?: TimesheetPerson["days"][number]["shifts"][number]; day?: string };

export function TimesheetTab({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const saved = useSaved();
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
      <Text style={[ui.small, { color: p.muted }]}>Hours clocked in and out each day, next to the rota.{admin ? " Tap someone to see their days, correct a shift or add one they forgot." : ""}</Text>
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
        {chosen && <PersonDays p={p} person={chosen} today={today} onShift={(shift, day) => setEditing({ person: chosen, shift, day })} />}
        {chosen && <Button label="Add a shift they forgot" icon="plus" p={p} onPress={() => setEditing({ person: chosen })} />}
      </Sheet>
      {/* One sheet at a time: their days step aside while a shift is corrected, then come back. */}
      <ShiftSheet p={p} target={editing} today={today} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await load(); })} />
    </View>
  );
}

function PersonDays({ p, person, today, onShift }: { p: Palette; person: TimesheetPerson; today: string; onShift?: (shift: TimesheetPerson["days"][number]["shifts"][number], day: string) => void }) {
  type Shift = TimesheetPerson["days"][number]["shifts"][number];
  const rows = timesheetRows(person, today).flatMap((d): { key: string; d: TimesheetRow; s: Shift | null; first: boolean }[] =>
    d.shifts.length ? d.shifts.map((s, i) => ({ key: s.id, d, s, first: i === 0 })) : [{ key: d.day, d, s: null, first: true }]);
  return (
    <View style={{ gap: 8 }}>
      <SheetTable p={p} rows={rows} keyOf={r => r.key} onRow={onShift ? r => { if (r.s) onShift(r.s, r.d.day); } : undefined} empty="Nothing clocked or planned in this period."
        columns={[
          { label: "Day", width: 100, cell: r => cellText(p, r.first ? dayLabel(r.d.day) : "", true) },
          { label: "Rota", width: 90, cell: r => r.first && r.d.planned ? <Tag label={ROTA_LABEL[r.d.planned.shift]} tone={SHIFT_TONE[r.d.planned.shift]} p={p} /> : cellText(p, null) },
          { label: "In", width: 60, cell: r => cellText(p, r.s ? londonClock(r.s.clockedInAt) : null) },
          { label: "Out", width: 60, cell: r => cellText(p, r.s ? (r.s.clockedOutAt ? londonClock(r.s.clockedOutAt) : "On shift") : null) },
          { label: "Hours", width: 80, cell: r => cellText(p, r.s ? minutesLabel(r.s.minutes) : null) },
          { label: "", width: 120, cell: r => r.d.missed ? <Tag label="Not clocked" tone="bad" p={p} /> : r.s?.edited ? <Tag label="Corrected" tone="wait" p={p} /> : r.first && r.d.unplanned ? <Tag label="Not on rota" tone="plain" p={p} /> : null },
        ]} />
      <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>Total {minutesLabel(person.totalMinutes)}</Text>
    </View>
  );
}

// Correcting a shift (or adding a forgotten one): UK times; an end before the start means after midnight.
function ShiftSheet({ p, target, today, onClose, onSaved }: { p: Palette; target: ShiftTarget | null; today: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const shift = target?.shift;
  const [day, setDay] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [department, setDepartment] = useState<Department>("guest_relations"), [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(target ? [shift?.id ?? "add:" + target.person.userId, day, from, to, department, why].join(":") : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !target) return;
      setDay(target.day ?? today); setFrom(shift ? londonClock(shift.clockedInAt) : ""); setTo(shift?.clockedOutAt ? londonClock(shift.clockedOutAt) : "");
      setDepartment((shift?.department ?? target.person.department ?? "guest_relations") as Department); setWhy(""); setError("");
    });
    return () => { active = false; };
  }, [target, shift, today]);
  async function save() {
    if (!target || busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setError("Enter the date as YYYY-MM-DD."); return; }
    if (!validClock(from) || (to && !validClock(to))) { setError("Enter times as HH:MM, for example 08:00."); return; }
    if (!to && !(shift && !shift.clockedOutAt)) { setError("Add when the shift ended."); return; }
    if (why.trim().length < 3) { setError("Say why it changed, for example “Forgot to clock out”."); return; }
    const clockedInAt = londonInstant(day, from);
    const clockedOutAt = to ? londonInstant(to <= from ? addDays(day, 1) : day, to) : null;
    setBusy(true); setError("");
    try {
      if (shift) await writeTeams({ action: "editShift", requestId: request.get(), shiftId: shift.id, clockedInAt, clockedOutAt, department, note: why.trim() });
      else await writeTeams({ action: "addShift", requestId: request.get(), userId: target.person.userId, clockedInAt, clockedOutAt: clockedOutAt!, department, note: why.trim() });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={shift ? "Correct this shift" : "Add a shift"} subtitle={target?.person.fullName || undefined} icon="hourglass">
      {!!shift?.editNote && <Notice text={`Changed before: ${shift.editNote}`} p={p} />}
      <Field label="Date (YYYY-MM-DD)" value={day} onChange={setDay} p={p} placeholder={today} />
      <Field label="Clocked in (HH:MM)" value={from} onChange={setFrom} p={p} placeholder="08:00" />
      <Field label={shift && !shift.clockedOutAt ? "Clocked out (HH:MM, leave empty if still on shift)" : "Clocked out (HH:MM)"} value={to} onChange={setTo} p={p} placeholder="16:00" />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Department</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{DEPARTMENTS.map(d => <Chip key={d} p={p} label={DEPARTMENT_LABEL[d]} on={department === d} onPress={() => setDepartment(d)} />)}</View>
      <Field label="Why it changed" value={why} onChange={setWhy} p={p} placeholder="Forgot to clock out" />
      <Text style={[ui.small, { color: p.muted }]}>UK time. An end time earlier than the start counts as after midnight. They are told their timesheet was corrected.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : shift ? "Save the correction" : "Add the shift"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}
