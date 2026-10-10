import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Text } from "./Typography";
import { Entrance, useReducedMotion } from "./motion";
import { ui, type Palette } from "./theme";
import { COUNCIL_AREAS, COUNCIL_BORDERS, LAND_BASE, LOCHS, RIVERS, TOWNS } from "../../lib/scotland-geo";
import { FULL_VIEW, MAP_HEIGHT, MAP_WIDTH, mapBubbles, projectXY, scaleBar, viewFor, type MapView } from "../../lib/scotland-map";
import { milesPerUnit } from "../../lib/scotland-projection";
import type { PropertyPoint } from "../../lib/property-points";
import { plural } from "../../lib/format";

// Properties on a real map of Scotland: coastline, council areas, lochs and rivers, towns, a sea and
// the neighbouring land, drawn from Natural Earth (public domain) so nothing is fetched and nothing
// about a property leaves the app. A pin per area is sized by count; tap one (or its area) to zoom in.
const LIGHT = { seaTop: "#CFE2E8", seaBottom: "#BCD6DF", grid: "#FFFFFF", seaText: "#6F97A6", neighbour: "#EEE8D8", neighbourEdge: "#CFC8B2", land: "#E4EBD3", border: "#B7C29E", coast: "#6C8E7C", water: "#A9CFDD", shadow: "#2F4F57", town: "#4A5B52", halo: "#F3F1E6", river: "#9CC6D6" };
const DARK = { seaTop: "#10272B", seaBottom: "#0C1D21", grid: "#FFFFFF", seaText: "#4F7C88", neighbour: "#1D302E", neighbourEdge: "#2B433F", land: "#26433B", border: "#35564C", coast: "#5E8F7D", water: "#1F4A58", shadow: "#000000", town: "#C7D8CF", halo: "#1B2F2B", river: "#2A5D6C" };
const GRATICULE = [-7, -6, -5, -4, -3, -2, -1] as const, PARALLELS = [55, 56, 57, 58, 59, 60] as const;

type Colours = typeof LIGHT;
// The still part of the map. It only changes with the colours and zoom, never with a tap.
function Layers({ c, k, showRank, picked, hot, onArea }: { c: Colours; k: number; showRank: number; picked: string | null; hot: Record<string, number>; onArea: (region: string) => void }) {
  const [seaX, seaY] = projectXY(-1.1, 58.3), [atlX, atlY] = projectXY(-7.1, 56.15);
  return (
    <G>
      <Path d={`M0 0H${MAP_WIDTH}V${MAP_HEIGHT}H0Z`} fill="url(#sea)" />
      {GRATICULE.map(lon => { const [x] = projectXY(lon, 55); return <Path key={lon} d={`M${x} 0V${MAP_HEIGHT}`} stroke={c.grid} strokeOpacity={0.35} strokeWidth={0.6 * k} />; })}
      {PARALLELS.map(lat => { const [, y] = projectXY(-4, lat); return <Path key={lat} d={`M0 ${y}H${MAP_WIDTH}`} stroke={c.grid} strokeOpacity={0.35} strokeWidth={0.6 * k} />; })}
      <SvgText x={seaX} y={seaY} fontSize={9.5 * k} fontStyle="italic" letterSpacing={2.4 * k} textAnchor="middle" fill={c.seaText} transform={`rotate(90 ${seaX} ${seaY})`}>NORTH SEA</SvgText>
      <SvgText x={atlX} y={atlY} fontSize={9.5 * k} fontStyle="italic" letterSpacing={2.4 * k} textAnchor="middle" fill={c.seaText}>ATLANTIC OCEAN</SvgText>
      <G transform={`translate(${1.6 * k} ${2.2 * k})`}><Path d={LAND_BASE} fill={c.shadow} fillOpacity={0.18} /></G>
      <Path d={LAND_BASE} fill={c.land} />
      {COUNCIL_AREAS.map(a => {
        const share = hot[a.region] ?? 0, on = a.region === picked;
        // A busier area is a little greener, the picked one clearly lit; tapping it picks the area.
        return share > 0 ? <Path key={a.id} d={a.d} fill="#2F7D5B" fillOpacity={on ? 0.5 : 0.1 + 0.28 * share} stroke="none" onPress={() => onArea(a.region)} /> : null;
      })}
      <Path d={COUNCIL_BORDERS} fill="none" stroke={c.border} strokeWidth={0.8 * k} strokeLinejoin="round" strokeDasharray={`${3 * k} ${2 * k}`} />
      <Path d={RIVERS} fill="none" stroke={c.river} strokeWidth={0.9 * k} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={LOCHS} fill={c.water} stroke={c.river} strokeWidth={0.5 * k} />
      <Path d={LAND_BASE} fill="none" stroke={c.coast} strokeWidth={1.1 * k} strokeLinejoin="round" />
      {TOWNS.filter(t => t.rank <= showRank).map(t => { const [x, y] = projectXY(t.lon, t.lat); return <Circle key={t.name} cx={x} cy={y} r={(t.rank === 1 ? 2.4 : 1.8) * k} fill={c.town} stroke={c.halo} strokeWidth={0.8 * k} />; })}
    </G>
  );
}

export function ScotlandMap({ palette: p, regions, points = [] }: { palette: Palette; regions: { region: string; count: number }[]; points?: PropertyPoint[] }) {
  const reduced = useReducedMotion(), c = p.isDark ? DARK : LIGHT;
  const [picked, setPicked] = useState<string | null>(null);
  const [width, setWidth] = useState(300);
  const [tween, setView] = useState<MapView>(FULL_VIEW);
  const [dot, setDot] = useState<string | null>(null);
  const placed = useMemo(() => points.map(pt => ({ pt, xy: projectXY(pt.lon, pt.lat) })), [points]);
  const target = useMemo(() => viewFor(picked, placed.filter(d => d.pt.region === picked).map(d => d.xy)), [picked, placed]);
  const view = reduced ? target : tween; // with reduced motion the map jumps straight there
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  // Slide the map to its new view (straight there when motion is reduced).
  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (reduced) return;
    const from = tween, started = Date.now(), ms = 420;
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / ms), e = 1 - Math.pow(1 - t, 3);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced]);

  const k = view.w / Math.max(1, width), bubbles = useMemo(() => mapBubbles(regions, k), [regions, k]);
  const most = Math.max(1, ...regions.map(r => r.count));
  const hot = useMemo(() => Object.fromEntries(regions.filter(r => r.count > 0).map(r => [r.region, Math.sqrt(r.count / most)])), [regions, most]);
  const chosen = bubbles.find(b => b.region === picked);
  const offMap = regions.filter(r => !bubbles.some(b => b.region === r.region)).reduce((n, r) => n + r.count, 0);
  const showRank = view.w > 450 ? 1 : view.w > 260 ? 2 : 3;
  const labelled = TOWNS.filter(t => t.rank <= showRank && (view.w <= 450 || t.rank === 1)).map(t => ({ t, xy: projectXY(t.lon, t.lat) })).filter(({ xy }) => xy[0] > view.x && xy[0] < view.x + view.w && xy[1] > view.y && xy[1] < view.y + view.h && !bubbles.some(b => Math.hypot(b.x - xy[0], b.y - xy[1]) < b.r + 14 * k));
  const busiest = [...regions].filter(r => bubbles.some(b => b.region === r.region)).sort((a, b) => b.count - a.count)[0]?.region ?? null;
  const zoomed = view.w < MAP_WIDTH - 1 || picked !== null;
  const bar = scaleBar(milesPerUnit(56.8) * k);
  const choose = (region: string) => { setDot(null); setPicked(picked === region ? null : region); };
  const close = view.w <= 420; // zoomed in far enough to read each property rather than the area totals
  const spot = placed.find(d => d.pt.id === dot)?.pt;

  return (
    <Entrance style={{ gap: 8, alignItems: "center", width: "100%", maxWidth: 320, alignSelf: "center" }}>
      <View accessible accessibilityRole="image" accessibilityLabel={"Map of properties by area: " + bubbles.map(b => `${b.region} ${b.count}`).join(", ")}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
        style={{ width: "100%", aspectRatio: MAP_WIDTH / MAP_HEIGHT, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: p.border }}>
        <Svg width="100%" height="100%" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
          <Defs>
            <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={c.seaTop} /><Stop offset="1" stopColor={c.seaBottom} /></LinearGradient>
          </Defs>
          <Layers c={c} k={k} showRank={showRank} picked={picked} hot={hot} onArea={choose} />
          {labelled.map(({ t, xy: [x, y] }) => (
            <G key={t.name} pointerEvents="none">
              <SvgText x={x + 4 * k} y={y + 3 * k} fontSize={(t.rank === 1 ? 10.5 : 9) * k} fontWeight={t.rank === 1 ? "700" : "400"} fontFamily="Montserrat_600SemiBold, Montserrat, sans-serif" fill="none" stroke={c.halo} strokeWidth={2.6 * k} strokeLinejoin="round">{t.name}</SvgText>
              <SvgText x={x + 4 * k} y={y + 3 * k} fontSize={(t.rank === 1 ? 10.5 : 9) * k} fontWeight={t.rank === 1 ? "700" : "400"} fontFamily="Montserrat_600SemiBold, Montserrat, sans-serif" fill={c.town}>{t.name}</SvgText>
            </G>
          ))}
          {placed.map(({ pt, xy: [x, y] }) => {
            const on = pt.id === dot;
            return (
              <G key={pt.id} onPress={() => setDot(on ? null : pt.id)}>
                <Circle cx={x} cy={y} r={11 * k} fill="transparent" />
                <Circle cx={x + 0.8 * k} cy={y + 1.4 * k} r={4 * k} fill={c.shadow} fillOpacity={0.35} />
                {on && <Circle cx={x} cy={y} r={9 * k} fill="none" stroke={p.waiting} strokeWidth={2 * k} />}
                <Circle cx={x} cy={y} r={(on ? 5.6 : close ? 4.4 : 3.2) * k} fill={on ? p.waiting : "#C8512F"} stroke="#FFFFFF" strokeWidth={1.3 * k} />
              </G>
            );
          })}
          {!close && bubbles.map(b => {
            const on = b.region === picked;
            return (
              <G key={b.region} onPress={() => choose(b.region)}>
                <Circle cx={b.x} cy={b.y} r={b.r} fill={on ? p.waiting : p.primary} fillOpacity={0.16} stroke={on ? p.waiting : p.primary} strokeWidth={1.3 * k} strokeOpacity={0.8} />
                <Circle cx={b.x + b.r * 0.72} cy={b.y - b.r * 0.72} r={8 * k} fill={on ? p.waiting : p.primary} stroke={p.surface} strokeWidth={1.4 * k} />
                <SvgText x={b.x + b.r * 0.72} y={b.y - b.r * 0.72 + 3.4 * k} fontSize={10 * k} fontFamily="Montserrat_700Bold, Montserrat, sans-serif" fontWeight="700" textAnchor="middle" fill={p.onPrimary}>{b.count}</SvgText>
              </G>
            );
          })}
        </Svg>
        <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: 8, gap: 2 }}>
          <View style={{ width: bar.pixels, height: 5, borderColor: c.town, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5 }} />
          <Text style={[ui.small, { color: c.town, fontSize: 10 }]}>{bar.miles} miles</Text>
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: 10, top: 8, alignItems: "center" }}>
          <Svg width={16} height={26} viewBox="0 0 16 26"><Path d="M8 1L13.5 17L8 13.5L2.5 17Z" fill={c.town} /><SvgText x={8} y={25} fontSize={8} fontWeight="700" textAnchor="middle" fill={c.town}>N</SvgText></Svg>
        </View>
        <View style={{ position: "absolute", right: 8, top: 8, gap: 6 }}>
          {[{ label: "+", hint: "Zoom in", on: () => { setDot(null); setPicked(picked ?? busiest); }, off: !busiest || picked !== null }, { label: "−", hint: "Zoom out to all of Scotland", on: () => { setDot(null); setPicked(null); }, off: !zoomed }].map(b => (
            <Pressable key={b.label} accessibilityRole="button" accessibilityLabel={b.hint} disabled={b.off} onPress={b.on}
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, opacity: b.off ? 0.45 : 1 }}>
              <Text style={{ color: p.text, fontSize: 18, lineHeight: 20, fontWeight: "700" }}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text accessibilityLiveRegion="polite" style={[ui.small, { color: chosen ? p.text : p.muted, fontWeight: chosen ? "700" : "400", textAlign: "center" }]}>
        {spot ? `${spot.name} · ${spot.district ?? spot.region}` : chosen ? `${chosen.region} · ${plural(chosen.count, "property", "properties")}` : bubbles.length ? "Tap a ring to zoom in, or a dot for a property" : "Properties appear here once their area is set"}
      </Text>
      {offMap > 0 && <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>{plural(offMap, "property", "properties")} outside Scotland or without an area</Text>}
      {placed.some(d => !d.pt.exact) && <Text style={[ui.small, { color: p.muted, fontSize: 11, textAlign: "center" }]}>Dots are placed by postcode district, so they show the area, not the exact door.</Text>}
      <Text style={[ui.small, { color: p.muted, fontSize: 10, textAlign: "center" }]}>Map data: Natural Earth</Text>
    </Entrance>
  );
}
