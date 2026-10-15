import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { Pills } from "./Pills";
import { SearchPicker } from "./SearchPicker";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, Section, useRequestId } from "./LiveKit";
import { List, Row } from "./AccountsPayable";
import { readDocuments, writeDocuments } from "./backend/client";
import { DocumentView, OwnerBillSheet, RechargeInvoicePaper } from "./RechargeInvoice";
import { docDay, docMoney } from "../../lib/recharge-invoice";
import {
  addLine, documentQuery, documentsQuery, emptyForm, filterDocuments, formFromDocument, formMaths, formToAction, formToInvoice, fromMakerDocument, HISTORY_LABEL,
  KIND_LABEL, MAKER_STATUSES, makerDocumentSchema, makerDocumentsSchema, mineQuery, mineSchema, moveLine, recipientsQuery, recipientsSchema, removeLine, SEND_LABEL,
  sendChoices, STATUS_LABEL, statusCounts, withIssueOn, withKind, type MakerDocument, type MakerForm, type MakerStatus, type Recipient, type SendChannel,
} from "../../lib/invoice-maker";
import type { DocKind } from "../../lib/recharge-invoice";

// The invoice maker (migration 20261022100000), for Accounts, admins and super admins: every document by status (Drafts,
// Issued, Paid, Void) with search by recipient or number; the form with its live preview; one document with Issue, Mark
// paid, Void and Send, and its history. And "Documents for you": what Recharge sent the person signed in.

const ROLE_LABEL = (role: string) => role === "client" ? "Owner" : role === "cleans" ? "Cleaner" : "Team";
const rowDetail = (d: MakerDocument) => [KIND_LABEL[d.kind], d.number ? `issued ${docDay(d.issueOn)}` : `draft, ${docDay(d.issueOn)}`,
  d.status === "paid" && d.paidOn ? `paid ${docDay(d.paidOn)}` : d.status === "issued" ? `due ${docDay(d.dueOn)}` : "", d.lastSentAt ? "sent" : ""].filter(Boolean).join(" · ");

export function InvoiceMaker({ p }: { p: Palette }) {
  const [docs, setDocs] = useState<MakerDocument[] | null>(null), [error, setError] = useState("");
  const [status, setStatus] = useState<MakerStatus>("draft"), [query, setQuery] = useState("");
  const [form, setForm] = useState<{ kind: DocKind; editing: MakerDocument | null } | null>(null), [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setDocs(makerDocumentsSchema.parse((await readDocuments(documentsQuery())).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const counts = statusCounts(docs ?? []), shown = filterDocuments(docs ?? [], status, query);
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Invoice maker</Text>
        <Text style={[ui.small, { color: p.muted }]}>Make an invoice (Recharge bills someone) or a request for invoice (Recharge asks someone to invoice us). Save it as a draft, then issue it: issuing locks it and gives it its number.</Text>
      </View>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label="New invoice" icon="plus" primary p={p} onPress={() => setForm({ kind: "invoice", editing: null })} />
        <Button label="New request for invoice" icon="plus" p={p} onPress={() => setForm({ kind: "request", editing: null })} />
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!docs && !error && <Loading p={p} />}
      {docs && <Section title={STATUS_LABEL[status]} count={counts[status]} p={p}>
        <Pills p={p} title="Show" values={MAKER_STATUSES} value={status} onChange={setStatus} label={s => `${STATUS_LABEL[s]} (${counts[s]})`} />
        <Field label="Search by recipient or number" value={query} onChange={setQuery} p={p} placeholder="For example RC-INV or Maria" />
        <List p={p} search={false} empty={query.trim() ? "Nothing matches that search." : `No ${STATUS_LABEL[status].toLowerCase()} yet.`}>
          {shown.map((d, n) => <Row key={d.id} p={p} first={n === 0} icon={d.kind === "request" ? "inbox" : "file-text"} tone="accounts" title={`${d.recipient.name} · ${d.number ?? "Draft"}`}
            detail={rowDetail(d)} amount={docMoney(d.totalMinor, d.currency)} onPress={() => setOpen(d.id)} />)}
        </List>
      </Section>}
      <MakerFormSheet p={p} open={form} onClose={() => setForm(null)} onSaved={async id => { setForm(null); await load(); setOpen(id); }} />
      <MakerDocumentSheet p={p} id={open} onClose={() => setOpen(null)} onChanged={load} onEdit={d => { setOpen(null); setForm({ kind: d.kind, editing: d }); }} />
    </View>
  );
}

// The form: type, recipient, lines (add, remove, reorder), currency, dates, period, note and terms, with the document as it
// will look underneath. Save draft; Issue saves then issues.
function MakerFormSheet({ p, open, onClose, onSaved }: { p: Palette; open: { kind: DocKind; editing: MakerDocument | null } | null; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const today = london(new Date());
  const [f, setF] = useState<MakerForm>(() => emptyForm(today));
  const [people, setPeople] = useState<Recipient[]>([]), [mode, setMode] = useState<"app" | "typed">("app");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(open ? JSON.stringify([open.editing?.id ?? "new", open.editing?.version ?? 0, f]) : null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => { if (!active) return; const next = open.editing ? formFromDocument(open.editing) : emptyForm(today, open.kind); setF(next); setMode(open.editing && !open.editing.recipient.userId ? "typed" : "app"); setError(""); });
    readDocuments(recipientsQuery()).then(r => { if (active) setPeople(recipientsSchema.parse(r.data)); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [open, today]);
  const set = <K extends keyof MakerForm>(key: K) => (value: MakerForm[K]) => setF(prev => ({ ...prev, [key]: value }));
  const setLine = (key: string, field: "description" | "quantity" | "rate") => (value: string) => setF(prev => ({ ...prev, lines: prev.lines.map(l => l.key === key ? { ...l, [field]: value } : l) }));
  const maths = formMaths(f.lines), money = (m: number) => docMoney(m, f.currency);
  const options = useMemo(() => people.map(r => ({ id: r.userId, label: `${r.name} · ${ROLE_LABEL(r.role)}`, keywords: ROLE_LABEL(r.role) })), [people]);
  const chosen = people.find(r => r.userId === f.recipientId);
  function choose(id: string) { const r = people.find(x => x.userId === id); setF(prev => ({ ...prev, recipientId: id, recipientName: r?.name ?? "", recipientEmail: "" })); }
  async function save(issue: boolean) {
    if (busy) return;
    const built = formToAction(mode === "typed" ? { ...f, recipientId: "" } : f, request.get(), open?.editing ? { id: open.editing.id, version: open.editing.version } : undefined);
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      const saved = makerDocumentSchema.parse((await writeDocuments(built.action)).data);
      request.done();
      if (issue) await writeDocuments({ action: "issueDocument", requestId: request.get("issue:" + saved.id + ":" + saved.version), id: saved.id, version: saved.version });
      await onSaved(saved.id);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const label = (text: string) => <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{text}</Text>;
  return (
    <Sheet palette={p} visible={!!open} onClose={onClose} title={open?.editing ? "Edit draft" : f.kind === "request" ? "New request for invoice" : "New invoice"} subtitle="Saved as a draft until you issue it." icon="receipt">
      <View style={{ gap: 8 }}>{label("Type")}<Pills p={p} title="Type" values={["invoice", "request"] as const} value={f.kind} onChange={k => setF(prev => withKind(prev, k))} label={k => KIND_LABEL[k]} /></View>
      <View style={{ gap: 8 }}>
        {label(f.kind === "request" ? "Who should invoice us" : "Who it is for")}
        <Pills p={p} title="Recipient" values={["app", "typed"] as const} value={mode} onChange={setMode} label={m => m === "app" ? "Someone in the app" : "Someone else"} />
        {mode === "app"
          ? <SearchPicker p={p} options={options} value={f.recipientId} onChange={choose} clearable placeholder="Search owners and team" nouns="people" empty="Nobody to choose yet." />
          : <><Field label="Name" value={f.recipientName} onChange={set("recipientName")} p={p} placeholder="Maria Santos" /><Field label="Email (optional)" value={f.recipientEmail} onChange={set("recipientEmail")} p={p} email /></>}
        <Field label="Address (optional)" value={f.recipientAddress} onChange={set("recipientAddress")} p={p} multiline placeholder="One line per row, or separated by commas" />
        {mode === "app" && chosen?.role === "cleans" && <Text style={[ui.small, { color: p.muted }]}>Cleaners use the app on their phone: it is sent to them in the app, never by email.</Text>}
      </View>
      <View style={{ gap: 10 }}>
        {label("Lines")}
        {f.lines.map((l, n) => (
          <View key={l.key} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border }}>
            <Field label={`Line ${n + 1}: description`} value={l.description} onChange={setLine(l.key, "description")} p={p} placeholder="Virtual assistant hours, October" />
            <View style={[ui.row, { gap: 10 }]}>
              <View style={{ flex: 1 }}><Field label="Quantity" value={l.quantity} onChange={setLine(l.key, "quantity")} p={p} placeholder="1" /></View>
              <View style={{ flex: 1 }}><Field label={`Rate (${f.currency === "USD" ? "$" : "£"})`} value={l.rate} onChange={setLine(l.key, "rate")} p={p} placeholder="0.00" /></View>
            </View>
            <View style={[ui.between, { gap: 8, flexWrap: "wrap" }]}>
              <Text style={{ color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{maths.lines[n]?.amountMinor != null ? money(maths.lines[n].amountMinor!) : "Amount: fill in quantity and rate"}</Text>
              <View style={[ui.row, { gap: 6 }]}>
                <Button label="Up" icon="arrow-up" quiet p={p} disabled={n === 0} onPress={() => set("lines")(moveLine(f.lines, l.key, -1))} />
                <Button label="Down" icon="arrow-down" quiet p={p} disabled={n === f.lines.length - 1} onPress={() => set("lines")(moveLine(f.lines, l.key, 1))} />
                <Button label="Remove" icon="trash-2" quiet p={p} onPress={() => set("lines")(removeLine(f.lines, l.key))} />
              </View>
            </View>
          </View>
        ))}
        <Button label="Add a line" icon="plus" p={p} onPress={() => set("lines")(addLine(f.lines))} />
        <View style={[ui.between, { padding: 12, borderRadius: 14, backgroundColor: p.wash }]}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{f.kind === "request" ? "Amount to invoice" : "Total"}</Text>
          <Text style={{ color: p.text, fontWeight: "700", fontSize: 18, fontVariant: ["tabular-nums"] }}>{money(maths.totalMinor)}</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>{label("Currency")}<Pills p={p} title="Currency" values={["GBP", "USD"] as const} value={f.currency} onChange={set("currency")} label={c => c === "GBP" ? "Pounds (£)" : "US dollars ($)"} /></View>
      <DateField p={p} label="Issue date" mode="single" value={{ from: f.issueOn, to: f.issueOn }} onChange={d => setF(prev => withIssueOn(prev, d.from))} wholeMonthLink={false} today={today} />
      <DateField p={p} label="Due date" mode="single" value={{ from: f.dueOn, to: f.dueOn }} onChange={d => set("dueOn")(d.from)} wholeMonthLink={false} today={today} />
      <DateField p={p} label="Period (optional)" value={{ from: f.periodStart, to: f.periodEnd }} onChange={d => setF(prev => ({ ...prev, periodStart: d.from, periodEnd: d.to }))} today={today} empty="No period" clearable />
      <Field label="Note (optional)" value={f.note} onChange={set("note")} p={p} multiline />
      <Field label="Terms" value={f.terms} onChange={v => setF(prev => ({ ...prev, terms: v, termsEdited: true }))} p={p} multiline />
      <View style={{ gap: 8 }}>{label("Preview")}<RechargeInvoicePaper invoice={formToInvoice(mode === "typed" ? { ...f, recipientId: "" } : f)} /></View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label={busy ? "Saving…" : "Save draft"} icon="save" p={p} disabled={busy} onPress={() => void save(false)} />
        <Button label={busy ? "Saving…" : "Issue"} icon="check" primary p={p} disabled={busy} onPress={() => void save(true)} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>Issuing locks the document and gives it its number. After that it can only be marked paid or voided.</Text>
    </Sheet>
  );
}

// One document: the paper, then what can be done to it, who it went to, and its history.
function MakerDocumentSheet({ p, id, onClose, onChanged, onEdit }: { p: Palette; id: string | null; onClose: () => void; onChanged: () => Promise<void>; onEdit: (d: MakerDocument) => void }) {
  const today = london(new Date());
  const [doc, setDoc] = useState<MakerDocument | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(today), [reason, setReason] = useState(""), [voiding, setVoiding] = useState(false), [busy, setBusy] = useState(false);
  const request = useRequestId(doc ? `doc:${doc.id}:${doc.version}` : null);
  const load = useCallback(async () => {
    if (!id) return;
    try { setDoc(makerDocumentSchema.parse((await readDocuments(documentQuery(id))).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [id]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setDoc(null); setNote(""); setVoiding(false); setReason(""); void load(); } }); return () => { active = false; }; }, [load]);
  async function run(kind: string, action: Parameters<typeof writeDocuments>[0]) {
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try { const r = await writeDocuments(action); request.done(kind); if (typeof r?.note === "string") setNote(r.note); await load(); await onChanged(); setVoiding(false); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const send = (channel: SendChannel) => doc && run("send:" + channel, { action: "sendDocument", requestId: request.get("send:" + channel), id: doc.id, channel });
  const choices = doc ? sendChoices(doc) : [];
  return (
    <Sheet palette={p} visible={!!id} onClose={onClose} title={doc ? `${KIND_LABEL[doc.kind]} ${doc.number ?? "(draft)"}` : "Document"} subtitle={doc ? `${doc.recipient.name} · ${docMoney(doc.totalMinor, doc.currency)}` : undefined} icon="receipt">
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!doc && !error && <Loading p={p} rows={3} />}
      {doc && <DocumentView p={p} invoice={fromMakerDocument(doc)} onDownloaded={() => { if (choices.includes("download")) void send("download"); }}>
        {doc.status === "draft" && <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          <Button label="Edit draft" icon="edit-2" p={p} disabled={busy} onPress={() => onEdit(doc)} />
          <Button label={busy ? "Issuing…" : "Issue"} icon="check" primary p={p} disabled={busy} onPress={() => void run("issue", { action: "issueDocument", requestId: request.get("issue"), id: doc.id, version: doc.version })} />
        </View>}
        {doc.status === "issued" && <View style={{ gap: 10 }}>
          <DateField p={p} label="Paid on" mode="single" value={{ from: paidOn, to: paidOn }} onChange={v => setPaidOn(v.from)} wholeMonthLink={false} today={today} />
          <Button label={busy ? "Saving…" : "Mark paid"} icon="check-circle" primary p={p} disabled={busy || !paidOn} onPress={() => void run("paid", { action: "markDocumentPaid", requestId: request.get("paid:" + paidOn), id: doc.id, version: doc.version, paidOn })} />
        </View>}
        {(doc.status === "draft" || doc.status === "issued") && (voiding
          ? <View style={{ gap: 10 }}>
            <Field label="Why is it void?" value={reason} onChange={setReason} p={p} multiline placeholder="For example: raised twice by mistake" />
            <View style={[ui.row, { gap: 10 }]}>
              <Button label="Cancel" p={p} disabled={busy} onPress={() => setVoiding(false)} />
              <Button label={busy ? "Saving…" : "Void it"} icon="slash" p={p} disabled={busy} onPress={() => void run("void", { action: "voidDocument", requestId: request.get("void:" + reason.trim()), id: doc.id, version: doc.version, reason: reason.trim() })} />
            </View>
          </View>
          : <Button label="Void" icon="slash" quiet p={p} onPress={() => setVoiding(true)} />)}
        {choices.length > 0 && <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Send</Text>
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            {choices.filter(c => c !== "download").map(c => <Button key={c} label={SEND_LABEL[c]} icon={c === "email" ? "mail" : "bell"} p={p} disabled={busy} onPress={() => void send(c)} />)}
          </View>
          {doc.recipient.role === "cleans" && <Text style={[ui.small, { color: p.muted }]}>Cleaners are never emailed: they get it in the app on their phone.</Text>}
          {!choices.includes("email") && doc.recipient.role !== "cleans" && <Text style={[ui.small, { color: p.muted }]}>No email address: download it and share it.</Text>}
        </View>}
        {!!note && <Notice text={note} p={p} />}
        {!!doc.sends?.length && <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Sent</Text>
          {doc.sends.map((s, n) => <Text key={n} style={[ui.small, { color: s.status === "failed" ? p.danger : p.muted }]}>{`${SEND_LABEL[s.channel]}: ${s.toEmail ?? s.toName}, ${docDay(s.at)}${s.by ? ` by ${s.by}` : ""}${s.status === "sent" ? "" : ` (${s.status === "failed" ? "not sent" : "sending"})`}`}</Text>)}
        </View>}
        {!!doc.history?.length && <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>History</Text>
          {doc.history.map((h, n) => <Text key={n} style={[ui.small, { color: p.muted }]}>{`${HISTORY_LABEL[h.action] ?? h.action}, ${docDay(h.at)} ${h.at.slice(11, 16)}${h.by ? ` by ${h.by}` : ""}`}</Text>)}
        </View>}
      </DocumentView>}
    </Sheet>
  );
}

// What Recharge sent the person signed in: issued documents from the maker and, for an owner, Recharge's bills to them.
// Shows nothing until there is something.
export function DocumentsForYou({ p }: { p: Palette }) {
  const [mine, setMine] = useState<{ documents: MakerDocument[]; invoices: { id: string; reference: string; issueOn: string; amountMinor: number; currency: string; status: string }[] } | null>(null);
  const [openDoc, setOpenDoc] = useState<MakerDocument | null>(null), [openBill, setOpenBill] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    readDocuments(mineQuery()).then(r => { if (active) setMine(mineSchema.parse(r.data)); }).catch(() => { if (active) setMine(null); });
    return () => { active = false; };
  }, []);
  const open = async (d: MakerDocument) => { try { setOpenDoc(makerDocumentSchema.parse((await readDocuments(documentQuery(d.id))).data)); setError(""); } catch (e) { setError(message(e)); } };
  if (!mine || (!mine.documents.length && !mine.invoices.length)) return null;
  return (
    <Section title="Documents for you" count={mine.documents.length + mine.invoices.length} p={p}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <List p={p} empty="">
        {[...mine.documents.map((d, n) => <Row key={d.id} p={p} first={n === 0} icon={d.kind === "request" ? "inbox" : "file-text"} tone="accounts" title={`${KIND_LABEL[d.kind]} ${d.number ?? ""}`.trim()}
          detail={d.status === "paid" ? `Paid ${d.paidOn ? docDay(d.paidOn) : ""}`.trim() : d.status === "void" ? "Void" : `Due ${docDay(d.dueOn)}`} amount={docMoney(d.totalMinor, d.currency)} onPress={() => void open(d)} />),
        ...mine.invoices.map((i, n) => <Row key={i.id} p={p} first={!mine.documents.length && n === 0} icon="file-text" tone="accounts" title={`Invoice ${i.reference}`}
          detail={i.status === "paid" ? "Paid" : `Issued ${docDay(i.issueOn)}`} amount={docMoney(i.amountMinor, i.currency === "USD" ? "USD" : "GBP")} onPress={() => setOpenBill(i.id)} />)]}
      </List>
      <Sheet palette={p} visible={!!openDoc} onClose={() => setOpenDoc(null)} title={openDoc ? `${KIND_LABEL[openDoc.kind]} ${openDoc.number ?? ""}`.trim() : "Document"} icon="receipt">
        {openDoc && <DocumentView p={p} invoice={fromMakerDocument(openDoc)} />}
      </Sheet>
      <OwnerBillSheet p={p} invoiceId={openBill} onClose={() => setOpenBill(null)} />
    </Section>
  );
}
