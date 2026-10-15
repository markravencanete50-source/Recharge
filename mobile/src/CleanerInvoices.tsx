import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { Pills } from "./Pills";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, Section, useRequestId } from "./LiveKit";
import { List, Row } from "./AccountsPayable";
import { readTeams, writeTeams } from "./backend/client";
import { exportReport } from "./exportReport";
import {
  approveInvoiceAction, cleanerList, earningsFigures, earningsSchema, INVOICE_PAPER, invoiceDoc, invoiceFileName, invoiceHtml, longDay, markPaidAction, money,
  payEarningsQuery, payInvoiceQuery, payInvoiceSchema, payInvoicesQuery, payInvoicesSchema, payPeriodAction, paySettingsQuery, paySettingsSchema, periodLabel,
  queryInvoiceAction, statusOf, toApprove, toPayGroups, type Earnings, type PayInvoice, type PayPeriod, type PaySettings, type StatusTone,
} from "../../lib/cleaner-invoices";
import { plural } from "../../lib/format";

// Cleaner invoices (migration 20261022000000). The cleaner's pay (Work, Cleans, "Your pay"), a cleaning manager's view of
// their cleaners' invoices (read only), Accounts' "Cleaner invoices to approve" and "Cleaner invoices to pay" (Work,
// Accounts), the pay period sheet, and the invoice itself: the same designed document on screen (InvoicePaper) and as
// the download (lib/cleaner-invoices.ts invoiceHtml, printed or saved as PDF). The paper is always light.

const TAG_TONE: Record<StatusTone, "good" | "wait" | "bad" | "plain"> = { wait: "wait", good: "good", paid: "good", bad: "bad" };
const rowTags = (i: PayInvoice): [string, "good" | "wait" | "bad" | "plain"][] => [[statusOf(i).label, TAG_TONE[statusOf(i).tone]]];
const rowDetail = (i: PayInvoice) => [periodLabel(i.periodStart, i.periodEnd, i.periodKind) ?? `Issued ${longDay(i.issueOn)}`, plural(i.lineCount, "clean"),
  i.status === "approved" ? `due ${longDay(i.dueOn)}` : ""].filter(Boolean).join(" · ");

// The invoice as a page, saved or printed. On the web it opens in a new tab with "Print or save as PDF"; on a phone the
// share sheet saves or opens it (then Print, or Save as PDF).
export async function downloadInvoice(invoice: PayInvoice) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups for Recharge to open the invoice.");
    page.document.open(); page.document.write(invoiceHtml(invoice, { origin: window.location.origin })); page.document.close();
    return "The invoice opened in a new tab. Choose Print or save as PDF.";
  }
  await exportReport(invoiceHtml(invoice), invoiceFileName(invoice), { mime: "text/html", uti: "public.html" });
  return "Ready to save or share. Open it and choose Print or save as PDF.";
}

// The invoice on screen: the same layout as the page. Header band with the logo and INVOICE and its number, the status
// pill (and a forest PAID mark once paid), From and Billed to, the key facts, the lines with hairlines and a light zebra,
// the totals bottom right, and the thank-you footer.
export function InvoicePaper({ invoice }: { invoice: PayInvoice }) {
  const doc = invoiceDoc(invoice), c = INVOICE_PAPER, tone = c.tone[doc.status.tone];
  const label = { color: c.muted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 1.4, textTransform: "uppercase" as const };
  return (
    <View accessibilityLabel={`Invoice ${doc.number}, ${doc.status.label}, ${doc.totalLabel} ${doc.total}`} style={{ backgroundColor: c.page, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.rule }}>
      <View style={[ui.between, { backgroundColor: c.band, paddingHorizontal: 20, paddingVertical: 18, gap: 16, borderBottomWidth: 1, borderBottomColor: c.rule, flexWrap: "wrap" }]}>
        <CompanyLogo palette={{ isDark: false } as Palette} variant="light" width={132} />
        <View style={{ alignItems: "flex-end" }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 20, fontWeight: "600", letterSpacing: 6 }}>INVOICE</Text>
          <Text style={{ color: c.muted, fontSize: 13, letterSpacing: 0.6, marginTop: 2 }}>{doc.number}</Text>
        </View>
      </View>
      <View style={{ padding: 20, gap: 18 }}>
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          <View style={{ backgroundColor: tone.wash, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ color: tone.ink, fontSize: 12, fontWeight: "600" }}>{doc.status.label}</Text></View>
          <Text style={{ color: c.muted, fontSize: 12 }}>Status: {doc.status.line}</Text>
          {doc.paidStamp && <View accessible={false} style={{ marginLeft: "auto", borderWidth: 2, borderColor: c.forest, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, transform: [{ rotate: "-6deg" }], opacity: 0.8 }}>
            <Text style={{ color: c.forest, fontWeight: "600", letterSpacing: 3 }}>PAID</Text>
          </View>}
        </View>
        <View style={{ flexDirection: "row", gap: 16 }}>
          {[["From", doc.from], ["Billed to", doc.billedTo]].map(([k, v]) => <View key={k} style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={label}>{k}</Text><Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{v}</Text></View>)}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.rule }}>
          {doc.facts.map(f => <View key={f.label} style={{ flexGrow: 1, flexBasis: 120, paddingVertical: 10, paddingRight: 10, gap: 2 }}><Text style={label}>{f.label}</Text><Text style={{ color: c.ink, fontSize: 13 }}>{f.value}</Text></View>)}
        </View>
        <View>
          <View style={[ui.row, { borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 6, gap: 8 }]}>
            <Text style={[label, { width: 84 }]}>Date</Text><Text style={[label, { flex: 1 }]}>Property</Text><Text style={[label, { textAlign: "right" }]}>Rate</Text>
          </View>
          {doc.lines.map((l, n) => (
            <View key={l.key} style={[ui.row, { gap: 8, paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: c.rule, backgroundColor: n % 2 ? c.zebra : c.page, alignItems: "flex-start" }]}>
              <Text style={{ width: 84, color: c.ink, fontSize: 13 }}>{l.date}</Text>
              <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: c.ink, fontSize: 13 }}>{l.property}</Text>{!!l.times && <Text style={{ color: c.muted, fontSize: 12 }}>{l.times}</Text>}</View>
              <Text style={{ color: c.ink, fontSize: 13, textAlign: "right", fontVariant: ["tabular-nums"] }}>{l.amount}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: "flex-end", minWidth: 220, gap: 6 }}>
          <View style={[ui.between, { borderBottomWidth: 1, borderBottomColor: c.rule, paddingBottom: 6 }]}><Text style={{ color: c.muted, fontSize: 13 }}>Subtotal</Text><Text style={{ color: c.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>{doc.subtotal}</Text></View>
          <View style={[ui.between, { alignItems: "baseline", gap: 16 }]}><Text style={{ color: c.ink, fontWeight: "600" }}>{doc.totalLabel}</Text><Text style={{ color: c.forest, fontSize: 24, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{doc.total}</Text></View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: c.rule, paddingTop: 12, marginTop: 8, gap: 2 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{doc.thanks}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{doc.footer}</Text>
        </View>
      </View>
    </View>
  );
}

// One invoice: read with its lines, shown as the paper, with Download; Accounts and admins also decide here.
export function InvoiceSheet({ p, invoiceId, canAct = false, onClose, onChanged }: { p: Palette; invoiceId: string | null; canAct?: boolean; onClose: () => void; onChanged?: () => Promise<void> }) {
  const saved = useSaved();
  const [invoice, setInvoice] = useState<PayInvoice | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(async () => {
    if (!invoiceId) return;
    try { setInvoice(payInvoiceSchema.parse((await readTeams(payInvoiceQuery(invoiceId))).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [invoiceId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setInvoice(null); setNote(""); void load(); } }); return () => { active = false; }; }, [load]);
  const download = async () => { if (!invoice) return; try { setNote(await downloadInvoice(invoice)); } catch (e) { setNote(message(e)); } };
  return (
    <Sheet palette={p} visible={!!invoiceId} onClose={onClose} title={invoice ? `Invoice ${invoice.number}` : "Invoice"} subtitle={invoice ? `${invoice.cleanerName} · ${money(invoice.totalMinor)}` : undefined} icon="receipt">
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!invoice && !error && <Loading p={p} rows={3} />}
      {invoice && <>
        {invoice.queried && !!invoice.queryNote && <Notice text={`Accounts asked: ${invoice.queryNote}`} p={p} />}
        <InvoicePaper invoice={invoice} />
        <Button label="Download (print or save as PDF)" icon="download" p={p} onPress={() => void download()} />
        {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
        {canAct && <InvoiceDecision p={p} invoice={invoice} onDone={saved(async () => { await load(); await onChanged?.(); })} />}
      </>}
    </Sheet>
  );
}

// Approve, or Query with a note back to the cleaner, while it waits; Mark paid with the paid date once approved.
function InvoiceDecision({ p, invoice, onDone }: { p: Palette; invoice: PayInvoice; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [querying, setQuerying] = useState(false), [note, setNote] = useState(""), [paidOn, setPaidOn] = useState(today), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(`pay:${invoice.id}:${invoice.version}`);
  async function send(kind: "approve" | "query" | "paid") {
    if (busy) return;
    if (kind === "query" && note.trim().length < 5) { setError("Write the question for the cleaner (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      const requestId = request.get(kind + (kind === "query" ? ":" + note.trim() : kind === "paid" ? ":" + paidOn : ""));
      await writeTeams(kind === "approve" ? approveInvoiceAction({ requestId, invoice }) : kind === "query" ? queryInvoiceAction({ requestId, invoice, note }) : markPaidAction({ requestId, invoice, paidOn }));
      setQuerying(false); setNote(""); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (invoice.status === "to_approve") return (
    <View style={{ gap: 12 }}>
      {querying && <Field label="Your question for the cleaner" value={note} onChange={setNote} p={p} multiline placeholder="For example: was the Hawk clean a deep clean?" />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {querying
          ? <><Button label="Cancel" p={p} disabled={busy} onPress={() => { setQuerying(false); setError(""); }} /><Button label={busy ? "Sending…" : "Send query"} icon="message-circle" primary p={p} disabled={busy} onPress={() => void send("query")} /></>
          : <><Button label={busy ? "Approving…" : "Approve"} icon="check" primary p={p} disabled={busy} onPress={() => void send("approve")} /><Button label="Query" icon="help-circle" p={p} disabled={busy} onPress={() => { setQuerying(true); setError(""); }} /></>}
      </View>
    </View>
  );
  if (invoice.status === "approved") return (
    <View style={{ gap: 12 }}>
      <DateField p={p} label="Paid on" mode="single" value={{ from: paidOn, to: paidOn }} onChange={v => setPaidOn(v.from)} wholeMonthLink={false} today={today} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Mark paid"} icon="check-circle" primary p={p} disabled={busy || !paidOn} onPress={() => void send("paid")} />
      <Text style={[ui.small, { color: p.muted }]}>Recording the payment is enough here: the bank is not connected.</Text>
    </View>
  );
  return null;
}

function useInvoices(query: Record<string, string> | null, tick = 0) {
  const [state, setState] = useState<{ data: PayInvoice[] | null; error: string }>({ data: null, error: "" });
  const key = JSON.stringify(query);
  const load = useCallback(async () => {
    if (!key || key === "null") return;
    try { setState({ data: payInvoicesSchema.parse((await readTeams(JSON.parse(key) as Record<string, string>)).data), error: "" }); }
    catch (e) { setState(s => ({ ...s, error: message(e) })); }
  }, [key]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, tick]);
  return { ...state, reload: load };
}

function Figure({ p, label, value, detail }: { p: Palette; label: string; value: string; detail: string }) {
  return (
    <View accessibilityLabel={`${label}: ${value}. ${detail}`} style={{ flexGrow: 1, flexBasis: 200, padding: 14, borderRadius: 16, backgroundColor: p.wash, gap: 4 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{label}</Text>
      <Text style={{ color: p.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
    </View>
  );
}

// The cleaner's pay: Earnings (paid this month and this year), Waiting to be paid, Projected, and their invoices.
export function CleanerPay({ p, tick = 0 }: { p: Palette; tick?: number }) {
  const [earnings, setEarnings] = useState<Earnings | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<string | null>(null);
  const list = useInvoices(payInvoicesQuery(), tick);
  useEffect(() => {
    let active = true;
    readTeams(payEarningsQuery()).then(r => { if (active) { setEarnings(earningsSchema.parse(r.data)); setError(""); } }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [tick]);
  const f = earnings ? earningsFigures(earnings) : null;
  const invoices = cleanerList(list.data ?? []);
  return (
    <Section title="Your pay" p={p}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!f && !error && <Loading p={p} rows={1} />}
      {f && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Figure p={p} {...f.earnings} />
        <Figure p={p} {...f.waiting} />
        <Figure p={p} {...f.projected} />
      </View>}
      {earnings && <Text style={[ui.small, { color: p.muted }]}>You are paid {earnings.periodKind === "monthly" ? "monthly" : "weekly, Monday to Sunday"}. Your accepted cleans go on one invoice when the {earnings.periodKind === "monthly" ? "month" : "week"} ends.</Text>}
      {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
      <List p={p} empty="No invoices yet. The first one is made when your pay period ends.">
        {invoices.map((i, n) => <Row key={i.id} p={p} first={n === 0} icon="file-text" tone="cleans" title={i.number} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
      </List>
      <InvoiceSheet p={p} invoiceId={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// A cleaning manager: their own cleaners' invoices, to read and download only.
export function CleanerInvoicesReadOnly({ p }: { p: Palette }) {
  const list = useInvoices(payInvoicesQuery());
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="Your cleaners' invoices" p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Made at the end of each pay period from accepted cleans. Accounts approve and pay them.</Text>
      {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
      {!list.data && !list.error && <Loading p={p} rows={2} />}
      {list.data && <List p={p} empty="No invoices for your cleaners yet.">
        {list.data.map((i, n) => <Row key={i.id} p={p} first={n === 0} avatar={i.cleanerName} tone="cleans" title={`${i.cleanerName} · ${i.number}`} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
      </List>}
      <InvoiceSheet p={p} invoiceId={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// Accounts: invoices waiting for approval, then approved invoices to pay grouped by when they are due, with the total
// per cleaner and overall.
export function AccountsCleanerPay({ p }: { p: Palette }) {
  const [tick, setTick] = useState(0);
  const list = useInvoices(payInvoicesQuery(), tick);
  const [open, setOpen] = useState<string | null>(null);
  const waiting = useMemo(() => toApprove(list.data ?? []), [list.data]);
  const pay = useMemo(() => toPayGroups(list.data ?? [], london(new Date())), [list.data]);
  const changed = useCallback(async () => { setTick(t => t + 1); }, []);
  return (
    <>
      <Section title="Cleaner invoices to approve" count={waiting.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Made at the end of each cleaner&apos;s pay period from their accepted cleans. Approve each one, or query it with a note to the cleaner.</Text>
        {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
        {!list.data && !list.error && <Loading p={p} rows={2} />}
        {list.data && <List p={p} empty="No cleaner invoices are waiting for approval.">
          {waiting.map((i, n) => <Row key={i.id} p={p} first={n === 0} avatar={i.cleanerName} tone="cleans" title={`${i.cleanerName} · ${i.number}`} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
        </List>}
      </Section>
      <Section title="Cleaner invoices to pay" count={pay.count} p={p}>
        {list.data && !pay.count && <Notice text="No approved cleaner invoices are waiting to be paid." p={p} />}
        {pay.groups.map(g => (
          <View key={g.bucket} style={{ gap: 8 }}>
            <View style={[ui.between, { gap: 10 }]}>
              <Text accessibilityRole="header" style={{ color: g.bucket === "overdue" ? p.danger : p.text, fontWeight: "700" }}>{g.label}</Text>
              <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{money(g.totalMinor)}</Text>
            </View>
            <Text style={[ui.small, { color: p.muted }]}>{g.byCleaner.map(c => `${c.name} ${money(c.totalMinor)}`).join(" · ")}</Text>
            <List p={p} empty="">
              {g.invoices.map((i, n) => <Row key={i.id} p={p} first={n === 0} avatar={i.cleanerName} tone="cleans" title={`${i.cleanerName} · ${i.number}`} detail={`Due ${longDay(i.dueOn)} · ${plural(i.lineCount, "clean")}`} amount={money(i.totalMinor)} onPress={() => setOpen(i.id)} />)}
            </List>
          </View>
        ))}
        {pay.count > 0 && <View style={[ui.between, { padding: 14, borderRadius: 14, backgroundColor: p.wash }]}>
          <Text style={{ color: p.text, fontWeight: "700" }}>Total to pay · {plural(pay.count, "invoice")}</Text>
          <Text style={{ color: p.text, fontWeight: "700", fontSize: 18, fontVariant: ["tabular-nums"] }}>{money(pay.totalMinor)}</Text>
        </View>}
      </Section>
      <InvoiceSheet p={p} invoiceId={open} canAct onClose={() => setOpen(null)} onChanged={changed} />
    </>
  );
}

// A cleaner's pay period: weekly (Monday to Sunday, the default) or monthly. Admins and Accounts; every change is kept.
export function PayPeriodSheet({ p, cleaner, onClose, onDone }: { p: Palette; cleaner: { cleanerId: string; fullName: string | null } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [settings, setSettings] = useState<PaySettings | null>(null), [period, setPeriod] = useState<PayPeriod>("weekly"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const row = settings?.cleaners.find(c => c.cleanerId === cleaner?.cleanerId);
  const request = useRequestId(cleaner ? `period:${cleaner.cleanerId}:${row?.periodVersion ?? 0}:${period}` : null);
  useEffect(() => {
    if (!cleaner) return;
    let active = true;
    readTeams(paySettingsQuery()).then(r => { if (!active) return; const s = paySettingsSchema.parse(r.data); setSettings(s); setPeriod(s.cleaners.find(c => c.cleanerId === cleaner.cleanerId)?.period ?? "weekly"); setError(""); })
      .catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [cleaner]);
  async function save() {
    if (!cleaner || busy) return;
    setBusy(true); setError("");
    try { await writeTeams(payPeriodAction({ requestId: request.get(), cleanerId: cleaner.cleanerId, period, version: row?.periodVersion ?? 0 })); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!cleaner} onClose={onClose} title="Pay period" subtitle={cleaner?.fullName ?? undefined} icon="calendar">
      <Text style={[ui.body, { color: p.text }]}>When this cleaner&apos;s accepted cleans become an invoice: at the end of each week (Monday to Sunday) or each calendar month.</Text>
      {!settings && !error && <Loading p={p} rows={1} />}
      {settings && <Pills p={p} values={["weekly", "monthly"] as const} value={period} onChange={setPeriod} label={v => v === "weekly" ? "Weekly" : "Monthly"} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save pay period"} icon="check" primary p={p} disabled={busy || !settings || period === (row?.period ?? "weekly")} onPress={() => void save()} />
    </Sheet>
  );
}
