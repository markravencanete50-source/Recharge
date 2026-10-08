import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { GrowBar, MotionPress, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { readTeams, writeTeams } from "./backend/client";
import { DEPARTMENT_LABEL, departmentFor, hoursLabel, myShiftSchema, shiftName, teamPerformanceSchema, type Shift, type TeamPerformance } from "../../lib/management-live";
import { DEPARTMENTS } from "../../lib/workspace-teams-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Clocking in and out, and the team's guest reply times. Guest relations replies are timed:
// green within the green limit, amber within the amber limit, red after that.
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const sinceMinutes = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const londonDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + offset * 86400000));

// Home: the person's own shift, with clock in and out.
export function ShiftCard({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [shift, setShift] = useState<ReturnType<typeof myShiftSchema.parse> | null>(null);
  const [department, setDepartment] = useState<string>(departmentFor(account.role));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  // Keyed per shift: after a clock-out the next clock-in gets a new request, even if an earlier
  // response was lost.
  const request = useRequestId(shift ? (shift.open ? "out:" + shift.open.id : ["in", department, shift.today.at(-1)?.id ?? "first"].join(":")) : null);
  const load = useCallback(async () => {
    try { setShift(myShiftSchema.parse((await readTeams({ section: "shift" })).data)); setError(""); }
    catch { setUnavailable(true); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (unavailable) return null;
  async function toggle() {
    if (!shift || busy) return;
    setBusy(true); setError("");
    try {
      await writeTeams(shift.open ? { action: "clockOut", requestId: request.get() } : { action: "clockIn", requestId: request.get(), department: department as never });
      request.done(); await load();
    } catch (e) { setError(message(e)); await load(); } finally { setBusy(false); }
  }
  const open = shift?.open;
  const score = shift && shift.responses ? Math.floor(shift.green * 100 / shift.responses) : null;
  return (
    <View style={[ui.card, { backgroundColor: open ? p.header : p.surface, borderColor: open ? p.header : p.border, gap: 12 }]}>
      <View style={[ui.between, { gap: 12, flexWrap: "wrap" }]}>
        <SwapIn swapKey={open ? "on:" + open.id : "off"} style={{ gap: 4, flexShrink: 1 }}>
          <Text style={{ color: open ? p.headerMuted : p.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>{open ? "ON SHIFT" : "YOUR SHIFT"}</Text>
          <Text style={{ color: open ? p.headerText : p.text, fontSize: 18, fontWeight: "700" }}>
            {!shift ? "Checking…" : open ? `${DEPARTMENT_LABEL[open.department] ?? open.department} · since ${time(open.clockedInAt)}` : "You’re clocked out"}
          </Text>
          {!!open && <Text style={{ color: p.headerMuted, fontSize: 13 }}>{shiftName(open.clockedInAt)} · {hoursLabel(sinceMinutes(open.clockedInAt))} so far</Text>}
          {score !== null && <Text style={{ color: open ? p.headerMuted : p.muted, fontSize: 13 }}>Guest replies, last 30 days: {score}% on time ({shift!.passPercent}% is on track)</Text>}
          {score !== null && <View style={{ marginTop: 4, maxWidth: 260 }}><GrowBar share={score / 100} height={6} color={score >= shift!.passPercent ? p.success : p.waiting} track={open ? p.headerBorder : p.wash} /></View>}
        </SwapIn>
        {shift ? <MotionPress accessibilityRole="button" accessibilityLabel={open ? "Clock out" : "Clock in"} disabled={busy} onPress={() => void toggle()}
          style={[ui.button, { backgroundColor: open ? p.background : p.primary, paddingHorizontal: 20 }]}>
          <Feather name={open ? "log-out" : "log-in"} size={16} color={open ? p.text : p.onPrimary} />
          <Text style={[ui.buttonText, { color: open ? p.text : p.onPrimary }]}>{busy ? "Saving…" : open ? "Clock out" : "Clock in"}</Text>
        </MotionPress> : <Loading p={p} />}
      </View>
      {shift && !open && <Pills p={p} values={DEPARTMENTS} value={department as (typeof DEPARTMENTS)[number]} onChange={setDepartment} label={d => DEPARTMENT_LABEL[d]} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

function TargetsSheet({ p, targets, visible, onClose, onDone }: { p: Palette; targets: TeamPerformance["targets"]; visible: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [green, setGreen] = useState(String(targets.greenMinutes));
  const [amber, setAmber] = useState(String(targets.amberMinutes));
  const [pass, setPass] = useState(String(targets.passPercent));
  const [bonus, setBonus] = useState(targets.bonusPercents.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? ["targets", targets.version, green, amber, pass, bonus].join(":") : null);
  async function save() {
    const tiers = bonus.split(",").map(x => x.trim()).filter(Boolean).map(Number);
    const [g, a, s] = [Number(green), Number(amber), Number(pass)];
    if (![g, a, s, ...tiers].every(Number.isInteger) || g < 1 || a <= g || s < 1 || s > 100 || tiers.some(t => t < 1 || t > 100) || tiers.length > 5) { setError("Use whole numbers: amber must be longer than green, and percentages between 1 and 100."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "saveTargets", requestId: request.get(), version: targets.version, greenMinutes: g, amberMinutes: a, passPercent: s, bonusPercents: tiers }); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Reply targets" subtitle="How guest relations replies are graded" icon="hourglass">
      <Field label="Green: reply within (minutes)" value={green} onChange={setGreen} p={p} />
      <Field label="Amber: reply within (minutes)" value={amber} onChange={setAmber} p={p} />
      <Field label="On track: replies in green (%)" value={pass} onChange={setPass} p={p} />
      <Field label="Bonus tiers (%, comma separated)" value={bonus} onChange={setBonus} p={p} placeholder="95, 100" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save targets"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Management: who's on shift, and each person's reply times, hours and daily checks.
export function LiveTeamPerformance({ palette: p }: { palette: Palette }) {
  const [range, setRange] = useState<"today" | "week" | "month">("week");
  const [data, setData] = useState<TeamPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState(false);
  const [closing, setClosing] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRequestId(closing ? "close:" + closing.id : null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const from = londonDay(range === "today" ? 0 : range === "week" ? -6 : -29);
    try { setData(teamPerformanceSchema.parse((await readTeams({ section: "teamPerformance", from, to: londonDay() })).data)); }
    catch (e) { setError(message(e)); }
    setLoading(false);
  }, [range]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  async function close() {
    if (!closing || busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "closeShift", requestId: request.get(), shiftId: closing.id, endedAt: new Date().toISOString() }); request.done(); setClosing(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const t = data?.targets;
  return (
    <View style={{ gap: 20 }}>
      <Pills p={p} values={["today", "week", "month"] as const} value={range} onChange={setRange} label={v => ({ today: "Today", week: "Last 7 days", month: "Last 30 days" })[v]} />
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {data && t && <>
        <Section title="On shift now" count={data.onShift.length} p={p}>
          <List p={p} empty="Nobody is clocked in.">
            {data.onShift.map((s, i) => <Row key={s.id} p={p} first={i === 0} title={s.fullName ?? "Team member"} detail={`${DEPARTMENT_LABEL[s.department] ?? s.department} · since ${time(s.clockedInAt)} · ${hoursLabel(sinceMinutes(s.clockedInAt))}`}
              tags={[[shiftName(s.clockedInAt), "plain"]]} onPress={() => setClosing(s)} />)}
          </List>
        </Section>
        <Section title="Guest reply times" p={p}>
          <Text style={[ui.small, { color: p.muted }]}>
            Green within {t.greenMinutes} min, amber within {t.amberMinutes} min, red after that. {t.passPercent}% green is on track{t.bonusPercents.length ? `; ${t.bonusPercents.join("% and ")}% unlock the bonus tiers` : ""}. Each guest message counts for whoever was clocked in to guest relations.
          </Text>
          {!data.messages && <Notice text="No guest messages yet. Reply times appear once guest messages arrive from the channel manager." p={p} />}
          <Button label="Change the targets" icon="sliders" p={p} onPress={() => setTargets(true)} />
          <List p={p} empty="No team members yet.">
            {data.people.map((x, i) => {
              const total = x.green + x.amber + x.red;
              const tags: [string, "good" | "wait" | "bad" | "plain"][] = total ? [[`${x.percentGreen}% green`, x.onTrack ? "good" : "bad"], [x.onTrack ? "On track" : "Off track", x.onTrack ? "good" : "bad"]] : [["No replies yet", "plain"]];
              if (x.bonusTier) tags.push([`Bonus tier ${x.bonusTier}%`, "good"]);
              return <Row key={x.userId} p={p} first={i === 0} title={x.fullName || "Team member"}
                detail={`${total ? `${x.green} green · ${x.amber} amber · ${x.red} red · ` : ""}${hoursLabel(x.minutes)} over ${x.shifts} shift${x.shifts === 1 ? "" : "s"} · ${x.listingChecks} listing checks · ${x.pricingDecisions} pricing decisions`} tags={tags} />;
            })}
          </List>
          {data.unassigned.green + data.unassigned.amber + data.unassigned.red > 0 && <Notice p={p} tone="bad"
            text={`${data.unassigned.green + data.unassigned.amber + data.unassigned.red} guest messages arrived while nobody was clocked in to guest relations (${data.unassigned.red} red).`} />}
        </Section>
        <TargetsSheet key={t.version} p={p} targets={t} visible={targets} onClose={() => setTargets(false)} onDone={load} />
      </>}
      <Sheet palette={p} visible={!!closing} onClose={() => setClosing(null)} title={closing?.fullName ?? ""} subtitle={closing ? `Clocked in at ${time(closing.clockedInAt)}` : undefined} icon="hourglass">
        <Text style={[ui.body, { color: p.text }]}>End this shift now if they forgot to clock out.</Text>
        <Tag label={closing ? `${hoursLabel(sinceMinutes(closing.clockedInAt))} so far` : ""} tone="plain" p={p} />
        <Button label={busy ? "Saving…" : "End the shift now"} icon="log-out" primary p={p} disabled={busy} onPress={() => void close()} />
      </Sheet>
    </View>
  );
}
