import type { DepartmentTone } from "./workspace-map";
export type FinderEntry<T> = {
  key: string;
  name: string;
  tone: DepartmentTone;
  tool: T;
};
export function findTools<T>(
  entries: FinderEntry<T>[],
  query: string,
  saved?: string[],
) {
  const text = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      entry.name.toLocaleLowerCase().includes(text) &&
      (!saved || saved.includes(entry.key)),
  );
}
export function titleParts(title: string, query: string) {
  const term = query.trim();
  if (!term) return [{ text: title, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  while (from < title.length) {
    const at = title
      .toLocaleLowerCase()
      .indexOf(term.toLocaleLowerCase(), from);
    if (at < 0) {
      parts.push({ text: title.slice(from), match: false });
      break;
    }
    if (at > from) parts.push({ text: title.slice(from, at), match: false });
    parts.push({ text: title.slice(at, at + term.length), match: true });
    from = at + term.length;
  }
  return parts;
}
