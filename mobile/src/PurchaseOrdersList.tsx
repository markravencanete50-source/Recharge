import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { PropertyPicker } from "./HubItemSheet";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { trackerItemsFor } from "../../lib/tracker-sections";
import { createOperationForms, workItemForms, type OperationView } from "../../lib/workflow-forms";

// Purchase orders in the tracker format, for Stays, Ready and Accounts: the address, the five steps
// (requested, budget approved, ordered, delivered, checked against the invoice), what is next and who
// must act, and when it last moved. Open one to record the next step or flag it for management.
export function PurchaseOrdersList({ palette: p, account, properties, journeys, work, onForm, onOpenWork }: SectionProps) {
  const owner = account.role === "client";
  const [flags, setFlags] = useState<Flag[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const f = await Promise.allSettled([readTeams({ section: "flags" })]);
    if (f[0].status === "fulfilled") setFlags(parseFlags(f[0].value.data));
  }, []);
  useEffect(() => { if (owner) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, owner]);

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, work), now: new Date(), owner };
    return withFlags(trackerItemsFor(work, ctx, "purchases"), flags);
  }, [work, properties, journeys, account, owner, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const openWork = open ? work.find(w => w.workId === open.workId) : undefined;

  // A new order for a property chosen first.
  function raiseFor(propertyId: string) {
    const form = createOperationForms(account, propertyId).find(f => f.key === "purchase");
    if (!form) { setNotice("You cannot raise purchase orders. Ask an admin for the purchase tool."); return; }
    setNotice("");
    onForm({ ...form, key: "purchase-list-" + propertyId });
  }
  const canRaise = !owner && account.role !== "cleans";

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Purchase orders</Text>
        <Text style={[ui.small, { color: p.muted }]}>Supplies and items bought for properties. Open one to see where it stands and record the next step.</Text>
      </View>
      {canRaise && <Button label="New purchase order" icon="plus" primary p={p} onPress={() => setPicking(true)} />}
      {!!notice && <Text style={[ui.small, { color: p.danger }]}>{notice}</Text>}
      <TrackerList p={p} items={items} empty="No purchase orders yet." owner={owner} onOpen={i => setOpenId(i.id)} />
      <TrackerDetailSheet p={p} item={open} owner={owner} forms={openWork ? workItemForms(account, openWork, journeys, work) : []} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!!openWork && <Button label="Open the full ticket" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(openWork); }} />}
          <FlagButton p={p} role={account.role} target={{ workId: open.workId, propertyId: open.propertyId, title: `Purchase order: ${open.address}` }} onDone={() => void load()} />
        </View>}
      </TrackerDetailSheet>
      <PropertyPicker p={p} properties={properties} title="New purchase order" visible={picking} onClose={() => setPicking(false)} onPick={id => { setPicking(false); raiseFor(id); }} />
    </View>
  );
}
