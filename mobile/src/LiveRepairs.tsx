import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PropertyTeamChatButton } from "./PropertyTeamChat";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Text } from "./Typography";
import { ListSearchBox, PropertySelect, useListSearch } from "./SearchPicker";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId, useWorkFocus, Loading, RefreshButton } from "./LiveKit";
import { formatMoney } from "../../lib/format";
import { readOperations, readTeams, readWorkMedia, workspaceRequest, writeOperation, writeTeams } from "./backend/client";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { PropertyAccess } from "./LiveTools";
import { REPAIR_GUIDES, SAFETY_STOP, repairTypeLabel, troubleshootingNote, type RepairType } from "../../lib/repair-guides";
import { profileAccess, reservationsSchema, stayLines, type StayLine } from "../../lib/property-profile";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import { scheduleSchema } from "../../lib/cleans-live";
import { canStart } from "../../lib/home-tools";
import { canCloseRepair, canReportRepair, canResolveRepair, canReviseQuote, daysFromNow, declineNote, londonDayOf, poundsToMinor, repairClosed, repairStage, repairStep, REPAIR_STAGES, RESOLUTION_MAX, RESOLUTION_MIN, routinePlanSchema, visitChecklist, visitDates, visitFormOf, type RepairStep } from "../../lib/repairs-live";
import { VisitDates, VisitForm, VisitMoves } from "./VisitForm";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Live repairs: the maintenance pipeline from report to completed repair, and
// Ready's routine visits. Every action here is checked again by the database.
type Operation = z.infer<typeof operationViewSchema>;
type Visit = z.infer<typeof scheduleSchema>["work"][number];
const pounds = (minor: unknown) => typeof minor === "number" ? formatMoney(minor) : "–";
// A repair reported with no estimate waits in triage; say so rather than showing £0.00.
const estimateText = (data: Record<string, unknown>) => data.estimatedCostMinor === 0 && data.phase === "triage" ? "Cost not known yet" : `Estimate ${pounds(data.estimatedCostMinor)}`;
const STEP_TITLE: Record<RepairStep, string> = { approveBudget: "Approve the repair cost", approveManagement: "Approve the cost (management)", referReady: "Refer to Ready", bookRepair: "Book the repair", completeRepair: "Complete the repair" };

export function LiveRepairs({ palette: p, account, properties }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const saved = useSaved();
  const today = london(new Date());
  const [repairs, setRepairs] = useState<Operation[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [plans, setPlans] = useState<z.infer<typeof routinePlanSchema>>([]);
  // The routine visits as work items: they carry the checklist, the visit form and the last done and next due dates.
  const [visitOps, setVisitOps] = useState<Operation[]>([]);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const focus = useWorkFocus();
  // Ready Home opens this page on one stage of the pipeline.
  const [stage, setStage] = useState<string>(() => focus?.sub && ["action", "open", ...REPAIR_STAGES.map(s => s.phase)].includes(focus.sub) ? focus.sub : "open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Home's Today board opens a repair or a routine visit straight away.
  const [openId, setOpenId] = useState<string | null>(() => focus?.workId ?? null);
  const [reporting, setReporting] = useState(() => focus?.open === "report-repair" && canReportRepair(account.role));
  const [planning, setPlanning] = useState(() => focus?.open === "new-routine" && ["ready", "stays", "admin", "super_admin"].includes(account.role));
  const [visitId, setVisitId] = useState<string | null>(() => focus?.workId ?? null);
  const routines = ["ready", "stays", "admin", "super_admin"].includes(account.role);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const all = z.array(operationViewSchema).parse((await readOperations()).data), ops = all.filter(op => op.kind === "maintenance");
      setRepairs(ops);
      setVisitOps(all.filter(op => op.kind === "routine_visit"));
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
  const counts = useMemo(() => Object.fromEntries(REPAIR_STAGES.map(s => [s.phase, repairs.filter(r => repairStage(r.data) === s.phase).length])), [repairs]);
  const mineToAct = repairs.filter(r => repairStep(account.role, String(r.data.phase), account.teamOnly) || canCloseRepair(account.role, String(r.data.phase)));
  const inStage = stage === "open" ? repairs.filter(r => !repairClosed(String(r.data.phase))) : stage === "action" ? mineToAct : repairs.filter(r => repairStage(r.data) === stage);
  const search = useListSearch(inStage, r => [nameOf(r.propertyId), r.title, r.data.issue, typeof r.data.repairType === "string" ? repairTypeLabel(r.data.repairType) : "", REPAIR_STAGES.find(s => s.phase === repairStage(r.data))?.label]), shown = search.shown;
  // Visits are created a batch at a time; keep asking until none are left.
  const [creatingVisits, setCreatingVisits] = useState(false), creating = useRef(false);
  async function createVisits() {
    if (creating.current) return;
    creating.current = true; setCreatingVisits(true); setError("");
    try {
      let created = 0;
      for (let round = 0; round < 20; round++) {
        const result = z.object({ data: z.object({ created: z.array(z.string()), remaining: z.number() }) }).parse(await writeTeams({ action: "generateRoutineVisits", requestId: Crypto.randomUUID(), period: today.slice(0, 7) }));
        created += result.data.created.length;
        if (result.data.remaining <= 0) break;
      }
      await saved(load, created ? `${created} visit${created === 1 ? "" : "s"} created` : "Visits are up to date")();
    } catch (e) { setError(message(e)); } finally { creating.current = false; setCreatingVisits(false); }
  }
  const open = repairs.find(r => r.workId === openId);
  const visit = visits.find(v => v.workId === visitId);
  const recording = visits.find(v => v.workId === recordingId), recordingOp = visitOps.find(o => o.workId === recordingId);

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Maintenance</Text>
        <Text style={[ui.body, { color: p.muted }]}>{account.role === "client" ? "Repairs at your properties, and costs waiting for your approval." : "Every repair from report to completion, with routine visits."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        {canStart(account, "report-repair") && <Button label="Report a repair" icon="alert-triangle" primary p={p} onPress={() => setReporting(true)} />}
        <RefreshButton p={p} loading={loading} onPress={() => void load()} />
      </View>

      <Section title="Reactive maintenance" p={p}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ phase: "action", label: `Needs you · ${mineToAct.length}` }, { phase: "open", label: "All open" }, ...REPAIR_STAGES.map(s => ({ phase: s.phase, label: `${s.label} · ${counts[s.phase] ?? 0}` }))].map(chip => (
            <MotionPress key={chip.phase} accessibilityRole="button" accessibilityState={{ selected: stage === chip.phase }} onPress={() => setStage(chip.phase)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: stage === chip.phase ? p.primary : p.surface, borderWidth: 1, borderColor: stage === chip.phase ? p.primary : p.border }}>
              <Text style={{ color: stage === chip.phase ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{chip.label}</Text>
            </MotionPress>
          ))}
        </ScrollView>
        <ListSearchBox p={p} search={search} nouns="repairs" />
        {search.missed ? null : shown.length ? shown.map(r => {
          const phase = String(r.data.phase), step = repairStep(account.role, phase), stageNow = repairStage(r.data), label = REPAIR_STAGES.find(s => s.phase === stageNow)?.label ?? phase;
          const declined = declineNote(r.data), followUp = canCloseRepair(account.role, phase);
          return (
            <MotionPress key={r.workId} accessibilityRole="button" accessibilityLabel={`${nameOf(r.propertyId)}, ${label}`} onPress={() => setOpenId(r.workId)} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: step || followUp ? p.primary : p.border }]}>
              <View style={ui.between}><Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", flex: 1 }}>{nameOf(r.propertyId)}</Text><Feather name="chevron-right" size={18} color={p.muted} /></View>
              <Text numberOfLines={2} style={[ui.small, { color: p.text }]}>{typeof r.data.issue === "string" ? r.data.issue : r.title}</Text>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={label} tone={stageNow === "paid" || phase === "completed" || phase === "resolved" ? "good" : step ? "wait" : "plain"} p={p} />
                {r.data.urgent === true && <Tag label="Urgent" tone="bad" p={p} />}
                {r.data.hazard === true && <Tag label="Safety hazard" tone="bad" p={p} />}
                {typeof r.data.repairType === "string" && <Tag label={repairTypeLabel(r.data.repairType)} tone="plain" p={p} />}
                <Text style={[ui.small, { color: p.muted }]}>{estimateText(r.data)}</Text>
              </View>
              {!!declined && <Text numberOfLines={2} style={[ui.small, { color: p.danger, fontWeight: "600" }]}>{declined}</Text>}
              {step && <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Next for you: {STEP_TITLE[step]}</Text>}
              {followUp && <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Next for you: update the quote or close the repair</Text>}
            </MotionPress>
          );
        }) : !loading && <Notice text={stage === "action" ? "Nothing is waiting for you." : "No repairs in this view."} p={p} />}
      </Section>

      {routines && (
        <Section title="Preventative maintenance" p={p}>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label="New routine" icon="repeat" p={p} onPress={() => setPlanning(true)} />
            <Button label={creatingVisits ? "Creating visits…" : "Create this month's visits"} icon="calendar" p={p} disabled={!plans.length || creatingVisits} onPress={() => void createVisits()} />
          </View>
          {visits.filter(v => v.status !== "completed").length ? visits.filter(v => v.status !== "completed").map(v => {
            const last = londonDayOf(visitDates(visitOps.find(o => o.workId === v.workId)?.data).lastDoneAt);
            return (
            <MotionPress key={v.workId} accessibilityRole="button" onPress={() => setVisitId(v.workId)} style={[ui.card, ui.between, { gap: 10, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "700" }}>{v.title}</Text><Text style={[ui.small, { color: p.muted }]}>{v.propertyName} · {v.dueOn ? dayLabel(v.dueOn) : "No date"}{v.assigneeName ? ` · ${v.assigneeName}` : ""}{last ? ` · last done ${daysFromNow(last, today)}` : ""}</Text></View>
              <Tag label={v.status === "in_review" ? "Awaiting sign-off" : v.status === "in_progress" ? "In progress" : v.status === "approved" ? "Signed off" : "To do"} tone={v.status === "in_review" ? "wait" : "plain"} p={p} />
            </MotionPress>
            );
          }) : !loading && <Notice text={plans.length ? "No open visits. Visits are created automatically for this month and next; create them now if one is missing." : "No routines yet. Add bins, garden or safety checks as a routine."} p={p} />}
          {plans.map(plan => <Text key={plan.id} style={[ui.small, { color: p.muted }]}>{plan.propertyName}: {plan.title} · {plan.frequency} on day {plan.dayOfMonth}{plan.active ? "" : " · paused"}</Text>)}
        </Section>
      )}

      <RepairSheet p={p} account={account} role={account.role} repair={open} propertyName={open ? nameOf(open.propertyId) : ""} today={today} onClose={() => setOpenId(null)} onDone={saved(async () => { setOpenId(null); await load(); })} />
      <ReportSheet p={p} account={account} visible={reporting} properties={properties} onClose={() => setReporting(false)} onDone={saved(async () => { setReporting(false); await load(); })} />
      <PlanSheet p={p} visible={planning} properties={properties} account={account} onClose={() => setPlanning(false)} onDone={saved(async () => { setPlanning(false); await load(); })} />
      <VisitSheet p={p} role={account.role} visit={visit} op={visitOps.find(o => o.workId === visitId)} plans={plans} today={today} onClose={() => setVisitId(null)} onRecord={() => { setRecordingId(visitId); setVisitId(null); }} onDone={saved(async () => { setVisitId(null); await load(); })} />
      <VisitForm p={p} today={today} visit={recording ? { workId: recording.workId, version: recordingOp?.version ?? recording.version, title: recording.title, propertyName: recording.propertyName, status: recording.status, data: recordingOp?.data ?? {} } : null} onClose={() => setRecordingId(null)} onDone={async () => { await load(); }} />
    </View>
  );
}

function Detail({ label, value, p }: { label: string; value: unknown; p: Palette }) {
  if (typeof value !== "string" || !value) return null;
  return <View style={{ gap: 2 }}><Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text><Text style={{ color: p.text, fontSize: 14 }}>{value}</Text></View>;
}

// Before and after photos on a repair. "After" photos are the ones sent with the completed repair.
function RepairPhotos({ p, repair }: { p: Palette; repair: Operation }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    readWorkMedia(repair.workId).then(r => { const parsed = z.array(z.object({ id: z.string().uuid(), purpose: z.string() })).safeParse(r.data); if (active && parsed.success) setIds(parsed.data.filter(x => x.purpose === "maintenance").map(x => x.id)); }).catch(() => undefined);
    return () => { active = false; };
  }, [repair.workId, repair.version]);
  const after = Array.isArray(repair.data.photoIds) ? repair.data.photoIds.filter((x): x is string => typeof x === "string") : [];
  const before = ids.filter(id => !after.includes(id));
  if (!before.length && !after.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {!!before.length && <><Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Before</Text><PhotoStrip p={p} ids={before} /></>}
      {!!after.length && <><Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>After</Text><PhotoStrip p={p} ids={after} /></>}
    </View>
  );
}

function RepairSheet({ p, account, role, repair, propertyName, today, onClose, onDone }: { p: Palette; account: WorkspaceAccount; role: string; repair?: Operation; propertyName: string; today: string; onClose: () => void; onDone: () => Promise<void> }) {
  const phase = String(repair?.data.phase ?? ""), step = repair ? repairStep(role, phase, account.teamOnly) : null;
  // Team beta: Stays or an admin records the owner's answer, with how the owner gave it.
  const forOwner = role !== "client" && phase === "owner_approval";
  const team = ["ready", "stays", "admin", "super_admin"].includes(role);
  const [afterIds, setAfterIds] = useState<string[]>([]), [uploading, setUploading] = useState(false), [addingBefore, setAddingBefore] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);
  // Saying no to the cost (the owner, or management), or closing a declined repair (Stays).
  const [declining, setDeclining] = useState<"decline" | "close" | null>(null);
  // Closing a repair that is still in triage without a visit: Stays or management write what fixed it.
  const [resolving, setResolving] = useState(false);
  const request = useRequestId(repair ? repair.workId + ":" + repair.version : null);
  const quoteRequest = useRequestId(repair && quoting ? ["quote", repair.workId, repair.version, fields.quote ?? "", fields.quoteReason ?? ""].join(":") : null);
  const resolveRequest = useRequestId(repair && resolving ? ["resolve", repair.workId, repair.version, fields.resolution ?? ""].join(":") : null);
  const declineRequest = useRequestId(repair && declining ? [declining, repair.workId, repair.version, fields.declineReason ?? ""].join(":") : null);
  const set = (k: string) => (v: string) => setFields(f => ({ ...f, [k]: v }));
  const f = (k: string) => fields[k] ?? "";
  // Reset only when a different repair (or a newer version of it) opens, not on every refresh of the list.
  const resetKey = repair ? repair.workId + ":" + repair.version : "", urgentNow = repair?.data.urgent === true;
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setFields({ repairOn: today }); setConsent(false); setTicked([]); setUrgent(urgentNow); setError(""); setQuoting(false); setAfterIds([]); setAddingBefore(false); setUploading(false); setDeclining(null); setResolving(false); } }); return () => { active = false; }; }, [resetKey, urgentNow, today]);

  function build(): Record<string, unknown> | string {
    if (step === "approveBudget" && forOwner) return consent && f("ownerAgreement").trim().length >= 5 ? { consent: true, ownerAgreement: f("ownerAgreement").trim().slice(0, 500) } : "Add how the owner agreed and tick to record their approval.";
    if (step === "approveBudget") return consent ? { consent: true } : "Tick to approve the cost.";
    if (step === "approveManagement") return f("managementNote").trim() ? { note: f("managementNote").trim() } : {};
    if (step === "referReady") {
      const note = troubleshootingNote(type, ticked, f("troubleshooting"));
      if (note.trim().length < 5 || f("guestUpdate").trim().length < 5) return "Tick the checks you went through (or describe them) and add what the guest was told.";
      if (repair?.data.warrantyRequired === true && f("warrantyContactEvidence").trim().length < 10) return "This property needs the warranty provider contacted first. Add who you contacted.";
      return { troubleshooting: note, guestUpdate: f("guestUpdate").trim(), urgent, ...(f("warrantyContactEvidence").trim() ? { warrantyContactEvidence: f("warrantyContactEvidence").trim() } : {}) };
    }
    if (step === "bookRepair") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f("repairOn")) || f("contractor").trim().length < 2 || f("guestUpdate").trim().length < 5) return "Add the date, contractor and guest update.";
      return { repairOn: f("repairOn"), contractor: f("contractor").trim(), guestUpdate: f("guestUpdate").trim() };
    }
    if (step === "completeRepair") {
      const cost = poundsToMinor(f("actualCost"));
      if (f("report").trim().length < 10 || f("guestUpdate").trim().length < 5 || cost === null) return "Add the repair report, the actual cost and the guest update.";
      if (typeof repair?.data.estimatedCostMinor === "number" && cost > repair.data.estimatedCostMinor) return "The cost is above the approved estimate. Use “Update the quote” first; if it is over the owner’s limit they approve it, then you can complete the repair.";
      return { report: f("report").trim(), actualCostMinor: cost, guestUpdate: f("guestUpdate").trim(), ...(afterIds.length ? { photoIds: afterIds } : {}) };
    }
    return "Nothing to do.";
  }
  async function save() {
    if (!repair || !step || busy || uploading) return;
    const data = build();
    if (typeof data === "string") { setError(data); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: request.get(), workId: repair.workId, version: repair.version, step, data } as Parameters<typeof writeOperation>[0]);
      request.done(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function reviseQuote() {
    if (!repair || busy) return;
    const quote = poundsToMinor(f("quote"));
    if (quote === null || f("quoteReason").trim().length < 5) { setError("Add the new quote and why it changed."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: quoteRequest.get(), workId: repair.workId, version: repair.version, step: "reviseQuote", data: { quoteMinor: quote, reason: f("quoteReason").trim() } } as Parameters<typeof writeOperation>[0]);
      quoteRequest.done(); setQuoting(false); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function resolve() {
    if (!repair || busy) return;
    const resolution = f("resolution").trim();
    if (resolution.length < RESOLUTION_MIN || resolution.length > RESOLUTION_MAX) { setError(`Say what fixed it (${RESOLUTION_MIN} to ${RESOLUTION_MAX} characters).`); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: resolveRequest.get(), workId: repair.workId, version: repair.version, step: "resolveRepair", data: { resolution } } as Parameters<typeof writeOperation>[0]);
      resolveRequest.done(); setResolving(false); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function decide() {
    if (!repair || !declining || busy) return;
    const text = f("declineReason").trim();
    if (text.length < 5 || text.length > 2000) { setError(declining === "close" ? "Say why the repair is closed (at least 5 characters)." : "Say why the cost is declined (at least 5 characters). The team sees it on the repair."); return; }
    const step = declining === "close" ? "closeRepair" : role === "client" || forOwner ? "declineBudget" : "declineManagement";
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: declineRequest.get(), workId: repair.workId, version: repair.version, step, data: declining === "close" ? { note: text } : { reason: text } } as Parameters<typeof writeOperation>[0]);
      declineRequest.done(); setDeclining(null); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const declined = repair ? declineNote(repair.data) : null, closable = canCloseRepair(role, phase);
  const label = REPAIR_STAGES.find(s => s.phase === phase);
  const type = (typeof repair?.data.repairType === "string" && repair.data.repairType in REPAIR_GUIDES ? repair.data.repairType : "other") as RepairType;
  return (
    <Sheet palette={p} visible={!!repair} onClose={onClose} title={propertyName} subtitle={label ? `${label.label} · ${label.detail}` : ""} icon="hardhat">
      {repair && <>
        <Detail label="Issue" value={repair.data.issue} p={p} />
        {!!declined && <Notice text={declined} p={p} tone="bad" />}
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Tag label={estimateText(repair.data)} tone="plain" p={p} />
          {typeof repair.data.repairType === "string" && <Tag label={repairTypeLabel(repair.data.repairType)} tone="plain" p={p} />}
          {repair.data.urgent === true && <Tag label="Urgent" tone="bad" p={p} />}
          {repair.data.hazard === true && <Tag label="Safety hazard" tone="bad" p={p} />}
          {typeof repair.data.ownerApprovedAt === "string" && <Tag label="Owner approved" tone="good" p={p} />}
          {typeof repair.data.quoteRevisedAt === "string" && <Tag label="Quote updated" tone="wait" p={p} />}
          {typeof repair.data.paidAt === "string" && <Tag label="Paid by Accounts" tone="good" p={p} />}
        </View>
        {team && <PropertyAccess key={repair.propertyId} palette={p} account={account} propertyId={repair.propertyId} />}
        {typeof repair.data.quoteReason === "string" && <Detail label={`Quote changed from ${pounds(repair.data.previousEstimateMinor)} to ${pounds(repair.data.estimatedCostMinor)}`} value={repair.data.quoteReason} p={p} />}
        {(typeof repair.data.contactFirst === "string" || typeof repair.data.warrantyDetails === "string") && phase !== "completed" && (
          <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }}>
            <View style={[ui.row, { gap: 8 }]}><Feather name="phone-call" size={16} color={p.text} /><Text style={{ color: p.text, fontWeight: "700" }}>The owner asked us to contact first</Text></View>
            <Detail label="Preferred repair contact" value={repair.data.contactFirst} p={p} />
            <Detail label="Warranties" value={repair.data.warrantyDetails} p={p} />
          </View>
        )}
        <Detail label="Checks made" value={repair.data.troubleshooting} p={p} />
        <Detail label="How it was resolved" value={repair.data.resolution} p={p} />
        <Detail label="Contractor" value={repair.data.contractor} p={p} />
        <Detail label="Repair date" value={typeof repair.data.repairOn === "string" ? dayLabel(repair.data.repairOn) : undefined} p={p} />
        <Detail label="Repair report" value={repair.data.report} p={p} />
        <Detail label="Latest guest update" value={repair.data.guestUpdate} p={p} />
        <RepairPhotos p={p} repair={repair} />
        {team && ["referred", "booked"].includes(phase) && (addingBefore
          ? <PhotoPicker key={"before:" + resetKey} p={p} workId={repair.workId} purpose="maintenance" label="Photos before the repair" hint="The problem as you found it. Each photo is saved as you add it." onChange={(_ids, loading) => setUploading(loading)} />
          : <Button label="Add before photos" icon="camera" p={p} onPress={() => setAddingBefore(true)} />)}
        {step && <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{forOwner ? "Record the owner's approval" : STEP_TITLE[step]}</Text>}
        {step === "approveBudget" && forOwner && !declining && <Field label="How the owner agreed" value={f("ownerAgreement")} onChange={set("ownerAgreement")} p={p} placeholder="For example: by phone with the owner on 10 October" />}
        {step === "approveBudget" && !declining && (
          <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(c => !c)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: consent ? p.successWash : p.elevated }]}>
            <Feather name={consent ? "check-square" : "square"} size={20} color={consent ? p.success : p.muted} />
            <Text style={{ color: p.text, flex: 1 }}>{forOwner ? `The owner approved spending up to ${pounds(repair.data.estimatedCostMinor)} on this repair` : `I approve spending up to ${pounds(repair.data.estimatedCostMinor)} on this repair`}</Text>
          </MotionPress>
        )}
        <Detail label="How the owner agreed" value={repair.data.ownerAgreement} p={p} />
        {step === "approveManagement" && !declining && <>
          <Text style={[ui.small, { color: p.muted }]}>This repair is above the management approval limit.{typeof repair.data.ownerApprovedAt === "string" ? " The owner has approved it." : " It is within the owner’s own limit."}</Text>
          <Field label="Note for the team (optional)" value={f("managementNote")} onChange={set("managementNote")} p={p} multiline />
        </>}
        {(step === "approveBudget" || step === "approveManagement" || closable) && (declining ? <View style={{ gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{declining === "close" ? "Close the repair" : forOwner ? "The owner declined the cost" : "Decline the cost"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{declining === "close" ? "The repair is closed without the work going ahead. The owner sees it in their updates." : role === "client" ? "Recharge sees your reason on the repair and can get a new quote or close it." : forOwner ? "Record what the owner said. The repair can then be re-quoted or closed." : "Stays see the reason on the repair and can re-quote or close it."}</Text>
          <Field label={declining === "close" ? "Why it is closed" : "Why"} value={f("declineReason")} onChange={set("declineReason")} p={p} multiline placeholder={declining === "close" ? "For example: the owner is arranging it themselves" : "For example: please get a second quote first"} />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : declining === "close" ? "Close the repair" : forOwner ? "Record the decline" : "Decline the cost"} primary p={p} disabled={busy} onPress={() => void decide()} />
            <Button label="Cancel" p={p} onPress={() => setDeclining(null)} />
          </View>
        </View> : <Button label={closable ? "Close the repair" : forOwner ? "The owner declined" : "Decline the cost"} icon="x" p={p} onPress={() => { setDeclining(closable ? "close" : "decline"); setError(""); }} />)}
        {step === "referReady" && <>
          <View style={{ gap: 8 }}>
            <Text style={{ color: p.text, fontWeight: "700" }}>{REPAIR_GUIDES[type].label}: go through these with the guest</Text>
            <View style={[ui.row, { gap: 8, padding: 10, borderRadius: 12, backgroundColor: p.cautionWash, alignItems: "flex-start" }]}><Feather name="alert-triangle" size={15} color={p.danger} style={{ marginTop: 2 }} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{SAFETY_STOP}</Text></View>
            {REPAIR_GUIDES[type].checks.map(c => {
              const on = ticked.includes(c);
              return (
                <MotionPress key={c} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setTicked(t => on ? t.filter(x => x !== c) : [...t, c])} style={[ui.row, { gap: 12, minHeight: 46, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: on ? p.successWash : p.elevated }]}>
                  <Feather name={on ? "check-square" : "square"} size={19} color={on ? p.success : p.muted} />
                  <Text style={{ color: p.text, flex: 1 }}>{c}</Text>
                </MotionPress>
              );
            })}
          </View>
          <Field label="Anything else you tried or found" value={f("troubleshooting")} onChange={set("troubleshooting")} p={p} multiline placeholder="Error codes, what the guest said, photos taken" />
          <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: urgent }} onPress={() => setUrgent(u => !u)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: urgent ? p.cautionWash : p.elevated }]}>
            <Feather name={urgent ? "check-square" : "square"} size={20} color={urgent ? p.danger : p.muted} />
            <Text style={{ color: p.text, flex: 1 }}>Urgent: the guest can’t use the property properly until it’s fixed</Text>
          </MotionPress>
          {repair.data.warrantyRequired === true && <Field label="Warranty provider contacted" value={f("warrantyContactEvidence")} onChange={set("warrantyContactEvidence")} p={p} multiline />}
          <Field label="Update for the guest" value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline />
        </>}
        {step === "bookRepair" && <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
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
          <PhotoPicker key={"after:" + resetKey} p={p} workId={repair.workId} purpose="maintenance" label="After photos (optional)" hint="The finished repair. They go to Accounts with your report." onChange={(ids, loading) => { setAfterIds(ids); setUploading(loading); }} />
          <Text style={[ui.small, { color: p.muted }]}>Completing sends the cost to Accounts as a draft expense, with your report and the before and after photos.</Text>
        </>}
        {canReviseQuote(role, phase) && (quoting ? <View style={{ gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Update the quote</Text>
          <Text style={[ui.small, { color: p.muted }]}>{phase === "owner_declined" ? "The new quote goes back to the owner to approve." : "If the new quote is higher and over the owner’s approval limit, it goes to the owner first (and above the management limit, to management). The repair carries on once approved."}</Text>
          <Field label={`New quote (now ${pounds(repair.data.estimatedCostMinor)})`} value={f("quote")} onChange={set("quote")} p={p} placeholder="£0.00" />
          <Field label="Why it changed" value={f("quoteReason")} onChange={set("quoteReason")} p={p} multiline placeholder="For example, the part needs replacing, not repairing" />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : "Save the new quote"} primary p={p} disabled={busy} onPress={() => void reviseQuote()} />
            <Button label="Cancel" p={p} onPress={() => setQuoting(false)} />
          </View>
        </View> : <Button label="Update the quote" icon="edit-3" p={p} onPress={() => setQuoting(true)} />)}
        {canResolveRepair(role, phase) && (resolving ? <View style={{ gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Resolved without a visit</Text>
          <Text style={[ui.small, { color: p.muted }]}>Use this when troubleshooting fixed it and no one needs to attend. The repair is closed as resolved and the owner and team are told.</Text>
          <Field label="What fixed it" value={f("resolution")} onChange={set("resolution")} p={p} multiline placeholder="For example: reset the boiler with the guest and the heating came back" />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : "Mark as resolved"} primary p={p} disabled={busy} onPress={() => void resolve()} />
            <Button label="Cancel" p={p} onPress={() => setResolving(false)} />
          </View>
        </View> : <Button label="Resolved without a visit" icon="check-circle" p={p} onPress={() => { setResolving(true); setError(""); }} />)}
        {!step && <Notice text={phase === "resolved" ? "This repair was resolved without a visit." : phase === "completed" ? "This repair is complete." : phase === "closed" ? "This repair was closed without the work going ahead." : closable ? "Update the quote to send it back for approval, or close the repair." : declined && role === "client" ? "Recharge will get a new quote or close this repair." : role === "ready" && phase === "triage" ? "Stays will refer this to Ready." : "Nothing for you to do at this stage."} p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {step && !declining && !resolving && <Button label={busy ? "Saving…" : uploading ? "Saving photos…" : forOwner ? "Record the owner's approval" : STEP_TITLE[step]} primary p={p} disabled={busy || uploading} onPress={() => void save()} />}
        {role !== "client" && <PropertyTeamChatButton palette={p} propertyId={repair.propertyId} workId={repair.workId} />}
      </>}
    </Sheet>
  );
}

function PropertyChips({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string; onChange: (id: string) => void }) {
  return <PropertySelect p={p} properties={properties} value={value} onChange={onChange} />;
}

function ReportSheet({ p, account, visible, properties, onClose, onDone }: { p: Palette; account: WorkspaceAccount; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState("");
  const [type, setType] = useState<RepairType>("other");
  const [urgent, setUrgent] = useState(false);
  const [stays, setStays] = useState<StayLine[]>([]);
  const [reservationId, setReservationId] = useState("");
  const canLink = profileAccess(account).stays;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setStays([]); setReservationId(""); } });
    if (!canLink || !propertyId) return () => { active = false; };
    void workspaceRequest("/api/mobile/portfolio?" + new URLSearchParams({ section: "reservations", propertyId })).then(r => r.json()).then(body => {
      const parsed = reservationsSchema.safeParse(body.data);
      if (active && parsed.success) setStays(stayLines(parsed.data, london(new Date()), 6));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [canLink, propertyId]);
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
    try { await writeOperation({ action: "createOperation", requestId: request.get(), propertyId, kind: "maintenance", data: { issue: issue.trim(), estimatedCostMinor: cost, hazard, repairType: type, urgent: urgent || hazard, ...(reservationId ? { reservationId } : {}) } }); request.done(); setIssue(""); setEstimate(""); setHazard(false); setUrgent(false); setType("other"); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Report a repair" subtitle="Above the owner's limit, the owner approves the cost first" icon="hardhat">
      <PropertyChips p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <Text style={{ color: p.text, fontWeight: "700" }}>Type of repair</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(REPAIR_GUIDES) as RepairType[]).map(t => (
          <MotionPress key={t} accessibilityRole="radio" accessibilityState={{ selected: type === t }} onPress={() => setType(t)} style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: type === t ? p.primary : p.surface, borderWidth: 1, borderColor: type === t ? p.primary : p.border }]}>
            <Feather name={REPAIR_GUIDES[t].icon as "tool"} size={14} color={type === t ? p.onPrimary : p.muted} />
            <Text style={{ color: type === t ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{REPAIR_GUIDES[t].label}</Text>
          </MotionPress>
        ))}
      </View>
      <Field label="What is wrong" value={issue} onChange={setIssue} p={p} multiline placeholder="For example: kitchen tap leaking under the sink" />
      {!!stays.length && <>
        <Text style={{ color: p.text, fontWeight: "700" }}>Which stay is this for? (optional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {stays.map(s => (
            <MotionPress key={s.id} accessibilityRole="radio" accessibilityState={{ selected: reservationId === s.id }} onPress={() => setReservationId(reservationId === s.id ? "" : s.id)} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 12, justifyContent: "center", backgroundColor: reservationId === s.id ? p.primary : p.surface, borderWidth: 1, borderColor: reservationId === s.id ? p.primary : p.border }}>
              <Text style={{ color: reservationId === s.id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{s.dates}{s.when === "now" ? " · staying now" : ""}</Text>
            </MotionPress>
          ))}
        </View>
      </>}
      <Field label="Estimated cost" value={estimate} onChange={setEstimate} p={p} placeholder="£0.00" />
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: hazard }} onPress={() => setHazard(h => !h)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hazard ? p.dangerWash : p.elevated }]}>
        <Feather name={hazard ? "check-square" : "square"} size={20} color={hazard ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>This is a safety hazard</Text>
      </MotionPress>
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: urgent || hazard }} onPress={() => setUrgent(u => !u)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: urgent || hazard ? p.cautionWash : p.elevated }]}>
        <Feather name={urgent || hazard ? "check-square" : "square"} size={20} color={urgent || hazard ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>Urgent: guests can’t use the property properly until it’s fixed</Text>
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

function VisitSheet({ p, role, visit, op, plans, today, onClose, onRecord, onDone }: { p: Palette; role: string; visit?: Visit; op?: Operation; plans: z.infer<typeof routinePlanSchema>; today: string; onClose: () => void; onRecord: () => void; onDone: () => Promise<void> }) {
  const plan = plans.find(x => x.lastVisit?.workId === visit?.workId) ?? plans.find(x => x.title === visit?.title && x.propertyName === visit?.propertyName);
  const data = op?.data ?? {}, form = visitFormOf(data);
  // The visit's own checklist (copied from its plan), else the plan's, else the list for its type.
  const items = visit ? (op ? visitChecklist({ title: visit.title, data }) : plan?.checklist ?? visitChecklist({ title: visit.title })) : [];
  return (
    <Sheet palette={p} visible={!!visit} onClose={onClose} title={visit?.title ?? ""} subtitle={visit ? `${visit.propertyName} · ${visit.dueOn ? dayLabel(visit.dueOn) : ""}` : ""} icon="toolbox">
      {form
        ? <>
          <Text style={{ color: p.text, fontWeight: "700" }}>Visit form · {form.doneCount} of {form.totalCount} done</Text>
          {form.answers.map(a => <View key={a.item} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}><Feather name={a.done ? "check-square" : "square"} size={16} color={a.done ? p.success : p.muted} style={{ marginTop: 2 }} /><Text style={{ color: a.done ? p.text : p.muted, flex: 1 }}>{a.item}{a.note ? `: ${a.note}` : ""}</Text></View>)}
          {!!form.note && <Text style={[ui.small, { color: p.muted }]}>{form.note}</Text>}
        </>
        : items.map(item => <View key={item} style={[ui.row, { gap: 10 }]}><Feather name="check" size={16} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>{item}</Text></View>)}
      <VisitDates p={p} data={data} today={today} />
      {visit && <VisitMoves key={visit.workId + ":" + (op?.version ?? visit.version)} p={p} role={role} visit={{ workId: visit.workId, version: op?.version ?? visit.version, title: visit.title, propertyName: visit.propertyName, status: visit.status, data }} onRecord={onRecord} onDone={onDone} />}
      {visit && <PropertyTeamChatButton palette={p} propertyId={visit.propertyId} workId={visit.workId} />}
    </Sheet>
  );
}
