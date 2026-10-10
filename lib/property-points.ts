import { POSTCODE_DISTRICTS } from './postcode-districts';
import { findPostcode } from './postcode-lookup';
import { normaliseRegion } from './regions';
import { BOUNDS } from './scotland-projection';

// Where each property sits on the portfolio map. A property whose exact position is saved uses it.
// Otherwise it goes where its postcode is, when the postcode's position is known (postcodes.io, which is
// sent the postcode only, never the address), which shows the street but not the door. Failing that it is
// placed inside its postcode district, from a table bundled with the app.
export type PointPrecision = 'exact' | 'postcode' | 'district';
export type PropertyPoint = { id: string; name: string; region: string; district: string | null; lat: number; lon: number; exact: boolean; precision: PointPrecision };
type Mappable = { id: string; name: string; region: string; status: string; address?: string; latitude?: number | null; longitude?: number | null };

// "12 Leith Walk, Edinburgh, EH6 5AB" gives "EH6".
export const postcodeDistrict = (address: string): string | null => /\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/i.exec(address)?.[1].toUpperCase() ?? null;
const onMap = (lat: number, lon: number) => lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax;

// Several properties at one place fan out from it rather than stacking: `step` degrees apart (about 400m for a district, 40m for a postcode).
function fanOut(seen: Map<string, number>, key: string, centre: readonly [number, number], step: number): [number, number] {
  const n = seen.get(key) ?? 0; seen.set(key, n + 1);
  const radius = n === 0 ? 0 : step * Math.sqrt(n), angle = n * 2.399963;
  return [centre[0] + radius * Math.sin(angle), centre[1] + (radius * Math.cos(angle)) / Math.cos((centre[0] * Math.PI) / 180)];
}

export function propertyPoints(properties: Mappable[], postcodes: Record<string, readonly [number, number]> = {}): PropertyPoint[] {
  const seen = new Map<string, number>(), out: PropertyPoint[] = [];
  for (const p of [...properties].filter(x => x.status !== 'archived').sort((a, b) => a.id.localeCompare(b.id))) {
    const region = normaliseRegion(p.region, p.address ?? '') || 'Region not set', district = postcodeDistrict(p.address ?? '');
    const base = { id: p.id, name: p.name, region, district };
    if (typeof p.latitude === 'number' && typeof p.longitude === 'number' && onMap(p.latitude, p.longitude)) { out.push({ ...base, lat: p.latitude, lon: p.longitude, exact: true, precision: 'exact' }); continue; }
    const postcode = findPostcode(p.address ?? ''), spot = postcode ? postcodes[postcode] : undefined;
    if (postcode && spot && onMap(spot[0], spot[1])) {
      // Keyed by the position, so postcodes that share one (a block of flats) fan out too.
      const [lat, lon] = fanOut(seen, `spot:${spot[0]},${spot[1]}`, spot, 0.00035);
      out.push({ ...base, lat, lon, exact: false, precision: 'postcode' }); continue;
    }
    const centre = district ? POSTCODE_DISTRICTS[district] : undefined;
    if (!district || !centre) continue;
    const [lat, lon] = fanOut(seen, 'district:' + district, centre, 0.0035);
    out.push({ ...base, lat, lon, exact: false, precision: 'district' });
  }
  return out;
}
