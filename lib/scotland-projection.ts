// How latitude and longitude become a point on the portfolio map: an ordinary web-map (Mercator)
// projection of Scotland, drawn on a fixed-size sheet. The shape data in lib/scotland-geo.ts is
// projected with these same numbers, so a town or an area lands exactly where it is on the ground.
export const BOUNDS = { lonMin: -7.95, lonMax: -0.55, latMin: 54.5, latMax: 60.95 } as const;
const RAD = Math.PI / 180;
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
// Sheet units per radian: the map is 600 wide.
const SCALE = 600 / ((BOUNDS.lonMax - BOUNDS.lonMin) * RAD);
export const WIDTH = 600;
export const HEIGHT = Math.round(SCALE * (mercator(BOUNDS.latMax) - mercator(BOUNDS.latMin)));
export const projectXY = (lon: number, lat: number): [number, number] => [(lon - BOUNDS.lonMin) * RAD * SCALE, (mercator(BOUNDS.latMax) - mercator(lat)) * SCALE];
export const unprojectXY = (x: number, y: number): [number, number] => [BOUNDS.lonMin + x / SCALE / RAD, (2 * Math.atan(Math.exp(mercator(BOUNDS.latMax) - y / SCALE)) - Math.PI / 2) / RAD];
export const project = ([lat, lon]: readonly [number, number]): [number, number] => projectXY(lon, lat);
// How many miles one sheet unit is at a latitude (for the scale bar).
export const milesPerUnit = (lat: number) => (40075.017 * Math.cos(lat * RAD)) / (2 * Math.PI * SCALE) / 1.609344;
