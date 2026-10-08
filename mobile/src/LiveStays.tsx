import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { useCelebrate, useSaved } from "./Celebrate";
import { MotionPress, Pop } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId, Loading, StatGrid, StatTile } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { readOperations, readTeams, writeFinance, writeOperation, writeTeams, WorkspaceApiError } from "./backend/client";
import { signoffSchema, type Signoff } from "../../lib/management-live";
import { workDetails } from "../../lib/work-details";
import { plural } from "../../lib/format";
import { scheduleSchema } from "../../lib/cleans-live";
import { dailyChecks, recordedReservationSchema, vacantNights } from "../../lib/management-live";
import { poundsToMinor } from "../../lib/repairs-live";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Live Stays: arrivals, departures and cleans by day, recording stays with their
// platform details, and the daily listing and pricing checks. Backend data only.
type Schedule = z.infer<typeof scheduleSchema>;
type Operation = z.infer<typeof operationViewSchema>;
const CHANNELS = ["airbnb", "booking_com", "vrbo", "direct", "other"] as const;
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo", direct: "Direct", other: "Other" };
const PLATFORMS = ["Airbnb", "Booking.com", "Direct", "Comfy Workers"] as const;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));

function PropertyPills({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string; onChange: (id: string) => void }) {
  if (!properties.length) return <Notice text="No properties are assigned to you yet." p={p} />;
  return <Pills p={p} values={properties.map(x => x.id)} value={value} onChange={onChange} label={id => properties.find(x => x.id === id)?.name ?? "Property"} />;
}
function Check({ p, label, value, onChange }: { p: Palette; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 10, borderRadius: 14, backgroundColor: value ? p.wash : "transparent" }]}>
      {/* The box fills and springs when ticked. */}
      <Pop active={value}><View style={{ width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.primary, backgroundColor: value ? p.primary : "transparent" }}>{value && <Feather name="check" size={15} color={p.onPrimary} />}</View></Pop>
      <Text style={{ color: p.text, flex: 1, fontWeight: value ? "600" : "400" }}>{label}</Text>
    </MotionPress>
  );
}

function StaySheet({ p, visible, properties, onClose, onDone }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [propertyId, setPropertyId] = useState("");
  const [reference, setReference] = useState("");
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 2));
  const [status, setStatus] = useState<"confirmed" | "enquiry">("confirmed");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("airbnb");
  const [code, setCode] = useState("");
  const [guests, setGuests] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stayKey = ["stay", propertyId, reference.trim(), checkIn, checkOut, status].join(":");
  const stayRequest = useRequestId(visible ? stayKey : null);
  // If the stay saved but its platform details didn't, a retry only resends the details.
  const [savedStay, setSavedStay] = useState<{ key: string; id: string; version: number } | null>(null);
  const detailsRequest = useRequestId(visible ? ["details", propertyId, reference.trim(), checkIn, channel, code, guests, payout].join(":") : null);
  const platform = channel === "airbnb" || channel === "booking_com";
  async function save() {
    if (busy) return;
    const payoutMinor = payout.trim() ? poundsToMinor(payout) : null, guestCount = guests.trim() ? Number(guests) : null;
    if (!propertyId || !reference.trim() || !isDate(checkIn) || !isDate(checkOut) || checkOut <= checkIn) { setError("Choose the property, add a guest name or reference, and dates where check-out is after check-in."); return; }
    if (platform && !code.trim()) { setError("Add the platform reservation code so Accounts can match the payout."); return; }
    if (payout.trim() && payoutMinor === null) { setError("Enter the payout in pounds, for example 460.00."); return; }
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50)) { setError("Guests must be a number from 1 to 50."); return; }
    setBusy(true); setError("");
    try {
      let stay = savedStay?.key === stayKey ? savedStay : null;
      if (!stay) {
        const recorded = recordedReservationSchema.parse((await writeOperation({ action: "recordReservation", requestId: stayRequest.get(), propertyId, reference: reference.trim(), checkIn, checkOut, status })).data);
        stayRequest.done();
        stay = { key: stayKey, id: recorded.reservation.id, version: recorded.reservation.version };
        setSavedStay(stay);
      }
      const saved = { reservation: { id: stay.id, version: stay.version } };
      try {
        await writeFinance({ action: "setReservationFinancials", requestId: detailsRequest.get(), propertyId, reservationId: saved.reservation.id, version: saved.reservation.version, channel, ...(code.trim() ? { channelReference: code.trim() } : {}), guests: guestCount, payoutMinor });
        detailsRequest.done();
      } catch (e) {
        setError(`The stay is saved, but its platform details were not: ${message(e)} Accounts will see it under stays missing details.`);
        await onDone(); return;
      }
      setSavedStay(null); setReference(""); setCode(""); setGuests(""); setPayout(""); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Record a stay" subtitle="Accounts uses the platform code to match the payout" icon="calendar">
      <PropertyPills p={p} properties={properties} value={propertyId} onChange={setPropertyId} />
      <Field label="Guest name or booking reference" value={reference} onChange={setReference} p={p} />
      <View style={[ui.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field label="Check-in (YYYY-MM-DD)" value={checkIn} onChange={setCheckIn} p={p} /></View>
        <View style={{ flex: 1 }}><Field label="Check-out" value={checkOut} onChange={setCheckOut} p={p} /></View>
      </View>
      <Pills p={p} values={["confirmed", "enquiry"] as const} value={status} onChange={setStatus} label={v => v === "confirmed" ? "Confirmed" : "Enquiry"} />
      <Pills p={p} values={CHANNELS} value={channel} onChange={setChannel} label={v => CHANNEL_LABEL[v]} />
      {platform && <Field label={channel === "airbnb" ? "Airbnb confirmation code" : "Booking.com reservation number"} value={code} onChange={setCode} p={p} placeholder={channel === "airbnb" ? "HM…" : "10 digits"} />}
      <View style={[ui.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field label="Guests (optional)" value={guests} onChange={setGuests} p={p} /></View>
        <View style={{ flex: 1 }}><Field label="Payout (optional)" value={payout} onChange={setPayout} p={p} placeholder="£0.00" /></View>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save stay"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

function ListingSheet({ p, property, onClose, onDone }: { p: Palette; property: PropertyView | null; onClose: () => void; onDone: () => Promise<void> }) {
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

function PricingSheet({ p, target, onClose, onDone }: { p: Palette; target: { property: PropertyView; nights: string[] } | null; onClose: () => void; onDone: () => Promise<void> }) {
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
      {target && <Pills p={p} values={target.nights} value={night} onChange={setNight} label={dayLabel} />}
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
function ReviewSheet({ p, property, onClose, onDone }: { p: Palette; property: PropertyView | null; onClose: () => void; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("Airbnb");
  const [outOf, setOutOf] = useState<5 | 10>(5);
  const [rating, setRating] = useState(5);
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number]>("positive");
  const [summary, setSummary] = useState("");
  const [response, setResponse] = useState("");
  const [relist, setRelist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(property ? ["review", property.id, platform, summary.trim()].join(":") : null);
  const scale = (n: 5 | 10) => { setOutOf(n); setPlatform(n === 10 ? "Booking.com" : platform === "Booking.com" ? "Airbnb" : platform); setRating(r => Math.min(r, n)); };
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {Array.from({ length: outOf }, (_, i) => i + 1).map(n => (
          <MotionPress key={n} accessibilityRole="radio" accessibilityLabel={`${n} out of ${outOf}`} accessibilityState={{ selected: rating === n }} onPress={() => { setRating(n); setSentiment(n / outOf >= 0.8 ? "positive" : n / outOf >= 0.6 ? "neutral" : "negative"); }}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: rating === n ? p.primary : p.surface, borderWidth: 1, borderColor: rating === n ? p.primary : p.border }}>
            <Text style={{ color: rating === n ? p.onPrimary : p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{n}</Text>
          </MotionPress>
        ))}
      </View>
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

// The end-of-day sign-off: every listing visible, reviews handled, suspensions dealt with, re-listings done.
function SignOffCard({ p, refreshKey }: { p: Palette; refreshKey: number }) {
  const celebrate = useCelebrate();
  const [state, setState] = useState<Signoff | null>(null);
  const [ticks, setTicks] = useState({ allVisible: false, reviewsHandled: false, suspensionsHandled: false, relistingsDone: false });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(state && !state.mine ? "signoff:" + state.today : null);
  const load = useCallback(async () => { try { setState(signoffSchema.parse((await readTeams({ section: "signoff" })).data)); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, refreshKey]);
  if (!state) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  if (state.mine) return (
    <View nativeID="stays-signoff" style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.successWash }]}>
      <Feather name="check-circle" size={20} color={p.success} />
      <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>Signed off today at {new Date(state.mine.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}{state.mine.note ? ` · ${state.mine.note}` : ""}</Text>
    </View>
  );
  const s = state.snapshot, all = Object.values(ticks).every(Boolean);
  async function sign() {
    if (busy) return;
    if (!all) { setError("Tick all four checks before signing off."); return; }
    if (s.openRelistings > 0 && note.trim().length < 5) { setError("Say where the open re-listings are up to."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "signOffDay", requestId: request.get(), ...ticks, allVisible: true, reviewsHandled: true, suspensionsHandled: true, relistingsDone: true, note: note.trim() }); request.done(); celebrate("Day signed off"); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof ticks) => (v: boolean) => setTicks(t => ({ ...t, [k]: v }));
  return (
    <View nativeID="stays-signoff" style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Today’s sign-off</Text>
      <Text style={[ui.small, { color: p.muted }]}>{plural(s.listingChecksToday, "listing check")} and {plural(s.reviewsToday, "review")} logged by you today · {plural(s.openRelistings, "re-listing")} open{s.flaggedToday ? ` · ${plural(s.flaggedToday, "listing")} flagged today` : ""}</Text>
      <Check p={p} label="Every listing is live and visible" value={ticks.allVisible} onChange={set("allVisible")} />
      <Check p={p} label="No bad review is left without a reply" value={ticks.reviewsHandled} onChange={set("reviewsHandled")} />
      <Check p={p} label="Any suspension has been dealt with" value={ticks.suspensionsHandled} onChange={set("suspensionsHandled")} />
      <Check p={p} label="Re-listings due are done or under way" value={ticks.relistingsDone} onChange={set("relistingsDone")} />
      {(s.openRelistings > 0 || all) && <Field label={s.openRelistings > 0 ? "Where the open re-listings are up to" : "Anything to hand over (optional)"} value={note} onChange={setNote} p={p} multiline />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Signing off…" : "Sign off today"} icon="check" primary p={p} disabled={busy} onPress={() => void sign()} />
    </View>
  );
}

export function LiveStays({ palette: p, properties, onOpenRepairs, onOpenWork }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onOpenRepairs: () => void; onOpenWork?: (item: Operation) => void }) {
  const saved = useSaved();
  const [today] = useState(() => london(new Date()));
  const weekEnd = addDays(today, 6);
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [operations, setOperations] = useState<Operation[]>([]);
  const [day, setDay] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [listingFor, setListingFor] = useState<PropertyView | null>(null);
  const [pricingFor, setPricingFor] = useState<{ property: PropertyView; nights: string[] } | null>(null);
  const [reviewFor, setReviewFor] = useState<PropertyView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [s, o] = await Promise.allSettled([readTeams({ section: "schedule", from: addDays(today, -1), to: addDays(today, 30) }), readOperations()]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (o.status === "fulfilled") setOperations(z.array(operationViewSchema).parse(o.value.data)); else throw o.reason;
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Stays could not be loaded. Refresh to try again."); }
    setRefreshKey(k => k + 1);
    setLoading(false);
  }, [today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const week = days.slice(0, 7);
  const arrivals = schedule.stays.filter(s => s.checkIn === day), departures = schedule.stays.filter(s => s.checkOut === day);
  const cleans = schedule.work.filter(w => w.kind === "cleaning" && w.dueOn === day);
  type DayRow = { key: string; title: string; detail: string; tag: [string, "good" | "wait" | "plain"] };
  const dayRows: DayRow[] = [
    ...arrivals.map(s => ({ key: "in" + s.reservationId, title: `Arrival · ${s.propertyName}`, detail: `Until ${dayLabel(s.checkOut)}${s.guests ? ` · ${s.guests} guests` : ""}`, tag: ["Check-in", "good"] as DayRow["tag"] })),
    ...departures.map(s => ({ key: "out" + s.reservationId, title: `Departure · ${s.propertyName}`, detail: `Arrived ${dayLabel(s.checkIn)}`, tag: ["Check-out", "plain"] as DayRow["tag"] })),
    ...cleans.map(w => ({ key: w.workId, title: `Clean · ${w.propertyName}`, detail: w.assigneeName ? `Assigned to ${w.assigneeName}` : "No cleaner assigned yet", tag: (w.assigneeId ? ["Assigned", "good"] : ["Unassigned", "wait"]) as DayRow["tag"] })),
  ];
  const toRefer = operations.filter(op => op.kind === "maintenance" && op.data.phase === "triage").length;
  const checks = dailyChecks(properties.map(x => x.id), operations, today, weekEnd);
  const listingsDue = checks.filter(c => !c.listingCheckedToday).length;
  const relistings = operations.filter(op => op.kind === "relisting" && !["completed", "cancelled"].includes(op.status));
  const nameOf = (id: string) => properties.find(x => x.id === id)?.name ?? "Property";

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Stays</Text>
        <Text style={[ui.body, { color: p.muted }]}>Arrivals, departures, cleans and the daily listing and pricing checks.</Text>
      </View>
      <StatGrid>
        <StatTile p={p} icon="log-in" tone="stays" label="Arrivals" value={schedule.stays.filter(s => s.checkIn === today).length} detail="Today" />
        <StatTile p={p} icon="log-out" tone="stays" label="Departures" value={schedule.stays.filter(s => s.checkOut === today).length} detail="Today" />
        <StatTile p={p} icon="check-square" tone="stays" label="Listings to check" value={listingsDue} detail="Daily listing check" attention={listingsDue > 0} />
      </StatGrid>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label="Record a stay" icon="plus" primary p={p} onPress={() => setRecording(true)} />
        <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
      </View>
      <SignOffCard p={p} refreshKey={refreshKey} />
      {toRefer > 0 && <MotionPress accessibilityRole="button" onPress={onOpenRepairs} style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.wash }]}>
        <Feather name="tool" size={18} color={p.primary} />
        <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{toRefer} repair{toRefer === 1 ? "" : "s"} waiting for you to refer to Ready</Text>
        <Feather name="chevron-right" size={18} color={p.muted} />
      </MotionPress>}

      {!!relistings.length && <Section title="Re-listings" count={relistings.length} p={p}>
        <List p={p} empty="">
          {relistings.map((r, i) => {
            const why = workDetails(r).find(d => d.label === "Why")?.value ?? "To re-list";
            return <Row key={r.workId} p={p} first={i === 0} icon="refresh-cw" tone="stays" title={nameOf(r.propertyId)} detail={[why, typeof r.data.platform === "string" ? r.data.platform : ""].filter(Boolean).join(" · ")}
              tags={[[r.data.phase === "relisting" ? "Under way" : "To start", r.data.phase === "relisting" ? "plain" : "wait"]]} onPress={onOpenWork ? () => onOpenWork(r) : undefined} />;
          })}
        </List>
      </Section>}

      <Section title="Day by day" p={p}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map(d => {
            const on = d === day, busy = schedule.stays.some(s => s.checkIn === d || s.checkOut === d);
            return (
              <MotionPress key={d} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setDay(d)} style={{ minWidth: 64, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 16, alignItems: "center", gap: 2, backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
                <Text style={{ color: on ? p.onPrimary : p.muted, fontSize: 11, fontWeight: "600" }}>{d === today ? "Today" : dayLabel(d).split(" ")[0]}</Text>
                <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 17, fontWeight: "700" }}>{Number(d.slice(8))}</Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: busy ? (on ? p.onPrimary : p.primary) : "transparent" }} />
              </MotionPress>
            );
          })}
        </ScrollView>
        <List p={p} empty={`No arrivals, departures or cleans on ${dayLabel(day)}.`}>
          {dayRows.map((r, i) => <Row key={r.key} p={p} first={i === 0} title={r.title} detail={r.detail} tags={[r.tag]} />)}
        </List>
      </Section>

      <Section title="Daily checks" count={listingsDue} p={p}>
        {properties.map(property => {
          const check = checks.find(c => c.propertyId === property.id)!;
          const vacant = vacantNights(property.id, schedule.stays, week);
          const unpriced = vacant.filter(n => !operations.some(op => op.propertyId === property.id && op.kind === "daily_pricing" && op.data.night === n));
          return (
            <View key={property.id} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
              <View style={[ui.between, { gap: 10 }]}>
                <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{property.name}</Text>
                <Tag label={check.listingCheckedToday ? "Listing checked" : "Listing check due"} tone={check.listingCheckedToday ? "good" : "wait"} p={p} />
              </View>
              {check.suspended && <Notice text="A listing was reported suspended today. Contact the platform." p={p} tone="bad" />}
              {check.negativeReview && <Notice text="A negative review came in today. Make sure it has a reply." p={p} />}
              <Text style={[ui.small, { color: p.muted }]}>{vacant.length ? `${vacant.length} empty night${vacant.length === 1 ? "" : "s"} this week · ${check.pricedNights} priced` : "Fully booked for the next 7 nights"}</Text>
              <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
                <Button label="Listing check" icon="check-circle" p={p} onPress={() => setListingFor(property)} />
                <Button label="Log a review" icon="star" p={p} onPress={() => setReviewFor(property)} />
                {unpriced.length > 0 && <Button label="Price a night" icon="trending-down" p={p} onPress={() => setPricingFor({ property, nights: unpriced })} />}
              </View>
            </View>
          );
        })}
        {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
      </Section>

      <StaySheet p={p} visible={recording} properties={properties} onClose={() => setRecording(false)} onDone={saved(load)} />
      <ListingSheet p={p} property={listingFor} onClose={() => setListingFor(null)} onDone={saved(load)} />
      <PricingSheet p={p} target={pricingFor} onClose={() => setPricingFor(null)} onDone={saved(load)} />
      <ReviewSheet p={p} property={reviewFor} onClose={() => setReviewFor(null)} onDone={saved(load)} />
    </View>
  );
}
