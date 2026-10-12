import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress, SwapIn } from "./motion";
import { ui, type Palette } from "./theme";
import { Button, Loading, Notice, Tag, message } from "./LiveKit";
import { readOversight } from "./backend/client";
import { historyRows, historySchema, type HistoryRow } from "../../lib/oversight-policy";
import type { HomeToolTarget } from "../../lib/home-tools";
import type { OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

const SHOWN = 4;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

// Who did what to this item and when: every status change, step and decision, newest first, with
// the notes and evidence recorded at the time.
export function WorkHistory({ p, workId, version, hideNames = false }: { p: Palette; workId: string; version: number; hideNames?: boolean }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    try { setRows(historyRows(historySchema.parse((await readOversight({ section: "history", workId })).data)).reverse()); setError(""); }
    catch (e) { setError(message(e)); }
  }, [workId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, version]);
  const shown = rows ? (all ? rows : rows.slice(0, SHOWN)) : [];
  return (
    <View style={{ gap: 10 }}>
      <View style={ui.between}>
        <Text accessibilityRole="header" style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>History</Text>
        {!!rows && <Text style={[ui.small, { color: p.muted }]}>{rows.length} {rows.length === 1 ? "entry" : "entries"}</Text>}
      </View>
      {!rows && !error && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {rows && !rows.length && <Text style={[ui.small, { color: p.muted }]}>Nothing has been recorded on this item yet.</Text>}
      {shown.map((row, i) => (
        <SwapIn key={row.key} swapKey={row.key} style={[ui.row, { gap: 12, alignItems: "flex-start" }]}>
          {/* A small timeline: a dot for each entry, joined by a line. */}
          <View style={{ alignItems: "center", alignSelf: "stretch", width: 12 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: i === 0 ? p.primary : p.border }} />
            {i < shown.length - 1 && <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: p.border }} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3, paddingBottom: 6 }}>
            <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{row.label}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{hideNames ? "Recharge" : row.by ?? "Automatic"} · {stamp(row.at)}</Text>
            {!!row.note && <Text selectable style={[ui.small, { color: p.text }]}>{row.note}</Text>}
            {!!row.evidence.length && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{row.evidence.map(e => <Tag key={e} label={e} tone="plain" p={p} />)}</View>}
          </View>
        </SwapIn>
      ))}
      {!!rows && rows.length > SHOWN && (
        <MotionPress accessibilityRole="button" accessibilityState={{ expanded: all }} onPress={() => setAll(!all)} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
          <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>{all ? "Show less" : `Show all ${rows.length}`}</Text>
          <ExpandChevron open={all} size={16} color={p.primary} />
        </MotionPress>
      )}
    </View>
  );
}

// A "price the empty nights" ticket opens Client relations at its Pricing tab, where each night is priced.
// Only the people who may price a night (the Stays role and admins) are offered the button.
export function PriceNightsLink({ p, account, item, onOpen }: { p: Palette; account: WorkspaceAccount; item: OperationView; onOpen: (target: HomeToolTarget) => void }) {
  if (item.kind !== "pricing_gap" || ["completed", "cancelled"].includes(item.status) || !["stays", "admin", "super_admin"].includes(account.role)) return null;
  return <Button label="Price these nights in Client relations" icon="tag" primary p={p} onPress={() => onOpen({ kind: "work", view: "clients", sub: "pricing" })} />;
}
