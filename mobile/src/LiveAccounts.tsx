import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress, Pop, Stagger, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { ui, type Palette } from "./theme";
import { Button, Field, IconChip, london, message, Notice, Section, StatGrid, StatTile, Tag, useRequestId, useWorkFocus, Loading, type IconName, type Tone } from "./LiveKit";
import { formatCount, formatMoney } from "../../lib/format";
import { readFinance, writeFinance, WorkspaceApiError } from "./backend/client";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { PayoutExamples, StatementFiles } from "./AccountsFiles";
import {
  EVIDENCE_KINDS, EXPENSE_CATEGORIES, PAYOUT_LABEL, expenseMoves, expenseSchema, isFinanceRole, expensesSchema, jobsSchema, monthLabel, overviewSchema, policySchema, pounds,
  reconciliationSchema, shiftMonth, statementMoves, statementsSchema, type Expense, type Job, type PayoutRow,
} from "../../lib/accounts-live";
import { poundsToMinor } from "../../lib/repairs-live";
import { readableStage, type PropertyView } from "../../lib/workspace-view";
import type { FinanceAction } from "../../lib/workspace-finance-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Live Accounts: expenses with evidence, payout reconciliation and owner
// statements, read from and written to the backend. Nothing here uses sample data.
type Overview = z.infer<typeof overviewSchema>;
type Reconciliation = z.infer<typeof reconciliationSchema>;
type StatementRow = z.infer<typeof statementsSchema>[number];
type NeedsDetails = Reconciliation["needsDetails"][number];
type Tab = "expenses" | "payouts" | "statements";

const STATUS_LABEL: Record<Expense["status"], [string, "good" | "wait" | "bad" | "plain"]> = { draft: ["Draft", "wait"], to_approve: ["To approve", "wait"], queried: ["Queried", "bad"], approved: ["Approved", "good"], rejected: ["Rejected", "plain"] };
const STATEMENT_LABEL: Record<string, [string, "good" | "wait" | "bad" | "plain"]> = { draft: ["Draft", "wait"], issued: ["Issued to owner", "plain"], paid: ["Paid", "good"], void: ["Void", "bad"] };
const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo", direct: "Direct", other: "Other" };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));

// Choices as pills. A short fixed set wraps onto more lines so every option is visible on a phone;
// long lists (properties, nights) scroll sideways.
export function Pills<T extends string>({ p, values, value, onChange, label, wrap = values.length <= 8 }: { p: Palette; values: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; wrap?: boolean }) {
  const items = values.map(v => {
    const on = v === value;
    return (
      <Pop key={v} active={on}><MotionPress accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(v)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
        <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{label ? label(v) : readableStage(v)}</Text>
      </MotionPress></Pop>
    );
  });
  return wrap
    ? <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{items}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{items}</ScrollView>;
}

// A list row: optional icon, title, supporting line and status tags, with any amount
// right-aligned in lining figures so columns of money line up.
export function Row({ p, title, detail, amount, tags, onPress, first, icon, tone, art }: { p: Palette; title: string; detail: string; amount?: string; tags?: [string, "good" | "wait" | "bad" | "plain"][]; onPress?: () => void; first: boolean; icon?: IconName; tone?: Tone; art?: DimensionalName }) {
  return (
    <MotionPress accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} accessibilityLabel={[title, amount, ...(tags ?? []).map(t => t[0])].filter(Boolean).join(", ")} onPress={onPress} style={[ui.row, { gap: 14, paddingVertical: 14, alignItems: tags?.length ? "flex-start" : "center", borderTopWidth: first ? 0 : 1, borderColor: p.border }]}>
      {art ? <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><DimensionalIcon name={art} size={34} /></View> : !!icon && <IconChip icon={icon} tone={tone} p={p} />}
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
        <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{detail}</Text>
        {!!tags?.length && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{tags.map(([label, tone]) => <Tag key={label} label={label} tone={tone} p={p} />)}</View>}
      </View>
      {!!amount && <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "right", alignSelf: "center" }}>{amount}</Text>}
      {!!onPress && <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />}
    </MotionPress>
  );
}

// Rows arrive one after another; new rows added later slide in on their own.
export function List({ p, empty, children }: { p: Palette; empty: string; children: ReactNode[] }) {
  const items = Children.toArray(children);
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>{items.length ? items.map((child, i) => <Stagger key={isValidElement(child) && child.key != null ? child.key : i} index={i}>{child}</Stagger>) : <SwapIn swapKey={empty}><Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{empty}</Text></SwapIn>}</View>;
}

export function Line({ p, label, value }: { p: Palette; label: string; value: string }) {
  return <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: p.muted, flex: 1 }]}>{label}</Text><Text style={{ color: p.text, fontWeight: "600" }}>{value}</Text></View>;
}

// One sheet for every action that only needs a short note or reference.
export type NoteAsk = { title: string; subtitle?: string; label?: string; min: number; confirm: string; amount?: { label: string; initial: string }; build: (note: string, amountMinor: number | null) => FinanceAction | null };
export function NoteSheet({ p, ask, onClose, onDone }: { p: Palette; ask: NoteAsk | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(ask ? ask.title + ":" + note.trim() + ":" + amount : null);
  useEffect(() => { queueMicrotask(() => { setNote(""); setError(""); setAmount(ask?.amount?.initial ?? ""); }); }, [ask]);
  async function save() {
    if (!ask || busy) return;
    if (note.trim().length < ask.min) { setError(`Write at least ${ask.min} characters.`); return; }
    const minor = ask.amount ? poundsToMinor(amount) : null;
    if (ask.amount && minor === null) { setError("Enter the amount in pounds, for example 450.00."); return; }
    const action = ask.build(note.trim(), minor);
    if (!action) return;
    setBusy(true); setError("");
    try { await writeFinance({ ...action, requestId: request.get() } as FinanceAction); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!ask} onClose={onClose} title={ask?.title ?? ""} subtitle={ask?.subtitle} icon="coins">
      {ask?.amount && <Field label={ask.amount.label} value={amount} onChange={setAmount} p={p} placeholder="£0.00" />}
      {!!ask?.label && <Field label={ask.label} value={note} onChange={setNote} p={p} multiline={ask.min >= 5} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : ask?.confirm ?? "Save"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

const jobLabel = (j: Job) => `${j.kind === "maintenance" ? "Repair" : "Purchase"} · ${j.detail}`;
const jobDetail = (j: Job) => [new Date(j.doneOn + "T12:00:00Z").toLocaleDateString("en-GB"), j.supplier, j.costMinor != null ? pounds(j.costMinor) : "", j.photoCount ? `${j.photoCount} photo${j.photoCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
// Finished repairs and delivered purchases at a property, for linking an expense to its job.
function useJobs(propertyId: string | null) {
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setJobs([]); });
    if (propertyId) readFinance({ section: "jobs", propertyId }).then(r => { const parsed = jobsSchema.safeParse(r.data); if (active && parsed.success) setJobs(parsed.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [propertyId]);
  return jobs;
}
function JobPicker({ p, jobs, value, onChange }: { p: Palette; jobs: Job[]; value: string | null; onChange: (job: Job | null) => void }) {
  if (!jobs.length) return <Text style={[ui.small, { color: p.muted }]}>No finished repairs or delivered purchases at this property yet.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {jobs.slice(0, 12).map(j => {
        const on = value === j.workId;
        return (
          <MotionPress key={j.workId} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(on ? null : j)} style={[ui.row, { gap: 10, minHeight: 48, padding: 10, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
            <Feather name={on ? "check-circle" : j.kind === "maintenance" ? "tool" : "shopping-bag"} size={18} color={p.primary} />
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{jobLabel(j)}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{jobDetail(j)}</Text></View>
          </MotionPress>
        );
      })}
    </View>
  );
}

export function ExpenseSheet({ p, role, id, limit, onClose, onAsk, onDone }: { p: Palette; role: string; id: string | null; limit: number | null; onClose: () => void; onAsk: (ask: NoteAsk) => void; onDone: () => Promise<void> }) {
  const [expense, setExpense] = useState<Expense | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof EVIDENCE_KINDS)[number]>("invoice");
  const [label, setLabel] = useState("");
  const [checked, setChecked] = useState("");
  const [linkJob, setLinkJob] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]), [uploading, setUploading] = useState(false), [pickerKey, setPickerKey] = useState(0);
  const [linking, setLinking] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const jobs = useJobs(expense && isFinanceRole(role) ? expense.propertyId : null);
  const evidenceRequest = useRequestId(expense ? "evidence:" + expense.id + ":" + kind + ":" + label + ":" + checked + ":" + linkJob + ":" + photos.join(",") : null);
  const approveRequest = useRequestId(expense ? "approve:" + expense.id + ":" + expense.version : null);
  const linkRequest = useRequestId(expense ? "link:" + expense.id + ":" + expense.version : null);
  const submitRequest = useRequestId(expense ? "submit:" + expense.id + ":" + expense.version + ":" + JSON.stringify(draft) : null);
  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const value = expenseSchema.parse((await readFinance({ section: "expense", id })).data);
      setExpense(value);
      // A draft's invoice number is a placeholder until the supplier's invoice arrives.
      setDraft({ supplier: value.supplier, reference: value.status === "draft" && value.reference.startsWith("REPAIR-") ? "" : value.reference, amount: (value.amountMinor / 100).toFixed(2), receivedOn: london(new Date()), description: value.description });
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "This expense could not be loaded."); }
  }, [id]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setExpense(null); setAdding(false); setLinking(false); setPhotos([]); void load(); } }); return () => { active = false; }; }, [load]);

  async function addEvidence() {
    if (!expense || busy || uploading) return;
    if (label.trim().length < 2 || (!photos.length && !linkJob && checked.trim().length < 10)) { setError("Name the document, then add photos or describe what you checked (at least 10 characters)."); return; }
    setBusy(true); setError("");
    try {
      if (photos.length) await writeFinance({ action: "attachExpensePhotos", requestId: evidenceRequest.get(), expenseId: expense.id, kind, label: label.trim().slice(0, 180), mediaIds: photos, ...(checked.trim() ? { note: checked.trim() } : {}) });
      else await writeFinance({ action: "addExpenseEvidence", requestId: evidenceRequest.get(), expenseId: expense.id, kind, label: label.trim(), ...(linkJob && expense.workId ? { workId: expense.workId } : {}), ...(checked.trim() ? { note: checked.trim() } : {}) });
      evidenceRequest.done(); setLabel(""); setChecked(""); setLinkJob(false); setPhotos([]); setPickerKey(k => k + 1); setAdding(false); await load(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function link(job: Job | null) {
    if (!expense || busy) return;
    setBusy(true); setError("");
    try { await writeFinance({ action: "linkExpenseJob", requestId: linkRequest.get(), expenseId: expense.id, version: expense.version, workId: job ? job.workId : null }); linkRequest.done(); setLinking(false); await load(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function submitDraft() {
    if (!expense || busy) return;
    const amountMinor = poundsToMinor(draft.amount ?? "");
    if ((draft.supplier ?? "").trim().length < 2 || !(draft.reference ?? "").trim() || (draft.description ?? "").trim().length < 5 || !amountMinor || !isDate(draft.receivedOn ?? "") || (draft.receivedOn ?? "") > london(new Date())) {
      setError("Add the supplier, their invoice number, the amount, the date it was received and what it was for."); return;
    }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "submitDraftExpense", requestId: submitRequest.get(), expenseId: expense.id, version: expense.version, supplier: draft.supplier.trim(), reference: draft.reference.trim(), amountMinor, receivedOn: draft.receivedOn, description: draft.description.trim() });
      submitRequest.done(); await load(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function approve() {
    if (!expense || busy) return;
    setBusy(true); setError("");
    try { await writeFinance({ action: "approveExpense", requestId: approveRequest.get(), expenseId: expense.id, version: expense.version }); approveRequest.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const rule = expense ? expenseMoves(role, expense, limit) : { moves: [] };
  const decide = (move: "query" | "resolve" | "reject") => expense && onAsk({
    query: { title: "Query this expense", label: "Question for the supplier or team", min: 5, confirm: "Send query", build: (note: string) => ({ action: "queryExpense", requestId: "", expenseId: expense.id, version: expense.version, note }) },
    resolve: { title: "Resolve the query", label: "What was the answer?", min: 5, confirm: "Back to approval", build: (note: string) => ({ action: "resolveExpenseQuery", requestId: "", expenseId: expense.id, version: expense.version, note }) },
    reject: { title: "Reject this expense", label: "Reason (shared with the team)", min: 5, confirm: "Reject expense", build: (note: string) => ({ action: "rejectExpense", requestId: "", expenseId: expense.id, version: expense.version, note }) },
  }[move] as NoteAsk);
  const linked = expense?.workId ? jobs.find(j => j.workId === expense.workId) : undefined;
  const mediaIds = (expense?.evidence ?? []).flatMap(item => item.mediaId ? [item.mediaId] : []);
  const set = (k: string) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Sheet palette={p} visible={!!id} onClose={onClose} title={expense?.supplier ?? "Expense"} subtitle={expense ? `${expense.status === "draft" ? "Draft" : expense.reference} · ${expense.propertyName}` : undefined} icon="coins">
      {!expense && !error && <Loading p={p} />}
      {expense && <>
        <View style={[ui.between, { alignItems: "flex-end" }]}>
          <View><Text style={[ui.small, { color: p.muted }]}>Amount</Text><Text style={{ color: p.text, fontSize: 30, fontWeight: "700", letterSpacing: -1 }}>{pounds(expense.amountMinor)}</Text></View>
          <Tag label={STATUS_LABEL[expense.status][0]} tone={STATUS_LABEL[expense.status][1]} p={p} />
        </View>
        <Line p={p} label="Category" value={readableStage(expense.category)} />
        <Line p={p} label="Received" value={new Date(expense.receivedOn + "T12:00:00Z").toLocaleDateString("en-GB")} />
        {expense.status === "approved" && <Line p={p} label="Xero" value={expense.xeroStatus === "posted" ? "Posted" : expense.xeroStatus === "failed" ? "Posting failed" : "Queued until Xero is connected"} />}
        <Text style={[ui.body, { color: p.text }]}>{expense.description}</Text>
        {!!expense.queryNote && <Notice text={"Query: " + expense.queryNote} p={p} />}
        {!!expense.decisionNote && <Notice text={"Decision note: " + expense.decisionNote} p={p} />}

        <Section title="Job" p={p}>
          {expense.workId ? <View style={{ gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{linked ? jobLabel(linked) : "Linked to a finished job"}</Text>{!!linked && <Text style={[ui.small, { color: p.muted }]}>{jobDetail(linked)}</Text>}</View>
            : <Text style={[ui.small, { color: p.muted }]}>Not linked to a repair or purchase.</Text>}
          {rule.moves.includes("link") && !linking && <Button label={expense.workId ? "Change the job" : "Link to a finished job"} icon="link" p={p} onPress={() => setLinking(true)} />}
          {linking && <View style={{ gap: 10 }}>
            <JobPicker p={p} jobs={jobs} value={expense.workId} onChange={job => void link(job)} />
            <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
              {!!expense.workId && <Button label="Unlink" icon="x" p={p} disabled={busy} onPress={() => void link(null)} />}
              <Button label="Cancel" p={p} onPress={() => setLinking(false)} />
            </View>
          </View>}
        </Section>

        <Section title="Evidence" count={expense.evidence?.length ?? 0} p={p}>
          {(expense.evidence ?? []).map(item => (
            <View key={item.id} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
              <Feather name={item.kind === "invoice" ? "file-text" : item.kind === "photo" ? "image" : item.kind === "quote" ? "clipboard" : "check-square"} size={18} color={p.primary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}><Text style={{ color: p.text, fontWeight: "600" }}>{item.label} · {readableStage(item.kind)}</Text>{!!item.note && <Text style={[ui.small, { color: p.muted }]}>{item.note}</Text>}{!!item.workId && <Text style={[ui.small, { color: p.muted }]}>Linked to the finished job</Text>}</View>
            </View>
          ))}
          <PhotoStrip p={p} ids={mediaIds} />
          {!expense.hasInvoice && <Notice text="No invoice attached yet." p={p} />}
          {expense.hasInvoice && !expense.hasProof && <Notice text="There is an invoice but no proof the work happened (photo, quote or sign-off)." p={p} />}
        </Section>

        {rule.moves.includes("evidence") && !adding && <Button label="Add evidence" icon="paperclip" p={p} onPress={() => setAdding(true)} />}
        {adding && <View style={{ gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.elevated }}>
          <Pills p={p} values={EVIDENCE_KINDS} value={kind} onChange={setKind} />
          <Field label="Document name" value={label} onChange={setLabel} p={p} placeholder={kind === "invoice" ? "For example: Leith Plumbing invoice 881" : "For example: After photos"} />
          <PhotoPicker key={pickerKey} p={p} expenseId={expense.id} purpose="expense" label={kind === "invoice" ? "Photo or scan of the invoice" : "Photos"} hint="JPEG, PNG or WebP, up to 8 MB each. For a PDF invoice, attach a screenshot of each page." onChange={(ids, loading) => { setPhotos(ids); setUploading(loading); }} />
          <Field label={photos.length ? "Note (optional)" : "What you checked"} value={checked} onChange={setChecked} p={p} multiline placeholder="For example: invoice matches the quote and the job report" />
          {!!expense.workId && kind !== "invoice" && !photos.length && <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: linkJob }} onPress={() => setLinkJob(v => !v)} style={[ui.row, { gap: 12, minHeight: 44 }]}><Feather name={linkJob ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>Use the finished job as proof</Text></MotionPress>}
          <View style={[ui.row, { gap: 10 }]}><Button label="Cancel" p={p} onPress={() => setAdding(false)} /><Button label={busy ? "Saving…" : uploading ? "Saving photos…" : "Attach"} primary p={p} disabled={busy || uploading} onPress={() => void addEvidence()} /></View>
        </View>}

        {rule.moves.includes("submit") && <View style={{ gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: p.border }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{"The supplier’s invoice"}</Text>
          <Field label="Supplier" value={draft.supplier ?? ""} onChange={set("supplier")} p={p} />
          <Field label="Invoice number" value={draft.reference ?? ""} onChange={set("reference")} p={p} />
          <Field label="Amount" value={draft.amount ?? ""} onChange={set("amount")} p={p} placeholder="£0.00" />
          <Field label="Received on (YYYY-MM-DD)" value={draft.receivedOn ?? ""} onChange={set("receivedOn")} p={p} />
          <Field label="What it was for" value={draft.description ?? ""} onChange={set("description")} p={p} multiline />
          <Button label={busy ? "Sending…" : "Send for approval"} icon="send" primary p={p} disabled={busy} onPress={() => void submitDraft()} />
        </View>}

        {!!rule.blocked && <Notice text={rule.blocked} p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {rule.moves.includes("approve") && <Button label={busy ? "Approving…" : "Approve and queue for Xero"} icon="check" primary p={p} disabled={busy} onPress={() => void approve()} />}
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          {rule.moves.includes("query") && <Button label="Query" icon="help-circle" p={p} onPress={() => decide("query")} />}
          {rule.moves.includes("resolve") && <Button label="Resolve query" icon="check-circle" p={p} onPress={() => decide("resolve")} />}
          {rule.moves.includes("reject") && <Button label="Reject" icon="x" p={p} onPress={() => decide("reject")} />}
        </View>
      </>}
      {!expense && !!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

function NewExpenseSheet({ p, visible, properties, onClose, onDone }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [propertyId, setPropertyId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState<(typeof EXPENSE_CATEGORIES)[number]>("maintenance");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const jobs = useJobs(visible && propertyId ? propertyId : null);
  const request = useRequestId(visible ? ["expense", propertyId, supplier, reference, amount, job?.workId ?? ""].join(":") : null);
  // Choosing the job fills in what it already knows.
  function choose(next: Job | null) {
    setJob(next);
    if (!next) return;
    if (!supplier.trim() && next.supplier) setSupplier(next.supplier);
    if (!amount.trim() && next.costMinor) setAmount((next.costMinor / 100).toFixed(2));
    if (!description.trim()) setDescription(jobLabel(next));
    setCategory(next.kind === "maintenance" ? "maintenance" : "furnishing");
  }
  async function save() {
    const amountMinor = poundsToMinor(amount);
    if (!propertyId || supplier.trim().length < 2 || !reference.trim() || description.trim().length < 5 || !amountMinor || !isDate(receivedOn) || receivedOn > today) {
      setError("Choose the property and add the supplier, invoice number, what it was for, the amount and the date received (not in the future)."); return;
    }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "createExpense", requestId: request.get(), propertyId, ...(job ? { workId: job.workId } : {}), supplier: supplier.trim(), reference: reference.trim(), category, description: description.trim(), amountMinor, receivedOn, source: "manual" });
      request.done(); setSupplier(""); setReference(""); setDescription(""); setAmount(""); setJob(null); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="New expense" subtitle="Add the invoice and proof next, then approve" icon="coins">
      <Pills p={p} values={properties.map(x => x.id)} value={propertyId} onChange={id => { setPropertyId(id); setJob(null); }} label={id => properties.find(x => x.id === id)?.name ?? "Property"} />
      {!properties.length && <Notice text="No properties are available to you yet." p={p} />}
      {!!propertyId && <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Which job is this for? (optional)</Text>
        <JobPicker p={p} jobs={jobs} value={job?.workId ?? null} onChange={choose} />
      </View>}
      <Field label="Supplier" value={supplier} onChange={setSupplier} p={p} />
      <Field label="Invoice number" value={reference} onChange={setReference} p={p} />
      <Pills p={p} values={EXPENSE_CATEGORIES} value={category} onChange={setCategory} />
      <Field label="What it was for" value={description} onChange={setDescription} p={p} multiline />
      <Field label="Amount" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
      <Field label="Received on (YYYY-MM-DD)" value={receivedOn} onChange={setReceivedOn} p={p} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save expense"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Platform, reservation code, guests and expected payout for a stay.
function StaySheet({ p, stay, onClose, onDone }: { p: Palette; stay: (NeedsDetails | PayoutRow) & { propertyName?: string } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [channel, setChannel] = useState<"airbnb" | "booking_com" | "vrbo" | "direct" | "other">("airbnb");
  const [code, setCode] = useState("");
  const [guests, setGuests] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(stay ? ["stay", stay.reservationId, stay.version, channel, code, guests, payout].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!stay) return;
      const row = stay as Partial<PayoutRow>;
      setChannel((["airbnb", "booking_com", "vrbo", "direct", "other"].includes(stay.channel) ? stay.channel : "airbnb") as typeof channel);
      setCode(row.channelReference ?? ""); setGuests(stay.guests ? String(stay.guests) : ""); setPayout(row.expectedMinor != null ? (row.expectedMinor / 100).toFixed(2) : ""); setError("");
    });
  }, [stay]);
  const platform = channel === "airbnb" || channel === "booking_com";
  async function save() {
    if (!stay || busy) return;
    const payoutMinor = payout.trim() ? poundsToMinor(payout) : null, guestCount = guests.trim() ? Number(guests) : null;
    if (platform && !code.trim()) { setError("Add the platform reservation code, exactly as it appears on the payout report."); return; }
    if (payout.trim() && payoutMinor === null) { setError("Enter the payout in pounds, for example 460.00."); return; }
    if (!platform && payoutMinor === null) { setError("Add the payout amount for this stay. The owner statement needs it."); return; }
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50)) { setError("Guests must be a number from 1 to 50."); return; }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "setReservationFinancials", requestId: request.get(), propertyId: stay.propertyId, reservationId: stay.reservationId, version: stay.version, channel, ...(code.trim() ? { channelReference: code.trim() } : {}), guests: guestCount, payoutMinor });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!stay} onClose={onClose} title={stay?.reference ?? "Stay"} subtitle={stay ? `${stay.propertyName ? stay.propertyName + " · " : ""}${stay.checkIn} to ${stay.checkOut}` : undefined} icon="calendar">
      <Pills p={p} values={["airbnb", "booking_com", "vrbo", "direct", "other"] as const} value={channel} onChange={setChannel} label={v => CHANNEL_LABEL[v]} />
      {platform && <Field label={channel === "airbnb" ? "Airbnb confirmation code" : "Booking.com reservation number"} value={code} onChange={setCode} p={p} placeholder={channel === "airbnb" ? "HM…" : "10 digits"} />}
      <Field label="Guests (optional)" value={guests} onChange={setGuests} p={p} />
      <Field label={platform ? "Expected payout (optional)" : "Payout for this stay"} value={payout} onChange={setPayout} p={p} placeholder="£0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save stay details"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

function TermsSheet({ p, row, onClose, onDone }: { p: Palette; row: StatementRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [fee, setFee] = useState("");
  const [clean, setClean] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(row ? ["terms", row.propertyId, fee, clean].join(":") : null);
  useEffect(() => { queueMicrotask(() => { if (!row) return; setFee(row.terms?.managementFeeBps != null ? String(row.terms.managementFeeBps / 100) : ""); setClean(row.terms?.cleaningCostMinor != null ? (row.terms.cleaningCostMinor / 100).toFixed(2) : ""); setError(""); }); }, [row]);
  async function save() {
    if (!row || busy) return;
    const percent = Number(fee), cleaningCostMinor = poundsToMinor(clean);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(fee.trim()) || percent > 100 || cleaningCostMinor === null) { setError("Enter the fee as a percentage (for example 20) and the cleaning cost per clean."); return; }
    setBusy(true); setError("");
    try { await writeFinance({ action: "setStatementTerms", requestId: request.get(), propertyId: row.propertyId, managementFeeBps: Math.round(percent * 100), cleaningCostMinor }); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title="Statement terms" subtitle={row?.propertyName} icon="clipboard">
      <Text style={[ui.small, { color: p.muted }]}>{"Take these from the owner’s management agreement."}</Text>
      <Field label="Management fee (% of payouts)" value={fee} onChange={setFee} p={p} placeholder="20" />
      <Field label="Cleaning cost per clean" value={clean} onChange={setClean} p={p} placeholder="£0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save terms"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

async function pickCsv(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
  return { name: asset.name, text };
}

export function LiveAccounts({ palette: p, account, properties }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const saved = useSaved();
  const role = account.role, management = role === "admin" || role === "super_admin";
  const thisMonth = london(new Date()).slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const focus = useWorkFocus();
  const [view, setView] = useState<Tab>(() => (["expenses", "payouts", "statements"] as const).find(v => v === focus?.sub) ?? "expenses");
  const [status, setStatus] = useState<Expense["status"]>("to_approve");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [limit, setLimit] = useState<{ minor: number | null; version: number } | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rec, setRec] = useState<Reconciliation | null>(null);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openExpense, setOpenExpense] = useState<string | null>(null);
  const [creating, setCreating] = useState(() => focus?.open === "new-expense");
  const [ask, setAsk] = useState<NoteAsk | null>(null);
  const [stay, setStay] = useState<(NeedsDetails | PayoutRow) & { propertyName?: string } | null>(null);
  const [terms, setTerms] = useState<StatementRow | null>(null);
  const [channel, setChannel] = useState<"airbnb" | "booking_com">("airbnb");
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyStatement, setBusyStatement] = useState("");
  // Keep one request identifier per attempted action until it succeeds.
  const ids = useRef(new Map<string, string>());
  const idFor = (key: string) => { if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID()); return ids.current.get(key)!; };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [o, pol, ex, r, st] = await Promise.allSettled([
      readFinance({ section: "overview", period }), readFinance({ section: "policy" }), readFinance({ section: "expenses", status }),
      readFinance({ section: "reconciliation", period }), readFinance({ section: "statements", period }),
    ]);
    // Each part loads on its own, so one that fails (for example, a tool this person doesn't have)
    // doesn't blank the others.
    const problems: string[] = [];
    const take = (result: PromiseSettledResult<{ data?: unknown }>, apply: (data: unknown) => void) => {
      try { if (result.status === "fulfilled") apply(result.value.data); else throw result.reason; }
      catch (e) { problems.push(e instanceof WorkspaceApiError ? e.message : "Part of Accounts could not be loaded. Refresh to try again."); }
    };
    take(o, data => setOverview(overviewSchema.parse(data)));
    take(pol, data => { const v = policySchema.parse(data); setLimit({ minor: v.expenseApprovalLimitMinor, version: v.version }); });
    take(ex, data => setExpenses(expensesSchema.parse(data)));
    take(r, data => setRec(reconciliationSchema.parse(data)));
    take(st, data => setStatements(statementsSchema.parse(data)));
    if (problems.length) setError([...new Set(problems)].join(" "));
    setLoading(false);
  }, [period, status]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  async function upload() {
    if (uploading) return;
    setUploadNote("");
    try {
      const file = await pickCsv();
      if (!file) return;
      if (file.text.length > 250000) { setUploadNote("This report is too large. Split it by month and upload each part."); return; }
      setUploading(true);
      const result = (await writeFinance({ action: "importPayoutReport", requestId: idFor("upload:" + channel + ":" + file.name + ":" + file.text.length), channel, fileName: file.name.slice(0, 200), csv: file.text })).data as { lineCount?: number; matchedReservations?: number; unexpectedLines?: number };
      ids.current.delete("upload:" + channel + ":" + file.name + ":" + file.text.length);
      setUploadNote(`Uploaded ${result.lineCount ?? 0} payouts: ${result.matchedReservations ?? 0} matched to stays, ${result.unexpectedLines ?? 0} not recognised.`);
      await load();
    } catch (e) { setUploadNote(message(e)); } finally { setUploading(false); }
  }
  async function statementAction(key: string, action: FinanceAction) {
    if (busyStatement) return;
    setBusyStatement(key); setError("");
    try { await writeFinance({ ...action, requestId: idFor(key) } as FinanceAction); ids.current.delete(key); await load(); }
    catch (e) { setError(message(e)); } finally { setBusyStatement(""); }
  }

  const unsettled = (overview?.unsettledPayouts ?? 0) + (overview?.missingDetails ?? 0);
  const tiles = [
    { label: "To approve", value: overview?.toApproveCount ?? 0, icon: "check-circle" as IconName, detail: formatMoney(overview?.toApproveMinor ?? 0) + " in costs" + (overview?.draftCount ? ` · ${formatCount(overview.draftCount)} draft${overview.draftCount === 1 ? "" : "s"}` : ""), attention: (overview?.toApproveCount ?? 0) > 0 },
    { label: "To reconcile", value: unsettled, icon: "repeat" as IconName, detail: "Stays · " + monthLabel(period), attention: unsettled > 0 },
    { label: "Statements paid", value: `${formatCount(overview?.statements.paid ?? 0)} of ${formatCount(statements.length)}`, icon: "pie-chart" as IconName, detail: `${formatCount(overview?.statements.issued ?? 0)} issued · ${formatCount(overview?.statements.draft ?? 0)} draft`, attention: false },
  ];

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Accounts</Text>
        <Text style={[ui.body, { color: p.muted }]}>Approve costs with evidence, reconcile platform payouts and pay owners.</Text>
      </View>

      <View style={[ui.between, { gap: 8 }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setPeriod(shiftMonth(period, -1))} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><Feather name="chevron-left" size={20} color={p.primary} /></MotionPress>
        <Text style={{ color: p.text, fontSize: 17, fontWeight: "700" }}>{monthLabel(period)}</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: period >= thisMonth }} disabled={period >= thisMonth} onPress={() => setPeriod(shiftMonth(period, 1))} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: period >= thisMonth ? p.elevated : p.wash }}><Feather name="chevron-right" size={20} color={period >= thisMonth ? p.muted : p.primary} /></MotionPress>
      </View>

      <StatGrid>
        {tiles.map(tile => <StatTile key={tile.label} p={p} icon={tile.icon} tone="accounts" label={tile.label} value={tile.value} detail={tile.detail} attention={tile.attention} />)}
      </StatGrid>

      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      <View style={[ui.row, { gap: 8 }]}>
        {(["expenses", "payouts", "statements"] as const).map(v => <Button key={v} label={{ expenses: "Expenses", payouts: "Payouts", statements: "Statements" }[v]} primary={view === v} p={p} onPress={() => setView(v)} />)}
      </View>

      {view === "expenses" && <>
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          <Button label="New expense" icon="plus" primary p={p} onPress={() => setCreating(true)} />
          <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
        </View>
        {(overview?.overLimitCount ?? 0) > 0 && <Notice text={`${overview!.overLimitCount} expense${overview!.overLimitCount === 1 ? " is" : "s are"} above the approval limit and need${overview!.overLimitCount === 1 ? "s" : ""} management approval.`} p={p} />}
        {(overview?.draftCount ?? 0) > 0 && status !== "draft" && <MotionPress accessibilityRole="button" onPress={() => setStatus("draft")} style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
          <Feather name="tool" size={16} color={p.waiting} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{overview!.draftCount === 1 ? "A completed repair is waiting as a draft" : `${overview!.draftCount} completed repairs are waiting as drafts`}: add the supplier’s invoice and send for approval.</Text><Feather name="chevron-right" size={16} color={p.muted} />
        </MotionPress>}
        <Pills p={p} values={["draft", "to_approve", "queried", "approved", "rejected"] as const} value={status} onChange={setStatus} label={v => v === "draft" ? "Drafts" : STATUS_LABEL[v][0]} />
        <List p={p} empty="Nothing in this view.">
          {expenses.map((e, i) => (
            <Row key={e.id} p={p} first={i === 0} title={e.supplier} detail={`${e.propertyName} · ${readableStage(e.category)} · ${new Date(e.receivedOn + "T12:00:00Z").toLocaleDateString("en-GB")}`} amount={pounds(e.amountMinor)}
              tags={[STATUS_LABEL[e.status], [e.hasInvoice && e.hasProof ? "Evidence complete" : `${e.evidenceCount} document${e.evidenceCount === 1 ? "" : "s"}`, e.hasInvoice && e.hasProof ? "good" : "wait"]]} onPress={() => setOpenExpense(e.id)} />
          ))}
        </List>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Approval limit for Accounts</Text>
          <Text style={[ui.small, { color: p.muted }]}>{limit?.minor == null ? "No limit set. Accounts can approve any evidenced expense." : `Accounts approves up to ${pounds(limit.minor)}. Larger costs need management.`}</Text>
          {role === "super_admin" && limit && <Button label="Change the limit" p={p} onPress={() => setAsk({ title: "Approval limit", subtitle: "Accounts can approve evidenced costs up to this amount", min: 0, confirm: "Save limit", amount: { label: "Limit (leave 0 for no limit)", initial: limit.minor == null ? "0" : (limit.minor / 100).toFixed(2) }, build: (_note, minor) => ({ action: "setFinancePolicy", requestId: "", version: limit.version, expenseApprovalLimitMinor: minor ? minor : null }) })} />}
        </View>
        <Notice text="Xero is not connected yet. Approved costs are queued and will post as bills, tracked to each property, once it is." p={p} />
      </>}

      {view === "payouts" && rec && <>
        <Section title="Upload a payout report" p={p}>
          <Pills p={p} values={["airbnb", "booking_com"] as const} value={channel} onChange={setChannel} label={v => CHANNEL_LABEL[v]} />
          <Button label={uploading ? "Uploading…" : `Choose ${CHANNEL_LABEL[channel]} CSV`} icon="upload" primary p={p} disabled={uploading} onPress={() => void upload()} />
          {!!uploadNote && <Notice text={uploadNote} p={p} />}
          <Text style={[ui.small, { color: p.muted }]}>Not sure which file? Download an example: the upload reads the same columns (the reservation code and the payout amount).</Text>
          <PayoutExamples p={p} period={period} />
        </Section>
        {rec.needsDetails.length > 0 && <Section title="Stays missing details" count={rec.needsDetails.length} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Add the platform and code, or the payout for direct stays. The owner statement waits for these.</Text>
          <List p={p} empty="">
            {rec.needsDetails.map((s, i) => <Row key={s.reservationId} p={p} first={i === 0} title={s.reference} detail={`${s.propertyName} · ${s.checkIn} to ${s.checkOut}`} tags={[["Needs details", "wait"]]} onPress={() => setStay(s)} />)}
          </List>
        </Section>}
        <Section title="Platform stays" count={rec.rows.filter(r => r.settledMinor === null).length} p={p}>
          <List p={p} empty="No Airbnb or Booking.com stays this month.">
            {rec.rows.map((r, i) => (
              <Row key={r.reservationId} p={p} first={i === 0} title={r.reference} detail={`${CHANNEL_LABEL[r.channel] ?? r.channel}${r.channelReference ? " " + r.channelReference : ""} · ${r.checkIn} · expected ${pounds(r.expectedMinor)}, received ${pounds(r.receivedMinor)}`}
                amount={r.settledMinor !== null ? pounds(r.settledMinor) : undefined} tags={[PAYOUT_LABEL[r.state]]}
                onPress={r.state === "matched" ? undefined : () => r.state === "no_reference" || r.state === "no_expected_amount" ? setStay({ ...r, propertyName: properties.find(x => x.id === r.propertyId)?.name }) : setAsk({
                  title: "Agree the payout", subtitle: `${r.reference} · expected ${pounds(r.expectedMinor)}, received ${pounds(r.receivedMinor)}`, label: "Why this amount is right", min: 5, confirm: "Agree payout",
                  amount: { label: "Agreed amount", initial: ((r.receivedMinor ?? r.expectedMinor ?? 0) / 100).toFixed(2) },
                  build: (note, minor) => ({ action: "agreePayout", requestId: "", reservationId: r.reservationId, version: r.version, agreedMinor: minor ?? 0, note }),
                })} />
            ))}
          </List>
        </Section>
        {rec.unexpected.length > 0 && <Section title="Payouts we could not match" count={rec.unexpected.length} p={p}>
          <List p={p} empty="">
            {rec.unexpected.map((u, i) => <Row key={u.lineId} p={p} first={i === 0} title={u.reference} detail={`${CHANNEL_LABEL[u.channel] ?? u.channel} · ${u.fileName}`} amount={pounds(u.amountMinor)} tags={[["Set aside or add the stay", "wait"]]}
              onPress={() => setAsk({ title: "Set this payout aside", subtitle: `${u.reference} · ${pounds(u.amountMinor)}`, label: "Why it is not for a managed stay", min: 5, confirm: "Set aside", build: note => ({ action: "setAsidePayoutLine", requestId: "", lineId: u.lineId, note }) })} />)}
          </List>
        </Section>}
        {rec.reports.length > 0 && <Section title="Recent uploads" p={p}>
          <List p={p} empty="">{rec.reports.slice(0, 6).map((r, i) => <Row key={r.id} p={p} first={i === 0} title={r.fileName} detail={`${CHANNEL_LABEL[r.channel] ?? r.channel} · ${r.lineCount} payouts · ${new Date(r.uploadedAt).toLocaleDateString("en-GB")}`} amount={pounds(r.totalMinor)} />)}</List>
        </Section>}
      </>}

      {view === "statements" && <>
        {!statements.length && !loading && <Notice text="No properties are available for statements yet." p={p} />}
        {statements.map(row => {
          const st = row.statement, rule = statementMoves(role, row), key = (k: string) => k + ":" + row.propertyId + ":" + (st?.version ?? 0);
          return (
            <View key={row.propertyId} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 12 }]}>
              <View style={[ui.between, { gap: 10 }]}>
                <Text style={{ color: p.text, fontSize: 16, fontWeight: "700", flex: 1 }}>{row.propertyName}</Text>
                <Tag label={st ? STATEMENT_LABEL[st.status][0] : "Not prepared"} tone={st ? STATEMENT_LABEL[st.status][1] : "plain"} p={p} />
              </View>
              <Text style={[ui.small, { color: p.muted }]}>{row.terms?.managementFeeBps != null ? `Fee ${row.terms.managementFeeBps / 100}% · cleaning ${pounds(row.terms.cleaningCostMinor)} per clean` : "Fee and cleaning cost not set yet"}</Text>
              {st && <>
                <Line p={p} label="Payouts received" value={pounds(st.revenueMinor)} />
                <Line p={p} label={`Cleaning (${st.cleaningCount})`} value={"−" + pounds(st.cleaningMinor)} />
                <Line p={p} label="Approved expenses" value={"−" + pounds(st.expensesMinor)} />
                <Line p={p} label={`Management fee (${st.feeBps / 100}%)`} value={"−" + pounds(st.feeMinor)} />
                <View style={{ height: 1, backgroundColor: p.border }} />
                <Line p={p} label={st.payoutMinor < 0 ? "Owner owes" : "Due to owner"} value={pounds(Math.abs(st.payoutMinor))} />
                {st.status === "paid" && <Text style={[ui.small, { color: p.muted }]}>Paid by bank transfer, reference {st.payoutReference}.</Text>}
                <MotionPress accessibilityRole="button" onPress={() => setExpanded(expanded === st.id ? null : st.id)} style={[ui.row, { gap: 6 }]}><Feather name={expanded === st.id ? "chevron-up" : "chevron-down"} size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>{expanded === st.id ? "Hide breakdown" : "Show breakdown"}</Text></MotionPress>
                {expanded === st.id && <View style={{ gap: 6 }}>
                  {st.detail.stays.map(x => <Line key={x.reference + x.checkIn} p={p} label={`${x.reference} · ${CHANNEL_LABEL[x.channel] ?? x.channel} · ${x.checkIn}`} value={pounds(x.amountMinor)} />)}
                  {st.detail.expenses.map(x => <Line key={x.reference} p={p} label={`${x.supplier} · ${x.reference}`} value={"−" + pounds(x.amountMinor)} />)}
                </View>}
                <StatementFiles p={p} statement={st} audience="accounts" />
              </>}
              {!!rule.blocked && <Notice text={rule.blocked} p={p} />}
              <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
                {management && <Button label="Set terms" icon="sliders" p={p} onPress={() => setTerms(row)} />}
                {rule.moves.includes("prepare") && <Button label={busyStatement === key("prepare") ? "Preparing…" : st ? "Prepare again" : "Prepare statement"} icon="file-text" primary={!st} p={p} disabled={!!busyStatement} onPress={() => void statementAction(key("prepare"), { action: "prepareStatement", requestId: "", propertyId: row.propertyId, period })} />}
                {rule.moves.includes("issue") && st && <Button label={busyStatement === key("issue") ? "Issuing…" : "Issue to owner"} icon="send" primary p={p} disabled={!!busyStatement} onPress={() => void statementAction(key("issue"), { action: "issueStatement", requestId: "", statementId: st.id, version: st.version })} />}
                {rule.moves.includes("pay") && st && <Button label="Record bank transfer" icon="check" primary p={p} onPress={() => setAsk({ title: "Record the owner payout", subtitle: `${row.propertyName} · ${pounds(st.payoutMinor)}`, label: "Bank transfer reference", min: 3, confirm: "Mark as paid", build: reference => ({ action: "recordOwnerPayout", requestId: "", statementId: st.id, version: st.version, method: "bank_transfer", reference }) })} />}
                {rule.moves.includes("void") && st && <Button label="Void" icon="x" p={p} onPress={() => setAsk({ title: "Void this statement", subtitle: row.propertyName, label: "Reason", min: 5, confirm: "Void statement", build: reason => ({ action: "voidStatement", requestId: "", statementId: st.id, version: st.version, reason }) })} />}
              </View>
            </View>
          );
        })}
        <Text style={[ui.small, { color: p.muted }]}>Owners see issued and paid statements in their app. Stripe payouts will be added when Stripe is connected.</Text>
      </>}

      <ExpenseSheet p={p} role={role} id={openExpense} limit={limit?.minor ?? null} onClose={() => setOpenExpense(null)} onAsk={a => { setOpenExpense(null); setAsk(a); }} onDone={saved(load)} />
      <NewExpenseSheet p={p} visible={creating} properties={properties} onClose={() => setCreating(false)} onDone={saved(load)} />
      <NoteSheet p={p} ask={ask} onClose={() => setAsk(null)} onDone={saved(load)} />
      <StaySheet p={p} stay={stay} onClose={() => setStay(null)} onDone={saved(load)} />
      <TermsSheet p={p} row={terms} onClose={() => setTerms(null)} onDone={saved(load)} />
    </View>
  );
}
