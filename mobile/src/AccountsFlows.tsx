import { useMemo, useState } from "react";
import { Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as DocumentPicker from "expo-document-picker";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { Entrance, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { clientPortfolio, formatMoney } from "./clientPortfolio";
import { CLEAN_COST_MINOR, MANAGEMENT_FEE_BPS, samplePayoutReports, updateExpense, useExpenses, type Expense } from "./accountsSamples";
import { ownerStatement, readPayoutReport, reconcile, type MatchRow, type PayoutRow } from "../../lib/payout-reconciliation";
import { exportReport } from "./exportReport";

const pence = (minor: number) => "£" + (minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shadow = Platform.OS === "web" ? { boxShadow: "0 14px 30px -24px rgba(21, 45, 40, 0.45)" } : { elevation: 2 };

function Pills({ values, selected, onSelect, palette: p }: { values: string[]; selected: string; onSelect: (value: string) => void; palette: Palette }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {values.map(value => {
        const on = value === selected;
        return (
          <MotionPress key={value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onSelect(value)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
            <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{value}</Text>
          </MotionPress>
        );
      })}
    </ScrollView>
  );
}

function Tag({ label, tone, palette: p }: { label: string; tone: "good" | "wait" | "bad" | "plain"; palette: Palette }) {
  const colours = { good: [p.successWash, p.success], wait: [p.cautionWash, p.waiting], bad: [p.dangerWash, p.danger], plain: [p.wash, p.primary] }[tone];
  return <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colours[0], alignSelf: "flex-start" }}><Text style={{ color: colours[1], fontSize: 12, fontWeight: "700" }}>{label}</Text></View>;
}

function Stat({ icon, value, label, palette: p }: { icon: DimensionalName; value: string; label: string; palette: Palette }) {
  return (
    <View style={{ flex: 1, minWidth: 140, padding: 14, gap: 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, ...shadow }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={icon} size={34} /></View>
      <View><Text style={{ color: p.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.6 }}>{value}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{label}</Text></View>
    </View>
  );
}

function Notice({ icon, title, detail, palette: p }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; detail: string; palette: Palette }) {
  return (
    <View style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.wash, alignItems: "flex-start" }]}>
      <Feather name={icon} size={18} color={p.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{title}</Text><Text style={[ui.small, { color: p.muted }]}>{detail}</Text></View>
    </View>
  );
}

const EVIDENCE_ICON: Record<Expense["evidence"][number]["kind"], React.ComponentProps<typeof Feather>["name"]> = { invoice: "file-text", photo: "image", quote: "clipboard", report: "check-square" };
const STATUS: Record<Expense["status"], [string, "good" | "wait" | "bad"]> = { "to-approve": ["To approve", "wait"], queried: ["Queried", "bad"], approved: ["Approved · queued for Xero", "good"] };
// Approval needs the invoice plus proof the work or purchase happened.
const hasProof = (expense: Expense) => expense.evidence.some(item => item.kind === "invoice") && expense.evidence.some(item => item.kind !== "invoice");

export function AccountsApprovals({ palette: p, desktop }: { palette: Palette; desktop: boolean }) {
  const expenses = useExpenses();
  const [filter, setFilter] = useState("To approve");
  const [property, setProperty] = useState("All properties");
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const open = expenses.find(expense => expense.id === openId) ?? null;
  const properties = ["All properties", ...Array.from(new Set(expenses.map(expense => expense.propertyName)))];
  const shown = expenses.filter(expense => (filter === "All" || STATUS[expense.status][0].startsWith(filter)) && (property === "All properties" || expense.propertyName === property));
  const waiting = expenses.filter(expense => expense.status === "to-approve");
  return (
    <Entrance sessionKey="accounts:approvals" style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 30 : 26 }]}>Invoices</Text>
        <Text style={[ui.body, { color: p.muted }]}>Check the evidence, approve, and post each cost to the right property in Xero.</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Stat icon="clipboard" value={String(waiting.length)} label="Waiting for approval" palette={p} />
        <Stat icon="coins" value={formatMoney(waiting.reduce((sum, expense) => sum + expense.amountMinor, 0))} label="Value to approve" palette={p} />
        <Stat icon="chat" value={String(expenses.filter(expense => expense.status === "queried").length)} label="Queried with supplier" palette={p} />
        <Stat icon="chart" value={String(expenses.filter(expense => expense.status === "approved").length)} label="Queued for Xero" palette={p} />
      </View>
      <Notice icon="link" title="Xero is not connected yet" detail="Invoices emailed to the accounts inbox will appear here automatically. Approved costs are queued and will post to Xero as bills, tracked to each property, once the connection is set up." palette={p} />
      <Pills values={["To approve", "Queried", "Approved", "All"]} selected={filter} onSelect={setFilter} palette={p} />
      <Pills values={properties} selected={property} onSelect={setProperty} palette={p} />
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {shown.length ? shown.map((expense, index) => (
          <MotionPress key={expense.id} accessibilityRole="button" accessibilityLabel={`${expense.supplier}, ${pence(expense.amountMinor)}, ${STATUS[expense.status][0]}`} onPress={() => { setOpenId(expense.id); setQuery(expense.query ?? ""); }} style={[ui.row, { gap: 12, paddingVertical: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={expense.category === "Utilities" ? "zap" : expense.category === "Property setup" ? "package" : expense.category === "Cleaning supplies" ? "droplet" : "tool"} size={19} color={p.primary} /></View>
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{expense.supplier}</Text>
              <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{expense.propertyName} · {expense.category}</Text>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={STATUS[expense.status][0]} tone={STATUS[expense.status][1]} palette={p} />
                <Tag label={`${expense.evidence.length} ${expense.evidence.length === 1 ? "document" : "documents"}`} tone={hasProof(expense) ? "plain" : "wait"} palette={p} />
              </View>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{pence(expense.amountMinor)}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{expense.received}</Text>
            </View>
          </MotionPress>
        )) : <View style={{ padding: 20, alignItems: "center", gap: 6 }}><DimensionalIcon name="medal" size={56} /><Text style={{ color: p.text, fontWeight: "700" }}>Nothing in this view</Text><Text style={[ui.small, { color: p.muted }]}>Try another status or property.</Text></View>}
      </View>
      <Sheet palette={p} visible={!!open} onClose={() => setOpenId(null)} title={open?.supplier ?? ""} subtitle={open ? `${open.reference} · ${open.propertyName}` : ""} icon="coins">
        {open && <>
          <View style={[ui.between, { alignItems: "flex-end" }]}>
            <View><Text style={[ui.small, { color: p.muted }]}>Amount</Text><Text style={{ color: p.text, fontSize: 30, fontWeight: "700", letterSpacing: -1 }}>{pence(open.amountMinor)}</Text></View>
            <Tag label={STATUS[open.status][0]} tone={STATUS[open.status][1]} palette={p} />
          </View>
          {[["Property", open.propertyName], ["Category", open.category], ["Received", `${open.received} from ${open.from}`], ["Work", open.description]].map(([label, value]) => (
            <View key={label} style={{ gap: 2 }}><Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text><Text style={{ color: p.text, fontSize: 14 }}>{value}</Text></View>
          ))}
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Evidence</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {open.evidence.map(item => (
              <View key={item.label} style={{ width: 150, gap: 8, padding: 10, borderRadius: 16, backgroundColor: p.elevated }}>
                <View style={{ height: 70, borderRadius: 12, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" }}><Feather name={EVIDENCE_ICON[item.kind]} size={26} color={p.primary} /></View>
                <Text numberOfLines={2} style={[ui.small, { color: p.text, fontWeight: "600" }]}>{item.label}</Text>
              </View>
            ))}
          </View>
          {!hasProof(open) && <Notice icon="alert-triangle" title="No proof of work attached" detail="There is an invoice but no photos, quote or sign-off. Query it, or ask the Ready team for evidence before approving." palette={p} />}
          {open.status !== "approved" && <>
            <TextInput value={query} onChangeText={setQuery} placeholder="Question for the supplier or team (optional)" placeholderTextColor={p.muted} multiline style={{ minHeight: 72, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
            <View style={[ui.row, { gap: 10 }]}>
              <MotionPress accessibilityRole="button" onPress={() => { updateExpense(open.id, { status: "queried", query: query.trim() || "Please send proof of the work." }); setOpenId(null); }} style={[ui.button, { flex: 1, backgroundColor: p.wash }]}><Feather name="help-circle" size={17} color={p.primary} /><Text style={[ui.buttonText, { color: p.primary }]}>Query</Text></MotionPress>
              <MotionPress accessibilityRole="button" accessibilityState={{ disabled: !hasProof(open) }} disabled={!hasProof(open)} onPress={() => { updateExpense(open.id, { status: "approved" }); setOpenId(null); }} style={[ui.button, { flex: 1, backgroundColor: hasProof(open) ? p.primary : p.elevated }]}><Feather name="check" size={17} color={hasProof(open) ? p.onPrimary : p.muted} /><Text style={[ui.buttonText, { color: hasProof(open) ? p.onPrimary : p.muted }]}>Approve</Text></MotionPress>
            </View>
          </>}
          {open.status === "approved" && <Notice icon="check-circle" title="Approved" detail={`Queued as a Xero bill, tracked to ${open.propertyName}. It will appear on this month's owner statement.`} palette={p} />}
          {!!open.query && open.status === "queried" && <Notice icon="message-circle" title="Your query" detail={open.query} palette={p} />}
        </>}
      </Sheet>
    </Entrance>
  );
}

type Upload = { name: string; rows: PayoutRow[]; error?: string };
async function pickCsv(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
  return { name: asset.name, text };
}

const MATCH_LABEL: Record<MatchRow["status"], [string, "good" | "wait" | "bad" | "plain"]> = { matched: ["Matched", "good"], different: ["Amount differs", "wait"], missing: ["Not in report", "bad"], unexpected: ["Not on our system", "bad"] };

export function OwnerStatements({ palette: p, desktop }: { palette: Palette; desktop: boolean }) {
  const portfolio = useMemo(() => clientPortfolio(), []);
  const expenses = useExpenses();
  const [uploads, setUploads] = useState<Record<"Airbnb" | "Booking.com", Upload | null>>({ Airbnb: null, "Booking.com": null });
  const [resolved, setResolved] = useState<Record<string, true>>({});
  const [method, setMethod] = useState("Bank transfer");
  const [paid, setPaid] = useState<Record<string, true>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const samples = useMemo(() => samplePayoutReports(portfolio.bookings), [portfolio]);

  const load = (channel: "Airbnb" | "Booking.com", name: string, text: string) => {
    const report = readPayoutReport(text);
    setUploads(current => ({ ...current, [channel]: { name, rows: report.rows, error: report.error } }));
  };
  const upload = async (channel: "Airbnb" | "Booking.com") => {
    try { const file = await pickCsv(); if (file) load(channel, file.name, file.text); }
    catch { setUploads(current => ({ ...current, [channel]: { name: "", rows: [], error: "The file could not be read. Download the CSV again and retry." } })); }
  };

  const platformBookings = portfolio.bookings.filter(booking => booking.channel !== "Direct");
  const received = [...(uploads.Airbnb?.rows ?? []), ...(uploads["Booking.com"]?.rows ?? [])];
  const loaded = !!(uploads.Airbnb?.rows.length || uploads["Booking.com"]?.rows.length);
  const rows = loaded ? reconcile(platformBookings.map(booking => ({ code: booking.code, amountMinor: booking.payoutMinor, propertyId: booking.propertyId, guest: booking.guest, channel: booking.channel })), received) : [];
  const open = rows.filter(row => row.status !== "matched" && !resolved[row.code]);
  const step = !loaded ? 1 : open.length ? 2 : Object.keys(paid).length === portfolio.perProperty.length ? 4 : 3;

  const statements = portfolio.perProperty.map(property => {
    // Platform stays count at the amount actually paid out once agreed;
    // direct stays are paid to the bank account at the booked amount.
    const own = portfolio.bookings.filter(booking => booking.propertyId === property.id).map(booking => {
      if (booking.channel === "Direct") return { ...booking, receivedMinor: booking.payoutMinor as number | null };
      const row = rows.find(item => item.code === booking.code);
      const agreed = !!row && (row.status === "matched" || !!resolved[row.code]);
      return { ...booking, receivedMinor: agreed ? row.receivedMinor ?? row.expectedMinor : null };
    });
    const revenueMinor = own.reduce((sum, booking) => sum + (booking.receivedMinor ?? 0), 0);
    const pending = own.filter(booking => booking.channel !== "Direct" && !rows.some(row => row.code === booking.code && (row.status === "matched" || resolved[row.code]))).length;
    const costs = expenses.filter(expense => expense.propertyId === property.id && expense.status === "approved");
    const statement = ownerStatement({ revenueMinor, cleaningMinor: own.length * CLEAN_COST_MINOR, expensesMinor: costs.reduce((sum, expense) => sum + expense.amountMinor, 0), managementFeeBps: MANAGEMENT_FEE_BPS });
    return { property, own, costs, pending, ...statement };
  });
  const previewing = statements.find(item => item.property.id === preview) ?? null;

  const download = (item: (typeof statements)[number]) => {
    const csv = [["Owner statement", item.property.name, portfolio.monthLabel], [], ["Date", "Reservation", "Channel", "Guest", "Amount"], ...item.own.map(booking => [booking.checkIn, booking.code, booking.channel, booking.guest, booking.receivedMinor === null ? "Awaiting payout" : (booking.receivedMinor / 100).toFixed(2)]), [], ...item.costs.map(cost => [cost.received, cost.reference, "Expense", cost.supplier, (-cost.amountMinor / 100).toFixed(2)]), [], ...item.lines.map(line => [line.label, "", "", "", (line.amountMinor / 100).toFixed(2)]), ["Owner payout", "", "", "", (item.payoutMinor / 100).toFixed(2)]]
      .map(line => line.map(cell => /[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell)).join(",")).join("\n");
    void exportReport(csv, `owner-statement-${item.property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`);
  };

  const steps = ["Upload payout reports", "Reconcile", "Review statements", "Pay owners"];
  return (
    <Entrance sessionKey="accounts:statements" style={{ gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: desktop ? 30 : 26 }]}>Owner statements</Text>
        <Text style={[ui.body, { color: p.muted }]}>{portfolio.monthLabel} · Revenue, less cleaning, costs and our {MANAGEMENT_FEE_BPS / 100}% fee, equals the owner payout.</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {steps.map((label, index) => {
          const done = index + 1 < step, current = index + 1 === step;
          return (
            <View key={label} style={[ui.row, { gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: current ? p.primary : done ? p.successWash : p.surface, borderWidth: 1, borderColor: current ? p.primary : p.border }]}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: current ? p.onPrimary : done ? p.success : p.elevated }}>
                {done ? <Feather name="check" size={13} color="#FFFFFF" /> : <Text style={{ fontSize: 12, fontWeight: "700", color: current ? p.primary : p.muted }}>{index + 1}</Text>}
              </View>
              <Text style={{ fontSize: 13, fontWeight: "600", color: current ? p.onPrimary : p.text }}>{label}</Text>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: desktop ? "row" : "column", gap: 12 }}>
        {(["Airbnb", "Booking.com"] as const).map(channel => {
          const file = uploads[channel];
          return (
            <View key={channel} style={[ui.card, { flex: desktop ? 1 : undefined, backgroundColor: p.surface, borderColor: p.border, gap: 12 }]}>
              <View style={[ui.row, { gap: 12 }]}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name="upload-cloud" size={20} color={p.primary} /></View>
                <View style={{ flex: 1 }}><Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{channel} payout report</Text><Text style={[ui.small, { color: p.muted }]}>{file?.error ? file.error : file ? `${file.name} · ${file.rows.length} reservations read` : "Download the CSV from " + channel + ", then upload it here."}</Text></View>
                {!!file && !file.error && <Feather name="check-circle" size={20} color={p.success} />}
              </View>
              <View style={[ui.row, { gap: 8 }]}>
                <MotionPress accessibilityRole="button" onPress={() => void upload(channel)} style={[ui.button, { flex: 1, backgroundColor: p.primary }]}><Feather name="upload" size={16} color={p.onPrimary} /><Text style={[ui.buttonText, { color: p.onPrimary }]}>{file ? "Replace CSV" : "Upload CSV"}</Text></MotionPress>
                <MotionPress accessibilityRole="button" onPress={() => load(channel, `example-${channel.toLowerCase().replace(/\W/g, "")}-payouts.csv`, channel === "Airbnb" ? samples.airbnbCsv : samples.bookingCsv)} style={[ui.button, { flex: 1, backgroundColor: p.wash }]}><Text style={[ui.buttonText, { color: p.primary }]}>Use example</Text></MotionPress>
              </View>
            </View>
          );
        })}
      </View>

      {loaded && <View style={{ gap: 12 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Reconciliation</Text>
          <Text style={[ui.small, { color: p.muted }]}>{rows.length - open.length} of {rows.length} agreed</Text>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: p.elevated, overflow: "hidden" }}><View style={{ width: `${rows.length ? ((rows.length - open.length) / rows.length) * 100 : 0}%`, height: 8, backgroundColor: p.success }} /></View>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {[...rows].sort((a, b) => Number(a.status === "matched" || !!resolved[a.code]) - Number(b.status === "matched" || !!resolved[b.code])).map((row, index) => {
            const agreed = row.status === "matched" || resolved[row.code];
            const property = portfolio.perProperty.find(item => item.id === row.propertyId);
            return (
              <View key={row.code} style={{ flexDirection: desktop ? "row" : "column", alignItems: desktop ? "center" : "stretch", gap: 10, paddingVertical: 12, borderTopWidth: index ? 1 : 0, borderColor: p.border }}>
                <View style={{ flex: desktop ? 1.4 : undefined, gap: 2 }}>
                  <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{row.code}</Text>
                  <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{row.channel}{row.guest ? ` · ${row.guest}` : ""}{property ? ` · ${property.name}` : ""}</Text>
                </View>
                <View style={[ui.row, { flex: desktop ? 1.2 : undefined, gap: 16 }]}>
                  <View><Text style={[ui.small, { color: p.muted }]}>Our system</Text><Text style={{ color: p.text, fontWeight: "600" }}>{row.expectedMinor === null ? "—" : pence(row.expectedMinor)}</Text></View>
                  <View><Text style={[ui.small, { color: p.muted }]}>Report</Text><Text style={{ color: row.status === "different" ? p.waiting : p.text, fontWeight: "600" }}>{row.receivedMinor === null ? "—" : pence(row.receivedMinor)}</Text></View>
                </View>
                <View style={[ui.row, { flex: desktop ? 1.3 : undefined, gap: 8, justifyContent: desktop ? "flex-end" : "space-between" }]}>
                  <Tag label={resolved[row.code] ? "Agreed manually" : MATCH_LABEL[row.status][0]} tone={agreed ? "good" : MATCH_LABEL[row.status][1]} palette={p} />
                  {!agreed && <MotionPress accessibilityRole="button" accessibilityLabel={`Mark ${row.code} as reconciled`} onPress={() => setResolved(current => ({ ...current, [row.code]: true }))} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center", backgroundColor: p.wash }}><Text style={{ color: p.primary, fontSize: 13, fontWeight: "700" }}>{row.status === "unexpected" ? "Set aside" : "Mark agreed"}</Text></MotionPress>}
                  {!!resolved[row.code] && <MotionPress accessibilityRole="button" accessibilityLabel={`Undo ${row.code}`} onPress={() => setResolved(current => { const next = { ...current }; delete next[row.code]; return next; })} style={{ minHeight: 36, paddingHorizontal: 10, justifyContent: "center" }}><Text style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>Undo</Text></MotionPress>}
                </View>
              </View>
            );
          })}
        </View>
      </View>}

      <View style={{ gap: 12 }}>
        <View style={[ui.between, { flexWrap: "wrap", gap: 10 }]}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Statements</Text>
          <Pills values={["Bank transfer", "Stripe"]} selected={method} onSelect={setMethod} palette={p} />
        </View>
        {method === "Stripe" && <Notice icon="credit-card" title="Stripe payouts carry fees" detail="Stripe Connect can pay owners automatically, but charges per payout. Bank transfer by the accounts team costs nothing. Stripe connects once keys are added." palette={p} />}
        <View style={{ flexDirection: desktop ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
          {statements.map(item => (
            <View key={item.property.id} style={[ui.card, { flex: desktop ? 1 : undefined, minWidth: desktop ? 320 : undefined, backgroundColor: p.surface, borderColor: p.border, gap: 12, ...shadow }]}>
              <View style={ui.between}>
                <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{item.property.name}</Text><Text style={[ui.small, { color: p.muted }]}>{item.own.length} stays · {item.costs.length} approved costs</Text></View>
                <Tag label={paid[item.property.id] ? "Paid" : item.pending ? `${item.pending} to reconcile` : "Ready to pay"} tone={paid[item.property.id] ? "good" : item.pending ? "wait" : "plain"} palette={p} />
              </View>
              {item.lines.map(line => (
                <View key={line.label} style={ui.between}><Text style={[ui.small, { color: p.muted }]}>{line.label}</Text><Text style={{ color: line.amountMinor < 0 ? p.text : p.success, fontSize: 14, fontWeight: "600" }}>{line.amountMinor < 0 ? "−" : ""}{pence(Math.abs(line.amountMinor))}</Text></View>
              ))}
              <View style={[ui.between, { paddingTop: 10, borderTopWidth: 1, borderColor: p.border }]}><Text style={{ color: p.text, fontWeight: "700" }}>Owner payout</Text><Text style={{ color: p.text, fontSize: 20, fontWeight: "700" }}>{pence(item.payoutMinor)}</Text></View>
              <View style={[ui.row, { gap: 8 }]}>
                <MotionPress accessibilityRole="button" onPress={() => setPreview(item.property.id)} style={[ui.button, { flex: 1, backgroundColor: p.wash }]}><Feather name="eye" size={16} color={p.primary} /><Text style={[ui.buttonText, { color: p.primary }]}>Details</Text></MotionPress>
                <MotionPress accessibilityRole="button" accessibilityState={{ disabled: !!item.pending || !!paid[item.property.id] }} disabled={!!item.pending || !!paid[item.property.id]} onPress={() => setPaid(current => ({ ...current, [item.property.id]: true }))} style={[ui.button, { flex: 1.4, backgroundColor: item.pending || paid[item.property.id] ? p.elevated : p.primary }]}><Feather name={paid[item.property.id] ? "check" : "send"} size={16} color={item.pending || paid[item.property.id] ? p.muted : p.onPrimary} /><Text style={[ui.buttonText, { color: item.pending || paid[item.property.id] ? p.muted : p.onPrimary }]}>{paid[item.property.id] ? `Paid by ${method === "Stripe" ? "Stripe" : "transfer"}` : "Mark as paid"}</Text></MotionPress>
              </View>
            </View>
          ))}
        </View>
        <Notice icon="refresh-cw" title="What becomes automatic" detail="Once Hostaway and Xero are connected, reservations, cleaning costs and property expenses fill in by themselves. The team only uploads payout reports and agrees any differences." palette={p} />
      </View>

      <Sheet palette={p} visible={!!previewing} onClose={() => setPreview(null)} title={previewing?.property.name ?? ""} subtitle={`Owner statement · ${portfolio.monthLabel}`} icon="chart">
        {previewing && <>
          <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Stays</Text>
          {previewing.own.map(booking => (
            <View key={booking.id} style={ui.between}><View style={{ flex: 1 }}><Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{booking.guest}</Text><Text style={[ui.small, { color: p.muted }]}>{booking.channel} · {booking.code} · {booking.checkIn}</Text></View><Text style={{ color: booking.receivedMinor === null ? p.muted : p.text, fontWeight: "600" }}>{booking.receivedMinor === null ? "Awaiting payout" : pence(booking.receivedMinor)}</Text></View>
          ))}
          <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Costs</Text>
          <View style={ui.between}><Text style={[ui.small, { color: p.muted }]}>{previewing.own.length} cleans at {pence(CLEAN_COST_MINOR)}</Text><Text style={{ color: p.text, fontWeight: "600" }}>−{pence(previewing.own.length * CLEAN_COST_MINOR)}</Text></View>
          {previewing.costs.map(cost => <View key={cost.id} style={ui.between}><Text style={[ui.small, { color: p.muted, flex: 1 }]}>{cost.supplier} · {cost.reference}</Text><Text style={{ color: p.text, fontWeight: "600" }}>−{pence(cost.amountMinor)}</Text></View>)}
          <View style={[ui.between, { paddingTop: 10, borderTopWidth: 1, borderColor: p.border }]}><Text style={{ color: p.text, fontWeight: "700" }}>Owner payout</Text><Text style={{ color: p.text, fontSize: 20, fontWeight: "700" }}>{pence(previewing.payoutMinor)}</Text></View>
          <MotionPress accessibilityRole="button" onPress={() => download(previewing)} style={[ui.button, { backgroundColor: p.primary }]}><Feather name="download" size={16} color={p.onPrimary} /><Text style={[ui.buttonText, { color: p.onPrimary }]}>Download statement</Text></MotionPress>
        </>}
      </Sheet>
    </Entrance>
  );
}

type Decision = { id: string; team: string; title: string; detail: string; amount?: string; icon: DimensionalName };
const DECISIONS: Decision[] = [
  { id: "d1", team: "Cleans", icon: "spray", title: "Contested clean", detail: "A cleaner disputes a rejected turnover clean at Example Glasgow Apartment and has sent photos. The cleaning manager wants a second opinion." },
  { id: "d2", team: "Ready", icon: "hardhat", title: "Repair quote over £500", amount: "£1,240", detail: "Boiler replacement at Example Edinburgh Apartment. Two quotes received; the landlord has not replied in 48 hours." },
  { id: "d3", team: "Cleans", icon: "medal", title: "Second quality warning", detail: "Example cleaner 3 has two quality warnings this month. Decide whether to move them to supervised cleans." },
  { id: "d4", team: "Accounts", icon: "coins", title: "Owner payout above usual", amount: "£3,980", detail: "This month's payout for Example Leith Townhouse is 40% higher than average after a long direct booking." },
];

export function ManagementOverview({ palette: p, desktop, onOpenWork }: { palette: Palette; desktop: boolean; onOpenWork: () => void }) {
  const expenses = useExpenses();
  const portfolio = useMemo(() => clientPortfolio(), []);
  const [decided, setDecided] = useState<Record<string, "Approved" | "Declined">>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const open = DECISIONS.find(item => item.id === openId) ?? null;
  const waiting = expenses.filter(expense => expense.status === "to-approve");
  const teams: { name: string; icon: DimensionalName; lines: [string, string][] }[] = [
    { name: "Stays", icon: "key", lines: [[String(portfolio.inHouse.length), "guests staying"], [String(portfolio.upcoming.length), "upcoming arrivals"]] },
    { name: "Cleans", icon: "spray", lines: [["6", "cleans today"], ["2", "awaiting approval"]] },
    { name: "Ready", icon: "hardhat", lines: [["4", "open repairs"], ["1", "quote waiting"]] },
    { name: "Accounts", icon: "coins", lines: [[String(waiting.length), "to approve"], [formatMoney(waiting.reduce((sum, expense) => sum + expense.amountMinor, 0)), "waiting"]] },
  ];
  const remaining = DECISIONS.filter(item => !decided[item.id]).length;
  return (
    <Entrance sessionKey="management:overview" style={{ gap: 14 }}>
      <View style={ui.between}>
        <View style={{ flex: 1, gap: 2 }}><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Across the business</Text><Text style={[ui.small, { color: p.muted }]}>Management sees every team, every property and every approval.</Text></View>
        <MotionPress accessibilityRole="button" onPress={onOpenWork} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>All work</Text></MotionPress>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {teams.map(team => (
          <View key={team.name} style={{ flexBasis: desktop ? 0 : "46%", flexGrow: 1, minWidth: 0, padding: 14, gap: 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, ...shadow }}>
            <View style={[ui.row, { gap: 10 }]}><DimensionalIcon name={team.icon} size={34} /><Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{team.name}</Text></View>
            {team.lines.map(([value, label]) => <View key={label} style={[ui.row, { gap: 6, alignItems: "baseline" }]}><Text style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>{value}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted, flex: 1 }]}>{label}</Text></View>)}
          </View>
        ))}
      </View>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 0, paddingVertical: 6 }]}>
        <View style={[ui.between, { paddingVertical: 8, gap: 12 }]}><Text style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1, minWidth: 0 }}>Needs a management decision</Text><Tag label={remaining ? `${remaining} open` : "All decided"} tone={remaining ? "wait" : "good"} palette={p} /></View>
        {DECISIONS.map(item => (
          <MotionPress key={item.id} accessibilityRole="button" onPress={() => setOpenId(item.id)} style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: p.border }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={item.icon} size={32} /></View>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}><Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{item.title}{item.amount ? ` · ${item.amount}` : ""}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{item.team} · {item.detail}</Text></View>
            {decided[item.id] ? <Tag label={decided[item.id]} tone={decided[item.id] === "Approved" ? "good" : "bad"} palette={p} /> : <Feather name="chevron-right" size={18} color={p.muted} />}
          </MotionPress>
        ))}
      </View>
      <Sheet palette={p} visible={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ""} subtitle={open ? `${open.team} team${open.amount ? " · " + open.amount : ""}` : ""} icon={open?.icon}>
        {open && <>
          <Text style={[ui.body, { color: p.text }]}>{open.detail}</Text>
          {decided[open.id] ? <Notice icon="check-circle" title={`${decided[open.id]}`} detail={`The ${open.team} team has been notified.`} palette={p} /> : (
            <View style={[ui.row, { gap: 10 }]}>
              <MotionPress accessibilityRole="button" onPress={() => { setDecided(current => ({ ...current, [open.id]: "Declined" })); setOpenId(null); }} style={[ui.button, { flex: 1, backgroundColor: p.wash }]}><Text style={[ui.buttonText, { color: p.primary }]}>Decline</Text></MotionPress>
              <MotionPress accessibilityRole="button" onPress={() => { setDecided(current => ({ ...current, [open.id]: "Approved" })); setOpenId(null); }} style={[ui.button, { flex: 1, backgroundColor: p.primary }]}><Text style={[ui.buttonText, { color: p.onPrimary }]}>Approve</Text></MotionPress>
            </View>
          )}
        </>}
      </Sheet>
    </Entrance>
  );
}

export function AccountsOverview({ palette: p, columns, onInvoices, onStatements }: { palette: Palette; columns: 2 | 4; onInvoices: () => void; onStatements: () => void }) {
  const expenses = useExpenses();
  const waiting = expenses.filter(expense => expense.status === "to-approve");
  const items = [
    { icon: "clipboard" as const, value: String(waiting.length), label: "Invoices to approve", onPress: onInvoices },
    { icon: "coins" as const, value: formatMoney(waiting.reduce((sum, expense) => sum + expense.amountMinor, 0)), label: "Waiting value", onPress: onInvoices },
    { icon: "chart" as const, value: String(clientPortfolio().perProperty.length), label: "Statements this month", onPress: onStatements },
    { icon: "chat" as const, value: String(expenses.filter(expense => expense.status === "queried").length), label: "Queries open", onPress: onInvoices },
  ];
  return (
    <Entrance sessionKey="accounts:overview" style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Accounts at a glance</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {items.map(item => (
          <MotionPress key={item.label} accessibilityRole="button" accessibilityLabel={`${item.value} ${item.label}`} onPress={item.onPress} style={{ flexBasis: columns === 4 ? 0 : "46%", flexGrow: 1, minWidth: 0, padding: 14, gap: 10, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, ...shadow }}>
            <View style={ui.between}><View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={item.icon} size={38} /></View><Feather name="chevron-right" size={18} color={p.muted} /></View>
            <View><Text style={{ color: p.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.8 }}>{item.value}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{item.label}</Text></View>
          </MotionPress>
        ))}
      </View>
    </Entrance>
  );
}
