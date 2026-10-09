import { useCallback, useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Button, Loading, message, Notice, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { readChecklists, writeChecklists } from "./backend/client";
import { MAX_ITEM_PHOTOS, templateFor, templatesSchema, type TemplateItem } from "../../lib/clean-checklist-policy";
import type { PropertyView } from "../../lib/workspace-view";

// Clean checklists: one for every property, and one for a property that needs its own. Admins and
// cleaning managers choose which checks need photos, and how many. New cleans get these checks; the
// photo rules also apply to cleans already scheduled with the same checks.
type Templates = z.infer<typeof templatesSchema>;
export type TemplatesState = { data: Templates | null; error: string; reload: () => Promise<void> };
// The checks a clean has when nobody has set a checklist (the same as a new Hostaway clean).
const STANDARD = ["Strip the beds and remake them with fresh linen", "Clean and restock the kitchen", "Clean the bathrooms and replace the towels", "Vacuum and mop every floor", "Empty every bin", "Restock guest essentials", "Check for damage or missing items and report it"];
const ALL = "all";

export function useChecklistTemplates(enabled: boolean): TemplatesState {
  const [data, setData] = useState<Templates | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setData(templatesSchema.parse((await readChecklists({ section: "templates" })).data)); setError(""); }
    catch (e) { setData(null); setError(message(e)); }
  }, [enabled]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void reload(); }); return () => { active = false; }; }, [reload]);
  return { data, error, reload };
}

type Draft = { key: string; label: string; photoRequired: boolean; minPhotos: number };
const draftOf = (items: TemplateItem[]): Draft[] => items.map((x, i) => ({ key: `${i}:${x.label}`, label: x.label, photoRequired: x.photoRequired, minPhotos: x.minPhotos ?? 1 }));

export function ChecklistTemplatesSheet({ p, visible, properties, state, onClose }: { p: Palette; visible: boolean; properties: PropertyView[]; state: TemplatesState; onClose: () => void }) {
  const saved = useSaved();
  const [scope, setScope] = useState(ALL);
  const [items, setItems] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const templates = state.data?.templates ?? [];
  const own = templates.find(t => (t.propertyId ?? ALL) === scope) ?? null;
  const fallback = scope === ALL ? null : templateFor(templates, null);
  const payload = items.map(x => ({ label: x.label.trim(), photoRequired: x.photoRequired, ...(x.photoRequired ? { minPhotos: x.minPhotos } : {}) }));
  const request = useRequestId(visible ? `${scope}:${own?.version ?? 0}:${JSON.stringify(payload)}` : null);

  // Each scope opens on its own checklist, else the one it uses today.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const start = own?.items ?? fallback?.items ?? STANDARD.map(label => ({ label, photoRequired: false }));
      setItems(draftOf(start)); setError("");
    });
    return () => { active = false; };
    // Only when the scope or the saved checklist changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, own?.version, fallback?.version, visible]);

  const names = items.map(x => x.label.trim());
  const problem = !items.length ? "Add at least one check." : items.length > 30 ? "Up to 30 checks." : names.some(n => !n) ? "Name every check." : new Set(names).size !== names.length ? "Give each check a different name." : "";
  const update = (key: string, change: Partial<Draft>) => setItems(current => current.map(x => x.key === key ? { ...x, ...change } : x));
  async function run(action: () => Promise<unknown>, text: string) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); request.done(); await saved(state.reload, text)(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const save = () => run(() => writeChecklists({ action: "saveTemplate", requestId: request.get(), propertyId: scope === ALL ? null : scope, version: own?.version ?? 0, items: payload }), "Checklist saved");
  const remove = () => own && run(() => writeChecklists({ action: "removeTemplate", requestId: request.get(), propertyId: scope === ALL ? null : scope, version: own.version }), scope === ALL ? "Checklist removed" : "Back to the checklist for every property");
  const scopeName = scope === ALL ? "every property" : properties.find(x => x.id === scope)?.name ?? "this property";
  const required = items.filter(x => x.photoRequired).length;

  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Clean checklists" subtitle="Checks for each clean, and which need photos" icon="clipboard">
      {!state.data && !state.error && <Loading p={p} rows={2} />}
      {!!state.error && <Notice text={state.error} p={p} tone="bad" />}
      {state.data && <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[[ALL, "Every property"] as const, ...properties.map(x => [x.id, x.name] as const)].map(([id, name]) => {
            const on = scope === id, has = templates.some(t => (t.propertyId ?? ALL) === id);
            return (
              <MotionPress key={id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${name}${has ? ", has its own checklist" : ""}`} onPress={() => setScope(id)} style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }]}>
                {has && id !== ALL && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? p.onPrimary : p.primary }} />}
                <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{name}</Text>
              </MotionPress>
            );
          })}
        </ScrollView>
        <Text style={[ui.small, { color: p.muted }]}>
          {own ? `Cleans at ${scopeName} use this checklist.` : scope === ALL ? "No checklist is set yet. Cleans use the standard checks, with no photo rules." : fallback ? `${scopeName} uses the checklist for every property. Save to give it its own.` : `${scopeName} uses the standard checks. Save to give it its own.`}
          {" "}New cleans get these checks. Photo rules also apply to cleans already scheduled with the same checks.
        </Text>
        {items.map((x, i) => (
          <View key={x.key} style={{ gap: 8, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: x.photoRequired ? p.primary : p.border, backgroundColor: p.surface }}>
            <View style={[ui.row, { gap: 8 }]}>
              <Text style={[ui.small, { color: p.muted, width: 22, fontVariant: ["tabular-nums"] }]}>{i + 1}</Text>
              <TextInput value={x.label} onChangeText={v => update(x.key, { label: v })} placeholder="What to check" placeholderTextColor={p.muted} accessibilityLabel={`Check ${i + 1}`} maxLength={200}
                style={{ flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
              <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${x.label || `check ${i + 1}`}`} onPress={() => setItems(current => current.filter(y => y.key !== x.key))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Feather name="x" size={18} color={p.muted} />
              </MotionPress>
            </View>
            <View style={[ui.row, { gap: 8, flexWrap: "wrap", paddingLeft: 30 }]}>
              <MotionPress accessibilityRole="switch" accessibilityState={{ checked: x.photoRequired }} accessibilityLabel={`Photo required for ${x.label || `check ${i + 1}`}`} onPress={() => update(x.key, { photoRequired: !x.photoRequired })}
                style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: x.photoRequired ? p.primary : p.wash }]}>
                <Feather name="camera" size={14} color={x.photoRequired ? p.onPrimary : p.primary} />
                <Text style={{ color: x.photoRequired ? p.onPrimary : p.primary, fontSize: 13, fontWeight: "600" }}>{x.photoRequired ? "Photo required" : "No photo needed"}</Text>
              </MotionPress>
              {x.photoRequired && <View style={[ui.row, { gap: 4 }]}>
                <MotionPress accessibilityRole="button" accessibilityLabel="Fewer photos" disabled={x.minPhotos <= 1} onPress={() => update(x.key, { minPhotos: Math.max(1, x.minPhotos - 1) })} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.wash, opacity: x.minPhotos <= 1 ? 0.5 : 1 }}><Feather name="minus" size={16} color={p.primary} /></MotionPress>
                <Text accessibilityLiveRegion="polite" style={{ color: p.text, fontWeight: "700", minWidth: 70, textAlign: "center" }}>{x.minPhotos === 1 ? "1 photo" : `${x.minPhotos} photos`}</Text>
                <MotionPress accessibilityRole="button" accessibilityLabel="More photos" disabled={x.minPhotos >= MAX_ITEM_PHOTOS} onPress={() => update(x.key, { minPhotos: Math.min(MAX_ITEM_PHOTOS, x.minPhotos + 1) })} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.wash, opacity: x.minPhotos >= MAX_ITEM_PHOTOS ? 0.5 : 1 }}><Feather name="plus" size={16} color={p.primary} /></MotionPress>
              </View>}
            </View>
          </View>
        ))}
        <Button label="Add a check" icon="plus" p={p} disabled={items.length >= 30} onPress={() => setItems(current => [...current, { key: `new:${Date.now()}`, label: "", photoRequired: false, minPhotos: 1 }])} />
        <Text style={[ui.small, { color: p.muted }]}>{items.length} {items.length === 1 ? "check" : "checks"} · {required ? `${required} need photos` : "none need photos"}</Text>
        {!!problem && <Text style={[ui.small, { color: p.muted }]}>{problem}</Text>}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : "Save checklist"} icon="check" primary p={p} disabled={busy || !!problem} onPress={() => void save()} />
        {own && <Button label={scope === ALL ? "Remove this checklist" : "Use the checklist for every property"} icon="rotate-ccw" p={p} disabled={busy} onPress={() => void remove()} />}
      </>}
    </Sheet>
  );
}
