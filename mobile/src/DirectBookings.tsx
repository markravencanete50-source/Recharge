import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button, london } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams, workspaceRequest } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { isWorkspaceAdmin } from "../../lib/modules";
import { directBookingTrackerItems, parseStays, scheduleWindows, type StayInfo } from "../../lib/tracker-direct-bookings";
import { gateDiscountPolicy, workItemForms, type OperationView } from "../../lib/workflow-forms";

// Direct bookings (client ask B3): a stay of a week or more that came through a booking site gets a
// follow-up. Each one is a row here with the address, the guest and dates, the steps (follow-up raised,
// contacted, agreed or declined, done), what is next and when it last moved. Open one for its checklist.
// Staff only: owners never see this section.
export function DirectBookings({ palette: p, account, properties, journeys, work, onForm, onOpenWork }: SectionProps) {
  const [stays, setStays] = useState<ReadonlyMap<string, StayInfo>>(new Map());
  const [flags, setFlags] = useState<Flag[]>([]);
  // Direct-booking offers wait for Alex to confirm the discount policy, so "Prepare a direct-booking offer"
  // shows as unavailable until then (the same gate and wording as the ticket in the workspace).
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const hidden = account.role === "client";

  // The stays give each follow-up its dates, nights and guest name. A failed read just leaves them out.
  const load = useCallback(async () => {
    const today = london(new Date());
    // Long stays are booked well ahead and the read answers 62 days at a time, so ask for a year and more in windows.
    const windows = scheduleWindows(today, 14, 400);
    const canSeePolicy = isWorkspaceAdmin(account.role) || account.role === "stays";
    const [f, p, ...s] = await Promise.allSettled([
      readTeams({ section: "flags" }),
      canSeePolicy ? workspaceRequest("/api/mobile/portfolio?section=bookingPolicy").then(r => r.json()) : Promise.resolve(null),
      ...windows.map(w => readTeams({ section: "schedule", from: w.from, to: w.to })),
    ]);
    if (f.status === "fulfilled") setFlags(parseFlags(f.value.data));
    if (p.status === "fulfilled") setPolicyConfirmed(!!(p.value && p.value.data && p.value.data.confirmed === true));
    // A window that fails to read just leaves its stays out; the follow-ups keep their fallback labels.
    const merged = new Map<string, StayInfo>();
    for (const w of s) if (w.status === "fulfilled") parseStays(w.value.data).forEach((v, k) => merged.set(k, v));
    setStays(merged);
  }, [account.role]);
  useEffect(() => { if (hidden) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, hidden]);

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => gateDiscountPolicy(workItemForms(account, w, journeys, work), policyConfirmed), now: new Date(), owner: false, stays };
    return withFlags(directBookingTrackerItems(work, ctx), flags);
  }, [work, properties, journeys, account, stays, flags, policyConfirmed]);
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
      <TrackerDetailSheet p={p} item={open} forms={openWork ? gateDiscountPolicy(workItemForms(account, openWork, journeys, work), policyConfirmed) : []} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!!openWork && <Button label="Open the full ticket" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(openWork); }} />}
          <FlagButton p={p} role={account.role} target={{ workId: open.workId, propertyId: open.propertyId, title: `Direct booking: ${open.address}` }} onDone={() => void load()} />
        </View>}
      </TrackerDetailSheet>
    </View>
  );
}
