import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { useCelebrate, useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId, useWorkFocus, Loading, RefreshButton, StatGrid, StatTile } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { PhotoPicker } from "./Photos";
import { DisputeSheet, type DisputeTarget } from "./CleanDisputes";
import { RateSheet } from "./CleanerPay";
import { ProblemForm } from "./CleanProblem";
import { PropertyTeamChatButton } from "./PropertyTeamChat";
import { CleanChecklist, ChecklistReview, type ChecklistState } from "./CleanChecklist";
import { ChecklistTemplatesSheet, useChecklistTemplates } from "./ChecklistTemplates";
import { CleanCheckForm, CleanCheckSummary, conditionOf, unanswered, type ItemRow } from "./CleanReport";
import { ui, type Palette } from "./theme";
import { readControls, readOperations, readTeams, writeOperation, writeTeams, writeWorkspace, WorkspaceApiError } from "./backend/client";
import { operationViewSchema, readableStage, type PropertyView } from "../../lib/workspace-view";
import { candidatesSchema, disputeFor, guestLine, monthPay, performanceSchema, problemsOf, scheduleSchema, type CleanerMonth } from "../../lib/cleans-live";
import { repairTypeLabel } from "../../lib/repair-guides";
import { formatDay, formatMoney } from "../../lib/format";
import { canStart } from "../../lib/home-tools";
import { checklistProgress, submitBlockers, templateFor, type ChecklistTemplate } from "../../lib/clean-checklist-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { readCleanCondition, type CleanCondition } from "../../lib/clean-report";
import { createOperationForms, type WorkflowForm } from "../../lib/workflow-forms";

// Live Cleans: the cleaner's own jobs and the cleaning team's schedule, reviews and
// assignments, read from and written to the backend. Nothing here uses sample data.
type Schedule = z.infer<typeof scheduleSchema>;
type Operation = z.infer<typeof operationViewSchema>;
type Performance = z.infer<typeof performanceSchema>;

const checklistOf = (op?: Operation) => Array.isArray(op?.data.checklist) ? (op!.data.checklist as unknown[]).filter((v): v is string => typeof v === "string") : [];
const phaseLabel: Record<string, string> = { assigned: "To do", review: "Waiting for review", accepted: "Accepted" };

export function LiveCleans({ palette: p, account, properties, onForm }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onForm?: (form: WorkflowForm) => void }) {
  const saved = useSaved();
  const manager = account.role !== "cleans";
  const today = london(new Date());
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [operations, setOperations] = useState<Operation[]>([]);
  // Open disputes about rejected cleans. Admins and cleaning managers decide them and set cleaners' pay.
  const [complaints, setComplaints] = useState<Operation[]>([]);
  const canDecide = ["admin", "super_admin", "cleaning_manager"].includes(account.role);
  const [dispute, setDispute] = useState<DisputeTarget | null>(null);
  const [rateFor, setRateFor] = useState<CleanerMonth | null>(null);
  const [performance, setPerformance] = useState<Performance>([]);
  const [day, setDay] = useState(today);
  const [cleaner, setCleaner] = useState("everyone");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focus = useWorkFocus();
  // Home's Today board opens a clean straight away.
  const [openJob, setOpenJob] = useState<string | null>(() => focus?.workId ?? null);
  const [creating, setCreating] = useState(() => focus?.open === "new-clean" && account.role !== "cleans");
  const [statementFor, setStatementFor] = useState<string | null>(null);
  // Clean checklists with their photo rules, kept by admins and cleaning managers.
  const templates = useChecklistTemplates(manager);
  const [editingChecklists, setEditingChecklists] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const from = addDays(today, -7), to = addDays(today, 28);
    const query: Record<string, string> = { section: "schedule", from, to };
    if (!manager) query.userId = account.userId;
    const [s, o, perf] = await Promise.allSettled([readTeams(query), readOperations(), readTeams({ section: "performance" })]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (o.status === "fulfilled") {
        const all = z.array(operationViewSchema).parse(o.value.data);
        setOperations(all.filter(op => op.kind === "cleaning"));
        setComplaints(all.filter(op => op.kind === "cleaning_complaint" && !["completed", "cancelled"].includes(op.status)));
      } else throw o.reason;
      if (perf.status === "fulfilled") setPerformance(performanceSchema.parse(perf.value.data));
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Your cleans could not be loaded. Pull to refresh."); }
    setLoading(false);
  }, [account.userId, manager, today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const byId = useMemo(() => new Map(operations.map(op => [op.workId, op])), [operations]);
  const cleans = schedule.work.filter(w => w.kind === "cleaning" && (cleaner === "everyone" || w.assigneeId === cleaner));
  const dayCleans = cleans.filter(w => w.dueOn === day);
  const dayStays = schedule.stays.filter(s => s.checkIn === day || s.checkOut === day);
  const toReview = operations.filter(op => op.data.phase === "review");
  // A clean cancelled with its stay keeps its phase, so the status decides what is still open.
  const unassigned = operations.filter(op => op.data.phase === "assigned" && !op.assigneeId && !["completed", "cancelled"].includes(op.status));
  const cleaners = Array.from(new Map(schedule.work.filter(w => w.kind === "cleaning" && w.assigneeId).map(w => [w.assigneeId!, w.assigneeName || "Cleaner"])).entries());
  const mine = performance.find(row => row.cleanerId === account.userId);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 2));
  const job = openJob ? byId.get(openJob) : undefined;
  const jobRow = openJob ? schedule.work.find(w => w.workId === openJob) : undefined;
  const guests = useMemo(() => new Map((schedule.cleanGuests ?? []).map(g => [g.workId, g])), [schedule.cleanGuests]);
  const propertyName = (id: string) => properties.find(x => x.id === id)?.name ?? schedule.work.find(w => w.propertyId === id)?.propertyName ?? "Property";
  const cleanerName = (id: unknown) => performance.find(r => r.cleanerId === id)?.fullName ?? cleaners.find(([cid]) => cid === id)?.[1] ?? "Cleaner";
  const decided = !manager ? (mine?.decidedComplaints ?? []) : [];

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{manager ? "Cleaning team" : "Your cleans"}</Text>
        <Text style={[ui.body, { color: p.muted }]}>{manager ? "Schedule, review and assign every clean you look after." : "Your jobs, checklists and results, straight from the office."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      <StatGrid>
        <StatTile p={p} icon="calendar" tone="cleans" label="Today" value={cleans.filter(w => w.dueOn === today).length} detail="Cleans due" />
        <StatTile p={p} icon={manager ? "eye" : "clock"} tone="cleans" label={manager ? "To review" : "This week"} value={manager ? toReview.length : cleans.filter(w => w.dueOn && w.dueOn >= today && w.dueOn <= addDays(today, 6)).length} detail={manager ? "Submitted cleans" : "Next 7 days"} attention={manager && toReview.length > 0} />
        <StatTile p={p} icon={manager ? "user-plus" : "award"} tone="cleans" label={manager ? "Unassigned" : "Accepted"} value={manager ? unassigned.length : mine?.accepted ?? 0} detail={manager ? "Need a cleaner" : "This month"} attention={manager && unassigned.length > 0} />
      </StatGrid>

      {!manager && mine && (mine.warning || mine.openComplaints.length > 0) && (
        <Section title="Needs your response" count={mine.openComplaints.filter(c => !c.cleanerStatement).length} p={p}>
          {mine.warning && <Notice text={`You have ${mine.rejected} rejected cleans this month. Management will review your work.`} p={p} tone="bad" />}
          {mine.openComplaints.map(c => {
            // The rejected clean itself carries the reviewer's reason.
            const source = c.sourceWorkId ? byId.get(c.sourceWorkId) : undefined;
            const reason = typeof source?.data.reviewNote === "string" ? source.data.reviewNote : null;
            return (
              <View key={c.workId} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
                <Text style={{ color: p.text, fontWeight: "700" }}>Rejected clean · {propertyName(c.propertyId)}</Text>
                {!!reason && <Text style={{ color: p.text }}>Why: {reason}</Text>}
                <Text style={[ui.small, { color: p.muted }]}>Raised {new Date(c.createdAt).toLocaleDateString("en-GB")}. Management decides after hearing from you.</Text>
                {c.cleanerStatement ? <Notice text={`Your response: ${c.cleanerStatement}`} p={p} /> : <Button label="Give your side" icon="message-square" p={p} onPress={() => setStatementFor(c.workId)} />}
              </View>
            );
          })}
        </Section>
      )}
      {!manager && decided.length > 0 && (
        <Section title="Disputes decided this month" p={p}>
          {decided.map(c => (
            <View key={c.workId} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={[ui.between, { gap: 8 }]}>
                <Text style={{ color: p.text, fontWeight: "700", flex: 1 }}>{propertyName(c.propertyId)}</Text>
                <Tag label={c.decision === "overturned" ? "Overturned" : "Upheld"} tone={c.decision === "overturned" ? "good" : "bad"} p={p} />
              </View>
              <Text style={[ui.small, { color: p.muted }]}>{c.decision === "overturned" ? "The rejection was overturned. It no longer counts against you." : "The rejection stands."}{c.decidedAt ? ` Decided ${formatDay(c.decidedAt.slice(0, 10))}.` : ""}</Text>
              {!!c.decisionNote && <Notice text={`Management: ${c.decisionNote}`} p={p} />}
            </View>
          ))}
        </Section>
      )}

      {manager && (
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {canStart(account, "new-clean") && <Button label="New clean" icon="plus" primary p={p} onPress={() => setCreating(true)} />}
          {templates.data?.canEdit && <Button label="Checklists" icon="check-square" p={p} onPress={() => setEditingChecklists(true)} />}
          <RefreshButton p={p} loading={loading} onPress={() => void load()} />
        </View>
      )}

      <Section title="Schedule" p={p}>
        {manager && cleaners.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[["everyone", "All cleaners"] as const, ...cleaners].map(([id, name]) => (
              <MotionPress key={id} accessibilityRole="button" accessibilityState={{ selected: cleaner === id }} onPress={() => setCleaner(id)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: cleaner === id ? p.primary : p.surface, borderWidth: 1, borderColor: cleaner === id ? p.primary : p.border }}>
                <Text style={{ color: cleaner === id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{name}</Text>
              </MotionPress>
            ))}
          </ScrollView>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map(d => {
            const on = d === day, count = cleans.filter(w => w.dueOn === d).length;
            return (
              <MotionPress key={d} accessibilityRole="button" accessibilityLabel={`${dayLabel(d)}, ${count} cleans`} accessibilityState={{ selected: on }} onPress={() => setDay(d)} style={{ width: 58, paddingVertical: 10, borderRadius: 16, alignItems: "center", gap: 4, backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
                <Text style={{ fontSize: 11, color: on ? p.onPrimary : p.muted }}>{dayLabel(d).split(" ")[0]}</Text>
                <Text style={{ fontSize: 17, fontWeight: "700", color: on ? p.onPrimary : p.text }}>{dayLabel(d).split(" ")[1]}</Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: count ? (on ? p.onPrimary : p.primary) : "transparent" }} />
              </MotionPress>
            );
          })}
        </ScrollView>
        <Text style={[ui.small, { color: p.muted }]}>{dayLabel(day)} · {dayCleans.length} {dayCleans.length === 1 ? "clean" : "cleans"}</Text>
        {dayStays.map(stay => (
          <View key={stay.reservationId + day} style={[ui.row, { gap: 10, paddingHorizontal: 4 }]}>
            <Feather name={stay.checkOut === day ? "log-out" : "log-in"} size={16} color={p.muted} />
            <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{stay.propertyName} · {stay.checkOut === day ? "Guests leave" : "Guests arrive"}{stay.guests ? ` · ${stay.guests} guests` : ""}</Text>
          </View>
        ))}
        {dayCleans.length ? dayCleans.map(w => {
          const op = byId.get(w.workId), phase = String(op?.data.phase ?? "");
          const people = guestLine(guests.get(w.workId)), redo = phase === "assigned" && op?.data.accepted === false, problems = op ? problemsOf(op.data).length : 0;
          return (
            <MotionPress key={w.workId} accessibilityRole="button" accessibilityLabel={`${w.propertyName}, ${phaseLabel[phase] ?? readableStage(w.status)}`} onPress={() => setOpenJob(w.workId)} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={ui.between}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{w.propertyName}</Text>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </View>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={phaseLabel[phase] ?? readableStage(w.status)} tone={phase === "accepted" ? "good" : phase === "review" ? "wait" : "plain"} p={p} />
                {redo && <Tag label="Not accepted" tone="bad" p={p} />}
                {manager && <Tag label={w.assigneeName ?? "Unassigned"} tone={w.assigneeName ? "plain" : "bad"} p={p} />}
                {problems > 0 && <Tag label={problems === 1 ? "Problem reported" : `${problems} problems reported`} tone="wait" p={p} />}
                <Text style={[ui.small, { color: p.muted }]}>{checklistOf(op).length} checks</Text>
              </View>
              {!!people && <View style={[ui.row, { gap: 8 }]}>
                <Feather name="users" size={14} color={p.muted} />
                <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{people}</Text>
              </View>}
            </MotionPress>
          );
        }) : !loading && <Notice text={manager ? "No cleans scheduled for this day." : "Nothing booked for you on this day."} p={p} />}
      </Section>

      {manager && (
        <>
          <Section title="Waiting for your review" count={toReview.length} p={p}>
            {toReview.length ? toReview.map(op => (
              <MotionPress key={op.workId} accessibilityRole="button" onPress={() => setOpenJob(op.workId)} style={[ui.card, { gap: 6, backgroundColor: p.surface, borderColor: p.border }]}>
                <Text style={{ color: p.text, fontWeight: "700" }}>{properties.find(x => x.id === op.propertyId)?.name ?? op.title}</Text>
                <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{typeof op.data.report === "string" ? op.data.report : "Report submitted"}</Text>
              </MotionPress>
            )) : <Notice text="Every submitted clean has been reviewed." p={p} />}
          </Section>
          {canDecide && (
            <Section title="Disputes to decide" count={complaints.length} p={p}>
              {complaints.length ? complaints.map(c => {
                const target: DisputeTarget = { workId: c.workId, propertyId: c.propertyId, version: c.version, cleanerName: cleanerName(c.data.cleanerId), propertyName: propertyName(c.propertyId) };
                const responded = typeof c.data.cleanerStatement === "string";
                return (
                  <MotionPress key={c.workId} accessibilityRole="button" accessibilityLabel={`Rejected clean by ${target.cleanerName} at ${target.propertyName}`} onPress={() => setDispute(target)} style={[ui.card, { gap: 6, backgroundColor: p.surface, borderColor: p.border }]}>
                    <View style={[ui.between, { gap: 8 }]}>
                      <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", flex: 1 }}>{target.cleanerName} · {target.propertyName}</Text>
                      <Feather name="chevron-right" size={18} color={p.muted} />
                    </View>
                    <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{typeof c.data.reviewNote === "string" ? `Rejected: ${c.data.reviewNote}` : "Rejected clean"}{typeof c.data.cleanedOn === "string" ? ` · cleaned ${formatDay(c.data.cleanedOn)}` : ""}</Text>
                    <Tag label={responded ? "Cleaner has responded" : "Awaiting cleaner"} tone={responded ? "plain" : "wait"} p={p} />
                  </MotionPress>
                );
              }) : <Notice text="No disputed cleans waiting for a decision." p={p} />}
            </Section>
          )}
          <Section title="Not yet assigned" count={unassigned.length} p={p}>
            {unassigned.length ? unassigned.map(op => (
              <MotionPress key={op.workId} accessibilityRole="button" onPress={() => setOpenJob(op.workId)} style={[ui.card, { gap: 6, backgroundColor: p.surface, borderColor: p.border }]}>
                <Text style={{ color: p.text, fontWeight: "700" }}>{properties.find(x => x.id === op.propertyId)?.name ?? op.title}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{typeof op.data.dueOn === "string" ? dayLabel(op.data.dueOn) : "No date"} · tap to assign a cleaner</Text>
              </MotionPress>
            )) : <Notice text="Every clean has a cleaner." p={p} />}
          </Section>
          <Section title="Cleaner performance this month" p={p}>
            {performance.length ? performance.map(row => {
              const pay = monthPay(row);
              return (
                <View key={row.cleanerId} style={[ui.card, { gap: 10, backgroundColor: p.surface, borderColor: p.border }]}>
                  <View style={[ui.between, { gap: 10 }]}>
                    <View style={{ flex: 1, gap: 2, minWidth: 0 }}><Text style={{ color: p.text, fontWeight: "700" }}>{row.fullName}</Text><Text style={[ui.small, { color: p.muted }]}>{row.accepted} accepted · {row.rejected} rejected{row.overturned ? ` · ${row.overturned} overturned` : ""}</Text></View>
                    <Tag label={row.warning ? "Warning" : "Good standing"} tone={row.warning ? "bad" : "good"} p={p} />
                  </View>
                  {canDecide && <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
                    <Text style={[ui.small, { color: p.muted, flex: 1, minWidth: 160 }]}>{pay.rateMinor === null ? "No pay rate set yet" : `${formatMoney(pay.rateMinor)} a clean · ${pay.label} this month`}</Text>
                    <MotionPress accessibilityRole="button" accessibilityLabel={`Set pay per clean for ${row.fullName}`} onPress={() => setRateFor(row)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>{pay.rateMinor === null ? "Set pay rate" : "Change rate"}</Text>
                    </MotionPress>
                  </View>}
                </View>
              );
            }) : <Notice text="Cleaner results appear after the first reviewed clean." p={p} />}
          </Section>
        </>
      )}
      {!manager && mine && (
        <Section title="Your month" p={p}>
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8 }]}>
            <View style={[ui.between, { gap: 12 }]}>
              <Text style={{ color: p.text, flex: 1, minWidth: 0 }}>{mine.accepted} accepted · {mine.rejected} rejected{mine.overturned ? ` · ${mine.overturned} overturned` : ""}</Text>
              <Tag label={mine.warning ? "Warning" : "Good standing"} tone={mine.warning ? "bad" : "good"} p={p} />
            </View>
            <Text style={[ui.small, { color: p.muted }]}>Amount for this month: {monthPay(mine).label}{monthPay(mine).rateMinor !== null ? ` (${monthPay(mine).detail})` : ""}</Text>
          </View>
        </Section>
      )}
      {!manager && <RefreshButton p={p} loading={loading} onPress={() => void load()} />}

      <JobSheet p={p} account={account} manager={manager} op={job} mine={mine} propertyName={jobRow?.propertyName ?? properties.find(x => x.id === job?.propertyId)?.name ?? "Clean"} onClose={() => setOpenJob(null)} onDone={saved(async () => { setOpenJob(null); await load(); })}
        onRespond={id => { setOpenJob(null); setStatementFor(id); }} onChanged={load} onForm={onForm && (f => { setOpenJob(null); onForm(f); })} />
      <CreateSheet p={p} visible={creating} properties={properties} templates={templates.data?.templates ?? []} onClose={() => setCreating(false)} onDone={saved(async () => { setCreating(false); await load(); })} today={today} />
      <ChecklistTemplatesSheet p={p} visible={editingChecklists} properties={properties} state={templates} onClose={() => setEditingChecklists(false)} />
      <StatementSheet p={p} workId={statementFor} onClose={() => setStatementFor(null)} onDone={saved(async () => { setStatementFor(null); await load(); })} />
      <DisputeSheet p={p} target={dispute} onClose={() => setDispute(null)} onDone={saved(load)} />
      <RateSheet p={p} cleaner={rateFor} onClose={() => setRateFor(null)} onDone={saved(load)} />
    </View>
  );
}

const MAIL_DONE = { photograph: "photographed it", open_and_photograph: "opened and photographed it", leave_safely: "left it somewhere safe" } as const;

// A purchase order or reactive maintenance job started from the clean report, when this person can raise one.
function followUp(account: WorkspaceAccount, propertyId: string, workId: string, kind: "purchase" | "maintenance", text: string): WorkflowForm | null {
  const form = createOperationForms(account, propertyId).find(f => f.key === kind);
  if (!form) return null;
  const field = kind === "purchase" ? "requirements" : "issue";
  return { ...form, key: `${kind}-from-clean-${workId}`, fields: form.fields.map(f => f.name === field ? { ...f, defaultValue: text } : f) };
}

function JobSheet({ p, account, manager, op, mine, propertyName, onClose, onDone, onRespond, onChanged, onForm }: { p: Palette; account: WorkspaceAccount; manager: boolean; op?: Operation; mine?: CleanerMonth; propertyName: string; onClose: () => void; onDone: () => Promise<void>; onRespond: (complaintWorkId: string) => void; onChanged: () => Promise<void>; onForm?: (form: WorkflowForm) => void }) {
  const checklist = checklistOf(op), phase = String(op?.data.phase ?? "");
  // The last review's reason when it was a rejection, where its dispute is up to, and problems reported.
  const rejection = op?.data.accepted === false && typeof op.data.reviewNote === "string" ? op.data.reviewNote : null;
  const feedback = op && typeof op.data.guestFeedback === "string" ? op.data.guestFeedback : null;
  const dispute = disputeFor(op, mine);
  const problems = op ? problemsOf(op.data) : [];
  const mineToDo = !manager && !!op && op.assigneeId === account.userId && !["completed", "cancelled"].includes(op.status);
  const [reporting, setReporting] = useState(false);
  const celebrate = useCelebrate();
  const [ticked, setTicked] = useState<string[]>([]);
  const [report, setReport] = useState("");
  const [answers, setAnswers] = useState<Partial<CleanCondition>>({});
  const [items, setItems] = useState<ItemRow[]>([]);
  const submitted = readCleanCondition(op?.data.condition);
  const [mailDone, setMailDone] = useState(false);
  const [mailNote, setMailNote] = useState("");
  const [mailPhotos, setMailPhotos] = useState<{ ids: string[]; uploading: boolean }>({ ids: [], uploading: false });
  const onMailPhotos = useCallback((ids: string[], uploading: boolean) => setMailPhotos({ ids, uploading }), []);
  const mailPreference = typeof op?.data.mailPreference === "string" && op.data.mailPreference in MAIL_DONE ? op.data.mailPreference as keyof typeof MAIL_DONE : null;
  // Clean photos are queued on the device and upload in the background (PhotoPicker, CleanChecklist).
  const [photos, setPhotos] = useState<{ ids: string[]; uploading: boolean }>({ ids: [], uploading: false });
  const onCleanPhotos = useCallback((ids: string[], uploading: boolean) => setPhotos({ ids, uploading }), []);
  const [list, setList] = useState<ChecklistState | null>(null);
  const onList = useCallback((state: ChecklistState) => setList(state), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [guestFeedback, setGuestFeedback] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [candidates, setCandidates] = useState<z.infer<typeof candidatesSchema>>([]);
  const request = useRequestId(op ? op.workId + ":" + op.version : null);
  const canSubmit = !manager && op?.assigneeId === account.userId && phase === "assigned";
  const canReview = manager && phase === "review" && op?.assigneeId !== account.userId;
  const canAssign = manager && phase === "assigned" && !!op && !["completed", "cancelled"].includes(op.status);

  // A fresh form for each clean opened. Reloading the same clean (after reporting a problem) keeps
  // the ticks, report and photos already added.
  const workId = op?.workId;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; setTicked([]); setReport(""); setAnswers({}); setItems([]); setList(null); setMailPhotos({ ids: [], uploading: false }); setError(""); setAccepted(null); setGuestFeedback(""); setReviewNote(""); setReporting(false); });
    return () => { active = false; };
  }, [workId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setCandidates([]); });
    if (op && canAssign) readControls({ section: "resources", propertyId: op.propertyId, workId: op.workId }).then(r => { if (active) setCandidates(candidatesSchema.parse(r.data).filter(c => c.role === "cleans")); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [op, canAssign]);

  async function run(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); request.done(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const verified = photos.ids;
  const postPhotos = mailDone && (mailPreference === "photograph" || mailPreference === "open_and_photograph");
  // Photos taken on checks count as photos of the clean, and go with it (up to 30).
  const progress = list?.progress ?? checklistProgress(checklist, ticked, [], {});
  const sent = [...new Set([...verified, ...(list?.photoIds ?? [])])].slice(0, 30);
  const left = unanswered(answers);
  const blockers = [...submitBlockers(progress, { report, savedPhotos: sent.length, uploading: photos.uploading || !!list?.uploading || (postPhotos && mailPhotos.uploading) }),
    ...(left ? [`Answer the property check (${left} question${left === 1 ? "" : "s"} left).`] : [])];
  const condition = conditionOf(answers, items);
  const purchaseForm = op && submitted ? followUp(account, op.propertyId, op.workId, "purchase", "") : null;
  const repairForm = op && submitted ? followUp(account, op.propertyId, op.workId, "maintenance", "") : null;
  const ready = !blockers.length;

  return (
    <Sheet palette={p} visible={!!op} onClose={onClose} title={propertyName} subtitle={op ? `${typeof op.data.dueOn === "string" ? dayLabel(op.data.dueOn) : ""} · ${phaseLabel[phase] ?? readableStage(op.status)}` : ""} icon="spray">
      {op && <>
        {!!rejection && <View style={{ gap: 6 }}>
          <Notice text={`${dispute?.status === "overturned" ? "Rejected, then overturned" : phase === "assigned" ? "Not accepted" : "Earlier review, not accepted"}: ${rejection}`} p={p} tone={dispute?.status !== "overturned" && phase === "assigned" ? "bad" : "plain"} />
          {!!feedback && <Text style={[ui.small, { color: p.muted }]}>Guest feedback: {feedback}</Text>}
        </View>}
        {!!dispute && <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.between, { gap: 8 }]}>
            <Text style={{ color: p.text, fontWeight: "700", flex: 1 }}>Dispute</Text>
            <Tag label={dispute.status === "open" ? "Waiting for management" : dispute.status === "overturned" ? "Overturned" : "Upheld"} tone={dispute.status === "open" ? "wait" : dispute.status === "overturned" ? "good" : "bad"} p={p} />
          </View>
          <Text style={[ui.small, { color: p.muted }]}>{dispute.status === "open" ? "Management decides whether the rejection stands, after hearing from the cleaner." : dispute.status === "overturned" ? "The rejection was overturned. It no longer counts against the cleaner." : "Management decided the rejection stands."}</Text>
          {!!dispute.note && <Notice text={`Management: ${dispute.note}`} p={p} />}
          {dispute.status === "open" && !manager && (dispute.statement ? <Notice text={`Your response: ${dispute.statement}`} p={p} />
            : !dispute.responded && !!dispute.complaintWorkId && <Button label="Give your side" icon="message-square" p={p} onPress={() => onRespond(dispute.complaintWorkId!)} />)}
        </View>}
        {!!problems.length && <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Problems reported</Text>
          {problems.map(x => (
            <View key={x.repairWorkId} style={{ gap: 4, padding: 12, borderRadius: 14, backgroundColor: p.wash }}>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={repairTypeLabel(x.repairType)} tone="plain" p={p} />
                {x.urgent && <Tag label="Urgent" tone="bad" p={p} />}
              </View>
              <Text style={{ color: p.text }}>{x.issue}</Text>
              <Text style={[ui.small, { color: p.muted }]}>Sent to the Stays team{x.photos ? ` with ${x.photos} photo${x.photos === 1 ? "" : "s"}` : ""} · {formatDay(x.reportedAt.slice(0, 10))}</Text>
            </View>
          ))}
        </View>}
        {canSubmit && <>
          <CleanChecklist key={op.workId} p={p} workId={op.workId} checklist={checklist} ticked={ticked} onState={onList}
            onToggle={item => setTicked(current => current.includes(item) ? current.filter(x => x !== item) : [...current, item])} />
          <PhotoPicker key={op.workId} p={p} workId={op.workId} purpose="cleaning" label="Photos" max={50} onChange={onCleanPhotos} />
          <Field label="Report" value={report} onChange={setReport} p={p} multiline placeholder="What you cleaned, anything broken or missing, Wi-Fi checked" />
          <CleanCheckForm p={p} answers={answers} items={items} onAnswers={setAnswers} onItems={setItems} />
          {/* The owner's mailbox permission from onboarding: the cleaner records doing exactly that. */}
          {mailPreference && <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Post</Text>
            <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: mailDone }} onPress={() => setMailDone(v => !v)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: mailDone ? p.successWash : p.elevated }]}>
              <Feather name={mailDone ? "check-square" : "square"} size={20} color={mailDone ? p.success : p.muted} />
              <Text style={{ color: p.text, flex: 1 }}>There was post, and I {MAIL_DONE[mailPreference]} as the owner asked</Text>
            </MotionPress>
            {mailDone && <Field label="Note for the owner (optional)" value={mailNote} onChange={setMailNote} p={p} placeholder="For example, two letters left on the kitchen table" />}
            {postPhotos && <PhotoPicker key={op.workId} p={p} workId={op.workId} purpose="mailbox" label="Photos of the post" hint="The owner sees these in their Mailbox." onChange={onMailPhotos} />}
          </View>}
          <Button label={busy ? "Sending…" : "Submit clean"} icon="send" primary p={p} disabled={!ready || busy}
            onPress={() => void run(() => writeOperation({ action: "updateOperation", requestId: request.get(), workId: op.workId, version: op.version, step: "submitCleaning", data: { checks: checklist, report: report.trim(), photoIds: sent, ...(condition ? { condition } : {}), mailAction: mailPreference && mailDone ? mailPreference : "none", ...(mailPreference && mailDone && mailNote.trim() ? { mailNote: mailNote.trim().slice(0, 500) } : {}), ...(postPhotos && mailPhotos.ids.length ? { mailPhotoIds: mailPhotos.ids } : {}) } }))} />
          {!ready && <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>{blockers.map(b => <Text key={b} style={[ui.small, { color: p.muted }]}>{b}</Text>)}</View>}
        </>}

        {!canSubmit && submitted && <CleanCheckSummary p={p} condition={submitted}
          onPurchase={purchaseForm && onForm ? text => onForm(followUp(account, op.propertyId, op.workId, "purchase", text)!) : undefined}
          onRepair={repairForm && onForm ? text => onForm(followUp(account, op.propertyId, op.workId, "maintenance", text)!) : undefined} />}
        {canReview && <>
          <Notice text={typeof op.data.report === "string" ? `Cleaner's report: ${op.data.report}` : "The cleaner has submitted this clean."} p={p} />
          <ChecklistReview key={op.workId} p={p} workId={op.workId} checklist={checklist} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MotionPress accessibilityRole="radio" accessibilityState={{ selected: accepted === true }} onPress={() => setAccepted(true)} style={[ui.button, { flex: 1, backgroundColor: accepted === true ? p.success : p.wash }]}><Text style={[ui.buttonText, { color: accepted === true ? "#FFFFFF" : p.primary }]}>Accept</Text></MotionPress>
            <MotionPress accessibilityRole="radio" accessibilityState={{ selected: accepted === false }} onPress={() => setAccepted(false)} style={[ui.button, { flex: 1, backgroundColor: accepted === false ? p.danger : p.wash }]}><Text style={[ui.buttonText, { color: accepted === false ? p.onPrimary : p.primary }]}>Reject</Text></MotionPress>
          </View>
          <Field label="Guest feedback" value={guestFeedback} onChange={setGuestFeedback} p={p} multiline placeholder="What guests said, or 'No comments'" />
          <Field label="Your review" value={reviewNote} onChange={setReviewNote} p={p} multiline placeholder={accepted === false ? "What was not up to standard" : "What you checked"} />
          {accepted === false && <Text style={[ui.small, { color: p.muted }]}>A rejection is shared with the cleaner, who can respond before management decides.</Text>}
          <Button label={busy ? "Saving…" : "Save review"} primary p={p} disabled={busy || accepted === null || guestFeedback.trim().length < 5 || reviewNote.trim().length < 5}
            onPress={() => void run(() => writeOperation({ action: "updateOperation", requestId: request.get(), workId: op.workId, version: op.version, step: "reviewCleaning", data: { accepted: accepted === true, guestFeedback: guestFeedback.trim(), reviewNote: reviewNote.trim() } }))} />
        </>}

        {canAssign && <>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{op.assigneeId ? "Reassign this clean" : "Assign a cleaner"}</Text>
          {candidates.length ? candidates.map(c => (
            <Button key={c.userId} label={c.fullName + (c.userId === op.assigneeId ? " · assigned" : "")} icon="user" p={p} disabled={busy || c.userId === op.assigneeId}
              onPress={() => void run(() => writeWorkspace({ action: "assignWork", workId: op.workId, version: op.version, userId: c.userId }))} />
          )) : <Notice text="No cleaner can take this clean yet. In Work, Management, People, open a cleaner and give them this property, or every property." p={p} />}
        </>}

        {!canSubmit && !canReview && !canAssign && <Notice text={phase === "accepted" ? "This clean has been accepted." : phase === "review" ? "Submitted. Waiting for the cleaning manager's review." : "Nothing to do on this clean right now."} p={p} />}
        {checklist.length > 0 && !canSubmit && <Text style={[ui.small, { color: p.muted }]}>Checklist: {checklist.join(" · ")}</Text>}
        {mineToDo && (reporting
          ? <ProblemForm p={p} clean={{ workId: op.workId, version: op.version }} onCancel={() => setReporting(false)} onSent={async () => { setReporting(false); celebrate("Sent to the Stays team"); await onChanged(); }} />
          : <Button label="Report a problem" icon="alert-triangle" p={p} onPress={() => setReporting(true)} />)}
        <PropertyTeamChatButton palette={p} propertyId={op.propertyId} workId={op.workId} />
        {!!error && <Notice text={error} p={p} tone="bad" />}
      </>}
    </Sheet>
  );
}

function CreateSheet({ p, visible, properties, templates, onClose, onDone, today }: { p: Palette; visible: boolean; properties: PropertyView[]; templates: ChecklistTemplate[]; onClose: () => void; onDone: () => Promise<void>; today: string }) {
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(today);
  const [checks, setChecks] = useState("Kitchen\nBathrooms\nBedrooms and fresh linen\nWi-Fi and broadband working");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? "create:" + propertyId + ":" + date : null);
  const checklist = checks.split("\n").map(x => x.trim()).filter(Boolean);
  const valid = !!propertyId && /^\d{4}-\d{2}-\d{2}$/.test(date) && checklist.length >= 1 && checklist.length <= 30;
  async function save() {
    if (!valid || busy) return; setBusy(true); setError("");
    try { await writeOperation({ action: "createOperation", requestId: request.get(), propertyId, kind: "cleaning", data: { dueOn: date, checklist } }); request.done(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="New clean" subtitle="The cleaner sees it as soon as you assign them" icon="calendar">
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {properties.map(x => (
          <MotionPress key={x.id} accessibilityRole="radio" accessibilityState={{ selected: propertyId === x.id }} onPress={() => { setPropertyId(x.id); const t = templateFor(templates, x.id); if (t) setChecks(t.items.map(i => i.label).join("\n")); }} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: propertyId === x.id ? p.primary : p.surface, borderWidth: 1, borderColor: propertyId === x.id ? p.primary : p.border }}>
            <Text style={{ color: propertyId === x.id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{x.name}</Text>
          </MotionPress>
        ))}
        {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button label="Today" p={p} onPress={() => setDate(today)} />
        <Button label="Tomorrow" p={p} onPress={() => setDate(addDays(today, 1))} />
      </View>
      <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} p={p} />
      <Field label="Checks, one per line" value={checks} onChange={setChecks} p={p} multiline />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Creating…" : "Create clean"} icon="plus" primary p={p} disabled={!valid || busy} onPress={() => void save()} />
    </Sheet>
  );
}

function StatementSheet({ p, workId, onClose, onDone }: { p: Palette; workId: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(workId);
  async function send() {
    if (!workId || busy) return; setBusy(true); setError("");
    try { await writeTeams({ action: "addCleanerStatement", requestId: request.get(), workId, statement: statement.trim() }); request.done(); setStatement(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!workId} onClose={onClose} title="Your side" subtitle="Management reads this before deciding" icon="chat">
      <Field label="What happened" value={statement} onChange={setStatement} p={p} multiline placeholder="Explain the clean and point to your photos" />
      <Text style={[ui.small, { color: p.muted }]}>You can respond once, so include everything that matters.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Sending…" : "Send"} icon="send" primary p={p} disabled={busy || statement.trim().length < 10} onPress={() => void send()} />
    </Sheet>
  );
}
