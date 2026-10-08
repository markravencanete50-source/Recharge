import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { GrowBar, MotionPress, Pop } from "./motion";
import { ui, type Palette } from "./theme";
import { workspaceRequest } from "./backend/client";
import { formatCount, plural } from "../../lib/format";
import { ONBOARDING_PHASES, journeyPhase, type PropertyView } from "../../lib/workspace-view";
import type { JourneyView } from "../../lib/workflow-forms";

// The portfolio for the team: where every property is in its journey, each owner and their
// properties, and the last 12 months. Tapping a stage or an owner filters the property list.
export type PropertyFilter = { kind: "stage" | "owner"; value: string; label: string; ids: string[] } | null;
const insightsSchema = z.object({
  owners: z.array(z.object({ clientId: z.string(), name: z.string(), propertyIds: z.array(z.string()) })),
  trend: z.array(z.object({ month: z.string(), added: z.number(), wentLive: z.number(), bookedNights: z.number(), liveProperties: z.number() })),
});
type Insights = z.infer<typeof insightsSchema>;
const monthShort = (m: string) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

export function stageOf(property: PropertyView, journey?: JourneyView) {
  if (property.status === "active") return "Live";
  if (property.status === "archived") return "Archived";
  return journey ? journeyPhase(journey.stage) : "Not onboarding";
}

function Chip({ p, label, count, on, onPress }: { p: Palette; label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Pop active={on}><MotionPress accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={[ui.row, { gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? p.primary : p.background, borderWidth: 1, borderColor: on ? p.primary : p.border }]}>
      <Text style={{ color: on ? p.onPrimary : p.text, fontWeight: "600", fontSize: 13 }}>{label}</Text>
      <Text style={{ color: on ? p.onPrimary : p.muted, fontWeight: "700", fontSize: 13, fontVariant: ["tabular-nums"] }}>{formatCount(count)}</Text>
    </MotionPress></Pop>
  );
}

export function PortfolioInsights({ palette: p, properties, journeys, filter, onFilter, onOwners }: { palette: Palette; properties: PropertyView[]; journeys: JourneyView[]; filter: PropertyFilter; onFilter: (f: PropertyFilter) => void; onOwners?: (count: number) => void }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  useEffect(() => {
    let active = true;
    void workspaceRequest("/api/mobile/portfolio?section=insights").then(r => r.json()).then(body => { const parsed = insightsSchema.safeParse(body.data); if (active && parsed.success) { setInsights(parsed.data); onOwners?.(parsed.data.owners.length); } }).catch(() => undefined);
    return () => { active = false; };
  }, [properties.length]);
  const byStage = new Map<string, string[]>();
  for (const prop of properties) { const s = stageOf(prop, journeys.find(j => j.propertyId === prop.id)); byStage.set(s, [...(byStage.get(s) ?? []), prop.id]); }
  const stages = [...ONBOARDING_PHASES, "Not onboarding", "Archived"].filter(s => byStage.has(s));
  const toggle = (next: Exclude<PropertyFilter, null>) => onFilter(filter && filter.kind === next.kind && filter.value === next.value ? null : next);
  const trend = insights?.trend ?? [], peak = Math.max(1, ...trend.map(t => t.bookedNights));
  const year = trend.reduce((a, t) => ({ added: a.added + t.added, live: a.live + t.wentLive, nights: a.nights + t.bookedNights }), { added: 0, live: 0, nights: 0 });
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 16 }]}>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Where every property is</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {stages.map(s => <Chip key={s} p={p} label={s} count={byStage.get(s)!.length} on={filter?.kind === "stage" && filter.value === s} onPress={() => toggle({ kind: "stage", value: s, label: s, ids: byStage.get(s)! })} />)}
        </ScrollView>
      </View>
      {!!insights?.owners.length && <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Owners · {formatCount(insights.owners.length)}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[...insights.owners].sort((a, b) => b.propertyIds.length - a.propertyIds.length || a.name.localeCompare(b.name)).slice(0, 12).map(o =>
            <Chip key={o.clientId} p={p} label={o.name || "Owner"} count={o.propertyIds.length} on={filter?.kind === "owner" && filter.value === o.clientId} onPress={() => toggle({ kind: "owner", value: o.clientId, label: o.name || "Owner", ids: o.propertyIds })} />)}
        </View>
      </View>}
      {trend.length > 0 && <View style={{ gap: 10 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Last 12 months</Text>
          <Text style={[ui.small, { color: p.muted }]}>{plural(year.added, "property", "properties")} added · {formatCount(year.live)} gone live</Text>
        </View>
        <Text style={[ui.small, { color: p.muted }]}>Nights booked each month · {formatCount(year.nights)} in total</Text>
        <View accessibilityLabel={`Nights booked by month: ${trend.map(t => `${monthShort(t.month)} ${t.bookedNights}`).join(", ")}`} style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 96 }}>
          {trend.map(t => (
            <View key={t.month} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <View style={{ width: "100%", height: 72, justifyContent: "flex-end" }}>
                <View style={{ height: Math.max(2, Math.round((t.bookedNights / peak) * 72)), borderRadius: 4, backgroundColor: t.bookedNights ? p.primary : p.wash }} />
              </View>
              <Text style={{ color: p.muted, fontSize: 10 }}>{monthShort(t.month).slice(0, 1)}</Text>
            </View>
          ))}
        </View>
        <View style={[ui.between, { gap: 12 }]}>
          <Text style={[ui.small, { color: p.muted }]}>Live properties now</Text>
          <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatCount(trend.at(-1)?.liveProperties ?? 0)}</Text>
        </View>
        <GrowBar share={(trend.at(-1)?.liveProperties ?? 0) / Math.max(1, properties.filter(x => x.status !== "archived").length)} color={p.success} track={p.wash} height={6} />
      </View>}
    </View>
  );
}
