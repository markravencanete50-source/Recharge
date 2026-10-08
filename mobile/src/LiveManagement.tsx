import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, useRequestId } from "./LiveKit";
import { ExpenseSheet, List, NoteSheet, Pills, Row, type NoteAsk } from "./LiveAccounts";
import { LiveTraining } from "./LiveTraining";
import { LivePeople } from "./LivePeople";
import { readFinance, readTeams, writeTeams, WorkspaceApiError } from "./backend/client";
import { DECISION_OUTCOMES, decisionAction, managementSchema, type Decision, type Management } from "../../lib/management-live";
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

export function LiveManagement({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [queue, setQueue] = useState<Management | null>(null);
  const [team, setTeam] = useState<z.infer<typeof performanceSchema>>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"queue" | "people" | "properties" | "team" | "training">("queue");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [expense, setExpense] = useState<string | null>(null);
  const [ask, setAsk] = useState<NoteAsk | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [q, perf, pol] = await Promise.allSettled([readTeams({ section: "management" }), readTeams({ section: "performance" }), readFinance({ section: "policy" })]);
    try {
      if (q.status === "fulfilled") setQueue(managementSchema.parse(q.value.data)); else throw q.reason;
      if (perf.status === "fulfilled") setTeam(performanceSchema.parse(perf.value.data));
      if (pol.status === "fulfilled") setLimit(policySchema.parse(pol.value.data).expenseApprovalLimitMinor);
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "The management queue could not be loaded."); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const tiles = [
    { label: "Cleaning decisions", value: queue?.cleaningDecisions.length ?? 0 },
    { label: "Costs above the limit", value: queue?.expensesOverLimit.length ?? 0 },
    { label: "Owner approvals over 48 hours", value: queue?.stalledOwnerApprovals.length ?? 0 },
  ];
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Management</Text>
        <Text style={[ui.body, { color: p.muted }]}>Everything waiting on a management decision, in one place.</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {tiles.map(tile => (
          <View key={tile.label} style={[ui.card, { flex: 1, padding: 14, gap: 4, backgroundColor: p.surface, borderColor: tile.value ? p.primary : p.border }]}>
            <Text style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>{tile.value}</Text>
            <Text numberOfLines={3} style={[ui.small, { color: p.muted }]}>{tile.label}</Text>
          </View>
        ))}
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <ActivityIndicator color={p.primary} accessibilityLabel="Loading the management queue" />}
      <Pills p={p} values={["queue", "people", "properties", "team", "training"] as const} value={view} onChange={setView} label={v => ({ queue: "Waiting on you", people: "People", properties: "Properties", team: "Cleaning team", training: "Onboarding & training" })[v]} />

      {view === "queue" && queue && <>
        <Section title="Cleaning decisions" count={queue.cleaningDecisions.length} p={p}>
          <List p={p} empty="No cleaning decisions waiting.">
            {queue.cleaningDecisions.map((d, i) => (
              <Row key={d.workId} p={p} first={i === 0} title={d.kind === "cleaning_complaint" ? `Rejected clean · ${d.cleanerName ?? "Cleaner"}` : `Review ${d.cleanerName ?? "cleaner"}`}
                detail={`${d.propertyName} · raised ${since(d.createdAt)}`} tags={[d.cleanerStatement ? ["Cleaner has responded", "plain"] : ["Awaiting cleaner", "wait"]]} onPress={() => setDecision(d)} />
            ))}
          </List>
        </Section>
        <Section title="Costs above the approval limit" count={queue.expensesOverLimit.length} p={p}>
          {limit !== null && <Text style={[ui.small, { color: p.muted }]}>Accounts approves up to {pounds(limit)}. These need you.</Text>}
          <List p={p} empty="Nothing above the limit.">
            {queue.expensesOverLimit.map((e, i) => (
              <Row key={e.id} p={p} first={i === 0} title={e.supplier} detail={`${e.propertyName} · ${e.reference}`} amount={pounds(e.amountMinor)}
                tags={[e.hasInvoice && e.hasProof ? ["Evidence complete", "good"] : ["Evidence missing", "wait"]]} onPress={() => setExpense(e.id)} />
            ))}
          </List>
        </Section>
        <Section title="Owner approvals waiting over 48 hours" count={queue.stalledOwnerApprovals.length} p={p}>
          <List p={p} empty="No repairs are stuck with an owner.">
            {queue.stalledOwnerApprovals.map((a, i) => (
              <Row key={a.workId} p={p} first={i === 0} title={a.title} detail={`${a.propertyName} · waiting ${since(a.waitingSince)}. Chase the owner: they approve in their app.`} amount={pounds(a.estimatedCostMinor)} />
            ))}
          </List>
        </Section>
        <Section title="Owners who owe a balance" count={queue.ownerBalancesDue.length} p={p}>
          <List p={p} empty="No owner balances due.">
            {queue.ownerBalancesDue.map((s, i) => (
              <Row key={s.id} p={p} first={i === 0} title={s.propertyName} detail={`${s.period} statement · ${s.status === "draft" ? "not issued yet" : "issued"}. Invoice the owner.`} amount={pounds(-s.payoutMinor)} />
            ))}
          </List>
        </Section>
      </>}

      {view === "team" && <>
        {!!queue?.cleanerWarnings.length && <Notice text={`${queue.cleanerWarnings.length} cleaner${queue.cleanerWarnings.length === 1 ? " has" : "s have"} two or more upheld rejections this month.`} p={p} tone="bad" />}
        <Section title="Cleaners this month" p={p}>
          <List p={p} empty="No active cleaners yet.">
            {team.map((c, i) => (
              <Row key={c.cleanerId} p={p} first={i === 0} title={c.fullName} detail={`${c.accepted} accepted · ${c.rejected} rejected · ${c.overturned} overturned`}
                tags={c.warning ? [["Warning", "bad"]] : c.openComplaints.length ? [[`${c.openComplaints.length} open complaint${c.openComplaints.length === 1 ? "" : "s"}`, "wait"]] : [["On track", "good"]]} />
            ))}
          </List>
        </Section>
      </>}

      {view === "training" && <LiveTraining palette={p} manage />}
      {(view === "people" || view === "properties") && <LivePeople palette={p} account={account} view={view} />}

      <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
      <DecisionSheet p={p} decision={decision} onClose={() => setDecision(null)} onDone={load} />
      <ExpenseSheet p={p} role={account.role} id={expense} limit={limit} onClose={() => setExpense(null)} onAsk={a => { setExpense(null); setAsk(a); }} onDone={load} />
      <NoteSheet p={p} ask={ask} onClose={() => setAsk(null)} onDone={load} />
    </View>
  );
}
