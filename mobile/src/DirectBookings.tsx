import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { addDays, Button, london } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { directBookingTrackerItems, parseStays, type StayInfo } from "../../lib/tracker-direct-bookings";
import { workItemForms, type OperationView } from "../../lib/workflow-forms";

// Direct bookings (client ask B3): a stay of a week or more that came through a booking site gets a
// follow-up. Each one is a row here with the address, the guest and dates, the steps (follow-up raised,
// contacted, agreed or declined, done), what is next and when it last moved. Open one for its checklist.
// Staff only: owners never see this section.
export function DirectBookings({ palette: p, account, properties, journeys, work, onForm, onOpenWork }: SectionProps) {
  const [stays, setStays] = useState<ReadonlyMap<string, StayInfo>>(new Map());
  const [flags, setFlags] = useState<Flag[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const hidden = account.role === "client";

  // The stays give each follow-up its dates, nights and guest name. A failed read just leaves them out.
  const load = useCallback(async () => {
    const today = london(new Date());
    const [s, f] = await Promise.allSettled([readTeams({ section: "schedule", from: addDays(today, -14), to: addDays(today, 45) }), readTeams({ section: "flags" })]);
    if (s.status === "fulfilled") setStays(parseStays(s.value.data));
    if (f.status === "fulfilled") setFlags(parseFlags(f.value.data));
  }, []);
  useEffect(() => { if (hidden) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, hidden]);

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, work), now: new Date(), owner: false, stays };
    return withFlags(directBookingTrackerItems(work, ctx), flags);
  }, [work, properties, journeys, account, stays, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const openWork = open ? work.find(w => w.workId === open.workId) : undefined;
  if (hidden) return null;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Direct bookings</Text>
        <Text style={[ui.small, { color: p.muted }]}>Long stays booked through a booking site. Contact the guest with a direct-booking offer; open one to see where it stands.</Text>
      </View>
      <TrackerList p={p} items={items} onOpen={i => setOpenId(i.id)} empty="No direct-booking follow-ups yet. A long stay creates one automatically." />
      <TrackerDetailSheet p={p} item={open} forms={openWork ? workItemForms(account, openWork, journeys, work) : []} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!!openWork && <Button label="Open the full ticket" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(openWork); }} />}
          <FlagButton p={p} role={account.role} target={{ workId: open.workId, propertyId: open.propertyId, title: `Direct booking: ${open.address}` }} onDone={() => void load()} />
        </View>}
      </TrackerDetailSheet>
    </View>
  );
}
