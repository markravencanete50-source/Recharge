import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, RefreshButton, Tag, message, useRequestId } from "./LiveKit";
import { PageHeading, liveApi } from "./LivePages";
import { Segmented } from "./Segmented";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { ChoiceField } from "./ChoiceField";
import { AddPersonSheet } from "./LiveAccessControl";
import { ApprovalPart, AssignPart, CandidateHiring, Choice, FormPart, InterviewSetup, MarketingPart, QuestionsEditor, RequirementsPart, StepsPart, TemplatesSheet } from "./Hiring";
import { ui, type Palette } from "./theme";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { WorkspaceRole } from "../../lib/modules";
import {
  CANDIDATE_STATUS_LABEL, HIRE_ROLES, HIRE_ROLE_LABEL, VACANCY_STAGE_LABEL, jobKey, recruitmentActionSchema, recruitmentReadSchema, vacancyStage,
  type Candidate, type Job, type RecruitmentRead, type Vacancy,
} from "../../lib/recruitment";

// Recruitment (Business Plan v1.0, migration 20261029600000; the hiring process of Business Plan v2, 20261031300000, in ./Hiring). Managers ask for a role (Launch Preparation asks for a
// housekeeper when there is none to allocate); recruitment write the advert, add and shortlist candidates and share the
// shortlist; the manager who asked selects or turns each one down; recruitment then make the new starter's account and
// follow their contract and training. Admins edit the jobs and name the recruiters.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export async function readRecruitment() {
  return recruitmentReadSchema.parse((await liveApi("/recruitment")).data);
}
// Sends one action; the reply is the whole page again.
async function send(body: Record<string, unknown>) {
  const parsed = recruitmentActionSchema.safeParse(body);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Check the details");
  return recruitmentReadSchema.parse((await liveApi("/recruitment", parsed.data)).data);
}

const STAGE_TONE = { approval: "wait", requested: "wait", advertised: "plain", shortlisting: "plain", choosing: "wait", onboarding: "plain", filled: "good", cancelled: "plain", rejected: "bad" } as const;
const CANDIDATE_TONE: Record<Candidate["status"], "good" | "wait" | "bad" | "plain"> = {
  new: "plain", shortlisted: "wait", rejected: "bad", selected: "good", declined: "bad", hired: "good", withdrawn: "plain",
};

// Asking for a role. Launch Preparation opens it for a housekeeper, with the property and its area filled in.
export function RequestRoleSheet({ p, read, initial, onClose, onDone }: {
  p: Palette; read: RecruitmentRead; initial?: { jobKey?: string; area?: string; propertyId?: string; notes?: string; reason?: string }; onClose: () => void; onDone: (next: RecruitmentRead) => void;
}) {
  const jobs = read.settings.jobs;
  const [job, setJob] = useState(jobs.find(j => j.key === initial?.jobKey)?.key ?? jobs[0]?.key ?? "");
  const [area, setArea] = useState(initial?.area ?? ""), [positions, setPositions] = useState("1"), [startBy, setStartBy] = useState(""), [notes, setNotes] = useState(initial?.notes ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId("request-role");
  async function submit() {
    if (busy) return;
    const n = Number(positions);
    if (!Number.isInteger(n) || n < 1 || n > 20) { setError("Ask for between 1 and 20 people"); return; }
    setBusy(true); setError("");
    try {
      const next = await send({ action: "requestRole", requestId: request.get(), jobKey: job, area: area.trim(), reason: reason.trim(), positions: n, startBy, notes: notes.trim(), ...(initial?.propertyId ? { propertyId: initial.propertyId } : {}) });
      request.done(); onDone(next);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const chosen = jobs.find(j => j.key === job);
  return <Sheet palette={p} visible onClose={onClose} title="Ask for a role" subtitle="The directors approve it with the budget, then recruitment find candidates for you" icon="people">
    <ChoiceField p={p} label="Job" value={job} options={jobs.map(j => ({ value: j.key, label: j.title }))} onChange={setJob} />
    {!!chosen?.advert && <Text style={[ui.small, { color: p.muted }]} numberOfLines={3}>{chosen.advert}</Text>}
    <Field label="Area the role covers" value={area} onChange={setArea} p={p} placeholder="For example Leith and north Edinburgh" />
    <Field label="Why is the role needed?" value={reason} onChange={setReason} p={p} multiline placeholder="For example three new properties in the area and no housekeeper free" />
    <Field label="How many people" value={positions} onChange={setPositions} p={p} placeholder="1" />
    <DateField p={p} label="Needed by (optional)" mode="single" wholeMonthLink={false} clearable empty="Any time" today={today()} value={{ from: startBy, to: startBy }} onChange={next => setStartBy(next.from)} />
    <Field label="Specific requests (optional)" value={notes} onChange={setNotes} p={p} multiline placeholder="Hours, skills, experience" />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Sending…" : "Send to the directors"} icon="send" primary p={p} disabled={busy || !job || !area.trim() || reason.trim().length < 3} onPress={() => void submit()} />
  </Sheet>;
}

export function LiveRecruitment({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [read, setRead] = useState<RecruitmentRead | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "closed">("open");
  const [asking, setAsking] = useState(false), [settings, setSettings] = useState(false), [templates, setTemplates] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRead(await readRecruitment()); setError(""); } catch (e) { setError(message(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const open = read?.vacancies.filter(v => v.status === "open" || v.status === "requested") ?? [], closed = read?.vacancies.filter(v => v.status !== "open" && v.status !== "requested") ?? [];
  const shown = filter === "open" ? open : closed;
  return <View style={{ gap: 16 }}>
    <PageHeading palette={p} title="Recruitment" subtitle={read?.canRecruit ? "Vacancies, adverts, candidates and new starters." : "Ask recruitment for a role and choose from the shortlist."}
      action={<RefreshButton p={p} loading={loading} onPress={() => void load()} />} />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    {!read && loading && <Loading p={p} />}
    {read && <>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {read.canRequest && <Button label="Ask for a role" icon="user-plus" primary p={p} onPress={() => setAsking(true)} />}
        {(read.canRecruit || read.canApprove) && <Button label="Contract templates" icon="file-text" quiet p={p} onPress={() => setTemplates(true)} />}
        {read.canEditSettings && <Button label="Jobs, recruiters and directors" icon="settings" quiet p={p} onPress={() => setSettings(true)} />}
      </View>
      {read.canRecruit && !read.recruiters.length && read.canEditSettings && <Notice text="No recruiters are named yet, so admins hear about new requests. Name the Recruitment Manager in Jobs and recruiters." p={p} />}
      <Segmented p={p} label="Vacancies" value={filter} onChange={setFilter} items={[{ key: "open", label: "Open", count: open.length, alert: open.some(v => (v.isMine && vacancyStage(v) === "choosing") || v.canDecide) }, { key: "closed", label: "Filled and closed", count: closed.length }]} />
      {!shown.length && <Notice text={filter === "open" ? "No open vacancies. Ask for a role when your team needs someone new." : "Nothing filled or closed in the last six months."} p={p} />}
      {shown.map(v => <VacancyCard key={v.id} p={p} v={v} read={read} account={account} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onChange={setRead} />)}
      {asking && <RequestRoleSheet p={p} read={read} onClose={() => setAsking(false)} onDone={next => { setRead(next); setAsking(false); setFilter("open"); }} />}
      {templates && <TemplatesSheet p={p} read={read} send={send} onClose={() => setTemplates(false)} onDone={setRead} />}
      {settings && <SettingsSheet p={p} read={read} onClose={() => setSettings(false)} onDone={next => { setRead(next); setSettings(false); }} />}
    </>}
  </View>;
}

function VacancyCard({ p, v, read, account, open, onToggle, onChange }: { p: Palette; v: Vacancy; read: RecruitmentRead; account: WorkspaceAccount; open: boolean; onToggle: () => void; onChange: (r: RecruitmentRead) => void }) {
  const stage = vacancyStage(v);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const request = useRequestId("vacancy:" + v.id);
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState<Candidate | "new" | null>(null), [closing, setClosing] = useState(false);
  async function act(body: Record<string, unknown>, done: string, key = String(body.action)) {
    if (busy) return false;
    setBusy(true); setError(""); setNote("");
    try { onChange(await send({ ...body, requestId: request.get(key), vacancyId: v.id })); request.done(key); setNote(done); return true; }
    catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  const shortlisted = v.candidates.filter(c => c.status === "shortlisted").length;
  return <View style={{ borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
    <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ padding: 14, gap: 6 }}>
      <View style={[ui.between, { gap: 10 }]}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "700", flexShrink: 1 }}>{v.title}{v.positions > 1 ? ` × ${v.positions}` : ""}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={p.muted} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{v.area}{v.propertyName ? ` · for ${v.propertyName}` : ""} · asked by {v.isMine ? "you" : v.requestedByName} on {when(v.requestedAt)}{v.startBy ? ` · needed by ${day(v.startBy)}` : ""}{v.assignedToName ? ` · recruiting: ${v.assignedToName}` : ""}</Text>
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Tag p={p} label={v.canDecide ? "Waiting on you to approve" : VACANCY_STAGE_LABEL[stage]} tone={STAGE_TONE[stage]} />
        {v.status === "open" && v.candidates.length > 0 && read.canRecruit && <Tag p={p} label={plural(v.candidates.length, "candidate")} tone="plain" />}
        {v.status === "open" && shortlisted > 0 && <Tag p={p} label={`${shortlisted} shortlisted`} tone="wait" />}
        {v.hired > 0 && <Tag p={p} label={`${v.hired} of ${v.positions} hired`} tone="good" />}
      </View>
    </MotionPress>
    {open && <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 14 }}>
      <RequirementsPart p={p} v={v} />
      {v.status !== "open" && v.status !== "requested" && <Text style={[ui.small, { color: p.muted }]}>{v.status === "filled" ? "Filled" : v.status === "rejected" ? "Turned down by the directors" : "Closed"}{v.closedAt ? ` on ${when(v.closedAt)}` : ""}{v.closedByName ? ` by ${v.closedByName}` : ""}{v.closeReason ? `: ${v.closeReason}` : "."}</Text>}

      <ApprovalPart p={p} v={v} read={read} busy={busy} onAct={act} />
      {v.status !== "requested" && v.status !== "rejected" && <StepsPart p={p} v={v} />}
      <AssignPart p={p} v={v} read={read} busy={busy} onAct={act} />
      <FormPart p={p} v={v} busy={busy} onAct={act} />
      <MarketingPart p={p} v={v} busy={busy} onAct={act} />
      <InterviewSetup p={p} v={v} busy={busy} onAct={act} />

      {v.status !== "requested" && v.status !== "rejected" && <CandidatesPart p={p} v={v} read={read} account={account} busy={busy} onAct={act} onAdd={() => setAdding("new")} onEdit={c => setAdding(c)} />}

      {!!note && <Text style={[ui.small, { color: p.success }]}>{note}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {v.canEdit && <Button label="Change the request" icon="edit-2" quiet p={p} disabled={busy} onPress={() => setEditing(true)} />}
        {v.canEdit && <Button label="Close the vacancy" icon="x-circle" quiet p={p} disabled={busy} onPress={() => setClosing(true)} />}
        {v.canReopen && <Button label="Reopen" icon="rotate-ccw" quiet p={p} disabled={busy} onPress={() => void act({ action: "reopenVacancy" }, "The vacancy is open again.")} />}
      </View>
    </View>}
    {editing && <EditSheet p={p} v={v} onClose={() => setEditing(false)} onSave={async body => { if (await act({ action: "updateVacancy", ...body }, "The request is updated.")) setEditing(false); }} busy={busy} error={error} />}
    {adding && <CandidateSheet p={p} candidate={adding === "new" ? null : adding} busy={busy} error={error} onClose={() => { setAdding(null); setError(""); }}
      onSave={async body => { const ok = await act(adding === "new" ? { action: "addCandidate", ...body } : { action: "editCandidate", candidateId: adding.id, ...body }, adding === "new" ? "Candidate added." : "Candidate updated.", adding === "new" ? "addCandidate" : "edit:" + adding.id); if (ok) setAdding(null); }} />}
    {closing && <ReasonSheet p={p} title="Close the vacancy" label="Why is it closing?" button="Close the vacancy" busy={busy} error={error} onClose={() => { setClosing(false); setError(""); }}
      onSave={async reason => { if (await act({ action: "cancelVacancy", reason }, "The vacancy is closed.")) setClosing(false); }} />}
  </View>;
}

function CandidatesPart({ p, v, read, account, busy, onAct, onAdd, onEdit }: {
  p: Palette; v: Vacancy; read: RecruitmentRead; account: WorkspaceAccount; busy: boolean;
  onAct: (body: Record<string, unknown>, done: string, key?: string) => Promise<boolean>; onAdd: () => void; onEdit: (c: Candidate) => void;
}) {
  const [declining, setDeclining] = useState<Candidate | null>(null), [hiring, setHiring] = useState<Candidate | null>(null);
  const recruit = read.canRecruit;
  return <View style={{ gap: 8 }}>
    <View style={[ui.between, { gap: 8 }]}>
      <Text style={[ui.label, { color: p.muted }]}>{recruit ? "Candidates" : "Shortlist"}</Text>
      {v.canShare && <Button label={v.shortlistSharedAt ? "Share the shortlist again" : "Share the shortlist"} icon="share-2" p={p} disabled={busy} onPress={() => void onAct({ action: "shareShortlist" }, `${v.isMine ? "Your" : v.requestedByName + "’s"} shortlist is shared.`)} />}
    </View>
    {!v.candidates.length && <Text style={[ui.small, { color: p.muted }]}>{recruit ? (v.form.publishedAt ? "No applications yet." : "No candidates yet. Publish the application form, or add a candidate.") : "Recruitment will share a shortlist with you here."}</Text>}
    {v.candidates.map(c => <View key={c.id} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "600", flexShrink: 1 }}>{c.fullName}</Text>
        <Tag p={p} label={CANDIDATE_STATUS_LABEL[c.status]} tone={CANDIDATE_TONE[c.status]} />
      </View>
      {!!(c.email || c.phone) && <Text style={[ui.small, { color: p.muted }]} selectable>{[c.email, c.phone].filter(Boolean).join(" · ")}</Text>}
      {!!c.cvUrl && <MotionPress accessibilityRole="link" onPress={() => void Linking.openURL(c.cvUrl)}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Open their CV</Text></MotionPress>}
      {c.answers.map(a => <Text key={a.id} style={[ui.small, { color: p.text }]}>{a.label}: {a.answer}</Text>)}
      {c.otherRoles && <Text style={[ui.small, { color: p.muted }]}>Happy to be considered for other roles.</Text>}
      {!!c.notes && <Text style={[ui.small, { color: p.text }]}>{c.notes}</Text>}
      {!!c.decisionNote && <Text style={[ui.small, { color: p.muted }]}>{c.decidedByName ? c.decidedByName + ": " : ""}{c.decisionNote}</Text>}
      <CandidateHiring p={p} v={v} c={c} read={read} busy={busy} onAct={onAct} />
      {c.status === "hired" && <Onboarding p={p} c={c} />}
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        {/* Recruitment's shortlisting. */}
        {recruit && v.status === "open" && (c.status === "new" || c.status === "rejected" || c.status === "withdrawn") && <Button label="Shortlist" icon="star" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "setCandidate", candidateId: c.id, status: "shortlisted" }, `${c.fullName} is shortlisted.`, "set:" + c.id)} />}
        {recruit && v.status === "open" && (c.status === "new" || c.status === "shortlisted") && <Button label="Not taking forward" icon="x" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "setCandidate", candidateId: c.id, status: "rejected" }, `${c.fullName} is not taken forward.`, "set:" + c.id)} />}
        {recruit && v.status === "open" && c.status !== "hired" && c.status !== "withdrawn" && <Button label="Withdrawn" icon="log-out" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "setCandidate", candidateId: c.id, status: "withdrawn" }, `${c.fullName} is marked as withdrawn.`, "set:" + c.id)} />}
        {/* The manager who asked chooses from the shortlist. */}
        {v.canChoose && (c.status === "shortlisted" || c.status === "declined") && <Button label="Offer them the job" icon="check" primary p={p} disabled={busy} onPress={() => void onAct({ action: "chooseCandidate", candidateId: c.id, decision: "select" }, `${c.fullName} is offered the job. Give them a call to let them know.`, "choose:" + c.id)} />}
        {v.canChoose && (c.status === "shortlisted" || c.status === "selected") && <Button label="Turn down" icon="x" quiet p={p} disabled={busy} onPress={() => setDeclining(c)} />}
        {/* Recruitment onboard whoever is selected. */}
        {v.canHire && c.status === "selected" && (c.offerStatus == null || c.offerStatus === "accepted") && (!c.contract || !!c.contract.signedAt) && <Button label="Onboard them" icon="user-check" primary p={p} disabled={busy} onPress={() => setHiring(c)} />}
        {recruit && v.status === "open" && c.status !== "hired" && <Button label="Edit" icon="edit-2" quiet p={p} disabled={busy} onPress={() => onEdit(c)} />}
        {recruit && c.status !== "hired" && <Button label="Remove" icon="trash-2" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "deleteCandidate", candidateId: c.id }, `${c.fullName}’s details are removed.`, "delete:" + c.id)} />}
      </View>
    </View>)}
    {recruit && v.status === "open" && <Button label="Add a candidate" icon="user-plus" quiet p={p} disabled={busy} onPress={onAdd} />}
    {declining && <ReasonSheet p={p} title={`Turn down ${declining.fullName}`} label="Why are they not right for the role?" button="Turn down" busy={busy} onClose={() => setDeclining(null)}
      onSave={async reason => { if (await onAct({ action: "chooseCandidate", candidateId: declining.id, decision: "decline", note: reason }, `${declining.fullName} is turned down.`, "choose:" + declining.id)) setDeclining(null); }} />}
    {hiring && <HireSheet p={p} v={v} c={hiring} read={read} account={account} busy={busy} onClose={() => setHiring(null)}
      onHire={async userId => { if (await onAct({ action: "hireCandidate", candidateId: hiring.id, userId }, `${hiring.fullName} is hired. Their contract and training are below.`, "hire:" + hiring.id)) setHiring(null); }} />}
  </View>;
}

// A new starter's staff onboarding: the contract to sign and the required training before their tools open.
function Onboarding({ p, c }: { p: Palette; c: Candidate }) {
  const o = c.onboarding;
  if (!o) return null;
  const line = !o.required ? "Nothing to sign or train first: their tools are open."
    : o.complete ? "Contract signed and training done: ready to start."
    : `Contract ${o.contractsSigned} of ${o.contractsNeeded} signed · training ${o.coursesDone} of ${o.coursesNeeded} done.`;
  return <View style={[ui.row, { gap: 6 }]}>
    <Feather name={o.complete || !o.required ? "check-circle" : "clock"} size={14} color={o.complete || !o.required ? p.success : p.waiting} />
    <Text style={[ui.small, { color: p.text, flex: 1 }]}>{c.hiredName ? c.hiredName + ": " : ""}{line}</Text>
  </View>;
}

// Onboarding the selected candidate: an admin makes their account here (prefilled), or recruitment link the account
// an admin has already made.
function HireSheet({ p, v, c, read, account, busy, onClose, onHire }: { p: Palette; v: Vacancy; c: Candidate; read: RecruitmentRead; account: WorkspaceAccount; busy: boolean; onClose: () => void; onHire: (userId: string) => Promise<void> }) {
  const admin = account.role === "admin" || account.role === "super_admin";
  const [making, setMaking] = useState(false), [who, setWho] = useState("");
  const taken = new Set(v.candidates.map(x => x.hiredUserId).filter(Boolean));
  const people = read.people.filter(x => !taken.has(x.id));
  if (making) return <AddPersonSheet p={p} actorRole={account.role} initial={{ name: c.fullName, email: c.email, role: v.role as WorkspaceRole }} onClose={onClose}
    onDone={async userId => { if (userId) await onHire(userId); }} />;
  return <Sheet palette={p} visible onClose={onClose} title={`Onboard ${c.fullName}`} subtitle={`${v.title} · ${HIRE_ROLE_LABEL[v.role]}`} icon="people">
    <Text style={[ui.small, { color: p.muted }]}>Their account gets the {HIRE_ROLE_LABEL[v.role]} role. Before their tools open they sign the staff contract and finish the required training for that role.</Text>
    {admin && <Button label="Make their account" icon="user-plus" primary p={p} disabled={busy || !c.email} onPress={() => setMaking(true)} />}
    {admin && !c.email && <Text style={[ui.small, { color: p.muted }]}>Add their email address to the candidate first: they sign in with it.</Text>}
    {!admin && <Notice text="An admin makes their account in Access control. Once it is made, choose it below." p={p} />}
    <Text style={[ui.label, { color: p.muted }]}>Or choose an account already made</Text>
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{people.map(x => <Choice key={x.id} p={p} on={who === x.id} label={x.name} onPress={() => setWho(x.id)} />)}</View>
    <Button label={busy ? "Saving…" : "Link and mark as hired"} icon="user-check" p={p} disabled={busy || !who} onPress={() => void onHire(who)} />
  </Sheet>;
}

function EditSheet({ p, v, busy, error, onClose, onSave }: { p: Palette; v: Vacancy; busy: boolean; error: string; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [area, setArea] = useState(v.area), [positions, setPositions] = useState(String(v.positions)), [startBy, setStartBy] = useState(v.startBy ?? ""), [notes, setNotes] = useState(v.notes);
  const n = Number(positions);
  return <Sheet palette={p} visible onClose={onClose} title="Change the request" subtitle={v.title} icon="people">
    <Field label="Area the role covers" value={area} onChange={setArea} p={p} />
    <Field label="How many people" value={positions} onChange={setPositions} p={p} />
    <DateField p={p} label="Needed by (optional)" mode="single" wholeMonthLink={false} clearable empty="Any time" today={today()} value={{ from: startBy, to: startBy }} onChange={next => setStartBy(next.from)} />
    <Field label="Notes" value={notes} onChange={setNotes} p={p} multiline />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Saving…" : "Save"} icon="save" primary p={p} disabled={busy || !area.trim() || !Number.isInteger(n) || n < 1 || n > 20}
      onPress={() => void onSave({ area: area.trim(), positions: n, startBy, notes: notes.trim() })} />
  </Sheet>;
}

function CandidateSheet({ p, candidate, busy, error, onClose, onSave }: { p: Palette; candidate: Candidate | null; busy: boolean; error: string; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [fullName, setName] = useState(candidate?.fullName ?? ""), [email, setEmail] = useState(candidate?.email ?? ""), [phone, setPhone] = useState(candidate?.phone ?? "");
  const [cvUrl, setCv] = useState(candidate?.cvUrl ?? ""), [notes, setNotes] = useState(candidate?.notes ?? "");
  return <Sheet palette={p} visible onClose={onClose} title={candidate ? "Edit the candidate" : "Add a candidate"} subtitle="An email address or a phone number is needed" icon="people">
    <Field label="Full name" value={fullName} onChange={setName} p={p} placeholder="First and last name" />
    <Field label="Email" value={email} onChange={setEmail} p={p} email placeholder="name@example.com" />
    <Field label="Phone" value={phone} onChange={setPhone} p={p} placeholder="07…" />
    <Field label="Link to their CV (optional)" value={cvUrl} onChange={setCv} p={p} placeholder="https://…" />
    <Field label="Notes (recruitment only)" value={notes} onChange={setNotes} p={p} multiline placeholder="Experience, availability, interview notes" />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Saving…" : candidate ? "Save" : "Add the candidate"} icon="save" primary p={p} disabled={busy || fullName.trim().length < 2 || (!email.trim() && !phone.trim())}
      onPress={() => void onSave({ fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), cvUrl: cvUrl.trim(), notes: notes.trim() })} />
  </Sheet>;
}

function ReasonSheet({ p, title, label, button, busy, error, onClose, onSave }: { p: Palette; title: string; label: string; button: string; busy: boolean; error?: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return <Sheet palette={p} visible onClose={onClose} title={title} icon="people">
    <Field label={label} value={reason} onChange={setReason} p={p} multiline />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Saving…" : button} primary p={p} disabled={busy || !reason.trim()} onPress={() => void onSave(reason.trim())} />
  </Sheet>;
}

// Admins: the jobs (title, the role a hire gets, the advert to start from) and who the recruiters are.
function SettingsSheet({ p, read, onClose, onDone }: { p: Palette; read: RecruitmentRead; onClose: () => void; onDone: (r: RecruitmentRead) => void }) {
  const [jobs, setJobs] = useState<Job[]>(read.settings.jobs), [recruiters, setRecruiters] = useState(read.recruiters.map(r => r.id));
  const [directors, setDirectors] = useState<string[]>(read.namedDirectors);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId("recruitment-settings");
  const change = (i: number, patch: Partial<Job>) => setJobs(jobs.map((j, k) => k === i ? { ...j, ...patch } : j));
  const move = (i: number, by: number) => { const next = [...jobs]; const [j] = next.splice(i, 1); next.splice(i + by, 0, j); setJobs(next); };
  const candidates = read.people.filter(x => x.role !== "cleans" && x.role !== "client");
  const admins = read.people.filter(x => x.role === "admin" || x.role === "super_admin");
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try { onDone(await send({ action: "saveSettings", requestId: request.get(), settings: { jobs: jobs.map(j => ({ ...j, title: j.title.trim(), advert: j.advert.trim(), hours: j.hours.trim(), earnings: j.earnings.trim(), questions: j.questions.map(q => ({ ...q, label: q.label.trim() })) })) }, recruiterIds: recruiters, directorIds: directors })); request.done(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Sheet palette={p} visible onClose={onClose} title="Jobs, recruiters and directors" subtitle="What managers can ask for, who approves and who recruits" icon="people" width={720}>
    <Text style={[ui.label, { color: p.muted }]}>Recruiters</Text>
    <Text style={[ui.small, { color: p.muted }]}>The Recruitment Manager and anyone helping them. They hear about every request; admins can always recruit too.</Text>
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{candidates.map(x => <Choice key={x.id} p={p} on={recruiters.includes(x.id)} label={x.name}
      onPress={() => setRecruiters(recruiters.includes(x.id) ? recruiters.filter(r => r !== x.id) : [...recruiters, x.id])} />)}</View>
    <Text style={[ui.label, { color: p.muted }]}>Directors</Text>
    <Text style={[ui.small, { color: p.muted }]}>They approve each request for a role with its maximum budget, and sign the contract templates. With nobody chosen, the super admins do.</Text>
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{admins.map(x => <Choice key={x.id} p={p} on={directors.includes(x.id)} label={x.name}
      onPress={() => setDirectors(directors.includes(x.id) ? directors.filter(d => d !== x.id) : [...directors, x.id])} />)}</View>
    <Text style={[ui.label, { color: p.muted }]}>Jobs</Text>
    {jobs.map((j, i) => <View key={j.key} style={{ gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <Field label="Job title" value={j.title} onChange={title => change(i, { title })} p={p} />
      <ChoiceField p={p} label="Their account's role" value={j.role} options={HIRE_ROLES.map(r => ({ value: r, label: HIRE_ROLE_LABEL[r] }))} onChange={role => change(i, { role })} />
      <Field label="Job description to start from" value={j.advert} onChange={advert => change(i, { advert })} p={p} multiline />
      <Field label="Hours to start from" value={j.hours} onChange={hours => change(i, { hours })} p={p} />
      <Field label="Expected earnings to start from" value={j.earnings} onChange={earnings => change(i, { earnings })} p={p} />
      <QuestionsEditor p={p} questions={j.questions} onChange={questions => change(i, { questions })} />
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        {i > 0 && <Button label="Earlier" icon="arrow-up" quiet p={p} onPress={() => move(i, -1)} />}
        {i < jobs.length - 1 && <Button label="Later" icon="arrow-down" quiet p={p} onPress={() => move(i, 1)} />}
        {jobs.length > 1 && <Button label="Remove" icon="trash-2" quiet p={p} onPress={() => setJobs(jobs.filter((_, k) => k !== i))} />}
      </View>
    </View>)}
    {jobs.length < 40 && <Button label="Add a job" icon="plus" quiet p={p} onPress={() => setJobs([...jobs, { key: jobKey("New job " + (jobs.length + 1), jobs.map(j => j.key)), title: "", role: "stays", advert: "", hours: "", earnings: "", questions: [] }])} />}
    <Text style={[ui.small, { color: p.muted }]}>Changing a job changes what new requests start from; vacancies already asked for keep their own advert.</Text>
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Saving…" : "Save"} icon="save" primary p={p} disabled={busy || jobs.some(j => !j.title.trim() || j.questions.some(q => q.label.trim().length < 3))} onPress={() => void save()} />
  </Sheet>;
}
