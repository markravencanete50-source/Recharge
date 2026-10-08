import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { formatMoney } from "../../lib/format";
import { readOperations, readTeams, writeOperation, writeTeams, writeWorkspace } from "./backend/client";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import { scheduleSchema } from "../../lib/cleans-live";
import { canReportRepair, poundsToMinor, repairStep, REPAIR_STAGES, routinePlanSchema, visitMoves, type RepairStep } from "../../lib/repairs-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Live repairs: the maintenance pipeline from report to completed repair, and
// Ready's routine visits. Every action here is checked again by the database.
type Operation = z.infer<typeof operationViewSchema>;
type Visit = z.infer<typeof scheduleSchema>["work"][number];
const pounds = (minor: unknown) => typeof minor === "number" ? formatMoney(minor) : "–";
const STEP_TITLE: Record<RepairStep, string> = { approveBudget: "Approve the repair cost", referReady: "Refer to Ready", bookRepair: "Book the repair", completeRepair: "Complete the repair" };

export function LiveRepairs({ palette: p, account, properties }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const today = london(new Date());
  const [repairs, setRepairs] = useState<Operation[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [plans, setPlans] = useState<z.infer<typeof routinePlanSchema>>([]);
  const [stage, setStage] = useState<string>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [visitId, setVisitId] = useState<string | null>(null);
  const routines = ["ready", "stays", "admin", "super_admin"].includes(account.role);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const ops = z.array(operationViewSchema).parse((await readOperations()).data).filter(op => op.kind === "maintenance");
      setRepairs(ops);
      if (routines) {
        const [s, r] = await Promise.all([readTeams({ section: "schedule", from: addDays(today, -14), to: addDays(today, 45) }), readTeams({ section: "routines" })]);
        setVisits(scheduleSchema.parse(s.data).work.filter(w => w.kind === "routine_visit"));
        setPlans(routinePlanSchema.parse(r.data));
      }
    } catch (e) { setError(message(e)); }
    setLoading(false);
  }, [routines, today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const nameOf = useCallback((id: string) => properties.find(x => x.id === id)?.name ?? "Property", [properties]);
  const counts = useMemo(() => Object.fromEntries(REPAIR_STAGES.map(s => [s.phase, repairs.filter(r => r.data.phase === s.phase).length])), [repairs]);
  const mineToAct = repairs.filter(r => repairStep(account.role, String(r.data.phase)));
  const shown = stage === "open" ? repairs.filter(r => r.data.phase !== "completed") : stage === "action" ? mineToAct : repairs.filter(r => r.data.phase === stage);
  const open = repairs.find(r => r.workId === openId);
  const visit = visits.find(v => v.workId === visitId);

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Repairs</Text>
        <Text style={[ui.body, { color: p.muted }]}>{account.role === "client" ? "Repairs at your properties, and costs waiting for your approval." : "Every repair from report to completion, with routine visits."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      <View style={{ flexDirection: "row", gap: 10 }}>
        {canReportRepair(account.role) && <Button label="Report a repair" icon="alert-triangle" primary p={p} onPress={() => setReporting(true)} />}
        <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
      </View>

      <Section title="Pipeline" p={p}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ phase: "action", label: `Needs you · ${mineToAct.length}` }, { phase: "open", label: "All open" }, ...REPAIR_STAGES.map(s => ({ phase: s.phase, label: `${s.label} · ${counts[s.phase] ?? 0}` }))].map(chip => (
            <MotionPress key={chip.phase} accessibilityRole="button" accessibilityState={{ selected: stage === chip.phase }} onPress={() => setStage(chip.phase)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: stage === chip.phase ? p.primary : p.surface, borderWidth: 1, borderColor: stage === chip.phase ? p.primary : p.border }}>
              <Text style={{ color: stage === chip.phase ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{chip.label}</Text>
            </MotionPress>
          ))}
        </ScrollView>
        {shown.length ? shown.map(r => {
          const phase = String(r.data.phase), step = repairStep(account.role, phase), label = REPAIR_STAGES.find(s => s.phase === phase)?.label ?? phase;
          return (
            <MotionPress key={r.workId} accessibilityRole="button" accessibilityLabel={`${nameOf(r.propertyId)}, ${label}`} onPress={() => setOpenId(r.workId)} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: step ? p.primary : p.border }]}>
              <View style={ui.between}><Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", flex: 1 }}>{nameOf(r.propertyId)}</Text><Feather name="chevron-right" size={18} color={p.muted} /></View>
              <Text numberOfLines={2} style={[ui.small, { color: p.text }]}>{typeof r.data.issue === "string" ? r.data.issue : r.title}</Text>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={label} tone={phase === "completed" ? "good" : step ? "wait" : "plain"} p={p} />
                {r.data.hazard === true && <Tag label="Safety hazard" tone="bad" p={p} />}
                <Text style={[ui.small, { color: p.muted }]}>Estimate {pounds(r.data.estimatedCostMinor)}</Text>
              </View>
              {step && <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Next for you: {STEP_TITLE[step]}</Text>}
            </MotionPress>
          );
        }) : !loading && <Notice text={stage === "action" ? "Nothing is waiting for you." : "No repairs in this view."} p={p} />}
      </Section>

      {routines && (
        <Section title="Routine visits" p={p}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button label="New routine" icon="repeat" p={p} onPress={() => setPlanning(true)} />
            <Button label="Create this month's visits" icon="calendar" p={p} disabled={!plans.length}
              onPress={() => void writeTeams({ action: "generateRoutineVisits", requestId: Crypto.randomUUID(), period: today.slice(0, 7) }).then(() => load()).catch(e => setError(message(e)))} />
          </View>
          {visits.filter(v => v.status !== "completed").length ? visits.filter(v => v.status !== "completed").map(v => (
            <MotionPress key={v.workId} accessibilityRole="button" onPress={() => setVisitId(v.workId)} style={[ui.card, ui.between, { gap: 10, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "700" }}>{v.title}</Text><Text style={[ui.small, { color: p.muted }]}>{v.propertyName} · {v.dueOn ? dayLabel(v.dueOn) : "No date"}{v.assigneeName ? ` · ${v.assigneeName}` : ""}</Text></View>
              <Tag label={v.status === "in_review" ? "Awaiting sign-off" : v.status === "in_progress" ? "In progress" : v.status === "approved" ? "Signed off" : "To do"} tone={v.status === "in_review" ? "wait" : "plain"} p={p} />
            </MotionPress>
          )) : !loading && <Notice text={plans.length ? "No open visits. Create this month's visits from your routines." : "No routines yet. Add bins, garden or safety checks as a routine."} p={p} />}
          {plans.map(plan => <Text key={plan.id} style={[ui.small, { color: p.muted }]}>{plan.propertyName}: {plan.title} · {plan.frequency} on day {plan.dayOfMonth}{plan.active ? "" : " · paused"}</Text>)}
        </Section>
      )}

      <RepairSheet p={p} role={account.role} repair={open} propertyName={open ? nameOf(open.propertyId) : ""} today={today} onClose={() => setOpenId(null)} onDone={async () => { setOpenId(null); await load(); }} />
      <ReportSheet p={p} visible={reporting} properties={properties} onClose={() => setReporting(false)} onDone={async () => { setReporting(false); await load(); }} />
      <PlanSheet p={p} visible={planning} properties={properties} account={account} onClose={() => setPlanning(false)} onDone={async () => { setPlanning(false); await load(); }} />
      <VisitSheet p={p} role={account.role} visit={visit} plans={plans} onClose={() => setVisitId(null)} onDone={async () => { setVisitId(null); await load(); }} />
    </View>
  );
}

function Detail({ label, value, p }: { label: string; value: unknown; p: Palette }) {
  if (typeof value !== "string" || !value) return null;
  return <View style={{ gap: 2 }}><Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text><Text style={{ color: p.text, fontSize: 14 }}>{value}</Text></View>;
}

function RepairSheet({ p, role, repair, propertyName, today, onClose, onDone }: { p: Palette; role: string; repair?: Operation; propertyName: string; today: string; onClose: () => void; onDone: () => Promise<void> }) {
  const phase = String(repair?.data.phase ?? ""), step = repair ? repairStep(role, phase) : null;
  const [fields, setFields] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(repair ? repair.workId + ":" + repair.version : null);
  const set = (k: string) => (v: string) => setFields(f => ({ ...f, [k]: v }));
  const f = (k: string) => fields[k] ?? "";
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setFields({ repairOn: today }); setConsent(false); setError(""); } }); return () => { active = false; }; }, [repair, today]);

  function build(): Record<string, unknown> | string {
    if (step === "approveBudget") return consent ? { consent: true } : "Tick to approve the cost.";
    if (step === "referReady") {
      if (f("troubleshooting").trim().length < 5 || f("guestUpdate").trim().length < 5) return "Describe the checks made and what the guest was told.";
      if (repair?.data.warrantyRequired === true && f("warrantyContactEvidence").trim().length < 10) return "This property needs the warranty provider contacted first. Add who you contacted.";
      return { troubleshooting: f("troubleshooting").trim(), guestUpdate: f("guestUpdate").trim(), ...(f("warrantyContactEvidence").trim() ? { warrantyContactEvidence: f("warrantyContactEvidence").trim() } : {}) };
    }
    if (step === "bookRepair") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f("repairOn")) || f("contractor").trim().length < 2 || f("guestUpdate").trim().length < 5) return "Add the date, contractor and guest update.";
      return { repairOn: f("repairOn"), contractor: f("contractor").trim(), guestUpdate: f("guestUpdate").trim() };
    }
    if (step === "completeRepair") {
      const cost = poundsToMinor(f("actualCost"));
      if (f("report").trim().length < 10 || f("guestUpdate").trim().length < 5 || cost === null) return "Add the repair report, the actual cost and the guest update.";
      if (typeof repair?.data.estimatedCostMinor === "number" && cost > repair.data.estimatedCostMinor) return "The cost is above the approved estimate. Report a new repair so the owner can approve the increase.";
      return { report: f("report").trim(), actualCostMinor: cost, guestUpdate: f("guestUpdate").trim() };
    }
    return "Nothing to do.";
  }
  async function save() {
    if (!repair || !step || busy) return;
    const data = build();
    if (typeof data === "string") { setError(data); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: request.get(), workId: repair.workId, version: repair.version, step, data } as Parameters<typeof writeOperation>[0]);
      request.done(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const label = REPAIR_STAGES.find(s => s.phase === phase);
  return (
    <Sheet palette={p} visible={!!repair} onClose={onClose} title={propertyName} subtitle={label ? `${label.label} · ${label.detail}` : ""} icon="hardhat">
      {repair && <>
        <Detail label="Issue" value={repair.data.issue} p={p} />
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Tag label={`Estimate ${pounds(repair.data.estimatedCostMinor)}`} tone="plain" p={p} />
          {repair.data.hazard === true && <Tag label="Safety hazard" tone="bad" p={p} />}
          {typeof repair.data.ownerApprovedAt === "string" && <Tag label="Owner approved" tone="good" p={p} />}
        </View>
        <Detail label="Checks made" value={repair.data.troubleshooting} p={p} />
        <Detail label="Contractor" value={repair.data.contractor} p={p} />
        <Detail label="Repair date" value={typeof repair.data.repairOn === "string" ? dayLabel(repair.data.repairOn) : undefined} p={p} />
        <Detail label="Repair report" value={repair.data.report} p={p} />
        <Detail label="Latest guest update" value={repair.data.guestUpdate} p={p} />
        {step && <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{STEP_TITLE[step]}</Text>}
        {step === "approveBudget" && (
          <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(c => !c)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: consent ? p.successWash : p.elevated }]}>
            <Feather name={consent ? "check-square" : "square"} size={20} color={consent ? p.success : p.muted} />
            <Text style={{ color: p.text, flex: 1 }}>I approve spending up to {pounds(repair.data.estimatedCostMinor)} on this repair</Text>
          </MotionPress>
        )}
        {step === "referReady" && <>
          <Field label="Checks made before referral" value={f("troubleshooting")} onChange={set("troubleshooting")} p={p} multiline placeholder="What you tried with the guest" />
          {repair.data.warrantyRequired === true && <Field label="Warranty provider contacted" value={f("warrantyContactEvidence")} onChange={set("warrantyContactEvidence")} p={p} multiline />}
          <Field label="Update for the guest" value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline />
        </>}
        {step === "bookRepair" && <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Today" p={p} onPress={() => set("repairOn")(today)} />
            <Button label="Tomorrow" p={p} onPress={() => set("repairOn")(addDays(today, 1))} />
          </View>
          <Field label="Repair date (YYYY-MM-DD)" value={f("repairOn")} onChange={set("repairOn")} p={p} />
          <Field label="Contractor" value={f("contractor")} onChange={set("contractor")} p={p} />
          <Field label="Update for the guest" value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline />
        </>}
        {step === "completeRepair" && <>
          <Field label="Repair report" value={f("report")} onChange={set("report")} p={p} multiline placeholder="What was fixed and anything still outstanding" />
          <Field label={`Actual cost (up to ${pounds(repair.data.estimatedCostMinor)})`} value={f("actualCost")} onChange={set("actualCost")} p={p} placeholder="£0.00" />
          <Field label="Update for the guest" value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline />
          <Text style={[ui.small, { color: p.muted }]}>Completing sends the repair to Accounts to reconcile the invoice.</Text>
        </>}
        {!step && <Notice text={phase === "completed" ? "This repair is complete." : role === "ready" && phase === "triage" ? "Stays will refer this to Ready." : "Nothing for you to do at this stage."} p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {step && <Button label={busy ? "Saving…" : STEP_TITLE[step]} primary p={p} disabled={busy} onPress={() => void save()} />}
      </>}
    </Sheet>
  );
}

function PropertyChips({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string; onChange: (id: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {properties.map(x => (
        <MotionPress key={x.id} accessibilityRole="radio" accessibilityState={{ selected: value === x.id }} onPress={() => onChange(x.id)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: value === x.id ? p.primary : p.surface, borderWidth: 1, borderColor: value === x.id ? p.primary : p.border }}>
          <Text style={{ color: value === x.id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{x.name}</Text>
        </MotionPress>
      ))}
      {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
    </View>
  );
}

function ReportSheet({ p, visible, properties, onClose, onDone }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState("");
  const [issue, setIssue] = useState("");
  const [estimate, setEstimate] = useState("");
  const [hazard, setHazard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? "repair:" + propertyId + ":" + issue.trim() : null);
  async function save() {
    const cost = poundsToMinor(estimate);
    if (!propertyId || issue.trim().length < 5 || cost === null) { setError("Choose the property, describe the issue and add an estimate."); return; }
    setBusy(true); setError("");
    try { await writeOperation({ action: "createOperation", requestId: request.get(), propertyId, kind: "maintenance", data: { issue: issue.trim(), estimatedCostMinor: cost, hazard } }); request.done(); setIssue(""); setEstimate(""); setHazard(false); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Report a repair" subtitle="Above the owner's limit, the owner approves the cost first" icon="hardhat">
      <PropertyChips p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <Field label="What is wrong" value={issue} onChange={setIssue} p={p} multiline placeholder="For example: kitchen tap leaking under the sink" />
      <Field label="Estimated cost" value={estimate} onChange={setEstimate} p={p} placeholder="£0.00" />
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: hazard }} onPress={() => setHazard(h => !h)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hazard ? "#F6DEDA" : p.elevated }]}>
        <Feather name={hazard ? "check-square" : "square"} size={20} color={hazard ? "#A63A32" : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>This is a safety hazard</Text>
      </MotionPress>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Sending…" : "Report repair"} icon="send" primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

function PlanSheet({ p, visible, properties, account, onClose, onDone }: { p: Palette; visible: boolean; properties: PropertyView[]; account: WorkspaceAccount; onClose: () => void; onDone: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState("");
  const [moduleId, setModuleId] = useState<"routine-bin-garden-board" | "safety-maintenance" | "ready-schedule">("routine-bin-garden-board");
  const [title, setTitle] = useState("");
  const [checks, setChecks] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "quarterly">("monthly");
  const [day, setDay] = useState("1");
  const [mine, setMine] = useState(account.role === "ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? "plan:" + propertyId + ":" + title : null);
  async function save() {
    const checklist = checks.split("\n").map(x => x.trim()).filter(Boolean), dayOfMonth = Number(day);
    if (!propertyId || title.trim().length < 2 || !checklist.length || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) { setError("Choose a property, a title, at least one check and a day from 1 to 28."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "saveRoutinePlan", requestId: request.get(), propertyId, moduleId, title: title.trim(), checklist, frequency, dayOfMonth, assigneeId: mine ? account.userId : null, active: true }); request.done(); setTitle(""); setChecks(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const pill = (on: boolean) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center" as const, backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border });
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="New routine" subtitle="Visits are created each period from this plan" icon="calendar">
      <PropertyChips p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([["routine-bin-garden-board", "Bins and garden"], ["safety-maintenance", "Safety checks"], ["ready-schedule", "Other Ready visit"]] as const).map(([id, label]) => (
          <MotionPress key={id} accessibilityRole="radio" accessibilityState={{ selected: moduleId === id }} onPress={() => setModuleId(id)} style={pill(moduleId === id)}><Text style={{ color: moduleId === id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{label}</Text></MotionPress>
        ))}
      </View>
      <Field label="Title" value={title} onChange={setTitle} p={p} placeholder="For example: Monthly bins and garden" />
      <Field label="Checks, one per line" value={checks} onChange={setChecks} p={p} multiline />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["monthly", "quarterly"] as const).map(x => <MotionPress key={x} accessibilityRole="radio" accessibilityState={{ selected: frequency === x }} onPress={() => setFrequency(x)} style={pill(frequency === x)}><Text style={{ color: frequency === x ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{x === "monthly" ? "Monthly" : "Every 3 months"}</Text></MotionPress>)}
      </View>
      <Field label="Day of the month (1–28)" value={day} onChange={setDay} p={p} />
      {account.role === "ready" && <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: mine }} onPress={() => setMine(m => !m)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.elevated }]}><Feather name={mine ? "check-square" : "square"} size={20} color={mine ? p.success : p.muted} /><Text style={{ color: p.text, flex: 1 }}>Assign these visits to me</Text></MotionPress>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save routine"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

function VisitSheet({ p, role, visit, plans, onClose, onDone }: { p: Palette; role: string; visit?: Visit; plans: z.infer<typeof routinePlanSchema>; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visit ? visit.workId + ":" + visit.version : null);
  const plan = plans.find(x => x.lastVisit?.workId === visit?.workId) ?? plans.find(x => x.title === visit?.title && x.propertyName === visit?.propertyName);
  async function move(status: "in_progress" | "in_review" | "approved" | "completed") {
    if (!visit || busy) return; setBusy(true); setError("");
    try { await writeWorkspace({ action: "transitionWork", workId: visit.workId, version: visit.version, status, note: note.trim(), requestId: request.get() }); request.done(); setNote(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const moves = visit ? visitMoves(role, visit.status) : [];
  return (
    <Sheet palette={p} visible={!!visit} onClose={onClose} title={visit?.title ?? ""} subtitle={visit ? `${visit.propertyName} · ${visit.dueOn ? dayLabel(visit.dueOn) : ""}` : ""} icon="toolbox">
      {plan && plan.checklist.map(item => <View key={item} style={[ui.row, { gap: 10 }]}><Feather name="check" size={16} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>{item}</Text></View>)}
      {moves.length > 0 && <Field label="Note (optional)" value={note} onChange={setNote} p={p} multiline placeholder="Anything found on the visit" />}
      {moves.map(m => <Button key={m.status} label={busy ? "Saving…" : m.label} primary p={p} disabled={busy} onPress={() => void move(m.status)} />)}
      {!moves.length && <Notice text={visit?.status === "in_review" ? "Waiting for Stays to sign off this visit." : "Nothing for you to do on this visit."} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}
