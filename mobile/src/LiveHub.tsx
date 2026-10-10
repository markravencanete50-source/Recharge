import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { PropertySelect, SearchPicker } from "./SearchPicker";
import { MotionPress } from "./motion";
import { Chip, SheetTable, cellText } from "./SheetTable";
import { ResponsibilitiesTab, RotaTab, TimesheetTab } from "./LiveTeamTime";
import { FilterBar } from "./FilterBar";
import { Button, Field, Loading, message, Notice, Tag, london, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { useSaved } from "./Celebrate";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { routinePlanSchema, poundsToMinor } from "../../lib/repairs-live";
import { formatDay, formatMoney } from "../../lib/format";
import { readableStage, type PropertyView } from "../../lib/workspace-view";
import { createOperationForms, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";
import { DEPARTMENTS, hubSchema, type Hub, type HubItem } from "../../lib/workspace-teams-policy";
import { DEPARTMENT_LABEL, HUB_FLOW, HUB_STATUS_LABEL, HUB_TAB_LABEL, dailyRows, hubOpen, hubTabsFor, onboardingRows, preventativeRows, purchaseRows, todoRows, type HubTab, type RoutinePlan } from "../../lib/hub";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

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
          <SheetTable p={p} rows={purchaseRows(work)} keyOf={r => r.work.workId} onRow={r => onOpenWork(r.work)} empty="No purchase orders yet."
            columns={[
              { label: "Property", width: 140, cell: r => cellText(p, name(r.propertyId), true) },
              { label: "Items", width: 200, cell: r => cellText(p, r.items) },
              { label: "Budget", width: 80, cell: r => cellText(p, formatMoney(r.budgetMinor)) },
              { label: "Approved", width: 80, cell: r => cellText(p, r.approvedMinor === null ? null : formatMoney(r.approvedMinor)) },
              { label: "Stage", width: 100, cell: r => <Tag label={r.stage} tone={tone(r.stage)} p={p} /> },
              { label: "Supplier", width: 120, cell: r => cellText(p, [r.supplier, r.orderReference].filter(Boolean).join(" · ")) },
              { label: "Received", width: 90, cell: r => cellText(p, r.receivedOn ? formatDay(r.receivedOn) : null) },
            ]} />
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

function PropertyPicker({ p, properties, title, visible, onClose, onPick }: { p: Palette; properties: PropertyView[]; title: string; visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={title} subtitle="Which property is it for?" icon="house">
      <PropertySelect p={p} properties={properties} value="" onChange={id => { if (id) onPick(id); }} empty="No properties yet." />
    </Sheet>
  );
}

const KIND_TITLE: Record<HubItem["kind"], [string, string]> = {
  todo: ["To-do", "What needs doing"], approval: ["Approval ticket", "What needs management's approval"],
  aircover: ["AirCover claim", "What happened"], invoice: ["Invoice to send", "Who it is for and what it covers"],
};

// Adding or changing one row, and moving it along (done, approved, claimed, sent, paid).
function HubItemSheet({ p, hub, account, properties, target, onClose, onSaved }: { p: Palette; hub: Hub | null; account: WorkspaceAccount; properties: PropertyView[]; target: { kind: HubItem["kind"]; item?: HubItem } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const item = target?.item, kind = target?.kind ?? "todo";
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(target ? (item ? item.id + ":" + item.version : "new:" + kind) + ":" + JSON.stringify(f) : null);
  const moveRequest = useRequestId(item ? "move:" + item.id + ":" + item.version : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setError("");
      setF(item ? { title: item.title, details: item.details, propertyId: item.propertyId ?? "", assigneeId: item.assigneeId ?? "", department: item.department ?? "", dueOn: item.dueOn ?? "",
        amount: item.amountMinor === null ? "" : (item.amountMinor / 100).toFixed(2), link: item.link ?? "", reference: item.reference, note: "", settled: item.settledMinor === null ? "" : (item.settledMinor / 100).toFixed(2) }
        : { assigneeId: kind === "todo" ? account.userId : "" });
    });
    return () => { active = false; };
  }, [item, kind, account.userId]);
  const set = (k: string) => (v: string) => setF(x => ({ ...x, [k]: v }));
  const mine = !item || item.createdBy === account.userId || account.role === "admin" || account.role === "super_admin" || kind === "aircover" || kind === "invoice";
  const editable = mine && !(kind === "approval" && item && item.status !== "pending");

  async function save() {
    if (busy) return;
    const amount = f.amount?.trim() ? poundsToMinor(f.amount) : null;
    if ((f.title ?? "").trim().length < 2) { setError("Add a title."); return; }
    if (kind === "approval" && amount === null) { setError("Add the amount to approve."); return; }
    if (f.amount?.trim() && amount === null) { setError("Enter the amount in pounds, for example 149.99."); return; }
    if (f.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.dueOn)) { setError("Enter the date as YYYY-MM-DD."); return; }
    if (f.link && !/^https:\/\//.test(f.link.trim())) { setError("Use a secure link starting https://"); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({
        action: "saveHubItem", requestId: request.get(), ...(item ? { id: item.id, version: item.version } : {}), kind, title: f.title.trim(), details: (f.details ?? "").trim(),
        propertyId: f.propertyId || null, ...(kind === "todo" ? { assigneeId: f.assigneeId || null, department: (f.department || null) as typeof DEPARTMENTS[number] | null } : {}),
        dueOn: f.dueOn || null, amountMinor: amount, link: f.link?.trim() || null, reference: (f.reference ?? "").trim(),
      });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function move(status: HubItem["status"]) {
    if (!item || busy) return;
    const settled = f.settled?.trim() ? poundsToMinor(f.settled) : null;
    if (status === "declined" && kind === "approval" && (f.note ?? "").trim().length < 5) { setError("Say why it is declined."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "moveHubItem", requestId: moveRequest.get(), id: item.id, version: item.version, status, ...((f.note ?? "").trim() ? { note: f.note.trim() } : {}), ...(kind === "aircover" && status === "paid" && settled !== null ? { settledMinor: settled } : {}) });
      moveRequest.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const [title, placeholder] = KIND_TITLE[kind];
  const moves = item ? HUB_FLOW[kind].filter(s => s !== item.status && (kind !== "approval" || (hub?.canDecide && item.status === "pending" && s !== "pending"))) : [];
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={item ? item.title : "New " + title.toLowerCase()} subtitle={item ? `${title} · ${HUB_STATUS_LABEL[item.status]}${item.createdByName ? " · added by " + item.createdByName : ""}` : title} icon="clipboard">
      {editable ? <>
        <Field label={title} value={f.title ?? ""} onChange={set("title")} p={p} placeholder={placeholder} />
        <Field label="Details (optional)" value={f.details ?? ""} onChange={set("details")} p={p} multiline />
        {kind === "todo" && hub && <>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>For</Text>
          <SearchPicker p={p} options={hub.people.map(x => ({ id: x.userId, label: x.userId === account.userId ? "Me" : x.fullName || "Team member" }))} value={f.assigneeId ?? ""}
            onChange={id => setF(v => ({ ...v, assigneeId: id }))} clearable placeholder="Search the team by name" nouns="people" />
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Or a whole department</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {DEPARTMENTS.map(d => <Chip key={d} p={p} label={DEPARTMENT_LABEL[d]} on={f.department === d} onPress={() => setF(v => ({ ...v, department: v.department === d ? "" : d }))} />)}
          </View>
        </>}
        {kind !== "todo" && <Field label={kind === "approval" ? "Amount, £" : kind === "aircover" ? "Amount claimed, £" : "Amount, £"} value={f.amount ?? ""} onChange={set("amount")} p={p} placeholder="0.00" />}
        {(kind === "todo" || kind === "invoice") && <Field label={kind === "todo" ? "Due (optional, YYYY-MM-DD)" : "Send by (optional, YYYY-MM-DD)"} value={f.dueOn ?? ""} onChange={set("dueOn")} p={p} placeholder={london(new Date())} />}
        {kind === "aircover" && <Field label="Reservation code (optional)" value={f.reference ?? ""} onChange={set("reference")} p={p} placeholder="HMABCD1234" />}
        {(kind === "aircover" || kind === "invoice") && <Field label={kind === "invoice" ? "Invoice link (optional)" : "Claim link (optional)"} value={f.link ?? ""} onChange={set("link")} p={p} placeholder="https://" />}
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property (optional)</Text>
        <PropertySelect p={p} properties={properties} value={f.propertyId ?? ""} onChange={id => setF(v => ({ ...v, propertyId: id }))} clearable empty="" />
        <Button label={busy ? "Saving…" : item ? "Save changes" : "Add"} primary p={p} disabled={busy} onPress={() => void save()} />
      </> : item && <View style={{ gap: 6 }}>
        {!!item.details && <Text style={{ color: p.text }}>{item.details}</Text>}
        {item.amountMinor !== null && <Text style={{ color: p.text }}>Amount: {formatMoney(item.amountMinor)}</Text>}
        {!!item.propertyName && <Text style={[ui.small, { color: p.muted }]}>{item.propertyName}</Text>}
      </View>}
      {item?.link && <Button label="Open the link" icon="external-link" p={p} onPress={() => void Linking.openURL(item.link!).catch(() => setError("The link could not be opened."))} />}
      {!!item?.outcomeNote && <Notice text={`${item.decidedBy ? item.decidedBy + ": " : ""}${item.outcomeNote}`} p={p} />}
      {item && moves.length > 0 && <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{kind === "approval" ? "Decide" : "Move to"}</Text>
        {(kind === "approval" || kind === "aircover") && <Field label={kind === "approval" ? "Note (needed to decline)" : "Note (optional)"} value={f.note ?? ""} onChange={set("note")} p={p} multiline />}
        {kind === "aircover" && moves.includes("paid") && <Field label="Amount paid out, £ (when paid)" value={f.settled ?? ""} onChange={set("settled")} p={p} placeholder="0.00" />}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {moves.map(s => <Button key={s} label={kind === "todo" ? (s === "done" ? "Mark done" : "Reopen") : HUB_STATUS_LABEL[s]} primary={s === "done" || s === "approved"} p={p} disabled={busy} onPress={() => void move(s)} />)}
        </View>
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}
