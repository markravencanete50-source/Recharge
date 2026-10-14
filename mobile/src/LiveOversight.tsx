import { useCallback, useEffect, useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { Entrance, MotionPress } from "./motion";
import { departmentColor, textSize, ui, type Palette } from "./theme";
import { Button, CountList, Field, IconChip, Loading, Notice, Section, Tag, dayLabel, london, message, useRequestId, type IconName, type Tone } from "./LiveKit";
import { List } from "./LiveAccounts";
import { Pills } from "./Pills";
import { StateGraphic } from "./StateGraphic";
import { exportReport } from "./exportReport";
import { readOversight, readTeams, writeFinance, writeOversight, writeTeams, WorkspaceApiError } from "./backend/client";
import { DECISION_OUTCOMES, decisionAction, managementSchema, queueCount, type Decision, type Management, type RepairApproval } from "../../lib/management-live";
import { CostDecisionSheet, managementCostDecision, type CostDecision } from "./LiveApprovals";
import { AREA_LABEL, decisionsCsv, decisionsSchema, outcomeLabel, overviewSchema, waitedLabel, type DecisionRow, type Overview } from "../../lib/oversight-policy";
import { formatCount, formatMoney } from "../../lib/format";
import { sectionAnchor, type HomeToolTarget } from "../../lib/home-tools";
import type { Expense } from "../../lib/accounts-live";
import { hubSchema, type HubItem } from "../../lib/workspace-teams-policy";
import { parseApprovalFlags, type ApprovalFlag } from "../../lib/tracker-approvals";

// Management oversight in the live app: the business at a glance on admins' Home, the decisions
// waiting on management (decided in place), owners waiting on approvals, yesterday's missed Stays
// checks, unusual owner payouts, and the decisions report.
type Stalled = Management["stalledOwnerApprovals"][number];
type Unusual = Management["unusualPayouts"][number];
type Missed = Management["missedYesterday"][number];
export type Pending =
  | { kind: "decision"; decision: Decision; outcome: string | null }
  | { kind: "expense"; expense: Expense; approve: boolean }
  | { kind: "payout"; payout: Unusual; approve: boolean };
type Action = { label: string; icon?: IconName; primary?: boolean; disabled?: boolean; onPress: () => void };

const work = (view: "stays" | "clients" | "cleans" | "repairs" | "accounts" | "management", extra: { sub?: string; section?: string } = {}): HomeToolTarget =>
  ({ kind: "work", view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : {}) });
const QUEUE = work("management", { sub: "queue" });
const since = (iso: string) => waitedLabel(iso) + " ago";
const REASON: Record<Unusual["reason"], string> = { negative: "The owner owes money", low: "Much lower than usual", high: "Much higher than usual" };

// The management queue, read once and reloaded after every decision.
function useQueue() {
  const [queue, setQueue] = useState<Management | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setQueue(managementSchema.parse((await readTeams({ section: "management" })).data)); setError(""); }
    catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "The management queue could not be loaded."); }
  }, []);
  return { queue, error, load };
}

// One item with its buttons underneath, so it can be decided without opening anything.
function ActionRow({ p, first, icon, tone, title, detail, amount, tags, actions }: { p: Palette; first: boolean; icon: IconName; tone?: Tone; title: string; detail: string; amount?: string; tags?: [string, "good" | "wait" | "bad" | "plain"][]; actions: Action[] }) {
  return (
    <View style={{ gap: 10, paddingVertical: 14, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <View style={[ui.row, { gap: 14, alignItems: "flex-start" }]}>
        <IconChip icon={icon} tone={tone} p={p} />
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
          <Text numberOfLines={3} style={[ui.small, { color: p.muted }]}>{detail}</Text>
          {!!tags?.length && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{tags.map(([label, t]) => <Tag key={label} label={label} tone={t} p={p} />)}</View>}
        </View>
        {!!amount && <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{amount}</Text>}
      </View>
      {!!actions.length && <View style={[ui.row, { gap: 8, flexWrap: "wrap", paddingLeft: 54 }]}>
        {actions.map(a => (
          <MotionPress key={a.label} accessibilityRole="button" accessibilityLabel={`${a.label}: ${title}`} accessibilityState={{ disabled: !!a.disabled }} disabled={a.disabled} onPress={a.onPress}
            style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: a.disabled ? p.elevated : a.primary ? p.primary : p.wash }]}>
            {!!a.icon && <Feather name={a.icon} size={14} color={a.disabled ? p.muted : a.primary ? p.onPrimary : p.primary} />}
            <Text style={{ color: a.disabled ? p.muted : a.primary ? p.onPrimary : p.primary, fontSize: 13, fontWeight: "700" }}>{a.label}</Text>
          </MotionPress>
        ))}
      </View>}
    </View>
  );
}

// Record one decision: uphold or overturn a rejected clean, decide a cleaner review, approve or
// decline a cost above the limit, approve an unusual payout or void it for Accounts to redo.
export function DecideSheet({ p, pending, onClose, onDone }: { p: Palette; pending: Pending | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = !pending ? null : pending.kind === "decision" ? ["decide", pending.decision.workId, pending.decision.version, outcome, note.trim()].join(":")
    : pending.kind === "expense" ? ["expense", pending.expense.id, pending.expense.version, pending.approve, note.trim()].join(":")
    : ["payout", pending.payout.id, pending.payout.version, pending.approve, note.trim()].join(":");
  const request = useRequestId(key);
  useEffect(() => { queueMicrotask(() => { setOutcome(pending?.kind === "decision" ? pending.outcome ?? "" : ""); setNote(""); setError(""); }); }, [pending]);
  if (!pending) return <Sheet palette={p} visible={false} onClose={onClose} title="">{null}</Sheet>;
  const approving = pending.kind !== "decision" && pending.approve;
  const minimum = approving ? 0 : 5;
  async function save() {
    if (!pending || busy) return;
    if (pending.kind === "decision" && !outcome) { setError("Choose an outcome."); return; }
    if (note.trim().length < minimum) { setError("Explain the decision (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      const requestId = request.get(), text = note.trim();
      if (pending.kind === "decision") {
        const base = { requestId, workId: pending.decision.workId, version: pending.decision.version, note: text };
        await writeTeams(decisionAction(pending.decision) === "decideComplaint"
          ? { ...base, action: "decideComplaint", outcome: outcome as "upheld" | "overturned" }
          : { ...base, action: "decideCleanerReview", outcome: outcome as "no_action" | "supervised" | "removed_from_rota" });
      } else if (pending.kind === "expense") {
        const { id: expenseId, version } = pending.expense;
        if (pending.approve) await writeFinance({ action: "approveExpense", requestId, expenseId, version, ...(text ? { note: text } : {}) });
        else await writeFinance({ action: "rejectExpense", requestId, expenseId, version, note: text });
      } else {
        const { id: statementId, version } = pending.payout;
        if (pending.approve) await writeOversight({ action: "approvePayout", requestId, statementId, version, note: text });
        else await writeFinance({ action: "voidStatement", requestId, statementId, version, reason: text });
      }
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const title = pending.kind === "decision" ? (pending.decision.kind === "cleaning_complaint" ? "Rejected clean" : "Cleaner review")
    : pending.kind === "expense" ? (pending.approve ? "Approve this cost" : "Decline this cost") : (pending.approve ? "Approve this payout" : "Hold this payout");
  const subtitle = pending.kind === "decision" ? `${pending.decision.cleanerName ?? "Cleaner"} · ${pending.decision.propertyName}`
    : pending.kind === "expense" ? `${pending.expense.supplier} · ${formatMoney(pending.expense.amountMinor)}` : `${pending.payout.propertyName} · ${pending.payout.period}`;
  return (
    <Sheet palette={p} visible onClose={onClose} title={title} subtitle={subtitle} icon={pending.kind === "decision" ? "spray" : "coins"}>
      {pending.kind === "decision" && <>
        <Text style={[ui.body, { color: p.text }]}>{pending.decision.kind === "cleaning_complaint" ? "A clean was rejected after a guest complaint. Read the cleaner's side, then decide whether the rejection stands." : "This cleaner has had repeated rejected cleans. Decide what happens next."}</Text>
        <Notice text={pending.decision.cleanerStatement ? `Cleaner's response: ${pending.decision.cleanerStatement}` : "The cleaner has not responded yet."} p={p} />
        <View style={{ gap: 8 }}>{DECISION_OUTCOMES[pending.decision.kind].map(([value, label]) => <Button key={value} label={label} primary={outcome === value} p={p} onPress={() => setOutcome(value)} />)}</View>
      </>}
      {pending.kind === "expense" && <Text style={[ui.body, { color: p.text }]}>{pending.approve
        ? `${pending.expense.propertyName} · ${pending.expense.reference}. Approving sends it to Xero for payment.`
        : "Declining rejects the cost. Say why, so Accounts can tell the supplier."}</Text>}
      {pending.kind === "payout" && <Text style={[ui.body, { color: p.text }]}>{pending.approve
        ? `${formatMoney(pending.payout.payoutMinor)} against an average of ${pending.payout.averageMinor != null ? formatMoney(pending.payout.averageMinor) : "nothing yet"}. Approving records that you have checked it; Accounts carries on as usual.`
        : "Holding it voids this statement so Accounts can correct it and prepare it again. Say what needs checking."}</Text>}
      <Field label={minimum ? "Decision note" : "Note (optional)"} value={note} onChange={setNote} p={p} multiline placeholder={minimum ? "What you checked and why" : "Anything worth recording"} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : approving ? "Approve" : pending.kind === "decision" ? "Record decision" : pending.kind === "payout" ? "Void the statement" : "Decline"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Decisions waiting on management, each with its buttons: rejected cleans, cleaner reviews, costs
// above the approval limit, repairs above the management limit and unusual owner payouts.
type RowSpec = { key: string; icon: IconName; tone: Tone; title: string; detail: string; amount?: string; tags: [string, "good" | "wait" | "bad" | "plain"][]; actions: Action[] };
function decisionRows(p: Palette, queue: Management, decide: (x: Pending) => void, limit = Infinity, repair?: (r: RepairApproval, start: "approve" | "decline") => void) {
  const specs: RowSpec[] = [
    ...queue.cleaningDecisions.map((d): RowSpec => ({ key: d.workId, icon: "check-square", tone: "cleans",
      title: d.kind === "cleaning_complaint" ? `Contested clean · ${d.cleanerName ?? "Cleaner"}` : `Second quality warning · ${d.cleanerName ?? "Cleaner"}`,
      detail: `${d.propertyName} · raised ${since(d.createdAt)}`, tags: [d.cleanerStatement ? ["Cleaner has responded", "plain"] : ["Awaiting cleaner", "wait"]],
      actions: d.kind === "cleaning_complaint"
        ? [{ label: "Uphold", icon: "check", primary: true, onPress: () => decide({ kind: "decision", decision: d, outcome: "upheld" }) }, { label: "Overturn", icon: "rotate-ccw", onPress: () => decide({ kind: "decision", decision: d, outcome: "overturned" }) }]
        : [{ label: "Decide", icon: "arrow-right", primary: true, onPress: () => decide({ kind: "decision", decision: d, outcome: null }) }] })),
    ...queue.expensesOverLimit.map((e): RowSpec => {
      const evidence = e.hasInvoice && e.hasProof;
      return { key: e.id, icon: "alert-triangle", tone: "accounts", title: `Quote over the limit · ${e.supplier}`, detail: `${e.propertyName} · ${e.reference}`, amount: formatMoney(e.amountMinor),
        tags: [evidence ? ["Evidence complete", "good"] : ["Invoice or proof missing", "wait"]],
        actions: [{ label: "Approve", icon: "check", primary: true, disabled: !evidence, onPress: () => decide({ kind: "expense", expense: e, approve: true }) }, { label: "Decline", icon: "x", onPress: () => decide({ kind: "expense", expense: e, approve: false }) }] };
    }),
    ...(repair ? queue.repairApprovals : []).map((r): RowSpec => ({ key: r.workId, icon: "tool", tone: "ready", title: `Repair over the limit · ${r.propertyName}`,
      detail: `${r.issue ?? r.title} · waiting ${waitedLabel(r.waitingSince)}`, amount: r.estimatedCostMinor != null ? formatMoney(r.estimatedCostMinor) : undefined,
      tags: [r.ownerApprovedAt ? ["Owner approved", "good"] : ["Within the owner’s limit", "plain"], ...(r.urgent ? [["Urgent", "bad"] as [string, "bad"]] : [])],
      actions: [{ label: "Approve", icon: "check", primary: true, onPress: () => repair?.(r, "approve") }, { label: "Decline", icon: "x", onPress: () => repair?.(r, "decline") }] })),
    ...queue.unusualPayouts.map((s): RowSpec => ({ key: s.id, icon: "pie-chart", tone: "accounts", title: `Unusual owner payout · ${s.propertyName}`,
      detail: `${s.period} statement, ${s.status === "draft" ? "not issued yet" : "issued"}${s.averageMinor != null && s.previousStatements ? ` · usually ${formatMoney(s.averageMinor)}` : ""}`, amount: formatMoney(s.payoutMinor),
      tags: [[REASON[s.reason], s.reason === "negative" ? "bad" : "wait"]],
      actions: [{ label: "Approve", icon: "check", primary: true, onPress: () => decide({ kind: "payout", payout: s, approve: true }) }, { label: "Hold", icon: "pause", onPress: () => decide({ kind: "payout", payout: s, approve: false }) }] })),
  ];
  return specs.slice(0, limit).map(({ key, ...spec }, i) => <ActionRow key={key} p={p} first={i === 0} {...spec} />);
}

// Owners who haven't answered for over 48 hours: how long, whether they've been reminded, and a
// button to remind them now (once a day).
function stalledRows(p: Palette, items: Stalled[], remind: (s: Stalled) => void, busy: string | null, limit = Infinity) {
  return items.slice(0, limit).map((a, i) => {
    const ready = !a.canRemindAt || Date.parse(a.canRemindAt) <= Date.now();
    return <ActionRow key={a.workId} p={p} first={i === 0} icon="clock" tone="clients" title={a.kind === "estimate" ? `Estimate · ${a.propertyName}` : a.title}
      detail={`${a.kind === "estimate" ? "Waiting for the owner's decision" : a.propertyName} · waiting ${waitedLabel(a.waitingSince)}`} amount={a.estimatedCostMinor != null ? formatMoney(a.estimatedCostMinor) : undefined}
      tags={[a.remindedAt ? [`Owner reminded ${since(a.remindedAt)}`, "plain"] : ["Not reminded yet", "wait"], ...(a.escalatedAt ? [["Client relations told", "bad"] as [string, "bad"]] : [])]}
      actions={[{ label: busy === a.workId ? "Reminding…" : ready ? "Remind the owner now" : "Reminded in the last day", icon: "bell", primary: ready, disabled: !ready || busy === a.workId, onPress: () => remind(a) }]} />;
  });
}

// Yesterday's Stays checks that weren't finished, until someone in management has seen them.
function missedRows(p: Palette, items: Missed[], seen: (m: Missed) => void, busy: string | null, limit = Infinity) {
  return items.slice(0, limit).map((m, i) => {
    const parts = [!m.signedOff ? "Didn't sign off" : "", m.missedListings.length ? `${m.missedListings.length} of ${m.listingsDue} listing check${m.listingsDue === 1 ? "" : "s"} missed: ${m.missedListings.map(x => x.propertyName).join(", ")}` : ""].filter(Boolean);
    return <ActionRow key={m.userId + m.day} p={p} first={i === 0} icon="sunset" tone="stays" title={`Missed yesterday · ${m.fullName}`} detail={`${dayLabel(m.day)} · ${parts.join(" · ")}`}
      actions={[{ label: busy === m.userId + m.day ? "Saving…" : "Mark as seen", icon: "eye", disabled: busy === m.userId + m.day, onPress: () => seen(m) }]} />;
  });
}

// The reminders and "seen" marks, shared by Home and the Management approvals list.
export function useQueueActions(load: () => Promise<void>) {
  const saved = useSaved();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const run = async (id: string, write: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id); setError("");
    try { await write(); await saved(load)(); } catch (e) { setError(message(e)); } finally { setBusy(null); }
  };
  return {
    busy, error,
    remind: (a: Stalled) => void run(a.workId, () => writeOversight({ action: "remindOwner", requestId: Crypto.randomUUID(), workId: a.workId })),
    seen: (m: Missed) => void run(m.userId + m.day, () => writeOversight({ action: "markMissedSeen", requestId: Crypto.randomUUID(), userId: m.userId, day: m.day })),
  };
}

// One department's numbers: each line opens the place the work happens.
type Metric = { label: string; value: number | string; attention?: boolean; target: HomeToolTarget };
function DepartmentCard({ p, tone, icon, title, metrics, onOpen, target }: { p: Palette; tone: Tone; icon: IconName; title: string; metrics: Metric[]; onOpen: (t: HomeToolTarget) => void; target: HomeToolTarget }) {
  const colour = departmentColor(tone, p);
  return (
    // Each department card carries its colour: a thread along the top.
    <View {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 6, paddingVertical: 18, flex: 1, overflow: "hidden" }]}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, backgroundColor: colour.ink, opacity: 0.75 }} />
      <MotionPress accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={() => onOpen(target)} style={[ui.between, { gap: 10, minHeight: 48, marginBottom: 4 }]}>
        <View style={[ui.row, { gap: 12, flex: 1, minWidth: 0 }]}>
          <IconChip icon={icon} tone={tone} p={p} size={40} />
          <Text numberOfLines={1} style={{ color: p.text, fontSize: textSize.heading, fontWeight: "600", letterSpacing: -0.2, flexShrink: 1 }}>{title}</Text>
        </View>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: p.background }}><Feather name="arrow-up-right" size={15} color={colour.ink} /></View>
      </MotionPress>
      {/* Lines counting nothing are left out; all nothing reads "Nothing waiting" (LiveKit CountList). */}
      <CountList p={p} ink={colour} rows={metrics.map(m => ({ label: m.label, value: m.value, attention: m.attention, onPress: () => onOpen(m.target) }))} />
    </View>
  );
}

function departments(o: Overview): { tone: Tone; icon: IconName; title: string; target: HomeToolTarget; metrics: Metric[] }[] {
  // Listing checks and pricing now live under Client relations → Listings.
  const listings: HomeToolTarget = { kind: "work", view: "clients", sub: "listings" };
  return [
    { tone: "stays", icon: "calendar", title: "Stays", target: work("stays"), metrics: [
      { label: "Listings to check today", value: o.stays.listingsToCheck, attention: o.stays.listingsToCheck > 0, target: listings },
      { label: "Empty nights to price this week", value: o.stays.emptyNights, attention: o.stays.emptyNights > 0, target: listings },
      { label: "Re-listings open", value: o.stays.relistingsOpen, attention: o.stays.relistingsOpen > 0, target: { kind: "work", view: "clients", sub: "relisting" } },
      ...(o.stays.guestsWaiting != null ? [{ label: "Guests waiting for a reply", value: o.stays.guestsWaiting, attention: o.stays.guestsWaiting > 0, target: work("stays", { sub: "inbox" }) }] : []),
    ] },
    { tone: "cleans", icon: "check-square", title: "Cleans", target: work("cleans"), metrics: [
      { label: "Cleans done today", value: `${formatCount(o.cleans.doneToday)}/${formatCount(o.cleans.today)}`, target: work("cleans", { section: "Schedule" }) },
      { label: "Waiting for review", value: o.cleans.toReview, attention: o.cleans.toReview > 0, target: work("cleans", { section: "Waiting for your review" }) },
      { label: "Not assigned today", value: o.cleans.unassignedToday, attention: o.cleans.unassignedToday > 0, target: work("cleans", { section: "Not yet assigned" }) },
      { label: "Disputed cleans", value: o.cleans.disputes, attention: o.cleans.disputes > 0, target: QUEUE },
    ] },
    { tone: "ready", icon: "tool", title: "Ready", target: work("repairs"), metrics: [
      { label: "Repairs waiting for the owner", value: o.ready.ownerApproval, attention: o.ready.ownerApproval > 0, target: work("repairs", { section: "Reactive maintenance" }) },
      { label: "Repairs to refer to Ready", value: o.ready.toRefer, attention: o.ready.toRefer > 0, target: work("repairs", { section: "Reactive maintenance" }) },
      { label: "Repairs with Ready (to book or booked)", value: o.ready.referred + o.ready.booked, target: work("repairs", { section: "Reactive maintenance" }) },
      { label: "Preventative maintenance due this month", value: o.ready.visitsDue, target: work("repairs", { section: "Preventative maintenance" }) },
    ] },
    { tone: "accounts", icon: "file-text", title: "Accounts", target: work("accounts"), metrics: [
      { label: o.accounts.overLimit ? `Expenses to approve (${formatCount(o.accounts.overLimit)} over the limit)` : "Expenses to approve", value: o.accounts.expensesToApprove, attention: o.accounts.expensesToApprove > 0, target: work("accounts", { sub: "expenses" }) },
      { label: "Payouts to reconcile this month", value: o.accounts.payoutsToReconcile, attention: o.accounts.payoutsToReconcile > 0, target: work("accounts", { sub: "payouts" }) },
      { label: "Statements to issue", value: o.accounts.statementsToIssue, attention: o.accounts.statementsToIssue > 0, target: work("accounts", { sub: "statements" }) },
    ] },
  ];
}

// Admins' Home: across the business, and what needs a management decision, decided in place.
export function AdminHome({ palette: p, desktop, onTool }: { palette: Palette; desktop: boolean; onTool: (target: HomeToolTarget) => void }) {
  const { width } = useWindowDimensions();
  const saved = useSaved();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const { queue, error, load: loadQueue } = useQueue();
  const [pending, setPending] = useState<Pending | null>(null);
  const [repair, setRepair] = useState<{ decision: CostDecision; start: "approve" | "decline" } | null>(null);
  // Flags and approval tickets also wait on management; they are decided in Management → Waiting on you.
  const [flags, setFlags] = useState<ApprovalFlag[]>([]);
  const [tickets, setTickets] = useState<HubItem[]>([]);
  const load = useCallback(async () => {
    const [o, f, h] = await Promise.allSettled([readOversight({ section: "overview" }).then(r => overviewSchema.parse(r.data)), readTeams({ section: "flags" }), readTeams({ section: "hub" }), loadQueue()]);
    if (o.status === "fulfilled") { setOverview(o.value); setOverviewError(""); } else setOverviewError(message(o.reason));
    if (f.status === "fulfilled") setFlags(parseApprovalFlags(f.value.data).flags.filter(x => x.status === "open"));
    if (h.status === "fulfilled") { const parsed = hubSchema.safeParse(h.value.data); setTickets(parsed.success ? parsed.data.items.filter(i => i.kind === "approval" && i.status === "pending") : []); }
  }, [loadQueue]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const actions = useQueueActions(load);
  const columns = desktop ? 4 : width >= 600 ? 2 : 1;
  const decisions = queue ? queue.cleaningDecisions.length + queue.expensesOverLimit.length + queue.repairApprovals.length + queue.unusualPayouts.length : 0;
  // The same total as Management → Waiting on you, so "See all" matches what is there.
  const waiting = (queue ? queueCount(queue) + queue.cleanerWarnings.filter(w => w.warning).length : 0) + flags.length + tickets.length;
  const flagRows = [
    ...flags.map(f => ({ key: "flag:" + f.id, at: f.createdAt, title: f.title, detail: `${f.source === "request" ? "Request" : "Flagged"}${f.raisedByName ? " by " + f.raisedByName : ""} · ${f.propertyName ?? "no property"} · ${since(f.createdAt)}`, amount: f.amountMinor, badge: f.source === "request" ? "Request" : "Flag" })),
    ...tickets.map(t => ({ key: "ticket:" + t.id, at: t.createdAt, title: t.title, detail: `Approval ticket${t.createdByName ? " from " + t.createdByName : ""} · ${t.propertyName ?? "no property"} · ${since(t.createdAt)}`, amount: t.amountMinor, badge: "Approval" })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 3);
  const cards = overview ? departments(overview) : [];
  return (
    <>
      <Entrance sessionKey={"live:home:business"} style={{ gap: 10 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Across the business</Text>
          <MotionPress accessibilityRole="button" accessibilityLabel="Refresh the business overview" onPress={() => void load()} style={[ui.row, { gap: 6, minHeight: 44, paddingLeft: 12 }]}>
            <Feather name="refresh-cw" size={13} color={p.muted} />
            <Text style={[ui.small, { color: p.muted }]}>{dayLabel(overview?.today ?? london(new Date()))}</Text>
          </MotionPress>
        </View>
        {!!overviewError && <Notice text={overviewError} p={p} tone="bad" />}
        {!overview && !overviewError && <Loading p={p} rows={2} />}
        {!!cards.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {cards.map(c => (
            <View key={c.title} style={{ flexBasis: columns === 1 ? "100%" : columns === 2 ? "47%" : "22%", flexGrow: 1, minWidth: 0 }}>
              <DepartmentCard p={p} tone={c.tone} icon={c.icon} title={c.title} metrics={c.metrics} target={c.target} onOpen={onTool} />
            </View>
          ))}
        </View>}
      </Entrance>
      <Entrance sessionKey={"live:home:decisions"} delay={55} style={{ gap: 10 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flexShrink: 1 }]}>Needs a management decision</Text>
          <MotionPress accessibilityRole="button" accessibilityLabel="Open everything waiting on management" onPress={() => onTool(QUEUE)} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}>
            <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View all</Text>
          </MotionPress>
        </View>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {!!actions.error && <Notice text={actions.error} p={p} tone="bad" />}
        {!queue && !error && <Loading p={p} rows={2} />}
        {queue && !waiting && (
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 22 }]}>
            <StateGraphic palette={p} success icon="check-circle" />
            <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>Nothing needs a decision</Text>
            <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>Flags and requests from the team, contested cleans, quotes and repairs over the limit, warnings and unusual payouts appear here.</Text>
          </View>
        )}
        {queue && !!decisions && <List p={p} empty="">{decisionRows(p, queue, setPending, 6, (r, start) => setRepair({ decision: managementCostDecision(r), start }))}</List>}
        {!!flagRows.length && <List p={p} empty="">{flagRows.map((r, i) => (
          <ActionRow key={r.key} p={p} first={i === 0} icon="flag" tone="stays" title={r.title} detail={r.detail} amount={r.amount != null ? formatMoney(r.amount) : undefined} tags={[[r.badge, "wait"]]}
            actions={[{ label: "Decide", icon: "arrow-right", primary: true, onPress: () => onTool(QUEUE) }]} />
        ))}</List>}
        {queue && !!queue.stalledOwnerApprovals.length && <List p={p} empty="">{stalledRows(p, queue.stalledOwnerApprovals, actions.remind, actions.busy, 3)}</List>}
        {queue && !!queue.missedYesterday.length && <List p={p} empty="">{missedRows(p, queue.missedYesterday, actions.seen, actions.busy, 3)}</List>}
        {queue && waiting > Math.min(decisions, 6) + Math.min(queue.stalledOwnerApprovals.length, 3) + Math.min(queue.missedYesterday.length, 3) + flagRows.length && (
          <Button label={`See all ${formatCount(waiting)} in Management`} icon="arrow-right" p={p} onPress={() => onTool(QUEUE)} />
        )}
      </Entrance>
      <DecideSheet p={p} pending={pending} onClose={() => setPending(null)} onDone={saved(load)} />
      <CostDecisionSheet p={p} decision={repair?.decision ?? null} start={repair?.start} onClose={() => setRepair(null)} onDone={saved(load)} />
    </>
  );
}

// Management → Decisions: every approval and decision in the last 90 days, with a spreadsheet.
const AREAS = ["all", "repairs", "work", "accounts", "cleans"] as const;
export function DecisionsReport({ palette: p }: { palette: Palette }) {
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState<(typeof AREAS)[number]>("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setRows(decisionsSchema.parse((await readOversight({ section: "decisions" })).data)); setError(""); }
    catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "The decisions could not be loaded."); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const shown = (rows ?? []).filter(r => area === "all" || r.area === area);
  async function download() {
    if (!rows || busy) return;
    setBusy(true); setNote("");
    try {
      await exportReport(decisionsCsv(shown), `Recharge-decisions-${london(new Date())}.csv`);
      setNote(Platform.OS === "web" ? "Download started." : "Ready to save or share.");
    } catch (e) { setNote(message(e)); } finally { setBusy(false); }
  }
  return (
    <Section title="Decisions" count={rows ? shown.length : undefined} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Approvals and decisions from the last 90 days: who decided, when and why.</Text>
      <Pills p={p} values={AREAS} value={area} onChange={setArea} label={v => v === "all" ? "All" : AREA_LABEL[v]} />
      {!rows && !error && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {rows && <List p={p} empty="No decisions in the last 90 days.">
        {shown.slice(0, 200).map((r, i) => (
          <View key={r.at + r.decision + i} style={{ gap: 4, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
            <View style={[ui.between, { gap: 10, alignItems: "flex-start" }]}>
              <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{r.decision}{r.outcome && r.outcome !== "approved" ? ` · ${outcomeLabel(r.outcome)}` : ""}</Text>
              {r.amountMinor != null && <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(r.amountMinor)}</Text>}
            </View>
            <Text style={[ui.small, { color: p.muted }]}>{[r.propertyName, r.title].join(" · ")}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{r.by ?? "Unknown"} · {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</Text>
            {!!r.note && <Text selectable style={[ui.small, { color: p.text }]}>{r.note}</Text>}
          </View>
        ))}
      </List>}
      {shown.length > 200 && <Text style={[ui.small, { color: p.muted }]}>Showing the latest 200. The spreadsheet has all {shown.length}.</Text>}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label={busy ? "Preparing…" : "Download spreadsheet (CSV)"} icon="download" p={p} disabled={!rows || busy} onPress={() => void download()} />
        <Button label="Refresh" icon="refresh-cw" p={p} onPress={() => void load()} />
      </View>
      {!!note && <Text style={[ui.small, { color: p.text }]}>{note}</Text>}
    </Section>
  );
}
