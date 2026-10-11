import { useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { GrowBar, MotionPress, Pop, TweenNumber } from "./motion";
import { ui, type Palette } from "./theme";
import { ChartTip, useChartFocus } from "./ChartTip";
import { formatBps, formatMoney, plural } from "../../lib/format";
import { AVAILABLE_NIGHTS, DIRECT_RANGE, OCCUPANCY_RANGE, SCENARIOS, directBookingGain, hasFees, project, readEstimate, snap, startingChoices, type Choices } from "../../lib/estimate-projection";

// The owner explores their estimate: pick how the year might go, how busy the property is and how
// many guests book direct, and see what they could earn. Nothing here is saved or sent anywhere.
const pounds = (minor: number) => formatMoney(Math.round(minor / 100) * 100).replace(/\.00$/, "");

function Stepper({ p, label, help, value, range, onChange }: { p: Palette; label: string; help: string; value: number; range: { min: number; max: number; step: number }; onChange: (v: number) => void }) {
  const button = (icon: "minus" | "plus", next: number) => {
    const disabled = icon === "minus" ? value <= range.min : value >= range.max;
    return (
      <MotionPress accessibilityRole="button" accessibilityLabel={(icon === "plus" ? "More " : "Less ") + label.toLowerCase()} disabled={disabled} onPress={() => onChange(snap(next, range))}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, opacity: disabled ? 0.35 : 1 }}>
        <Feather name={icon} size={18} color={p.text} />
      </MotionPress>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={[ui.between, { gap: 12 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: p.text, fontWeight: "700" }}>{label}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{help}</Text>
        </View>
        <View style={[ui.row, { gap: 10 }]}>
          {button("minus", value - range.step)}
          <Text accessibilityLiveRegion="polite" style={{ color: p.text, fontSize: 20, fontWeight: "700", minWidth: 56, textAlign: "center", fontVariant: ["tabular-nums"] }}>{formatBps(value).replace(".0%", "%")}</Text>
          {button("plus", value + range.step)}
        </View>
      </View>
      <GrowBar share={(value - range.min) / (range.max - range.min)} color={p.primary} track={p.wash} height={6} />
    </View>
  );
}

function Line({ p, label, value, tone, strong }: { p: Palette; label: string; value: number; tone?: "minus"; strong?: boolean }) {
  return (
    <View style={[ui.between, { gap: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: p.border }]}>
      <Text style={{ color: strong ? p.text : p.muted, fontWeight: strong ? "700" : "500", flex: 1 }}>{label}</Text>
      <TweenNumber value={tone === "minus" ? -value : value} format={n => (n < 0 ? "−" : "") + pounds(Math.abs(n))} style={{ color: p.text, fontWeight: strong ? "700" : "600", fontVariant: ["tabular-nums"] }} />
    </View>
  );
}

export function EstimateExplorer({ palette: p, estimate, owner }: { palette: Palette; estimate: Record<string, unknown> | null; owner: boolean }) {
  const published = useMemo(() => readEstimate(estimate), [estimate]);
  const [choices, setChoices] = useState<Choices | null>(() => published ? startingChoices(published) : null);
  const splitFocus = useChartFocus(), [splitWidth, setSplitWidth] = useState(0);
  if (!published || !choices) return null;
  const start = startingChoices(published), fees = hasFees(published);
  const result = project(published, choices), gain = directBookingGain(published, choices);
  const set = (next: Partial<Choices>) => setChoices({ ...choices, ...next });
  const changed = choices.scenario !== start.scenario || choices.occupancyBps !== start.occupancyBps || choices.directBookingBps !== start.directBookingBps;
  const total = result.grossMinor || 1;
  const split = fees ? [
    { label: owner ? "Your earnings" : "Owner earnings", minor: result.ownerMinor!, color: p.success },
    { label: "Recharge management", minor: result.managementFeesMinor!, color: p.primary, opacity: 0.55 },
    { label: "Platform fees", minor: result.platformFeesMinor!, color: p.waiting },
  ] : [];
  return (
    <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border, gap: 16 }]}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "700" }}>{owner ? "Explore your estimate" : "Estimate explorer"}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{owner ? "Change the figures to see what the property could earn." : "What the owner sees when they explore the estimate."}</Text>
      </View>

      <View accessibilityRole="tablist" style={[ui.row, { gap: 6, padding: 4, borderRadius: 16, backgroundColor: p.wash }]}>
        {SCENARIOS.map(s => {
          const on = choices.scenario === s.id, rate = s.id === "low" ? published.lowRateMinor : s.id === "high" ? published.highRateMinor : published.mediumRateMinor;
          return (
            <Pop key={s.id} active={on} style={{ flex: 1, minWidth: 0 }}>
              <MotionPress accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => set({ scenario: s.id })}
                style={{ minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingVertical: 6, paddingHorizontal: 4, backgroundColor: on ? p.surface : "transparent", borderWidth: on ? 1 : 0, borderColor: p.border }}>
                <Text style={{ color: on ? p.text : p.muted, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{s.label}</Text>
                <Text style={{ color: on ? p.primary : p.muted, fontSize: 12, fontWeight: "600", textAlign: "center", fontVariant: ["tabular-nums"] }}>{pounds(rate)} a night</Text>
              </MotionPress>
            </Pop>
          );
        })}
      </View>

      <Stepper p={p} label="Occupancy" help={`About ${plural(result.occupiedNights, "night")} booked a year`} value={choices.occupancyBps} range={OCCUPANCY_RANGE} onChange={v => set({ occupancyBps: v })} />
      {fees && <Stepper p={p} label="Booked direct" help="Direct guests pay no platform fee" value={choices.directBookingBps} range={DIRECT_RANGE} onChange={v => set({ directBookingBps: v })} />}

      <View style={{ padding: 16, borderRadius: 18, backgroundColor: p.header, gap: 4 }}>
        <Text style={{ color: p.headerMuted, fontSize: 13, fontWeight: "600" }}>{fees ? (owner ? "You could earn" : "Owner could earn") : "Booking income"}</Text>
        <View style={[ui.row, { gap: 8, alignItems: "baseline", flexWrap: "wrap" }]}>
          <TweenNumber value={fees ? result.ownerMinor! : result.grossMinor} format={pounds} style={{ color: p.headerText, fontSize: 32, lineHeight: 38, fontWeight: "700", fontVariant: ["tabular-nums"] }} />
          <Text style={{ color: p.headerText, fontSize: 15 }}>a year</Text>
        </View>
        <Text style={{ color: p.headerMuted, fontSize: 13, fontVariant: ["tabular-nums"] }}>About {pounds(fees ? result.monthlyOwnerMinor! : result.monthlyGrossMinor)} a month</Text>
      </View>

      {fees && <View style={{ gap: 0 }}>
        <View onLayout={e => setSplitWidth(e.nativeEvent.layout.width)} style={{ position: "relative", zIndex: 5 }}>
          <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: p.wash, marginBottom: 6 }}>
            {split.map((x, i) => <MotionPress key={x.label} accessibilityRole="button" accessibilityLabel={`${x.label}: ${pounds(x.minor)}`} {...splitFocus.press(i)} style={{ flex: Math.max(0, x.minor) / total, backgroundColor: x.color, opacity: x.opacity ?? 1 }} />)}
          </View>
          {splitFocus.focus !== null && split[splitFocus.focus] && <ChartTip p={p} x={(split.slice(0, splitFocus.focus).reduce((t, x) => t + Math.max(0, x.minor), 0) + Math.max(0, split[splitFocus.focus].minor) / 2) / total * splitWidth} width={splitWidth} top={18} tipWidth={180} title={split[splitFocus.focus].label} rows={[{ label: "A year", value: pounds(split[splitFocus.focus].minor), color: split[splitFocus.focus].color }, { label: "Share of income", value: Math.round(Math.max(0, split[splitFocus.focus].minor) / total * 100) + "%" }]} />}
        </View>
        <Line p={p} label="Booking income" value={result.grossMinor} />
        <Line p={p} label={`Platform fees (${formatBps(published.otaFeeBps!).replace(".0%", "%")} on non-direct bookings)`} value={result.platformFeesMinor!} tone="minus" />
        <Line p={p} label={`Recharge management (${formatBps(published.managementFeeBps!).replace(".0%", "%")})`} value={result.managementFeesMinor!} tone="minus" />
        <Line p={p} label={owner ? "Your earnings" : "Owner earnings"} value={result.ownerMinor!} strong />
      </View>}
      {!!gain && gain > 0 && <View style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.successWash }]}>
        <Feather name="trending-up" size={17} color={p.success} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>Booking {formatBps(choices.directBookingBps).replace(".0%", "%")} direct keeps about {pounds(gain)} a year that would otherwise go in platform fees.</Text>
      </View>}

      <Text style={[ui.small, { color: p.muted }]}>An estimate, not a guarantee. {fees ? "Before cleaning, maintenance, utilities and tax." : "Your Recharge contact will add the fees so you can see your earnings."} Assumes the property is available all {AVAILABLE_NIGHTS} nights of the year.</Text>
      {changed && <MotionPress accessibilityRole="button" onPress={() => setChoices(start)} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
        <Text style={{ color: p.primary, fontWeight: "700" }}>Back to Recharge’s estimate</Text>
      </MotionPress>}
    </View>
  );
}
