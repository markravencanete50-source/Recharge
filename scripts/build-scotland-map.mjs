// Builds lib/scotland-geo.ts: the real shape of Scotland for the portfolio map, from Natural Earth
// (public domain, naturalearthdata.com): the coastline, the 32 council areas, lochs, rivers and
// the main towns. Run it only when the map needs redrawing; the result is committed.
//
//   mkdir /tmp/ne && cd /tmp/ne && npm init -y && npm i shapefile topojson-server topojson-simplify topojson-client
//   for f in 10m_cultural/ne_10m_admin_1_states_provinces 10m_physical/ne_10m_land 10m_physical/ne_10m_lakes \
//     10m_physical/ne_10m_rivers_lake_centerlines; do
//     curl -O https://naturalearth.s3.amazonaws.com/$f.zip; done; unzip each, then
//   node /path/to/scripts/build-scotland-map.mjs /tmp/ne /path/to/lib/scotland-geo.ts
import fs from 'node:fs/promises';
import * as shapefile from 'shapefile';
import { topology } from 'topojson-server';
import { presimplify, simplify, planarTriangleArea } from 'topojson-simplify';
import { feature, mesh } from 'topojson-client';
import { BOUNDS, WIDTH, HEIGHT, projectXY, unprojectXY } from '../lib/scotland-projection.ts';

const [dir = '.', out = 'lib/scotland-geo.ts'] = process.argv.slice(2);
const read = async name => { const features = [], source = await shapefile.open(`${dir}/${name}/${name}.shp`); for (;;) { const r = await source.read(); if (r.done) break; features.push(r.value); } return features; };
const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\0/g, '').trim() : v]));

// Council area -> the area Recharge groups it into (lib/regions.ts).
const REGION = {
  EDH: 'Edinburgh', GLG: 'Glasgow', ABE: 'Aberdeen', DND: 'Dundee', HLD: 'Inverness and Highlands', FIF: 'Fife', PKN: 'Perth and Kinross',
  STG: 'Stirling and Falkirk', FAL: 'Stirling and Falkirk', CLK: 'Stirling and Falkirk', ELN: 'East Lothian', MLN: 'Midlothian', WLN: 'West Lothian', SCB: 'Scottish Borders',
  SAY: 'Ayrshire', EAY: 'Ayrshire', NAY: 'Ayrshire', DGY: 'Dumfries and Galloway', AGB: 'Argyll and Bute', ABD: 'Aberdeenshire and Moray', MRY: 'Aberdeenshire and Moray',
  ANS: 'Angus', NLK: 'Lanarkshire', SLK: 'Lanarkshire', RFW: 'Renfrewshire and Inverclyde', IVC: 'Renfrewshire and Inverclyde', ERW: 'Renfrewshire and Inverclyde',
  WDU: 'Dunbartonshire', EDU: 'Dunbartonshire', ELS: 'Scottish islands', ORK: 'Scottish islands', ZET: 'Scottish islands',
};
const inBounds = (lon, lat, pad = 0) => lon >= BOUNDS.lonMin - pad && lon <= BOUNDS.lonMax + pad && lat >= BOUNDS.latMin - pad && lat <= BOUNDS.latMax + pad;
const project = ([lon, lat]) => projectXY(lon, lat);
const r1 = v => Math.round(v * 10) / 10;

// Sutherland-Hodgman against the map rectangle (a little larger, so edges never show).
function clipRing(ring, pad = 6) {
  const box = { x0: -pad, y0: -pad, x1: WIDTH + pad, y1: HEIGHT + pad };
  const edges = [
    [p => p[0] >= box.x0, (a, b) => [box.x0, a[1] + (b[1] - a[1]) * (box.x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= box.x1, (a, b) => [box.x1, a[1] + (b[1] - a[1]) * (box.x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= box.y0, (a, b) => [a[0] + (b[0] - a[0]) * (box.y0 - a[1]) / (b[1] - a[1]), box.y0]],
    [p => p[1] <= box.y1, (a, b) => [a[0] + (b[0] - a[0]) * (box.y1 - a[1]) / (b[1] - a[1]), box.y1]],
  ];
  let points = ring;
  for (const [inside, cut] of edges) {
    const next = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    points = next;
    if (!points.length) break;
  }
  return points;
}
// Douglas-Peucker on a projected ring. A closed ring is split in two at its farthest point first,
// because the algorithm needs two different ends.
function thinRing(points, tolerance) {
  const ring = points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1] ? points.slice(0, -1) : points;
  if (ring.length < 6) return ring;
  let far = 1, best = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > best) { best = d; far = i; } }
  const first = thin(ring.slice(0, far + 1), tolerance), second = thin([...ring.slice(far), ring[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}
// Douglas-Peucker on an open line.
function thin(points, tolerance) {
  if (points.length < 5) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let worst = 0, at = -1;
    const [ax, ay] = points[s], [bx, by] = points[e], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance && at > 0) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return points.filter((_, i) => keep[i]);
}
const area = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
// Compact path: an absolute start, then relative steps in tenths.
function ringPath(points, close = true) {
  if (points.length < 2) return '';
  let px = Math.round(points[0][0] * 10), py = Math.round(points[0][1] * 10), d = `M${px / 10} ${py / 10}`, steps = [];
  for (let i = 1; i < points.length; i++) { const x = Math.round(points[i][0] * 10), y = Math.round(points[i][1] * 10); if (x !== px || y !== py) steps.push(`${(x - px) / 10} ${(y - py) / 10}`); px = x; py = y; }
  return d + (steps.length ? 'l' + steps.join(' ') : '') + (close ? 'z' : '');
}
const rings = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

// 1. Neighbouring land (England, Northern Ireland, Isle of Man) and the whole coastline.
const land = await read('ne_10m_land');
let landPath = '';
for (const f of land) for (const poly of rings(f.geometry)) {
  const outer = poly[0];
  if (!outer.some(([lon, lat]) => inBounds(lon, lat, 1.2))) continue;
  const clipped = clipRing(outer.map(project));
  if (clipped.length < 3 || area(clipped) < 1.6) continue;
  landPath += ringPath(thinRing(clipped, 0.28));
  for (const hole of poly.slice(1)) { const h = clipRing(hole.map(project)); if (h.length > 3 && area(h) > 6) landPath += ringPath(thinRing(h, 0.28)); }
}

// 2. Council areas: shared borders drawn once.
const admin = (await read('ne_10m_admin_1_states_provinces')).filter(f => f.properties.adm0_a3 === 'GBR').map(f => ({ ...f, properties: clean(f.properties) }));
const scottish = admin.filter(f => REGION[f.properties.iso_3166_2.replace('GB-', '')]);
if (scottish.length !== Object.keys(REGION).length) throw new Error(`Expected ${Object.keys(REGION).length} council areas, found ${scottish.length}: ${scottish.map(f => f.properties.iso_3166_2)}`);
const projectedGeometry = g => ({ type: g.type, coordinates: g.type === 'Polygon' ? g.coordinates.map(r => r.map(project)) : g.coordinates.map(p => p.map(r => r.map(project))) });
const objects = Object.fromEntries(scottish.map(f => [f.properties.iso_3166_2.replace('GB-', ''), { type: 'Feature', properties: { name: f.properties.name }, geometry: projectedGeometry(f.geometry) }]));
let topo = topology(objects, 1e5);
topo = simplify(presimplify(topo, planarTriangleArea), 0.045);
const pathOf = geometry => geometry.type === 'Polygon' ? geometry.coordinates.map(r => ringPath(r)).join('') : geometry.coordinates.map(p => p.map(r => ringPath(r)).join('')).join('');
const areas = Object.keys(objects).sort().map(id => {
  const geometry = feature(topo, topo.objects[id]).geometry;
  // Drop specks smaller than a pixel.
  const kept = geometry.type === 'Polygon' ? geometry : { type: 'MultiPolygon', coordinates: geometry.coordinates.filter(p => area(p[0]) > 0.5) };
  return { id, name: objects[id].properties.name === 'North Ayshire' ? 'North Ayrshire' : objects[id].properties.name, region: REGION[id], d: pathOf(kept), polygons: (kept.type === 'Polygon' ? [kept.coordinates] : kept.coordinates).map(p => p[0]) };
});
const borders = mesh(topo, { type: 'GeometryCollection', geometries: Object.keys(objects).map(id => topo.objects[id]) }, (a, b) => a !== b);
const borderPath = borders.coordinates.map(line => ringPath(line, false)).join('');

// Each Recharge area: a point well inside its biggest piece of land (so a pin never sits in the sea or on
// a border) and the box that holds its land, for zooming in.
const inside = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const edgeDistance = (ring, x, y) => { let best = Infinity; for (let i = 0; i < ring.length; i++) { const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return best; };
function pole(ring) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  let box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], best = { x: ring[0][0], y: ring[0][1], d: -1 };
  for (const steps of [24, 24, 24]) {
    const w = box[2] - box[0], h = box[3] - box[1];
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const x = box[0] + (w * i) / steps, y = box[1] + (h * j) / steps;
      if (!inside(ring, x, y)) continue;
      const d = edgeDistance(ring, x, y); if (d > best.d) best = { x, y, d };
    }
    box = [best.x - w / steps, best.y - h / steps, best.x + w / steps, best.y + h / steps];
  }
  return best;
}
const regionView = {};
for (const a of areas) {
  const pieces = (a.polygons ?? []);
  (regionView[a.region] ??= []).push(...pieces);
}
const REGION_VIEW = Object.fromEntries(Object.entries(regionView).map(([region, polygons]) => {
  const biggest = polygons.reduce((m, p) => (area(p) > area(m) ? p : m), polygons[0]);
  const spot = pole(biggest), real = polygons.filter(p => area(p) > 12), pts = (real.length ? real : polygons).flat();
  const [lon, lat] = unprojectXY(spot.x, spot.y);
  return [region, { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, box: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))].map(r1) }];
}));

// 3. Lochs and rivers.
let lakePath = '';
for (const f of await read('ne_10m_lakes')) for (const poly of rings(f.geometry)) {
  const outer = poly[0]; if (!outer.every(([lon, lat]) => inBounds(lon, lat, 0.2))) continue;
  const ring = outer.map(project); if (area(ring) < 1.4) continue;
  lakePath += ringPath(thinRing(ring, 0.2));
}
let riverPath = '';
for (const f of await read('ne_10m_rivers_lake_centerlines')) {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    const pts = line.filter(([lon, lat]) => inBounds(lon, lat, 0)).map(project);
    if (pts.length > 3) riverPath += ringPath(thin(pts, 0.25), false);
  }
}

// 4. Towns: the main places people recognise (coordinates as published, to three decimals).
const towns = [
  ['Edinburgh', 55.953, -3.189], ['Glasgow', 55.864, -4.252], ['Aberdeen', 57.149, -2.094], ['Dundee', 56.462, -2.971], ['Inverness', 57.478, -4.225],
  ['Perth', 56.397, -3.437], ['Stirling', 56.116, -3.937], ['Dumfries', 55.071, -3.605], ['Ayr', 55.458, -4.629], ['Oban', 56.415, -5.471],
  ['Fort William', 56.819, -5.112], ['Stornoway', 58.209, -6.389], ['Kirkwall', 58.981, -2.96], ['Lerwick', 60.155, -1.145], ['Elgin', 57.649, -3.317],
  ['Wick', 58.439, -3.094], ['Ullapool', 57.896, -5.158], ['Kelso', 55.598, -2.434],
];
const cities = towns.map(([name, lat, lon], i) => ({ name, lat, lon, rank: i < 5 ? 1 : i < 12 ? 2 : 3 }));

const header = `// Generated by scripts/build-scotland-map.mjs from Natural Earth (public domain). Do not edit by hand.
// The real shape of Scotland, projected to a ${WIDTH} x ${HEIGHT} map (see lib/scotland-projection.ts).
`;
const body = `export const LAND_BASE = ${JSON.stringify(landPath)};
export const COUNCIL_AREAS: readonly { id: string; name: string; region: string; d: string }[] = ${JSON.stringify(areas.map(({ polygons, ...rest }) => rest))};
export const REGION_VIEW: Record<string, { lat: number; lon: number; box: [number, number, number, number] }> = ${JSON.stringify(REGION_VIEW)};
export const COUNCIL_BORDERS = ${JSON.stringify(borderPath)};
export const LOCHS = ${JSON.stringify(lakePath)};
export const RIVERS = ${JSON.stringify(riverPath)};
export const TOWNS: readonly { name: string; lat: number; lon: number; rank: 1 | 2 | 3 }[] = ${JSON.stringify(cities)};
`;
await fs.writeFile(out, header + body);
console.log(`${out}: ${(header + body).length} bytes, ${areas.length} council areas, ${cities.length} towns`);
