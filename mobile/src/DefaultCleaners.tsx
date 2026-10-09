import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import * as Crypto from "expo-crypto";
import { Loading, message, Notice, Tag } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { defaultCleanersSchema, type DefaultCleaners } from "../../lib/workspace-teams-policy";

// Who usually cleans each property. New cleans there (by hand or from a Hostaway stay) go straight to
// that cleaner, and choosing one hands them the property's upcoming cleans nobody has yet.
export function DefaultCleanersSheet({ p, visible, admin, onClose, onChanged }: { p: Palette; visible: boolean; admin: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<DefaultCleaners | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
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

  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Property cleaners" subtitle="Who usually cleans each property. Their cleans are assigned automatically." icon="people">
      {!data && !error && <Loading p={p} />}
      {!!note && <Notice text={note} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {data && !data.properties.length && <Notice text="No properties to show yet." p={p} />}
      {data?.properties.map(row => {
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
              {row.canEdit ? <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={p.muted} /> : <Tag label={row.cleanerName ? "Set" : "Not set"} tone={row.cleanerName ? "good" : "wait"} p={p} />}
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

// Today's cleans by cleaner, for the office: who is cleaning where, and how far each clean has got.
export type TodayClean = { workId: string; propertyName: string; assigneeId: string | null; assigneeName: string | null; phase: string };
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
    <View style={{ gap: 8 }}>
      {rows.map(([key, g]) => (
        <View key={key || "none"} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: key ? p.border : p.danger }]}>
          <View style={[ui.between, { gap: 8 }]}>
            <View style={[ui.row, { gap: 8, flex: 1, minWidth: 0 }]}>
              <Feather name={key ? "user" : "user-x"} size={16} color={key ? p.muted : p.danger} />
              <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", flex: 1 }}>{g.name}</Text>
            </View>
            <Text style={[ui.small, { color: p.muted }]}>{g.cleans.length} {g.cleans.length === 1 ? "clean" : "cleans"}</Text>
          </View>
          {g.cleans.map(c => (
            <MotionPress key={c.workId} accessibilityRole="button" accessibilityLabel={`${c.propertyName}, ${PHASE[c.phase]?.[0] ?? "Open"}`} onPress={() => onOpen(c.workId)} style={[ui.between, { gap: 8, minHeight: 36 }]}>
              <Text numberOfLines={1} style={{ color: p.text, flex: 1, minWidth: 0 }}>{c.propertyName}</Text>
              <Tag label={PHASE[c.phase]?.[0] ?? "Open"} tone={PHASE[c.phase]?.[1] ?? "plain"} p={p} />
            </MotionPress>
          ))}
        </View>
      ))}
    </View>
  );
}
const PHASE: Record<string, [string, "good" | "wait" | "plain"]> = { assigned: ["To do", "plain"], review: ["Done, to review", "wait"], accepted: ["Accepted", "good"] };
