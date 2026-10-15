import { useEffect, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Loading, london, message, Notice } from "./LiveKit";
import { readDocuments } from "./backend/client";
import { exportReport } from "./exportReport";
import { fromWorkspaceInvoice, RECHARGE_PAPER, rechargeInvoiceDoc, rechargeInvoiceFileName, rechargeInvoiceHtml, type RechargeInvoice } from "../../lib/recharge-invoice";
import { ownerInvoiceQuery, workspaceInvoiceDocSchema } from "../../lib/invoice-maker";

// Recharge's invoice document on screen (RechargeInvoicePaper) and as the download (lib/recharge-invoice.ts
// rechargeInvoiceHtml, printed or saved as PDF, or shared from the phone). The same look as the cleaner invoice
// (mobile/src/CleanerInvoices.tsx InvoicePaper); the paper is always light.

// On the web the page opens in a new tab with "Print or save as PDF"; on a phone the share sheet saves or opens it.
export async function downloadRechargeInvoice(invoice: RechargeInvoice) {
  const today = london(new Date());
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups for Recharge to open the document.");
    page.document.open(); page.document.write(rechargeInvoiceHtml(invoice, { origin: window.location.origin, today })); page.document.close();
    return "The document opened in a new tab. Choose Print or save as PDF.";
  }
  await exportReport(rechargeInvoiceHtml(invoice, { today }), rechargeInvoiceFileName(invoice), { mime: "text/html", uti: "public.html" });
  return "Ready to save or share. Open it and choose Print or save as PDF.";
}

export function RechargeInvoicePaper({ invoice }: { invoice: RechargeInvoice }) {
  const doc = rechargeInvoiceDoc(invoice, { today: london(new Date()) }), c = RECHARGE_PAPER, tone = c.tone[doc.chip?.tone ?? "good"], stampInk = doc.stamp?.word === "VOID" ? c.danger : c.forest;
  const label = { color: c.muted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 1.4, textTransform: "uppercase" as const };
  const num = { color: c.ink, fontSize: 13, textAlign: "right" as const, fontVariant: ["tabular-nums" as const] };
  const party = (heading: string, who: { name: string; lines: string[] }) => (
    <View key={heading} style={{ flexGrow: 1, flexBasis: 200, minWidth: 0, gap: 2 }}>
      <Text style={label}>{heading}</Text>
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{who.name}</Text>
      {who.lines.map((l, n) => <Text key={n} style={{ color: c.muted, fontSize: 12 }}>{l}</Text>)}
    </View>
  );
  return (
    <View accessibilityLabel={`${doc.title} ${doc.number}, ${doc.chip?.label ?? doc.stamp?.word ?? ""}, ${doc.totalLabel} ${doc.total}`} style={{ backgroundColor: c.page, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.rule }}>
      <View style={[ui.between, { backgroundColor: c.band, paddingHorizontal: 20, paddingVertical: 18, gap: 16, borderBottomWidth: 1, borderBottomColor: c.rule, flexWrap: "wrap" }]}>
        <CompanyLogo palette={{ isDark: false } as Palette} variant="light" width={132} />
        <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: doc.word === "INVOICE" ? 20 : 15, fontWeight: "600", letterSpacing: doc.word === "INVOICE" ? 6 : 3, textAlign: "right" }}>{doc.word}</Text>
          <Text style={{ color: c.muted, fontSize: 13, letterSpacing: 0.6, marginTop: 2 }}>{doc.number}</Text>
        </View>
      </View>
      <View style={{ padding: 20, gap: 18 }}>
        {(doc.chip || doc.stamp) && <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          {doc.chip && <View style={{ backgroundColor: tone.wash, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ color: tone.ink, fontSize: 12, fontWeight: "600" }}>{doc.chip.label}</Text></View>}
          {doc.stamp && <View accessible={false} style={{ marginLeft: "auto", borderWidth: 2, borderColor: stampInk, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, transform: [{ rotate: "-6deg" }], opacity: 0.8, alignItems: "center", maxWidth: 200 }}>
            <Text style={{ color: stampInk, fontWeight: "600", letterSpacing: 3 }}>{doc.stamp.word}</Text>
            {!!doc.stamp.detail && <Text style={{ color: stampInk, fontSize: 10 }}>{doc.stamp.detail}</Text>}
          </View>}
        </View>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>{party("From", doc.from)}{party(doc.to.label, doc.to)}</View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.rule }}>
          {doc.facts.map(f => <View key={f.label} style={{ flexGrow: 1, flexBasis: 120, paddingVertical: 10, paddingRight: 10, gap: 2 }}><Text style={label}>{f.label}</Text><Text style={{ color: c.ink, fontSize: 13 }}>{f.value}</Text></View>)}
        </View>
        <View>
          <View style={[ui.row, { borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 6, gap: 8 }]}>
            <Text style={[label, { flex: 1 }]}>Description</Text>
            {doc.showQuantities && <><Text style={[label, { width: 40, textAlign: "right" }]}>Qty</Text><Text style={[label, { width: 72, textAlign: "right" }]}>Rate</Text></>}
            <Text style={[label, { width: 84, textAlign: "right" }]}>Amount</Text>
          </View>
          {!doc.rows.length && <Text style={{ color: c.muted, fontSize: 13, paddingVertical: 8 }}>{doc.empty}</Text>}
          {doc.rows.map((r, n) => (
            <View key={r.key} style={[ui.row, { gap: 8, paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: c.rule, backgroundColor: n % 2 ? c.zebra : c.page, alignItems: "flex-start" }]}>
              <Text style={{ flex: 1, minWidth: 0, color: c.ink, fontSize: 13 }}>{r.description}</Text>
              {doc.showQuantities && <><Text style={[num, { width: 40 }]}>{r.quantity}</Text><Text style={[num, { width: 72 }]}>{r.rate}</Text></>}
              <Text style={[num, { width: 84 }]}>{r.amount}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: "flex-end", minWidth: 220, gap: 6 }}>
          <View style={[ui.between, { borderBottomWidth: 1, borderBottomColor: c.rule, paddingBottom: 6 }]}><Text style={{ color: c.muted, fontSize: 13 }}>Subtotal</Text><Text style={[num, { color: c.muted }]}>{doc.subtotal}</Text></View>
          {doc.adjustments.map(a => <View key={a.label} style={[ui.between, { borderBottomWidth: 1, borderBottomColor: c.rule, paddingBottom: 6 }]}><Text style={{ color: c.muted, fontSize: 13 }}>{a.label}</Text><Text style={[num, { color: c.muted }]}>{a.value}</Text></View>)}
          <View style={[ui.between, { alignItems: "baseline", gap: 16 }]}><Text style={{ color: c.ink, fontWeight: "600" }}>{doc.totalLabel}</Text><Text style={{ color: c.forest, fontSize: 24, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{doc.total}</Text></View>
        </View>
        {!!doc.note && <View style={{ gap: 2 }}><Text style={label}>Note</Text><Text style={{ color: c.ink, fontSize: 13 }}>{doc.note}</Text></View>}
        {!!doc.terms && <View style={{ gap: 2 }}><Text style={label}>Terms</Text><Text style={{ color: c.ink, fontSize: 13 }}>{doc.terms}</Text></View>}
        {!!doc.payment?.length && <View style={{ gap: 2 }}><Text style={label}>Payment details</Text>{doc.payment.map(d => <Text key={d.label} style={{ color: c.ink, fontSize: 13 }}>{d.label}: {d.value}</Text>)}</View>}
        <View style={{ borderTopWidth: 1, borderTopColor: c.rule, paddingTop: 12, marginTop: 8, gap: 2 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{doc.thanks}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{doc.footer}</Text>
        </View>
      </View>
    </View>
  );
}

// A document with Download under it, and whatever the caller adds (Issue, Mark paid, Send).
export function DocumentView({ p, invoice, children, onDownloaded }: { p: Palette; invoice: RechargeInvoice; children?: ReactNode; onDownloaded?: () => void }) {
  const [note, setNote] = useState("");
  const download = async () => { try { setNote(await downloadRechargeInvoice(invoice)); onDownloaded?.(); } catch (e) { setNote(message(e)); } };
  return (
    <View style={{ gap: 14 }}>
      <RechargeInvoicePaper invoice={invoice} />
      <Button label="Download (print or save as PDF)" icon="download" p={p} onPress={() => void download()} />
      {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
      {children}
    </View>
  );
}

// A document already in hand (a Receivable row), in a sheet.
export function RechargeInvoiceSheet({ p, invoice, onClose }: { p: Palette; invoice: RechargeInvoice | null; onClose: () => void }) {
  const doc = invoice ? rechargeInvoiceDoc(invoice) : null;
  return (
    <Sheet palette={p} visible={!!invoice} onClose={onClose} title={doc ? `${doc.title} ${doc.number}` : "Invoice"} subtitle={doc ? `${doc.to.name} · ${doc.total}` : undefined} icon="receipt">
      {invoice && <DocumentView p={p} invoice={invoice} />}
    </Sheet>
  );
}

// One of Recharge's bills to an owner (public.workspace_invoices), read with the owner's name and the property. The
// database lets in exactly who may see the invoice row.
export function OwnerBillSheet({ p, invoiceId, onClose }: { p: Palette; invoiceId: string | null; onClose: () => void }) {
  const [invoice, setInvoice] = useState<RechargeInvoice | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setInvoice(null); setError(""); } });
    if (invoiceId) readDocuments(ownerInvoiceQuery(invoiceId)).then(r => { if (active) setInvoice(fromWorkspaceInvoice(workspaceInvoiceDocSchema.parse(r.data))); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [invoiceId]);
  const doc = invoice ? rechargeInvoiceDoc(invoice) : null;
  return (
    <Sheet palette={p} visible={!!invoiceId} onClose={onClose} title={doc ? `Invoice ${doc.number}` : "Invoice"} subtitle={doc ? `${doc.to.name} · ${doc.total}` : undefined} icon="receipt">
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!invoice && !error && <Loading p={p} rows={3} />}
      {invoice && <DocumentView p={p} invoice={invoice} />}
    </Sheet>
  );
}
