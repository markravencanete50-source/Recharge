import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SearchBox } from "./SearchPicker";
import { normalise } from "../../lib/search-options";
import { ExpandChevron, MotionPress } from "./motion";
import * as Crypto from "expo-crypto";
import { Loading, message, Notice, Tag } from "./LiveKit";
import { Initials } from "./LiveAccounts";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { defaultCleanersSchema, type DefaultCleaners } from "../../lib/workspace-teams-policy";
import { FORM_STATE_LABEL, FORM_STATE_TONE, isMissing, type FormState } from "../../lib/clean-forms";

// Who usually cleans each property. New cleans there (by hand or from a Hostaway stay) go straight to
// that cleaner, and choosing one hands them the property's upcoming cleans nobody has yet.
export function DefaultCleanersSheet({ p, visible, admin, onClose, onChanged }: { p: Palette; visible: boolean; admin: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<DefaultCleaners | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    try { setData(defaultCleanersSchema.parse((await readTeams({ section: "defaultCleaners" })).data)); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => {
    let active = true;
    if (visible) queueMicrotask(() => { if (active) { setError(""); setNote(""); setOpen(null); void load(); } });
    return () => { active = false; };
  }, [visible, load]);

  async function choose(propertyId: string, cleanerId: string | null) {
    if (busy) return; setBusy(propertyId); setError(""); setNote("");
    try {
      const r = await writeTeams({ action: "setDefaultCleaner", requestId: Crypto.randomUUID(), propertyId, cleanerId }) as { data?: { assignedCleans?: number } };
      const moved = r.data?.assignedCleans ?? 0;
      if (moved) setNote(`${moved} upcoming ${moved === 1 ? "clean" : "cleans"} assigned.`);
      setOpen(null); await load(); await onChanged();
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }

  // Every word typed must appear in the property's name or its usual cleaner's name.
  const words = normalise(query).split(" ").filter(Boolean);
  const shown = (data?.properties ?? []).filter(row => { const text = normalise(`${row.propertyName} ${row.cleanerName ?? ""}`); return words.every(w => text.includes(w)); });

  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Property cleaners" subtitle="Who usually cleans each property. Their cleans are assigned automatically." icon="people">
      {!data && !error && <Loading p={p} />}
      {!!note && <Notice text={note} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {data && !data.properties.length && <Notice text="No properties to show yet." p={p} />}
      {data && data.properties.length > 8 && <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search properties or cleaners" />}
      {data && !!query.trim() && !shown.length && <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{query.trim()}”.</Text>}
      {data && shown.map(row => {
        // A cleaning manager chooses from cleaners already on the property; an admin from every cleaner.
        const choices = data.cleaners.filter(c => admin || c.propertyIds.includes(row.propertyId));
        const expanded = open === row.propertyId;
        return (
          <View key={row.propertyId} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
            <MotionPress accessibilityRole="button" accessibilityState={{ expanded, disabled: !row.canEdit }} disabled={!row.canEdit} onPress={() => setOpen(expanded ? null : row.propertyId)} style={[ui.between, { gap: 12, minHeight: 40 }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700" }}>{row.propertyName}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{row.cleanerName ?? "No usual cleaner"}</Text>
              </View>
              {row.canEdit ? <ExpandChevron open={expanded} size={18} color={p.muted} /> : <Tag label={row.cleanerName ? "Set" : "Not set"} tone={row.cleanerName ? "good" : "wait"} p={p} />}
            </MotionPress>
            {expanded && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {choices.map(c => {
                const on = c.userId === row.cleanerId;
                return (
                  <MotionPress key={c.userId} accessibilityRole="radio" accessibilityState={{ selected: on }} disabled={!!busy || on} onPress={() => void choose(row.propertyId, c.userId)}
                    style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.background, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
                    <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{c.fullName}</Text>
                  </MotionPress>
                );
              })}
              {!!row.cleanerId && <MotionPress accessibilityRole="button" disabled={!!busy} onPress={() => void choose(row.propertyId, null)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: p.wash }}>
                <Text style={{ color: p.primary, fontSize: 13, fontWeight: "600" }}>No usual cleaner</Text>
              </MotionPress>}
              {!choices.length && <Text style={[ui.small, { color: p.muted }]}>{admin ? "No cleaners with the Cleans tool yet. Invite one in People." : "No cleaner is on this property yet. Ask an admin to add one in People."}</Text>}
            </View>}
          </View>
        );
      })}
    </Sheet>
  );
}

// Where a clean's form stands (Submitted, Unsubmitted, Warning, Not due yet), as a calm pill with an
// outline icon. The wording and tone come from lib/clean-forms.ts; `late` reads "Submitted late".
const FORM_ICON = { submitted: "check-circle", outstanding: "clock", warning: "alert-triangle", not_due: "minus-circle" } as const;
export function FormStateTag({ p, state, late = false }: { p: Palette; state: FormState; late?: boolean }) {
  const [bg, fg] = { good: [p.successWash, p.success], wait: [p.cautionWash, p.waiting], bad: [p.dangerWash, p.danger], plain: [p.wash, p.muted] }[FORM_STATE_TONE[state]];
  const label = late && state === "submitted" ? "Submitted late" : FORM_STATE_LABEL[state];
  return (
    <View accessible accessibilityLabel={`Forms: ${label}`} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <Feather name={FORM_ICON[state]} size={13} color={fg} />
      <Text style={{ color: fg, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

// Today's cleans by cleaner, for the office: who is cleaning where, how far each clean has got, and
// whether its form is in. `formState` is left out when the form state is not known.
export type TodayClean = { workId: string; propertyName: string; assigneeId: string | null; assigneeName: string | null; phase: string; formState?: FormState; late?: boolean };
export function WhoIsCleaning({ p, cleans, onOpen }: { p: Palette; cleans: TodayClean[]; onOpen: (workId: string) => void }) {
  const groups = new Map<string, { name: string; cleans: TodayClean[] }>();
  for (const c of cleans) {
    const key = c.assigneeId ?? "";
    const g = groups.get(key) ?? { name: c.assigneeId ? c.assigneeName || "Cleaner" : "Nobody yet", cleans: [] };
    g.cleans.push(c); groups.set(key, g);
  }
  const rows = [...groups.entries()].sort(([a, x], [b, y]) => (a ? 0 : 1) - (b ? 0 : 1) || x.name.localeCompare(y.name));
  if (!rows.length) return <Notice text="No cleans today." p={p} />;
  return (
    // One card per cleaner (side by side on a computer): their initials, how many cleans, and each one.
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {rows.map(([key, g]) => (
        <View key={key || "none"} style={[ui.card, { flexGrow: 1, flexBasis: 300, minWidth: 0, gap: 10, backgroundColor: p.surface, borderColor: key ? p.border : p.danger }]}>
          <View style={[ui.between, { gap: 10 }]}>
            <View style={[ui.row, { gap: 10, flex: 1, minWidth: 0 }]}>
              {key ? <Initials p={p} name={g.name} tone="cleans" size={36} /> : <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: p.dangerWash }}><Feather name="user-x" size={16} color={p.danger} /></View>}
              <Text numberOfLines={1} style={{ color: key ? p.text : p.danger, fontWeight: "700", fontSize: 15, flex: 1 }}>{g.name}</Text>
            </View>
            <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: p.background }}><Text style={[ui.small, { color: p.muted, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{g.cleans.length} {g.cleans.length === 1 ? "clean" : "cleans"}{formsDue(g.cleans) ? ` · ${formsDue(g.cleans)} outstanding` : ""}</Text></View>
          </View>
          {g.cleans.map(c => (
            <MotionPress key={c.workId} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={`${c.propertyName}, ${PHASE[c.phase]?.[0] ?? "Open"}${c.formState ? `, forms ${FORM_STATE_LABEL[c.formState].toLowerCase()}` : ""}`} onPress={() => onOpen(c.workId)} style={[ui.between, { gap: 8, minHeight: 40, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 }]}>
              <Text numberOfLines={1} style={{ color: p.text, flex: 1, minWidth: 0 }}>{c.propertyName}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                <Tag label={PHASE[c.phase]?.[0] ?? "Open"} tone={PHASE[c.phase]?.[1] ?? "plain"} p={p} />
                {!!c.formState && <FormStateTag p={p} state={c.formState} late={c.late} />}
              </View>
            </MotionPress>
          ))}
        </View>
      ))}
    </View>
  );
}
// How many of these cleans have a form that is outstanding or has become a warning.
const formsDue = (cleans: TodayClean[]) => cleans.filter(c => c.formState && isMissing(c.formState)).length;
const PHASE: Record<string, [string, "good" | "wait" | "plain"]> = { assigned: ["To do", "plain"], review: ["Done, to review", "wait"], accepted: ["Accepted", "good"] };
