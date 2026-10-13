import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { ui, type Palette } from "./theme";
import { Button, message, Notice, useRequestId } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { writeControls } from "./backend/client";
import type { StayLine } from "../../lib/property-profile";

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
type Status = "confirmed" | "enquiry" | "cancelled";

// Correct a stay recorded in the app (its dates, or whether it is confirmed), or cancel it, so
// wrong dates stop blocking the calendar and the owner's statement.
export function StayEditSheet({ p, propertyId, stay, onClose, onSaved }: { p: Palette; propertyId: string; stay: StayLine | null; onClose: () => void; onSaved: () => void }) {
  const [checkIn, setCheckIn] = useState(""), [checkOut, setCheckOut] = useState("");
  const [status, setStatus] = useState<"confirmed" | "enquiry">("confirmed");
  const [cancelling, setCancelling] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = (next: Status) => stay ? ["stay", stay.id, stay.version, checkIn, checkOut, next].join(":") : null;
  const saveRequest = useRequestId(key(status)), cancelRequest = useRequestId(key("cancelled"));
  useEffect(() => {
    queueMicrotask(() => {
      if (!stay) return;
      setCheckIn(stay.checkIn); setCheckOut(stay.checkOut); setStatus(stay.status === "enquiry" ? "enquiry" : "confirmed");
      setCancelling(false); setError("");
    });
  }, [stay]);
  if (!stay || stay.version === null) return <Sheet palette={p} visible={false} onClose={onClose} title="">{null}</Sheet>;
  const version = stay.version;
  async function save(next: Status) {
    if (busy || !stay) return;
    if (!isDate(checkIn) || !isDate(checkOut) || checkOut <= checkIn) { setError("Choose the dates, with check-out after check-in."); return; }
    const request = next === "cancelled" ? cancelRequest : saveRequest;
    setBusy(true); setError("");
    try {
      await writeControls({ action: "updateReservation", requestId: request.get(), propertyId, reservationId: stay.id, version, checkIn, checkOut, status: next });
      request.done(); onClose(); onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible onClose={onClose} title="Edit this stay" subtitle={stay.reference} icon="calendar">
      <DateField p={p} label="Check-in to check-out" wholeMonthLink={false} value={{ from: checkIn, to: checkOut }} onChange={next => { setCheckIn(next.from); setCheckOut(next.to); }} />
      <Pills p={p} values={["confirmed", "enquiry"] as const} value={status} onChange={setStatus} label={v => v === "confirmed" ? "Confirmed" : "Enquiry"} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy && !cancelling ? "Saving…" : "Save changes"} primary p={p} disabled={busy} onPress={() => void save(status)} />
      {cancelling ? <>
        <Text style={[ui.small, { color: p.muted }]}>The stay is kept on record as cancelled, and its nights are free again.</Text>
        <View style={[ui.row, { gap: 10 }]}>
          <Button label="Keep it" p={p} disabled={busy} onPress={() => setCancelling(false)} />
          <Button label={busy ? "Cancelling…" : "Cancel the stay"} icon="x" primary p={p} disabled={busy} onPress={() => void save("cancelled")} />
        </View>
      </> : <Button label="Cancel this stay" icon="x" p={p} disabled={busy} onPress={() => { setCancelling(true); setError(""); }} />}
    </Sheet>
  );
}
