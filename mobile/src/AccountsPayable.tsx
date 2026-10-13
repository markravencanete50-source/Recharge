import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { ListSearchBox, matchesSearch, PropertySelect, SEARCH_LIST_ABOVE, SearchBox, searchTextOf, useListSearch } from "./SearchPicker";
import { CHOOSE_PROPERTY_FIRST, saveDisabled } from "../../lib/search-picker";
import { ExpandChevron, MotionPress, Pop, Stagger, SwapIn } from "./motion";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { CleanCostReviewSheet } from "./CleanCostReview";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { departmentColor, primaryFill, ui, type Palette } from "./theme";
import { Button, Field, IconChip, london, message, Loading, Notice, RefreshButton, Section, Tag, useRequestId, type IconName, type Tone } from "./LiveKit";
import { readFinance, readOperations, readTeams, writeFinance, writeOperation, WorkspaceApiError } from "./backend/client";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { cleanerInvoicesReportSchema, cleansToReviewReportSchema, EVIDENCE_KINDS, EXPENSE_CATEGORIES, expenseMoves, expenseSchema, isFinanceRole, jobsSchema, overviewSchema, pounds, type CleanCostReview, type Expense, type Job } from "../../lib/accounts-live";
import { awaitingCleans, cleansFreedByRejection, cleansOnLiveInvoices, cleansWithoutForm, decideInvoiceAction, invoiceMismatch, invoiceTasksToClose, overrunMinor, recordInvoiceAction, reviewTag, splitCleansToReview, sumMinor, type AwaitingClean } from "../../lib/accounts-work";
import { cleanerRatesSchema } from "../../lib/cleans-live";
import { formatDay, formatMoney, plural } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";
import { canStart } from "../../lib/home-tools";
import { cleanerInvoiceTrackerItems, type PayableInvoice } from "../../lib/tracker-payables";
import { addressOf } from "../../lib/tracker";
import { operationViewSchema, readableStage, type PropertyView } from "../../lib/workspace-view";
import type { OperationView } from "../../lib/workflow-forms";
import type { FinanceAction } from "../../lib/workspace-finance-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Payable tab of Live Accounts: cleans to review, cleaner invoices, and supplier invoices and expenses (with evidence, approval and links to a job).
export type Overview = z.infer<typeof overviewSchema>;
export type LimitState = { minor: number | null; version: number; repairMinor: number | null };

const STATUS_LABEL: Record<Expense["status"], [string, "good" | "wait" | "bad" | "plain"]> = { draft: ["Draft", "wait"], to_approve: ["To approve", "wait"], queried: ["Queried", "bad"], approved: ["Approved", "good"], rejected: ["Rejected", "plain"] };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));

// Choices as pills. A short fixed set wraps onto more lines so every option is visible on a phone;
// long lists (properties, nights) scroll sideways.
export function Pills<T extends string>({ p, values, value, onChange, label, wrap = values.length <= 8 }: { p: Palette; values: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; wrap?: boolean }) {
  const items = values.map(v => {
    const on = v === value;
    return (
      <Pop key={v} active={on}><MotionPress {...(Platform.OS === "web" && !on ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(v)} style={[{ minHeight: 42, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: on ? p.primary : p.border }, on ? primaryFill(p) : { backgroundColor: p.surface }]}>
        <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{label ? label(v) : readableStage(v)}</Text>
      </MotionPress></Pop>
    );
  });
  return wrap
    ? <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{items}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{items}</ScrollView>;
}

// A list row: optional icon, title, supporting line and status tags, with any amount
// right-aligned in lining figures so columns of money line up. A row that opens something takes a quiet wash on hover
// and a bar on keyboard focus (lib/design-tokens.ts), not the box other pressables get.
// A person's initials in a soft circle of their department's colour.
export function Initials({ p, name, tone, size = 42 }: { p: Palette; name: string; tone?: Tone; size?: number }) {
  const colour = tone ? departmentColor(tone, p) : { ink: p.primary, wash: p.wash };
  const letters = name.trim().split(/[\s@.]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: colour.wash, borderWidth: 1.5, borderColor: p.surface }}>
    <Text style={{ color: colour.ink, fontSize: Math.round(size * 0.36), fontWeight: "800", letterSpacing: 0.3 }}>{letters}</Text>
  </View>;
}
export function Row({ p, title, detail, amount, tags, onPress, first, icon, tone, art, avatar }: { p: Palette; title: string; detail: string; amount?: string; tags?: [string, "good" | "wait" | "bad" | "plain"][]; onPress?: () => void; first: boolean; icon?: IconName; tone?: Tone; art?: DimensionalName; avatar?: string }) {
  return (
    <MotionPress {...(Platform.OS === "web" && onPress ? { dataSet: { hover: "row" } } : {})} accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} accessibilityLabel={[title, amount, ...(tags ?? []).map(t => t[0])].filter(Boolean).join(", ")} onPress={onPress} style={[ui.row, { gap: 14, paddingVertical: 14, alignItems: tags?.length ? "flex-start" : "center", borderTopWidth: first ? 0 : 1, borderColor: p.border }]}>
      {avatar !== undefined ? <Initials p={p} name={avatar} tone={tone} /> : art ? <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><DimensionalIcon name={art} size={34} color={p.primary} /></View> : !!icon && <IconChip icon={icon} tone={tone} p={p} />}
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
export function List({ p, empty, children, search = true }: { p: Palette; empty: string; children: ReactNode[]; search?: boolean }) {
  const all = Children.toArray(children);
  const [query, setQuery] = useState("");
  // Lists under a page's own search box don't add a second one.
  const searchable = search && all.length > SEARCH_LIST_ABOVE;
  const items = searchable && query.trim() ? all.filter(child => matchesSearch(searchTextOf(child), query)) : all;
  const card = <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>{items.length ? items.map((child, i) => <Stagger key={isValidElement(child) && child.key != null ? child.key : i} index={i}>{child}</Stagger>) : <SwapIn swapKey={empty}><Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{empty}</Text></SwapIn>}</View>;
  if (!searchable) return card;
  return (
    <View style={{ gap: 8 }}>
      <SearchBox p={p} value={query} onChange={setQuery} placeholder={`Search this list (${all.length})`} />
      {items.length ? card : <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{query.trim()}”.</Text>}
    </View>
  );
}

export function Line({ p, label, value }: { p: Palette; label: string; value: string }) {
  return <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: p.muted, flex: 1 }]}>{label}</Text><Text style={{ color: p.text, fontWeight: "600" }}>{value}</Text></View>;
}

export type NoteAsk = { title: string; subtitle?: string; label?: string; min: number; confirm: string; amount?: { label: string; initial: string }; build: (note: string, amountMinor: number | null) => FinanceAction | null };

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
  // The job is chosen when the button is pressed, so each choice keeps its own request id (the key names the job, or "none" to unlink).
  const linkIds = useRef(new Map<string, string>());
  const linkKey = (job: Job | null) => "link:" + (expense?.id ?? "") + ":" + (expense?.version ?? "") + ":" + (job?.workId ?? "none");
  const submitRequest = useRequestId(expense ? "submit:" + expense.id + ":" + expense.version + ":" + JSON.stringify(draft) : null);
  // keepDraft: reload the expense after adding evidence or linking a job without throwing away what was typed into the draft invoice form.
  const load = useCallback(async (options?: { keepDraft?: boolean }) => {
    if (!id) return;
    setError("");
    try {
      const value = expenseSchema.parse((await readFinance({ section: "expense", id })).data);
      setExpense(value);
      if (options?.keepDraft) return;
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
      evidenceRequest.done(); setLabel(""); setChecked(""); setLinkJob(false); setPhotos([]); setPickerKey(k => k + 1); setAdding(false); await load({ keepDraft: true }); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function link(job: Job | null) {
    if (!expense || busy) return;
    setBusy(true); setError("");
    const key = linkKey(job);
    if (!linkIds.current.has(key)) linkIds.current.set(key, Crypto.randomUUID());
    try { await writeFinance({ action: "linkExpenseJob", requestId: linkIds.current.get(key)!, expenseId: expense.id, version: expense.version, workId: job ? job.workId : null }); linkIds.current.delete(key); setLinking(false); await load({ keepDraft: true }); await onDone(); }
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

export function NewExpenseSheet({ p, visible, properties, onClose, onDone }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
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
  const request = useRequestId(visible ? "expense:" + JSON.stringify([propertyId, supplier.trim(), reference.trim(), category, description.trim(), amount, receivedOn, job?.workId ?? ""]) : null);
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
      <PropertySelect p={p} properties={properties} value={propertyId} onChange={id => { setPropertyId(id); setJob(null); }} />
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
      {!propertyId && <Text style={[ui.small, { color: p.muted }]}>{CHOOSE_PROPERTY_FIRST}</Text>}
      <Button label={busy ? "Saving…" : "Save expense"} primary p={p} disabled={saveDisabled(busy, propertyId)} onPress={() => void save()} />
    </Sheet>
  );
}

// --- Payable: what cleans cost against what owners are charged, and the invoices cleaners send. Finance roles only.
// Both lists read the finance reports 'cleansToReview' and 'cleanerInvoices' (supabase/migrations/20261012090000_clean_costs_terms.sql).
const parseCleans = (data: unknown) => { const r = cleansToReviewReportSchema.safeParse(data); return r.success ? r.data : null; };
const parseInvoices = (data: unknown) => { const r = cleanerInvoicesReportSchema.safeParse(data); return r.success ? r.data : null; };
const NO_PROPERTIES: readonly PropertyView[] = [];
const NO_QUERY: Record<string, string> = {};
const QUERY_ALL: Record<string, string> = { state: "all" };

// One finance report: read when the screen opens and again whenever `tick` changes or reload() is called.
function useReport<T>(section: string, query: Record<string, string>, parse: (data: unknown) => T | null, tick: number, failure: string) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: true });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: "" }));
    try {
      const data = parse((await readFinance({ section, ...query })).data);
      setState({ data, error: data ? "" : failure, loading: false });
    } catch (e) { setState(s => ({ ...s, error: message(e), loading: false })); }
  }, [section, query, parse, failure]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, tick]);
  return { ...state, reload: load };
}

function CleanRow({ p, clean, address, first, onPress }: { p: Palette; clean: CleanCostReview; address: string; first: boolean; onPress: () => void }) {
  const over = overrunMinor(clean), [tagLabel, tagTone] = reviewTag(clean);
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "row" } } : {})} accessibilityRole="button" onPress={onPress}
      accessibilityLabel={[address, formatDay(clean.cleanDate), `charged ${formatMoney(clean.agreedMinor)}`, `actual cost ${formatMoney(clean.actualMinor)}`, over !== null ? `${formatMoney(over)} over` : "", clean.cleanerName ?? "", tagLabel].filter(Boolean).join(", ")}
      style={[ui.row, { gap: 12, alignItems: "flex-start", paddingVertical: 14, borderTopWidth: first ? 0 : 1, borderTopColor: p.border }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
          <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{address}</Text>
          <Tag label={tagLabel} tone={tagTone} p={p} />
        </View>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{formatDay(clean.cleanDate)}{clean.cleanerName ? ` · ${clean.cleanerName}` : ""}</Text>
        <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>Charged {formatMoney(clean.agreedMinor)} · Actual {formatMoney(clean.actualMinor)}{over !== null && <Text style={[ui.small, { color: p.danger, fontWeight: "600" }]}>{` · ${formatMoney(over)} over`}</Text>}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
    </MotionPress>
  );
}

// Cleans whose actual cost is more than the owner is charged, flagged for a manual review. To review first, then reviewed.
function CleansToReview({ p, properties, tick }: { p: Palette; properties: readonly PropertyView[]; tick: number }) {
  const saved = useSaved();
  const report = useReport("cleansToReview", QUERY_ALL, parseCleans, tick, "The cleans to review could not be read. Refresh to try again.");
  const [open, setOpen] = useState<CleanCostReview | null>(null), [showReviewed, setShowReviewed] = useState(false);
  const { toReview, reviewed } = useMemo(() => splitCleansToReview(report.data?.cleans ?? []), [report.data]);
  const addressFor = useCallback((c: CleanCostReview) => addressOf(properties.find(x => x.id === c.propertyId)) || c.propertyName, [properties]);
  const search = useListSearch(toReview, c => [addressFor(c), c.cleanerName ?? "", c.propertyName]);
  const card = (rows: CleanCostReview[]) => (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
      {rows.map((c, n) => <CleanRow key={c.workId} p={p} clean={c} address={addressFor(c)} first={!n} onPress={() => setOpen(c)} />)}
    </View>
  );
  return (
    <Section title="Cleans to review" count={toReview.length} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Cleans that cost more than the owner is charged. For each one, choose whether the owner pays the agreed fee or the actual cost.</Text>
      {!!report.error && <Notice text={report.error} p={p} tone="bad" />}
      {report.loading && !report.data && <Loading p={p} rows={2} />}
      {!report.loading && !report.error && !toReview.length && <Notice text="No cleans are waiting for a cost review." p={p} />}
      {!!toReview.length && <ListSearchBox p={p} search={search} nouns="cleans" />}
      {!!search.shown.length && card([...search.shown])}
      {!!reviewed.length && <View style={{ gap: 10 }}>
        <MotionPress accessibilityRole="button" accessibilityState={{ expanded: showReviewed }} accessibilityLabel={`Reviewed, ${reviewed.length}`} onPress={() => setShowReviewed(v => !v)} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
          <Text style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>Reviewed · {reviewed.length}</Text>
          <ExpandChevron open={showReviewed} size={16} color={p.muted} />
        </MotionPress>
        {showReviewed && card(reviewed)}
      </View>}
      <CleanCostReviewSheet p={p} clean={open} address={open ? addressFor(open) : undefined} onClose={() => setOpen(null)} onDone={saved(async () => { setOpen(null); await report.reload(); })} />
    </Section>
  );
}
// Approve or reject a cleaner invoice that is waiting. Rejecting needs a reason; the invoice's cleans are then free for a corrected one.
// Approving also closes the "invoice accepted clean" task of each clean on the invoice, as the older single-invoice flow did, so they stop
// showing as waiting for an invoice. That happens on approval and not when the invoice is recorded, so a rejected invoice leaves its tasks open.
// If a task cannot be closed the invoice stays approved and the button finishes the rest, never approving twice.
function InvoiceDecision({ p, invoice, onDone }: { p: Palette; invoice: PayableInvoice; onDone: () => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Set once the approval is saved: the invoice tasks may still need closing.
  const [approved, setApproved] = useState(false);
  const taskIds = useRef(new Map<string, string>());
  const approveId = useRequestId("decide:" + invoice.id + ":approve");
  const rejectId = useRequestId("decide:" + invoice.id + ":reject:" + note.trim());
  if (invoice.status !== "to_approve") return null;
  // No approval until every clean on the invoice has its clean form (client answer 8); the database refuses it too.
  const noForm = cleansWithoutForm(invoice.lines);
  const noFormText = noForm.length
    ? `${plural(noForm.length, "clean")} on this invoice ${noForm.length === 1 ? "has" : "have"} no clean form yet${noForm.some(l => l.cleanDate) ? ` (${noForm.map(l => [l.propertyName, l.cleanDate ? formatDay(l.cleanDate) : ""].filter(Boolean).join(", ")).join("; ")})` : ""}. The invoice can be approved once the cleaner sends ${noForm.length === 1 ? "it" : "them"}.`
    : "";
  // Closes the tasks still open for this invoice's cleans. Each keeps its own request id, so a retry never closes the same task twice.
  async function closeTasks(): Promise<boolean> {
    try {
      const ops = operationViewSchema.array().safeParse((await readOperations()).data);
      if (!ops.success) throw new Error("The invoice tasks could not be read.");
      const tasks = invoiceTasksToClose(ops.data, invoice);
      const evidence = `Included in cleaner invoice ${invoice.reference.trim()} from ${invoice.supplier.trim()}: ${plural(invoice.lines?.length || invoice.lineCount || tasks.length, "clean")}, ${formatMoney(invoice.totalMinor)} in total.`;
      let failed = 0, why = "";
      for (const t of tasks) {
        const key = t.workId + ":" + t.version;
        if (!taskIds.current.has(key)) taskIds.current.set(key, Crypto.randomUUID());
        try { await writeOperation({ action: "updateOperation", requestId: taskIds.current.get(key)!, workId: t.workId, version: t.version, step: "completeHandover", data: { evidence } }); }
        catch (e) { failed++; why = message(e); }
      }
      if (failed) throw new Error(`${plural(failed, "invoice task")} could not be closed: ${why}`);
      return true;
    } catch (e) { setError(`The invoice is approved, but its invoice tasks are not all closed. ${message(e)} Press the button to try again.`); return false; }
  }
  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!(decision === "approve" && approved)) {
        const id = decision === "approve" ? approveId : rejectId;
        const built = decideInvoiceAction({ requestId: id.get(), invoiceId: invoice.id, decision, note: decision === "reject" ? note : "" });
        if ("error" in built) { setError(built.error); return; }
        await writeFinance(built.action); id.done();
        if (decision === "approve") setApproved(true);
      }
      if (decision === "approve" && !(await closeTasks())) return;
      await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (approved) return (
    <View style={{ gap: 12 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Closing…" : "Close the remaining invoice tasks"} icon="check" primary p={p} disabled={busy} onPress={() => void decide("approve")} />
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      {rejecting
        ? <>
          <Field label="Why is it rejected? (at least 5 characters)" value={note} onChange={setNote} p={p} multiline placeholder="For example: the date does not match the clean" />
          {!!error && <Notice text={error} p={p} tone="bad" />}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button label="Cancel" p={p} disabled={busy} onPress={() => { setRejecting(false); setError(""); }} />
            <Button label={busy ? "Rejecting…" : "Reject invoice"} icon="x" primary p={p} disabled={busy} onPress={() => void decide("reject")} />
          </View>
        </>
        : <>
          {!!noFormText && <Notice text={noFormText} p={p} />}
          {!!error && <Notice text={error} p={p} tone="bad" />}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button label={busy ? "Approving…" : "Approve invoice"} icon="check" primary p={p} disabled={busy || noForm.length > 0} onPress={() => void decide("approve")} />
            <Button label="Reject" icon="x" p={p} disabled={busy} onPress={() => { setRejecting(true); setError(""); }} />
          </View>
        </>}
    </View>
  );
}

// Record an invoice a cleaner sent: who, the reference and date, then the completed cleans it covers with the amount charged for each.
// The cleans' amounts must add up to the invoice total. Saving only records the invoice: the cleans' "invoice accepted clean" tasks
// stay open until the invoice is approved (InvoiceDecision), so a rejected invoice's cleans can go on a corrected one.
function RecordInvoiceForm({ p, properties, initialCleanerId, onDone }: { p: Palette; properties: readonly PropertyView[]; initialCleanerId: string | null; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [supplier, setSupplier] = useState(""), [reference, setReference] = useState(""), [invoiceDate, setInvoiceDate] = useState(today), [total, setTotal] = useState("");
  const [propertyId, setPropertyId] = useState(""), [cleanerId, setCleanerId] = useState(initialCleanerId ?? "");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [source, setSource] = useState<{ work: OperationView[]; rates: ReadonlyMap<string, number>; onInvoice: ReadonlySet<string>; freed: ReadonlySet<string> } | null>(null), [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const nameOf = useCallback((id: string) => properties.find(x => x.id === id)?.name ?? "Property", [properties]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [o, i, r] = await Promise.allSettled([readOperations(), readFinance({ section: "cleanerInvoices" }), readTeams({ section: "cleanerRates" })]);
      if (!active) return;
      const ops = o.status === "fulfilled" ? operationViewSchema.array().safeParse(o.value.data) : null;
      if (!ops?.success) { setLoadError(o.status === "rejected" ? message(o.reason) : "The cleans could not be read. Close this and try again."); return; }
      // If the invoices could not be read, the database still refuses a clean that is already on a live invoice.
      const invoices = i.status === "fulfilled" ? parseInvoices(i.value.data) : null;
      const pay = r.status === "fulfilled" ? cleanerRatesSchema.safeParse(r.value.data) : null;
      setSource({ work: ops.data, rates: new Map(pay?.success ? pay.data.map(x => [x.cleanerId, x.rateMinor]) : []), onInvoice: cleansOnLiveInvoices(invoices?.invoices ?? []), freed: cleansFreedByRejection(invoices?.invoices ?? []) });
    })();
    return () => { active = false; };
  }, []);

  const all = useMemo(() => source ? awaitingCleans(source.work, nameOf, source.rates, source.onInvoice, source.freed) : [], [source, nameOf]);
  const cleaners = useMemo(() => [...new Map(all.map(c => [c.cleanerId, c.cleanerName])).entries()].map(([id, name]) => ({ id, name })), [all]);
  // A cleaner opened from the work list starts the form with their name.
  useEffect(() => {
    const first = cleaners.find(c => c.id === initialCleanerId);
    if (first) queueMicrotask(() => setSupplier(s => s || first.name));
  }, [cleaners, initialCleanerId]);
  const shown = all.filter(c => (!propertyId || c.propertyId === propertyId) && (!cleanerId || c.cleanerId === cleanerId));
  const propertyOptions = properties.filter(x => all.some(c => c.propertyId === x.id));
  const lines = all.filter(c => c.cleanWorkId in picked);
  const amounts = lines.map(c => poundsToMinor(picked[c.cleanWorkId] ?? ""));
  const valid = amounts.filter((n): n is number => !!n);
  const sum = sumMinor(valid), totalMinor = poundsToMinor(total);
  const mismatch = valid.length === lines.length ? invoiceMismatch(totalMinor, valid) : null;
  const request = useRequestId("record:" + JSON.stringify([supplier.trim(), reference.trim(), invoiceDate, total, lines.map((c, n) => [c.cleanWorkId, amounts[n]])]));

  function toggle(c: AwaitingClean) {
    setPicked(prev => { const next = { ...prev }; if (c.cleanWorkId in next) delete next[c.cleanWorkId]; else next[c.cleanWorkId] = c.rateMinor ? (c.rateMinor / 100).toFixed(2) : ""; return next; });
  }
  function chooseCleaner(id: string) {
    setCleanerId(id);
    const name = cleaners.find(c => c.id === id)?.name;
    if (name && (!supplier.trim() || cleaners.some(c => c.name === supplier))) setSupplier(name);
  }
  async function save() {
    if (busy) return;
    const built = recordInvoiceAction({ requestId: request.get(), supplier, reference, invoiceDate, today, totalMinor, lines: lines.map((c, n) => ({ workId: c.cleanWorkId, amountMinor: amounts[n] })) });
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try { await writeFinance(built.action); request.done(); }
    catch (e) { setError(message(e)); setBusy(false); return; }
    setBusy(false); await onDone();
  }

  return (
    <>
      <Field label="Cleaner or company (as on the invoice)" value={supplier} onChange={setSupplier} p={p} placeholder="For example: Cara Cleaning" />
      <Field label="Invoice reference" value={reference} onChange={setReference} p={p} placeholder="For example: CARA-2026-10" />
      <Field label="Invoice date (YYYY-MM-DD)" value={invoiceDate} onChange={setInvoiceDate} p={p} />
      <Field label="Invoice total" value={total} onChange={setTotal} p={p} placeholder="£0.00" />
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "600" }}>Which cleans does it cover?</Text>
        {!source && !loadError && <Loading p={p} rows={2} />}
        {!!loadError && <Notice text={loadError} p={p} tone="bad" />}
        {!!source && !all.length && <Notice text="No completed cleans are waiting for an invoice." p={p} />}
        {cleaners.length > 1 && <Pills p={p} values={["", ...cleaners.map(c => c.id)] as readonly string[]} value={cleanerId} onChange={chooseCleaner} label={v => v ? cleaners.find(c => c.id === v)?.name ?? "Cleaner" : "All cleaners"} />}
        {propertyOptions.length > 1 && <PropertySelect p={p} properties={propertyOptions} value={propertyId} onChange={setPropertyId} clearable />}
        {shown.map(c => {
          const on = c.cleanWorkId in picked;
          return (
            <View key={c.cleanWorkId} style={{ gap: 8 }}>
              <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${c.propertyName}, ${formatDay(c.cleanedOn)}, ${c.cleanerName}`} onPress={() => toggle(c)}
                style={[ui.row, { gap: 12, minHeight: 52, padding: 10, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
                <Feather name={on ? "check-square" : "square"} size={20} color={p.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{c.propertyName}</Text>
                  <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{formatDay(c.cleanedOn)} · {c.cleanerName}</Text>
                </View>
              </MotionPress>
              {on && <View style={{ paddingLeft: 12 }}><Field label="Amount on the invoice for this clean" value={picked[c.cleanWorkId] ?? ""} onChange={v => setPicked(prev => ({ ...prev, [c.cleanWorkId]: v }))} p={p} placeholder="£0.00" /></View>}
            </View>
          );
        })}
        {!!source && !!all.length && !shown.length && <Text style={[ui.small, { color: p.muted }]}>No cleans match that choice.</Text>}
      </View>
      {!!lines.length && <View style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: p.wash }}>
        <Line p={p} label={`${plural(lines.length, "clean")} picked`} value={formatMoney(sum)} />
        {totalMinor !== null && <Line p={p} label="Invoice total" value={formatMoney(totalMinor)} />}
        {mismatch ? <Text style={[ui.small, { color: p.danger, fontWeight: "600" }]}>{mismatch}</Text>
          : totalMinor !== null && valid.length === lines.length ? <Text style={[ui.small, { color: p.success, fontWeight: "600" }]}>The cleans add up to the invoice total.</Text> : null}
        {sum > 0 && totalMinor !== sum && valid.length === lines.length && <Button label={`Use ${formatMoney(sum)} as the invoice total`} p={p} onPress={() => setTotal((sum / 100).toFixed(2))} />}
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Record invoice"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    </>
  );
}

export function RecordCleanerInvoiceSheet({ p, visible, properties, initialCleanerId = null, onClose, onDone }: { p: Palette; visible: boolean; properties: readonly PropertyView[]; initialCleanerId?: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Record a cleaner invoice" subtitle="Match it to the cleans it covers" icon="coins">
      {visible && <RecordInvoiceForm p={p} properties={properties} initialCleanerId={initialCleanerId} onDone={onDone} />}
    </Sheet>
  );
}

// Invoices from cleaners, each followed through received, matched, approved and settled (lib/tracker-payables.ts).
function CleanerInvoices({ p, properties, tick }: { p: Palette; properties: readonly PropertyView[]; tick: number }) {
  const saved = useSaved();
  const report = useReport("cleanerInvoices", NO_QUERY, parseInvoices, tick, "The cleaner invoices could not be read. Refresh to try again.");
  const [openId, setOpenId] = useState<string | null>(null), [recording, setRecording] = useState(false);
  const ctx = useMemo(() => ({ property: (id: string) => properties.find(x => x.id === id), now: new Date(), owner: false, canDecide: true }), [properties]);
  const items = useMemo(() => cleanerInvoiceTrackerItems(report.data?.invoices ?? [], ctx), [report.data, ctx]);
  const open = items.find(i => i.id === openId) ?? null;
  return (
    <Section title="Cleaner invoices received" count={items.filter(i => !i.closed).length} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Invoices cleaners have sent, matched to the cleans they cover. Approve or reject each one.</Text>
      <Button label="Record cleaner invoice" icon="plus" primary p={p} onPress={() => setRecording(true)} />
      <TrackerList p={p} items={items} onOpen={item => setOpenId(item.id)} empty="No cleaner invoices have been recorded yet." loading={report.loading} error={report.error} />
      <TrackerDetailSheet p={p} item={open} onClose={() => setOpenId(null)}>
        {open && <InvoiceDecision key={open.id} p={p} invoice={open.source} onDone={saved(async () => { setOpenId(null); await report.reload(); })} />}
      </TrackerDetailSheet>
      <RecordCleanerInvoiceSheet p={p} visible={recording} properties={properties} onClose={() => setRecording(false)} onDone={saved(async () => { setRecording(false); await report.reload(); })} />
    </Section>
  );
}

// The Payable tab body, rendered by LiveAccounts while that tab is selected: cleans to review and cleaner invoices (finance roles),
// then the supplier invoices and expenses, which are the repair and purchase invoices matched to approved work.
// properties is optional so LiveAccounts need not pass it; with it, rows show full addresses and the invoice form can narrow by property.
export function AccountsPayable({ p, account, role, management, overview, status, setStatus, expenses, limit, loading, load, setAsk, setOpenExpense, setCreating, properties = NO_PROPERTIES }: {
  p: Palette;
  account: WorkspaceAccount;
  role: WorkspaceAccount["role"];
  management: boolean;
  overview: Overview | null;
  status: Expense["status"];
  setStatus: (status: Expense["status"]) => void;
  expenses: Expense[];
  limit: LimitState | null;
  loading: boolean;
  load: () => Promise<void>;
  setAsk: (ask: NoteAsk) => void;
  setOpenExpense: (id: string) => void;
  setCreating: (creating: boolean) => void;
  properties?: readonly PropertyView[];
}) {
  const [tick, setTick] = useState(0);
  const finance = isFinanceRole(role);
  return (
    <>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {canStart(account, "new-expense") && <Button label="New expense" icon="plus" primary p={p} onPress={() => setCreating(true)} />}
        <RefreshButton p={p} loading={loading} onPress={() => { void load(); setTick(t => t + 1); }} />
      </View>
      {(overview?.overLimitCount ?? 0) > 0 && <Notice text={`${overview!.overLimitCount} expense${overview!.overLimitCount === 1 ? " is" : "s are"} above the approval limit and need${overview!.overLimitCount === 1 ? "s" : ""} management approval.`} p={p} />}
      {(overview?.draftCount ?? 0) > 0 && status !== "draft" && <MotionPress accessibilityRole="button" onPress={() => setStatus("draft")} style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
        <Feather name="tool" size={16} color={p.waiting} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{overview!.draftCount === 1 ? "A completed repair is waiting as a draft" : `${overview!.draftCount} completed repairs are waiting as drafts`}: add the supplier’s invoice and send for approval.</Text><Feather name="chevron-right" size={16} color={p.muted} />
      </MotionPress>}
      {finance && <CleansToReview p={p} properties={properties} tick={tick} />}
      {finance && <CleanerInvoices p={p} properties={properties} tick={tick} />}
      <Section title="Matched to work" p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Supplier invoices for repairs and purchases. An invoice is matched when it is linked to a finished job: open it to link one.</Text>
        <Pills p={p} values={["draft", "to_approve", "queried", "approved", "rejected"] as const} value={status} onChange={setStatus} label={v => v === "draft" ? "Drafts" : STATUS_LABEL[v][0]} />
        <List p={p} empty="Nothing in this view.">
          {expenses.map((e, i) => {
            const evidenceDone = e.hasInvoice && e.hasProof;
            // An invoice is matched once it is linked to a finished repair or purchase.
            const matched: [string, "good" | "wait"] = e.workId ? ["Matched to work", "good"] : ["Not matched to work", "wait"];
            const tags: [string, "good" | "wait" | "bad" | "plain"][] = [STATUS_LABEL[e.status], [evidenceDone ? "Evidence complete" : `${e.evidenceCount} document${e.evidenceCount === 1 ? "" : "s"}`, evidenceDone ? "good" : "wait"]];
            if (e.status !== "rejected") tags.push(matched);
            return <Row key={e.id} p={p} first={i === 0} title={e.supplier} detail={`${e.propertyName} · ${readableStage(e.category)} · ${new Date(e.receivedOn + "T12:00:00Z").toLocaleDateString("en-GB")}`} amount={pounds(e.amountMinor)} tags={tags} onPress={() => setOpenExpense(e.id)} />;
          })}
        </List>
      </Section>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Approval limit for Accounts</Text>
        <Text style={[ui.small, { color: p.muted }]}>{limit?.minor == null ? "No limit set. Accounts can approve any evidenced expense." : `Accounts approves up to ${pounds(limit.minor)}. Larger costs need management.`}</Text>
        {role === "super_admin" && limit && <Button label="Change the limit" p={p} onPress={() => setAsk({ title: "Approval limit", subtitle: "Accounts can approve evidenced costs up to this amount", min: 0, confirm: "Save limit", amount: { label: "Limit (leave 0 for no limit)", initial: limit.minor == null ? "0" : (limit.minor / 100).toFixed(2) }, build: (_note, minor) => ({ action: "setFinancePolicy", requestId: "", version: limit.version, expenseApprovalLimitMinor: minor ? minor : null }) })} />}
      </View>
      {/* The second spend limit: repairs above it also need an admin's approval, after the owner's. */}
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Management approval for repairs</Text>
        <Text style={[ui.small, { color: p.muted }]}>{limit?.repairMinor == null ? "Off. Repairs need only the owner’s approval, above their own limit." : `Repairs above ${pounds(limit.repairMinor)} also need an admin’s approval, after the owner’s.`}</Text>
        {management && limit && <Button label="Change the repair limit" p={p} onPress={() => setAsk({ title: "Management approval for repairs", subtitle: "Repairs costing more than this also need an admin’s approval", min: 0, confirm: "Save limit", amount: { label: "Limit (leave 0 to switch it off)", initial: limit.repairMinor == null ? "0" : (limit.repairMinor / 100).toFixed(2) }, build: (_note, minor) => ({ action: "setRepairApprovalLimit", requestId: "", version: limit.version, managementRepairLimitMinor: minor ? minor : null }) })} />}
      </View>
      <Notice text="Xero is not connected yet. Approved costs are queued and will post as bills, tracked to each property, once it is." p={p} />
    </>
  );
}
