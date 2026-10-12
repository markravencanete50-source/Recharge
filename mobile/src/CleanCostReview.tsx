import { useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Tag, useRequestId } from "./LiveKit";
import { writeFinance } from "./backend/client";
import { formatDay, formatMoney } from "../../lib/format";
import { DECISION_LABEL, overrunMinor, REVIEW_NOTE_MAX, reviewCleanAction, reviewTag, STALE_REVIEW_LABEL, type ChargeDecision } from "../../lib/accounts-work";
import type { CleanCostReview } from "../../lib/accounts-live";

// A clean that cost more than the owner is charged: Accounts see both figures and choose which one the owner pays,
// with a reason. Staff only; owners never reach this sheet. The choice is saved with reviewCleanCost.
const CHOICES: ChargeDecision[] = ["agreed_fee", "actual_cost"];

function Figure({ p, label, value, bad = false }: { p: Palette; label: string; value: string; bad?: boolean }) {
  return <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: p.muted, flex: 1 }]}>{label}</Text><Text style={{ color: bad ? p.danger : p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text></View>;
}

function ReviewForm({ p, clean, onDone }: { p: Palette; clean: CleanCostReview; onDone: () => Promise<void> }) {
  const [decision, setDecision] = useState<ChargeDecision | null>(clean.decision);
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
      {clean.state === "stale" && <Notice text={`${STALE_REVIEW_LABEL}. The earlier choice was made on an older cost, so choose again.`} p={p} tone="bad" />}
      {clean.state === "reviewed" && !!clean.decision && <Notice text={`Reviewed: the owner is charged the ${clean.decision === "actual_cost" ? "actual cost" : "agreed fee"}.${clean.note ? " " + clean.note : ""}`} p={p} />}
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {CHOICES.map(choice => {
          const on = decision === choice;
          return (
            <MotionPress key={choice} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${DECISION_LABEL[choice]}, ${formatMoney(choice === "agreed_fee" ? clean.agreedMinor : clean.actualMinor)}`} onPress={() => setDecision(choice)}
              style={[ui.row, { gap: 10, minHeight: 52, padding: 12, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
              <Feather name={on ? "check-circle" : "circle"} size={18} color={on ? p.primary : p.muted} />
              <Text style={{ flex: 1, color: p.text, fontWeight: on ? "600" : "400" }}>{DECISION_LABEL[choice]}</Text>
              <Text style={{ color: p.text, fontVariant: ["tabular-nums"] }}>{formatMoney(choice === "agreed_fee" ? clean.agreedMinor : clean.actualMinor)}</Text>
            </MotionPress>
          );
        })}
      </View>
      <Field label="Reason (5 to 2,000 characters)" value={note} onChange={setNote} p={p} multiline placeholder="For example: extra linen change after a late check-out" />
      <Text style={[ui.small, { color: note.trim().length > REVIEW_NOTE_MAX ? p.danger : p.muted, fontVariant: ["tabular-nums"] }]}>{note.trim().length.toLocaleString("en-GB")} of {REVIEW_NOTE_MAX.toLocaleString("en-GB")} characters</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : clean.state === "reviewed" ? "Save the new decision" : "Confirm review"} icon="check" primary p={p} disabled={busy} onPress={() => void submit()} />
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
