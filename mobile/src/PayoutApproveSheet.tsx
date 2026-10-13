import { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Notice, message, useRequestId } from "./LiveKit";
import { readFinance, writeFinance } from "./backend/client";
import { pounds, type PayoutRow } from "../../lib/accounts-live";
import { poundsToMinor } from "../../lib/repairs-live";
import { approvalLine, payoutStaySchema, payoutSummary, type PayoutStay } from "../../lib/payout-summary";

// "Approve the payout": what is being approved first (the property, the guest, the platform and booking, the stay, the money,
// the payout lines and any warning, lib/payout-summary.ts), then the amount, the note and the button as before. Staff only.
// The extra details come from the 'payoutStay' report; until the database has it, the sheet shows what the row holds.
export function PayoutApproveSheet({ p, row, property, onClose, onDone }: { p: Palette; row: PayoutRow | null; property?: { name?: string; address?: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const [stay, setStay] = useState<PayoutStay | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const minor = poundsToMinor(amount);
  const request = useRequestId(row ? `${row.reservationId}:${row.version}:${minor}:${note.trim()}` : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setStay(null); setError(""); setNote("");
      setAmount(row ? ((((row.state === "agreed" ? row.agreedMinor : null) ?? row.receivedMinor ?? row.expectedMinor ?? 0) / 100).toFixed(2)) : "");
      if (!row) return;
      setLoading(true);
      readFinance({ section: "payoutStay", id: row.reservationId })
        .then(r => { if (active) setStay(payoutStaySchema.parse(r.data)); })
        .catch(() => { if (active) setStay(null); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [row]);

  async function save() {
    if (!row || busy) return;
    if (minor === null) { setError("Enter the amount in pounds, for example 450.00."); return; }
    if (note.trim().length < 5) { setError(minor === row.expectedMinor ? "Write at least 5 characters." : "The amount is not the expected one, so say why it is right (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "agreePayout", requestId: request.get(), reservationId: row.reservationId, version: row.version, agreedMinor: minor, note: note.trim() });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const summary = row ? payoutSummary(row, stay, { propertyName: property?.name, propertyAddress: property?.address, loading }) : null;
  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title="Approve the payout" subtitle={row ? `${row.reference} · expected ${pounds(row.expectedMinor)}, received ${pounds(row.receivedMinor)}` : undefined} icon="coins">
      {!!summary && <View style={{ gap: 14 }}>
        {summary.warnings.map(w => <Notice key={w} text={w} p={p} tone="bad" />)}
        {summary.groups.map(g => (
          <View key={g.title} style={{ gap: 4 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{g.title}</Text>
            {g.items.map(item => (
              <View key={item.label} accessible accessibilityLabel={`${item.label}: ${item.value}`} style={{ flexDirection: wide ? "row" : "column", gap: wide ? 12 : 0 }}>
                <Text style={[ui.small, { color: p.muted, width: wide ? 160 : undefined }]}>{item.label}</Text>
                <Text style={{ flex: wide ? 1 : undefined, color: item.tone === "bad" ? p.danger : item.tone === "muted" ? p.muted : p.text, fontSize: 14, fontWeight: item.tone === "bad" ? "600" : "400", fontVariant: ["tabular-nums"] }}>{item.value}</Text>
              </View>
            ))}
          </View>
        ))}
        {summary.lines.length > 0 && <View style={{ gap: 4 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Matched payout lines</Text>
          {summary.lines.map(l => (
            <View key={l.when + l.reference + l.amount} style={{ flexDirection: wide ? "row" : "column", gap: wide ? 12 : 0 }}>
              <Text style={[ui.small, { color: p.muted, width: wide ? 160 : undefined }]}>{l.when}</Text>
              <Text style={[ui.small, { flex: wide ? 1 : undefined, color: l.setAside ? p.muted : p.text }]}>{l.reference}{l.setAside ? " (set aside)" : ""}</Text>
              <Text style={{ color: l.setAside ? p.muted : p.text, fontSize: 14, fontVariant: ["tabular-nums"] }}>{l.amount}</Text>
            </View>
          ))}
        </View>}
        <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{approvalLine(row!, minor, stay)}</Text>
      </View>}
      <Field label="Amount to approve" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
      <Field label="Why this amount is right" value={note} onChange={setNote} p={p} multiline />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Approve payout"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}
