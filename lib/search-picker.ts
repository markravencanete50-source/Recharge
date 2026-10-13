import { normalise, searchOptions, type SearchOption } from './search-options';

// What the shared property and person picker (mobile/src/SearchPicker.tsx) shows. Lee, round 5: "don't add
// property names, just make it searchable; the less buttons the less confusion."
//   * A short list (eight or fewer) shows every option as a chip, with no search box, as before.
//   * A long list shows, before anything is typed, only the search box, the fixed options ("Every property",
//     "Not sure yet") and the current choice as one selected chip. Once something is typed, the best matches
//     (up to twelve), with the current choice kept in view.
// Matching is lib/search-options.ts, unchanged.
export const SHOW_SEARCH_ABOVE = 8, SHOWN = 12;

export type PickerView<T extends SearchOption> = {
  searchable: boolean; typing: boolean; chips: T[];
  // Only while typing: how many match in all ("Showing x of y"), and whether nothing does.
  shown: number; matches: number; more: boolean; none: boolean;
};

export function pickerView<T extends SearchOption>(options: readonly T[], query: string, value: string): PickerView<T> {
  const searchable = options.length > SHOW_SEARCH_ABOVE;
  if (!searchable) return { searchable, typing: false, chips: [...options], shown: options.length, matches: options.length, more: false, none: false };
  const chosen = options.find(o => o.id === value);
  const typing = !!normalise(query);
  if (!typing) return { searchable, typing, chips: chosen ? [chosen] : [], shown: 0, matches: 0, more: false, none: false };
  const { shown, matches } = searchOptions(options, query, SHOWN);
  const chips = chosen && !shown.some(o => o.id === chosen.id) ? [chosen, ...shown] : [...shown];
  return { searchable, typing, chips, shown: shown.length, matches, more: matches > shown.length, none: !matches };
}
