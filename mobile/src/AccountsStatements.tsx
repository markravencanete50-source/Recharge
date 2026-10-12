import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Tag, useRequestId } from "./LiveKit";
import { writeFinance } from "./backend/client";
import { StatementFiles } from "./AccountsFiles";
import { Line, type NoteAsk } from "./AccountsPayable";
import { CHANNEL_LABEL, pounds, statementMoves, statementsSchema } from "../../lib/accounts-live";
import { poundsToMinor } from "../../lib/repairs-live";
import type { FinanceAction } from "../../lib/workspace-finance-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Statements tab of Live Accounts: owner statements to prepare, check, issue and mark paid, and the terms behind them.
export type StatementRow = z.infer<typeof statementsSchema>[number];
const STATEMENT_LABEL: Record<string, [string, "good" | "wait" | "bad" | "plain"]> = { draft: ["Draft", "wait"], issued: ["Issued to owner", "plain"], paid: ["Paid", "good"], void: ["Void", "bad"] };

export function TermsSheet({ p, row, onClose, onDone }: { p: Palette; row: StatementRow | null; onClose: () => void; onDone: () => Promise<void> }) {
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

// The Statements tab body, rendered by LiveAccounts while that tab is selected.
export function AccountsStatements({ p, role, management, period, statements, loading, expanded, setExpanded, busyStatement, statementAction, setTerms, setAsk }: {
  p: Palette;
  role: WorkspaceAccount["role"];
  management: boolean;
  period: string;
  statements: StatementRow[];
  loading: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  busyStatement: string;
  statementAction: (key: string, action: FinanceAction) => Promise<void>;
  setTerms: (row: StatementRow) => void;
  setAsk: (ask: NoteAsk) => void;
}) {
  return (
    <>
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
              <MotionPress accessibilityRole="button" onPress={() => setExpanded(expanded === st.id ? null : st.id)} hitSlop={8} style={[ui.row, { gap: 6, minHeight: 44 }]}><ExpandChevron open={expanded === st.id} size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>{expanded === st.id ? "Hide breakdown" : "Show breakdown"}</Text></MotionPress>
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
    </>
  );
}
