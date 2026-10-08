import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { AccessControl } from "./LiveAccessControl";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, useRequestId, useWorkFocus, Loading, StatGrid, StatTile } from "./LiveKit";
import { ExpenseSheet, List, NoteSheet, Pills, Row, type NoteAsk } from "./LiveAccounts";
import { LiveTraining } from "./LiveTraining";
import { LivePeople } from "./LivePeople";
import { LiveTeamPerformance } from "./LiveShifts";
import { DisputeSheet } from "./CleanDisputes";
import { readFinance, readTeams, writeTeams, WorkspaceApiError } from "./backend/client";
import { DECISION_OUTCOMES, decisionAction, managementSchema, type Decision, type Management, type RepairApproval } from "../../lib/management-live";
import { CostDecisionSheet, type CostDecision } from "./LiveApprovals";
import { performanceSchema } from "../../lib/cleans-live";
import { policySchema, pounds } from "../../lib/accounts-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Live Management: one queue of everything waiting on admins, the cleaning
// team's month, and training. Read from and written to the backend only.
const since = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000));
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
};

function DecisionSheet({ p, decision, onClose, onDone }: { p: Palette; decision: Decision | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(decision ? ["decide", decision.workId, decision.version, outcome, note.trim()].join(":") : null);
  useEffect(() => { queueMicrotask(() => { setOutcome(""); setNote(""); setError(""); }); }, [decision]);
  const outcomes = decision ? DECISION_OUTCOMES[decision.kind] : [];
  async function save() {
    if (!decision || busy) return;
    if (!outcome || note.trim().length < 5) { setError("Choose an outcome and explain the decision (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      const base = { requestId: request.get(), workId: decision.workId, version: decision.version, note: note.trim() };
      await writeTeams(decisionAction(decision) === "decideComplaint"
        ? { ...base, action: "decideComplaint", outcome: outcome as "upheld" | "overturned" }
        : { ...base, action: "decideCleanerReview", outcome: outcome as "no_action" | "supervised" | "removed_from_rota" });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const complaint = decision?.kind === "cleaning_complaint";
  return (
    <Sheet palette={p} visible={!!decision} onClose={onClose} title={complaint ? "Rejected clean" : "Cleaner review"} subtitle={decision ? `${decision.cleanerName ?? "Cleaner"} · ${decision.propertyName}` : undefined} icon="spray">
      {decision && <>
        <Text style={[ui.body, { color: p.text }]}>{complaint ? "A clean was rejected after a guest complaint. Read the cleaner's side, then decide whether the rejection stands." : "This cleaner has had repeated rejected cleans this month. Decide what happens next."}</Text>
        <Notice text={decision.cleanerStatement ? `Cleaner's response: ${decision.cleanerStatement}` : "The cleaner has not responded yet."} p={p} />
        <View style={{ gap: 8 }}>
          {outcomes.map(([value, label]) => <Button key={value} label={label} primary={outcome === value} p={p} onPress={() => setOutcome(value)} />)}
        </View>
        {complaint && outcome === "overturned" && <Text style={[ui.small, { color: p.muted }]}>{"Overturning removes the rejection from the cleaner’s record. If the clean was not redone, it is accepted and sent for invoicing."}</Text>}
        <Field label="Decision note" value={note} onChange={setNote} p={p} multiline placeholder="What you checked and why" />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : "Record decision"} primary p={p} disabled={busy} onPress={() => void save()} />
      </>}
    </Sheet>
  );
}

const MANAGEMENT_VIEWS = ["queue", "people", "properties", "performance", "team", "training", "access"] as const;
type ManagementView = (typeof MANAGEMENT_VIEWS)[number];
export function LiveManagement({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const saved = useSaved();
  const [queue, setQueue] = useState<Management | null>(null);
  const [team, setTeam] = useState<z.infer<typeof performanceSchema>>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focus = useWorkFocus();
  const [view, setView] = useState<ManagementView>(() => MANAGEMENT_VIEWS.find(v => v === focus?.sub) ?? "queue");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [expense, setExpense] = useState<string | null>(null);
  const [ask, setAsk] = useState<NoteAsk | null>(null);
  // Repairs above the company-wide management limit, and the limit itself.
  const [repair, setRepair] = useState<CostDecision | null>(null);
  const [repairPolicy, setRepairPolicy] = useState<{ limit: number | null; version: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [q, perf, pol] = await Promise.allSettled([readTeams({ section: "management" }), readTeams({ section: "performance" }), readFinance({ section: "policy" })]);
    try {
      if (q.status === "fulfilled") setQueue(managementSchema.parse(q.value.data)); else throw q.reason;
      if (perf.status === "fulfilled") setTeam(performanceSchema.parse(perf.value.data));
      if (pol.status === "fulfilled") { const v = policySchema.parse(pol.value.data); setLimit(v.expenseApprovalLimitMinor); setRepairPolicy({ limit: v.managementRepairLimitMinor, version: v.version }); }
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "The management queue could not be loaded."); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const tiles = [
    { label: "Cleaning decisions", value: queue?.cleaningDecisions.length ?? 0, icon: "check-square" as const, detail: "Complaints and reviews" },
    { label: "Costs over limit", value: queue?.expensesOverLimit.length ?? 0, icon: "alert-triangle" as const, detail: "Need your approval" },
    { label: "Owner approvals", value: queue?.stalledOwnerApprovals.length ?? 0, icon: "clock" as const, detail: "Waiting over 48 hours" },
    { label: "Repair costs", value: queue?.repairApprovals.length ?? 0, icon: "tool" as const, detail: "Above the management limit" },
  ];
  const openRepair = (r: RepairApproval) => setRepair({
    who: "management", workId: r.workId, version: r.version, propertyName: r.propertyName, issue: r.issue ?? r.title, repairType: r.repairType, urgent: r.urgent, hazard: r.hazard,
    estimateMinor: r.estimatedCostMinor, previousEstimateMinor: r.previousEstimateMinor, quoteReason: r.quoteReason,
    limitText: `Above the management limit${r.limitMinor !== null ? " of " + pounds(r.limitMinor) : ""}. ${r.ownerApprovedAt ? "The owner has approved it." : "It is within the owner’s own limit."} Once approved, it carries on with Stays and Ready.`,
  });
  const changeRepairLimit = () => repairPolicy && setAsk({ title: "Management approval for repairs", subtitle: "Repairs costing more than this also need an admin’s approval, after the owner’s", min: 0, confirm: "Save limit",
    amount: { label: "Limit (leave 0 to switch it off)", initial: repairPolicy.limit == null ? "0" : (repairPolicy.limit / 100).toFixed(2) },
    build: (_note, minor) => ({ action: "setRepairApprovalLimit", requestId: "", version: repairPolicy.version, managementRepairLimitMinor: minor ? minor : null }) });
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Management</Text>
        <Text style={[ui.body, { color: p.muted }]}>Everything waiting on a management decision, in one place.</Text>
      </View>
      <StatGrid>
        {tiles.map(tile => <StatTile key={tile.label} p={p} icon={tile.icon} label={tile.label} value={tile.value} detail={tile.detail} attention={tile.value > 0} />)}
      </StatGrid>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}
      <Pills p={p} values={MANAGEMENT_VIEWS.filter(v => v !== "access" || account.role === "super_admin")} value={view} onChange={setView} label={v => ({ queue: "Waiting on you", people: "People", properties: "Properties", performance: "Team performance", team: "Cleaning team", training: "Onboarding & training", access: "Access control" })[v]} />

      {view === "access" && <AccessControl palette={p} account={account} />}
      {view === "queue" && queue && <>
        <Section title="Cleaning decisions" count={queue.cleaningDecisions.length} p={p}>
          <List p={p} empty="No cleaning decisions waiting.">
            {queue.cleaningDecisions.map((d, i) => (
              <Row key={d.workId} p={p} first={i === 0} icon="check-square" tone="cleans" title={d.kind === "cleaning_complaint" ? `Rejected clean · ${d.cleanerName ?? "Cleaner"}` : `Review ${d.cleanerName ?? "cleaner"}`}
                detail={`${d.propertyName} · raised ${since(d.createdAt)}`} tags={[d.cleanerStatement ? ["Cleaner has responded", "plain"] : ["Awaiting cleaner", "wait"]]} onPress={() => setDecision(d)} />
            ))}
          </List>
        </Section>
        <Section title="Costs above the approval limit" count={queue.expensesOverLimit.length} p={p}>
          {limit !== null && <Text style={[ui.small, { color: p.muted }]}>Accounts approves up to {pounds(limit)}. These need you.</Text>}
          <List p={p} empty="Nothing above the limit.">
            {queue.expensesOverLimit.map((e, i) => (
              <Row key={e.id} p={p} first={i === 0} icon="alert-triangle" tone="accounts" title={e.supplier} detail={`${e.propertyName} · ${e.reference}`} amount={pounds(e.amountMinor)}
                tags={[e.hasInvoice && e.hasProof ? ["Evidence complete", "good"] : ["Evidence missing", "wait"]]} onPress={() => setExpense(e.id)} />
            ))}
          </List>
        </Section>
        <Section title="Repairs above the management limit" count={queue.repairApprovals.length} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>{repairPolicy?.limit == null ? "Off: repairs need only the owner’s approval, above their own limit." : `Repairs above ${pounds(repairPolicy.limit)} need your approval too, after the owner’s.`}</Text>
          <List p={p} empty="No repair costs waiting for management.">
            {queue.repairApprovals.map((r, i) => (
              <Row key={r.workId} p={p} first={i === 0} icon="tool" tone="ready" title={r.propertyName} detail={`${r.issue ?? r.title} · waiting ${since(r.waitingSince)}`} amount={pounds(r.estimatedCostMinor)}
                tags={[r.ownerApprovedAt ? ["Owner approved", "good"] : ["Within the owner’s limit", "plain"], ...(r.urgent ? [["Urgent", "bad"] as [string, "bad"]] : [])]} onPress={() => openRepair(r)} />
            ))}
          </List>
          {repairPolicy && <Button label="Change the repair limit" icon="sliders" p={p} onPress={changeRepairLimit} />}
        </Section>
        <Section title="Owner approvals waiting over 48 hours" count={queue.stalledOwnerApprovals.length} p={p}>
          <List p={p} empty="No repairs are stuck with an owner.">
            {queue.stalledOwnerApprovals.map((a, i) => (
              <Row key={a.workId} p={p} first={i === 0} icon="clock" tone="clients" title={a.title} detail={`${a.propertyName} · waiting ${since(a.waitingSince)}. Chase the owner: they approve in their app.`} amount={pounds(a.estimatedCostMinor)} />
            ))}
          </List>
        </Section>
        <Section title="Owners who owe a balance" count={queue.ownerBalancesDue.length} p={p}>
          <List p={p} empty="No owner balances due.">
            {queue.ownerBalancesDue.map((s, i) => (
              <Row key={s.id} p={p} first={i === 0} icon="pie-chart" tone="accounts" title={s.propertyName} detail={`${s.period} statement · ${s.status === "draft" ? "not issued yet" : "issued"}. Invoice the owner.`} amount={pounds(-s.payoutMinor)} />
            ))}
          </List>
        </Section>
      </>}

      {view === "team" && <>
        {!!queue?.cleanerWarnings.length && <Notice text={`${queue.cleanerWarnings.length} cleaner${queue.cleanerWarnings.length === 1 ? " has" : "s have"} two or more upheld rejections this month.`} p={p} tone="bad" />}
        <Section title="Cleaners this month" p={p}>
          <List p={p} empty="No active cleaners yet.">
            {team.map((c, i) => (
              <Row key={c.cleanerId} p={p} first={i === 0} icon="user" tone="cleans" title={c.fullName} detail={`${c.accepted} accepted · ${c.rejected} rejected · ${c.overturned} overturned`}
                tags={c.warning ? [["Warning", "bad"]] : c.openComplaints.length ? [[`${c.openComplaints.length} open complaint${c.openComplaints.length === 1 ? "" : "s"}`, "wait"]] : [["On track", "good"]]} />
            ))}
          </List>
        </Section>
      </>}

      {view === "training" && <LiveTraining palette={p} manage />}
      {view === "performance" && <LiveTeamPerformance palette={p} />}
      {(view === "people" || view === "properties") && <LivePeople palette={p} account={account} view={view} />}

      <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
      <DecisionSheet p={p} decision={decision?.kind === "cleaning_complaint" ? null : decision} onClose={() => setDecision(null)} onDone={saved(load)} />
      <DisputeSheet p={p} target={decision?.kind === "cleaning_complaint" ? decision : null} onClose={() => setDecision(null)} onDone={saved(load)} />
      <ExpenseSheet p={p} role={account.role} id={expense} limit={limit} onClose={() => setExpense(null)} onAsk={a => { setExpense(null); setAsk(a); }} onDone={saved(load)} />
      <NoteSheet p={p} ask={ask} onClose={() => setAsk(null)} onDone={saved(load)} />
      <CostDecisionSheet p={p} decision={repair} onClose={() => setRepair(null)} onDone={saved(load)} />
    </View>
  );
}
