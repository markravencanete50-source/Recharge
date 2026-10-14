import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, Notice, Section, london, message, useRequestId } from "./LiveKit";
import { List } from "./LiveAccounts";
import { Pills } from "./Pills";
import { exportReport } from "./exportReport";
import { readFinance, readOversight, readTeams, writeFinance, writeOversight, writeTeams, WorkspaceApiError } from "./backend/client";
import { DECISION_OUTCOMES, decisionAction, managementSchema, queueCount, type Decision, type Management } from "../../lib/management-live";
import { AREA_LABEL, decisionsCsv, decisionsSchema, outcomeLabel, overviewSchema, type DecisionRow, type Overview } from "../../lib/oversight-policy";
import { formatMoney } from "../../lib/format";
import type { HomeToolTarget } from "../../lib/home-tools";
import { adminNeeds, departmentTiles, type NeedLine, type NeedOpen } from "../../lib/home-needs";
import { ATTENTION_SHOWN, businessFigures, EMPTY_OVERVIEW, guestReplyGlanceSchema, overviewRanges, performanceRangeQuery, type OverviewData } from "../../lib/home-overview";
import { performanceReportSchema } from "../../lib/performance";
import { enquiriesReportSchema } from "../../lib/business-reports-view";
import { BusinessFigures, DepartmentTiles, NeedsList } from "./HomeFocus";
import type { Expense } from "../../lib/accounts-live";
import { hubSchema } from "../../lib/workspace-teams-policy";
import { parseApprovalFlags } from "../../lib/tracker-approvals";

// Management oversight in the live app: admins' Home (what needs them now and the departments), the
// decision sheet and reminders the Management approvals list uses, and the decisions report.
type Stalled = Management["stalledOwnerApprovals"][number];
type Unusual = Management["unusualPayouts"][number];
type Missed = Management["missedYesterday"][number];
export type Pending =
  | { kind: "decision"; decision: Decision; outcome: string | null }
  | { kind: "expense"; expense: Expense; approve: boolean }
  | { kind: "payout"; payout: Unusual; approve: boolean };

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

// The reads behind "This month" (lib/home-overview.ts): this and last month's Performance report (with the value as
// booked), guest replies on time, and the enquiries Business report for this month so far and the same days of last
// month. Each may fail on its own; its figures then show "–". Payouts overdue comes from the overview AdminHome reads
// anyway.
function useBusinessFigures() {
  const [data, setData] = useState<OverviewData>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const r = overviewRanges(london(new Date()));
    const performance = (range: { from: string; to: string }) => readFinance(performanceRangeQuery(range)).then(x => performanceReportSchema.parse(x.data));
    const enquiries = (range: { from: string; to: string }) => readTeams({ section: "reportEnquiries", from: range.from, to: range.to }).then(x => enquiriesReportSchema.parse(x.data));
    const replies = readTeams({ section: "guestReplies" }).then(x => guestReplyGlanceSchema.parse(x.data));
    const [month, lastMonth, now, before, glance] = await Promise.allSettled([performance(r.month), performance(r.lastMonth), enquiries(r.soFar), enquiries(r.sameDaysBefore), replies]);
    const ok = <T,>(x: PromiseSettledResult<T>) => (x.status === "fulfilled" ? x.value : null);
    const m = ok(month), l = ok(lastMonth);
    setData({ month: m?.totals ?? null, lastMonth: l?.totals ?? null, booked: m?.bookedValueMinor ?? null, bookedBefore: l?.bookedValueMinor ?? null, replies: ok(glance),
      enquiries: ok(now), enquiriesBefore: ok(before), payoutsOverdue: null, portfolio: null });
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  return { data, loading };
}

// Admins' Home (Lee: the whole business at a glance for Alex): "This month" (the business figures), then "Needs your
// attention" across the business, with everything waiting on management as one line (decided in Management → Waiting
// on you), six lines and "See all" for the rest, then one number per department (lib/home-needs.ts).
export function AdminHome({ palette: p, desktop, onTool, onOpen, onPlace, portfolio = null, followUps = 0 }: { palette: Palette; desktop: boolean; onTool: (target: HomeToolTarget) => void; onOpen: (line: NeedLine) => void; onPlace: (open: NeedOpen) => void; portfolio?: OverviewData["portfolio"]; followUps?: number }) {
  const business = useBusinessFigures();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const { queue, error, load: loadQueue } = useQueue();
  // Flags and approval tickets also wait on management; they are decided in Management → Waiting on you.
  const [flags, setFlags] = useState(0);
  const [tickets, setTickets] = useState(0);
  const load = useCallback(async () => {
    const [o, f, h] = await Promise.allSettled([readOversight({ section: "overview" }).then(r => overviewSchema.parse(r.data)), readTeams({ section: "flags" }), readTeams({ section: "hub" }), loadQueue()]);
    if (o.status === "fulfilled") { setOverview(o.value); setOverviewError(""); } else setOverviewError(message(o.reason));
    if (f.status === "fulfilled") setFlags(parseApprovalFlags(f.value.data).flags.filter(x => x.status === "open").length);
    if (h.status === "fulfilled") { const parsed = hubSchema.safeParse(h.value.data); setTickets(parsed.success ? parsed.data.items.filter(i => i.kind === "approval" && i.status === "pending").length : 0); }
  }, [loadQueue]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // The same total as Management → Waiting on you, so the line matches what is there.
  const waiting = queue ? queueCount(queue) + queue.cleanerWarnings.filter(w => w.warning).length + flags + tickets : null;
  // Nothing shows until both reads have answered, so the lines don't jump about as they arrive.
  const loading = (!overview && !overviewError) || (!queue && !error);
  const lines = loading ? [] : adminNeeds(overview, waiting, followUps);
  return (
    <>
      <BusinessFigures palette={p} figures={businessFigures({ ...business.data, portfolio, payoutsOverdue: overview?.accounts.payoutsToReconcile ?? null }, london(new Date()))} desktop={desktop}
        loading={business.loading || (!overview && !overviewError)} onOpen={f => onPlace(f.open)} />
      <NeedsList palette={p} title="Needs your attention" limit={ATTENTION_SHOWN} lines={lines} loading={loading} error={overviewError || error} onOpen={onOpen} />
      {!!overview && <DepartmentTiles palette={p} tiles={departmentTiles(overview)} desktop={desktop} onOpen={onTool} />}
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
