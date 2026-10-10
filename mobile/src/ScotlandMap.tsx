import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, PanResponder, Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Text } from "./Typography";
import { Entrance, useReducedMotion } from "./motion";
import { ui, type Palette } from "./theme";
import { COUNCIL_AREAS, COUNCIL_BORDERS, LAND_BASE, LOCHS, RIVERS, TOWNS } from "../../lib/scotland-geo";
import { MAP_HEIGHT, MAP_WIDTH, fitView, googleMapsLink, mapBubbles, panBy, projectXY, scaleBar, viewFor, wholeView, zoomAt, type MapView } from "../../lib/scotland-map";
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
      <Path d={`M-2000 -2000H${MAP_WIDTH + 2000}V${MAP_HEIGHT + 2000}H-2000Z`} fill="url(#sea)" />
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

type MapProps = {
  palette: Palette; regions: { region: string; count: number }[]; points?: PropertyPoint[];
  // Tapping "Open" on a property's card; its address for "Google Maps" (sent to Google only on that tap).
  onOpenProperty?: (id: string) => void; addressOf?: (id: string) => string | undefined;
};
const web = Platform.OS === "web";

// The map moves like any online map: drag to pan, pinch (or Ctrl + scroll, or a trackpad pinch) to
// zoom, double-click to zoom in, the + and − buttons, and full screen. Tap a ring for its area, a dot
// for the property's card.
export function ScotlandMap(props: MapProps) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <MapBody {...props} onExpand={() => setExpanded(true)} />
    {expanded && <Modal visible animationType="fade" onRequestClose={() => setExpanded(false)} supportedOrientations={["portrait", "landscape"]}>
      <View style={{ flex: 1, backgroundColor: props.palette.background, padding: 12, paddingTop: 40 }}>
        <MapBody {...props} full onClose={() => setExpanded(false)} onOpenProperty={props.onOpenProperty && (id => { setExpanded(false); props.onOpenProperty?.(id); })} />
      </View>
    </Modal>}
  </>;
}

function MapBody({ palette: p, regions, points = [], onOpenProperty, addressOf, full = false, onExpand, onClose }: MapProps & { full?: boolean; onExpand?: () => void; onClose?: () => void }) {
  const reduced = useReducedMotion(), c = p.isDark ? DARK : LIGHT;
  const [picked, setPicked] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 * (MAP_HEIGHT / MAP_WIDTH) });
  const aspect = size.h / Math.max(1, size.w);
  const [view, setViewState] = useState<MapView>(() => wholeView());
  const [dot, setDot] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const placed = useMemo(() => points.map(pt => ({ pt, xy: projectXY(pt.lon, pt.lat) })), [points]);

  // The live values the gesture handlers read (they are made once).
  const live = useRef({ view, size, aspect });
  useLayoutEffect(() => { live.current.size = size; live.current.aspect = aspect; }, [size, aspect]);
  const setView = useCallback((v: MapView) => { live.current.view = v; setViewState(v); }, []);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const stopTween = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  // Slide to a view (buttons, areas); straight there when motion is reduced. Gestures move it directly.
  const animateTo = useCallback((target: MapView) => {
    stopTween();
    if (reduced) { setView(target); return; }
    const from = live.current.view, started = Date.now(), ms = 380;
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / ms), e = 1 - Math.pow(1 - t, 3);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  }, [reduced, setView]);
  useEffect(() => () => stopTween(), []);
  // A new shape (first layout, full screen, a rotated phone) keeps the same centre and zoom.
  useEffect(() => { setView(fitView(live.current.view, aspect)); }, [aspect, setView]);

  // Dragging and pinching. A tap is left to the ring or dot under it; a drag that ends on a dot does not open it.
  const dragged = useRef(false), start = useRef({ view, dist: 0, mid: [0, 0] as [number, number], origin: [0, 0] as [number, number] });
  const box = useRef<View>(null);
  const touchInfo = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (t.length < 2) return null;
    return { dist: Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY), mid: [(t[0].pageX + t[1].pageX) / 2, (t[0].pageY + t[1].pageY) / 2] as [number, number] };
  };
  const responder = useMemo(() => {
    const begin = (e: GestureResponderEvent) => {
      stopTween(); dragged.current = true;
      const two = touchInfo(e);
      start.current = { view: live.current.view, dist: two?.dist ?? 0, mid: two?.mid ?? [0, 0], origin: start.current.origin };
      box.current?.measure((_x, _y, _w, _h, pageX, pageY) => { start.current.origin = [pageX, pageY]; });
    };
    const claim = (e: GestureResponderEvent, g: { dx: number; dy: number }) => e.nativeEvent.touches.length >= 2 || Math.abs(g.dx) + Math.abs(g.dy) > 6;
    // PanResponder calls these only on touches, never while rendering.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponder: claim, onMoveShouldSetPanResponderCapture: claim,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: begin,
      onPanResponderMove: (e, g) => {
        const { size: s, aspect: a } = live.current, two = touchInfo(e);
        if (two) {
          // A second finger arrived mid-drag: start the pinch from here.
          if (!start.current.dist) { start.current = { ...start.current, view: live.current.view, dist: two.dist, mid: two.mid }; return; }
          const [ox, oy] = start.current.origin, fx = (start.current.mid[0] - ox) / s.w, fy = (start.current.mid[1] - oy) / s.h;
          const zoomed = zoomAt(start.current.view, two.dist / start.current.dist, fx, fy, a);
          setView(panBy(zoomed, two.mid[0] - start.current.mid[0], two.mid[1] - start.current.mid[1], s.w, a));
        } else if (!start.current.dist) setView(panBy(start.current.view, g.dx, g.dy, s.w, a));
      },
      onPanResponderRelease: () => { start.current.dist = 0; setTimeout(() => { dragged.current = false; }, 60); },
      onPanResponderTerminate: () => { start.current.dist = 0; dragged.current = false; },
    });
  }, [setView]);

  // On the web: Ctrl/⌘ + scroll (and trackpad pinches) zoom about the pointer; plain scrolling keeps
  // scrolling the page, as on maps embedded in other sites. Full screen zooms with plain scrolling too.
  // Double-click zooms in.
  useEffect(() => {
    const node = box.current as unknown as HTMLElement | null;
    if (!web || !node?.addEventListener) return;
    let hideHint: ReturnType<typeof setTimeout> | undefined;
    const point = (e: MouseEvent) => { const r = node.getBoundingClientRect(); return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)] as const; };
    const wheel = (e: WheelEvent) => {
      if (!full && !e.ctrlKey && !e.metaKey) { setHint(true); clearTimeout(hideHint); hideHint = setTimeout(() => setHint(false), 1400); return; }
      e.preventDefault(); stopTween();
      const [fx, fy] = point(e);
      setView(zoomAt(live.current.view, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), fx, fy, live.current.aspect));
    };
    const dbl = (e: MouseEvent) => { e.preventDefault(); const [fx, fy] = point(e); animateTo(zoomAt(live.current.view, 2, fx, fy, live.current.aspect)); };
    node.addEventListener("wheel", wheel, { passive: false });
    node.addEventListener("dblclick", dbl);
    return () => { node.removeEventListener("wheel", wheel); node.removeEventListener("dblclick", dbl); clearTimeout(hideHint); };
  }, [full, animateTo, setView]);

  const k = view.w / Math.max(1, size.w), bubbles = useMemo(() => mapBubbles(regions, k), [regions, k]);
  const most = Math.max(1, ...regions.map(r => r.count));
  const hot = useMemo(() => Object.fromEntries(regions.filter(r => r.count > 0).map(r => [r.region, Math.sqrt(r.count / most)])), [regions, most]);
  const chosen = bubbles.find(b => b.region === picked);
  const offMap = regions.filter(r => !bubbles.some(b => b.region === r.region)).reduce((n, r) => n + r.count, 0);
  const showRank = view.w > 450 ? 1 : view.w > 260 ? 2 : 3;
  const labelled = TOWNS.filter(t => t.rank <= showRank && (view.w <= 450 || t.rank === 1)).map(t => ({ t, xy: projectXY(t.lon, t.lat) })).filter(({ xy }) => xy[0] > view.x && xy[0] < view.x + view.w && xy[1] > view.y && xy[1] < view.y + view.h);
  const whole = wholeView(aspect), zoomedIn = view.w < whole.w - 1;
  const bar = scaleBar(milesPerUnit(56.8) * k);
  const choose = (region: string) => {
    if (dragged.current) return;
    setDot(null);
    const next = picked === region ? null : region;
    setPicked(next);
    animateTo(next ? fitView(viewFor(next, placed.filter(d => d.pt.region === next).map(d => d.xy)), aspect) : whole);
  };
  const close = view.w <= 420; // zoomed in far enough to read each property rather than the area totals
  const spot = placed.find(d => d.pt.id === dot)?.pt;
  const zoomBy = (factor: number) => { setDot(null); animateTo(zoomAt(view, factor, 0.5, 0.5, aspect)); };
  const grab = web ? ({ cursor: "grab", userSelect: "none", touchAction: "none" } as object) : {};

  return (
    <Entrance style={full ? { flex: 1, gap: 8 } : { gap: 8, alignItems: "center", width: "100%", maxWidth: 420, alignSelf: "center" }}>
      <View ref={box} {...responder.panHandlers} accessible accessibilityRole="image" accessibilityLabel={"Map of properties by area: " + bubbles.map(b => `${b.region} ${b.count}`).join(", ")}
        onLayout={e => { const { width, height } = e.nativeEvent.layout; if (width > 0 && height > 0) setSize({ w: width, h: height }); }}
        style={[{ width: "100%", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: p.border }, full ? { flex: 1 } : { aspectRatio: MAP_WIDTH / MAP_HEIGHT }, grab]}>
        <Svg width="100%" height="100%" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="none">
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
              <G key={pt.id} onPress={() => { if (!dragged.current) setDot(on ? null : pt.id); }}>
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
        <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: spot ? 96 : 8, gap: 2 }}>
          <View style={{ width: bar.pixels, height: 5, borderColor: c.town, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5 }} />
          <Text style={[ui.small, { color: c.town, fontSize: 10 }]}>{bar.miles} miles</Text>
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: 10, top: 8, alignItems: "center" }}>
          <Svg width={16} height={26} viewBox="0 0 16 26"><Path d="M8 1L13.5 17L8 13.5L2.5 17Z" fill={c.town} /><SvgText x={8} y={25} fontSize={8} fontWeight="700" textAnchor="middle" fill={c.town}>N</SvgText></Svg>
        </View>
        <View style={{ position: "absolute", right: 8, top: 8, gap: 6 }}>
          {full ? <MapButton p={p} icon="x" hint="Close the full-screen map" onPress={() => onClose?.()} /> : onExpand ? <MapButton p={p} icon="maximize-2" hint="Open the map full screen" onPress={onExpand} /> : null}
          <MapButton p={p} icon="plus" hint="Zoom in" onPress={() => zoomBy(2)} off={view.w <= 16.5} />
          <MapButton p={p} icon="minus" hint="Zoom out" onPress={() => zoomBy(0.5)} off={!zoomedIn} />
          <MapButton p={p} icon="maximize" hint="Show all of Scotland" onPress={() => { setDot(null); setPicked(null); animateTo(whole); }} off={!zoomedIn && picked === null} />
        </View>
        {hint && <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "700", textAlign: "center", paddingHorizontal: 20 }}>Use Ctrl + scroll to zoom the map, or open it full screen</Text>
        </View>}
        {spot && <View style={{ position: "absolute", left: 8, right: 8, bottom: 8, gap: 8, padding: 10, borderRadius: 12, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.row, { gap: 8 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700" }}>{spot.name}</Text>
              <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{[addressOf?.(spot.id), spot.district ?? spot.region].filter(Boolean).join(" · ")}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the property card" onPress={() => setDot(null)} style={{ padding: 6 }}><Feather name="x" size={16} color={p.muted} /></Pressable>
          </View>
          <View style={[ui.row, { gap: 8 }]}>
            {onOpenProperty && <Pressable accessibilityRole="button" onPress={() => onOpenProperty(spot.id)} style={[ui.row, { flex: 1, gap: 6, minHeight: 36, justifyContent: "center", borderRadius: 10, backgroundColor: p.primary }]}>
              <Feather name="home" size={14} color={p.onPrimary} /><Text style={{ color: p.onPrimary, fontWeight: "700", fontSize: 13 }}>Open property</Text>
            </Pressable>}
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(googleMapsLink({ lat: spot.lat, lon: spot.lon, address: addressOf?.(spot.id) }))} style={[ui.row, { flex: 1, gap: 6, minHeight: 36, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }]}>
              <Feather name="navigation" size={14} color={p.primary} /><Text style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>Google Maps</Text>
            </Pressable>
          </View>
        </View>}
      </View>
      <Text accessibilityLiveRegion="polite" style={[ui.small, { color: chosen ? p.text : p.muted, fontWeight: chosen ? "700" : "400", textAlign: "center" }]}>
        {chosen ? `${chosen.region} · ${plural(chosen.count, "property", "properties")}` : bubbles.length ? (web ? "Drag to move, Ctrl + scroll or double-click to zoom. Tap a ring or a dot." : "Drag to move, pinch to zoom. Tap a ring or a dot.") : "Properties appear here once their area is set"}
      </Text>
      {!full && offMap > 0 && <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>{plural(offMap, "property", "properties")} outside Scotland or without an area</Text>}
      {!full && placed.some(d => !d.pt.exact) && <Text style={[ui.small, { color: p.muted, fontSize: 11, textAlign: "center" }]}>Dots are placed by postcode district, so they show the area, not the exact door.</Text>}
      <Text style={[ui.small, { color: p.muted, fontSize: 10, textAlign: "center" }]}>Map data: Natural Earth</Text>
    </Entrance>
  );
}

function MapButton({ p, icon, hint, onPress, off = false }: { p: Palette; icon: "plus" | "minus" | "maximize" | "maximize-2" | "x"; hint: string; onPress: () => void; off?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hint} disabled={off} onPress={onPress}
      style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, opacity: off ? 0.45 : 1 }}>
      <Feather name={icon} size={17} color={p.text} />
    </Pressable>
  );
}
