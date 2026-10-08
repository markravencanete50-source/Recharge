import { SCOTTISH_REGIONS } from './regions';

// A simple drawn map of Scotland for the portfolio: the coastline traced coarsely by hand (good
// enough to recognise, not for navigation) and a circle in each area sized by how many properties
// are there. It uses the area counts, not addresses, so no mapping service is needed.
type LatLon = readonly [number, number];
const LAT_MAX = 60.95, LON_MIN = -7.6, K = 56, LON_SCALE = Math.cos((56.8 * Math.PI) / 180);
export const MAP_PAD = 14;
export const MAP_WIDTH = Math.round((-0.6 - LON_MIN) * LON_SCALE * K) + MAP_PAD * 2;
export const MAP_HEIGHT = Math.round((LAT_MAX - 54.55) * K) + MAP_PAD * 2;
export function project([lat, lon]: LatLon): [number, number] {
  return [MAP_PAD + (lon - LON_MIN) * LON_SCALE * K, MAP_PAD + (LAT_MAX - lat) * K];
}

const MAINLAND: LatLon[] = [
  [55.8, -2.03], [55.98, -2.3], [56.0, -2.53], [56.06, -2.75], [55.95, -3.0], [56.0, -3.4], [56.05, -3.7], [56.05, -3.2], [56.2, -2.8], [56.28, -2.58],
  [56.35, -2.78], [56.45, -2.85], [56.43, -3.1], [56.46, -2.95], [56.55, -2.58], [56.71, -2.45], [56.97, -2.2], [57.15, -2.07], [57.5, -1.78], [57.68, -2.0],
  [57.68, -2.5], [57.72, -3.3], [57.6, -3.7], [57.5, -4.2], [57.65, -4.0], [57.86, -3.77], [57.95, -4.0], [58.12, -3.65], [58.45, -3.08], [58.64, -3.03],
  [58.65, -3.4], [58.59, -3.52], [58.55, -4.4], [58.62, -5.0], [58.3, -5.15], [57.9, -5.4], [57.7, -5.8], [57.4, -5.7], [57.1, -5.7], [57.0, -5.85],
  [56.75, -6.2], [56.55, -5.8], [56.4, -5.5], [56.1, -5.6], [55.8, -5.6], [55.31, -5.79], [55.6, -5.45], [55.95, -5.2], [55.9, -4.85], [55.6, -4.75],
  [55.45, -4.65], [55.2, -4.85], [54.95, -5.15], [54.65, -4.95], [54.75, -4.45], [54.85, -4.1], [54.95, -3.6], [54.98, -3.05], [55.1, -2.8], [55.3, -2.4],
  [55.65, -2.2],
];
const ISLANDS: LatLon[][] = [
  [[57.7, -6.3], [57.5, -6.65], [57.15, -6.3], [57.2, -5.7], [57.45, -5.95]], // Skye
  [[58.52, -6.25], [58.2, -6.2], [57.75, -6.95], [57.85, -7.1], [58.25, -7.0]], // Lewis and Harris
  [[57.7, -7.2], [57.1, -7.4], [57.15, -7.2], [57.6, -7.05]], // the Uists
  [[56.62, -6.2], [56.3, -6.4], [56.33, -5.7], [56.55, -5.85]], // Mull
  [[55.9, -6.45], [55.6, -6.3], [55.75, -6.0], [55.95, -6.1]], // Islay
  [[56.1, -5.75], [55.85, -6.05], [55.95, -5.85]], // Jura
  [[55.7, -5.3], [55.45, -5.3], [55.45, -5.05], [55.7, -5.15]], // Arran
  [[59.3, -3.1], [58.9, -3.35], [58.8, -2.9], [59.2, -2.7]], // Orkney
  [[60.85, -0.85], [60.3, -1.1], [59.85, -1.3], [60.1, -1.45], [60.5, -1.6]], // Shetland
];
// A smooth closed outline: curves through the midpoints between traced points.
const path = (points: LatLon[]) => {
  const xy = points.map(project), n = xy.length, mid = (i: number) => xy[i].map((v, k) => (v + xy[(i + 1) % n][k]) / 2);
  const f = (v: number[]) => v.map(c => c.toFixed(1)).join(' ');
  return 'M' + f(mid(n - 1)) + xy.map((p, i) => ' Q' + f(p) + ' ' + f(mid(i))).join('') + ' Z';
};
export const LAND_PATHS = [MAINLAND, ...ISLANDS].map(path);

// Roughly the middle of each area (Outside Scotland is not on the map).
export const AREA_CENTRES: Record<string, LatLon> = {
  'Edinburgh': [55.95, -3.19], 'Glasgow': [55.86, -4.25], 'Aberdeen': [57.15, -2.1], 'Dundee': [56.46, -2.97], 'Inverness and Highlands': [57.6, -4.6],
  'Fife': [56.2, -3.1], 'Perth and Kinross': [56.6, -3.7], 'Stirling and Falkirk': [56.06, -3.95], 'East Lothian': [55.95, -2.75], 'Midlothian': [55.85, -3.1],
  'West Lothian': [55.9, -3.55], 'Scottish Borders': [55.55, -2.8], 'Ayrshire': [55.45, -4.55], 'Dumfries and Galloway': [55.07, -3.8], 'Argyll and Bute': [56.25, -5.3],
  'Aberdeenshire and Moray': [57.4, -2.8], 'Angus': [56.7, -2.9], 'Lanarkshire': [55.7, -3.85], 'Renfrewshire and Inverclyde': [55.85, -4.55], 'Dunbartonshire': [55.95, -4.45],
  'Scottish islands': [57.9, -6.6],
};

export type MapBubble = { region: string; count: number; x: number; y: number; r: number };
// One circle per area with properties, sized by count; circles that would overlap are nudged
// apart (a few rounds of gentle pushes), staying as close to their area as they can.
export function mapBubbles(regions: { region: string; count: number }[]): MapBubble[] {
  const onMap = regions.filter(r => r.count > 0 && AREA_CENTRES[r.region]);
  const most = Math.max(1, ...onMap.map(r => r.count));
  const bubbles = onMap.map(r => { const [x, y] = project(AREA_CENTRES[r.region]); return { region: r.region, count: r.count, x, y, r: 7 + 7 * Math.sqrt(r.count / most) }; });
  for (let round = 0; round < 120; round++) {
    let moved = false;
    for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i], b = bubbles[j], dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01, gap = a.r + b.r + 1.5;
      if (dist >= gap) continue;
      // The bigger circle moves less, so busy areas stay where they are and small ones step aside.
      const push = gap - dist, share = (b.r * b.r) / (a.r * a.r + b.r * b.r), ux = dist > 0.01 ? dx / dist : 1, uy = dist > 0.01 ? dy / dist : 0;
      a.x -= ux * push * share; a.y -= uy * push * share; b.x += ux * push * (1 - share); b.y += uy * push * (1 - share); moved = true;
    }
    for (const b of bubbles) { b.x = Math.min(MAP_WIDTH - b.r - 1, Math.max(b.r + 1, b.x)); b.y = Math.min(MAP_HEIGHT - b.r - 1, Math.max(b.r + 1, b.y)); }
    if (!moved) break;
  }
  return bubbles.sort((a, b) => b.r - a.r);
}
export const MAPPED_REGIONS = SCOTTISH_REGIONS.filter(r => r !== 'Outside Scotland');
