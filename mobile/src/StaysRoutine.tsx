import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { GrowBar, MotionPress, Pop } from "./motion";
import { ui, type Palette } from "./theme";
import { addDays } from "./LiveKit";
import { useWorkJump } from "./WorkJump";
import { readWorkspace } from "./backend/client";
import { dailyChecks, vacantNights } from "../../lib/management-live";
import type { HomeToolTarget } from "../../lib/home-tools";
import { plural } from "../../lib/format";
import type { scheduleSchema } from "../../lib/cleans-live";
import type { PropertyView } from "../../lib/workspace-view";
import type { OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { ModuleId } from "../../lib/modules";

// Guest relations' day on one card: each part of the routine, how far along it is, and one tap to where it's done.
// Each tap opens a sub-page of Work → Guest relations or Client relations (there is no daily checks tab any more).
type Schedule = z.infer<typeof scheduleSchema>;
type Item = { key: string; label: string; detail: string; left: number; done: boolean; target: HomeToolTarget };
const has = (account: WorkspaceAccount, ...modules: ModuleId[]) => modules.some(m => account.modules.includes(m));
const open = (status: string) => !["completed", "cancelled", "declined"].includes(status);

export function TodaysRoutine({ p, account, properties, operations, schedule, today, loading }: {
  p: Palette; account: WorkspaceAccount; properties: PropertyView[]; operations: OperationView[]; schedule: Schedule; today: string; loading: boolean;
}) {
  const jump = useWorkJump();
  const [claims, setClaims] = useState<number | null>(null);
  const aircover = has(account, "aircover-reporting");
  // AirCover claims: count the ones still open.
  const loadClaims = useCallback(async () => {
    if (!aircover) return;
    try { setClaims(z.array(z.object({ status: z.string() })).parse((await readWorkspace({ entity: "work", moduleId: "aircover-reporting" })).data ?? []).filter(c => open(c.status)).length); }
    catch { setClaims(null); }
  }, [aircover]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadClaims(); }); return () => { active = false; }; }, [loadClaims, operations]);

  if (loading && !operations.length && !schedule.stays.length) return null;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const checks = dailyChecks(properties.map(x => x.id), operations, today, addDays(today, 6));
  const checked = checks.filter(c => c.listingCheckedToday).length;
  const unpriced = properties.reduce((n, prop) => n + vacantNights(prop.id, schedule.stays, week).filter(night => !operations.some(op => op.propertyId === prop.id && op.kind === "daily_pricing" && op.data.night === night)).length, 0);
  const toRefer = operations.filter(op => op.kind === "maintenance" && op.data.phase === "triage" && open(op.status)).length;
  const cleans = schedule.work.filter(w => w.kind === "cleaning" && w.dueOn === today);
  const cleansDone = cleans.filter(w => w.status === "completed").length;
  const offers = operations.filter(op => op.kind === "direct_booking" && ["follow_up", "quoted"].includes(String(op.data.phase)) && open(op.status)).length;
  const monday = new Date(today + "T12:00:00Z").getUTCDay() === 1;
  const listingsAt = { kind: "work", view: "clients", sub: "listings" } as const, pricingAt = { kind: "work", view: "clients", sub: "pricing" } as const;
  const items: Item[] = [
    ...(has(account, "listing-health") ? [{ key: "listings", label: "Listing checks", detail: properties.length ? `${checked} of ${properties.length} done` : "No properties yet", left: properties.length - checked, done: checked >= properties.length, target: listingsAt }] : []),
    ...(has(account, "daily-pricing") ? [{ key: "pricing", label: "Price the empty nights", detail: unpriced ? `${plural(unpriced, "night")} this week still to price` : "Every empty night this week is priced", left: unpriced, done: !unpriced, target: pricingAt }] : []),
    ...(has(account, "stays-maintenance-reporting", "maintenance-reporting") ? [{ key: "repairs", label: "Refer repairs to Ready", detail: toRefer ? `${plural(toRefer, "repair")} waiting for you` : "Nothing to refer", left: toRefer, done: !toRefer, target: { kind: "work", view: "stays", sub: "reactive" } as HomeToolTarget }] : []),
    ...(has(account, "cleaning-schedule") ? [{ key: "cleans", label: "Today’s cleans", detail: cleans.length ? `${cleansDone} of ${cleans.length} done` : "No cleans today", left: cleans.length - cleansDone, done: cleansDone >= cleans.length, target: { kind: "work", view: "stays", sub: "cleans" } as HomeToolTarget }] : []),
    ...(aircover ? [{ key: "aircover", label: "AirCover claims", detail: claims === null ? "Open the claims" : claims ? `${plural(claims, "claim")} open` : "No claims open", left: claims ?? 0, done: claims === 0, target: { kind: "work", view: "stays", sub: "aircover" } as HomeToolTarget }] : []),
    ...(has(account, "direct-bookings") ? [{ key: "offers", label: "Direct-booking offers", detail: offers ? `${plural(offers, "offer")} to follow up` : "No offers open", left: offers, done: !offers, target: { kind: "work", view: "stays", sub: "bookings" } as HomeToolTarget }] : []),
    ...(monday && has(account, "weekly-performance") ? [{ key: "weekly", label: "Weekly performance reports", detail: "Monday: send each owner their report from the property", left: 1, done: false, target: { kind: "tab", tab: "properties" } as HomeToolTarget }] : []),
  ];
  if (!items.length) return null;
  const done = items.filter(i => i.done).length;
  const go = (item: Item) => jump?.(item.target);
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700", flex: 1 }}>Today’s routine</Text>
        <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{done} of {items.length} done</Text>
      </View>
      <GrowBar share={items.length ? done / items.length : 0} color={p.success} track={p.wash} height={8} />
      <View>
        {items.map((item, i) => (
          <MotionPress key={item.key} accessibilityRole="button" accessibilityLabel={`${item.label}: ${item.detail}`} onPress={() => go(item)}
            style={[ui.row, { gap: 12, minHeight: 52, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <Pop active={item.done}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: item.done ? p.successWash : p.cautionWash }}>
                {item.done ? <Feather name="check" size={16} color={p.success} /> : <Text style={{ color: p.waiting, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{item.left > 99 ? "99+" : Math.max(1, item.left)}</Text>}
              </View>
            </Pop>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{item.label}</Text>
              <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{item.detail}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={p.muted} />
          </MotionPress>
        ))}
      </View>
    </View>
  );
}
