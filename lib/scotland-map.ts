import { SCOTTISH_REGIONS } from './regions';
import { COUNCIL_AREAS, LAND_BASE, REGION_VIEW } from './scotland-geo';
import { HEIGHT, WIDTH, project, projectXY } from './scotland-projection';

// The portfolio map: the real shape of Scotland (coastline, council areas, lochs, towns from Natural
// Earth) with a pin in each area, sized by how many properties are there. It uses the area counts,
// not addresses, so no mapping service is needed and nothing about a property leaves the app.
export const MAP_WIDTH = WIDTH, MAP_HEIGHT = HEIGHT;
export { project, projectXY };
export const LAND_PATHS: readonly string[] = [LAND_BASE, ...COUNCIL_AREAS.map(a => a.d)];

type LatLon = readonly [number, number];
// A point well inside each area's land, so a pin never sits in the sea or on a border.
export const AREA_CENTRES: Record<string, LatLon> = Object.fromEntries(Object.entries(REGION_VIEW).map(([region, v]) => [region, [v.lat, v.lon] as LatLon]));
export const MAPPED_REGIONS = SCOTTISH_REGIONS.filter(r => r !== 'Outside Scotland');

export type MapBubble = { region: string; count: number; x: number; y: number; r: number };
// One pin per area with properties, sized by count (between 12 and 21 screen pixels across). Pins that
// would overlap are nudged apart, the busier ones moving least, so each stays as close to its place on
// the map as it can. `unitsPerPixel` is how many map units one screen pixel covers at the current zoom.
export function mapBubbles(regions: { region: string; count: number }[], unitsPerPixel = MAP_WIDTH / 340): MapBubble[] {
  const onMap = regions.filter(r => r.count > 0 && AREA_CENTRES[r.region]);
  const most = Math.max(1, ...onMap.map(r => r.count));
  const bubbles = onMap.map(r => { const [x, y] = project(AREA_CENTRES[r.region]); return { region: r.region, count: r.count, x, y, r: (12 + 9 * Math.sqrt(r.count / most)) * unitsPerPixel }; });
  const gap = 2 * unitsPerPixel;
  for (let round = 0; round < 160; round++) {
    let moved = false;
    for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i], b = bubbles[j], dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01, need = a.r + b.r + gap;
      if (dist >= need) continue;
      const push = need - dist, share = (b.r * b.r) / (a.r * a.r + b.r * b.r), ux = dist > 0.01 ? dx / dist : 1, uy = dist > 0.01 ? dy / dist : 0;
      a.x -= ux * push * share; a.y -= uy * push * share; b.x += ux * push * (1 - share); b.y += uy * push * (1 - share); moved = true;
    }
    for (const b of bubbles) { b.x = Math.min(MAP_WIDTH - b.r - 1, Math.max(b.r + 1, b.x)); b.y = Math.min(MAP_HEIGHT - b.r - 1, Math.max(b.r + 1, b.y)); }
    if (!moved) break;
  }
  return bubbles.sort((a, b) => b.r - a.r);
}

// The part of the map to show for an area (the whole map for none): a box with the map's shape,
// wide enough to hold the area's land with some room around it.
export type MapView = { x: number; y: number; w: number; h: number };
export const FULL_VIEW: MapView = { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT };
// With the places of the properties in the area (as map points), the view fits them instead.
export function viewFor(region: string | null, points: readonly (readonly [number, number])[] = []): MapView {
  const v = region ? REGION_VIEW[region] : null;
  if (!v || region === 'Scottish islands') return FULL_VIEW;
  const ratio = MAP_HEIGHT / MAP_WIDTH, own = points.length > 0;
  const [x0, y0, x1, y1] = own ? [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] : v.box;
  const w = Math.min(MAP_WIDTH, Math.max(own ? 60 : 150, (x1 - x0) * (own ? 2.2 : 1.7), ((y1 - y0) * (own ? 2.2 : 1.7)) / ratio)), h = w * ratio;
  return { x: Math.min(MAP_WIDTH - w, Math.max(0, (x0 + x1) / 2 - w / 2)), y: Math.min(MAP_HEIGHT - h, Math.max(0, (y0 + y1) / 2 - h / 2)), w, h };
}
// The council areas that make up an area, for outlining it.
export const councilAreasOf = (region: string) => COUNCIL_AREAS.filter(a => a.region === region);
// A round distance (miles) for the scale bar that fits in about `target` screen pixels.
export function scaleBar(milesPerPixel: number, target = 90): { miles: number; pixels: number } {
  const raw = milesPerPixel * target, steps = [1, 2, 5, 10, 20, 25, 50, 100, 200];
  const miles = [...steps].reverse().find(s => s <= raw) ?? 1;
  return { miles, pixels: miles / milesPerPixel };
}
