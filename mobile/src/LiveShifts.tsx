import { useCallback, useEffect, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { ChoicePills } from "./ChoiceField";
import { useCelebrate, useSaved } from "./Celebrate";
import { GrowBar, MotionPress, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { Pills } from "./Pills";
import { AnalyticsPanel, PeriodBar, usePeriod } from "./AnalyticsKit";
import { teamPerformanceModel } from "../../lib/report-analytics-models";
import { readChat, readTeams, writeTeams } from "./backend/client";
import { DEPARTMENT_LABEL, departmentFor, hoursLabel, myShiftSchema, PAUSE_LABEL, PAUSE_START_KINDS, pausePolicySchema, type PauseKind, type PausePolicy, type PauseStartKind, rotaListSchema, SHIFTS, shiftName, signoffSchema, teamPerformanceSchema, type Shift, type Signoff, type TeamPerformance } from "../../lib/management-live";
import { DAILY_WORK, DEPARTMENTS } from "../../lib/workspace-teams-policy";
import { formatCount, formatDay, plural } from "../../lib/format";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { londonInstant, validClock } from "../../lib/team-time";
import { isReflectionRefusal, needsReflection } from "../../lib/reflection";
import { DayReflection } from "./DayReflection";
import { KpiAdmin } from "./KpiAdmin";
import { bonusTag, kpiReadSchema, type KpiRead } from "../../lib/kpis";

// Clocking in and out, and the team's guest reply times. Guest relations replies are timed:
// green within the green limit, amber within the amber limit, red after that.
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const sinceMinutes = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const londonDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + offset * 86400000));
const londonDayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const PAUSE_ICON = { break: "pause-circle", emergency: "alert-triangle" } as const satisfies Record<PauseStartKind, string>;

// Home: the person's own shift, with clock in and out.
export function ShiftCard({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [shift, setShift] = useState<ReturnType<typeof myShiftSchema.parse> | null>(null);
  const [department, setDepartment] = useState<string>(departmentFor(account.role));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [emergency, setEmergency] = useState(false), [note, setNote] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const celebrate = useCelebrate();
  // Keyed per shift: after a clock-out the next clock-in gets a new request, even if an earlier
  // response was lost.
  const request = useRequestId(shift ? (shift.open ? "out:" + shift.open.id : ["in", department, shift.today.at(-1)?.id ?? "first"].join(":")) : null);
  const load = useCallback(async () => {
    try { const mine = myShiftSchema.parse((await readTeams({ section: "shift" })).data); setShift(mine); if (mine.rota) setDepartment(mine.rota.department); setError(""); }
    catch { setUnavailable(true); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (unavailable) return null;
  // Some roles write an end-of-day reflection before they clock out; the others clock out as before.
  const needsReflectionNow = needsReflection(account.role);
  // Throws when the clock-out fails, so the reflection sheet can show why.
  async function clockOut() {
    await writeTeams({ action: "clockOut", requestId: request.get() });
    request.done(); celebrate("Clocked out"); await load();
  }
  async function toggle() {
    if (!shift || busy) return;
    if (shift.open && needsReflectionNow) { setError(""); setReflecting(true); return; }
    setBusy(true); setError("");
    try {
      if (shift.open) await clockOut();
      else { await writeTeams({ action: "clockIn", requestId: request.get(), department: department as never }); request.done(); celebrate("Clocked in"); await load(); }
    } catch (e) {
      // The database wants a reflection from this person after all: ask for it instead of failing.
      const text = message(e);
      if (shift.open && isReflectionRefusal(text)) setReflecting(true); else setError(text);
      await load();
    } finally { setBusy(false); }
  }
  // Pausing for a break or an emergency, going back to work, and overtime. Lunch is no longer a pause.
  async function pause(action: "startPause" | "endPause" | "startOvertime", kind?: PauseStartKind) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await writeTeams(action === "startPause" ? { action, requestId: Crypto.randomUUID(), kind: kind!, ...(note.trim() ? { note: note.trim() } : {}) } : { action, requestId: Crypto.randomUUID() });
      setEmergency(false); setNote("");
      celebrate(action === "endPause" ? "Back to work" : action === "startOvertime" ? "Overtime started" : `${PAUSE_LABEL[kind!]} started`);
      await load();
    } catch (e) { setError(message(e)); await load(); } finally { setBusy(false); }
  }
  const open = shift?.open;
  const onPause = open?.pause ?? null;
  const unpaid = (kind: PauseKind) => shift ? !({ lunch: shift.pausePolicy.lunchPaid, break: shift.pausePolicy.breakPaid, emergency: shift.pausePolicy.emergencyPaid })[kind] : false;
  // Worked so far: the time since clocking in, less pauses that don't count as paid time.
  const worked = open ? Math.max(0, sinceMinutes(open.clockedInAt) - open.unpaidMinutes) : 0;
  const score = shift && shift.responses ? Math.floor(shift.green * 100 / shift.responses) : null;
  return (
    <View style={[ui.card, { backgroundColor: open ? p.header : p.surface, borderColor: open ? p.header : p.border, gap: 12 }]}>
      <View style={[ui.between, { gap: 12, flexWrap: "wrap" }]}>
        <SwapIn swapKey={open ? "on:" + open.id : "off"} style={{ gap: 4, flexShrink: 1 }}>
          <Text style={{ color: open ? p.headerMuted : p.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>{open ? "ON SHIFT" : "YOUR SHIFT"}</Text>
          <Text style={{ color: open ? p.headerText : p.text, fontSize: 18, fontWeight: "700" }}>
            {!shift ? "Checking…" : open ? `${DEPARTMENT_LABEL[open.department] ?? open.department} · since ${time(open.clockedInAt)}` : "You’re clocked out"}
          </Text>
          {!!open && <Text style={{ color: p.headerMuted, fontSize: 13 }}>{shiftName(open.clockedInAt)} · {hoursLabel(worked)} worked so far{open.overtimeFrom ? ` · overtime since ${time(open.overtimeFrom)}` : ""}</Text>}
          {!!open && needsReflectionNow && <Text style={{ color: p.headerMuted, fontSize: 13 }}>Clocking out starts your end-of-day reflection.</Text>}
          {!!onPause && <View style={[ui.row, { gap: 8, marginTop: 2 }]}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: onPause.kind === "emergency" ? p.danger : p.waiting }} />
            <Text style={{ color: p.headerText, fontSize: 14, fontWeight: "700" }}>On {PAUSE_LABEL[onPause.kind].toLowerCase()} since {time(onPause.startedAt)} · {hoursLabel(sinceMinutes(onPause.startedAt))}{unpaid(onPause.kind) ? " (unpaid)" : ""}</Text>
          </View>}
          {!open && shift?.rota && <Text style={{ color: p.muted, fontSize: 13 }}>{DEPARTMENT_LABEL[shift.rota.department] ?? shift.rota.department} · usually {SHIFTS[shift.rota.usualShift]}</Text>}
          {score !== null && <Text style={{ color: open ? p.headerMuted : p.muted, fontSize: 13 }}>Guest replies, last 30 days: {score}% on time ({shift!.passPercent}% is on track)</Text>}
          {score !== null && <View style={{ marginTop: 4, maxWidth: 260 }}><GrowBar share={score / 100} height={6} color={score >= shift!.passPercent ? p.success : p.waiting} track={open ? p.headerBorder : p.wash} /></View>}
        </SwapIn>
        {shift ? <MotionPress accessibilityRole="button" accessibilityLabel={open ? "Clock out" : "Clock in"} disabled={busy} onPress={() => void toggle()}
          style={[ui.button, { backgroundColor: open ? p.background : p.primary, paddingHorizontal: 20 }]}>
          <Feather name={open ? "log-out" : "log-in"} size={16} color={open ? p.text : p.onPrimary} />
          <Text style={[ui.buttonText, { color: open ? p.text : p.onPrimary }]}>{busy ? "Saving…" : open ? "Clock out" : "Clock in"}</Text>
        </MotionPress> : <Loading p={p} />}
      </View>
      {!!open && (onPause
        ? <MotionPress accessibilityRole="button" accessibilityLabel="Back to work" disabled={busy} onPress={() => void pause("endPause")}
            style={[ui.button, { alignSelf: "flex-start", backgroundColor: p.background, paddingHorizontal: 20 }]}>
            <Feather name="play" size={16} color={p.text} /><Text style={[ui.buttonText, { color: p.text }]}>{busy ? "Saving…" : "Back to work"}</Text>
          </MotionPress>
        : <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PAUSE_START_KINDS.map(kind => (
              <MotionPress key={kind} accessibilityRole="button" accessibilityLabel={`${PAUSE_LABEL[kind]}${unpaid(kind) ? ", unpaid" : ""}`} disabled={busy}
                onPress={() => kind === "emergency" ? setEmergency(v => !v) : void pause("startPause", kind)}
                style={[ui.row, { gap: 8, minHeight: 42, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: kind === "emergency" ? p.danger : p.headerBorder, backgroundColor: emergency && kind === "emergency" ? p.dangerWash : p.headerControl }]}>
                <Feather name={PAUSE_ICON[kind]} size={15} color={kind === "emergency" ? (emergency ? p.danger : p.headerText) : p.headerText} />
                <Text style={{ color: kind === "emergency" && emergency ? p.danger : p.headerText, fontWeight: "700", fontSize: 13 }}>{PAUSE_LABEL[kind]}</Text>
              </MotionPress>
            ))}
            {!open.overtimeFrom && <MotionPress accessibilityRole="button" accessibilityLabel="Start overtime" disabled={busy} onPress={() => void pause("startOvertime")}
              style={[ui.row, { gap: 8, minHeight: 42, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: p.headerBorder, backgroundColor: p.headerControl }]}>
              <Feather name="clock" size={15} color={p.headerText} /><Text style={{ color: p.headerText, fontWeight: "700", fontSize: 13 }}>Overtime</Text>
            </MotionPress>}
          </View>)}
      {!!open && !onPause && emergency && <View style={{ gap: 8, padding: 12, borderRadius: 16, backgroundColor: p.dangerWash }}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Start an emergency pause?</Text>
        <Text style={[ui.small, { color: p.text }]}>Managers are told straight away. Add a few words if you can.</Text>
        <TextInput value={note} onChangeText={v => setNote(v.slice(0, 200))} placeholder="What's happened (optional)" placeholderTextColor={p.muted} accessibilityLabel="What's happened"
          style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.surface, color: p.text, fontFamily: "Montserrat_500Medium" }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button label={busy ? "Starting…" : "Start emergency"} icon="alert-triangle" primary p={p} disabled={busy} onPress={() => void pause("startPause", "emergency")} />
          <Button label="Cancel" p={p} onPress={() => { setEmergency(false); setNote(""); }} />
        </View>
      </View>}
      {shift && !open && <Tag p={p} tone="plain" label={DEPARTMENT_LABEL[department] ?? department} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <DayReflection palette={p} visible={reflecting} onClose={() => setReflecting(false)} onClockOut={async () => { try { await clockOut(); } catch (e) { await load(); throw e; } }} />
    </View>
  );
}

type DailyKey = keyof typeof DAILY_WORK;
const DAILY_KEYS = Object.keys(DAILY_WORK) as DailyKey[];
function TargetsSheet({ p, targets, visible, onClose, onDone }: { p: Palette; targets: TeamPerformance["targets"]; visible: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [green, setGreen] = useState(String(targets.greenMinutes));
  const [amber, setAmber] = useState(String(targets.amberMinutes));
  const [weight, setWeight] = useState(String(targets.workWeight));
  const [daily, setDaily] = useState<Record<DailyKey, string>>(() => Object.fromEntries(DAILY_KEYS.map(k => [k, String(targets.dailyTargets[k])])) as Record<DailyKey, string>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? ["targets", targets.version, green, amber, weight, ...DAILY_KEYS.map(k => daily[k])].join(":") : null);
  async function save() {
    const [g, a, w] = [Number(green), Number(amber), Number(weight)];
    const perDay = DAILY_KEYS.map(k => Number(daily[k]));
    if (![g, a, w].every(Number.isInteger) || g < 1 || a <= g || w < 0 || w > 100) { setError("Use whole numbers: amber must be longer than green, and percentages between 0 and 100."); return; }
    if (!perDay.every(n => Number.isInteger(n) && n >= 0 && n <= 99)) { setError("Daily targets are whole numbers from 0 to 99."); return; }
    setBusy(true); setError("");
    try {
      // The pass mark and tiers are no longer edited here (each area's bonus is set in KPIs); the stored values go back unchanged.
      await writeTeams({ action: "saveTargets", requestId: request.get(), version: targets.version, greenMinutes: g, amberMinutes: a, passPercent: targets.passPercent, bonusPercents: targets.bonusPercents,
        workWeight: w, dailyTargets: Object.fromEntries(DAILY_KEYS.map((k, i) => [k, perDay[i]])) as Record<DailyKey, number> });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Reply and daily-work targets" subtitle="How replies and daily work are scored. Bonuses are set in KPIs." icon="hourglass">
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Guest replies</Text>
      <Field label="Green: reply within (minutes)" value={green} onChange={setGreen} p={p} />
      <Field label="Amber: reply within (minutes)" value={amber} onChange={setAmber} p={p} />
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Daily work, on each Stays shift day</Text>
      <Text style={[ui.small, { color: p.muted }]}>What each person should do on a day they work guest or client relations. 0 means it isn’t expected. Doing more than the target still counts as 100%.</Text>
      {DAILY_KEYS.map(k => <Field key={k} label={`${DAILY_WORK[k]} per day`} value={daily[k]} onChange={v => setDaily({ ...daily, [k]: v })} p={p} />)}
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Score</Text>
      <Field label="Daily work counts for (% of the score)" value={weight} onChange={setWeight} p={p} placeholder="40" />
      <Text style={[ui.small, { color: p.muted }]}>The rest is replies in green. With {Number(weight) || 0}% daily work, someone with 90% green replies and 100% daily work scores {Math.floor(90 * (100 - (Number(weight) || 0)) / 100 + (Number(weight) || 0))}%.</Text>
      <Text style={[ui.small, { color: p.muted }]}>Bonus targets and tiers are set for each area under KPIs on this screen.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save targets"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Management: who's on shift, and each person's reply times, hours and daily checks.
// Each person's department and usual shift, set by management.
function RotaSection({ p }: { p: Palette }) {
  const [rota, setRota] = useState<z.infer<typeof rotaListSchema>>([]);
  const [editing, setEditing] = useState<z.infer<typeof rotaListSchema>[number] | null>(null);
  const [department, setDept] = useState<(typeof DEPARTMENTS)[number]>("guest_relations"), [usual, setUsual] = useState<"early" | "late" | "both">("early");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(editing ? ["rota", editing.userId, department, usual].join(":") : null);
  const load = useCallback(async () => { try { setRota(rotaListSchema.parse((await readTeams({ section: "rota" })).data)); } catch { setRota([]); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  async function save() {
    if (!editing || busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "saveRota", requestId: request.get(), userId: editing.userId, department, usualShift: usual }); request.done(); setEditing(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (!rota.length) return null;
  return (
    <Section title="Departments and shifts" count={rota.length} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Who works in which team, and their usual shift (early 8am–4pm, late 3pm–11pm). Clock-in starts from their department.</Text>
      <List p={p} empty="">
        {rota.map((r, i) => <Row key={r.userId} p={p} first={i === 0} icon="user" tone="stays" title={r.fullName || "Team member"}
          detail={r.department ? `${DEPARTMENT_LABEL[r.department] ?? r.department} · ${r.usualShift ? SHIFTS[r.usualShift] : "No usual shift"}` : "No department set yet"}
          tags={r.department ? [] : [["Set up", "wait"]]} onPress={() => { setEditing(r); setDept((r.department ?? departmentFor(r.role)) as (typeof DEPARTMENTS)[number]); setUsual(r.usualShift ?? "early"); setError(""); }} />)}
      </List>
      <Sheet palette={p} visible={!!editing} onClose={() => setEditing(null)} title={editing?.fullName ?? ""} subtitle="Department and usual shift" icon="people">
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Department</Text>
        <ChoicePills p={p} name="Department" values={DEPARTMENTS} value={department} onChange={setDept} label={d => DEPARTMENT_LABEL[d]} />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Usual shift</Text>
        <Pills p={p} values={["early", "late", "both"] as const} value={usual} onChange={setUsual} label={v => SHIFTS[v]} />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : "Save"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
      </Sheet>
    </Section>
  );
}

const clientRelationsSchema = z.object({
  ownerMessages: z.number().nullable(), overall: z.object({ green: z.number(), amber: z.number(), red: z.number() }).nullable(),
  people: z.array(z.object({ userId: z.string(), fullName: z.string(), green: z.number(), amber: z.number(), red: z.number(), percentGreen: z.number().nullable(), onTrack: z.boolean().nullable(), bonusTier: z.number().nullable() })),
});
export function LiveTeamPerformance({ palette: p, role }: { palette: Palette; role: string }) {
  const saved = useSaved(), celebrate = useCelebrate();
  // Hours are locked: a super admin's change applies at once, an admin's waits for a super admin.
  const direct = role === "super_admin";
  // The period drives the analytics and everything below: the last 7 days to start, up to 92 days (the database's limit).
  const period = usePeriod(["today", "7d", "30d", "90d", "custom"], "7d", londonDay(), { maxDays: 92 });
  const [data, setData] = useState<TeamPerformance | null>(null);
  const [before, setBefore] = useState<TeamPerformance | null>(null);
  const [signoffs, setSignoffs] = useState<Signoff["recent"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState(false);
  const [clients, setClients] = useState<z.infer<typeof clientRelationsSchema> | null>(null);
  const [kpis, setKpis] = useState<KpiRead | null>(null);
  const [closing, setClosing] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false), [closeError, setCloseError] = useState("");
  const [stopped, setStopped] = useState(""), [why, setWhy] = useState("");
  const request = useRequestId(closing ? ["close", closing.id, stopped, why].join(":") : null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { from, to } = period.range;
    try {
      // The previous period of the same length, for the comparison only; the figures still show without it.
      const [now, prior] = await Promise.all([
        readTeams({ section: "teamPerformance", from, to }).then(r => teamPerformanceSchema.parse(r.data)),
        readTeams({ section: "teamPerformance", from: period.previous.from, to: period.previous.to }).then(r => teamPerformanceSchema.parse(r.data)).catch(() => null),
      ]);
      setData(now); setBefore(prior);
      // Only Stays and admins have sign-offs; anyone else simply sees none.
      setSignoffs(await readTeams({ section: "signoff" }).then(r => signoffSchema.parse(r.data).recent).catch(() => []));
      // Client relations: owner messages in the app, timed the same way.
      setClients(await readChat({ section: "clientRelations", from, to }).then(r => clientRelationsSchema.parse(r.data)).catch(() => null));
      // The KPI tracker: each person's bonus KPI, and the admin's list of KPIs.
      setKpis(await readTeams({ section: "kpis", from, to }).then(r => kpiReadSchema.parse(r.data)).catch(() => null));
    } catch (e) { setError(message(e)); }
    setLoading(false);
  }, [period.range, period.previous]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const openClose = (s: Shift) => { setClosing(s); setStopped(time(new Date().toISOString())); setWhy(""); setCloseError(""); };
  async function close() {
    if (!closing || busy) return;
    if (!validClock(stopped)) { setCloseError("Enter the time as HH:MM, for example 17:30."); return; }
    // The day they stopped: the day they started, or the next one for a time earlier than the start.
    const started = londonDayOf(closing.clockedInAt), endedAt = londonInstant(stopped <= time(closing.clockedInAt) ? addDays(started, 1) : started, stopped);
    if (Date.parse(endedAt) > Date.now()) { setCloseError("That time hasn’t happened yet."); return; }
    setBusy(true); setCloseError("");
    try {
      await writeTeams({ action: "closeShift", requestId: request.get(), shiftId: closing.id, endedAt, ...(why.trim().length >= 3 ? { note: why.trim() } : {}) });
      request.done(); setClosing(null); celebrate(direct ? "Shift ended" : "Sent for approval"); await load();
    }
    catch (e) { setCloseError(message(e)); } finally { setBusy(false); }
  }
  const t = data?.targets;
  return (
    <View style={{ gap: 20 }}>
      <AnalyticsPanel p={p} model={data ? teamPerformanceModel(data, before, period.range, period.against) : null} loading={loading} error={error}
        controls={<PeriodBar p={p} period={period} />} caption={`${period.label}, ${period.against}.`} />
      <RotaSection p={p} />
      {data && t && <>
        <Section title="On shift now" count={data.onShift.length} p={p}>
          <List p={p} empty="Nobody is clocked in.">
            {data.onShift.map((s, i) => <Row key={s.id} p={p} first={i === 0} icon="clock" tone="stays" title={s.fullName ?? "Team member"} detail={`${DEPARTMENT_LABEL[s.department] ?? s.department} · since ${time(s.clockedInAt)} · ${hoursLabel(sinceMinutes(s.clockedInAt))}`}
              tags={[[shiftName(s.clockedInAt), "plain"]]} onPress={() => openClose(s)} />)}
          </List>
        </Section>
        <Section title="Scores and bonuses" p={p}>
          <Text style={[ui.small, { color: p.muted }]}>
            Replies: green within {t.greenMinutes} min, amber within {t.amberMinutes} min, red after that, credited to whoever was clocked in to guest relations.
            {t.workWeight > 0 ? ` Daily work counts for ${t.workWeight}% of the score: ${DAILY_KEYS.filter(k => t.dailyTargets[k] > 0).map(k => `${t.dailyTargets[k]} ${DAILY_WORK[k].toLowerCase()}`).join(", ") || "nothing yet"} on each Stays shift day.` : " Only reply times count."}
            {` A score of ${t.passPercent}% is on track. The bonus follows each area's bonus KPI (see KPIs below).`}
          </Text>
          {!data.messages && <Notice text="No guest messages yet. Log them in Stays → Guest inbox, or they arrive by themselves once the channel manager is connected." p={p} />}
          <Button label="Change the targets" icon="sliders" p={p} onPress={() => setTargets(true)} />
          <List p={p} empty="No team members yet.">
            {data.people.map((x, i) => {
              const total = x.green + x.amber + x.red;
              const tags: [string, "good" | "wait" | "bad" | "plain"][] = x.score !== null ? [[`Score ${x.score}%`, x.onTrack ? "good" : "bad"], [x.onTrack ? "On track" : "Off track", x.onTrack ? "good" : "bad"]] : [["Nothing to score yet", "plain"]];
              const bonus = kpis ? bonusTag(kpis, x.userId) : null;
              if (bonus) tags.push(bonus);
              const parts = [
                total ? `Replies ${x.percentGreen}% green (${formatCount(x.green)} green, ${formatCount(x.amber)} amber, ${formatCount(x.red)} red)` : "",
                x.workPercent !== null ? `Daily work ${x.workPercent}% over ${plural(x.daysWorked ?? 0, "Stays day")}` : "",
                `${hoursLabel(x.minutes)} over ${plural(x.shifts, "shift")}`,
                `${plural(x.listingChecks, "listing check")}, ${plural(x.reviewsLogged, "review")}, ${plural(x.pricingDecisions, "pricing decision")}, ${plural(x.signOffs, "daily sign-off")}`,
              ].filter(Boolean);
              return <Row key={x.userId} p={p} first={i === 0} icon={x.onTrack ? "trending-up" : x.score !== null ? "trending-down" : "user"} tone="stays" title={x.fullName || "Team member"} detail={parts.join(" · ")} tags={tags} />;
            })}
          </List>
          {data.unassigned.green + data.unassigned.amber + data.unassigned.red > 0 && <Notice p={p} tone="bad"
            text={`${plural(data.unassigned.green + data.unassigned.amber + data.unassigned.red, "guest message")} arrived while nobody was clocked in to guest relations (${formatCount(data.unassigned.red)} red).`} />}
        </Section>
        {/* Shown once owners message in the app; never during the team beta, when owners have no accounts. */}
        {clients && (!!clients.ownerMessages || clients.people.length > 0) && <Section title="Owner reply times (client relations)" p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Messages owners send Recharge in the app, with the same targets. Each one counts for whoever was clocked in to client relations when it arrived.</Text>
          {!clients.people.length && <Notice text={clients.ownerMessages ? "No owner messages were answered by someone on a client relations shift yet." : "No owner messages in this period."} p={p} />}
          <List p={p} empty="">
            {clients.people.map((x, i) => {
              // The bonus follows the KPI tracker now, so no tier from the old targets here.
              const tags: [string, "good" | "wait" | "bad" | "plain"][] = [[`${x.percentGreen ?? 0}% green`, x.onTrack ? "good" : "bad"], [x.onTrack ? "On track" : "Off track", x.onTrack ? "good" : "bad"]];
              return <Row key={x.userId} p={p} first={i === 0} icon={x.onTrack ? "trending-up" : "trending-down"} tone="clients" title={x.fullName || "Team member"} detail={`${formatCount(x.green)} green · ${formatCount(x.amber)} amber · ${formatCount(x.red)} red`} tags={tags} />;
            })}
          </List>
          {!!clients.overall && clients.overall.red > 0 && <Notice p={p} tone="bad" text={`${plural(clients.overall.red, "owner message")} waited more than ${t.amberMinutes} minutes for a reply.`} />}
        </Section>}
        {kpis?.canEdit && <KpiAdmin p={p} read={kpis} onChanged={load} />}
        <Section title="Daily sign-offs" count={signoffs.length} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Stays confirm at the end of each day that every listing is visible, bad reviews are answered, suspensions are dealt with and re-listings are done. The last 14 days.</Text>
          <List p={p} empty="No sign-offs in the last 14 days.">
            {signoffs.map((o, i) => <Row key={o.day + o.fullName + o.createdAt} p={p} first={i === 0} icon="check-circle" tone="stays" title={o.fullName || "Team member"}
              detail={[`${formatDay(o.day)} at ${time(o.createdAt)}`, `${plural(o.snapshot.listingChecksToday, "listing check")}, ${plural(o.snapshot.reviewsToday, "review")}`, o.note].filter(Boolean).join(" · ")}
              tags={o.snapshot.openRelistings ? [[`${plural(o.snapshot.openRelistings, "re-listing")} open`, "wait"]] : [["All clear", "good"]]} />)}
          </List>
        </Section>
        <TargetsSheet key={t.version} p={p} targets={t} visible={targets} onClose={() => setTargets(false)} onDone={saved(load)} />
      </>}
      <Sheet palette={p} visible={!!closing} onClose={() => setClosing(null)} title={closing?.fullName ?? ""} subtitle={closing ? `Clocked in at ${time(closing.clockedInAt)}` : undefined} icon="hourglass">
        <Text style={[ui.body, { color: p.text }]}>If they forgot to clock out, set when they actually stopped.</Text>
        <Tag label={closing ? `${hoursLabel(sinceMinutes(closing.clockedInAt))} so far` : ""} tone="plain" p={p} />
        <Field label="Stopped work at (HH:MM, UK time)" value={stopped} onChange={setStopped} p={p} placeholder="17:30" />
        <Field label="Why (optional)" value={why} onChange={setWhy} p={p} placeholder="Forgot to clock out" />
        {!direct && <Notice text="Clock in and out is locked. This goes to a super admin, and the shift ends only once they approve it." p={p} />}
        {!!closeError && <Notice text={closeError} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : direct ? "End the shift" : "Send for approval"} icon={direct ? "log-out" : "send"} primary p={p} disabled={busy} onPress={() => void close()} />
      </Sheet>
    </View>
  );
}

// Admins: whether breaks and emergencies count as paid time. Unpaid pauses come off the
// hours in the timesheet, the Productivity Tool and team performance.
export function PauseRules({ p }: { p: Palette }) {
  const [policy, setPolicy] = useState<PausePolicy | null>(null), [draft, setDraft] = useState<PausePolicy | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    try { const parsed = myShiftSchema.parse((await readTeams({ section: "shift" })).data).pausePolicy; setPolicy(parsed); setDraft(parsed); }
    catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!draft || !policy) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  const changed = draft.breakPaid !== policy.breakPaid || draft.emergencyPaid !== policy.emergencyPaid;
  async function save() {
    if (!draft || !policy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const next = pausePolicySchema.parse((await writeTeams({ action: "savePausePolicy", requestId: Crypto.randomUUID(), lunchPaid: policy.lunchPaid, breakPaid: draft.breakPaid, emergencyPaid: draft.emergencyPaid, version: policy.version })).data);
      setPolicy(next); setDraft(next); setSaved("Saved. Hours are worked out with these rules from now on, including past pauses.");
    } catch (e) { setError(message(e)); await load(); } finally { setBusy(false); }
  }
  // Lunch is no longer a pause, so it has no switch here. Its stored rule is sent back unchanged above, so the
  // lunch pauses on older shifts keep the totals they had.
  const rows: [keyof Pick<PausePolicy, "breakPaid" | "emergencyPaid">, string, string][] = [
    ["breakPaid", "Breaks", "Short breaks"], ["emergencyPaid", "Emergencies", "Emergency pauses (managers are told)"]];
  return (
    <Section title="Breaks and pay" p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Team members pause for a break or an emergency while clocked in, and switch to overtime when their shift is done. Choose which pauses count as paid time.</Text>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
        {rows.map(([key, title, detail], i) => (
          <View key={key} style={[ui.between, { gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text><Text style={[ui.small, { color: p.muted }]}>{detail} · {draft[key] ? "counts as paid time" : "unpaid, taken off their hours"}</Text></View>
            <Switch accessibilityLabel={`${title} count as paid time`} value={draft[key]} onValueChange={v => setDraft({ ...draft, [key]: v })} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
          </View>
        ))}
      </View>
      {!!policy.updatedBy && <Text style={[ui.small, { color: p.muted }]}>Last changed by {policy.updatedBy}{policy.updatedAt ? ` on ${formatDay(policy.updatedAt.slice(0, 10))}` : ""}.</Text>}
      {changed && <Button label={busy ? "Saving…" : "Save"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />}
      {!!saved && <Notice text={saved} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Section>
  );
}
