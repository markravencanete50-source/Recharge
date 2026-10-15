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
  approveInvoiceAction, autoOutcomeNote, CLEAN_OUTCOMES, cleanerList, earningsFigures, earningsSchema, historyDay, historyLine, INVOICE_PAPER, invoiceDoc, invoiceFileName, invoiceHtml, lineOutcome,
  longDay, markPaidAction, money, OUTCOME_LABEL, outcomeAction, payEarningsQuery, payInvoiceQuery, payInvoiceSchema, payInvoicesQuery, payInvoicesSchema, payPeriodAction,
  paySettingsQuery, paySettingsSchema, periodLabel, queryInvoiceAction, shortDay, statusOf, toApprove, toPayGroups, type CleanOutcome, type Earnings, type PayInvoice,
  type PayPeriod, type PaySettings, type StatusTone,
} from "../../lib/cleaner-invoices";
import { plural } from "../../lib/format";

// Requests for invoice (migration 20261022000000). The cleaner's pay (Work, Cleans, "Your pay"), a cleaning manager's view
// of their cleaners' requests (with each clean's outcome while a request waits), Accounts' "Requests for invoice to
// approve" and "Requests for invoice to pay" (Work, Accounts; admins also set outcomes there), the pay period sheet, and
// the request itself: the same designed document on screen (InvoicePaper) and as the download (lib/cleaner-invoices.ts
// invoiceHtml, printed or saved as PDF). The paper is always light. Code names keep "invoice"; the words say "request".

const TAG_TONE: Record<StatusTone, "good" | "wait" | "bad" | "plain"> = { wait: "wait", good: "good", paid: "good", bad: "bad" };
const rowTags = (i: PayInvoice): [string, "good" | "wait" | "bad" | "plain"][] => [[statusOf(i).label, TAG_TONE[statusOf(i).tone]]];
const rowDetail = (i: PayInvoice) => [periodLabel(i.periodStart, i.periodEnd, i.periodKind) ?? `Issued ${longDay(i.issueOn)}`, plural(i.lineCount, "clean"),
  i.status === "approved" ? `due ${longDay(i.dueOn)}` : ""].filter(Boolean).join(" · ");

// The request as a page, saved or printed. On the web it opens in a new tab with "Print or save as PDF"; on a phone the
// share sheet saves or opens it (then Print, or Save as PDF).
export async function downloadInvoice(invoice: PayInvoice) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups for Recharge to open the request.");
    page.document.open(); page.document.write(invoiceHtml(invoice, { origin: window.location.origin })); page.document.close();
    return "The request opened in a new tab. Choose Print or save as PDF.";
  }
  await exportReport(invoiceHtml(invoice), invoiceFileName(invoice), { mime: "text/html", uti: "public.html" });
  return "Ready to save or share. Open it and choose Print or save as PDF.";
}

// The request on screen: the same layout as the page. Header band with the logo and REQUEST FOR INVOICE and its number,
// the chip while unpaid (a forest PAID mark once paid), From (Recharge) and To (the cleaner), the key facts, the lines
// (date, property, outcome, rate) with hairlines and a light zebra, the totals bottom right, the terms and the footer.
export function InvoicePaper({ invoice }: { invoice: PayInvoice }) {
  const doc = invoiceDoc(invoice), c = INVOICE_PAPER, tone = c.tone[doc.chip?.tone ?? doc.status.tone];
  // On screen only, never in the download: why the request set an outcome itself ("Auto: no clean form").
  const auto = new Map((invoice.lines ?? []).map(l => [l.workId, autoOutcomeNote(l)]));
  const label = { color: c.muted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 1.4, textTransform: "uppercase" as const };
  const num = { fontVariant: ["tabular-nums" as const] };
  return (
    <View accessibilityLabel={`Request for invoice ${doc.number}, ${doc.status.label}, ${doc.totalLabel} ${doc.total}`} style={{ backgroundColor: c.page, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.rule }}>
      <View style={[ui.between, { backgroundColor: c.band, paddingHorizontal: 20, paddingVertical: 18, gap: 16, borderBottomWidth: 1, borderBottomColor: c.rule, flexWrap: "wrap" }]}>
        <CompanyLogo palette={{ isDark: false } as Palette} variant="light" width={132} />
        <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 15, fontWeight: "600", letterSpacing: 3, textAlign: "right" }}>{doc.heading}</Text>
          <Text style={{ color: c.muted, fontSize: 13, letterSpacing: 0.6, marginTop: 2 }}>{doc.number}</Text>
        </View>
      </View>
      <View style={{ padding: 20, gap: 18 }}>
        {(doc.chip || doc.paidStamp) && <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          {doc.chip && <View style={{ backgroundColor: tone.wash, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ color: tone.ink, fontSize: 12, fontWeight: "600" }}>{doc.chip.label}</Text></View>}
          {doc.paidStamp && <View accessible={false} style={{ marginLeft: "auto", borderWidth: 2, borderColor: c.forest, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, transform: [{ rotate: "-6deg" }], opacity: 0.8 }}>
            <Text style={{ color: c.forest, fontWeight: "600", letterSpacing: 3 }}>PAID</Text>
          </View>}
        </View>}
        <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
          <View style={{ flexGrow: 1, flexBasis: 180, minWidth: 0, gap: 2 }}>
            <Text style={label}>From</Text>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{doc.from.name}</Text>
            {doc.from.lines.map(l => <Text key={l} style={{ color: c.muted, fontSize: 12 }}>{l}</Text>)}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 140, minWidth: 0, gap: 2 }}><Text style={label}>To</Text><Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{doc.to}</Text></View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.rule }}>
          {doc.facts.map(f => <View key={f.label} style={{ flexGrow: 1, flexBasis: 120, paddingVertical: 10, paddingRight: 10, gap: 2 }}><Text style={label}>{f.label}</Text><Text style={{ color: c.ink, fontSize: 13 }}>{f.value}</Text></View>)}
        </View>
        <View>
          <View style={[ui.row, { borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 6, gap: 8 }]}>
            <Text style={[label, { width: 76 }]}>Date</Text><Text style={[label, { flex: 1.2 }]}>Property</Text><Text style={[label, { flex: 1 }]}>Outcome</Text><Text style={[label, { textAlign: "right" }]}>Rate</Text>
          </View>
          {doc.lines.map((l, n) => (
            <View key={l.key} style={[ui.row, { gap: 8, paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: c.rule, backgroundColor: n % 2 ? c.zebra : c.page, alignItems: "flex-start" }]}>
              <Text style={{ width: 76, color: c.ink, fontSize: 13 }}>{l.date}</Text>
              <Text style={{ flex: 1.2, minWidth: 0, color: c.ink, fontSize: 13 }}>{l.property}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: l.outcome === "completed" ? c.muted : c.ink, fontSize: 12, fontWeight: l.outcome === "completed" ? "400" : "600" }}>{l.outcomeLabel}</Text>
                {!!l.outcomeNote && <Text style={{ color: c.muted, fontSize: 11 }}>{l.outcomeNote}</Text>}
                {!!auto.get(l.key) && <Text style={{ color: c.muted, fontSize: 11, fontStyle: "italic" }}>{auto.get(l.key)}</Text>}
              </View>
              <Text style={[{ color: c.ink, fontSize: 13, textAlign: "right" }, num]}>{l.amount}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: "flex-end", minWidth: 240, gap: 6 }}>
          <View style={[ui.between, { borderBottomWidth: 1, borderBottomColor: c.rule, paddingBottom: 6, gap: 16 }]}><Text style={{ color: c.muted, fontSize: 13 }}>{doc.count} clean{doc.count === 1 ? "" : "s"} at full rate</Text><Text style={[{ color: c.muted, fontSize: 13 }, num]}>{doc.fullRate}</Text></View>
          {doc.adjustment && <View style={[ui.between, { borderBottomWidth: 1, borderBottomColor: c.rule, paddingBottom: 6, gap: 16 }]}><Text style={{ color: c.muted, fontSize: 13 }}>Outcome adjustments</Text><Text style={[{ color: c.muted, fontSize: 13 }, num]}>{doc.adjustment}</Text></View>}
          <View style={[ui.between, { alignItems: "baseline", gap: 16 }]}><Text style={{ color: c.ink, fontWeight: "600" }}>{doc.totalLabel}</Text><Text style={[{ color: c.forest, fontSize: 24, fontWeight: "600" }, num]}>{doc.total}</Text></View>
        </View>
        <View style={{ backgroundColor: c.zebra, borderRadius: 10, padding: 14, gap: 4 }}>
          <Text style={label}>Terms</Text>
          <Text style={{ color: c.ink, fontSize: 13 }}>{doc.terms}</Text>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: c.rule, paddingTop: 12, gap: 2 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{doc.thanks}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{doc.footer}</Text>
        </View>
      </View>
    </View>
  );
}

// Each clean's outcome, while the request waits for approval: management and the cleaner's cleaning manager. Every change
// re-totals the request on the server and is kept in its history.
function OutcomeEditor({ p, invoice, onDone }: { p: Palette; invoice: PayInvoice; onDone: (next: PayInvoice) => void }) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const request = useRequestId(`outcome:${invoice.id}:${invoice.version}`);
  async function set(workId: string, outcome: CleanOutcome) {
    if (busy) return;
    setBusy(workId); setError("");
    try { onDone(payInvoiceSchema.parse(await writeTeams(outcomeAction({ requestId: request.get(`${workId}:${outcome}`), invoice, workId, outcome })))); }
    catch (e) { setError(message(e)); } finally { setBusy(null); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Outcome of each clean</Text>
      <Text style={[ui.small, { color: p.muted }]}>Completed pays the full rate, Partially successful half, Unsuccessful nothing. The amount to invoice updates at once. Outcomes marked Auto come from the clean&apos;s flags; once you choose one, it stays yours.</Text>
      {(invoice.lines ?? []).map(l => (
        <View key={l.workId} style={{ gap: 6, opacity: busy && busy !== l.workId ? 0.6 : 1 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{[l.cleanOn ? shortDay(l.cleanOn) : "", l.propertyName].filter(Boolean).join(" · ")} · {money(l.amountMinor)}</Text>
          <Pills p={p} title="Outcome" values={CLEAN_OUTCOMES} value={lineOutcome(l)} label={v => OUTCOME_LABEL[v]} onChange={v => { if (v !== lineOutcome(l)) void set(l.workId, v); }} />
          {!!autoOutcomeNote(l) && <Text style={[ui.small, { color: p.muted }]}>{autoOutcomeNote(l)}</Text>}
        </View>
      ))}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

// What happened to the request, oldest first.
function History({ p, invoice }: { p: Palette; invoice: PayInvoice }) {
  if (!invoice.history?.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>History</Text>
      {invoice.history.map((h, n) => <Text key={n} style={[ui.small, { color: p.muted }]}>{historyDay(h.at)} · {historyLine(h)}</Text>)}
    </View>
  );
}

// One request: read with its lines and history, shown as the paper, with Download. Accounts and admins also decide here;
// management and the cleaning manager set each clean's outcome while it waits.
export function InvoiceSheet({ p, invoiceId, canAct = false, canSetOutcome = false, onClose, onChanged }: { p: Palette; invoiceId: string | null; canAct?: boolean; canSetOutcome?: boolean; onClose: () => void; onChanged?: () => Promise<void> }) {
  const saved = useSaved();
  const [invoice, setInvoice] = useState<PayInvoice | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(async () => {
    if (!invoiceId) return;
    try { setInvoice(payInvoiceSchema.parse((await readTeams(payInvoiceQuery(invoiceId))).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [invoiceId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setInvoice(null); setNote(""); void load(); } }); return () => { active = false; }; }, [load]);
  const download = async () => { if (!invoice) return; try { setNote(await downloadInvoice(invoice)); } catch (e) { setNote(message(e)); } };
  return (
    <Sheet palette={p} visible={!!invoiceId} onClose={onClose} title={invoice ? `Request ${invoice.number}` : "Request for invoice"} subtitle={invoice ? `${invoice.cleanerName} · ${money(invoice.totalMinor)}` : undefined} icon="receipt">
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!invoice && !error && <Loading p={p} rows={3} />}
      {invoice && <>
        {invoice.queried && !!invoice.queryNote && <Notice text={`Accounts asked: ${invoice.queryNote}`} p={p} />}
        <InvoicePaper invoice={invoice} />
        <Button label="Download (print or save as PDF)" icon="download" p={p} onPress={() => void download()} />
        {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
        {canSetOutcome && invoice.generated && invoice.status === "to_approve" && <OutcomeEditor p={p} invoice={invoice} onDone={next => { setInvoice(next); void onChanged?.(); }} />}
        <History p={p} invoice={invoice} />
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
      {earnings && <Text style={[ui.small, { color: p.muted }]}>You are paid {earnings.periodKind === "monthly" ? "monthly" : "weekly, Monday to Sunday"}. When the {earnings.periodKind === "monthly" ? "month" : "week"} ends we send you one request for invoice for your accepted cleans.</Text>}
      {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
      <List p={p} empty="No requests for invoice yet. The first one is made when your pay period ends.">
        {invoices.map((i, n) => <Row key={i.id} p={p} first={n === 0} icon="file-text" tone="cleans" title={i.number} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
      </List>
      <InvoiceSheet p={p} invoiceId={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// A cleaning manager: their own cleaners' requests, to read and download, and each clean's outcome while a request waits.
export function CleanerRequestsForManager({ p }: { p: Palette }) {
  const [tick, setTick] = useState(0);
  const list = useInvoices(payInvoicesQuery(), tick);
  const [open, setOpen] = useState<string | null>(null);
  const changed = useCallback(async () => { setTick(t => t + 1); }, []);
  return (
    <Section title="Your cleaners' requests for invoice" p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Made at the end of each pay period from accepted cleans. Set each clean&apos;s outcome while a request waits for approval; Accounts approve and pay them.</Text>
      {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
      {!list.data && !list.error && <Loading p={p} rows={2} />}
      {list.data && <List p={p} empty="No requests for invoice for your cleaners yet.">
        {list.data.map((i, n) => <Row key={i.id} p={p} first={n === 0} avatar={i.cleanerName} tone="cleans" title={`${i.cleanerName} · ${i.number}`} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
      </List>}
      <InvoiceSheet p={p} invoiceId={open} canSetOutcome onClose={() => setOpen(null)} onChanged={changed} />
    </Section>
  );
}

// Accounts: requests waiting for approval, then approved requests to pay grouped by when they are due, with the total
// per cleaner and overall. Admins and super admins (management) also set outcomes here.
export function AccountsCleanerPay({ p, canSetOutcome = false }: { p: Palette; canSetOutcome?: boolean }) {
  const [tick, setTick] = useState(0);
  const list = useInvoices(payInvoicesQuery(), tick);
  const [open, setOpen] = useState<string | null>(null);
  const waiting = useMemo(() => toApprove(list.data ?? []), [list.data]);
  const pay = useMemo(() => toPayGroups(list.data ?? [], london(new Date())), [list.data]);
  const changed = useCallback(async () => { setTick(t => t + 1); }, []);
  return (
    <>
      <Section title="Requests for invoice to approve" count={waiting.length} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Made at the end of each cleaner&apos;s pay period from their accepted cleans. Approve each one, or query it with a note to the cleaner.</Text>
        {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
        {!list.data && !list.error && <Loading p={p} rows={2} />}
        {list.data && <List p={p} empty="No requests for invoice are waiting for approval.">
          {waiting.map((i, n) => <Row key={i.id} p={p} first={n === 0} avatar={i.cleanerName} tone="cleans" title={`${i.cleanerName} · ${i.number}`} detail={rowDetail(i)} amount={money(i.totalMinor)} tags={rowTags(i)} onPress={() => setOpen(i.id)} />)}
        </List>}
      </Section>
      <Section title="Requests for invoice to pay" count={pay.count} p={p}>
        {list.data && !pay.count && <Notice text="No approved requests for invoice are waiting to be paid." p={p} />}
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
          <Text style={{ color: p.text, fontWeight: "700" }}>Total to pay · {plural(pay.count, "request")}</Text>
          <Text style={{ color: p.text, fontWeight: "700", fontSize: 18, fontVariant: ["tabular-nums"] }}>{money(pay.totalMinor)}</Text>
        </View>}
      </Section>
      <InvoiceSheet p={p} invoiceId={open} canAct canSetOutcome={canSetOutcome} onClose={() => setOpen(null)} onChanged={changed} />
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
      <Text style={[ui.body, { color: p.text }]}>When this cleaner&apos;s accepted cleans become a request for invoice: at the end of each week (Monday to Sunday) or each calendar month.</Text>
      {!settings && !error && <Loading p={p} rows={1} />}
      {settings && <Pills p={p} values={["weekly", "monthly"] as const} value={period} onChange={setPeriod} label={v => v === "weekly" ? "Weekly" : "Monthly"} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save pay period"} icon="check" primary p={p} disabled={busy || !settings || period === (row?.period ?? "weekly")} onPress={() => void save()} />
    </Sheet>
  );
}
