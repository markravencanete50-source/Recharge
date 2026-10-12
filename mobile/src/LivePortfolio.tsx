import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import Feather from "@expo/vector-icons/Feather";
import { GrowBar, MotionPress, Pop, Stagger } from "./motion";
import { ui, type Palette } from "./theme";
import { ChartTip, useChartFocus } from "./ChartTip";
import { workspaceRequest } from "./backend/client";
import { formatCount, plural } from "../../lib/format";
import { ONBOARDING_PHASES, journeyPhase, onboardingProgress, type PropertyView } from "../../lib/workspace-view";
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

export function Chip({ p, label, count, on, onPress }: { p: Palette; label: string; count: number; on: boolean; onPress: () => void }) {
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
  const ownersRef = useRef(onOwners);
  useEffect(() => { ownersRef.current = onOwners; }, [onOwners]);
  useEffect(() => {
    let active = true;
    void workspaceRequest("/api/mobile/portfolio?section=insights").then(r => r.json()).then(body => { const parsed = insightsSchema.safeParse(body.data); if (active && parsed.success) { setInsights(parsed.data); ownersRef.current?.(parsed.data.owners.length); } }).catch(() => undefined);
    return () => { active = false; };
  }, [properties.length]);
  const byStage = new Map<string, string[]>();
  for (const prop of properties) { const s = stageOf(prop, journeys.find(j => j.propertyId === prop.id)); byStage.set(s, [...(byStage.get(s) ?? []), prop.id]); }
  const stages = [...ONBOARDING_PHASES, "Not onboarding", "Archived"].filter(s => byStage.has(s));
  const toggle = (next: Exclude<PropertyFilter, null>) => onFilter(filter && filter.kind === next.kind && filter.value === next.value ? null : next);
  const trend = insights?.trend ?? [], peak = Math.max(1, ...trend.map(t => t.bookedNights));
  const nights = useChartFocus(), [nightsWidth, setNightsWidth] = useState(0);
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
        <View onLayout={e => setNightsWidth(e.nativeEvent.layout.width)} accessibilityLabel={`Nights booked by month: ${trend.map(t => `${monthShort(t.month)} ${t.bookedNights}`).join(", ")}`} style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 96, position: "relative" }}>
          {trend.map((t, i) => (
            <MotionPress key={t.month} accessibilityRole="button" accessibilityLabel={`${monthShort(t.month)}: ${t.bookedNights} nights booked`} {...nights.press(i)} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <View style={{ width: "100%", height: 72, justifyContent: "flex-end" }}>
                <View style={{ height: Math.max(2, Math.round((t.bookedNights / peak) * 72)), borderRadius: 4, backgroundColor: t.bookedNights ? p.primary : p.wash }} />
              </View>
              <Text style={{ color: p.muted, fontSize: 10 }}>{monthShort(t.month).slice(0, 1)}</Text>
            </MotionPress>
          ))}
          {nights.focus !== null && trend[nights.focus] && <ChartTip p={p} x={(nights.focus + 0.5) / trend.length * nightsWidth} width={nightsWidth} top={-34} tipWidth={170} title={monthShort(trend[nights.focus].month)} rows={[{ label: "Nights booked", value: formatCount(trend[nights.focus].bookedNights), color: p.primary }, { label: "Live properties", value: formatCount(trend[nights.focus].liveProperties ?? 0) }]} />}
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

// The onboarding pipeline at a glance: every property still onboarding, its stage and the next
// step, with owner questions waiting for an answer and any agreed check-in date. Furthest along first.
export function OnboardingPipeline({ palette: p, properties, journeys, onOpen }: { palette: Palette; properties: PropertyView[]; journeys: JourneyView[]; onOpen: (property: PropertyView) => void }) {
  const rows = journeys
    .map(j => ({ j, property: properties.find(x => x.id === j.propertyId) }))
    .filter((r): r is { j: JourneyView; property: PropertyView } => !!r.property && r.property.status === "onboarding" && !["live", "declined", "archived"].includes(r.j.stage))
    .map(r => ({ ...r, phase: journeyPhase(r.j.stage), index: ONBOARDING_PHASES.indexOf(journeyPhase(r.j.stage)), questions: (r.j.questions ?? []).filter(q => !q.answer).length }))
    .sort((a, b) => b.index - a.index || a.property.name.localeCompare(b.property.name));
  if (!rows.length) return null;
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 4 }]}>
      <View style={[ui.between, { paddingBottom: 6 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Onboarding pipeline</Text>
        <Text style={[ui.small, { color: p.muted }]}>{plural(rows.length, "property", "properties")}</Text>
      </View>
      {rows.map((r, i) => (
        <Stagger key={r.property.id} index={i}>
          <MotionPress accessibilityRole="button" accessibilityLabel={`${r.property.name}, ${r.phase}. Next: ${onboardingProgress(r.j.stage).next}`} onPress={() => onOpen(r.property)}
            style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border, alignItems: "flex-start" }]}>
            <View style={{ gap: 3, alignItems: "center", paddingTop: 2 }}>
              {ONBOARDING_PHASES.map((_, n) => <View key={n} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: n < r.index ? p.success : n === r.index ? p.primary : p.border }} />)}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", fontSize: 15, flexShrink: 1 }}>{r.property.name}</Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: p.wash }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: "700" }}>{r.phase}</Text></View>
              </View>
              <Text style={[ui.small, { color: p.text }]}>Next: {onboardingProgress(r.j.stage).next}</Text>
              {(r.questions > 0 || !!r.j.followUpOn) && <Text style={[ui.small, { color: p.waiting }]}>
                {[r.questions ? `${plural(r.questions, "question")} from the owner to answer` : "", r.j.followUpOn ? `Check in on ${new Date(r.j.followUpOn + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ")}
              </Text>}
            </View>
            <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
          </MotionPress>
        </Stagger>
      ))}
    </View>
  );
}
