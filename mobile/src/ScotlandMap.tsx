import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Path, Text as SvgText } from "react-native-svg";
import { Text } from "./Typography";
import { Entrance } from "./motion";
import { ui, type Palette } from "./theme";
import { LAND_PATHS, MAP_HEIGHT, MAP_WIDTH, mapBubbles } from "../../lib/scotland-map";
import { plural } from "../../lib/format";

// Properties on a simple map of Scotland: a circle per area, sized by count. Tap one for its name.
export function ScotlandMap({ palette: p, regions }: { palette: Palette; regions: { region: string; count: number }[] }) {
  const bubbles = mapBubbles(regions);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = bubbles.find(b => b.region === picked);
  const offMap = regions.filter(r => !bubbles.some(b => b.region === r.region)).reduce((n, r) => n + r.count, 0);
  return (
    <Entrance style={{ gap: 8, alignItems: "center", width: "100%", maxWidth: 280, alignSelf: "center" }}>
      <View accessible accessibilityRole="image" accessibilityLabel={"Map of properties by area: " + bubbles.map(b => `${b.region} ${b.count}`).join(", ")} style={{ width: "100%", aspectRatio: MAP_WIDTH / MAP_HEIGHT }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
          {LAND_PATHS.map((d, i) => <Path key={i} d={d} fill={p.wash} stroke={p.border} strokeWidth={0.9} strokeLinejoin="round" />)}
          {bubbles.map(b => {
            const on = b.region === picked;
            return (
              <G key={b.region} onPress={() => setPicked(on ? null : b.region)}>
                <Circle cx={b.x} cy={b.y} r={b.r + (on ? 2 : 0)} fill={on ? p.waiting : p.primary} fillOpacity={0.92} stroke={p.surface} strokeWidth={1.4} />
                <SvgText x={b.x} y={b.y + 3.6} fontSize={b.r > 10 ? 11 : 9.5} fontFamily="Montserrat_700Bold, Montserrat, sans-serif" fontWeight="700" textAnchor="middle" fill={p.onPrimary}>{b.count}</SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
      <Text accessibilityLiveRegion="polite" style={[ui.small, { color: chosen ? p.text : p.muted, fontWeight: chosen ? "700" : "400", textAlign: "center" }]}>
        {chosen ? `${chosen.region} · ${plural(chosen.count, "property", "properties")}` : bubbles.length ? "Tap a circle to see the area" : "Properties appear here once their area is set"}
      </Text>
      {offMap > 0 && <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>{plural(offMap, "property", "properties")} outside Scotland or without an area</Text>}
    </Entrance>
  );
}
