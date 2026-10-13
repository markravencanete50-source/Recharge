import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Tag, useRequestId } from "./LiveKit";
import { writeFinance } from "./backend/client";
import { formatDay, formatMoney } from "../../lib/format";
import { overrunMinor, REVIEW_NOTE_MAX, reviewCleanAction, reviewTag, STALE_REVIEW_LABEL, type ChargeDecision } from "../../lib/accounts-work";
import type { CleanCostReview } from "../../lib/accounts-live";

// A clean whose invoice is above what the owner is charged: Accounts see both figures and note why, with a reason.
// The owner always pays the agreed fee (client answer 4), so the review only records that the cost was looked at; the
// statement never waits for it. Staff only; owners never reach this sheet. Saved with reviewCleanCost as 'agreed_fee'.

function Figure({ p, label, value, bad = false }: { p: Palette; label: string; value: string; bad?: boolean }) {
  return <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: p.muted, flex: 1 }]}>{label}</Text><Text style={{ color: bad ? p.danger : p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text></View>;
}

function ReviewForm({ p, clean, onDone }: { p: Palette; clean: CleanCostReview; onDone: () => Promise<void> }) {
  const decision: ChargeDecision = "agreed_fee";
  const [note, setNote] = useState(clean.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The same choice and reason for the same cost replays the first request; any change is a new one.
  const request = useRequestId(["review", clean.workId, clean.actualMinor ?? "", decision ?? "", note.trim()].join(":"));
  const over = overrunMinor(clean);
  const [tagLabel, tagTone] = reviewTag(clean);
  async function submit() {
    if (busy) return;
    const built = reviewCleanAction({ requestId: request.get(), workId: clean.workId, decision, note });
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try { await writeFinance(built.action); request.done(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <View style={{ gap: 8 }}>
        <Tag label={tagLabel} tone={tagTone} p={p} />
        <Figure p={p} label="Charged to the owner" value={formatMoney(clean.agreedMinor)} />
        <Figure p={p} label="Actual cost of the clean" value={formatMoney(clean.actualMinor)} />
        {over !== null && <Figure p={p} label="Over what the owner is charged" value={formatMoney(over)} bad />}
        {!!clean.cleanerName && <Figure p={p} label="Cleaner" value={clean.cleanerName} />}
        <Figure p={p} label="Clean date" value={formatDay(clean.cleanDate)} />
      </View>
      {clean.state === "stale" && <Notice text={`${STALE_REVIEW_LABEL}. The earlier review was made on an older cost, so review it again.`} p={p} tone="bad" />}
      {clean.state === "reviewed" && <Notice text={`Reviewed.${clean.note ? " " + clean.note : ""}`} p={p} />}
      <Notice text="The owner is charged the agreed fee for this clean. The difference is the business's cost, used for profitability." p={p} />
      <Field label="Why it cost more (5 to 2,000 characters)" value={note} onChange={setNote} p={p} multiline placeholder="For example: extra linen change after a late check-out" />
      <Text style={[ui.small, { color: note.trim().length > REVIEW_NOTE_MAX ? p.danger : p.muted, fontVariant: ["tabular-nums"] }]}>{note.trim().length.toLocaleString("en-GB")} of {REVIEW_NOTE_MAX.toLocaleString("en-GB")} characters</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : clean.state === "reviewed" ? "Save the new reason" : "Confirm review"} icon="check" primary p={p} disabled={busy} onPress={() => void submit()} />
    </>
  );
}

export function CleanCostReviewSheet({ p, clean, address, onClose, onDone }: { p: Palette; clean: CleanCostReview | null; address?: string; onClose: () => void; onDone: () => Promise<void> }) {
  return (
    <Sheet palette={p} visible={!!clean} onClose={onClose} title="Review the cost of a clean" subtitle={clean ? `${address || clean.propertyName} · ${formatDay(clean.cleanDate)}` : undefined} icon="coins">
      {clean && <ReviewForm key={[clean.workId, clean.actualMinor ?? "", clean.state].join(":")} p={p} clean={clean} onDone={onDone} />}
    </Sheet>
  );
}
