// How a property reads as a listing, the way owners see it: "2-bedroom flat in Leith", and the
// quick picks the enquiry form suggests for its type, rooms, parking and garden.
export type Suggestion = { value: string; label: string; also?: Record<string, string> };
export const PROPERTY_TYPES: Suggestion[] = [
  { value: 'Studio', label: 'Studio', also: { bedrooms: '0' } }, { value: 'Flat', label: 'Flat' }, { value: 'Apartment', label: 'Apartment' },
  { value: 'Maisonette', label: 'Maisonette' }, { value: 'Terraced house', label: 'Terraced house' }, { value: 'Semi-detached house', label: 'Semi-detached' },
  { value: 'Detached house', label: 'Detached house' }, { value: 'Townhouse', label: 'Townhouse' }, { value: 'Cottage', label: 'Cottage' },
  { value: 'Bungalow', label: 'Bungalow' }, { value: 'Lodge', label: 'Lodge' },
];
const counts = (values: number[], label = (n: number) => String(n)) => values.map(n => ({ value: String(n), label: label(n) }));
export const BEDROOM_CHOICES: Suggestion[] = [{ value: '0', label: 'Studio' }, ...counts([1, 2, 3, 4, 5, 6], n => n === 6 ? '6+' : String(n))];
export const BATHROOM_CHOICES: Suggestion[] = counts([1, 2, 3, 4]);
export const WC_CHOICES: Suggestion[] = counts([0, 1, 2, 3]);
export const PARKING_CHOICES: Suggestion[] = ['Private', 'Free on street', 'Permit', 'Public car park', 'None'].map(v => ({ value: v, label: v }));
export const GARDEN_CHOICES: Suggestion[] = ['Private', 'Shared', 'Public nearby', 'None'].map(v => ({ value: v, label: v }));

// "2-bedroom flat in Leith", "Studio in Glasgow", "3-bedroom cottage".
export function listingTitle(p: { propertyType?: string | null; bedrooms?: number | null; place?: string | null }): string {
  const type = (p.propertyType ?? '').trim().toLowerCase().replace(/\s+house$/, ' house');
  const where = p.place?.trim() ? ` in ${p.place.trim()}` : '';
  if (type === 'studio' || p.bedrooms === 0) return `Studio${type && type !== 'studio' ? ' ' + type : ''}${where}`;
  const rooms = p.bedrooms ? `${p.bedrooms}-bedroom ` : '';
  const noun = type || 'property';
  const title = rooms + noun;
  return title.charAt(0).toUpperCase() + title.slice(1) + where;
}
// The town or district for a title: the part of the address before the postcode, else the area.
export function placeOf(address: string, region: string): string {
  const parts = address.split(/[,\n]/).map(s => s.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim()).filter(Boolean);
  const town = parts.length > 1 ? parts[parts.length - 1] : '';
  return town && !/^\d/.test(town) ? town : region && region !== 'Outside Scotland' ? region : '';
}
// What a quick pick also fills, for the fields this form has. With onlyIfEmpty a choice already made is kept
// (the area found from a postcode never replaces an area somebody picked).
export function fillAlso(values: Record<string, unknown>, also: Record<string, string>, onlyIfEmpty = false): Record<string, unknown> {
  const next = { ...values };
  for (const [name, value] of Object.entries(also)) if (name in values && (!onlyIfEmpty || values[name] === '' || values[name] == null)) next[name] = value;
  return next;
}
