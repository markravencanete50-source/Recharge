import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, Section, useRequestId } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { readOperations, readTeams, writeOperation, writeTeams } from "./backend/client";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import { budgetChartSchema, cleanerInvoiceGroups, type BudgetItem, type CleanerGroup } from "../../lib/accounts-work";
import { cleanerRatesSchema } from "../../lib/cleans-live";
import { formatDay, formatMoney, plural } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Accounts' side of purchases and cleaning: purchase requests waiting on Accounts, accepted cleans
// grouped by cleaner so several go on one invoice, and the budget chart purchases are approved against.
type Operation = z.infer<typeof operationViewSchema>;
const PURCHASE_STAGE: Record<string, string> = { requested: "To approve", approved: "To order", delivered: "To reconcile" };

function CleanerInvoiceSheet({ p, group, onClose, onDone }: { p: Palette; group: CleanerGroup | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [reference, setReference] = useState(""), [amount, setAmount] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // The total starts from the cleaner's pay rate per clean, when one is set.
  useEffect(() => { queueMicrotask(() => setAmount(group?.amountMinor ? (group.amountMinor / 100).toFixed(2) : "")); }, [group]);
  async function save() {
    if (!group || busy) return;
    const minor = poundsToMinor(amount);
    if (reference.trim().length < 2 || minor === null) { setError("Add the invoice reference and the total."); return; }
    setBusy(true); setError("");
    const evidence = `Included in cleaner invoice ${reference.trim()} for ${group.cleanerName}: ${plural(group.tasks.length, "clean")}, ${formatMoney(minor)} in total.`;
    try {
      // One invoice: each clean's task is closed against the same reference.
      for (const task of group.tasks) await writeOperation({ action: "updateOperation", requestId: Crypto.randomUUID(), workId: task.workId, version: task.version, step: "completeHandover", data: { evidence } });
      setReference(""); setAmount(""); await onDone();
    } catch (e) { setError(message(e) + " Refresh: any cleans already recorded have been closed."); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!group} onClose={onClose} title={group ? `Invoice for ${group.cleanerName}` : ""} subtitle={group ? plural(group.tasks.length, "accepted clean") : undefined} icon="coins">
      {group && <>
        <List p={p} empty="">
          {group.tasks.map((t, i) => <Row key={t.workId} p={p} first={i === 0} icon="check-circle" tone="cleans" title={t.propertyName} detail={t.cleanedOn ? formatDay(t.cleanedOn) : "Date not recorded"} />)}
        </List>
        <Field label="Invoice reference" value={reference} onChange={setReference} p={p} placeholder="For example: CARA-2026-10" />
        <Text style={[ui.small, { color: p.muted }]}>{group.rateMinor ? `${plural(group.tasks.length, "clean")} at ${formatMoney(group.rateMinor)} each: ${formatMoney(group.amountMinor)}.` : "No pay rate is set for this cleaner yet. Admins and cleaning managers set it in Work, Cleans."}</Text>
        <Field label="Invoice total" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
        <Text style={[ui.small, { color: p.muted }]}>Records that these cleans are on one invoice and closes their invoice tasks.</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : `Record one invoice for ${plural(group.tasks.length, "clean")}`} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
      </>}
    </Sheet>
  );
}

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
  const [work, setWork] = useState<Operation[]>([]), [budget, setBudget] = useState<BudgetItem[]>([]), [rates, setRates] = useState<ReadonlyMap<string, number>>(new Map());
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [group, setGroup] = useState<CleanerGroup | null>(null), [editing, setEditing] = useState<BudgetItem | null>(null), [adding, setAdding] = useState(false);
  const canBudget = ["admin", "super_admin"].includes(account.role) || (account.role === "accounts" && account.modules.includes("purchase-order-accounts"));
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [o, b, r] = await Promise.allSettled([readOperations(), readTeams({ section: "budgetChart" }), readTeams({ section: "cleanerRates" })]);
    if (o.status === "fulfilled") setWork(z.array(operationViewSchema).parse(o.value.data)); else setError(message(o.reason));
    if (b.status === "fulfilled") setBudget(budgetChartSchema.parse(b.value.data));
    if (r.status === "fulfilled") setRates(new Map(cleanerRatesSchema.parse(r.value.data).map(x => [x.cleanerId, x.rateMinor])));
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const nameOf = useCallback((id: string) => properties.find(x => x.id === id)?.name ?? "Property", [properties]);
  const purchases = work.filter(w => w.kind === "purchase" && typeof w.data.phase === "string" && w.data.phase in PURCHASE_STAGE && !["completed", "cancelled"].includes(w.status));
  const groups = useMemo(() => cleanerInvoiceGroups(work, nameOf, rates), [work, nameOf, rates]);
  return (
    <View style={{ gap: 20 }}>
      {loading && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Section title="Purchases" count={purchases.length} p={p}>
        <List p={p} empty="No purchase requests waiting on Accounts.">
          {purchases.map((w, i) => <Row key={w.workId} p={p} first={i === 0} icon="shopping-bag" tone="accounts" title={nameOf(w.propertyId)}
            detail={[typeof w.data.requirements === "string" ? w.data.requirements : "Purchase", typeof w.data.budgetMinor === "number" ? "Budget " + formatMoney(w.data.budgetMinor) : ""].filter(Boolean).join(" · ")}
            tags={[[PURCHASE_STAGE[String(w.data.phase)], "wait"]]} onPress={() => onOpenWork(w)} />)}
        </List>
      </Section>
      <Section title="Cleaner invoices" count={groups.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Accepted cleans waiting to be invoiced, by cleaner. Put several on one invoice.</Text>
        <List p={p} empty="No accepted cleans waiting to be invoiced.">
          {groups.map((g, i) => <Row key={g.cleanerId} p={p} first={i === 0} icon="user" tone="cleans" title={g.cleanerName}
            detail={`${plural(g.tasks.length, "clean")} · ${g.tasks.slice(0, 3).map(t => t.propertyName).join(", ")}${g.tasks.length > 3 ? "…" : ""}`} amount={g.amountMinor != null ? formatMoney(g.amountMinor) : undefined} onPress={() => setGroup(g)} />)}
        </List>
      </Section>
      <Section title="Budget chart" count={budget.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>The most each item should cost. Purchases are approved against it.</Text>
        <List p={p} empty="Nothing in the budget chart yet.">
          {budget.map((b, i) => <Row key={b.id} p={p} first={i === 0} icon="tag" tone="accounts" title={b.item} detail={b.note || "Up to this much each"} amount={formatMoney(b.maxUnitMinor)} onPress={canBudget ? () => setEditing(b) : undefined} />)}
        </List>
        {canBudget && <Button label="Add an item" icon="plus" p={p} onPress={() => setAdding(true)} />}
      </Section>
      <CleanerInvoiceSheet p={p} group={group} onClose={() => setGroup(null)} onDone={saved(async () => { setGroup(null); await load(); })} />
      <BudgetSheet key={(editing?.id ?? "new") + String(adding)} p={p} item={editing} visible={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} onDone={saved(async () => { setAdding(false); setEditing(null); await load(); })} />
    </View>
  );
}
