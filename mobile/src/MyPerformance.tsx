import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { readTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { teamPerformanceSchema, hoursLabel, type TeamPerformance } from "../../lib/management-live";
import { Tag } from "./LiveKit";
import { PERFORMANCE_RANGES, RANGE_LABEL, bonusProgress, ownPerson, performanceWindow, shapeOwnNumbers, type BonusProgress, type OwnNumbers, type PerformanceRange } from "../../lib/my-performance";
import { formatCount } from "../../lib/format";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { OperationView } from "../../lib/workflow-forms";

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

// One number with its label. Plain type, no icon square.
function Stat({ p, label, value, hint }: { p: Palette; label: string; value: string; hint?: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${hint ? ", " + hint : ""}`} style={{ flexBasis: "46%", flexGrow: 1, minWidth: 0, gap: 2, paddingVertical: 4 }}>
      <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
      <Text style={{ color: p.text, fontSize: 26, lineHeight: 32, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{value}</Text>
      {!!hint && <Text style={[ui.small, { color: p.muted }]}>{hint}</Text>}
    </View>
  );
}

// The bonus as a bar towards the area's target, with the target and each tier marked on it. A scheme the
// client has not set yet is labelled as a placeholder. Never a figure in pounds.
function BonusBar({ p, b }: { p: Palette; b: BonusProgress }) {
  const fill = b.value ?? 0;
  const marks = b.marks.map(m => `${m.label} ${m.at}%${m.reached ? ", reached" : ""}`).join(", ");
  return (
    <View style={{ gap: 10, paddingTop: 10, borderTopWidth: 1, borderColor: p.border }}>
      <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
        <Feather name="award" size={18} color={b.reached > 1 ? p.primary : p.muted} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{b.headline}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{b.areaLabel} · {b.measureLabel}</Text>
        </View>
        {b.value !== null && <Text style={{ color: p.text, fontSize: 20, lineHeight: 24, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{b.value}%</Text>}
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={`Bonus progress: ${b.measureLabel}. ${marks}`}
        accessibilityValue={{ min: 0, max: 100, now: fill, text: b.value === null ? "Nothing yet" : `${b.value}%` }}
        style={{ height: 12, borderRadius: 6, backgroundColor: p.wash, overflow: "hidden" }}>
        <View style={{ width: `${fill}%`, height: "100%", borderRadius: 6, backgroundColor: b.reached ? p.success : p.primary }} />
        {b.marks.map(m => <View key={m.label} style={{ position: "absolute", left: `${m.at}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: p.text, opacity: 0.45 }} />)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
        {b.marks.map(m => (
          <View key={m.label} style={[ui.row, { gap: 4 }]}>
            <Feather name={m.reached ? "check-circle" : "circle"} size={13} color={m.reached ? p.success : p.muted} />
            <Text style={[ui.small, { color: m.reached ? p.text : p.muted, fontVariant: ["tabular-nums"] }]}>{m.label} {m.at}%</Text>
          </View>
        ))}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{b.next}</Text>
      {b.placeholder && <View style={{ gap: 6 }}>
        <Tag label="Placeholder" tone="wait" p={p} />
        <Text style={[ui.small, { color: p.muted }]}>These targets and tiers are placeholders until the bonus scheme for {b.areaLabel.toLowerCase()} is agreed.</Text>
      </View>}
    </View>
  );
}

// The person's own numbers: guest-reply score, tasks done, time worked and the bonus as a bar towards
// the target (never a figure in pounds). `page` adds the week/month switch and the breakdown; without it this is
// the compact card on Home, which opens the page through `onOpen`.
export function MyPerformance({ palette: p, account, work = [], page = false, onOpen }: { palette: Palette; account: WorkspaceAccount; work?: OperationView[]; page?: boolean; onOpen?: () => void }) {
  const [range, setRange] = useState<PerformanceRange>("week");
  const [read, setRead] = useState<{ data: TeamPerformance; from: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let active = true;
    const { from, to } = performanceWindow(range, londonToday());
    readTeams({ section: "teamPerformance", from, to })
      .then(r => { if (!active) return; setRead({ data: teamPerformanceSchema.parse(r.data), from }); setState("ready"); })
      .catch(() => { if (active) setState("failed"); });
    return () => { active = false; };
  }, [range]);
  // Shaped here, so a refreshed work list updates the finished-job count without another read.
  const n: OwnNumbers | null = useMemo(() => read ? shapeOwnNumbers(read.data, account.userId, work, read.from) : null, [read, work, account.userId]);
  const bonus = useMemo(() => {
    const row = read ? ownPerson(read.data.people, account.userId) : null;
    return row && read ? bonusProgress(row, read.data.targets.greenMinutes) : null;
  }, [read, account.userId]);
  return (
    <View testID="my-performance" style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flexShrink: 1 }]}>My performance</Text>
        {!page && !!onOpen && <MotionPress accessibilityRole="button" accessibilityLabel="Open my performance" onPress={onOpen} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>See more</Text></MotionPress>}
      </View>
      {page ? (
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          {PERFORMANCE_RANGES.map(r => (
            <MotionPress key={r} accessibilityRole="button" accessibilityLabel={RANGE_LABEL[r]} accessibilityState={{ selected: range === r }} onPress={() => { if (r !== range) { setRange(r); setState("loading"); } }}
              style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: range === r ? p.primary : p.border, backgroundColor: range === r ? p.wash : p.surface }}>
              <Text style={{ color: range === r ? p.primary : p.text, fontSize: 13, fontWeight: "600" }}>{RANGE_LABEL[r]}</Text>
            </MotionPress>
          ))}
        </View>
      ) : <Text style={[ui.small, { color: p.muted }]}>{RANGE_LABEL.week}</Text>}
      {state === "loading" && !n && <Text style={[ui.small, { color: p.muted }]}>Loading your numbers…</Text>}
      {state === "failed" && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>Your numbers could not be loaded just now.</Text>}
      {state !== "failed" && !n && state === "ready" && <Text style={[ui.body, { color: p.muted }]}>Nothing to show yet. Your numbers appear once you have clocked in or replied to a guest.</Text>}
      {!!n && state !== "failed" && <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 8 }}>
          {n.score !== null && <Stat p={p} label="Score" value={`${n.score}%`} hint={n.onTrack === null ? undefined : n.onTrack ? "On track" : "Off track"} />}
          {n.replies > 0 && <Stat p={p} label="Guest replies on time" value={n.repliesGreenPercent === null ? "–" : `${n.repliesGreenPercent}%`} hint={`${formatCount(n.replies)} replies`} />}
          <Stat p={p} label="Tasks done" value={formatCount(n.tasksDone)} />
          <Stat p={p} label="Time worked" value={hoursLabel(n.minutes)} hint={`${formatCount(n.shifts)} ${n.shifts === 1 ? "shift" : "shifts"}`} />
        </View>
        {!!bonus && <BonusBar p={p} b={bonus} />}
        {page && <View style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderColor: p.border }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>How your tasks add up</Text>
          <Text style={[ui.small, { color: p.muted }]}>{formatCount(n.workCompleted)} finished jobs, {formatCount(n.daily.listingChecks)} listing checks, {formatCount(n.daily.pricingDecisions)} pricing decisions, {formatCount(n.daily.reviewsLogged)} reviews logged and {formatCount(n.daily.signOffs)} daily sign-offs.</Text>
        </View>}
      </>}
    </View>
  );
}
