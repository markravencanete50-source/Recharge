// Finding one property (or person) in a long list: every word typed must appear somewhere in its
// name, street, area or postcode, in any order, ignoring case, accents and punctuation ("pitt
// lower" finds "39 (Lower) Pitt"). Names that start with what was typed come first.
export type SearchOption = { id: string; label: string; keywords?: string };

export const normalise = (text: string) =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function searchOptions<T extends SearchOption>(options: readonly T[], query: string, limit = 12): { shown: T[]; matches: number } {
  const words = normalise(query).split(' ').filter(Boolean);
  if (!words.length) return { shown: options.slice(0, limit), matches: options.length };
  const scored: { option: T; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const name = normalise(option.label), all = name + ' ' + normalise(option.keywords ?? '');
    if (!words.every(w => all.includes(w))) return;
    const phrase = words.join(' ');
    // 0: the name starts with it, 1: a word in the name does, 2: the name has it, 3: elsewhere.
    const score = name.startsWith(phrase) ? 0 : (' ' + name).includes(' ' + words[0]) ? 1 : words.every(w => name.includes(w)) ? 2 : 3;
    scored.push({ option, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return { shown: scored.slice(0, limit).map(x => x.option), matches: scored.length };
}

// A property as a search option: found by its name, street, area or postcode.
export const propertyOption = (p: { id: string; name: string; address?: string | null; region?: string | null }): SearchOption =>
  ({ id: p.id, label: p.name, keywords: [p.address, p.region].filter(Boolean).join(' ') });

export function matchesSearch(text: string, query: string) {
  return normalise(query).split(' ').filter(Boolean).every(w => text.includes(w));
}

// The words a list row shows, so long lists can be searched without each screen saying how: the
// text inside it and the labels and plain values it was given (never styles, icons or handlers).
// React elements are recognised by shape, so this works with whichever React copy made them.
const NOT_TEXT = new Set(['p', 'palette', 'icon', 'tone', 'style', 'contentContainerStyle', 'accessibilityRole', 'accessibilityState', 'first', 'colour', 'color', 'testID', 'nativeID', 'dataSet']);
const isElement = (value: object): value is { props: Record<string, unknown> } => '$$typeof' in value && 'props' in value && typeof (value as { props: unknown }).props === 'object';
export function textOfRow(value: unknown, depth = 0): string {
  if (depth > 8 || value == null || typeof value === 'boolean' || typeof value === 'function' || typeof value === 'symbol') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(v => textOfRow(v, depth + 1)).join(' ');
  if (typeof value !== 'object') return '';
  if (isElement(value)) return Object.entries(value.props ?? {}).filter(([k]) => !NOT_TEXT.has(k)).map(([, v]) => textOfRow(v, depth + 1)).join(' ');
  // A plain record handed to a row (a stay, a person): its own text values, one level deep.
  return Object.values(value).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
}
