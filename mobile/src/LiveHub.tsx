import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SearchPicker } from "./SearchPicker";
import { MotionPress } from "./motion";
import { SheetTable, cellText } from "./SheetTable";
import { ResponsibilitiesTab, RotaTab, TimesheetTab } from "./LiveTeamTime";
import { FilterBar } from "./FilterBar";
import { Button, Loading, message, Notice, Tag, london } from "./LiveKit";
import { useSaved } from "./Celebrate";
import { ui, type Palette } from "./theme";
import { readTeams } from "./backend/client";
import { routinePlanSchema } from "../../lib/repairs-live";
import { formatDay, formatMoney } from "../../lib/format";
import { readableStage, type PropertyView } from "../../lib/workspace-view";
import { createOperationForms, workItemForms, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";
import { trackerItemsFor } from "../../lib/tracker-sections";
import type { TrackerItem } from "../../lib/tracker";
import { TrackerList } from "./Tracker";
import { hubSchema, type Hub, type HubItem } from "../../lib/workspace-teams-policy";
import { DEPARTMENT_LABEL, HUB_STATUS_LABEL, HUB_TAB_LABEL, dailyRows, hubOpen, hubTabsFor, onboardingRows, preventativeRows, todoRows, type HubTab, type RoutinePlan } from "../../lib/hub";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { HubItemSheet, PropertyPicker } from "./HubItemSheet";

// The hub: the business's trackers as rows, like a sheet you can tap into. To-dos per person and
// department, approval tickets, purchase orders, preventative maintenance, the day's reviews and
// pricing, AirCover claims, invoices to send and onboarding.
const tone = (status: string): "good" | "wait" | "bad" | "plain" => ["done", "approved", "paid", "Delivered", "Live", "live"].includes(status) ? "good" : ["declined", "Cancelled"].includes(status) ? "bad" : ["pending", "to_claim", "to_send", "Requested"].includes(status) ? "wait" : "plain";

export function LiveHub({ palette: p, account, properties, journeys, work, onForm, onOpenWork }: {
  palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[];
  onForm: (form: WorkflowForm) => void; onOpenWork: (work: OperationView) => void;
}) {
  const saved = useSaved();
  const today = london(new Date());
  const admin = account.role === "admin" || account.role === "super_admin";
  const [hub, setHub] = useState<Hub | null>(null);
  const [plans, setPlans] = useState<RoutinePlan[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<HubTab>("todos");
  const [who, setWho] = useState<string>("mine");
  const [editing, setEditing] = useState<{ kind: HubItem["kind"]; item?: HubItem } | null>(null);
  const [picking, setPicking] = useState<{ title: string; text: string } | null>(null);
  const tabs = hubTabsFor(account.role, hub?.keeps ?? []);

  const load = useCallback(async () => {
    setError("");
    const wantsPlans = admin || ["stays", "ready"].includes(account.role);
    const [h, r] = await Promise.allSettled([readTeams({ section: "hub" }), wantsPlans ? readTeams({ section: "routines" }) : Promise.resolve({ data: [] })]);
    if (h.status === "fulfilled") { try { setHub(hubSchema.parse(h.value.data)); } catch { setError("The hub could not be read. Refresh to try again."); } } else setError(message(h.reason));
    if (r.status === "fulfilled") { const parsed = routinePlanSchema.safeParse(r.value.data); if (parsed.success) setPlans(parsed.data); }
  }, [account.role, admin]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const name = useCallback((id: string | null) => properties.find(x => x.id === id)?.name ?? null, [properties]);
  const items = useMemo(() => hub?.items ?? [], [hub]);
  const count = (kind: HubItem["kind"]) => items.filter(i => i.kind === kind && hubOpen(i)).length;
  const labels = tabs.map(t => {
    const n = t === "todos" ? todoRows(items, { userId: account.userId, department: hub?.department ?? null, who: "mine" }).filter(hubOpen).length
      : t === "approvals" ? count("approval") : t === "aircover" ? count("aircover") : t === "invoices" ? count("invoice") : 0;
    return HUB_TAB_LABEL[t] + (n ? ` · ${n}` : "");
  });
  const current = tabs.includes(tab) ? tab : "todos";

  // Purchase orders and licensing share the tracker rows. Staff see who last touched an item, owners do not.
  const owner = account.role === "client";
  const [purchaseItems, licensingItems] = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, work), now: new Date(), owner };
    return [trackerItemsFor(work, ctx, "purchases"), trackerItemsFor(work, ctx, "licensing")];
  }, [work, properties, journeys, account, owner]);
  // Tapping a row opens the same work sheet as search, Home and Calendar.
  const openTracked = useCallback((item: TrackerItem) => { const w = work.find(x => x.workId === item.workId); if (w) onOpenWork(w); }, [work, onOpenWork]);

  // A purchase order for a property chosen first, starting from what the row already knows.
  function purchaseFor(propertyId: string, text: string) {
    const form = createOperationForms(account, propertyId).find(f => f.key === "purchase");
    if (!form) { setError("You cannot raise purchase orders. Ask an admin for the purchase tool."); return; }
    onForm({ ...form, key: "purchase-hub-" + propertyId + ":" + text.length, fields: form.fields.map(f => f.name === "requirements" && text ? { ...f, defaultValue: text } : f) });
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Hub</Text>
        <Text style={[ui.body, { color: p.muted }]}>Every tracker in one place. Tap a row to open it.</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!hub && !error && <Loading p={p} />}
      {hub && <>
        <FilterBar values={labels} selected={labels[tabs.indexOf(current)] ?? labels[0]} onSelect={label => setTab(tabs[labels.indexOf(label)] ?? "todos")} palette={p} />

        {current === "todos" && <>
          <SearchPicker p={p} value={who} onChange={setWho} placeholder="Search the team by name" nouns="people"
            fixed={[["mine", "Mine"], ...(hub.department ? [["department", DEPARTMENT_LABEL[hub.department]]] : []), ...(admin ? [["everyone", "Everyone"]] : [])].map(([id, label]) => ({ id, label }))}
            options={admin ? hub.people.filter(x => x.userId !== account.userId).map(x => ({ id: x.userId, label: x.fullName || "Team member" })) : []} />
          <Button label="Add a to-do" icon="plus" primary p={p} onPress={() => setEditing({ kind: "todo" })} />
          <SheetTable p={p} rows={todoRows(items, { userId: account.userId, department: hub.department, who })} keyOf={r => r.id} onRow={r => setEditing({ kind: "todo", item: r })} empty="Nothing on this list."
            columns={[
              { label: "", width: 40, cell: r => <Feather name={r.status === "done" ? "check-square" : "square"} size={18} color={r.status === "done" ? p.success : p.muted} /> },
              { label: "To-do", width: 220, cell: r => <Text numberOfLines={2} style={{ color: p.text, fontWeight: "600", textDecorationLine: r.status === "done" ? "line-through" : "none" }}>{r.title}</Text> },
              { label: "Who", width: 140, cell: r => cellText(p, r.assigneeName ?? (r.department ? DEPARTMENT_LABEL[r.department] : null)) },
              { label: "Due", width: 90, cell: r => cellText(p, r.dueOn ? formatDay(r.dueOn) : null) },
              { label: "Property", width: 140, cell: r => cellText(p, r.propertyName) },
              { label: "Set by", width: 110, cell: r => cellText(p, r.createdByName) },
            ]} />
        </>}

        {current === "approvals" && <>
          <Button label="Ask for approval" icon="plus" primary p={p} onPress={() => setEditing({ kind: "approval" })} />
          <SheetTable p={p} rows={items.filter(i => i.kind === "approval")} keyOf={r => r.id} onRow={r => setEditing({ kind: "approval", item: r })} empty={hub.canDecide ? "No approval tickets yet." : "You have not asked for any approvals."}
            columns={[
              { label: "Ticket", width: 220, cell: r => cellText(p, r.title, true) },
              { label: "Amount", width: 90, cell: r => cellText(p, formatMoney(r.amountMinor)) },
              { label: "Raised by", width: 120, cell: r => cellText(p, r.createdByName) },
              { label: "Date", width: 90, cell: r => cellText(p, formatDay(r.createdAt.slice(0, 10))) },
              { label: "Status", width: 100, cell: r => <Tag label={HUB_STATUS_LABEL[r.status]} tone={tone(r.status)} p={p} /> },
            ]} />
        </>}

        {current === "purchases" && <>
          <Button label="New purchase order" icon="plus" primary p={p} onPress={() => setPicking({ title: "New purchase order", text: "" })} />
          <TrackerList p={p} items={purchaseItems} empty="No purchase orders yet." owner={owner} onOpen={openTracked} />
        </>}

        {current === "licensing" && <>
          <Text style={[ui.small, { color: p.muted }]}>Licence applications, safety checks and grants for each property. Tap one to record the next step.</Text>
          <TrackerList p={p} items={licensingItems} empty="No licence applications yet." owner={owner} onOpen={openTracked} />
        </>}

        {current === "preventative" && <>
          <Text style={[ui.small, { color: p.muted }]}>Garden, bins and safety visits. Plans are set in Work → Maintenance.</Text>
          <SheetTable p={p} rows={preventativeRows(plans, work, today)} keyOf={r => r.plan.id} onRow={r => r.visit && onOpenWork(r.visit)} empty="No preventative maintenance plans yet."
            columns={[
              { label: "Property", width: 140, cell: r => cellText(p, r.plan.propertyName, true) },
              { label: "Visit", width: 140, cell: r => cellText(p, r.plan.title) },
              { label: "How often", width: 90, cell: r => cellText(p, r.plan.frequency === "quarterly" ? "Quarterly" : "Monthly") },
              { label: "Last", width: 90, cell: r => cellText(p, r.lastOn ? formatDay(r.lastOn) : null) },
              { label: "Done", width: 90, cell: r => r.lastOn ? <Tag label={r.done ? "Done" : r.overdue ? "Overdue" : "Open"} tone={r.done ? "good" : r.overdue ? "bad" : "wait"} p={p} /> : cellText(p, null) },
              { label: "Photos", width: 70, cell: r => cellText(p, r.photos ? String(r.photos) : null) },
              { label: "Next", width: 90, cell: r => cellText(p, r.nextOn ? formatDay(r.nextOn) : null) },
              { label: "", width: 130, cell: r => <MotionPress accessibilityRole="button" accessibilityLabel={`Items to buy for ${r.plan.propertyName}`} onPress={() => purchaseFor(r.plan.propertyId, `From the ${r.plan.title.toLowerCase()} visit:\n`)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Items to buy</Text></MotionPress> },
            ]} />
        </>}

        {current === "daily" && <>
          <Text style={[ui.small, { color: p.muted }]}>The last 14 days of guest reviews, re-listings and vacant-night pricing decisions.</Text>
          <SheetTable p={p} rows={dailyRows(work, 14, today)} keyOf={r => r.day} empty="No reviews or pricing decisions in the last 14 days."
            columns={[
              { label: "Day", width: 100, cell: r => cellText(p, formatDay(r.day), true) },
              { label: "Reviews", width: 70, cell: r => cellText(p, String(r.reviews)) },
              { label: "5★", width: 50, cell: r => cellText(p, String(r.top)) },
              { label: "1★", width: 50, cell: r => <Text style={[ui.small, { color: r.bottom ? p.danger : p.text, fontWeight: r.bottom ? "700" : "400" }]}>{r.bottom}</Text> },
              { label: "Re-listed", width: 80, cell: r => cellText(p, String(r.relisted)) },
              { label: "Price changes", width: 100, cell: r => cellText(p, String(r.changes)) },
              { label: "Held", width: 60, cell: r => cellText(p, String(r.held)) },
              { label: "Why", width: 240, cell: r => cellText(p, r.reasons.join(" · ")) },
            ]} />
        </>}

        {current === "aircover" && <>
          <Button label="Add a claim" icon="plus" primary p={p} onPress={() => setEditing({ kind: "aircover" })} />
          <SheetTable p={p} rows={items.filter(i => i.kind === "aircover")} keyOf={r => r.id} onRow={r => setEditing({ kind: "aircover", item: r })} empty="No AirCover claims yet."
            columns={[
              { label: "Claim", width: 200, cell: r => cellText(p, r.title, true) },
              { label: "Property", width: 130, cell: r => cellText(p, r.propertyName) },
              { label: "Reservation", width: 110, cell: r => cellText(p, r.reference) },
              { label: "Claimed", width: 80, cell: r => cellText(p, formatMoney(r.amountMinor)) },
              { label: "Paid", width: 80, cell: r => cellText(p, r.settledMinor === null ? null : formatMoney(r.settledMinor)) },
              { label: "Status", width: 100, cell: r => <Tag label={HUB_STATUS_LABEL[r.status]} tone={tone(r.status)} p={p} /> },
            ]} />
        </>}

        {current === "invoices" && <>
          <Button label="Add an invoice to send" icon="plus" primary p={p} onPress={() => setEditing({ kind: "invoice" })} />
          <SheetTable p={p} rows={items.filter(i => i.kind === "invoice")} keyOf={r => r.id} onRow={r => setEditing({ kind: "invoice", item: r })} empty="No invoices waiting to be sent."
            columns={[
              { label: "Invoice", width: 200, cell: r => cellText(p, r.title, true) },
              { label: "Property", width: 130, cell: r => cellText(p, r.propertyName) },
              { label: "Amount", width: 90, cell: r => cellText(p, formatMoney(r.amountMinor)) },
              { label: "Due", width: 90, cell: r => cellText(p, r.dueOn ? formatDay(r.dueOn) : null) },
              { label: "Status", width: 90, cell: r => <Tag label={HUB_STATUS_LABEL[r.status]} tone={tone(r.status)} p={p} /> },
              { label: "Link", width: 70, cell: r => r.link ? <Feather name="external-link" size={16} color={p.primary} /> : cellText(p, null) },
            ]} />
        </>}

        {current === "onboarding" && (
          <SheetTable p={p} rows={onboardingRows(journeys)} keyOf={r => r.propertyId} onRow={r => { const w = work.find(x => x.workId === r.journey.workId); if (w) onOpenWork(w); }} empty="No properties are onboarding."
            columns={[
              { label: "Property", width: 150, cell: r => cellText(p, name(r.propertyId), true) },
              { label: "Stage", width: 130, cell: r => <Tag label={readableStage(r.stage)} tone={r.stage === "live" ? "good" : "plain"} p={p} /> },
              { label: "Next", width: 170, cell: r => cellText(p, r.next) },
              { label: "Contact", width: 140, cell: r => cellText(p, r.contact) },
              { label: "Phone or email", width: 170, cell: r => cellText(p, r.phone || r.email) },
              { label: "Agreement", width: 90, cell: r => cellText(p, r.signed ? "Signed" : null) },
              { label: "Inspection", width: 100, cell: r => cellText(p, r.inspectionOn ? formatDay(r.inspectionOn) : null) },
            ]} />
        )}

        {current === "responsibilities" && <ResponsibilitiesTab p={p} account={account} />}
        {current === "rota" && <RotaTab p={p} account={account} />}
        {current === "timesheets" && <TimesheetTab p={p} account={account} />}
      </>}

      <HubItemSheet p={p} hub={hub} account={account} properties={properties} target={editing} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await load(); })} />
      <PropertyPicker p={p} properties={properties} title={picking?.title ?? ""} visible={!!picking} onClose={() => setPicking(null)} onPick={id => { const text = picking?.text ?? ""; setPicking(null); purchaseFor(id, text); }} />
    </View>
  );
}

export { HubItemSheet, PropertyPicker };
