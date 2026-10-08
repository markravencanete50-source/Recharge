import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress, SwapIn } from "./motion";
import { Button, Field, Loading, message, Notice, Tag, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { cleanerRateAction, monthPay, performanceSchema, type CleanerMonth } from "../../lib/cleans-live";
import { formatMoney } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";

// A cleaner's pay: their month on Home (cleans accepted and rejected, any warning, and what the month
// comes to at their rate), and the sheet admins and cleaning managers use to set the rate per clean.

export function CleanerMonthCard({ palette: p, onOpen }: { palette: Palette; onOpen?: () => void }) {
  const [month, setMonth] = useState<CleanerMonth | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { setMonth(performanceSchema.parse((await readTeams({ section: "performance" })).data)[0] ?? null); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (failed) return null;
  const pay = monthPay(month ?? undefined);
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/London" });
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: month?.warning ? p.danger : p.border, gap: 14 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <Text style={{ color: p.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>YOUR MONTH</Text>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>{monthName}</Text>
        </View>
        {month && <Tag label={month.warning ? "Warning" : "Good standing"} tone={month.warning ? "bad" : "good"} p={p} />}
      </View>
      {!month ? <Loading p={p} rows={1} /> : <>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[["Accepted", month.accepted, "check-circle", p.success], ["Rejected", month.rejected, "x-circle", month.rejected ? p.danger : p.muted]].map(([label, value, icon, colour]) => (
            <View key={label as string} accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 16, backgroundColor: p.wash, gap: 4 }}>
              <View style={[ui.row, { gap: 6 }]}><Feather name={icon as "check-circle"} size={14} color={colour as string} /><Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{label as string}</Text></View>
              <Text style={{ color: p.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{String(value)}</Text>
            </View>
          ))}
        </View>
        <SwapIn swapKey={pay.label} style={{ gap: 2 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Amount for this month</Text>
          <Text style={{ color: pay.amountMinor === null ? p.muted : p.text, fontSize: pay.amountMinor === null ? 16 : 26, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{pay.label}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{pay.detail}</Text>
        </SwapIn>
        {month.overturned > 0 && <Text style={[ui.small, { color: p.muted }]}>{month.overturned} rejection{month.overturned === 1 ? " was" : "s were"} overturned and no longer count against you.</Text>}
        {month.warning && <Notice text={`You have ${month.rejected} rejected cleans this month. Management will review your work.`} p={p} tone="bad" />}
        {!!month.openComplaints.length && <Notice text={`${month.openComplaints.length} rejected clean${month.openComplaints.length === 1 ? " is" : "s are"} waiting for management. Give your side in Work, Cleans.`} p={p} />}
      </>}
      {!!onOpen && <MotionPress accessibilityRole="button" accessibilityLabel="Open your cleans" onPress={onOpen} style={[ui.between, { minHeight: 44 }]}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Open your cleans</Text>
        <Feather name="arrow-right" size={16} color={p.primary} />
      </MotionPress>}
    </View>
  );
}

// Set a cleaner's pay per clean. Version 0 means no rate is set yet.
export function RateSheet({ p, cleaner, onClose, onDone }: { p: Palette; cleaner: Pick<CleanerMonth, "cleanerId" | "fullName" | "rateMinor" | "rateVersion"> | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(cleaner ? ["rate", cleaner.cleanerId, cleaner.rateVersion ?? 0, amount.trim()].join(":") : null);
  useEffect(() => { queueMicrotask(() => { setAmount(cleaner?.rateMinor ? (cleaner.rateMinor / 100).toFixed(2) : ""); setError(""); }); }, [cleaner]);
  async function save() {
    if (!cleaner || busy) return;
    const minor = poundsToMinor(amount);
    if (!minor || minor > 100000) { setError("Enter the pay for one clean, up to £1,000."); return; }
    setBusy(true); setError("");
    try { await writeTeams(cleanerRateAction({ requestId: request.get(), cleanerId: cleaner.cleanerId, rateMinor: minor, version: cleaner.rateVersion ?? 0 })); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!cleaner} onClose={onClose} title="Pay per clean" subtitle={cleaner?.fullName} icon="coins">
      <Text style={[ui.body, { color: p.text }]}>What this cleaner is paid for each accepted clean. They see their month&apos;s amount on Home, and Accounts sees it when invoicing their cleans.</Text>
      {cleaner?.rateMinor ? <Text style={[ui.small, { color: p.muted }]}>Currently {formatMoney(cleaner.rateMinor)} a clean.</Text> : <Text style={[ui.small, { color: p.muted }]}>No rate is set yet.</Text>}
      <Field label="Pay per clean" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save rate"} icon="check" primary p={p} disabled={busy || !amount.trim()} onPress={() => void save()} />
    </Sheet>
  );
}
