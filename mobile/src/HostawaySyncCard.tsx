import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Button, message, Notice, Tag } from "./LiveKit";
import { workspaceRequest } from "./backend/client";
import { hostawayStatusSchema } from "../../lib/hostaway-sync-policy";

// The Hostaway sync at a glance: when it last ran, what it found, and anything to check.
// It runs by itself every 15 minutes and on each Hostaway change; admins can also run it now.
const responseSchema = z.object({ hostaway: hostawayStatusSchema.extend({ configured: z.boolean() }).nullable() });
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
  const tag: [string, "good" | "wait" | "bad"] = !status.configured ? ["Not connected", "wait"] : status.lastError ? ["Needs attention", "bad"] : status.lastSuccessAt ? ["Up to date", "good"] : ["Waiting for first sync", "wait"];
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 10 }]}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Hostaway</Text>
        <Tag label={tag[0]} tone={tag[1]} p={p} />
      </View>
      {!status.configured
        ? <Text style={[ui.small, { color: p.muted }]}>Not connected yet. Once the Hostaway keys are added to the backend, listings, stays and checkout cleans arrive here by themselves.</Text>
        : <>
          <Text style={[ui.small, { color: p.muted }]}>
            {status.lastRunAt ? `Last synced ${ago(status.lastRunAt)}${status.lastTrigger ? ", " + TRIGGER[status.lastTrigger] : ""}. ` : ""}Runs every 15 minutes and whenever a booking changes.
          </Text>
          <Text style={[ui.small, { color: p.text }]}>
            {plural(status.linkedProperties, "property", "properties")} linked · {plural(status.upcomingStays, "upcoming stay")} · {plural(status.unassignedCleans, "clean")} to assign in the next 14 days
          </Text>
        </>}
      {!!status.lastError && <Notice text={status.lastError} p={p} tone="bad" />}
      {status.problems.length > 0 && <View style={{ gap: 4 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>To check</Text>
        {status.problems.slice(0, 5).map((x, i) => (
          <Text key={i} style={[ui.small, { color: p.muted }]}>{x.reservationId ? `Booking ${x.reservationId}: ` : x.listingId ? `Listing ${x.listingId}: ` : ""}{x.problem}</Text>
        ))}
      </View>}
      {!!result && <Text style={[ui.small, { color: p.text }]}>{result}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {status.canSync && status.configured && <Button label={busy ? "Syncing…" : "Sync now"} icon="refresh-cw" p={p} disabled={busy} onPress={() => void syncNow()} />}
    </View>
  );
}
