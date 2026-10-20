import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PropertyTeamChatButton } from "./PropertyTeamChat";
import { FlagButton } from "./ManagementFlag";
import { AirCoverFlag } from "./AirCoverFlag";
import { Linking, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Text } from "./Typography";
import { ChoiceField } from "./ChoiceField";
import { ListSearchBox, PropertySelect, SearchPicker, useListSearch } from "./SearchPicker";
import { CHOOSE_PROPERTY_FIRST, saveDisabled } from "../../lib/search-picker";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { Dropdown } from "./Dropdown";
import { icon, radius, space, textSize, ui, type Palette } from "./theme";
import { addDays, Anchor, Button, dayLabel, Field, LIST_PREVIEW, london, message, Notice, Section, ShowMore, Tag, useRequestId, useWorkFocus, Loading } from "./LiveKit";
import { formatDay, formatMoney } from "../../lib/format";
import { raisedByLine } from "../../lib/cleaner-repairs";
import { readOperations, readTeams, readWorkMedia, workspaceRequest, writeInbox, writeOperation, writeTeams } from "./backend/client";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { PropertyAccess } from "./LiveTools";
import { REPAIR_GUIDES, SAFETY_STOP, repairTypeLabel, troubleshootingNote, type RepairType } from "../../lib/repair-guides";
import { profileAccess, reservationsSchema, stayLines, type StayLine } from "../../lib/property-profile";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import { scheduleSchema } from "../../lib/cleans-live";
import { canStart } from "../../lib/home-tools";
import { canCloseRepair, canReportRepair, canResolveRepair, canReviseQuote, daysFromNow, declineNote, londonDayOf, poundsToMinor, repairClosed, repairStage, repairStep, REPAIR_STAGES, RESOLUTION_MAX, RESOLUTION_MIN, routinePlanSchema, VISIT_KIND_LABEL, VISIT_KINDS, visitChecklist, visitDates, visitFormOf, visitKindOfSub, visitType, type RepairStep, type VisitKind } from "../../lib/repairs-live";
import { VisitDates, VisitForm, VisitMoves } from "./VisitForm";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { canFlagAirCover } from "../../lib/aircover-flag";
import { PurchaseOrdersList } from "./PurchaseOrdersList";
import type { SectionProps } from "./SectionProps";
import { pillBox, pillInk } from "./Pills";
import { autoApprovalLabel, QUOTE_SOURCE_LABEL, repairWhatsAppLink, type QuoteSource } from "../../lib/repair-approvals";
import {
  assignedContractor, bookingData, canReassign, clashesOf, completeData, contractorAction, contractorStage, estimateData, fixedInChatMessage, guestConversationOf,
  invoiceFilesOf, matchStay, quoteFilesOf, reassignData, referData, REASSIGN_STEP, reviewData, seesGuestChat, VISIT_TIMES, visitGuestUpdate, type ChatPrefill, type Clash,
} from "../../lib/repair-contractors";
import { ClashNotice, ContractorLine, ContractorPicker, EstimatePreview, GuestChatLink, RepairFileList, RepairFiles, REVIEW_CAPTION, useGuestSend, VisitDetails } from "./RepairContractors";

// The London day a cleaner reported a repair, for "Reported by".
const reportedDay = (iso: string) => formatDay(londonDayOf(iso) ?? iso.slice(0, 10));

// Live repairs: the maintenance pipeline from report to completed repair, and
// Ready's routine visits. Every action here is checked again by the database.
type Operation = z.infer<typeof operationViewSchema>;
type Visit = z.infer<typeof scheduleSchema>["work"][number];
const pounds = (minor: unknown) => typeof minor === "number" ? formatMoney(minor) : "–";
// A repair reported with no estimate waits in triage; say so rather than showing £0.00.
const estimateText = (data: Record<string, unknown>) => data.estimatedCostMinor === 0 && data.phase === "triage" ? "Cost not known yet" : `Estimate ${pounds(data.estimatedCostMinor)}`;
const SOURCE_OPTIONS = (["team", "contractor"] as const).map(value => ({ value, label: QUOTE_SOURCE_LABEL[value] }));
const STEP_TITLE: Record<RepairStep, string> = { approveBudget: "Approve the repair cost", approveManagement: "Approve the cost (management)", reviewDone: "Review done", referReady: "Send to contractor", bookRepair: "Book the visit", completeRepair: "Mark done" };
const TIME_OPTIONS = VISIT_TIMES.map(t => ({ value: t, label: t }));
// The step this person takes on a repair. A contractor on a job given to them follows its own steps (send an estimate,
// book once approved, mark done); older repairs with no contractor named, and the team, follow repairStep as before.
function stepFor(account: WorkspaceAccount, data: Record<string, unknown>): RepairStep | null {
  if (account.role === "ready" && assignedContractor(data)) {
    const next = contractorAction(account.role, account.userId, data);
    return next === "book" ? "bookRepair" : next === "complete" ? "completeRepair" : null;
  }
  return repairStep(account.role, String(data.phase), account.teamOnly);
}
// A contractor's estimate is their next step too.
const contractorEstimates = (account: WorkspaceAccount, data: Record<string, unknown>) => contractorAction(account.role, account.userId, data) === "estimate";

// `sectionProps` (from the Work area) lets Ready also see the purchase orders below the repairs.
export function LiveRepairs({ palette: p, account, properties, showRoutines = true, sectionProps }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; showRoutines?: boolean; sectionProps?: SectionProps }) {
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
  // The visit type shown under Preventative maintenance: the menu's Garden Maintenance and Waste Collection preset
  // garden or bins (focus sub "visits-garden"); the person can go back to all visits.
  const [visitKind, setVisitKind] = useState<VisitKind | "all">(() => visitKindOfSub(focus?.sub) ?? "all");

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
  const mineToAct = repairs.filter(r => stepFor(account, r.data) || contractorEstimates(account, r.data) || canCloseRepair(account.role, String(r.data.phase)));
  const inStage = stage === "open" ? repairs.filter(r => !repairClosed(String(r.data.phase))) : stage === "action" ? mineToAct : repairs.filter(r => repairStage(r.data) === stage);
  const search = useListSearch(inStage, r => [nameOf(r.propertyId), r.title, r.data.issue, typeof r.data.repairType === "string" ? repairTypeLabel(r.data.repairType) : "", REPAIR_STAGES.find(s => s.phase === repairStage(r.data))?.label], LIST_PREVIEW + 2), shown = search.shown;
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
  const kindOf = (v: Visit) => visitType(v.title, visitOps.find(o => o.workId === v.workId)?.data);
  const openVisits = visits.filter(v => v.status !== "completed"), shownVisits = openVisits.filter(v => visitKind === "all" || kindOf(v) === visitKind);
  const recording = visits.find(v => v.workId === recordingId), recordingOp = visitOps.find(o => o.workId === recordingId);

  return (
    <View style={{ gap: space.section }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Maintenance</Text>
        <Text style={[ui.body, { color: p.muted }]}>{account.role === "client" ? "Repairs at your properties, and costs waiting for your approval." : "Every repair from report to completion, with routine visits."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      {canStart(account, "report-repair") && <Button label="Report a repair" icon="alert-triangle" primary p={p} onPress={() => setReporting(true)} />}

      <Section title="Reactive maintenance" p={p}>
        <Dropdown p={p} label="Show" value={stage} onChange={setStage}
          options={[{ value: "action", label: `Needs you · ${mineToAct.length}` }, { value: "open", label: "All open" }, ...REPAIR_STAGES.map(s => ({ value: s.phase, label: `${s.label} · ${counts[s.phase] ?? 0}` }))]} />
        <ListSearchBox p={p} search={search} nouns="repairs" />
        {search.missed ? null : shown.length ? <View style={{ borderRadius: radius.tile, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, overflow: "hidden" }}>
          {shown.map((r, i) => {
            const phase = String(r.data.phase), step = stepFor(account, r.data), stageNow = repairStage(r.data), label = REPAIR_STAGES.find(s => s.phase === stageNow)?.label ?? phase;
            const declined = declineNote(r.data), followUp = canCloseRepair(account.role, phase);
            const problem = typeof r.data.issue === "string" && r.data.issue ? r.data.issue : r.title;
            const updated = londonDayOf(r.lastActivityAt ?? r.updatedAt);
            const flags = [r.data.urgent === true && "Urgent", r.data.hazard === true && "Safety hazard"].filter(Boolean).join(" · ");
            // The team see when a cleaner raised it (migration 20261023100000); owners and contractors never do.
            const fromCleaner = !["client", "ready"].includes(account.role) && !!raisedByLine(r.data, reportedDay);
            const next = step ? (step === "bookRepair" && account.role === "ready" ? "Approved, please book" : STEP_TITLE[step]) : contractorEstimates(account, r.data) ? "Send an estimate" : followUp ? "Update the quote or close the repair" : "";
            return (
              // One thin row a repair: property and problem, then status, cost and when it last moved.
              <MotionPress key={r.workId} accessibilityRole="button" accessibilityLabel={`${nameOf(r.propertyId)}, ${label}${next ? ". Next for you: " + next : ""}`} onPress={() => setOpenId(r.workId)}
                style={[ui.row, { gap: space.row, minHeight: 56, paddingVertical: 8, paddingHorizontal: space.field, borderTopWidth: i ? 1 : 0, borderColor: p.border, borderLeftWidth: 3, borderLeftColor: next ? p.primary : "transparent" }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontSize: 14 }}><Text style={{ fontWeight: "600" }}>{nameOf(r.propertyId)}</Text>{` · ${problem}`}</Text>
                  {/* Status, cost and last update wrap rather than run past the edge on a phone; urgent and hazard get their own line. */}
                  <Text style={[ui.small, { color: p.muted }]}>
                    <Text style={{ color: stageNow === "paid" || phase === "completed" || phase === "resolved" ? p.success : step ? p.waiting : p.muted, fontWeight: "600" }}>{label}</Text>
                    {` · ${estimateText(r.data)}${updated ? ` · updated ${daysFromNow(updated, today)}` : ""}`}
                  </Text>
                  {!!flags && <Text style={[ui.small, { color: p.danger, fontWeight: "600" }]}>{flags}</Text>}
                  {fromCleaner && <Text style={[ui.small, { color: p.muted }]}>Reported by a cleaner</Text>}
                  {!!declined && <Text numberOfLines={1} style={[ui.small, { color: p.danger, fontWeight: "600" }]}>{declined}</Text>}
                  {!!next && <Text numberOfLines={1} style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Next for you: {next}</Text>}
                </View>
                <Feather name="chevron-right" size={icon.row} color={p.muted} />
              </MotionPress>
            );
          })}
        </View> : !loading && <Notice text={stage === "action" ? "Nothing is waiting for you." : "No repairs in this view."} p={p} />}
        <ShowMore p={p} hidden={search.hidden} onPress={search.showAll} noun="more repairs" />
      </Section>

      {routines && showRoutines && (
        <Section title="Preventative maintenance" p={p}>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label="New routine" icon="repeat" quiet p={p} onPress={() => setPlanning(true)} />
            <Button label={creatingVisits ? "Creating visits…" : "Create this month's visits"} icon="calendar" p={p} disabled={!plans.length || creatingVisits} onPress={() => void createVisits()} />
          </View>
          <Dropdown p={p} label="Visit type" value={visitKind} onChange={setVisitKind}
            options={[{ value: "all" as const, label: "All visits" }, ...VISIT_KINDS.map(k => ({ value: k, label: `${VISIT_KIND_LABEL[k]} · ${openVisits.filter(v => kindOf(v) === k).length}` }))]} />
          {shownVisits.length ? shownVisits.map(v => {
            const last = londonDayOf(visitDates(visitOps.find(o => o.workId === v.workId)?.data).lastDoneAt);
            return (
            <MotionPress key={v.workId} accessibilityRole="button" onPress={() => setVisitId(v.workId)} style={[ui.card, ui.between, { gap: 10, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "700" }}>{v.title}</Text><Text style={[ui.small, { color: p.muted }]}>{v.propertyName} · {v.dueOn ? dayLabel(v.dueOn) : "No date"}{v.assigneeName ? ` · ${v.assigneeName}` : ""}{last ? ` · last done ${daysFromNow(last, today)}` : ""}</Text></View>
              <Tag label={v.status === "in_review" ? "Awaiting sign-off" : v.status === "in_progress" ? "In progress" : v.status === "approved" ? "Signed off" : "To do"} tone={v.status === "in_review" ? "wait" : "plain"} p={p} />
            </MotionPress>
            );
          }) : !loading && <Notice text={visitKind !== "all" && openVisits.length ? `No open ${VISIT_KIND_LABEL[visitKind].toLowerCase()} visits. Choose All visits to see the others.` : plans.length ? "No open visits. Visits are created automatically for this month and next; create them now if one is missing." : "No routines yet. Add bins, garden or safety checks as a routine."} p={p} />}
          {plans.map(plan => <Text key={plan.id} style={[ui.small, { color: p.muted }]}>{plan.propertyName}: {plan.title} · {plan.frequency} on day {plan.dayOfMonth}{plan.active ? "" : " · paused"}</Text>)}
        </Section>
      )}

      {account.role === "ready" && !!sectionProps && account.modules.includes("purchase-order") && <Anchor id="section-purchase-orders"><PurchaseOrdersList {...sectionProps} /></Anchor>}

      <RepairSheet p={p} account={account} role={account.role} repair={open} propertyName={open ? nameOf(open.propertyId) : ""} today={today}
        ownerPhone={open ? sectionProps?.journeys.find(j => j.propertyId === open.propertyId)?.enquiry?.phone ?? null : null} onClose={() => setOpenId(null)} onDone={saved(async () => { setOpenId(null); await load(); })} />
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
    readWorkMedia(repair.workId).then(r => { const parsed = z.array(z.object({ id: z.string().uuid(), purpose: z.string(), format: z.string().nullable().optional() })).safeParse(r.data); if (active && parsed.success) setIds(parsed.data.filter(x => x.purpose === "maintenance" && x.format !== "pdf").map(x => x.id)); }).catch(() => undefined);
    return () => { active = false; };
  }, [repair.workId, repair.version]);
  const after = Array.isArray(repair.data.photoIds) ? repair.data.photoIds.filter((x): x is string => typeof x === "string") : [];
  const papers = [...quoteFilesOf(repair.data), ...invoiceFilesOf(repair.data)];
  const before = ids.filter(id => !after.includes(id) && !papers.includes(id));
  if (!before.length && !after.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {!!before.length && <><Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Before</Text><PhotoStrip p={p} ids={before} /></>}
      {!!after.length && <><Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>After</Text><PhotoStrip p={p} ids={after} /></>}
    </View>
  );
}

// ownerPhone: the owner's number from their enquiry, when we hold one, for "Send by WhatsApp".
function RepairSheet({ p, account, role, repair, propertyName, today, ownerPhone, onClose, onDone }: { p: Palette; account: WorkspaceAccount; role: string; repair?: Operation; propertyName: string; today: string; ownerPhone?: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const phase = String(repair?.data.phase ?? ""), step = repair ? stepFor(account, repair.data) : null;
  // Repairs with contractors: the contractor on the job, what they do next, and the guest conversation it came from.
  const contractor = repair ? assignedContractor(repair.data) : null, estimating = !!repair && contractorEstimates(account, repair.data);
  const contractorView = role === "ready" && !!contractor, chatId = repair ? guestConversationOf(repair.data) : null;
  const [quoteIds, setQuoteIds] = useState<string[]>([]), [invoiceIds, setInvoiceIds] = useState<string[]>([]);
  const [clashes, setClashes] = useState<Clash[] | null>(null), [reassigning, setReassigning] = useState(false);
  // "Fixed in chat": send the resolution to the guest (on by default), in words the person can change (null: the suggested words).
  const [tellGuest, setTellGuest] = useState(true), [guestNote, setGuestNote] = useState<string | null>(null);
  const guestSend = useGuestSend(phase === "triage" && seesGuestChat(role) ? chatId : null);
  // The contractor's quote or invoice files are still saving.
  const [filesUploading, setFilesUploading] = useState(false);
  const stage = repair ? contractorStage(repair.data) : null;
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
  const quoteRequest = useRequestId(repair && (quoting || estimating) ? ["quote", repair.workId, repair.version, fields.quote ?? "", fields.quoteReason ?? "", fields.quoteSource ?? "team", quoteIds.join(",")].join(":") : null);
  const reassignRequest = useRequestId(repair && reassigning ? ["reassign", repair.workId, repair.version, fields.newContractor ?? "", fields.reassignReason ?? ""].join(":") : null);
  const guestRequest = useRequestId(chatId && resolving ? ["fixed", chatId, fields.resolution ?? ""].join(":") : null);
  const resolveRequest = useRequestId(repair && resolving ? ["resolve", repair.workId, repair.version, fields.resolution ?? ""].join(":") : null);
  const declineRequest = useRequestId(repair && declining ? [declining, repair.workId, repair.version, fields.declineReason ?? ""].join(":") : null);
  const set = (k: string) => (v: string) => setFields(f => ({ ...f, [k]: v }));
  const f = (k: string) => fields[k] ?? "";
  // Reset only when a different repair (or a newer version of it) opens, not on every refresh of the list.
  const resetKey = repair ? repair.workId + ":" + repair.version : "", urgentNow = repair?.data.urgent === true;
  const contractorName = contractor?.name ?? "";
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setFields({ repairOn: today, visitFrom: "09:00", visitTo: "12:00", contractor: role === "ready" ? contractorName : "" }); setQuoteIds([]); setInvoiceIds([]); setFilesUploading(false); setClashes(null); setReassigning(false); setTellGuest(true); setGuestNote(null); setConsent(false); setTicked([]); setUrgent(urgentNow); setError(""); setQuoting(false); setAfterIds([]); setAddingBefore(false); setUploading(false); setDeclining(null); setResolving(false); } }); return () => { active = false; }; }, [resetKey, urgentNow, today, role, contractorName]);

  function build(): Record<string, unknown> | string {
    if (step === "approveBudget" && forOwner) return consent && f("ownerAgreement").trim().length >= 5 ? { consent: true, ownerAgreement: f("ownerAgreement").trim().slice(0, 500) } : "Add how the owner agreed and tick to record their approval.";
    if (step === "approveBudget") return consent ? { consent: true } : "Tick to approve the cost.";
    if (step === "approveManagement") return f("managementNote").trim() ? { note: f("managementNote").trim() } : {};
    if (step === "reviewDone") return reviewData(f("reviewNote"));
    if (step === "referReady") {
      const built = referData({ troubleshooting: troubleshootingNote(type, ticked, f("troubleshooting")), guestUpdate: f("guestUpdate"), urgent, warranty: f("warrantyContactEvidence"), warrantyNeeded: repair?.data.warrantyRequired === true, readyUserId: f("readyUserId") });
      return "error" in built ? built.error : built.data;
    }
    if (step === "bookRepair") {
      // The guest update says when, unless the person writes their own.
      const suggested = /^\d{4}-\d{2}-\d{2}$/.test(f("repairOn")) && f("visitFrom") < f("visitTo") ? visitGuestUpdate(f("repairOn"), f("visitFrom"), f("visitTo")) : "";
      const built = bookingData({ day: f("repairOn"), from: f("visitFrom"), to: f("visitTo"), contractor: f("contractor"), guestUpdate: f("guestUpdate").trim() || suggested });
      return "error" in built ? built.error : built.data;
    }
    if (step === "completeRepair") {
      const built = completeData({ report: f("report"), cost: f("actualCost"), guestUpdate: f("guestUpdate").trim() || (contractorView ? "The repair is done." : ""), estimateMinor: repair?.data.estimatedCostMinor, photoIds: afterIds, invoiceIds });
      return "error" in built ? built.error : built.data;
    }
    return "Nothing to do.";
  }
  async function save() {
    if (!repair || !step || busy || uploading || filesUploading) return;
    const data = build();
    if (typeof data === "string") { setError(data); return; }
    setBusy(true); setError("");
    try {
      const result = await writeOperation({ action: "updateOperation", requestId: request.get(), workId: repair.workId, version: repair.version, step, data } as Parameters<typeof writeOperation>[0]);
      request.done();
      // A booking that overlaps a guest stay is saved, with a warning to read before the sheet closes.
      const overlaps = step === "bookRepair" ? clashesOf((result as { data?: unknown }).data) : [];
      if (overlaps.length) setClashes(overlaps); else await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  // A contractor's estimate: their price, what the work is and their quote. Management always approve it.
  async function sendEstimate() {
    if (!repair || busy || filesUploading) return;
    const built = estimateData(f("quote"), f("quoteReason"), quoteIds);
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: quoteRequest.get(), workId: repair.workId, version: repair.version, step: "reviseQuote", data: built.data } as Parameters<typeof writeOperation>[0]);
      quoteRequest.done(); setQuoting(false); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function reassign() {
    if (!repair || busy) return;
    const built = reassignData(f("newContractor"), contractor?.id ?? null, f("reassignReason"));
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: reassignRequest.get(), workId: repair.workId, version: repair.version, step: REASSIGN_STEP, data: built.data } as unknown as Parameters<typeof writeOperation>[0]);
      reassignRequest.done(); setReassigning(false); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function reviseQuote() {
    if (!repair || busy) return;
    const quote = poundsToMinor(f("quote"));
    if (quote === null || f("quoteReason").trim().length < 5) { setError("Add the new quote and why it changed."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: quoteRequest.get(), workId: repair.workId, version: repair.version, step: "reviseQuote", data: { quoteMinor: quote, reason: f("quoteReason").trim(), quoteSource: (f("quoteSource") || "team") as QuoteSource } } as Parameters<typeof writeOperation>[0]);
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
      resolveRequest.done();
    } catch (e) { setError(message(e)); setBusy(false); return; }
    // "Fixed in chat": the words go to the guest through the guest inbox's own send, when it can send.
    const words = (guestNote ?? fixedInChatMessage(resolution)).trim();
    if (chatId && guestSend === "send" && tellGuest && words) {
      try { await writeInbox({ action: "sendReply", requestId: guestRequest.get(), threadId: chatId, body: words }); guestRequest.done(); }
      catch (e) { setBusy(false); setError(`Marked as fixed. The message to the guest was not sent: ${message(e)} Send it from the guest chat.`); return; }
    }
    setBusy(false); setResolving(false); await onDone();
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
        {!["client", "ready"].includes(role) && <Detail label="Reported by" value={raisedByLine(repair.data, reportedDay)} p={p} />}
        <ContractorLine p={p} data={repair.data} />
        {seesGuestChat(role) && phase !== "triage" && <GuestChatLink p={p} data={repair.data} />}
        {!!declined && <Notice text={declined} p={p} tone="bad" />}
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Tag label={estimateText(repair.data)} tone="plain" p={p} />
          {typeof repair.data.repairType === "string" && <Tag label={repairTypeLabel(repair.data.repairType)} tone="plain" p={p} />}
          {repair.data.urgent === true && <Tag label="Urgent" tone="bad" p={p} />}
          {repair.data.hazard === true && <Tag label="Safety hazard" tone="bad" p={p} />}
          {repair.data.quoteSource === "contractor" && <Tag label="Contractor estimate" tone="plain" p={p} />}
          {role !== "ready" && !!autoApprovalLabel(repair.data) && <Tag label={autoApprovalLabel(repair.data)!} tone="good" p={p} />}
          {typeof repair.data.managementApprovedAt === "string" && <Tag label="Management approved" tone="good" p={p} />}
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
        {repair.data.contractor !== contractor?.name && <Detail label={contractor ? "Booked as" : "Contractor"} value={repair.data.contractor} p={p} />}
        <VisitDetails p={p} data={repair.data} />
        {phase === "booked" && !clashes && <ClashNotice p={p} clashes={clashesOf(repair.data)} forContractor={role === "ready"} />}
        <Detail label="Repair report" value={repair.data.report} p={p} />
        <Detail label="Latest guest update" value={repair.data.guestUpdate} p={p} />
        <RepairPhotos p={p} repair={repair} />
        <RepairFileList p={p} workId={repair.workId} ids={quoteFilesOf(repair.data)} title="Contractor's quote" />
        <RepairFileList p={p} workId={repair.workId} ids={invoiceFilesOf(repair.data)} title="Contractor's invoice" />
        {team && ["referred", "booked"].includes(phase) && (addingBefore
          ? <PhotoPicker key={"before:" + resetKey} p={p} workId={repair.workId} purpose="maintenance" label="Photos before the repair" hint="The problem as you found it. Each photo is saved as you add it." onChange={(_ids, loading) => setUploading(loading)} />
          : <Button label="Add before photos" icon="camera" p={p} onPress={() => setAddingBefore(true)} />)}
        {step && !clashes && <Text accessibilityRole="header" style={{ color: p.text, fontSize: textSize.body, fontWeight: "600" }}>{forOwner ? "Record the owner's approval" : step === "referReady" ? "Try to fix it with the guest" : contractorView && step === "bookRepair" ? "Approved, please book" : STEP_TITLE[step]}</Text>}
        {step === "approveBudget" && forOwner && !declining && <Field label="How the owner agreed" value={f("ownerAgreement")} onChange={set("ownerAgreement")} p={p} placeholder="For example: by phone with the owner on 10 October" />}
        {step === "approveBudget" && !declining && (
          <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(c => !c)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: consent ? p.successWash : p.elevated }]}>
            <Feather name={consent ? "check-square" : "square"} size={20} color={consent ? p.success : p.muted} />
            <Text style={{ color: p.text, flex: 1 }}>{forOwner ? `The owner approved spending up to ${pounds(repair.data.estimatedCostMinor)} on this repair` : `I approve spending up to ${pounds(repair.data.estimatedCostMinor)} on this repair`}</Text>
          </MotionPress>
        )}
        <Detail label="How the owner agreed" value={repair.data.ownerAgreement} p={p} />
        {/* A contractor's estimate in team_review: management (admins) press Review done; Stays see it waiting for management.
            The owner's limit line is a preview (the database decides). Never shown to Ready. */}
        {phase === "team_review" && seesGuestChat(role) && <View style={{ gap: 10 }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "review" } } : {})}>
          <EstimatePreview p={p} role={role} data={repair.data} />
          {step === "reviewDone" ? <Field label="Note for the team (optional)" value={f("reviewNote")} onChange={set("reviewNote")} p={p} multiline placeholder="For example: checked against the last boiler repair" />
            : <Notice text="Waiting for management to review." p={p} />}
        </View>}
        {step === "approveManagement" && !declining && <>
          <Text style={[ui.small, { color: p.muted }]}>{repair.data.quoteSource === "contractor" ? "A contractor estimate, which management always approve." : "At or over the repair limit."}{typeof repair.data.ownerApprovedAt === "string" ? " The owner has already approved it." : " Once you approve, the owner is asked, unless they pre-authorised it on their set-up form."}</Text>
          <Field label="Note for the team (optional)" value={f("managementNote")} onChange={set("managementNote")} p={p} multiline />
        </>}
        {(step === "approveBudget" || step === "approveManagement" || closable) && (declining ? <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{declining === "close" ? "Close the repair" : forOwner ? "The owner declined the cost" : "Decline the cost"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{declining === "close" ? "The repair is closed without the work going ahead. The owner sees it in their updates." : role === "client" ? "Recharge sees your reason on the repair and can get a new quote or close it." : forOwner ? "Record what the owner said. The repair can then be re-quoted or closed." : "Stays see the reason on the repair and can re-quote or close it."}</Text>
          <Field label={declining === "close" ? "Why it is closed" : "Why"} value={f("declineReason")} onChange={set("declineReason")} p={p} multiline placeholder={declining === "close" ? "For example: the owner is arranging it themselves" : "For example: please get a second quote first"} />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : declining === "close" ? "Close the repair" : forOwner ? "Record the decline" : "Decline the cost"} primary p={p} disabled={busy} onPress={() => void decide()} />
            <Button label="Cancel" p={p} onPress={() => setDeclining(null)} />
          </View>
        </View> : <Button label={closable ? "Close the repair" : forOwner ? "The owner declined" : "Decline the cost"} icon="x" p={p} onPress={() => { setDeclining(closable ? "close" : "decline"); setError(""); }} />)}
        {step === "referReady" && <>
          <View style={{ gap: 8 }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "troubleshoot" } } : {})}>
            <GuestChatLink p={p} data={repair.data} />
            <Text style={{ color: p.text, fontWeight: "700" }}>{REPAIR_GUIDES[type].label}: go through these with the guest</Text>
            <View style={[ui.row, { gap: 8, padding: 10, borderRadius: radius.control, backgroundColor: p.cautionWash, alignItems: "flex-start" }]}><Feather name="alert-triangle" size={icon.row} color={p.danger} style={{ marginTop: 2 }} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{SAFETY_STOP}</Text></View>
            {REPAIR_GUIDES[type].checks.map(c => {
              const on = ticked.includes(c);
              return (
                <MotionPress key={c} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setTicked(t => on ? t.filter(x => x !== c) : [...t, c])} style={[ui.row, { gap: 12, minHeight: 46, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.control, backgroundColor: on ? p.successWash : p.elevated }]}>
                  <Feather name={on ? "check-square" : "square"} size={icon.control} color={on ? p.success : p.muted} />
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
          {/* Send to contractor: one named contractor gets the job, with what was tried and what the guest was told. */}
          <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "send-to-contractor" } } : {})}>
            <Text style={{ color: p.text, fontWeight: "700" }}>Send to contractor</Text>
            <Text style={[ui.small, { color: p.muted }]}>Can’t fix it in the chat? Send it to one contractor for an estimate. Management check the estimate before the visit is booked.</Text>
            <ContractorPicker p={p} propertyId={repair.propertyId} value={f("readyUserId")} onChange={set("readyUserId")} />
            <Detail label="What the contractor reads about the checks" value={troubleshootingNote(type, ticked, f("troubleshooting")).trim() || "Tick the checks above, or describe what you tried."} p={p} />
            <Field label="Update for the guest" value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline placeholder="For example: a contractor is being arranged and we will confirm a time" />
          </View>
        </>}
        {step === "bookRepair" && !clashes && <View style={{ gap: 10 }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "book" } } : {})}>
          {contractorView && <Text style={[ui.small, { color: p.muted }]}>Your estimate of {pounds(repair.data.estimatedCostMinor)} is approved. Choose the day and the time you will be there. Stays let the guest know.</Text>}
          <DateField p={p} label="Day of the visit" mode="single" wholeMonthLink={false} empty="Choose a date" today={today} value={{ from: f("repairOn"), to: f("repairOn") }} onChange={next => set("repairOn")(next.from)} />
          <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Dropdown p={p} label="From" value={f("visitFrom")} onChange={set("visitFrom")} options={TIME_OPTIONS} /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Dropdown p={p} label="To" value={f("visitTo")} onChange={set("visitTo")} options={TIME_OPTIONS} /></View>
          </View>
          {!contractorView && <Field label="Who is doing the repair" value={f("contractor")} onChange={set("contractor")} p={p} />}
          <Field label={contractorView ? "Note for the guest (optional, Stays pass it on)" : "Update for the guest (optional)"} value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline
            placeholder={/^\d{4}-\d{2}-\d{2}$/.test(f("repairOn")) && f("visitFrom") < f("visitTo") ? visitGuestUpdate(f("repairOn"), f("visitFrom"), f("visitTo")) : "When the visit is"} />
          <Text style={[ui.small, { color: p.muted }]}>If a guest is staying around then, you will see a warning once it is booked. It does not stop the booking.</Text>
        </View>}
        {!!clashes && <View style={{ gap: 10 }}>
          <Notice text="The visit is booked." p={p} />
          <ClashNotice p={p} clashes={clashes} forContractor={role === "ready"} />
          <Button label="Done" icon="check" primary p={p} onPress={() => void onDone()} />
        </View>}
        {step === "completeRepair" && <>
          <Field label="Repair report" value={f("report")} onChange={set("report")} p={p} multiline placeholder="What was fixed and anything still outstanding" />
          <Field label={`Actual cost (up to ${pounds(repair.data.estimatedCostMinor)})`} value={f("actualCost")} onChange={set("actualCost")} p={p} placeholder="£0.00" />
          <Field label={contractorView ? "Note for the guest (optional, Stays pass it on)" : "Update for the guest"} value={f("guestUpdate")} onChange={set("guestUpdate")} p={p} multiline placeholder={contractorView ? "The repair is done." : undefined} />
          <PhotoPicker key={"after:" + resetKey} p={p} workId={repair.workId} purpose="maintenance" label="After photos (optional)" hint="The finished repair. They go to Accounts with your report." onChange={(ids, loading) => { setAfterIds(ids); setUploading(loading); }} />
          <View {...(Platform.OS === "web" ? { dataSet: { repairSheet: "invoice" } } : {})}>
            <RepairFiles key={"invoice:" + resetKey} p={p} workId={repair.workId} label="Invoice (optional)" hint="A photo of the invoice, or the PDF. It goes to Accounts with the cost." onChange={(ids, loading) => { setInvoiceIds(ids); setFilesUploading(loading); }} />
          </View>
          <Text style={[ui.small, { color: p.muted }]}>Marking it done sends the cost to Accounts as a draft expense, with your report, the before and after photos and the invoice.</Text>
        </>}
        {contractorView && canReviseQuote(role, phase) && !clashes && (estimating || quoting ? <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "estimate" } } : {})}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{estimating ? "Send estimate" : "Send a new estimate"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>Your price for the job. Recharge check it before you book. The job shows “Approved, please book” once it is approved.</Text>
          <Field label="Your price" value={f("quote")} onChange={set("quote")} p={p} placeholder="£0.00" />
          <Field label="What the work is" value={f("quoteReason")} onChange={set("quoteReason")} p={p} multiline placeholder="For example: replace the kitchen tap cartridge, parts and labour" />
          <RepairFiles key={"quote:" + resetKey} p={p} workId={repair.workId} label="Your quote (optional)" hint="A photo of your written quote, or the PDF." onChange={(ids, loading) => { setQuoteIds(ids); setFilesUploading(loading); }} />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Sending…" : filesUploading ? "Saving files…" : "Send estimate"} icon="send" primary p={p} disabled={busy || filesUploading} onPress={() => void sendEstimate()} />
            {!estimating && <Button label="Cancel" p={p} onPress={() => setQuoting(false)} />}
          </View>
        </View> : <Button label="Send a new estimate" icon="edit-3" p={p} onPress={() => { setQuoting(true); setError(""); }} />)}
        {!contractorView && canReviseQuote(role, phase) && (quoting ? <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Update the quote</Text>
          <Text style={[ui.small, { color: p.muted }]}>{phase === "owner_declined" ? "The new quote goes back to the owner to approve (to management first if it needs it)." : "A higher quote under the repair limit is approved automatically. At or over it, management approve first, then the owner. A contractor estimate always goes to management. The repair carries on once approved."}</Text>
          <Field label={`New quote (now ${pounds(repair.data.estimatedCostMinor)})`} value={f("quote")} onChange={set("quote")} p={p} placeholder="£0.00" />
          <Field label="Why it changed" value={f("quoteReason")} onChange={set("quoteReason")} p={p} multiline placeholder="For example, the part needs replacing, not repairing" />
          <Text style={{ color: p.text, fontWeight: "600" }}>Where the quote came from</Text>
          <ChoiceField p={p} label="Where the quote came from" value={(f("quoteSource") || "team") as QuoteSource} onChange={set("quoteSource")} options={SOURCE_OPTIONS} />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : "Save the new quote"} primary p={p} disabled={busy} onPress={() => void reviseQuote()} />
            <Button label="Cancel" p={p} onPress={() => setQuoting(false)} />
          </View>
        </View> : <Button label="Update the quote" icon="edit-3" p={p} onPress={() => setQuoting(true)} />)}
        {canReassign(role, repair.data) && (reassigning ? <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "reassign" } } : {})}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Give the job to another contractor</Text>
          <Text style={[ui.small, { color: p.muted }]}>{contractor?.name ?? "The contractor"} will no longer see the job. Both of them are told.</Text>
          <ContractorPicker p={p} propertyId={repair.propertyId} value={f("newContractor")} onChange={set("newContractor")} exclude={contractor?.id} label="New contractor" />
          <Field label="Why it is moving" value={f("reassignReason")} onChange={set("reassignReason")} p={p} multiline placeholder="For example: not available until next week" />
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : "Change contractor"} primary p={p} disabled={busy} onPress={() => void reassign()} />
            <Button label="Cancel" p={p} onPress={() => setReassigning(false)} />
          </View>
        </View> : <Button label="Change contractor" icon="repeat" p={p} onPress={() => { setReassigning(true); setError(""); }} />)}
        {canResolveRepair(role, phase) && (resolving ? <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border }} {...(Platform.OS === "web" ? { dataSet: { repairSheet: "fixed-in-chat" } } : {})}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{chatId ? "Fixed in chat" : "Resolved without a visit"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>Use this when troubleshooting fixed it and no one needs to attend. The repair is closed as resolved and the owner and team are told.</Text>
          <Field label="What fixed it (the owner can read this)" value={f("resolution")} onChange={set("resolution")} p={p} multiline placeholder="For example: reset the boiler with the guest and the heating came back" />
          {!!chatId && (guestSend === null ? <Text style={[ui.small, { color: p.muted }]}>Checking the guest chat…</Text>
            : guestSend === "send" ? <>
              <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: tellGuest }} onPress={() => setTellGuest(t => !t)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.control, backgroundColor: tellGuest ? p.successWash : p.elevated }]}>
                <Feather name={tellGuest ? "check-square" : "square"} size={icon.control} color={tellGuest ? p.success : p.muted} />
                <Text style={{ color: p.text, flex: 1 }}>Send this to the guest in the chat</Text>
              </MotionPress>
              {tellGuest && <Field label="Message to the guest" value={guestNote ?? (f("resolution").trim() ? fixedInChatMessage(f("resolution")) : "")} onChange={setGuestNote} p={p} multiline />}
            </> : <>
              <Text style={[ui.small, { color: p.muted }]}>Messages can’t be sent to this guest from Recharge. Let them know in the chat.</Text>
              <GuestChatLink p={p} data={repair.data} />
            </>)}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label={busy ? "Saving…" : chatId && guestSend === "send" && tellGuest ? "Mark as fixed and send" : "Mark as resolved"} primary p={p} disabled={busy} onPress={() => void resolve()} />
            <Button label="Cancel" p={p} onPress={() => setResolving(false)} />
          </View>
        </View> : <Button label={chatId ? "Fixed in chat" : "Resolved without a visit"} icon="check-circle" p={p} onPress={() => { setResolving(true); setError(""); }} />)}
        {!step && contractorView && !estimating && <Notice text={stage === "review" ? `Being reviewed by the team. Recharge are checking your estimate of ${pounds(repair.data.estimatedCostMinor)}. You will be told when you can book.` : stage === "owner" ? `Waiting for the owner to approve your estimate of ${pounds(repair.data.estimatedCostMinor)}. You will be told when you can book.` : stage === "waiting" ? `Waiting for approval. Recharge are checking your estimate of ${pounds(repair.data.estimatedCostMinor)}. You will be told when you can book.` : stage === "declined" ? "Your estimate was declined. Recharge will be in touch." : stage === "done" ? "This job is done. Thank you." : "Nothing for you to do at this stage."} p={p} />}
        {!step && !contractorView && <Notice text={phase === "resolved" ? "This repair was resolved without a visit." : phase === "completed" ? "This repair is complete." : phase === "closed" ? "This repair was closed without the work going ahead." : closable ? "Update the quote to send it back for approval, or close the repair." : declined && role === "client" ? "Recharge will get a new quote or close this repair." : role === "ready" && phase === "triage" ? "Stays will send this to a contractor." : phase === "team_review" ? "Waiting for management to review the contractor's estimate." : "Nothing for you to do at this stage."} p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {step && !declining && !resolving && !reassigning && !clashes && <Button label={busy ? "Saving…" : uploading || filesUploading ? "Saving photos…" : forOwner ? "Record the owner's approval" : STEP_TITLE[step]} primary p={p} disabled={busy || uploading || filesUploading} onPress={() => void save()} />}
        {step === "reviewDone" && <Text style={[ui.small, { color: p.muted }]}>{REVIEW_CAPTION}</Text>}
        {team && <View style={{ gap: 6 }}>
          <Button label="Send by WhatsApp" icon="message-circle" p={p} onPress={() => void Linking.openURL(repairWhatsAppLink({
            propertyName, issue: typeof repair.data.issue === "string" ? repair.data.issue : repair.title, phase, estimateMinor: typeof repair.data.estimatedCostMinor === "number" ? repair.data.estimatedCostMinor : null,
            quoteSource: repair.data.quoteSource === "contractor" ? "contractor" : "team", autoApproval: autoApprovalLabel(repair.data), repairOn: typeof repair.data.repairOn === "string" ? repair.data.repairOn : null,
          }, ownerPhone)).catch(() => setError("WhatsApp could not be opened on this device."))} />
          <Text style={[ui.small, { color: p.muted }]}>{ownerPhone ? "Opens a chat with the owner, with the repair summary ready to send." : "Opens WhatsApp with the repair summary ready. Choose who to send it to."}</Text>
        </View>}
        {role !== "client" && <FlagButton p={p} role={role} target={{ workId: repair.workId, propertyId: repair.propertyId, title: `Repair at ${propertyName}` }} onDone={() => void onDone()} />}
        {canFlagAirCover(role) && <AirCoverFlag key={repair.workId} p={p} role={role} workId={repair.workId} title={`Repair at ${propertyName}`} />}
        {role !== "client" && <PropertyTeamChatButton palette={p} propertyId={repair.propertyId} workId={repair.workId} />}
      </>}
    </Sheet>
  );
}

function PropertyChips({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string; onChange: (id: string) => void }) {
  return <PropertySelect p={p} properties={properties} value={value} onChange={onChange} />;
}

// prefill: opened from a guest conversation ("Report a repair" in Messages → Guests): its property, stay and the
// conversation itself, so the repair links back to the chat.
export function ReportSheet({ p, account, visible, properties, onClose, onDone, prefill }: { p: Palette; account: WorkspaceAccount; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void>; prefill?: ChatPrefill }) {
  const [propertyId, setPropertyId] = useState(() => prefill?.propertyId ?? "");
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
      if (!active || !parsed.success) return;
      const lines = stayLines(parsed.data, london(new Date()), 6);
      setStays(lines);
      // From a guest chat: the stay it is about, when it is among them.
      if (prefill && propertyId === prefill.propertyId) setReservationId(matchStay(lines, prefill));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [canLink, propertyId, prefill]);
  const [issue, setIssue] = useState("");
  const [estimate, setEstimate] = useState("");
  const [source, setSource] = useState<QuoteSource>("team");
  const [hazard, setHazard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? "repair:" + propertyId + ":" + issue.trim() : null);
  async function save() {
    const cost = poundsToMinor(estimate);
    if (!propertyId || issue.trim().length < 5 || cost === null) { setError("Choose the property, describe the issue and add an estimate."); return; }
    setBusy(true); setError("");
    try { await writeOperation({ action: "createOperation", requestId: request.get(), propertyId, kind: "maintenance", data: { issue: issue.trim(), estimatedCostMinor: cost, hazard, repairType: type, urgent: urgent || hazard, ...(reservationId ? { reservationId } : {}), ...(account.role !== "client" && cost > 0 ? { quoteSource: source } : {}), ...(prefill ? { guestConversationId: prefill.guestConversationId } : {}) } }); request.done(); setIssue(""); setEstimate(""); setSource("team"); setHazard(false); setUrgent(false); setType("other"); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Report a repair" subtitle={account.role === "client" ? "Recharge check the cost with you when it needs your approval" : "Under the repair limit it is approved automatically. At or over it, management approve first, then the owner."} icon="hardhat">
      {!!prefill && <View {...(Platform.OS === "web" ? { dataSet: { repairSheet: "from-chat" } } : {})}><Notice text={`From the guest chat${prefill.guestName ? " with " + prefill.guestName : ""}. The repair links back to the conversation.`} p={p} /></View>}
      <PropertyChips p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <Text style={{ color: p.text, fontWeight: "700" }}>Type of repair</Text>
      <ChoiceField p={p} label="Type of repair" value={type} onChange={setType} options={(Object.keys(REPAIR_GUIDES) as RepairType[]).map(t => ({ value: t, label: REPAIR_GUIDES[t].label }))} />
      <Field label="What is wrong" value={issue} onChange={setIssue} p={p} multiline placeholder="For example: kitchen tap leaking under the sink" />
      {!!stays.length && <>
        <Text style={{ color: p.text, fontWeight: "700" }}>Which stay is this for? (optional)</Text>
        <SearchPicker p={p} options={stays.map(s => ({ id: s.id, label: s.dates + (s.when === "now" ? " · staying now" : "") }))} value={reservationId} onChange={setReservationId} clearable placeholder="Search the stays by date" nouns="stays" />
      </>}
      <Field label="Estimated cost" value={estimate} onChange={setEstimate} p={p} placeholder="£0.00" />
      {account.role !== "client" && !!poundsToMinor(estimate) && <>
        <Text style={{ color: p.text, fontWeight: "600" }}>Where the estimate came from</Text>
        <ChoiceField p={p} label="Where the estimate came from" value={source} onChange={setSource} options={SOURCE_OPTIONS} />
        {source === "contractor" && <Text style={[ui.small, { color: p.muted }]}>Management approve every contractor estimate, whatever the amount.</Text>}
      </>}
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: hazard }} onPress={() => setHazard(h => !h)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hazard ? p.dangerWash : p.elevated }]}>
        <Feather name={hazard ? "check-square" : "square"} size={20} color={hazard ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>This is a safety hazard</Text>
      </MotionPress>
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: urgent || hazard }} onPress={() => setUrgent(u => !u)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: urgent || hazard ? p.cautionWash : p.elevated }]}>
        <Feather name={urgent || hazard ? "check-square" : "square"} size={20} color={urgent || hazard ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>Urgent: guests can’t use the property properly until it’s fixed</Text>
      </MotionPress>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!propertyId && <Text style={[ui.small, { color: p.muted }]}>{CHOOSE_PROPERTY_FIRST}</Text>}
      <Button label={busy ? "Sending…" : "Report repair"} icon="send" primary p={p} disabled={saveDisabled(busy, propertyId)} onPress={() => void save()} />
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
  const pill = (on: boolean) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center" as const, ...pillBox(p, on) });
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="New routine" subtitle="Visits are created each period from this plan" icon="calendar">
      <PropertyChips p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([["routine-bin-garden-board", "Bins and garden"], ["safety-maintenance", "Safety checks"], ["ready-schedule", "Other Ready visit"]] as const).map(([id, label]) => (
          <MotionPress key={id} accessibilityRole="radio" accessibilityState={{ selected: moduleId === id }} onPress={() => setModuleId(id)} style={pill(moduleId === id)}><Text style={{ color: pillInk(p, moduleId === id), fontSize: 13, fontWeight: "600" }}>{label}</Text></MotionPress>
        ))}
      </View>
      <Field label="Title" value={title} onChange={setTitle} p={p} placeholder="For example: Monthly bins and garden" />
      <Field label="Checks, one per line" value={checks} onChange={setChecks} p={p} multiline />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["monthly", "quarterly"] as const).map(x => <MotionPress key={x} accessibilityRole="radio" accessibilityState={{ selected: frequency === x }} onPress={() => setFrequency(x)} style={pill(frequency === x)}><Text style={{ color: pillInk(p, frequency === x), fontSize: 13, fontWeight: "600" }}>{x === "monthly" ? "Monthly" : "Every 3 months"}</Text></MotionPress>)}
      </View>
      <Field label="Day of the month (1–28)" value={day} onChange={setDay} p={p} />
      {account.role === "ready" && <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: mine }} onPress={() => setMine(m => !m)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.elevated }]}><Feather name={mine ? "check-square" : "square"} size={20} color={mine ? p.success : p.muted} /><Text style={{ color: p.text, flex: 1 }}>Assign these visits to me</Text></MotionPress>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!propertyId && <Text style={[ui.small, { color: p.muted }]}>{CHOOSE_PROPERTY_FIRST}</Text>}
      <Button label={busy ? "Saving…" : "Save routine"} primary p={p} disabled={saveDisabled(busy, propertyId)} onPress={() => void save()} />
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
