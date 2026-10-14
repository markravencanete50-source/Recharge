import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { message, Notice } from "./LiveKit";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { todoHubSchema, type TodoHub } from "../../lib/todo";
import { londonDay } from "../../lib/today-board";
import { canSetUpChecklist, checklistProgress, managementChecklist, seesManagementChecklist, tickAction, tickedLine, type ChecklistRow } from "../../lib/management-checklist";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// "Today's checklist" at the top of Management: today's to-dos from the Management daily tasks
// (lib/management-checklist.ts). The same to-dos as the To-do list, ticked with the same action, so the
// two always agree. Admins, super admins and the management department see it; nobody else.
export function ManagementChecklist({ p, account, onSetUp }: { p: Palette; account: WorkspaceAccount; onSetUp: () => void }) {
  const today = londonDay(new Date());
  const [hub, setHub] = useState<TodoHub | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const load = useCallback(async (first = false) => {
    // Today's daily to-dos are made by the schedule; asking each time Management opens makes sure they exist,
    // including a task set up a minute ago (it is idempotent, as the To-do list's own ask is).
    if (first) await writeTeams({ action: "ensureDailyTodos", requestId: Crypto.randomUUID() }).catch(() => undefined);
    try { setHub(todoHubSchema.parse((await readTeams({ section: "hub" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(true); }); return () => { active = false; }; }, [load]);

  const rows = useMemo(() => managementChecklist(hub?.items ?? [], today), [hub, today]);
  const progress = checklistProgress(rows);
  async function tick(row: ChecklistRow) {
    if (busy) return;
    const key = `${row.id}:${row.item.version}:${row.done ? "open" : "done"}`;
    if (!requests.current.has(key)) requests.current.set(key, Crypto.randomUUID());
    setBusy(row.id); setError("");
    try { await writeTeams(tickAction(row, requests.current.get(key)!)); requests.current.delete(key); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(null); }
  }

  // Admins see it straight away; others once the read says their department is management.
  if (!seesManagementChecklist(account.role, hub?.department ?? null)) return null;
  return (
    <View accessibilityLabel="Today's checklist" style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8, paddingVertical: 14 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>Today&apos;s checklist</Text>
        {!!rows.length && <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{progress.label}</Text>}
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {hub && !rows.length && <View style={{ gap: 4 }}>
        <Text style={[ui.small, { color: p.muted }]}>No daily checklist yet.</Text>
        {canSetUpChecklist(account.role) && <MotionPress accessibilityRole="link" onPress={onSetUp} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}>
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Set up the checklist</Text>
        </MotionPress>}
      </View>}
      {rows.map((row, n) => {
        const line = tickedLine(row);
        return (
          <MotionPress key={row.id} accessibilityRole="checkbox" accessibilityState={{ checked: row.done, disabled: busy === row.id }} accessibilityLabel={(row.done ? "Reopen: " : "Tick: ") + row.title}
            disabled={!!busy} onPress={() => void tick(row)}
            style={[ui.row, { gap: 10, alignItems: "flex-start", minHeight: 40, paddingVertical: 6, borderTopWidth: n ? 1 : 0, borderTopColor: p.border, opacity: busy && busy !== row.id ? 0.7 : 1 }]}>
            <Feather name={row.done ? "check-square" : "square"} size={18} color={row.done ? p.success : p.muted} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={2} style={{ color: row.done ? p.muted : p.text, fontSize: 14, lineHeight: 20, textDecorationLine: row.done ? "line-through" : "none" }}>{row.title}</Text>
              {!!line && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{line}</Text>}
            </View>
          </MotionPress>
        );
      })}
    </View>
  );
}
