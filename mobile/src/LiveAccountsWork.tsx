import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, OnlySection, Section, useOnlySection, useRequestId } from "./LiveKit";
import { sectionAnchor } from "../../lib/home-tools";
import { List, Row } from "./LiveAccounts";
import { RecordCleanerInvoiceSheet } from "./AccountsPayable";
import { AccountsCleanerPay } from "./CleanerInvoices";
import { readOperations, readTeams, writeTeams } from "./backend/client";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import { budgetChartSchema, cleanerInvoiceGroups, type BudgetItem } from "../../lib/accounts-work";
import { cleanerRatesSchema } from "../../lib/cleans-live";
import { formatMoney, plural } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { trackerItemsFor } from "../../lib/tracker-sections";
import { workItemForms } from "../../lib/workflow-forms";
import { TrackerList } from "./Tracker";

// Accounts' side of purchases and cleaning: purchase requests waiting on Accounts, accepted cleans
// grouped by cleaner (tapping one opens the Record cleaner invoice form with that cleaner's cleans), and the budget chart
// purchases are approved against.
type Operation = z.infer<typeof operationViewSchema>;
const PURCHASE_STAGE: Record<string, string> = { requested: "To approve", approved: "To order", delivered: "To reconcile" };

function BudgetSheet({ p, item, visible, onClose, onDone }: { p: Palette; item: BudgetItem | null; visible: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(item?.item ?? ""), [max, setMax] = useState(item ? (item.maxUnitMinor / 100).toFixed(2) : ""), [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(visible ? "budget:" + (item?.id ?? "new") + ":" + (item?.version ?? 0) : null);
  async function save(remove = false) {
    if (busy) return;
    const minor = poundsToMinor(max);
    if (!remove && (name.trim().length < 2 || !minor)) { setError("Add the item and the most it should cost."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams(remove && item ? { action: "removeBudgetItem", requestId: request.get(), id: item.id, version: item.version }
        : { action: "saveBudgetItem", requestId: request.get(), ...(item ? { id: item.id, version: item.version } : {}), item: name.trim(), maxUnitMinor: minor!, note: note.trim() });
      request.done(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={item ? "Edit budget item" : "Add to the budget chart"} subtitle="The most one of these should cost" icon="coins">
      <Field label="Item" value={name} onChange={setName} p={p} placeholder="For example: Dining chair" />
      <Field label="Most it should cost (each)" value={max} onChange={setMax} p={p} placeholder="£0.00" />
      <Field label="Note (optional)" value={note} onChange={setNote} p={p} placeholder="Preferred supplier or specification" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
      {item && <Button label="Remove from the chart" icon="trash-2" p={p} disabled={busy} onPress={() => void save(true)} />}
    </Sheet>
  );
}

export function AccountsWork({ palette: p, account, properties, onOpenWork }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onOpenWork: (item: Operation) => void }) {
  const saved = useSaved();
  // On a tool page (Purchases, Cleaner invoices, Budget chart: lib/tool-focus.ts) only that section shows; Payable
  // invoices (Cleaner invoices) brings the requests for invoice with it.
  const only = useOnlySection();
  const [work, setWork] = useState<Operation[]>([]), [budget, setBudget] = useState<BudgetItem[]>([]), [rates, setRates] = useState<ReadonlyMap<string, number>>(new Map());
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [recordFor, setRecordFor] = useState<string | null>(null), [editing, setEditing] = useState<BudgetItem | null>(null), [adding, setAdding] = useState(false);
  const canPayCleaners = ["admin", "super_admin"].includes(account.role) || (account.role === "accounts" && account.modules.includes("cleans-invoices"));
  const canBudget = ["admin", "super_admin"].includes(account.role) || (account.role === "accounts" && account.modules.includes("purchase-order-accounts"));
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [o, b, r] = await Promise.allSettled([readOperations(), readTeams({ section: "budgetChart" }), readTeams({ section: "cleanerRates" })]);
      // Each part shows on its own: an odd budget or rates reply never hides the work list.
      const ops = o.status === "fulfilled" ? z.array(operationViewSchema).safeParse(o.value.data) : null;
      if (ops?.success) setWork(ops.data); else setError(o.status === "rejected" ? message(o.reason) : "The work list could not be read. Refresh to try again.");
      const chart = b.status === "fulfilled" ? budgetChartSchema.safeParse(b.value.data) : null;
      if (chart?.success) setBudget(chart.data);
      const pay = r.status === "fulfilled" ? cleanerRatesSchema.safeParse(r.value.data) : null;
      if (pay?.success) setRates(new Map(pay.data.map(x => [x.cleanerId, x.rateMinor])));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const nameOf = useCallback((id: string) => properties.find(x => x.id === id)?.name ?? "Property", [properties]);
  const purchases = work.filter(w => w.kind === "purchase" && typeof w.data.phase === "string" && w.data.phase in PURCHASE_STAGE && !["completed", "cancelled"].includes(w.status));
  // Accounts is a staff screen, so the role decides whether staff names show on the rows.
  const owner = account.role === "client";
  const purchaseItems = useMemo(() => trackerItemsFor(purchases, {
    property: id => properties.find(x => x.id === id), forms: w => workItemForms(account, w, [], work), now: new Date(), owner,
  }, "purchases"), [purchases, properties, account, work, owner]);
  const groups = useMemo(() => cleanerInvoiceGroups(work, nameOf, rates), [work, nameOf, rates]);
  return (
    <View style={{ gap: 20 }}>
      {loading && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Section title="Purchases" count={purchases.length} p={p}>
        <TrackerList p={p} items={purchaseItems} empty="No purchase requests waiting on Accounts." owner={owner}
          onOpen={item => { const w = purchases.find(x => x.workId === item.workId); if (w) onOpenWork(w); }} />
      </Section>
      {/* Requests for invoice made at the end of each pay period (20261022000000): approve or query, then pay. */}
      {canPayCleaners && (!only || only === sectionAnchor("Cleaner invoices")) && <OnlySection.Provider value={null}><AccountsCleanerPay p={p} canSetOutcome={["admin", "super_admin"].includes(account.role)} /></OnlySection.Provider>}
      <Section title="Cleaner invoices" count={groups.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Accepted cleans waiting to be invoiced, by cleaner. Tap a cleaner to record their invoice.</Text>
        <List p={p} empty="No accepted cleans waiting to be invoiced.">
          {groups.map((g, i) => <Row key={g.cleanerId} p={p} first={i === 0} icon="user" tone="cleans" title={g.cleanerName}
            detail={`${plural(g.tasks.length, "clean")} · ${g.tasks.slice(0, 3).map(t => t.propertyName).join(", ")}${g.tasks.length > 3 ? "…" : ""}`} amount={g.amountMinor != null ? formatMoney(g.amountMinor) : undefined} onPress={() => setRecordFor(g.cleanerId)} />)}
        </List>
      </Section>
      <Section title="Budget chart" count={budget.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>The most each item should cost. Purchases are approved against it.</Text>
        <List p={p} empty="Nothing in the budget chart yet.">
          {budget.map((b, i) => <Row key={b.id} p={p} first={i === 0} icon="tag" tone="accounts" title={b.item} detail={b.note || "Up to this much each"} amount={formatMoney(b.maxUnitMinor)} onPress={canBudget ? () => setEditing(b) : undefined} />)}
        </List>
        {canBudget && <Button label="Add an item" icon="plus" p={p} onPress={() => setAdding(true)} />}
      </Section>
      <RecordCleanerInvoiceSheet p={p} visible={recordFor !== null} properties={properties} initialCleanerId={recordFor} onClose={() => setRecordFor(null)} onDone={saved(async () => { setRecordFor(null); await load(); })} />
      <BudgetSheet key={(editing?.id ?? "new") + String(adding)} p={p} item={editing} visible={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} onDone={saved(async () => { setAdding(false); setEditing(null); await load(); })} />
    </View>
  );
}
