import { useState } from "react";
import { Image, Linking, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { SignaturePad } from "./SignaturePad";
import { liveApi } from "./LivePages";
import { liveApiOrigin } from "./backend/client";
import { ui, type Palette } from "./theme";
import { londonClock, londonInstant, validClock } from "../../lib/team-time";
import {
  BUDGET_UNITS, BUDGET_UNIT_LABEL, INTERVIEW_STATUS_LABEL, OFFER_STATUS_LABEL, PLATFORMS, PLATFORM_LABEL, QUESTION_KINDS, QUESTION_KIND_LABEL,
  blankLabel, budgetText, contractBlanks, hiringSteps, poundsToMinor, prefillBlanks, questionId,
  type BudgetUnit, type Candidate, type ContractTemplate, type PlatformState, type Question, type RecruitmentRead, type Vacancy,
} from "../../lib/recruitment";

// The hiring process on a vacancy (Business Plan v2, migration 20261031300000): the directors' approval with the maximum
// budget, the checklist, the application form, marketing, interviews, the job offer and the contract, and the contract
// templates a director pre-signs. Until applicants have their own accounts, recruitment record their answers here.
type Act = (body: Record<string, unknown>, done: string, key?: string) => Promise<boolean>;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
export const slotLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) + ", " + londonClock(iso);
const future = (iso: string) => new Date(iso).getTime() > Date.now();

export function Choice({ p, on, label, onPress, disabled = false }: { p: Palette; on: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  return <MotionPress accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={onPress}
    style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface, opacity: disabled ? 0.5 : 1 }]}>
    <Text style={{ color: on ? p.primary : p.text, fontSize: 14, fontWeight: on ? "600" : "400" }}>{label}</Text>
  </MotionPress>;
}
const Heading = ({ p, text }: { p: Palette; text: string }) => <Text style={[ui.label, { color: p.muted }]}>{text}</Text>;
const Line = ({ p, text, muted = false }: { p: Palette; text: string; muted?: boolean }) => <Text style={[ui.small, { color: muted ? p.muted : p.text }]}>{text}</Text>;

// The request itself: why, what was asked for, the budget and who is recruiting.
export function RequirementsPart({ p, v }: { p: Palette; v: Vacancy }) {
  const budget = budgetText(v.budgetMinor, v.budgetUnit);
  return <View style={{ gap: 4 }}>
    <Heading p={p} text="Requirements" />
    {!!v.reason && <Line p={p} text={"Why: " + v.reason} />}
    {!!v.notes && <Line p={p} text={"Specific requests: " + v.notes} />}
    {!!budget && <Line p={p} text={`Maximum budget ${budget}${v.approvedByName ? `, approved by ${v.approvedByName}` : ""}${v.approvedAt ? ` on ${when(v.approvedAt)}` : ""}.`} />}
    {v.status === "open" && <Line p={p} muted text={v.assignedToName ? `Recruiting: ${v.assignedToName}` : "Recruiting: not assigned yet"} />}
  </View>;
}

// The directors approve the request with the maximum budget for the role, or turn it down.
export function ApprovalPart({ p, v, read, busy, onAct }: { p: Palette; v: Vacancy; read: RecruitmentRead; busy: boolean; onAct: Act }) {
  const [amount, setAmount] = useState(""), [unit, setUnit] = useState<BudgetUnit>(v.role === "cleans" ? "job" : "hour");
  const [assignee, setAssignee] = useState(""), [turning, setTurning] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  if (v.status !== "requested") return null;
  if (!v.canDecide) return <Notice p={p} text={`Waiting on the directors (${read.directors.map(d => d.name).join(", ") || "the super admins"}) to approve this request with the maximum budget.`} />;
  const minor = poundsToMinor(amount);
  const recruiters = read.recruiters;
  return <View style={{ gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: p.primary }}>
    <Heading p={p} text="Approve the request" />
    <Field label="Maximum budget for the role (£)" value={amount} onChange={setAmount} p={p} placeholder="For example 14.50" />
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{BUDGET_UNITS.map(u => <Choice key={u} p={p} on={unit === u} label={BUDGET_UNIT_LABEL[u]} onPress={() => setUnit(u)} />)}</View>
    <Heading p={p} text="Recruitment" />
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      <Choice p={p} on={!assignee} label="Assign automatically" onPress={() => setAssignee("")} />
      {recruiters.map(r => <Choice key={r.id} p={p} on={assignee === r.id} label={r.name} onPress={() => setAssignee(r.id)} />)}
    </View>
    {!recruiters.length && <Line p={p} muted text="No recruiters are named yet, so the admins pick it up." />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {!turning ? <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button label="Approve" icon="check" primary p={p} disabled={busy || minor == null}
        onPress={() => { setError(""); void onAct({ action: "decideRequest", decision: "approve", budgetMinor: minor, budgetUnit: unit, ...(assignee ? { userId: assignee } : {}) }, "Approved. Recruitment can start.", "decide"); }} />
      <Button label="Turn down" icon="x" quiet p={p} disabled={busy} onPress={() => setTurning(true)} />
    </View> : <View style={{ gap: 8 }}>
      <Field label="Why is it turned down?" value={note} onChange={setNote} p={p} multiline />
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button label="Turn down the request" icon="x" primary p={p} disabled={busy || !note.trim()} onPress={() => void onAct({ action: "decideRequest", decision: "reject", note: note.trim() }, "The request is turned down.", "decide")} />
        <Button label="Back" quiet p={p} onPress={() => setTurning(false)} />
      </View>
    </View>}
  </View>;
}

// Who is recruiting an approved vacancy (recruitment or admins can hand it over).
export function AssignPart({ p, v, read, busy, onAct }: { p: Palette; v: Vacancy; read: RecruitmentRead; busy: boolean; onAct: Act }) {
  const [open, setOpen] = useState(false);
  if (!v.canAssign) return null;
  const people = [...read.recruiters, ...read.people.filter(x => (x.role === "admin" || x.role === "super_admin") && !read.recruiters.some(r => r.id === x.id))];
  if (!open) return <Button label={v.assignedToName ? "Hand over" : "Assign recruitment"} icon="user" quiet p={p} disabled={busy} onPress={() => setOpen(true)} />;
  return <View style={{ gap: 6 }}>
    <Heading p={p} text="Who recruits for this role" />
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{people.map(x => <Choice key={x.id} p={p} on={v.assignedToId === x.id} label={x.name}
      onPress={() => void onAct({ action: "assignVacancy", userId: x.id }, `${x.name} is recruiting for this role.`, "assign").then(ok => { if (ok) setOpen(false); })} />)}</View>
  </View>;
}

// The checklist, each step ticked from what has been done.
export function StepsPart({ p, v }: { p: Palette; v: Vacancy }) {
  const steps = hiringSteps(v);
  const next = steps.find(s => !s.done)?.key;
  return <View style={{ gap: 6 }}>
    <Heading p={p} text="Checklist" />
    {steps.map(s => <View key={s.key} style={[ui.row, { gap: 8 }]}>
      <Feather name={s.done ? "check-circle" : "circle"} size={16} color={s.done ? p.success : s.key === next ? p.primary : p.muted} />
      <Text style={[ui.small, { color: s.done ? p.text : s.key === next ? p.primary : p.muted, fontWeight: s.key === next ? "600" : "400" }]}>{s.label}</Text>
    </View>)}
  </View>;
}

export function QuestionsEditor({ p, questions, onChange }: { p: Palette; questions: Question[]; onChange: (q: Question[]) => void }) {
  const change = (i: number, patch: Partial<Question>) => onChange(questions.map((q, k) => k === i ? { ...q, ...patch } : q));
  return <View style={{ gap: 8 }}>
    <Heading p={p} text="Role-specific questions" />
    {!questions.length && <Line p={p} muted text="Name, email, phone and CV are always asked. Add questions for this role." />}
    {questions.map((q, i) => <View key={q.id} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <Field label={`Question ${i + 1}`} value={q.label} onChange={label => change(i, { label })} p={p} />
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{QUESTION_KINDS.map(k => <Choice key={k} p={p} on={q.kind === k} label={QUESTION_KIND_LABEL[k]} onPress={() => change(i, { kind: k })} />)}</View>
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Choice p={p} on={q.required} label={q.required ? "Required" : "Optional"} onPress={() => change(i, { required: !q.required })} />
        <Button label="Remove" icon="trash-2" quiet p={p} onPress={() => onChange(questions.filter((_, k) => k !== i))} />
      </View>
    </View>)}
    {questions.length < 15 && <Button label="Add a question" icon="plus" quiet p={p} onPress={() => onChange([...questions, { id: questionId(questions.map(q => q.id)), label: "", kind: "short", required: true }])} />}
  </View>;
}

// 1. Application form: the hours, expected earnings, job description and role-specific questions.
export function FormPart({ p, v, busy, onAct }: { p: Palette; v: Vacancy; busy: boolean; onAct: Act }) {
  const [hours, setHours] = useState(v.form.hours), [earnings, setEarnings] = useState(v.form.earnings), [advert, setAdvert] = useState(v.advert);
  const [questions, setQuestions] = useState<Question[]>(v.form.questions);
  if (v.status !== "open") return null;
  const published = v.form.publishedAt && !v.form.closedAt;
  const state = v.form.closedAt ? `Withdrawn ${when(v.form.closedAt)}.` : v.form.publishedAt ? `Published ${when(v.form.publishedAt)}${v.form.publishedByName ? ` by ${v.form.publishedByName}` : ""}.` : "Not published yet.";
  if (!v.canAdvertise) return <View style={{ gap: 4 }}>
    <Heading p={p} text="Application form" />
    <Line p={p} muted text={state} />
    {!!v.form.hours && <Line p={p} text={`Hours: ${v.form.hours} · Earnings: ${v.form.earnings}`} />}
  </View>;
  const ready = hours.trim() && earnings.trim() && advert.trim().length >= 20 && questions.every(q => q.label.trim().length >= 3);
  const body = () => ({ action: "saveApplicationForm", hours: hours.trim(), earnings: earnings.trim(), advert: advert.trim(), questions: questions.map(q => ({ ...q, label: q.label.trim() })) });
  return <View style={{ gap: 8 }}>
    <Heading p={p} text={`Application form: ${v.title}`} />
    <Line p={p} muted text={state} />
    {/* The link to put in each advert (the careers page, 20261031400000). */}
    {published && !!liveApiOrigin() && <Text selectable style={[ui.small, { color: p.primary }]}>{`${liveApiOrigin()!.replace(/\/$/, "")}/careers?job=${v.id}`}</Text>}
    <Field label="Hours" value={hours} onChange={setHours} p={p} placeholder="For example 16 to 25 hours a week, weekends" />
    <Field label="Expected earnings" value={earnings} onChange={setEarnings} p={p} placeholder="For example £13 an hour, or £35 to £60 per clean" />
    <Field label="Job description" value={advert} onChange={setAdvert} p={p} multiline />
    <QuestionsEditor p={p} questions={questions} onChange={setQuestions} />
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button label="Save" icon="save" quiet p={p} disabled={busy || !ready} onPress={() => void onAct({ ...body(), publish: false }, "Application form saved.", "form")} />
      {!published && <Button label={v.form.closedAt ? "Publish again" : "Publish to the careers page"} icon="send" primary p={p} disabled={busy || !ready}
        onPress={() => void onAct({ ...body(), publish: true }, "The application form is published.", "form")} />}
      {published && <Button label="Withdraw the form" icon="x-circle" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "withdrawForm" }, "The application form is withdrawn.", "withdraw")} />}
    </View>
  </View>;
}

// 2. Marketing: posted on each platform with the description and a link to the form, or not used for this role.
export function MarketingPart({ p, v, busy, onAct }: { p: Palette; v: Vacancy; busy: boolean; onAct: Act }) {
  const [state, setState] = useState<Record<string, PlatformState>>(Object.fromEntries(PLATFORMS.map(k => [k, v.platforms[k] ?? "todo"])));
  const [other, setOther] = useState(v.postedTo);
  if (v.status !== "open" || (!v.canAdvertise && !v.advertisedAt)) return null;
  if (!v.canAdvertise) return <View style={{ gap: 4 }}>
    <Heading p={p} text="Marketing" />
    <Line p={p} text={`Posted on ${PLATFORMS.filter(k => v.platforms[k] === "posted").map(k => PLATFORM_LABEL[k]).join(", ") || "no platform"}${v.postedTo ? ` and ${v.postedTo}` : ""}.`} />
  </View>;
  if (!v.form.publishedAt) return <View style={{ gap: 4 }}><Heading p={p} text="Marketing" /><Line p={p} muted text="Publish the application form first: each post links to it." /></View>;
  return <View style={{ gap: 8 }}>
    <Heading p={p} text="Marketing" />
    <Line p={p} muted text={v.advertisedAt ? `Ticked ${when(v.advertisedAt)}.` : "Post the job description with a link to the application form, then mark each platform."} />
    {PLATFORMS.map(k => <View key={k} style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      <Text style={{ color: p.text, fontSize: 14, width: 90 }}>{PLATFORM_LABEL[k]}</Text>
      {(["todo", "posted", "skipped"] as const).map(s => <Choice key={s} p={p} on={state[k] === s} label={s === "todo" ? "Not yet" : s === "posted" ? "Posted" : "Not used"} onPress={() => setState({ ...state, [k]: s })} />)}
    </View>)}
    <Field label="Anywhere else (optional)" value={other} onChange={setOther} p={p} placeholder="For example the local Jobcentre" />
    <Button label="Save" icon="save" p={p} disabled={busy} onPress={() => void onAct({ action: "saveMarketing", platforms: state, postedTo: other.trim() }, "Marketing saved.", "marketing")} />
  </View>;
}

// 4. Interviews: the manager says how, where and when they are free; candidates are invited from the shortlist.
export function InterviewSetup({ p, v, busy, onAct }: { p: Palette; v: Vacancy; busy: boolean; onAct: Act }) {
  const [editing, setEditing] = useState(false);
  if (v.status !== "open" || !v.canInterview || !v.shortlistSharedAt && !v.interview.mode) return null;
  const i = v.interview, open = i.slots.filter(future);
  const booked = new Set(v.candidates.filter(c => c.interviewStatus === "booked").map(c => c.interviewAt));
  return <View style={{ gap: 8 }}>
    <Heading p={p} text="Interviews" />
    {i.mode ? <Line p={p} text={`${i.mode === "virtual" ? "Virtual" : "In person"}, ${i.minutes} minutes, ${i.place}. Free: ${open.length ? open.map(s => slotLabel(s) + (booked.has(s) ? " (booked)" : "")).join(" · ") : "no times left"}.`} />
      : <Line p={p} muted text="Say whether interviews are virtual or in person and when you are free, then invite candidates from the shortlist." />}
    {i.doneAt && <Line p={p} muted text={`All interviews done ${when(i.doneAt)}.`} />}
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button label={i.mode ? "Change the times" : "Set interview times"} icon="calendar" quiet p={p} disabled={busy} onPress={() => setEditing(true)} />
      {!i.doneAt && v.candidates.some(c => c.interviewStatus === "done") && <Button label="All interviews done" icon="check" p={p} disabled={busy} onPress={() => void onAct({ action: "finishInterviews" }, "Interviews ticked. Choose who to offer the job.", "finish")} />}
    </View>
    {editing && <InterviewSheet p={p} v={v} busy={busy} onClose={() => setEditing(false)} onSave={async body => { if (await onAct({ action: "setInterviews", ...body }, "Interview times saved.", "interviews")) setEditing(false); }} />}
  </View>;
}

function InterviewSheet({ p, v, busy, onClose, onSave }: { p: Palette; v: Vacancy; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [mode, setMode] = useState(v.interview.mode ?? "virtual"), [place, setPlace] = useState(v.interview.place), [minutes, setMinutes] = useState(String(v.interview.minutes));
  const [slots, setSlots] = useState<string[]>(v.interview.slots.filter(future)), [dayValue, setDay] = useState(""), [clock, setClock] = useState(""), [error, setError] = useState("");
  const n = Number(minutes);
  function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayValue) || !validClock(clock)) { setError("Choose a day and a time like 10:30"); return; }
    const at = londonInstant(dayValue, clock);
    if (!future(at)) { setError("Choose a time from now on"); return; }
    if (slots.some(s => new Date(s).getTime() === new Date(at).getTime())) { setError("That time is already on the list"); return; }
    setError(""); setSlots([...slots, at].sort()); setClock("");
  }
  return <Sheet palette={p} visible onClose={onClose} title="Interview times" subtitle={v.title} icon="calendar">
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      <Choice p={p} on={mode === "virtual"} label="Virtual" onPress={() => setMode("virtual")} />
      <Choice p={p} on={mode === "in_person"} label="In person" onPress={() => setMode("in_person")} />
    </View>
    <Field label={mode === "virtual" ? "Meeting link" : "Address"} value={place} onChange={setPlace} p={p} placeholder={mode === "virtual" ? "https://meet.google.com/…" : "Where to come"} />
    <Field label="Minutes each" value={minutes} onChange={setMinutes} p={p} placeholder="30" />
    <Heading p={p} text="When you are free" />
    {slots.map(s => <View key={s} style={[ui.between, { gap: 8 }]}>
      <Text style={{ color: p.text, fontSize: 14 }}>{slotLabel(s)}</Text>
      <Button label="Remove" icon="x" quiet p={p} onPress={() => setSlots(slots.filter(x => x !== s))} />
    </View>)}
    <DateField p={p} label="Day" mode="single" wholeMonthLink={false} today={today()} empty="Choose a day" value={{ from: dayValue, to: dayValue }} onChange={next => setDay(next.from)} />
    <Field label="Time (HH:MM, UK time)" value={clock} onChange={setClock} p={p} placeholder="10:30" />
    <Button label="Add this time" icon="plus" quiet p={p} disabled={slots.length >= 30} onPress={add} />
    {!!error && <Notice p={p} tone="bad" text={error} />}
    <Button label={busy ? "Saving…" : "Save"} icon="save" primary p={p} disabled={busy || place.trim().length < 2 || !slots.length || !Number.isInteger(n) || n < 10 || n > 240}
      onPress={() => void onSave({ mode, place: place.trim(), minutes: n, slots })} />
  </Sheet>;
}

// One candidate's interview, offer and contract.
export function CandidateHiring({ p, v, c, read, busy, onAct }: { p: Palette; v: Vacancy; c: Candidate; read: RecruitmentRead; busy: boolean; onAct: Act }) {
  const [booking, setBooking] = useState(false), [outcome, setOutcome] = useState<"done" | "no_show" | null>(null), [note, setNote] = useState("");
  const [contracting, setContracting] = useState(false), [signing, setSigning] = useState(false), [signedName, setSignedName] = useState(c.fullName), [reading, setReading] = useState(false);
  const applicant = <ApplicantPart p={p} v={v} c={c} read={read} busy={busy} onAct={onAct} />;
  if (v.status !== "open" && !c.contract && !c.interviewStatus && !c.offerStatus) return applicant;
  const s = c.interviewStatus, taken = new Set(v.candidates.filter(x => x.id !== c.id && x.interviewStatus === "booked").map(x => x.interviewAt));
  const free = v.interview.slots.filter(x => future(x) && !taken.has(x));
  const live = v.status === "open" && c.status !== "hired";
  const key = (k: string) => k + ":" + c.id;
  return <View style={{ gap: 6 }}>
    {applicant}
    {s && <Line p={p} text={INTERVIEW_STATUS_LABEL[s] + (s === "booked" && c.interviewAt ? `: ${slotLabel(c.interviewAt)}` : s === "invited" && c.interviewExpiresAt ? `, answer by ${slotLabel(c.interviewExpiresAt)}` : "") + (c.interviewNote ? `. ${c.interviewNote}` : "")} />}
    {c.offerStatus && <Line p={p} text={OFFER_STATUS_LABEL[c.offerStatus] + (c.offerNote ? `: ${c.offerNote}` : "")} />}
    {live && v.canInterview && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      {(c.status === "shortlisted" || c.status === "selected") && (!s || s === "declined" || s === "expired") && v.interview.mode &&
        <Button label={s ? "Invite again" : "Invite to interview"} icon="mail" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "inviteToInterview", candidateId: c.id }, `${c.fullName} is invited. The invite expires in 3 days.`, key("invite"))} />}
      {(s === "invited" || s === "booked") && <Button label={s === "booked" ? "Change their time" : "Record their time"} icon="clock" quiet p={p} disabled={busy} onPress={() => setBooking(!booking)} />}
      {(s === "invited" || s === "booked") && <Button label="They declined" icon="x" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "declineInterview", candidateId: c.id }, `${c.fullName} declined the interview.`, key("decline"))} />}
      {s === "booked" && <Button label="Interviewed" icon="check" quiet p={p} disabled={busy} onPress={() => setOutcome("done")} />}
      {s === "booked" && <Button label="Did not attend" icon="user-x" quiet p={p} disabled={busy} onPress={() => setOutcome("no_show")} />}
    </View>}
    {booking && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      {!free.length && <Line p={p} muted text="No free times left. Add more in the interview times." />}
      {free.map(x => <Choice key={x} p={p} on={c.interviewAt === x} label={slotLabel(x)} onPress={() => void onAct({ action: "bookInterview", candidateId: c.id, at: x }, `${c.fullName}’s interview is booked and on the manager’s to-do.`, key("book")).then(ok => { if (ok) setBooking(false); })} />)}
    </View>}
    {outcome && <View style={{ gap: 6 }}>
      <Field label={outcome === "done" ? "Interview notes (optional)" : "Anything to note (optional)"} value={note} onChange={setNote} p={p} multiline />
      <View style={[ui.row, { gap: 6 }]}>
        <Button label="Save" icon="save" p={p} disabled={busy} onPress={() => void onAct({ action: "interviewOutcome", candidateId: c.id, outcome, note: note.trim() }, "Interview recorded.", key("outcome")).then(ok => { if (ok) { setOutcome(null); setNote(""); } })} />
        <Button label="Back" quiet p={p} onPress={() => setOutcome(null)} />
      </View>
    </View>}
    {/* The candidate's answer to the offer, recorded for them. */}
    {live && v.canAnswerFor && c.status === "selected" && c.offerStatus === "offered" && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      <Button label="They accepted the offer" icon="thumbs-up" p={p} disabled={busy} onPress={() => void onAct({ action: "answerOffer", candidateId: c.id, answer: "accept" }, `${c.fullName} accepted. Create their contract next.`, key("offer"))} />
      <Button label="They turned it down" icon="thumbs-down" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "answerOffer", candidateId: c.id, answer: "decline" }, `${c.fullName} turned the offer down.`, key("offer"))} />
    </View>}
    {/* 6. Contract. */}
    {c.contract && <View style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{c.contract.title}</Text>
        <Tag p={p} label={c.contract.signedAt ? "Signed" : "Waiting for their signature"} tone={c.contract.signedAt ? "good" : "wait"} />
      </View>
      <Line p={p} muted text={`Created ${when(c.contract.issuedAt)}${c.contract.issuedByName ? ` by ${c.contract.issuedByName}` : ""}.${c.contract.signedAt ? ` Signed by ${c.contract.signedName} on ${when(c.contract.signedAt)}${c.contract.signedHow === "paper" ? " (on paper)" : ""}.` : ""}`} />
      <Button label={reading ? "Hide the contract" : "Read the contract"} icon="file-text" quiet p={p} onPress={() => setReading(!reading)} />
      {reading && <ContractText p={p} body={c.contract.body} directorName={c.contract.directorName} directorSignature={c.contract.directorSignature} signedName={c.contract.signedName} signedSignature={c.contract.signedSignature} />}
      {live && v.canContract && !c.contract.signedAt && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button label="Signed on paper" icon="edit-3" quiet p={p} disabled={busy} onPress={() => setSigning(!signing)} />
        <Button label="Change the contract" icon="edit-2" quiet p={p} disabled={busy} onPress={() => setContracting(true)} />
        <Button label="Withdraw it" icon="trash-2" quiet p={p} disabled={busy} onPress={() => void onAct({ action: "withdrawContract", candidateId: c.id }, "The contract is withdrawn.", key("withdraw"))} />
      </View>}
      {signing && <View style={{ gap: 6 }}>
        <Field label="The name they signed with" value={signedName} onChange={setSignedName} p={p} />
        <Button label="Record the signed contract" icon="check" p={p} disabled={busy || signedName.trim().length < 2}
          onPress={() => void onAct({ action: "recordContractSigned", candidateId: c.id, signedName: signedName.trim() }, "The signed contract is recorded.", key("signed")).then(ok => { if (ok) setSigning(false); })} />
      </View>}
    </View>}
    {live && v.canContract && c.offerStatus === "accepted" && !c.contract && <Button label="Create their contract" icon="file-plus" primary p={p} disabled={busy} onPress={() => setContracting(true)} />}
    {contracting && <ContractSheet p={p} v={v} c={c} read={read} busy={busy} onClose={() => setContracting(false)}
      onSave={async body => { if (await onAct({ action: "issueContract", candidateId: c.id, ...body }, "The contract is created. They sign it next.", key("contract"))) setContracting(false); }} />}
  </View>;
}

// A careers applicant (migration 20261031400000): their CV, whether they made an account, and messages with recruitment
// (each one also emailed to them from careers@).
function ApplicantPart({ p, v, c, read, busy, onAct }: { p: Palette; v: Vacancy; c: Candidate; read: RecruitmentRead; busy: boolean; onAct: Act }) {
  const [opening, setOpening] = useState(false), [error, setError] = useState(""), [writing, setWriting] = useState(false), [text, setText] = useState("");
  if (c.source !== "careers" && !c.cvFile && !c.messages.length) return null;
  async function openCv() {
    setOpening(true); setError("");
    try {
      const file = await liveApi(`/careers-cv?candidateId=${encodeURIComponent(c.id)}`);
      const url = (file.data as { url?: string } | undefined)?.url;
      if (!url) throw new Error("The CV could not be opened just now");
      await Linking.openURL(url);
    } catch (e) { setError(message(e)); } finally { setOpening(false); }
  }
  return <View style={{ gap: 6 }}>
    {c.source === "careers" && <Line p={p} muted text={`Applied on the careers page${c.appliedAt ? ` on ${when(c.appliedAt)}` : ""}. ${c.hasAccount ? "They have an account to follow their application." : "They have not made their account yet."}`} />}
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      {c.cvFile && <Button label={opening ? "Opening…" : "Open their CV"} icon="file-text" quiet p={p} disabled={opening} onPress={() => void openCv()} />}
      {read.canRecruit && !!c.email && <Button label={writing ? "Hide" : c.messages.length ? `Messages (${c.messages.length})` : "Message them"} icon="message-circle" quiet p={p} onPress={() => setWriting(!writing)} />}
    </View>
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {writing && <View style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      {c.messages.map(m => <View key={m.id} style={{ alignSelf: m.fromApplicant ? "flex-start" : "flex-end", maxWidth: "88%", padding: 8, borderRadius: 10, backgroundColor: m.fromApplicant ? p.wash : p.surface, borderWidth: 1, borderColor: p.border }}>
        <Text style={{ color: p.muted, fontSize: 12 }}>{m.authorName} · {slotLabel(m.at)}</Text>
        <Text style={{ color: p.text, fontSize: 14 }}>{m.body}</Text>
      </View>)}
      {!c.messages.length && <Line p={p} muted text="No messages yet. They get each message by email too." />}
      <Field label="Your message" value={text} onChange={setText} p={p} multiline />
      <Button label="Send" icon="send" p={p} disabled={busy || !text.trim()} onPress={() => void onAct({ action: "sendMessage", candidateId: c.id, body: text.trim() }, `Sent to ${c.fullName}, by email too.`, "message:" + c.id).then(ok => { if (ok) setText(""); })} />
    </View>}
  </View>;
}

export function ContractText({ p, body, directorName, directorSignature, signedName, signedSignature }: { p: Palette; body: string; directorName: string; directorSignature: string | null; signedName?: string | null; signedSignature?: string | null }) {
  const sig = (src: string, who: string) => <View style={{ alignSelf: "flex-start", padding: 6, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: p.border }}>
    <Image accessibilityLabel={"Signature of " + who} source={{ uri: src }} style={{ width: 210, height: 70 }} resizeMode="contain" />
  </View>;
  return <View style={{ gap: 8 }}>
    <Text selectable style={[ui.small, { color: p.text }]}>{body}</Text>
    {!!directorSignature && <View style={{ gap: 4 }}>{sig(directorSignature, directorName || "the director")}<Line p={p} muted text={`Signed for Recharge by ${directorName || "a director"}`} /></View>}
    {!!signedName && <View style={{ gap: 4 }}>{signedSignature ? sig(signedSignature, signedName) : null}<Line p={p} muted text={`Signed by ${signedName}`} /></View>}
  </View>;
}

// Recruitment choose the role's template and fill its blanks (some come from the candidate and the vacancy).
function ContractSheet({ p, v, c, read, busy, onClose, onSave }: { p: Palette; v: Vacancy; c: Candidate; read: RecruitmentRead; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const usable = read.templates.filter(t => t.active && t.directorSignature && (!t.jobKeys.length || t.jobKeys.includes(v.jobKey)));
  const first = usable[0];
  const [templateId, setTemplateId] = useState(first?.id ?? "");
  const template = usable.find(t => t.id === templateId);
  const [fields, setFields] = useState<Record<string, string>>(() => template ? { ...prefillBlanks(template.blanks, c, v), ...(c.contract?.fields ?? {}) } : {});
  function choose(t: ContractTemplate) { setTemplateId(t.id); setFields({ ...prefillBlanks(t.blanks, c, v), ...Object.fromEntries(Object.entries(fields).filter(([k]) => t.blanks.includes(k))) }); }
  const filled = template ? template.blanks.every(b => (fields[b] ?? "").trim()) : false;
  return <Sheet palette={p} visible onClose={onClose} title={`Contract for ${c.fullName}`} subtitle={v.title} icon="signature">
    {!usable.length && <Notice p={p} text="No signed contract template for this job yet. Add one in Contract templates and ask a director to sign it." />}
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{usable.map(t => <Choice key={t.id} p={p} on={t.id === templateId} label={t.title} onPress={() => choose(t)} />)}</View>
    {template && template.blanks.map(b => <Field key={b} label={blankLabel(b)} value={fields[b] ?? ""} onChange={value => setFields({ ...fields, [b]: value })} p={p} />)}
    {template && !template.blanks.length && <Line p={p} muted text="This template has no blanks to fill." />}
    <Button label={busy ? "Saving…" : "Create the contract"} icon="file-plus" primary p={p} disabled={busy || !template || !filled}
      onPress={() => template && void onSave({ templateId: template.id, fields: Object.fromEntries(template.blanks.map(b => [b, (fields[b] ?? "").trim()])) })} />
  </Sheet>;
}

// Contract templates: wording with {{blanks}}, the jobs it is for, and a director's signature.
export function TemplatesSheet({ p, read, send, onClose, onDone }: { p: Palette; read: RecruitmentRead; send: (body: Record<string, unknown>) => Promise<RecruitmentRead>; onClose: () => void; onDone: (r: RecruitmentRead) => void }) {
  const [editing, setEditing] = useState<ContractTemplate | "new" | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId("contract-templates");
  async function act(body: Record<string, unknown>, key: string) {
    if (busy) return false;
    setBusy(true); setError("");
    try { onDone(await send({ ...body, requestId: request.get(key) })); request.done(key); return true; } catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  if (editing) return <TemplateEditor p={p} read={read} template={editing === "new" ? null : editing} busy={busy} error={error} onClose={() => { setEditing(null); setError(""); }}
    onSave={async body => { if (await act({ action: "saveContractTemplate", ...body }, "save:" + (editing === "new" ? "new" : editing.id))) setEditing(null); }} />;
  const jobName = (k: string) => read.settings.jobs.find(j => j.key === k)?.title ?? k;
  return <Sheet palette={p} visible onClose={onClose} title="Contract templates" subtitle="The contracts new starters sign, pre-signed by a director" icon="signature" width={720}>
    <Line p={p} muted text="Write the wording with blanks in double curly brackets, such as {{full_name}}, {{address}} or {{rate}}. Recruitment fill them in for each new starter." />
    {!read.templates.length && <Notice p={p} text="No templates yet." />}
    {read.templates.map(t => <View key={t.id} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "600", flexShrink: 1 }}>{t.title}</Text>
        <Tag p={p} label={!t.active ? "Not in use" : t.directorSignature ? "Signed by a director" : "Waiting for a director"} tone={!t.active ? "plain" : t.directorSignature ? "good" : "wait"} />
      </View>
      <Line p={p} muted text={`${t.jobKeys.length ? t.jobKeys.map(jobName).join(", ") : "Any job"} · blanks: ${t.blanks.map(blankLabel).join(", ") || "none"}`} />
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button label={read.canApprove && !t.directorSignature ? "Read and sign" : "Edit"} icon="edit-2" quiet p={p} disabled={busy} onPress={() => setEditing(t)} />
        {read.canRecruit && <Button label="Remove" icon="trash-2" quiet p={p} disabled={busy} onPress={() => void act({ action: "deleteContractTemplate", templateId: t.id }, "delete:" + t.id)} />}
      </View>
    </View>)}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    <Button label="Add a template" icon="plus" p={p} disabled={busy} onPress={() => setEditing("new")} />
  </Sheet>;
}

function TemplateEditor({ p, read, template, busy, error, onClose, onSave }: { p: Palette; read: RecruitmentRead; template: ContractTemplate | null; busy: boolean; error: string; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState(template?.title ?? ""), [body, setBody] = useState(template?.body ?? ""), [jobs, setJobs] = useState<string[]>(template?.jobKeys ?? []);
  const [active, setActive] = useState(template?.active ?? true), [directorName, setDirectorName] = useState(template?.directorName ?? ""), [signature, setSignature] = useState("");
  const blanks = contractBlanks(body);
  const changed = template && body.trim() !== template.body;
  return <Sheet palette={p} visible onClose={onClose} title={template ? "Edit the template" : "New contract template"} icon="signature" width={720}>
    <Field label="Title" value={title} onChange={setTitle} p={p} placeholder="For example Housekeeper contract (self-employed)" />
    <Heading p={p} text="For which jobs (none chosen: any job)" />
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{read.settings.jobs.map(j => <Choice key={j.key} p={p} on={jobs.includes(j.key)} label={j.title}
      onPress={() => setJobs(jobs.includes(j.key) ? jobs.filter(k => k !== j.key) : [...jobs, j.key])} />)}</View>
    <Field label="Wording" value={body} onChange={setBody} p={p} multiline placeholder={"This agreement is between Recharge Group and {{full_name}} of {{address}}…"} />
    <Line p={p} muted text={blanks.length ? "Blanks: " + blanks.map(blankLabel).join(", ") : "No blanks yet. Add them like {{full_name}}."} />
    <Choice p={p} on={active} label={active ? "In use" : "Not in use"} onPress={() => setActive(!active)} />
    <Heading p={p} text="Director's signature" />
    {template?.directorSignature && !changed && <View style={{ gap: 4 }}>
      <ContractText p={p} body="" directorName={template.directorName} directorSignature={template.directorSignature} />
    </View>}
    {changed && template?.directorSignature && <Notice p={p} text="Changing the wording removes the director's signature until a director signs it again." />}
    {read.canApprove ? <>
      <Field label="Director's name" value={directorName} onChange={setDirectorName} p={p} placeholder="For example Alex Coghill" />
      <SignaturePad p={p} label={template?.directorSignature && !changed ? "Sign again (optional)" : "Sign as director"} onChange={setSignature} disabled={busy} />
    </> : !template?.directorSignature && <Line p={p} muted text="A director signs this template before it can be used." />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    <Button label={busy ? "Saving…" : "Save"} icon="save" primary p={p} disabled={busy || title.trim().length < 2 || body.trim().length < 20 || (!!signature && directorName.trim().length < 2)}
      onPress={() => void onSave({ ...(template ? { templateId: template.id } : {}), title: title.trim(), body: body.trim(), jobKeys: jobs, active, directorName: directorName.trim(), ...(signature ? { directorSignature: signature } : {}) })} />
  </Sheet>;
}
