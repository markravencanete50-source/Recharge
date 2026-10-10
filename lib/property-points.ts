import { POSTCODE_DISTRICTS } from './postcode-districts';
import { normaliseRegion } from './regions';
import { BOUNDS } from './scotland-projection';

// Where each property sits on the portfolio map. A property whose exact position is saved uses it.
// Otherwise it is placed inside the postcode district of its address, using a table bundled with the
// app, so the address is never sent to a mapping service and the map shows the area, not the door.
export type PropertyPoint = { id: string; name: string; region: string; district: string | null; lat: number; lon: number; exact: boolean };
type Mappable = { id: string; name: string; region: string; status: string; address?: string; latitude?: number | null; longitude?: number | null };

// "12 Leith Walk, Edinburgh, EH6 5AB" gives "EH6".
export const postcodeDistrict = (address: string): string | null => /\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/i.exec(address)?.[1].toUpperCase() ?? null;
const onMap = (lat: number, lon: number) => lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax;

export function propertyPoints(properties: Mappable[]): PropertyPoint[] {
  const seen = new Map<string, number>(), out: PropertyPoint[] = [];
  for (const p of [...properties].filter(x => x.status !== 'archived').sort((a, b) => a.id.localeCompare(b.id))) {
    const region = normaliseRegion(p.region, p.address ?? '') || 'Region not set', district = postcodeDistrict(p.address ?? '');
    if (typeof p.latitude === 'number' && typeof p.longitude === 'number' && onMap(p.latitude, p.longitude)) { out.push({ id: p.id, name: p.name, region, district, lat: p.latitude, lon: p.longitude, exact: true }); continue; }
    const centre = district ? POSTCODE_DISTRICTS[district] : undefined;
    if (!district || !centre) continue;
    // Several properties in one district fan out from its middle (about 400m apart) rather than stacking.
    const n = seen.get(district) ?? 0; seen.set(district, n + 1);
    const radius = n === 0 ? 0 : 0.0035 * Math.sqrt(n), angle = n * 2.399963;
    out.push({ id: p.id, name: p.name, region, district, lat: centre[0] + radius * Math.sin(angle), lon: centre[1] + (radius * Math.cos(angle)) / Math.cos((centre[0] * Math.PI) / 180), exact: false });
  }
  return out;
}
