import { useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ChoiceField, ChoicePills } from "./ChoiceField";
import { MotionPress, Pop } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, dayLabel, Field, london, message, Notice, useRequestId } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { writeOperation } from "./backend/client";
import { poundsToMinor } from "../../lib/repairs-live";
import { type PropertyView } from "../../lib/workspace-view";

const PLATFORMS = ["Airbnb", "Booking.com", "Direct", "Comfy Workers"] as const;

export function Check({ p, label, value, onChange }: { p: Palette; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 10, borderRadius: 14, backgroundColor: value ? p.wash : "transparent" }]}>
      {/* The box fills and springs when ticked. */}
      <Pop active={value}><View style={{ width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.primary, backgroundColor: value ? p.primary : "transparent" }}>{value && <Feather name="check" size={15} color={p.onPrimary} />}</View></Pop>
      <Text style={{ color: p.text, flex: 1, fontWeight: value ? "600" : "400" }}>{label}</Text>
    </MotionPress>
  );
}

export function ListingSheet({ p, property, onClose, onDone }: { p: Palette; property: PropertyView | null; onClose: () => void; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("Airbnb");
  const [visible, setVisible] = useState(true);
  const [review, setReview] = useState<"none" | "positive" | "negative">("none");
  const [acknowledged, setAcknowledged] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [relist, setRelist] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(property ? ["listing", property.id, today, platform].join(":") : null);
  async function save() {
    if (!property || busy) return;
    if (evidence.trim().length < 5) { setError("Note what you checked (at least 5 characters)."); return; }
    if (review !== "none" && !acknowledged) { setError("Acknowledge the new review before saving."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "createOperation", requestId: request.get(), propertyId: property.id, kind: "listing_health", data: { checkedOn: today, platform, listingVisible: visible, reviewSentiment: review, reviewAcknowledged: review === "none" ? false : acknowledged, suspended, evidence: evidence.trim(), relist: relist && review === "negative" } });
      request.done(); setEvidence(""); setReview("none"); setAcknowledged(false); setSuspended(false); setRelist(false); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!property} onClose={onClose} title="Listing check" subtitle={property?.name} icon="compass">
      <Pills p={p} values={PLATFORMS} value={platform} onChange={setPlatform} label={v => v} />
      <Check p={p} label="The listing is live and visible" value={visible} onChange={setVisible} />
      <Check p={p} label="The listing is suspended" value={suspended} onChange={setSuspended} />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>New review since the last check</Text>
      <Pills p={p} values={["none", "positive", "negative"] as const} value={review} onChange={setReview} label={v => ({ none: "None", positive: "Positive", negative: "Negative" })[v]} />
      {review !== "none" && <Check p={p} label="I have read and acknowledged the review" value={acknowledged} onChange={setAcknowledged} />}
      {review === "negative" && <Check p={p} label="Re-list the property because of this review" value={relist} onChange={setRelist} />}
      {(!visible || suspended) && <Text style={[ui.small, { color: p.muted }]}>A hidden or suspended listing goes on the re-listing list automatically.</Text>}
      <Field label="What you checked" value={evidence} onChange={setEvidence} p={p} multiline placeholder="For example: photos, price and calendar match; replied to the review" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save check"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

export function PricingSheet({ p, target, onClose, onDone }: { p: Palette; target: { property: PropertyView; nights: string[] } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [night, setNight] = useState("");
  const [current, setCurrent] = useState("");
  const [proposed, setProposed] = useState("");
  const [decision, setDecision] = useState<"hold" | "change">("hold");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(target ? ["pricing", target.property.id, night].join(":") : null);
  useEffect(() => { queueMicrotask(() => { if (target) { setNight(target.nights[0] ?? ""); setError(""); } }); }, [target]);
  async function save() {
    if (!target || busy) return;
    const currentRateMinor = poundsToMinor(current), proposedRateMinor = poundsToMinor(decision === "hold" ? current : proposed);
    if (!night || currentRateMinor === null || proposedRateMinor === null || reason.trim().length < 5) { setError("Choose the night, add the current rate, the new rate if changing, and why."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "createOperation", requestId: request.get(), propertyId: target.property.id, kind: "daily_pricing", data: { night, currentRateMinor, proposedRateMinor, decision, reason: reason.trim() } });
      request.done(); setReason(""); setProposed(""); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title="Price a vacant night" subtitle={target?.property.name} icon="coins">
      {target && <ChoicePills p={p} name="Night" values={target.nights} value={night} onChange={setNight} label={dayLabel} />}
      <Field label="Current nightly rate" value={current} onChange={setCurrent} p={p} placeholder="£0.00" />
      <Pills p={p} values={["hold", "change"] as const} value={decision} onChange={setDecision} label={v => v === "hold" ? "Hold the rate" : "Change the rate"} />
      {decision === "change" && <Field label="New nightly rate" value={proposed} onChange={setProposed} p={p} placeholder="£0.00" />}
      <Field label="Why" value={reason} onChange={setReason} p={p} multiline placeholder="For example: local events, competitor rates, lead time" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save decision"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export function ReviewSheet({ p, property, onClose, onDone }: { p: Palette; property: PropertyView | null; onClose: () => void; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("Airbnb");
  const [outOf, setOutOf] = useState<5 | 10>(5);
  const [rating, setRating] = useState(5);
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number]>("positive");
  const rate = (n: number) => { setRating(n); setSentiment(n / outOf >= 0.8 ? "positive" : n / outOf >= 0.6 ? "neutral" : "negative"); };
  const [summary, setSummary] = useState("");
  const [response, setResponse] = useState("");
  const [relist, setRelist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(property ? ["review", property.id, platform, summary.trim()].join(":") : null);
  // Booking.com rates out of 10, the rest out of 5. The platform just picked is kept as it is.
  const scale = (n: 5 | 10) => { setOutOf(n); setRating(r => Math.min(r, n)); };
  async function save() {
    if (!property || busy) return;
    if (summary.trim().length < 5) { setError("Add what the guest said (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "createOperation", requestId: request.get(), propertyId: property.id, kind: "guest_review", data: { platform, reviewedOn: today, rating, outOf, sentiment, summary: summary.trim(), relist: relist && sentiment === "negative", ...(response.trim() ? { response: response.trim() } : {}) } });
      request.done(); setSummary(""); setResponse(""); setRelist(false); setSentiment("positive"); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!property} onClose={onClose} title="Log a guest review" subtitle={property?.name} icon="medal">
      <Pills p={p} values={PLATFORMS} value={platform} onChange={v => { setPlatform(v); if (v === "Booking.com") scale(10); else if (outOf === 10) scale(5); }} label={v => v} />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Rating out of {outOf}</Text>
      {/* Out of 5: five round buttons. Out of 10: one dropdown (the "fewer buttons" rule). */}
      {outOf > 5 ? <ChoiceField p={p} label={`Rating out of ${outOf}`} value={rating ? String(rating) : ""}
        options={[...(rating ? [] : [{ value: "", label: "Choose a rating" }]), ...Array.from({ length: outOf }, (_, i) => ({ value: String(i + 1), label: `${i + 1} out of ${outOf}` }))]}
        onChange={v => { const n = Number(v); if (n) rate(n); }} />
      : <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {Array.from({ length: outOf }, (_, i) => i + 1).map(n => (
          <MotionPress key={n} accessibilityRole="radio" accessibilityLabel={`${n} out of ${outOf}`} accessibilityState={{ selected: rating === n }} onPress={() => rate(n)}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: rating === n ? p.primary : p.surface, borderWidth: 1, borderColor: rating === n ? p.primary : p.border }}>
            <Text style={{ color: rating === n ? p.onPrimary : p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{n}</Text>
          </MotionPress>
        ))}
      </View>}
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Good or bad</Text>
      <Pills p={p} values={SENTIMENTS} value={sentiment} onChange={setSentiment} label={v => ({ positive: "Good", neutral: "Mixed", negative: "Bad" })[v]} />
      <Field label="What the guest said" value={summary} onChange={setSummary} p={p} multiline placeholder="The main points of the review" />
      <Field label="How it was handled (optional)" value={response} onChange={setResponse} p={p} multiline placeholder="For example: replied publicly, refunded one night" />
      {sentiment === "negative" && <Check p={p} label="Re-list the property because of this review" value={relist} onChange={setRelist} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save review"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}
