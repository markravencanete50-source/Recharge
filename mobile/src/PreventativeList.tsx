import { useMemo, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { Anchor, london, message } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { VisitDates, VisitForm, VisitMoves } from "./VisitForm";
import { readOperations } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { RECORD_VISIT_KEY, preventativeTrackerItems } from "../../lib/tracker-repairs";
import { withFlags, type Flag } from "../../lib/management-flags";
import { operationViewSchema } from "../../lib/workspace-view";
import type { OperationView } from "../../lib/workflow-forms";

// Preventative maintenance (client ask C8): one row per routine plan at a property, with the visit type,
// when it was last done, when the next is due and whether it is Due, Overdue or Done, overdue first.
// "Record visit" opens the visit form; once a form exists the visit can be sent for review and signed off.
// Staff only: owners never see this list. Reads nothing on first show: the routine visits come from `work`;
// after a change it asks for the work list again so the row moves straight away.
// `flags` is optional: a host that already holds the open management flags can pass them so rows show Flagged.
export function PreventativeList({ palette: p, account, properties, work, flags = [] }: SectionProps & { flags?: Flag[] }) {
  const hidden = account.role === "client";
  const [fresh, setFresh] = useState<{ base: readonly OperationView[]; list: OperationView[] } | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const today = london(new Date());
  const source = fresh && fresh.base === work ? fresh.list : work;

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: () => [], now: new Date(), owner: false };
    return withFlags(preventativeTrackerItems(source, ctx, account.role), flags);
  }, [source, properties, account.role, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const visit = (open?.source as OperationView | undefined) ?? undefined;
  const recording = items.find(i => i.id === recordingId)?.source as OperationView | undefined;
  const propertyName = (w?: OperationView) => (w ? properties.find(x => x.id === w.propertyId)?.name ?? "Property" : "");
  const target = (w?: OperationView) => w ? { workId: w.workId, version: w.version, title: w.title, propertyName: propertyName(w), status: w.status, data: w.data } : null;

  async function reload() {
    try {
      const list = z.array(operationViewSchema).parse((await readOperations()).data);
      setFresh({ base: work, list }); setError("");
    } catch (e) { setError(message(e)); }
  }
  if (hidden) return null;

  return (
    <Anchor id="section-preventative">
      <View style={{ gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Preventative maintenance</Text>
          <Text style={[ui.small, { color: p.muted }]}>Routine, garden and bins visits. Overdue visits come first; record each visit with its form.</Text>
        </View>
        <TrackerList p={p} items={items} error={error} onOpen={i => setOpenId(i.id)} empty="No routine visits yet. Add a routine under Maintenance and its visits appear here." />
        <TrackerDetailSheet p={p} item={open} forms={[]} onClose={() => setOpenId(null)}>
          {!!open && !!visit && <View style={{ gap: 14 }}>
            <VisitDates p={p} data={visit.data} today={today} />
            <VisitMoves key={visit.workId + ":" + visit.version} p={p} role={account.role} visit={target(visit)!} onRecord={() => { setOpenId(null); setRecordingId(open.id); }} onDone={async () => { setOpenId(null); await reload(); }} />
            <FlagButton p={p} role={account.role} target={{ workId: visit.workId, propertyId: visit.propertyId, title: `${open.title} at ${open.address}` }} onDone={() => void reload()} />
          </View>}
        </TrackerDetailSheet>
        <VisitForm p={p} visit={target(recording)} today={today} onClose={() => setRecordingId(null)} onDone={async () => { await reload(); }} />
      </View>
    </Anchor>
  );
}

// The action key the tracker rows use for "Record visit", for hosts that draw their own buttons.
export { RECORD_VISIT_KEY };
