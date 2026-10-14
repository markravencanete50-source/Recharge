import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { MotionPress } from "./motion";
import { DateField } from "./CalendarPicker";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { readControls, writeControls } from "./backend/client";
import { formatDay } from "../../lib/format";

// Local events already added for a property, each correctable or archivable (an archived event
// leaves the owner's weekly report). Stays and admins with the weekly report tool.
const eventsSchema = z.array(z.object({ id: z.string().uuid(), name: z.string(), event_on: z.string(), source_url: z.string(), opportunity: z.string(), version: z.number(), archived_at: z.string().nullable() }));
type LocalEvent = z.infer<typeof eventsSchema>[number];

export function LocalEvents({ p, propertyId, refreshKey }: { p: Palette; propertyId: string; refreshKey?: unknown }) {
  const [events, setEvents] = useState<LocalEvent[] | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<LocalEvent | null>(null);
  const load = useCallback(async () => {
    try { setEvents(eventsSchema.parse((await readControls({ section: "events", propertyId })).data ?? []).filter(e => !e.archived_at)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, refreshKey]);
  if (!events?.length) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: p.text, fontWeight: "700" }}>Local events · {events.length}</Text>
      {events.slice(0, 8).map((e, i) => (
        <MotionPress key={e.id} accessibilityRole="button" accessibilityLabel={"Edit or archive " + e.name} onPress={() => setOpen(e)} style={[ui.between, { gap: 12, minHeight: 44, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
          <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{e.name}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{formatDay(e.event_on)}</Text></View>
          <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Edit</Text>
        </MotionPress>
      ))}
      <EventSheet p={p} propertyId={propertyId} event={open} onClose={() => setOpen(null)} onSaved={() => void load()} />
    </View>
  );
}

function EventSheet({ p, propertyId, event, onClose, onSaved }: { p: Palette; propertyId: string; event: LocalEvent | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""), [eventOn, setEventOn] = useState(""), [sourceUrl, setSourceUrl] = useState(""), [opportunity, setOpportunity] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saveRequest = useRequestId(event ? ["event", event.id, event.version, name, eventOn, sourceUrl, opportunity].join(":") : null);
  const archiveRequest = useRequestId(event ? ["archive", event.id, event.version].join(":") : null);
  useEffect(() => { queueMicrotask(() => { if (event) { setName(event.name); setEventOn(event.event_on.slice(0, 10)); setSourceUrl(event.source_url); setOpportunity(event.opportunity); setError(""); } }); }, [event]);
  async function run(archive: boolean) {
    if (!event || busy) return;
    if (!archive && (name.trim().length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(eventOn) || !sourceUrl.startsWith("https://") || opportunity.trim().length < 5)) { setError("Add the event, its date, an https:// link and why it matters."); return; }
    const request = archive ? archiveRequest : saveRequest, base = { requestId: request.get(), propertyId, eventId: event.id, version: event.version };
    setBusy(true); setError("");
    try {
      await writeControls(archive ? { action: "archiveEvent", ...base } : { action: "updateEvent", ...base, name: name.trim(), eventOn, sourceUrl: sourceUrl.trim(), opportunity: opportunity.trim() });
      request.done(); onClose(); onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!event} onClose={onClose} title="Local event" subtitle="Shown in the owner's weekly report" icon="calendar">
      <Field label="Event" value={name} onChange={setName} p={p} />
      <DateField p={p} label="Date" mode="single" wholeMonthLink={false} empty="Choose a date" value={{ from: eventOn, to: eventOn }} onChange={next => setEventOn(next.from)} />
      <Field label="Link to the event (https://…)" value={sourceUrl} onChange={setSourceUrl} p={p} />
      <Field label="Why it matters for this property" value={opportunity} onChange={setOpportunity} p={p} multiline />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save changes"} primary p={p} disabled={busy} onPress={() => void run(false)} />
      <Button label="Archive this event" icon="archive" p={p} disabled={busy} onPress={() => void run(true)} />
    </Sheet>
  );
}
