import { useState } from "react";
import { View } from "react-native";
import { PropertySelect } from "./SearchPicker";
import { CHOOSE_PROPERTY_FIRST, saveDisabled } from "../../lib/search-picker";
import { Sheet } from "./TeamFlows";
import { Text } from "./Typography";
import { DateField } from "./CalendarPicker";
import { ui, type Palette } from "./theme";
import { addDays, Button, Field, london, message, Notice, useRequestId } from "./LiveKit";
import { Pills, platformCode } from "./LiveAccounts";
import { isPayoutChannel } from "../../lib/payout-report-formats";
import { writeFinance, writeOperation } from "./backend/client";
import { recordedReservationSchema } from "../../lib/management-live";
import { poundsToMinor } from "../../lib/repairs-live";
import { type PropertyView } from "../../lib/workspace-view";
import { nightsBetween } from "../../lib/tracker-direct-bookings";

const CHANNELS = ["airbnb", "booking_com", "vrbo", "direct", "other"] as const;
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo", direct: "Direct", other: "Other" };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));

function PropertyPills({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string; onChange: (id: string) => void }) {
  return <PropertySelect p={p} properties={properties} value={value} onChange={onChange} />;
}

// A confirmed stay of the booking policy's minimum nights or more gets a direct-booking follow-up (7 unless the policy says otherwise).
const DEFAULT_MINIMUM_NIGHTS = 7;

export function StaySheet({ p, visible, properties, onClose, onDone, minimumNights = DEFAULT_MINIMUM_NIGHTS }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void>; minimumNights?: number }) {
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
  // A stay on Airbnb, Booking.com or Vrbo needs the platform's own reservation code, so its payout can be matched.
  const platform = isPayoutChannel(channel);
  const nights = isDate(checkIn) && isDate(checkOut) ? nightsBetween(checkIn, checkOut) : null;
  const followUp = status === "confirmed" && nights !== null && nights >= minimumNights;
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
      <DateField p={p} label="Check-in to check-out" wholeMonthLink={false} today={today} value={{ from: checkIn, to: checkOut }} onChange={next => { setCheckIn(next.from); setCheckOut(next.to); }} />
      {nights !== null && <Text style={[ui.small, { color: followUp ? p.primary : p.muted }]}>{nights} {nights === 1 ? "night" : "nights"}{followUp ? `. Stays of ${minimumNights} nights or more get a direct-booking follow-up for the team.` : ""}</Text>}
      <Pills p={p} values={["confirmed", "enquiry"] as const} value={status} onChange={setStatus} label={v => v === "confirmed" ? "Confirmed" : "Enquiry"} />
      <Pills p={p} values={CHANNELS} value={channel} onChange={setChannel} label={v => CHANNEL_LABEL[v]} />
      {platform && <Field label={platformCode(channel).label} value={code} onChange={setCode} p={p} placeholder={platformCode(channel).placeholder} />}
      <View style={[ui.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field label="Guests (optional)" value={guests} onChange={setGuests} p={p} /></View>
        <View style={{ flex: 1 }}><Field label="Payout (optional)" value={payout} onChange={setPayout} p={p} placeholder="£0.00" /></View>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!propertyId && <Text style={[ui.small, { color: p.muted }]}>{CHOOSE_PROPERTY_FIRST}</Text>}
      <Button label={busy ? "Saving…" : "Save stay"} primary p={p} disabled={saveDisabled(busy, propertyId)} onPress={() => void save()} />
    </Sheet>
  );
}
