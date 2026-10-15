import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { space, textSize, ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, Section, StatGrid, StatTile, useRequestId, useWorkFocus, type IconName } from "./LiveKit";
import { formatCount, formatDay, formatMoney, plural } from "../../lib/format";
import { fitsPayoutUpload, MAX_PAYOUT_LINES, readPayoutLines, transferSummary } from "../../lib/payout-reconciliation";
import { isPayoutChannel, PAYOUT_CHANNEL_LABEL, RECONCILED_CHANNELS, type PayoutChannel } from "../../lib/payout-report-formats";
import { readFinance, writeFinance, WorkspaceApiError } from "./backend/client";
import { PayoutExamples } from "./AccountsFiles";
import { PayoutStays } from "./PayoutStays";
import { PayoutLinesSheet, type LinesStay } from "./PayoutLinesSheet";
import { PayoutApproveSheet } from "./PayoutApproveSheet";
import { AccountsPayable, ExpenseSheet, List, NewExpenseSheet, Row, type LimitState, type NoteAsk, type Overview } from "./AccountsPayable";
import { Pills } from "./Pills";
import { AccountsStatements, TermsSheet, type StatementRow } from "./AccountsStatements";
import { AccountsReceivable } from "./AccountsReceivable";
import { InvoiceMaker } from "./InvoiceMaker";
import { AccountsPerformance } from "./AccountsPerformance";
import { AirCoverList } from "./AirCoverList";
import type { SectionProps } from "./SectionProps";
export { ExpenseSheet, Initials, Line, List, Pills, Row, type NoteAsk } from "./AccountsPayable";
import { CHANNEL_LABEL, expensesSchema, isFinanceRole, monthLabel, overviewSchema, payoutImportSchema, policySchema, pounds, reconciliationSchema, shiftMonth, statementsSchema, type Expense, type PayoutImport, type PayoutRow } from "../../lib/accounts-live";
import { poundsToMinor } from "../../lib/repairs-live";
import type { FinanceAction } from "../../lib/workspace-finance-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";
import type { z } from "zod";

// Live Accounts: expenses with evidence, payout reconciliation and owner
// statements, read from and written to the backend. Nothing here uses sample data.
// The Reconciliation tab (its key stays "payouts", which Home tools and deep links use) takes a payout report from each of
// Airbnb, Booking.com and Vrbo and shows, stay by stay, whether the money arrived.
type Reconciliation = z.infer<typeof reconciliationSchema>;
type NeedsDetails = Reconciliation["needsDetails"][number];
type Tab = "expenses" | "payouts" | "statements" | "receivable" | "maker" | "performance" | "aircover";
// The summary tiles' labels on a phone, where three share one row.
const TILE_SHORT: Record<string, string> = { "To approve": "Approve", "To reconcile": "Reconcile", "Statements paid": "Paid" };
const TAB_LABEL: Record<Tab, string> = { expenses: "Expenses", payouts: "Reconciliation", statements: "Statements", receivable: "Receivable", maker: "Invoice maker", performance: "Performance", aircover: "AirCover" };

// What the platform calls its reservation code, as staff will see it on the payout report.
export function platformCode(channel: string): { label: string; placeholder: string } {
  if (channel === "airbnb") return { label: "Airbnb confirmation code", placeholder: "HM…" };
  if (channel === "booking_com") return { label: "Booking.com reservation number", placeholder: "10 digits" };
  return { label: "Vrbo reservation ID", placeholder: "As on the Vrbo payout report" };
}

// One sheet for every action that only needs a short note or reference.
export function NoteSheet({ p, ask, onClose, onDone }: { p: Palette; ask: NoteAsk | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The key follows the whole request, so editing anything after a lost reply starts a new one instead of reusing the old id.
  const preview = ask ? ask.build(note.trim(), ask.amount ? poundsToMinor(amount) : null) : null;
  const request = useRequestId(ask ? ask.title + ":" + JSON.stringify(preview) : null);
  useEffect(() => { queueMicrotask(() => { setNote(""); setError(""); setAmount(ask?.amount?.initial ?? ""); }); }, [ask]);
  async function save() {
    if (!ask || busy) return;
    if (note.trim().length < ask.min) { setError(`Write at least ${ask.min} characters.`); return; }
    const minor = ask.amount ? poundsToMinor(amount) : null;
    if (ask.amount && minor === null) { setError("Enter the amount in pounds, for example 450.00."); return; }
    const action = ask.build(note.trim(), minor);
    if (!action) return;
    setBusy(true); setError("");
    try { await writeFinance({ ...action, requestId: request.get() } as FinanceAction); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!ask} onClose={onClose} title={ask?.title ?? ""} subtitle={ask?.subtitle} icon="coins">
      {ask?.amount && <Field label={ask.amount.label} value={amount} onChange={setAmount} p={p} placeholder="£0.00" />}
      {!!ask?.label && <Field label={ask.label} value={note} onChange={setNote} p={p} multiline={ask.min >= 5} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : ask?.confirm ?? "Save"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Platform, reservation code, guests and expected payout for a stay.
function StaySheet({ p, stay, onClose, onDone }: { p: Palette; stay: (NeedsDetails | PayoutRow) & { propertyName?: string } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [channel, setChannel] = useState<"airbnb" | "booking_com" | "vrbo" | "direct" | "other">("airbnb");
  const [code, setCode] = useState("");
  const [guests, setGuests] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(stay ? ["stay", stay.reservationId, stay.version, channel, code, guests, payout].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!stay) return;
      const row = stay as Partial<PayoutRow>;
      setChannel((["airbnb", "booking_com", "vrbo", "direct", "other"].includes(stay.channel) ? stay.channel : "airbnb") as typeof channel);
      setCode(row.channelReference ?? ""); setGuests(stay.guests ? String(stay.guests) : ""); setPayout(row.expectedMinor != null ? (row.expectedMinor / 100).toFixed(2) : ""); setError("");
    });
  }, [stay]);
  const platform = isPayoutChannel(channel);
  async function save() {
    if (!stay || busy) return;
    const payoutMinor = payout.trim() ? poundsToMinor(payout) : null, guestCount = guests.trim() ? Number(guests) : null;
    if (platform && !code.trim()) { setError("Add the platform reservation code, exactly as it appears on the payout report."); return; }
    if (payout.trim() && payoutMinor === null) { setError("Enter the payout in pounds, for example 460.00."); return; }
    if (!platform && payoutMinor === null) { setError("Add the payout amount for this stay. The owner statement needs it."); return; }
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50)) { setError("Guests must be a number from 1 to 50."); return; }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "setReservationFinancials", requestId: request.get(), propertyId: stay.propertyId, reservationId: stay.reservationId, version: stay.version, channel, ...(code.trim() ? { channelReference: code.trim() } : {}), guests: guestCount, payoutMinor });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!stay} onClose={onClose} title={stay?.reference ?? "Stay"} subtitle={stay ? `${stay.propertyName ? stay.propertyName + " · " : ""}${stay.checkIn} to ${stay.checkOut}` : undefined} icon="calendar">
      <Pills p={p} values={["airbnb", "booking_com", "vrbo", "direct", "other"] as const} value={channel} onChange={setChannel} label={v => CHANNEL_LABEL[v]} />
      {platform && <Field label={platformCode(channel).label} value={code} onChange={setCode} p={p} placeholder={platformCode(channel).placeholder} />}
      <Field label="Guests (optional)" value={guests} onChange={setGuests} p={p} />
      <Field label={platform ? "Expected payout (optional)" : "Payout for this stay"} value={payout} onChange={setPayout} p={p} placeholder="£0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save stay details"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

async function pickCsv(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
  return { name: asset.name, text };
}

// The columns a file was read from, in the words staff use.
const READ_LABEL: Record<string, string> = {
  code: "Reservation code", net: "Net payout (money received)", gross: "Gross", commission: "Commission", hostFee: "Host fee", paymentFee: "Payment fee",
  cleaningFee: "Cleaning fee", date: "Date", type: "Type", currency: "Currency", payoutRef: "Payout reference",
};
type TransferWords = ReturnType<typeof transferSummary>;
type UploadResult = { channel: PayoutChannel; fileName: string; summary: string; used: Record<string, string>; transfers: TransferWords };
const TOO_LARGE = "This report is too large. Split it into parts of up to 8,000 lines and upload each part.";

// "12 new, 3 already uploaded, 2 skipped" (and "1 for cancelled stays" when there are any). New and already uploaded come from the
// server, which holds every line it has seen; skipped are the rows this screen could not use (no code, or no net amount).
export function uploadSummary(reply: Pick<PayoutImport, "lineCount" | "newLines" | "alreadyHeld" | "cancelledStay">, skipped: { noCode: number; noAmount: number }) {
  const parts = [`${formatCount(reply.newLines ?? reply.lineCount)} new`, `${formatCount(reply.alreadyHeld ?? 0)} already uploaded`, `${formatCount(skipped.noCode + skipped.noAmount)} skipped`];
  if ((reply.cancelledStay ?? 0) > 0) parts.push(`${formatCount(reply.cancelledStay ?? 0)} for cancelled stays`);
  return parts.join(", ");
}
// A file with rows but nothing usable in them: say why, before anything is sent.
function noLinesNote(skipped: { noCode: number; noAmount: number }) {
  const why = [skipped.noCode ? `${plural(skipped.noCode, "row")} had no reservation code` : "", skipped.noAmount ? `${plural(skipped.noAmount, "row")} had no net amount` : ""].filter(Boolean).join(" and ");
  return "No reservation payouts were found in this report" + (why ? `: ${why}.` : ".");
}
// Whether each payout date's lines add up to the bank transfer the file lists for it (Airbnb files). Information only:
// a difference never stops the upload.
function TransferCheck({ p, words }: { p: Palette; words: NonNullable<TransferWords> }) {
  return (
    <View style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
      <Feather name={words.allMatched ? "check-circle" : "info"} size={16} color={p.primary} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[ui.small, { color: p.text }]}>{words.text}</Text>
        {words.details.map(line => <Text key={line} style={[ui.small, { color: p.muted }]}>{line}</Text>)}
      </View>
    </View>
  );
}
// Which columns the file was read from, folded away until wanted, so a wrong column is easy to spot on a new kind of file.
function HowRead({ p, used, transfers }: { p: Palette; used: Record<string, string>; transfers?: TransferWords }) {
  const [open, setOpen] = useState(false);
  const rows = Object.entries(used).filter(([field]) => READ_LABEL[field]);
  return (
    <View style={{ gap: 8 }}>
      <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)} style={[ui.row, { gap: 6, minHeight: 36, alignSelf: "flex-start" }]}>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={p.primary} />
        <Text style={{ color: p.primary, fontSize: 13, fontWeight: "600" }}>How this file was read</Text>
      </MotionPress>
      {open && <View style={{ gap: 4 }}>
        {rows.map(([field, column]) => <Text key={field} style={[ui.small, { color: p.muted }]}>{READ_LABEL[field]}: <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>{column}</Text></Text>)}
        {!!transfers && <Text style={[ui.small, { color: p.muted }]}>Bank transfers: <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>{[transfers.text, ...transfers.details].join(" ")}</Text></Text>}
        <Text style={[ui.small, { color: p.muted }]}>If the net payout column is not the money you received, tell the team before you rely on this report.</Text>
      </View>}
    </View>
  );
}
// Why a payout line has no stay to belong to.
function unmatchedTag(stayStatus: string | null | undefined): [string, "wait" | "plain"] {
  if (stayStatus === "cancelled" || stayStatus === "canceled") return ["Stay cancelled", "plain"];
  if (stayStatus === "enquiry") return ["Enquiry only", "plain"];
  return ["No stay found", "wait"];
}

// `sectionProps` is what the Work area gives every section list; with it, Accounts also holds the AirCover claims tab.
export function LiveAccounts({ palette: p, account, properties, sectionProps }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; sectionProps?: SectionProps }) {
  const { width } = useWindowDimensions();
  const saved = useSaved();
  const role = account.role, management = role === "admin" || role === "super_admin";
  const thisMonth = london(new Date()).slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const focus = useWorkFocus();
  const [view, setView] = useState<Tab>(() => (["expenses", "payouts", "statements", "receivable", "maker", "performance", "aircover"] as const).find(v => v === focus?.sub && ((v !== "receivable" && v !== "maker" && v !== "performance" && v !== "aircover") || isFinanceRole(account.role)) && (v !== "aircover" || !!sectionProps)) ?? "expenses");
  const [status, setStatus] = useState<Expense["status"]>("to_approve");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [limit, setLimit] = useState<LimitState | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rec, setRec] = useState<Reconciliation | null>(null);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openExpense, setOpenExpense] = useState<string | null>(null);
  const [creating, setCreating] = useState(() => focus?.open === "new-expense");
  const [ask, setAsk] = useState<NoteAsk | null>(null);
  const [approving, setApproving] = useState<PayoutRow | null>(null);
  const [stay, setStay] = useState<(NeedsDetails | PayoutRow) & { propertyName?: string } | null>(null);
  const [terms, setTerms] = useState<StatementRow | null>(null);
  const [linesFor, setLinesFor] = useState<LinesStay | null>(null);
  const [uploading, setUploading] = useState<PayoutChannel | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyStatement, setBusyStatement] = useState("");
  // Keep one request identifier per attempted action until it succeeds.
  const ids = useRef(new Map<string, string>());
  const idFor = (key: string) => { if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID()); return ids.current.get(key)!; };

  // A quiet reload refreshes the figures without the loading shimmer, so approving a payout does not shift the page.
  const load = useCallback(async (options?: { quiet?: boolean }) => {
    if (options?.quiet !== true) { setLoading(true); setError(""); }
    const [o, pol, ex, r, st] = await Promise.allSettled([
      readFinance({ section: "overview", period }), readFinance({ section: "policy" }), readFinance({ section: "expenses", status }),
      readFinance({ section: "reconciliation", period }), readFinance({ section: "statements", period }),
    ]);
    // Each part loads on its own, so one that fails (for example, a tool this person doesn't have)
    // doesn't blank the others.
    const problems: string[] = [];
    const take = (result: PromiseSettledResult<{ data?: unknown }>, apply: (data: unknown) => void) => {
      try { if (result.status === "fulfilled") apply(result.value.data); else throw result.reason; }
      catch (e) { problems.push(e instanceof WorkspaceApiError ? e.message : "Part of Accounts could not be loaded. Refresh to try again."); }
    };
    take(o, data => setOverview(overviewSchema.parse(data)));
    take(pol, data => { const v = policySchema.parse(data); setLimit({ minor: v.expenseApprovalLimitMinor, version: v.version, repairMinor: v.managementRepairLimitMinor }); });
    take(ex, data => setExpenses(expensesSchema.parse(data)));
    take(r, data => setRec(reconciliationSchema.parse(data)));
    take(st, data => setStatements(statementsSchema.parse(data)));
    setError(problems.length ? [...new Set(problems)].join(" ") : "");
    setLoading(false);
  }, [period, status]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  async function upload(channel: PayoutChannel) {
    if (uploading) return;
    setUploadNote(""); setUploadResult(null);
    try {
      const file = await pickCsv();
      if (!file) return;
      if (!fitsPayoutUpload(file.text)) { setUploadNote(TOO_LARGE); return; }
      // The file is read here first, so a wrong platform or a missing column is turned away with the reason before anything is sent.
      const read = readPayoutLines(file.text, channel);
      if (read.error) { setUploadNote(read.error); return; }
      if (!read.lines.length) { setUploadNote(noLinesNote(read.skipped)); return; }
      if (read.lines.length > MAX_PAYOUT_LINES) { setUploadNote(TOO_LARGE); return; }
      setUploading(channel);
      const key = "upload:" + channel + ":" + file.name + ":" + file.text.length;
      const reply = payoutImportSchema.parse((await writeFinance({ action: "importPayoutReport", requestId: idFor(key), channel, fileName: file.name.slice(0, 200), csv: file.text })).data);
      ids.current.delete(key);
      setUploadResult({ channel, fileName: file.name, summary: uploadSummary(reply, read.skipped), used: read.used, transfers: transferSummary(read.transfers) });
      await load();
    } catch (e) { setUploadNote(message(e)); } finally { setUploading(null); }
  }
  async function statementAction(key: string, action: FinanceAction) {
    if (busyStatement) return;
    setBusyStatement(key); setError("");
    try { await writeFinance({ ...action, requestId: idFor(key) } as FinanceAction); ids.current.delete(key); await load(); }
    catch (e) { setError(message(e)); } finally { setBusyStatement(""); }
  }
  // The full form behind a payout row: add what a stay is missing, or approve with your own amount and a note.
  // (The row's own Approve button agrees the amount it shows without opening anything.)
  function openPayout(r: PayoutRow) {
    if (r.state === "no_reference" || r.state === "no_expected_amount") { setStay({ ...r, propertyName: properties.find(x => x.id === r.propertyId)?.name }); return; }
    // The approval sheet shows what is being approved first (PayoutApproveSheet.tsx).
    setApproving(r);
  }

  const unsettled = (overview?.unsettledPayouts ?? 0) + (overview?.missingDetails ?? 0);
  const phone = width < 600;
  const tiles = [
    { label: "To approve", value: overview?.toApproveCount ?? 0, icon: "check-circle" as IconName, detail: formatMoney(overview?.toApproveMinor ?? 0) + " in costs" + (overview?.draftCount ? ` · ${formatCount(overview.draftCount)} draft${overview.draftCount === 1 ? "" : "s"}` : ""), attention: (overview?.toApproveCount ?? 0) > 0 },
    { label: "To reconcile", value: unsettled, icon: "repeat" as IconName, detail: "Stays · " + monthLabel(period), attention: unsettled > 0 },
    { label: "Statements paid", value: `${formatCount(overview?.statements.paid ?? 0)} of ${formatCount(statements.length)}`, icon: "pie-chart" as IconName, detail: `${formatCount(overview?.statements.issued ?? 0)} issued · ${formatCount(overview?.statements.draft ?? 0)} draft`, attention: false },
  ];

  return (
    <View style={{ gap: space.section }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Accounts</Text>
        <Text style={[ui.body, { color: p.muted }]}>Approve costs with evidence, reconcile platform payouts and pay owners.</Text>
      </View>

      <View style={[ui.between, { gap: 8 }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setPeriod(shiftMonth(period, -1))} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><Feather name="chevron-left" size={20} color={p.primary} /></MotionPress>
        <Text style={{ color: p.text, fontSize: textSize.heading, fontWeight: "600" }}>{monthLabel(period)}</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: period >= thisMonth }} disabled={period >= thisMonth} onPress={() => setPeriod(shiftMonth(period, 1))} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: period >= thisMonth ? p.elevated : p.wash }}><Feather name="chevron-right" size={20} color={period >= thisMonth ? p.muted : p.primary} /></MotionPress>
      </View>

      <StatGrid>
        {/* On a phone the three tiles sit side by side: one fill for all (no attention wash) and a short label that fits one line. */}
        {tiles.map(tile => <StatTile key={tile.label} p={p} icon={tile.icon} tone="accounts" label={phone ? TILE_SHORT[tile.label] ?? tile.label : tile.label} value={tile.value} detail={tile.detail} attention={!phone && tile.attention} />)}
      </StatGrid>

      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      {/* The Accounts sections: pills up to 5, one dropdown past that (finance roles have 7), by the shared rule (Pills.tsx). */}
      <Pills p={p} title="Accounts section" value={view} onChange={setView} label={v => TAB_LABEL[v]}
        values={(["expenses", "payouts", "statements", "receivable", "maker", "performance", "aircover"] as const).filter(v => (v !== "receivable" && v !== "maker" && v !== "performance" && v !== "aircover") || (isFinanceRole(role) && (v !== "aircover" || !!sectionProps)))} />

      {view === "expenses" && <AccountsPayable p={p} account={account} role={role} management={management} overview={overview} status={status} setStatus={setStatus} expenses={expenses} limit={limit} loading={loading} load={load} setAsk={setAsk} setOpenExpense={setOpenExpense} setCreating={setCreating} properties={properties} />}

      {view === "payouts" && rec && <>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Reconciliation</Text>
          <Text style={[ui.small, { color: p.muted }]}>Upload each platform’s payout report, then check stay by stay that the money arrived.</Text>
        </View>
        <Section title="Upload a payout report" p={p}>
          <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
            {RECONCILED_CHANNELS.map(channel => <Button key={channel} label={uploading === channel ? "Uploading…" : `${PAYOUT_CHANNEL_LABEL[channel]} CSV`} icon="upload" primary p={p} disabled={!!uploading} onPress={() => void upload(channel)} />)}
          </View>
          {!!uploadNote && <Notice text={uploadNote} p={p} tone="bad" />}
          {!!uploadResult && <View key={uploadResult.fileName + uploadResult.summary} style={{ gap: 4 }}>
            <Notice text={`${PAYOUT_CHANNEL_LABEL[uploadResult.channel]} · ${uploadResult.fileName}: ${uploadResult.summary}`} p={p} />
            {!!uploadResult.transfers && <TransferCheck p={p} words={uploadResult.transfers} />}
            <HowRead p={p} used={uploadResult.used} transfers={uploadResult.transfers} />
          </View>}
          <Text style={[ui.small, { color: p.muted }]}>Not sure which file? Download an example: the upload reads the same columns (the reservation code and the net payout). Uploading the same file twice is safe: lines already held are not added again.</Text>
          <PayoutExamples p={p} period={period} />
        </Section>
        {rec.needsDetails.length > 0 && <Section title="Stays missing details" count={rec.needsDetails.length} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Add the platform and code, or the payout for direct stays. The owner statement waits for these.</Text>
          <List p={p} empty="">
            {rec.needsDetails.map((s, i) => <Row key={s.reservationId} p={p} first={i === 0} title={s.reference} detail={`${s.propertyName} · ${CHANNEL_LABEL[s.channel] ?? s.channel} · ${s.checkIn} to ${s.checkOut}`} tags={[["Needs details", "wait"]]} onPress={() => setStay(s)} />)}
          </List>
        </Section>}
        <Section title="Platform stays" count={rec.rows.filter(r => r.settledMinor === null).length} p={p}>
          <PayoutStays p={p} rows={rec.rows} periodLabel={monthLabel(period)} canApprove={isFinanceRole(role)} propertyName={id => properties.find(x => x.id === id)?.name}
            onOpen={openPayout} onLines={r => setLinesFor({ reservationId: r.reservationId, reference: r.reference, channel: r.channel, checkIn: r.checkIn, checkOut: r.checkOut, expectedMinor: r.expectedMinor, propertyName: properties.find(x => x.id === r.propertyId)?.name })} onChanged={() => load({ quiet: true })} />
        </Section>
        {rec.unexpected.length > 0 && <Section title="Payouts we could not match" count={rec.unexpected.length} p={p}>
          <Text style={[ui.small, { color: p.muted }]}>Money a platform reported for a code with no confirmed stay. Add the stay, or set the payout aside with a reason.</Text>
          <List p={p} empty="">
            {rec.unexpected.map((u, i) => <Row key={u.lineId} p={p} first={i === 0} title={u.reference} detail={[CHANNEL_LABEL[u.channel] ?? u.channel, u.paidOn ? formatDay(u.paidOn) : "", u.lineType ?? "", u.fileName].filter(Boolean).join(" · ")} amount={pounds(u.amountMinor)} tags={[unmatchedTag(u.stayStatus)]}
              onPress={() => setAsk({ title: "Set this payout aside", subtitle: `${u.reference} · ${pounds(u.amountMinor)}`, label: "Why it is not for a managed stay", min: 5, confirm: "Set aside", build: note => ({ action: "setAsidePayoutLine", requestId: "", lineId: u.lineId, note }) })} />)}
          </List>
        </Section>}
        {rec.reports.length > 0 && <Section title="Recent uploads" p={p}>
          <List p={p} empty="">{rec.reports.slice(0, 6).map((r, i) => <Row key={r.id} p={p} first={i === 0} title={r.fileName} detail={`${CHANNEL_LABEL[r.channel] ?? r.channel} · ${plural(r.lineCount, "line")}${r.newLineCount != null ? ` (${r.newLineCount} new)` : ""} · ${new Date(r.uploadedAt).toLocaleDateString("en-GB")}`} amount={pounds(r.totalMinor)} />)}</List>
        </Section>}
      </>}

      {view === "statements" && <AccountsStatements p={p} role={role} management={management} period={period} statements={statements} loading={loading} expanded={expanded} setExpanded={setExpanded} busyStatement={busyStatement} statementAction={statementAction} setTerms={setTerms} setAsk={setAsk} properties={properties} onPeriod={setPeriod} onOpenTab={tab => setView(tab === "payouts" ? "payouts" : "expenses")} />}

      {view === "receivable" && <AccountsReceivable p={p} account={account} properties={properties} />}
      {/* The invoice maker (20261022100000): Accounts, admins and super admins, the same people who issue invoices. */}
      {view === "maker" && isFinanceRole(role) && <InvoiceMaker p={p} />}

      {view === "performance" && <AccountsPerformance p={p} account={account} properties={properties} />}

      {view === "aircover" && !!sectionProps && <AirCoverList {...sectionProps} />}

      <ExpenseSheet p={p} role={role} id={openExpense} limit={limit?.minor ?? null} onClose={() => setOpenExpense(null)} onAsk={a => { setOpenExpense(null); setAsk(a); }} onDone={saved(load)} />
      <NewExpenseSheet p={p} visible={creating} properties={properties} onClose={() => setCreating(false)} onDone={saved(load)} />
      <NoteSheet p={p} ask={ask} onClose={() => setAsk(null)} onDone={saved(load)} />
      <PayoutApproveSheet p={p} row={approving} property={approving ? properties.find(x => x.id === approving.propertyId) : undefined} onClose={() => setApproving(null)} onDone={saved(load)} />
      <StaySheet p={p} stay={stay} onClose={() => setStay(null)} onDone={saved(load)} />
      <PayoutLinesSheet p={p} stay={linesFor} canSetAside={isFinanceRole(role)} onClose={() => setLinesFor(null)} onChanged={() => load({ quiet: true })} />
      <TermsSheet p={p} row={terms} onClose={() => setTerms(null)} onDone={saved(load)} />
    </View>
  );
}