import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Button, message, Notice, Tag } from "./LiveKit";
import { workspaceRequest } from "./backend/client";
import { CANCEL_ON_CHANNEL, CHANNEL_NAMES, cancelElsewhereMessage, doubleBookingSchema, hostawayStatusSchema, type DoubleBooking } from "../../lib/hostaway-sync-policy";
import { formatMoney } from "../../lib/format";

// The Hostaway sync at a glance: when it last ran, what it found, and anything to check.
// It runs by itself every 15 minutes and on each Hostaway change; admins can also run it now.
// While no channel manager is connected the sync is paused, and the card says so (no Sync now).
const responseSchema = z.object({ hostaway: hostawayStatusSchema.extend({ configured: z.boolean(), doubleBookings: z.array(doubleBookingSchema).default([]) }).nullable() });
type Status = z.infer<typeof responseSchema>["hostaway"];
const TRIGGER = { schedule: "automatically", webhook: "after a change in Hostaway", manual: "by an admin" } as const;
const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function HostawaySyncCard({ p, onSynced }: { p: Palette; onSynced?: () => void }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const load = useCallback(async () => {
    try {
      const parsed = responseSchema.safeParse(await (await workspaceRequest("/api/mobile/integrations")).json());
      if (parsed.success) setStatus(parsed.data.hostaway); else setError("The Hostaway status could not be loaded. Refresh to try again.");
    } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  async function syncNow() {
    if (busy) return;
    setBusy(true); setError(""); setResult("");
    try {
      const s = await (await workspaceRequest("/api/mobile/integrations", { action: "syncHostaway" })).json();
      const parts = [
        s.createdProperties && plural(s.createdProperties, "new property", "new properties"),
        s.newReservations && plural(s.newReservations, "new stay"), s.changedReservations && plural(s.changedReservations, "changed stay"),
        s.newCleans && plural(s.newCleans, "new clean"), s.movedCleans && plural(s.movedCleans, "clean moved", "cleans moved"),
        s.cancelledCleans && plural(s.cancelledCleans, "clean cancelled", "cleans cancelled"),
      ].filter(Boolean);
      setResult(parts.length ? `Synced: ${parts.join(", ")}.` : "Synced. Everything was already up to date.");
      onSynced?.();
    } catch (e) { setError(message(e)); }
    await load();
    setBusy(false);
  }

  if (!status) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  const tag: [string, "good" | "wait" | "bad"] = !status.configured ? ["Not connected", "wait"] : status.paused ? ["Sync paused", "wait"] : status.lastError ? ["Needs attention", "bad"] : status.lastSuccessAt ? ["Up to date", "good"] : ["Waiting for first sync", "wait"];
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 10 }]}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{status.paused ? "Channel manager" : "Hostaway"}</Text>
        <Tag label={tag[0]} tone={tag[1]} p={p} />
      </View>
      {status.paused
        ? <Text style={[ui.small, { color: p.muted }]}>Channel manager not connected. Sync is paused. Stays and cleans are added in the app for now.</Text>
        : !status.configured
        ? <Text style={[ui.small, { color: p.muted }]}>Not connected yet. Once the Hostaway keys are added to the backend, listings, stays and checkout cleans arrive here by themselves.</Text>
        : <>
          <Text style={[ui.small, { color: p.muted }]}>
            {status.lastRunAt ? `Last synced ${ago(status.lastRunAt)}${status.lastTrigger ? ", " + TRIGGER[status.lastTrigger] : ""}. ` : ""}Runs every 15 minutes and whenever a booking changes.
          </Text>
          <Text style={[ui.small, { color: p.text }]}>
            {plural(status.linkedProperties, "property", "properties")} linked · {plural(status.upcomingStays, "upcoming stay")} · {plural(status.unassignedCleans, "clean")} to assign in the next 14 days
          </Text>
        </>}
      {!!status.lastError && !status.paused && <Notice text={status.lastError} p={p} tone="bad" />}
      {status.problems.length > 0 && !status.paused && <View style={{ gap: 4 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>To check</Text>
        {status.problems.slice(0, 5).map((x, i) => (
          <Text key={i} style={[ui.small, { color: p.muted }]}>{x.reservationId ? `Booking ${x.reservationId}: ` : x.listingId ? `Listing ${x.listingId}: ` : ""}{x.problem}</Text>
        ))}
      </View>}
      {status.canSync && status.configured && !status.paused && status.doubleBookings.length > 0 && <DoubleBookings p={p} stays={status.doubleBookings} onCancelled={async note => { setResult(note); await load(); onSynced?.(); }} />}
      {!!result && <Text style={[ui.small, { color: p.text }]}>{result}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {status.canSync && status.configured && !status.paused && <Button label={busy ? "Syncing…" : "Sync now"} icon="refresh-cw" p={p} disabled={busy} onPress={() => void syncNow()} />}
    </View>
  );
}

const shortDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

// Two confirmed stays at one property on the same nights. Admins cancel the wrong one here: direct
// and Vrbo bookings through Hostaway, Airbnb and Booking.com ones on the channel (with a link there).
function DoubleBookings({ p, stays, onCancelled }: { p: Palette; stays: DoubleBooking[]; onCancelled: (note: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(""), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const properties = [...new Set(stays.map(x => x.propertyId))];
  async function cancel(stay: DoubleBooking) {
    if (busy) return;
    setBusy(stay.reservationId); setError("");
    try {
      const r = await (await workspaceRequest("/api/mobile/integrations", { action: "cancelHostawayReservation", reservationId: stay.reservationId })).json() as { cancelledCleans?: number; note?: string };
      setConfirming("");
      await onCancelled(r.note ?? `Booking ${stay.reference.replace(/^HA:/, "")} cancelled in Hostaway${r.cancelledCleans ? ` and its clean removed` : ""}. Refund the guest in Hostaway if they paid.`);
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
      <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>Double bookings</Text>
      <Text style={[ui.small, { color: p.muted }]}>These stays overlap at the same property. Keep the right one and cancel the other.</Text>
      {properties.map(propertyId => {
        const group = stays.filter(x => x.propertyId === propertyId);
        return (
          <View key={propertyId} style={{ gap: 8 }}>
            <Text style={{ color: p.text, fontWeight: "700" }}>{group[0].propertyName}</Text>
            {group.map(stay => {
              const channel = CHANNEL_NAMES[stay.channel ?? "other"] ?? "Other channel";
              const elsewhere = CANCEL_ON_CHANNEL[stay.channel ?? "other"] ?? CANCEL_ON_CHANNEL.other;
              return (
                <View key={stay.reservationId} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
                  <View style={[ui.between, { gap: 8 }]}>
                    <Text style={{ color: p.text, fontWeight: "600", flex: 1 }}>{channel} · {stay.reference.replace(/^HA:/, "Booking ")}</Text>
                    {stay.payoutMinor !== null && <Text style={{ color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{formatMoney(stay.payoutMinor)}</Text>}
                  </View>
                  <Text style={[ui.small, { color: p.muted }]}>{shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}{stay.guests ? ` · ${stay.guests} ${stay.guests === 1 ? "guest" : "guests"}` : ""}</Text>
                  {stay.canCancelInHostaway
                    ? confirming === stay.reservationId
                      ? <View style={{ gap: 6 }}>
                        <Text style={[ui.small, { color: p.text }]}>Cancel this booking in Hostaway? Its clean is removed too. The guest is not told automatically, and any refund is made in Hostaway.</Text>
                        <Button label={busy === stay.reservationId ? "Cancelling…" : "Yes, cancel this booking"} icon="x-circle" primary p={p} disabled={!!busy} onPress={() => void cancel(stay)} />
                        <Button label="Keep it" icon="arrow-left" p={p} disabled={!!busy} onPress={() => setConfirming("")} />
                      </View>
                      : <Button label="Cancel this booking" icon="x-circle" p={p} disabled={!!busy} onPress={() => { setError(""); setConfirming(stay.reservationId); }} />
                    : <>
                      <Text style={[ui.small, { color: p.muted }]}>{cancelElsewhereMessage(stay.channel)}</Text>
                      <Button label={`Open ${elsewhere.label}`} icon="external-link" p={p} onPress={() => void Linking.openURL(elsewhere.url)} />
                    </>}
                </View>
              );
            })}
          </View>
        );
      })}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
