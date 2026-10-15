import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, Notice, RefreshButton, message, useRequestId } from "./LiveKit";
import { ExpenseSheet, NoteSheet, type NoteAsk } from "./LiveAccounts";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { DisputeSheet } from "./CleanDisputes";
import { CostDecisionSheet, managementCostDecision, type CostDecision } from "./LiveApprovals";
import { ContractorReviews } from "./RepairContractors";
import { HubItemSheet } from "./HubItemSheet";
import { DecideSheet, useQueueActions, type Pending } from "./LiveOversight";
import { readFinance, readTeams, writeTeams, WorkspaceApiError } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { SectionProps } from "./SectionProps";
import { managementSchema, type Management } from "../../lib/management-live";
import { canFlag } from "../../lib/management-flags";
import { policySchema } from "../../lib/accounts-live";
import { repairLimit, repairLimitSummary } from "../../lib/repair-approvals";
import { hubSchema, type Hub, type HubItem } from "../../lib/workspace-teams-policy";
import type { PropertyView } from "../../lib/workspace-view";
import type { TrackerItem } from "../../lib/tracker";
import {
  approvalItems, canWithdraw, decideFlagAction, openApprovalCount, parseApprovalFlags, requestAction, withdrawFlagAction,
  type ApprovalFlag, type ApprovalSource,
} from "../../lib/tracker-approvals";

// The one Management approvals list. Everything that needs a management decision arrives here: the
// flags staff raise from any section, free-standing requests ("Ask management"), approval tickets from
// the hub, and the management queue (repair quotes, clean decisions, costs over the limit, owner
// approvals, unusual payouts, owner balances, cleaner warnings, missed checks). Tapping a row opens
// the sheet that decides it. Admins see everything; other staff see only what they raised, waiting for
// management. Owners never reach this screen. Mounted by Management (admins) and by the Decisions page.
type Props = Pick<SectionProps, "palette" | "account"> & Partial<Pick<SectionProps, "properties" | "onOpenWork" | "work">>;
const NO_PROPERTIES: PropertyView[] = [];
type Item = TrackerItem<ApprovalSource>;

// Resolve or decline a flag (management), or withdraw one you raised. Declining needs a reason.
function FlagControls({ p, flag, canDecide, userId, onClose, onDone, onOpenItem }: { p: Palette; flag: ApprovalFlag; canDecide: boolean; userId: string; onClose: () => void; onDone: () => Promise<void>; onOpenItem?: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = note.trim();
  const resolveRequest = useRequestId(["resolve", flag.id, flag.version, trimmed].join(":"));
  const declineRequest = useRequestId(["decline", flag.id, flag.version, trimmed].join(":"));
  const withdrawRequest = useRequestId(["withdraw", flag.id, flag.version].join(":"));
  if (flag.status !== "open") return onOpenItem ? <Button label="Open the item" icon="arrow-right" p={p} onPress={onOpenItem} /> : null;
  async function run(write: () => Promise<unknown>, done: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { await write(); done(); onClose(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function decide(decision: "resolved" | "declined") {
    const request = decision === "resolved" ? resolveRequest : declineRequest;
    const built = decideFlagAction(flag, decision, note, request.get());
    if ("error" in built) { setError(built.error); return; }
    void run(() => writeTeams(built.action), request.done);
  }
  return (
    <View style={{ gap: 12 }}>
      {!!onOpenItem && <Button label="Open the item" icon="arrow-right" p={p} onPress={onOpenItem} />}
      {canDecide ? <>
        <Field label="Note (needed to decline)" value={note} onChange={setNote} p={p} multiline placeholder="What you decided and why" />
        <Button label={busy ? "Saving…" : "Resolve"} icon="check" primary p={p} disabled={busy} onPress={() => decide("resolved")} />
        <Button label="Decline" icon="x" p={p} disabled={busy} onPress={() => decide("declined")} />
      </> : <Notice text="Waiting for management. You will be told when it is decided." p={p} />}
      {canWithdraw(flag, userId) && <Button label={busy ? "Saving…" : "Withdraw"} icon="corner-up-left" p={p} disabled={busy} onPress={() => void run(() => writeTeams(withdrawFlagAction(flag, withdrawRequest.get())), withdrawRequest.done)} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

// The decision sheet for a flag or request: the shared tracker detail (steps, reason, amount, how long
// it has waited) with Resolve and Decline underneath for management, Withdraw for whoever raised it.
export function FlagDecisionSheet({ p, item, canDecide, userId, onClose, onDone, onOpenItem }: { p: Palette; item: Item | null; canDecide: boolean; userId: string; onClose: () => void; onDone: () => Promise<void>; onOpenItem?: (flag: ApprovalFlag) => (() => void) | undefined }) {
  const flag = item?.source.kind === "flag" ? item.source.flag : null;
  return (
    <TrackerDetailSheet p={p} item={item} onClose={onClose}>
      {flag && <FlagControls key={flag.id + ":" + flag.version} p={p} flag={flag} canDecide={canDecide} userId={userId} onClose={onClose} onDone={onDone} onOpenItem={onOpenItem?.(flag)} />}
    </TrackerDetailSheet>
  );
}

// "Ask management": a free-standing request. A short title, why (a few words at least) and, if it
// matters, how much. It lands in the same list as a flag, marked as a request.
function AskManagementSheet({ p, visible, onClose, onDone }: { p: Palette; visible: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? JSON.stringify([title.trim(), reason.trim(), amount.trim()]) : null);
  async function send() {
    if (busy) return;
    const built = requestAction(title, reason, amount, request.get());
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try { await writeTeams(built.action); request.done(); setTitle(""); setReason(""); setAmount(""); onClose(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={() => { if (!busy) { setError(""); onClose(); } }} title="Ask management" subtitle="Something management needs to decide or know about" icon="clipboard">
      <Field label="What is it about?" value={title} onChange={setTitle} p={p} placeholder="For example: a deposit for the new cleaner" />
      <Field label="Why does management need to look at this?" value={reason} onChange={setReason} p={p} multiline placeholder="A few words are enough" />
      <Field label="Amount, if there is one (optional)" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Sending…" : "Send to management"} primary p={p} disabled={busy} onPress={() => void send()} />
    </Sheet>
  );
}

export function ManagementApprovals({ palette: p, account, properties = NO_PROPERTIES, onOpenWork, work }: Props) {
  const saved = useSaved();
  const admin = account.role === "admin" || account.role === "super_admin";
  const owner = account.role === "client";
  const [flags, setFlags] = useState<ApprovalFlag[]>([]);
  const [hub, setHub] = useState<Hub | null>(null);
  const [queue, setQueue] = useState<Management | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [repairPolicy, setRepairPolicy] = useState<{ limit: number | null; version: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [asking, setAsking] = useState(false);
  const [hubTarget, setHubTarget] = useState<{ kind: HubItem["kind"]; item?: HubItem } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dispute, setDispute] = useState<Management["cleaningDecisions"][number] | null>(null);
  const [expense, setExpense] = useState<string | null>(null);
  const [repair, setRepair] = useState<CostDecision | null>(null);
  const [ask, setAsk] = useState<NoteAsk | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, h, q, pol] = await Promise.allSettled([
      readTeams({ section: "flags" }), readTeams({ section: "hub" }),
      admin ? readTeams({ section: "management" }) : Promise.resolve(null), admin ? readFinance({ section: "policy" }) : Promise.resolve(null),
    ]);
    const problems: string[] = [];
    if (f.status === "fulfilled") setFlags(parseApprovalFlags(f.value.data).flags); else problems.push(f.reason instanceof WorkspaceApiError ? f.reason.message : "The flags could not be loaded.");
    if (h.status === "fulfilled") { const parsed = hubSchema.safeParse(h.value.data); setHub(parsed.success ? parsed.data : null); } else setHub(null);
    if (q.status === "fulfilled" && q.value) {
      const parsed = managementSchema.safeParse(q.value.data);
      if (parsed.success) setQueue(parsed.data); else problems.push("The management queue could not be read.");
    } else if (q.status === "rejected") problems.push(q.reason instanceof WorkspaceApiError ? q.reason.message : "The management queue could not be loaded.");
    if (pol.status === "fulfilled" && pol.value) {
      const parsed = policySchema.safeParse(pol.value.data);
      if (parsed.success) { setLimit(parsed.data.expenseApprovalLimitMinor); setRepairPolicy({ limit: parsed.data.managementRepairLimitMinor, version: parsed.data.version }); }
    }
    setError(problems[0] ?? ""); setNow(new Date()); setLoading(false);
  }, [admin]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const actions = useQueueActions(load);

  const items = useMemo(
    () => approvalItems({ flags, hub: hub?.items, queue }, { now, owner, canDecide: admin, userId: account.userId, property: id => properties.find(x => x.id === id) }),
    [flags, hub, queue, now, owner, admin, account.userId, properties]);
  const waiting = openApprovalCount(items);

  const changeRepairLimit = () => repairPolicy && setAsk({ title: "Repair approval limit", subtitle: "Repairs under this amount are approved automatically. At or over it, management approve first, then the owner.", min: 0, confirm: "Save limit",
    amount: { label: "Limit", initial: (repairLimit(repairPolicy.limit) / 100).toFixed(2) },
    build: (_note, minor) => ({ action: "setRepairApprovalLimit", requestId: "", version: repairPolicy.version, managementRepairLimitMinor: minor ?? null }) });

  // Tapping a row opens the sheet that decides it: the existing sheet for the existing kinds.
  function open(row: TrackerItem) {
    const source = (row as Item).source;
    switch (source.kind) {
      case "hub": setHubTarget({ kind: "approval", item: source.item }); return;
      case "decision": if (source.decision.kind === "cleaning_complaint") setDispute(source.decision); else setPending({ kind: "decision", decision: source.decision, outcome: null }); return;
      case "expense": setExpense(source.expense.id); return;
      case "repair": setRepair(managementCostDecision(source.repair)); return;
      default: setDetail(row as Item);
    }
  }
  const source = detail?.source;
  const closeDetail = () => setDetail(null);
  // A flag on a work item can jump to that item when the screen holds the work list.
  const openFlagItem = (flag: ApprovalFlag) => {
    const found = flag.workId && onOpenWork ? work?.find(x => x.workId === flag.workId) : undefined;
    return found && onOpenWork ? () => { closeDetail(); onOpenWork(found); } : undefined;
  };
  const stalledReady = source?.kind === "stalled" && (!source.stalled.canRemindAt || Date.parse(source.stalled.canRemindAt) <= now.getTime());

  return (
    <View style={{ gap: 16 }}>
      <View style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{admin ? "Management approvals" : "Your requests to management"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>
            {admin ? (waiting ? `${waiting} waiting for a decision. Flags from every section, requests and approvals in one list.` : "Flags from every section, requests and approvals arrive here.")
              : "Anything you flag or ask appears here until management decides it."}
          </Text>
        </View>
        {canFlag(account.role) && (
          <MotionPress accessibilityRole="button" accessibilityLabel="Ask management" onPress={() => setAsking(true)}
            style={[ui.row, { alignSelf: "flex-start", gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: p.wash }]}>
            <Feather name="plus" size={15} color={p.primary} />
            <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>Ask management</Text>
          </MotionPress>
        )}
      </View>
      {!!actions.error && <Notice text={actions.error} p={p} tone="bad" />}
      {/* Contractor estimates waiting for management's Review done (Repairs with contractors). */}
      {admin && <ContractorReviews p={p} role={account.role} properties={properties} refreshKey={now.getTime()} />}
      <TrackerList p={p} items={items} empty={admin ? "Nothing is waiting for a decision." : "You have not flagged or asked anything yet."} loading={loading} error={error} owner={owner} onOpen={open} />
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <RefreshButton p={p} loading={loading} onPress={() => void load()} />
        {admin && repairPolicy && <Button label="Change the repair limit" icon="sliders" p={p} onPress={changeRepairLimit} />}
      </View>
      {admin && repairPolicy && <Text style={[ui.small, { color: p.muted }]}>{repairLimitSummary(repairPolicy.limit)}</Text>}

      <AskManagementSheet p={p} visible={asking} onClose={() => setAsking(false)} onDone={saved(load)} />
      <FlagDecisionSheet p={p} item={source?.kind === "flag" ? detail : null} canDecide={admin} userId={account.userId} onClose={closeDetail} onDone={saved(load)} onOpenItem={openFlagItem} />
      <TrackerDetailSheet p={p} item={source && source.kind !== "flag" ? detail : null} onClose={closeDetail}>
        {source?.kind === "payout" && <View style={{ gap: 10 }}>
          <Button label="Approve the payout" icon="check" primary p={p} onPress={() => { setPending({ kind: "payout", payout: source.payout, approve: true }); closeDetail(); }} />
          <Button label="Hold the payout" icon="pause" p={p} onPress={() => { setPending({ kind: "payout", payout: source.payout, approve: false }); closeDetail(); }} />
        </View>}
        {source?.kind === "stalled" && <Button label={stalledReady ? "Remind the owner now" : "Reminded in the last day"} icon="bell" primary={stalledReady} p={p} disabled={!stalledReady || !!actions.busy} onPress={() => { actions.remind(source.stalled); closeDetail(); }} />}
        {source?.kind === "missed" && <Button label="Mark as seen" icon="eye" p={p} disabled={!!actions.busy} onPress={() => { actions.seen(source.missed); closeDetail(); }} />}
      </TrackerDetailSheet>
      <HubItemSheet p={p} hub={hub} account={account} properties={properties} target={hubTarget} onClose={() => setHubTarget(null)} onSaved={saved(async () => { setHubTarget(null); await load(); })} />
      <DecideSheet p={p} pending={pending} onClose={() => setPending(null)} onDone={saved(load)} />
      <DisputeSheet p={p} target={dispute} onClose={() => setDispute(null)} onDone={saved(load)} />
      <ExpenseSheet p={p} role={account.role} id={expense} limit={limit} onClose={() => setExpense(null)} onAsk={a => { setExpense(null); setAsk(a); }} onDone={saved(load)} />
      <CostDecisionSheet p={p} decision={repair} onClose={() => setRepair(null)} onDone={saved(load)} />
      <NoteSheet p={p} ask={ask} onClose={() => setAsk(null)} onDone={saved(load)} />
    </View>
  );
}
