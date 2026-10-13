import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, useRequestId } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { Pills } from "./Pills";
import { Check } from "./ListingSheets";
import { writeTeams } from "./backend/client";
import { DEPARTMENTS, type TeamsAction } from "../../lib/workspace-teams-policy";
import { areaKpis, areaLabel, CHANGE_LABEL, emptyKpiForm, kpiForm, kpiInput, kpiMeasureLabel, type Kpi, type KpiForm, type KpiRead } from "../../lib/kpis";
import { formatDay } from "../../lib/format";

// Team performance -> KPIs, for admins and super admins: each area's KPIs in order, one of them counting for the bonus.
// Add, edit, switch off and on, move up and down. Every change is recorded with who made it; the list shows the last.
// Plain type and solid colours; percentages only, never a figure in pounds.
export function KpiAdmin({ p, read, onChanged }: { p: Palette; read: KpiRead; onChanged: () => Promise<void> }) {
  const saved = useSaved();
  const [area, setArea] = useState<(typeof DEPARTMENTS)[number]>("guest_relations");
  const [editing, setEditing] = useState<Kpi | "new" | null>(null);
  const [form, setForm] = useState<KpiForm>(emptyKpiForm());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(editing ? (editing === "new" ? "new-kpi" : `${editing.id}:${editing.version}`) : null);
  const list = areaKpis(read.kpis, area, true);
  const measures = read.measures.filter(m => m.areas.includes(form.area));
  const measure = read.measures.find(m => m.key === form.measure);
  const bonusHolder = read.kpis.find(k => k.area === form.area && k.active && k.countsForBonus && (editing === "new" || k.id !== editing?.id));
  const lastChange = (k: Kpi) => {
    const c = read.changes.find(x => x.kpiId === k.id);
    return k.updatedByName ? `Last changed by ${k.updatedByName} on ${formatDay(k.updatedAt.slice(0, 10))}` : c ? `${CHANGE_LABEL[c.change] ?? c.change} on ${formatDay(c.changedAt.slice(0, 10))}` : "";
  };
  const open = (k: Kpi | "new") => { setEditing(k); setForm(k === "new" ? emptyKpiForm(area) : kpiForm(k)); setError(""); };
  const set = (patch: Partial<KpiForm>) => setForm(f => ({ ...f, ...patch }));

  async function run(input: Record<string, unknown>, action?: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ requestId: request.get(action), ...input } as TeamsAction); request.done(action); setEditing(null); await saved(onChanged)(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function save() {
    const checked = kpiInput(form, read.measures);
    if ("error" in checked) { setError(checked.error); return; }
    void run({ action: "saveKpi", ...(editing && editing !== "new" ? { kpiId: editing.id, version: editing.version } : {}), ...checked.value });
  }

  return (
    <Section title="KPIs" count={read.kpis.filter(k => k.active).length} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>What each area is measured on. One KPI per area counts for the bonus; the rest are tracked. Everyone sees their own on My performance.</Text>
      <Pills p={p} values={DEPARTMENTS} value={area} onChange={setArea} label={a => areaLabel(a)} wrap />
      <List p={p} empty="No KPIs for this area yet." search={false}>
        {list.map((k, i) => {
          const tags: [string, "good" | "wait" | "bad" | "plain"][] = [];
          if (k.countsForBonus) tags.push(["Counts for the bonus", "good"]);
          if (!k.active) tags.push(["Switched off", "plain"]);
          if (k.placeholder) tags.push(["Placeholder", "wait"]);
          const goal = k.targetPercent === null ? "Tracked only" : `Target ${k.direction === "lower" ? "at most " : ""}${k.targetPercent}%${k.bonusTiers.length ? `, tiers ${k.bonusTiers.join("% and ")}%` : ""}`;
          return <Row key={k.id} p={p} first={i === 0} icon={k.countsForBonus ? "award" : "bar-chart-2"} tone="stays" title={k.name} detail={[kpiMeasureLabel(k), goal, lastChange(k)].filter(Boolean).join(" · ")} tags={tags} onPress={() => open(k)} />;
        })}
      </List>
      <Button label="Add a KPI" icon="plus" p={p} onPress={() => open("new")} />

      <Sheet palette={p} visible={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add a KPI" : editing?.name ?? ""} subtitle={editing && editing !== "new" ? lastChange(editing) : areaLabel(form.area)} icon="chart">
        <Field label="Name" value={form.name} onChange={v => set({ name: v })} p={p} placeholder="Replies within 5 minutes" />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Area</Text>
        <Pills p={p} values={DEPARTMENTS} value={form.area as (typeof DEPARTMENTS)[number]} onChange={a => set({ area: a, measure: read.measures.find(m => m.key === form.measure)?.areas.includes(a) ? form.measure : "" })} label={a => areaLabel(a)} wrap />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>What it measures</Text>
        <View style={{ gap: 6 }}>
          {measures.map(m => (
            <MotionPress key={m.key} accessibilityRole="radio" accessibilityState={{ selected: form.measure === m.key }} accessibilityLabel={m.label} onPress={() => set({ measure: m.key, minutes: m.needsMinutes ? form.minutes || "5" : "" })}
              style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: form.measure === m.key ? p.primary : p.border, backgroundColor: form.measure === m.key ? p.wash : p.surface }}>
              <Text style={{ color: form.measure === m.key ? p.primary : p.text, fontSize: 14 }}>{m.label}{m.direction === "lower" ? " (lower is better)" : ""}</Text>
            </MotionPress>
          ))}
        </View>
        {!!measure?.needsMinutes && <Field label="Minutes" value={form.minutes} onChange={v => set({ minutes: v })} p={p} placeholder="5" />}
        <Field label="Target % (leave empty to track only)" value={form.target} onChange={v => set({ target: v })} p={p} placeholder="80" />
        <Field label={`Bonus tiers %, ${measure?.direction === "lower" ? "below" : "above"} the target (for example 90, 95)`} value={form.tiers} onChange={v => set({ tiers: v })} p={p} placeholder="90, 95" />
        <Check p={p} label="Counts for the bonus" value={form.countsForBonus} onChange={v => set({ countsForBonus: v })} />
        {form.countsForBonus && !!bonusHolder && <Notice p={p} tone="bad" text={`"${bonusHolder.name}" counts for the bonus in ${areaLabel(form.area).toLowerCase()} now. Untick it there first: only one KPI per area counts.`} />}
        <Check p={p} label="Placeholder (not agreed yet)" value={form.placeholder} onChange={v => set({ placeholder: v })} />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : "Save"} icon="check" primary p={p} disabled={busy} onPress={save} />
        {editing && editing !== "new" && <View style={{ gap: 8 }}>
          <View style={[ui.row, { gap: 8 }]}>
            <View style={{ flex: 1 }}><Button label="Move up" icon="arrow-up" p={p} disabled={busy} onPress={() => void run({ action: "moveKpi", kpiId: editing.id, version: editing.version, direction: "up" }, "up")} /></View>
            <View style={{ flex: 1 }}><Button label="Move down" icon="arrow-down" p={p} disabled={busy} onPress={() => void run({ action: "moveKpi", kpiId: editing.id, version: editing.version, direction: "down" }, "down")} /></View>
          </View>
          <Button label={editing.active ? "Switch off" : "Switch on"} icon={editing.active ? "pause" : "play"} p={p} disabled={busy}
            onPress={() => void run({ action: "setKpiActive", kpiId: editing.id, version: editing.version, active: !editing.active }, "active")} />
          {editing.active && editing.countsForBonus && <Text style={[ui.small, { color: p.muted }]}>Switching it off also stops it counting for the bonus.</Text>}
        </View>}
      </Sheet>
    </Section>
  );
}
