import { useEffect, useState } from "react";
import { Text } from "./Typography";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { writeTeams } from "./backend/client";
import { cleanerRateAction, type CleanerMonth } from "../../lib/cleans-live";
import { formatMoney } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";

// A cleaner's pay: their month on Home (cleans accepted and rejected, any warning, and what the month
// comes to at their rate), and the sheet admins and cleaning managers use to set the rate per clean.

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
