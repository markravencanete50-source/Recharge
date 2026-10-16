import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ChoiceField } from "./ChoiceField";
import { useCelebrate } from "./Celebrate";
import { useToolTitled } from "./ToolPage";
import { Button, Field, Loading, message, Notice, useRequestId } from "./LiveKit";
import { icon, radius, space, ui, type Palette } from "./theme";
import { readRepairLimits, writeRepairLimit } from "./backend/client";
import { matchesSearch } from "../../lib/inbox-filters";
import { formatMoney } from "../../lib/format";
import {
  autoApprovedText, changedText, choiceOf, limitAction, limitResultSchema, limitsSchema, limitText, LIMIT_CHOICES, ownerTitle, SOURCE_TEXT,
  type LimitChoice, type LimitRow, type Limits,
} from "../../lib/repair-contractors";
import type { SectionProps } from "./SectionProps";

// Limit Changer (Management centre; Lee, 15 October 2026): every owner, their properties and how much Recharge can spend on
// a repair at each without asking them. A contractor's estimate within the limit is approved once the team has reviewed it;
// above it, the owner is asked. Super admins change limits (one property, or all of an owner's); admins can look.
// The database (workspace_repair_limits_action) checks who may change them and approves any waiting estimate now within its limit.
type Editing = { key: string; ownerKey: string; propertyIds: string[]; title: string; choice: LimitChoice; amount: string };

function LimitEditor({ p, editing, busy, onChange, onSave, onCancel }: { p: Palette; editing: Editing; busy: boolean; onChange: (next: Editing) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }} {...(Platform.OS === "web" ? { dataSet: { limitEditor: editing.key } } : {})}>
      <Text style={{ color: p.text, fontWeight: "700" }}>{editing.title}</Text>
      <ChoiceField p={p} label="Repair limit" value={editing.choice} onChange={choice => onChange({ ...editing, choice })} options={LIMIT_CHOICES} />
      {editing.choice === "amount" && <Field label="Limit in pounds" value={editing.amount} onChange={amount => onChange({ ...editing, amount })} p={p} placeholder="For example: 250" />}
      <Text style={[ui.small, { color: p.muted }]}>{editing.choice === "full" ? "Every repair estimate is approved once the team has reviewed it. The owner is told, not asked." : editing.choice === "ask" ? "The owner is asked about every repair estimate." : "Estimates up to this amount are approved once the team has reviewed them. Above it, the owner is asked."}</Text>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Button label={busy ? "Saving…" : "Save the limit"} icon="check" primary p={p} disabled={busy} onPress={onSave} />
        <Button label="Cancel" p={p} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

function PropertyLimit({ p, row, first, canEdit, onEdit }: { p: Palette; row: LimitRow; first: boolean; canEdit: boolean; onEdit: () => void }) {
  const changed = changedText(row);
  return (
    <View style={[ui.row, { gap: 10, minHeight: 56, paddingVertical: 8, borderTopWidth: first ? 0 : 1, borderColor: p.border }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{row.propertyName}</Text>
        <Text style={[ui.small, { color: p.muted }]}><Text style={{ color: p.text, fontWeight: "600" }}>{limitText(row)}</Text>{` · ${SOURCE_TEXT[row.source]}`}{changed ? ` · ${changed}` : ""}</Text>
      </View>
      {canEdit && <Button label="Change" icon="edit-2" p={p} onPress={onEdit} />}
    </View>
  );
}

export function LimitChanger({ p, work, onOpenWork }: { p: Palette } & Partial<Pick<SectionProps, "work" | "onOpenWork">>) {
  const celebrate = useCelebrate(), titled = useToolTitled();
  const [limits, setLimits] = useState<Limits | null>(null), [error, setError] = useState(""), [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null), [busy, setBusy] = useState(false), [saveError, setSaveError] = useState("");
  // The repairs approved automatically by the last change, with links to them.
  const [approved, setApproved] = useState<string[] | null>(null);
  const request = useRequestId(editing ? [editing.propertyIds.join(","), editing.choice, editing.amount].join(":") : null);
  const load = useCallback(async () => {
    try { setLimits(limitsSchema.parse((await readRepairLimits()).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const edit = (key: string, ownerKey: string, rows: LimitRow[], title: string) => {
    const first = rows[0];
    setSaveError(""); setApproved(null);
    setEditing({ key, ownerKey, propertyIds: rows.map(r => r.propertyId), title, choice: first ? choiceOf(first) : "amount", amount: first?.limitMinor != null && !first.fullPermission ? String(first.limitMinor / 100) : "" });
  };
  async function save() {
    if (!editing || busy) return;
    const built = limitAction(request.get(), editing.propertyIds, editing.choice, editing.amount);
    if ("error" in built) { setSaveError(built.error); return; }
    setBusy(true); setSaveError("");
    try {
      const result = limitResultSchema.parse((await writeRepairLimit(built.data)).data);
      request.done(); setEditing(null); setApproved(result.autoApproved); celebrate("Limit saved");
      await load();
    } catch (e) { setSaveError(message(e)); } finally { setBusy(false); }
  }

  const owners = (limits?.owners ?? []).map(o => ({ ...o, properties: matchesSearch(query, [ownerTitle(o)]) ? o.properties : o.properties.filter(x => matchesSearch(query, [x.propertyName])) })).filter(o => o.properties.length);
  const editor = (key: string) => editing?.key === key ? <LimitEditor p={p} editing={editing} busy={busy} onChange={setEditing} onSave={() => void save()} onCancel={() => { setEditing(null); setSaveError(""); }} /> : null;
  return (
    <View style={{ gap: space.section }} {...(Platform.OS === "web" ? { dataSet: { limitChanger: "page" } } : {})}>
      <View style={{ gap: 4 }}>
        {/* On its own page the page heading already says Limit Changer (ToolPage.tsx). */}
        {!titled && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Limit Changer</Text>}
        <Text style={[ui.body, { color: p.muted }]}>How much Recharge can spend on a repair at each property without asking the owner. A contractor’s estimate within the limit is approved once the team has reviewed it; above it, the owner is asked.</Text>
      </View>
      {limits && limits.companyLimitMinor !== null && <View style={[ui.row, { gap: 10, padding: 12, borderRadius: radius.control, backgroundColor: p.wash }]}>
        <Feather name="briefcase" size={icon.row} color={p.text} />
        <Text style={{ color: p.text, flex: 1 }}>Company limit for estimates the team enters: <Text style={{ fontWeight: "700" }}>{formatMoney(limits.companyLimitMinor)}</Text>. At or over it, management approve first.</Text>
      </View>}
      {limits && !limits.canEdit && <Notice text="Only a super admin can change repair limits. You can see them here." p={p} />}
      {approved && <View style={{ gap: 8 }} {...(Platform.OS === "web" ? { dataSet: { limitApproved: String(approved.length) } } : {})}>
        <Notice text={autoApprovedText(approved.length)} p={p}/>
        {approved.map(id => { const op = work?.find(x => x.workId === id); return op && onOpenWork ? <Button key={id} label={`Open: ${op.title}`} icon="arrow-right" p={p} onPress={() => onOpenWork(op)} /> : null; })}
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!limits && !error && <Loading p={p} />}
      {limits && <Field label="Search owners or properties" value={query} onChange={setQuery} p={p} />}
      {limits && !owners.length && <Text style={[ui.small, { color: p.muted }]}>{query.trim() ? "No owner or property matches that search." : "No properties yet."}</Text>}
      {owners.map(o => (
        <View key={o.ownerKey} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
          <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{ownerTitle(o)}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{o.properties.length} propert{o.properties.length === 1 ? "y" : "ies"}</Text>
            </View>
            {limits?.canEdit && o.properties.length > 1 && <Button label="Set for all of this owner's properties" icon="layers" quiet p={p} onPress={() => edit("owner:" + o.ownerKey, o.ownerKey, o.properties, `All of ${ownerTitle(o)}'s properties`)} />}
          </View>
          {editor("owner:" + o.ownerKey)}
          {o.properties.map((row, i) => (
            <View key={row.propertyId} style={{ gap: 8 }}>
              <PropertyLimit p={p} row={row} first={i === 0} canEdit={!!limits?.canEdit} onEdit={() => edit("property:" + row.propertyId, o.ownerKey, [row], row.propertyName)} />
              {editor("property:" + row.propertyId)}
            </View>
          ))}
          {!!saveError && editing?.ownerKey === o.ownerKey && <Notice text={saveError} p={p} tone="bad" />}
        </View>
      ))}
    </View>
  );
}
