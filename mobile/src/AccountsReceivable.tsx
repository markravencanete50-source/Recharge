import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, Section, StatGrid, StatTile, useRequestId } from "./LiveKit";
import { PropertySelect, SearchPicker } from "./SearchPicker";
import { DateField } from "./CalendarPicker";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { List, Row } from "./AccountsPayable";
import { readFinance, writeTeams } from "./backend/client";
import { formatMoney, plural } from "../../lib/format";
import { isFinanceRole } from "../../lib/accounts-live";
import { poundsToMinor } from "../../lib/repairs-live";
import type { TrackerItem } from "../../lib/tracker";
import {
  EDIT_INVOICE, invoiceAction, invoiceFromStay, MARK_SENT, paymentMove, receivableForms, receivableReportSchema, receivableTrackerItems, RECORD_PAYMENT,
  type InvoiceValues, type NeedsInvoice, type ReceivableItem, type ReceivableReport,
} from "../../lib/tracker-receivable";
import type { TeamsAction } from "../../lib/workspace-teams-policy";
import type { WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// The Receivable tab of Live Accounts: invoices to send, invoices sent and waiting to be paid, and
// direct bookings that still need an invoice. Invoices are the hub's invoice rows (Record invoice saves
// one, Mark sent and Record payment move it), read through the 'receivable' finance report.
type InvoiceForm = { values: InvoiceValues; edit?: { id: string; version: number } };
const EMPTY: InvoiceValues = { title: "", amount: "", reference: "", dueOn: "", propertyId: "", reservationId: "", clientId: "" };
const stayLabel = (s: ReceivableReport["options"]["stays"][number]) => [s.propertyName, s.stayReference, `${s.checkIn} to ${s.checkOut}`].filter(Boolean).join(" · ");

function InvoiceSheet({ p, form, report, properties, onClose, onDone }: { p: Palette; form: InvoiceForm | null; report: ReceivableReport | null; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [v, setV] = useState<InvoiceValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(form ? JSON.stringify([form.edit?.id ?? "new", v]) : null);
  useEffect(() => { queueMicrotask(() => { setV(form?.values ?? EMPTY); setError(""); }); }, [form]);
  const set = (key: keyof InvoiceValues) => (value: string) => setV(prev => ({ ...prev, [key]: value }));
  // The recent stays, plus any suggested direct booking that falls outside that window.
  const stays = useMemo(() => {
    const listed = report?.options.stays ?? [], known = new Set(listed.map(s => s.reservationId));
    const extra = (report?.needsInvoice ?? []).filter(s => !known.has(s.reservationId)).map(s => ({ reservationId: s.reservationId, propertyId: s.propertyId, propertyName: s.propertyName, stayReference: s.stayReference, channel: "direct", checkIn: s.checkIn, checkOut: s.checkOut, invoiced: false }));
    return [...listed, ...extra];
  }, [report]);
  const stayOptions = useMemo(() => stays.map(s => ({ id: s.reservationId, label: stayLabel(s) + (s.invoiced ? " · invoiced" : ""), keywords: s.channel })), [stays]);
  const stay = stays.find(s => s.reservationId === v.reservationId);
  const property = stay?.propertyId ?? v.propertyId;
  const clients = (report?.options.clients ?? []).filter(c => !property || c.propertyIds.includes(property));
  function chooseStay(id: string) { const next = stays.find(s => s.reservationId === id); setV(prev => ({ ...prev, reservationId: id, propertyId: next?.propertyId ?? (id ? prev.propertyId : ""), clientId: "" })); }
  async function save() {
    if (busy) return;
    const built = invoiceAction(v, form?.edit);
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try { await writeTeams({ ...built.action, requestId: request.get() } as TeamsAction); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!form} onClose={onClose} title={form?.edit ? "Edit invoice" : "Record invoice"} subtitle="For a guest stay or a client. It starts as an invoice to send." icon="coins">
      <Field label="What it is for" value={v.title} onChange={set("title")} p={p} placeholder="Direct stay, 4 Leith Walk" />
      <Field label="Amount" value={v.amount} onChange={set("amount")} p={p} placeholder="£0.00" />
      <Field label="Invoice number (optional)" value={v.reference} onChange={set("reference")} p={p} />
      <DateField p={p} label="Send by (optional)" mode="single" value={{ from: v.dueOn, to: v.dueOn }} onChange={d => set("dueOn")(d.from)} wholeMonthLink={false} empty="No date" clearable />
      <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Guest stay (optional)</Text>
        <SearchPicker p={p} options={stayOptions} value={v.reservationId} onChange={chooseStay} clearable placeholder="Search stays by property, code or date" nouns="stays" empty="No recent stays to choose from." />
      </View>
      {!v.reservationId && <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property (optional)</Text>
        <PropertySelect p={p} properties={properties} value={v.propertyId} onChange={id => setV(prev => ({ ...prev, propertyId: id, clientId: "" }))} clearable />
      </View>}
      <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Client (optional)</Text>
        <SearchPicker p={p} options={clients.map(c => ({ id: c.clientId, label: c.name }))} value={v.clientId} onChange={set("clientId")} clearable placeholder="Search clients" nouns="clients"
          empty={property ? "No client is linked to this property." : "No clients yet."} />
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : form?.edit ? "Save changes" : "Record invoice"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

function PaymentSheet({ p, item, onClose, onDone }: { p: Palette; item: ReceivableItem | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(item ? ["pay", item.itemId, item.version, amount, note].join(":") : null);
  useEffect(() => { queueMicrotask(() => { setAmount(item && item.outstandingMinor > 0 ? (item.outstandingMinor / 100).toFixed(2) : ""); setNote(""); setError(""); }); }, [item]);
  async function save() {
    if (!item || busy) return;
    const paid = poundsToMinor(amount);
    const move = paymentMove(item, paid ?? 0);
    if ("error" in move) { setError(move.error); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "moveHubItem", requestId: request.get(), id: item.itemId, version: item.version, status: move.status, settledMinor: move.settledMinor, ...(note.trim() ? { note: note.trim() } : {}) });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!item} onClose={onClose} title="Record payment" subtitle={item ? `${formatMoney(item.outstandingMinor)} still owed${item.clientName ? " by " + item.clientName : ""}` : undefined} icon="coins">
      <Field label="Amount received" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
      <Field label="Note (optional)" value={note} onChange={setNote} p={p} />
      <Text style={[ui.small, { color: p.muted }]}>Paying the full amount settles the invoice. A smaller payment leaves it open with what is still owed.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Record payment"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

export function AccountsReceivable({ p, account, properties }: { p: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const [report, setReport] = useState<ReceivableReport | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm | null>(null);
  const [paying, setPaying] = useState<ReceivableItem | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useRef(new Map<string, string>());
  const allowed = isFinanceRole(account.role);

  const load = useCallback(async () => {
    try { setReport(receivableReportSchema.parse((await readFinance({ section: "receivable" })).data)); setNow(new Date()); setError(""); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  const toSend = useMemo(() => receivableTrackerItems(report?.toSend ?? [], { now }), [report, now]);
  const toSettle = useMemo(() => receivableTrackerItems(report?.toSettle ?? [], { now }), [report, now]);
  const open = [...toSend, ...toSettle].find(i => i.id === openId) as TrackerItem<ReceivableItem> | undefined;
  const totals = report?.totals;

  async function markSent(item: ReceivableItem) {
    if (busy) return;
    const key = "sent:" + item.itemId + ":" + item.version;
    if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID());
    setBusy(true); setError("");
    try { await writeTeams({ action: "moveHubItem", requestId: ids.current.get(key)!, id: item.itemId, version: item.version, status: "sent" }); ids.current.delete(key); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function onForm(item: TrackerItem<ReceivableItem> | undefined, f: WorkflowForm) {
    const row = item?.source;
    if (!row) return;
    if (f.key === MARK_SENT) void markSent(row);
    else if (f.key === RECORD_PAYMENT) setPaying(row);
    else if (f.key === EDIT_INVOICE) setForm({ edit: { id: row.itemId, version: row.version }, values: {
      title: row.title, amount: row.amountMinor !== null ? (row.amountMinor / 100).toFixed(2) : "", reference: row.reference, dueOn: row.dueOn ?? "", propertyId: row.propertyId ?? "",
      reservationId: row.reservationId ?? "", clientId: row.clientId ?? "", details: row.details, link: row.link } });
  }
  const suggest = (s: NeedsInvoice) => setForm({ values: invoiceFromStay(s) });

  if (!allowed) return <Notice text="Receivable is for Accounts and management." p={p} />;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Receivable</Text>
        <Text style={[ui.small, { color: p.muted }]}>Invoices to send and invoices waiting to be paid, for a guest stay or a client. Direct bookings that still need an invoice are listed at the end.</Text>
      </View>
      <Button label="Record invoice" icon="plus" primary p={p} onPress={() => setForm({ values: EMPTY })} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && !report && <Loading p={p} />}
      {!!report && <>
        <StatGrid showZeros>
          <StatTile p={p} icon="send" tone="accounts" label="To send" value={formatMoney(totals?.toSendMinor ?? 0)} detail={plural(totals?.toSendCount ?? 0, "invoice")} attention={(totals?.toSendCount ?? 0) > 0} />
          <StatTile p={p} icon="clock" tone="accounts" label="To settle" value={formatMoney(totals?.toSettleMinor ?? 0)} detail={`${plural(totals?.toSettleCount ?? 0, "invoice")} waiting for payment`} attention={(totals?.toSettleCount ?? 0) > 0} />
          <StatTile p={p} icon="file-plus" tone="accounts" label="Needs an invoice" value={totals?.needsInvoiceCount ?? 0} detail="Direct bookings" attention={(totals?.needsInvoiceCount ?? 0) > 0} />
        </StatGrid>
        <Section title="To send" count={totals?.toSendCount ?? 0} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>{totals?.toSendCount ? `${formatMoney(totals.toSendMinor)} across ${plural(totals.toSendCount, "invoice")}.` : "Nothing to send."}</Text>
          <TrackerList p={p} items={toSend} onOpen={i => setOpenId(i.id)} empty="No invoices are waiting to be sent." groups={false} />
        </Section>
        <Section title="To settle" count={totals?.toSettleCount ?? 0} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>{totals?.toSettleCount ? `${formatMoney(totals.toSettleMinor)} still owed across ${plural(totals.toSettleCount, "invoice")}.` : "Nothing is waiting for payment."}</Text>
          <TrackerList p={p} items={toSettle} onOpen={i => setOpenId(i.id)} empty="No sent invoices are waiting for payment." groups={false} />
        </Section>
        <Section title="Needs an invoice" count={report.totals.needsInvoiceCount} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Direct bookings, confirmed and checking in from the last 30 days onwards, with no invoice yet. Choose one to record its invoice.</Text>
          <List p={p} empty="">
            {report.needsInvoice.map((s, i) => <Row key={s.reservationId} p={p} first={i === 0} title={s.stayReference || "Direct stay"}
              detail={[s.propertyName, `${s.checkIn} to ${s.checkOut}`, s.guests ? plural(s.guests, "guest") : ""].filter(Boolean).join(" · ")}
              amount={s.totalMinor !== null ? formatMoney(s.totalMinor) : undefined} tags={[["Needs an invoice", "wait"]]} onPress={() => suggest(s)} />)}
          </List>
          {!report.needsInvoice.length && <Notice text="Every direct booking has an invoice." p={p} />}
        </Section>
      </>}
      <TrackerDetailSheet p={p} item={open ?? null} forms={open ? receivableForms(open.source) as unknown as WorkflowForm[] : []} onForm={f => onForm(open, f)} onClose={() => setOpenId(null)} />
      <InvoiceSheet p={p} form={form} report={report} properties={properties} onClose={() => setForm(null)} onDone={load} />
      <PaymentSheet p={p} item={paying} onClose={() => setPaying(null)} onDone={load} />
    </View>
  );
}
