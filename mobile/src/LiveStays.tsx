import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { readOperations, readTeams, writeFinance, writeOperation, WorkspaceApiError } from "./backend/client";
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
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[ui.row, { gap: 12, minHeight: 48 }]}>
      <Feather name={value ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>{label}</Text>
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
      await writeOperation({ action: "createOperation", requestId: request.get(), propertyId: property.id, kind: "listing_health", data: { checkedOn: today, platform, listingVisible: visible, reviewSentiment: review, reviewAcknowledged: review === "none" ? false : acknowledged, suspended, evidence: evidence.trim() } });
      request.done(); setEvidence(""); setReview("none"); setAcknowledged(false); setSuspended(false); onClose(); await onDone();
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

export function LiveStays({ palette: p, properties, onOpenRepairs }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onOpenRepairs: () => void }) {
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

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [s, o] = await Promise.allSettled([readTeams({ section: "schedule", from: addDays(today, -1), to: addDays(today, 30) }), readOperations()]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (o.status === "fulfilled") setOperations(z.array(operationViewSchema).parse(o.value.data)); else throw o.reason;
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Stays could not be loaded. Refresh to try again."); }
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

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Stays</Text>
        <Text style={[ui.body, { color: p.muted }]}>Arrivals, departures, cleans and the daily listing and pricing checks.</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[
          { label: "Arrivals today", value: schedule.stays.filter(s => s.checkIn === today).length },
          { label: "Departures today", value: schedule.stays.filter(s => s.checkOut === today).length },
          { label: "Listings to check", value: listingsDue },
        ].map(tile => (
          <View key={tile.label} style={[ui.card, { flex: 1, padding: 14, gap: 4, backgroundColor: p.surface, borderColor: p.border }]}>
            <Text style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>{tile.value}</Text>
            <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{tile.label}</Text>
          </View>
        ))}
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <ActivityIndicator color={p.primary} accessibilityLabel="Loading stays" />}
      <View style={[ui.row, { gap: 10 }]}>
        <Button label="Record a stay" icon="plus" primary p={p} onPress={() => setRecording(true)} />
        <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
      </View>
      {toRefer > 0 && <MotionPress accessibilityRole="button" onPress={onOpenRepairs} style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.wash }]}>
        <Feather name="tool" size={18} color={p.primary} />
        <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{toRefer} repair{toRefer === 1 ? "" : "s"} waiting for you to refer to Ready</Text>
        <Feather name="chevron-right" size={18} color={p.muted} />
      </MotionPress>}

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
                {unpriced.length > 0 && <Button label="Price a night" icon="trending-down" p={p} onPress={() => setPricingFor({ property, nights: unpriced })} />}
              </View>
            </View>
          );
        })}
        {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
      </Section>

      <StaySheet p={p} visible={recording} properties={properties} onClose={() => setRecording(false)} onDone={load} />
      <ListingSheet p={p} property={listingFor} onClose={() => setListingFor(null)} onDone={load} />
      <PricingSheet p={p} target={pricingFor} onClose={() => setPricingFor(null)} onDone={load} />
    </View>
  );
}
