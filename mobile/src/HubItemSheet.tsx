import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Text } from "./Typography";
import { PropertySelect } from "./SearchPicker";
import { Dropdown } from "./Dropdown";
import { DateField } from "./CalendarPicker";
import { MotionPress } from "./motion";
import { Button, Field, message, Notice, london, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { writeTeams } from "./backend/client";
import { poundsToMinor } from "../../lib/repairs-live";
import { formatMoney } from "../../lib/format";
import { type PropertyView } from "../../lib/workspace-view";
import { DEPARTMENTS, type Hub, type HubItem } from "../../lib/workspace-teams-policy";
import { DEPARTMENT_LABEL, HUB_FLOW, HUB_STATUS_LABEL } from "../../lib/hub";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

export function PropertyPicker({ p, properties, title, visible, onClose, onPick }: { p: Palette; properties: PropertyView[]; title: string; visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={title} subtitle="Which property is it for?" icon="house">
      <PropertySelect p={p} properties={properties} value="" onChange={id => { if (id) onPick(id); }} empty="No properties yet." />
    </Sheet>
  );
}

const KIND_TITLE: Record<HubItem["kind"], [string, string]> = {
  todo: ["To-do", "Area: what to do, for example Pricing: check the rates at Rose Cottage"], approval: ["Approval ticket", "What needs management's approval"],
  aircover: ["AirCover claim", "What happened"], invoice: ["Invoice to send", "Who it is for and what it covers"],
};

// Who a to-do is for: the person adding it, a named person, or a whole department. One dropdown (round 6,
// from Alex's video); "A person" or "A department" then shows a second dropdown for which one. The labels say
// plainly what each choice does (Alex, client meeting): "Assign to: Me / A person / A department", and each
// department with the work it covers.
type Assign = "me" | "person" | "department";
export const ASSIGN_OPTIONS: { value: Assign; label: string }[] = [{ value: "me", label: "Me" }, { value: "person", label: "A person" }, { value: "department", label: "A department" }];
export const DEPARTMENT_HINT: Record<string, string> = {
  guest_relations: "guests and their stays", client_relations: "owners, pricing and onboarding", ready: "repairs and maintenance",
};
export const DEPARTMENT_OPTIONS = [{ value: "", label: "Choose a department" }, ...DEPARTMENTS.map(d => ({ value: d as string, label: DEPARTMENT_HINT[d] ? `${DEPARTMENT_LABEL[d]} (${DEPARTMENT_HINT[d]})` : DEPARTMENT_LABEL[d] }))];

// Adding or changing one row, and moving it along (done, approved, claimed, sent, paid).
// `defaults` pre-fills a NEW to-do, for example the department of the heading it was added under.
export function HubItemSheet({ p, hub, account, properties, target, onClose, onSaved, defaults }: { p: Palette; hub: Hub | null; account: WorkspaceAccount; properties: PropertyView[]; target: { kind: HubItem["kind"]; item?: HubItem } | null; onClose: () => void; onSaved: () => Promise<void>; defaults?: { assign?: Assign; department?: string } }) {
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
      setF(item ? { assign: item.department ? "department" : item.assigneeId && item.assigneeId !== account.userId ? "person" : "me", title: item.title, details: item.details, propertyId: item.propertyId ?? "", assigneeId: item.assigneeId ?? "", department: item.department ?? "", dueOn: item.dueOn ?? "",
        amount: item.amountMinor === null ? "" : (item.amountMinor / 100).toFixed(2), link: item.link ?? "", reference: item.reference, note: "", settled: item.settledMinor === null ? "" : (item.settledMinor / 100).toFixed(2) }
        : { assign: defaults?.assign ?? (defaults?.department ? "department" : "me"), department: defaults?.department ?? "", assigneeId: kind === "todo" ? account.userId : "" });
    });
    return () => { active = false; };
  }, [item, kind, account.userId, defaults?.assign, defaults?.department]);
  const set = (k: string) => (v: string) => setF(x => ({ ...x, [k]: v }));
  const mine = !item || item.createdBy === account.userId || account.role === "admin" || account.role === "super_admin" || kind === "aircover" || kind === "invoice";
  const editable = mine && !(kind === "approval" && item && item.status !== "pending");

  async function save() {
    if (busy) return;
    const amount = f.amount?.trim() ? poundsToMinor(f.amount) : null;
    if ((f.title ?? "").trim().length < 2) { setError("Add a title."); return; }
    if (kind === "approval" && amount === null) { setError("Add the amount to approve."); return; }
    if (f.amount?.trim() && amount === null) { setError("Enter the amount in pounds, for example 149.99."); return; }
    const assign = (f.assign || "me") as Assign;
    if (kind === "todo" && assign === "department" && !f.department) { setError("Choose the department."); return; }
    if (kind === "todo" && assign === "person" && !f.assigneeId) { setError("Choose the person."); return; }
    if (f.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.dueOn)) { setError("Choose a valid date."); return; }
    if (f.link && !/^https:\/\//.test(f.link.trim())) { setError("Use a secure link starting https://"); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({
        action: "saveHubItem", requestId: request.get(), ...(item ? { id: item.id, version: item.version } : {}), kind, title: f.title.trim(), details: (f.details ?? "").trim(),
        propertyId: f.propertyId || null, ...(kind === "todo" ? { assigneeId: assign === "me" ? account.userId : assign === "person" ? f.assigneeId || null : null, department: (assign === "department" ? f.department || null : null) as typeof DEPARTMENTS[number] | null } : {}),
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
      await writeTeams({ action: "moveHubItem", requestId: moveRequest.get(status), id: item.id, version: item.version, status, ...((f.note ?? "").trim() ? { note: f.note.trim() } : {}), ...(kind === "aircover" && status === "paid" && settled !== null ? { settledMinor: settled } : {}) });
      moveRequest.done(status); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const [title, placeholder] = KIND_TITLE[kind];
  const moves = item ? HUB_FLOW[kind].filter(s => s !== item.status && (kind !== "approval" || (hub?.canDecide && item.status === "pending" && s !== "pending"))) : [];
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={item ? item.title : "New " + title.toLowerCase()} subtitle={item ? `${title} · ${HUB_STATUS_LABEL[item.status]}${item.createdByName ? " · added by " + item.createdByName : ""}` : title} icon="clipboard">
      {editable ? <>
        <Field label={title} value={f.title ?? ""} onChange={set("title")} p={p} placeholder={placeholder} />
        <Field label="Details (optional)" value={f.details ?? ""} onChange={set("details")} p={p} multiline />
        {kind === "todo" && <>
          <Dropdown p={p} label="Assign to" value={(f.assign || "me") as Assign} options={ASSIGN_OPTIONS} onChange={a => setF(v => ({ ...v, assign: a }))} />
          {f.assign === "person" && <Dropdown p={p} label="Person to assign it to" value={f.assigneeId ?? ""} onChange={id => setF(v => ({ ...v, assigneeId: id }))}
            options={[{ value: "", label: "Choose a person" }, ...(hub?.people ?? []).map(x => ({ value: x.userId, label: x.userId === account.userId ? `Me${x.fullName ? ` (${x.fullName})` : ""}` : x.fullName || "Team member" }))]} />}
          {f.assign === "department" && <Dropdown p={p} label="Department to assign it to" value={f.department ?? ""} options={DEPARTMENT_OPTIONS} onChange={d => setF(v => ({ ...v, department: d }))} />}
        </>}
        {kind !== "todo" && <Field label={kind === "approval" ? "Amount, £" : kind === "aircover" ? "Amount claimed, £" : "Amount, £"} value={f.amount ?? ""} onChange={set("amount")} p={p} placeholder="0.00" />}
        {(kind === "todo" || kind === "invoice") && <View style={{ gap: 4 }}>
          <DateField p={p} label={kind === "todo" ? "Due date (optional)" : "Send by (optional)"} mode="single" wholeMonthLink={false} today={london(new Date())} empty={kind === "todo" ? "No due date" : undefined} value={{ from: f.dueOn ?? "", to: f.dueOn ?? "" }} onChange={r => setF(v => ({ ...v, dueOn: r.from }))} />
          {!!f.dueOn && <MotionPress accessibilityRole="button" accessibilityLabel={kind === "todo" ? "Remove the due date" : "Remove the date"} onPress={() => setF(v => ({ ...v, dueOn: "" }))} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{kind === "todo" ? "Remove the due date" : "No date"}</Text>
          </MotionPress>}
        </View>}
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
      {kind === "todo" && !!(item as { templateId?: string | null } | undefined)?.templateId && <Notice text="Added automatically from a daily task. Tick it off when it is done." p={p} />}
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
