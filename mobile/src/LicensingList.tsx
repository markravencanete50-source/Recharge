import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { trackerItemsFor } from "../../lib/tracker-sections";
import { workItemForms, type OperationView } from "../../lib/workflow-forms";

// Licensing: the licence application raised from the onboarding tick (licensing support required), one
// row per property with the address, the next step, who must act, the last update and its three steps
// (application, safety checks, grant). Open one to record the next step. Owners see their own rows
// without staff names.
export function LicensingList({ palette: p, account, properties, journeys, work, onForm, onOpenWork }: SectionProps) {
  const owner = account.role === "client";
  const [flags, setFlags] = useState<Flag[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Flags are read leniently: an older server, or a person who cannot see them, simply has none.
  const load = useCallback(async () => {
    const f = await Promise.allSettled([readTeams({ section: "flags" })]);
    if (f[0].status === "fulfilled") setFlags(parseFlags(f[0].value.data));
  }, []);
  useEffect(() => { if (owner) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, owner]);

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, work), now: new Date(), owner };
    return withFlags(trackerItemsFor(work, ctx, "licensing"), flags);
  }, [work, properties, journeys, account, owner, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const openWork = open ? work.find(w => w.workId === open.workId) : undefined;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Licensing</Text>
        <Text style={[ui.small, { color: p.muted }]}>Licence applications, safety checks and grants for each property. Open one to record the next step.</Text>
      </View>
      <TrackerList p={p} items={items} empty="No licence applications yet." owner={owner} onOpen={i => setOpenId(i.id)} />
      <TrackerDetailSheet p={p} item={open} owner={owner} forms={openWork ? workItemForms(account, openWork, journeys, work) : []} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!!openWork && <Button label="Open the full ticket" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(openWork); }} />}
          <FlagButton p={p} role={account.role} target={{ workId: open.workId, propertyId: open.propertyId, title: `Licensing: ${open.address}` }} onDone={() => void load()} />
        </View>}
      </TrackerDetailSheet>
    </View>
  );
}
