import { useState } from "react";
import { Platform, View } from "react-native";
import { Button, message, Notice } from "./LiveKit";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { exportReport } from "./exportReport";
import { downloadReport } from "../../lib/download-report";
import { payoutExampleCsv, statementCsv, statementDocument, statementFileName } from "../../lib/accounts-files";
import { PAYOUT_CHANNEL_LABEL, RECONCILED_CHANNELS, type PayoutChannel } from "../../lib/payout-report-formats";
import type { Statement } from "../../lib/accounts-live";

// Statement and payout files, made on the device from what is already on screen.
// A page opens in a new browser tab on the web (to read, print or save as a PDF) and goes to the
// share sheet in the phone app; spreadsheets download or share.
const HTML = { mime: "text/html", uti: "public.html" };
async function openPage(html: string, fileName: string) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const opened = window.open(url, "_blank");
    // If the browser blocked the new tab, save the page instead.
    if (opened) opened.opener = null; else downloadReport(html, fileName, "text/html;charset=utf-8");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return opened ? "Opened in a new tab. Print it or save it as a PDF from there." : "Saved. Open it to read, print or save as a PDF.";
  }
  await exportReport(html, fileName, HTML);
  return "Ready to open, save or share.";
}

export function StatementFiles({ p, statement, audience }: { p: Palette; statement: Statement; audience: "owner" | "accounts" }) {
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  async function run(kind: "page" | "csv") {
    if (busy) return;
    setBusy(true); setNote("");
    try {
      if (kind === "page") setNote(await openPage(statementDocument(statement, audience), statementFileName(statement.propertyName, statement.period, "html")));
      else { await exportReport(statementCsv(statement), statementFileName(statement.propertyName, statement.period, "csv")); setNote(Platform.OS === "web" ? "Spreadsheet downloaded." : "Spreadsheet ready to save or share."); }
    } catch (e) { setNote(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label="Printable statement" icon="printer" p={p} disabled={busy} onPress={() => void run("page")} />
        <Button label="Download CSV" icon="download" p={p} disabled={busy} onPress={() => void run("csv")} />
      </View>
      {!!note && <Notice text={note} p={p} />}
    </View>
  );
}

// Example payout reports, in exactly the layout the upload reads, for this month.
export function PayoutExamples({ p, period }: { p: Palette; period: string }) {
  const [note, setNote] = useState("");
  async function save(channel: PayoutChannel) {
    setNote("");
    try { const file = payoutExampleCsv(channel, period); await exportReport(file.csv, file.fileName); setNote(Platform.OS === "web" ? "Example downloaded. Its codes are made up, so uploading it matches no stays." : "Example ready to save or share."); }
    catch (e) { setNote(message(e)); }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {RECONCILED_CHANNELS.map(channel => <Button key={channel} label={`Example ${PAYOUT_CHANNEL_LABEL[channel]} file`} icon="file-text" p={p} onPress={() => void save(channel)} />)}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>Each example shows the columns we expect. The Vrbo one is our best guess at its layout, because we have not seen a real Vrbo file yet.</Text>
      {!!note && <Notice text={note} p={p} />}
    </View>
  );
}
