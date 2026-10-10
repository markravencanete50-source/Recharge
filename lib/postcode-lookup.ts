import { normaliseRegion } from './regions';

// Finding where a property is from its postcode, with postcodes.io (free, no key, UK open data:
// Ordnance Survey and ONS). Only the postcode is sent, never the rest of the address, and only once a
// full postcode has been typed. It gives the area, the ward and the map position.
export type PostcodePlace = { postcode: string; council: string; ward: string | null; country: string; region: string; lat: number; lon: number };
const API = 'https://api.postcodes.io/postcodes/';
type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// "12 Leith Walk, Edinburgh EH6 5AB" gives "EH6 5AB".
export function findPostcode(text: string): string | null {
  const m = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(text);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}
// The start of a postcode at the end of what is being typed ("…Edinburgh EH6 5"), to suggest the rest.
export function partialPostcode(text: string): string | null {
  if (findPostcode(text)) return null;
  const m = /\b([A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]?)?)\s*$/i.exec(text.trim());
  return m ? m[1].toUpperCase() : null;
}
// The address with the postcode being typed at its end replaced by the one picked: "…Leith EH6 5" and "EH6 5AB".
export function completePostcode(text: string, postcode: string): string {
  const trimmed = text.trimEnd(), partial = partialPostcode(trimmed);
  return partial ? trimmed.replace(/\b([A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]?)?)\s*$/i, postcode) : `${trimmed}${trimmed ? ' ' : ''}${postcode}`;
}
// Councils whose names don't say which of Recharge's areas they are in.
const COUNCILS: Record<string, string> = { 'Na h-Eileanan Siar': 'Scottish islands', Clackmannanshire: 'Stirling and Falkirk' };
export function regionForCouncil(council: string, country: string): string {
  if (country && country !== 'Scotland') return 'Outside Scotland';
  return COUNCILS[council] ?? (normaliseRegion(council, council) || '');
}

type Result = { postcode?: unknown; admin_district?: unknown; admin_ward?: unknown; country?: unknown; latitude?: unknown; longitude?: unknown };
export async function lookupPostcode(postcode: string, fetcher: Fetcher = fetch): Promise<PostcodePlace | null> {
  const clean = findPostcode(postcode);
  if (!clean) return null;
  const res = await fetcher(API + encodeURIComponent(clean.replace(' ', '')));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('The postcode could not be checked just now. Try again in a moment.');
  const r = ((await res.json()) as { result?: Result }).result;
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  const council = typeof r.admin_district === 'string' ? r.admin_district : '', country = typeof r.country === 'string' ? r.country : '';
  return { postcode: typeof r.postcode === 'string' ? r.postcode : clean, council, ward: typeof r.admin_ward === 'string' ? r.admin_ward : null, country, region: regionForCouncil(council, country), lat: r.latitude, lon: r.longitude };
}
export async function suggestPostcodes(partial: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const q = partial.replace(/\s+/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d?[A-Z]?$/i.test(q) || q.length < 3) return [];
  const res = await fetcher(API + encodeURIComponent(q) + '/autocomplete?limit=8');
  if (!res.ok) return [];
  const list = ((await res.json()) as { result?: unknown }).result;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
}

// Where many postcodes are, from postcodes.io's bulk lookup (up to 100 a request, free). Only the postcodes are sent.
// Answers "EH6 5AB" -> [latitude, longitude] for each postcode found; one that is not found is left out.
type Poster = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
export async function postcodePositions(postcodes: string[], post: Poster = fetch): Promise<Record<string, [number, number]>> {
  const wanted = [...new Set(postcodes.map(findPostcode).filter((x): x is string => !!x))], out: Record<string, [number, number]> = {};
  for (let i = 0; i < wanted.length; i += 100) {
    const res = await post(API.slice(0, -1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postcodes: wanted.slice(i, i + 100) }) });
    if (!res.ok) throw new Error('The postcodes could not be checked just now.');
    const list = ((await res.json()) as { result?: unknown }).result;
    if (!Array.isArray(list)) continue;
    for (const item of list as { query?: unknown; result?: { latitude?: unknown; longitude?: unknown } | null }[]) {
      const code = typeof item?.query === 'string' ? findPostcode(item.query) : null, r = item?.result;
      if (code && r && typeof r.latitude === 'number' && typeof r.longitude === 'number') out[code] = [r.latitude, r.longitude];
    }
  }
  return out;
}
