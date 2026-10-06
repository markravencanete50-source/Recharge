import type { FinderEntry } from './tool-finder';

/** Keep user order while discarding keys outside the supplied, permitted catalog. */
export function orderedPins<T>(entries: FinderEntry<T>[], saved: readonly string[]) {
  const catalog = new Map(entries.map(entry => [entry.key, entry]));
  return [...new Set(saved)].flatMap(key => catalog.has(key) ? [catalog.get(key)!] : []);
}
export function movePin(saved: readonly string[], key: string, target: number) {
  const next = [...new Set(saved)];
  const from = next.indexOf(key);
  if (from < 0 || !Number.isFinite(target)) return next;
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.round(target))), 0, key);
  return next;
}
