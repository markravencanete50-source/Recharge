import { matchesSearch, normalise } from './search-options';

// How a choice in a form is drawn (the "fewer buttons" rule): a few options stay as compact radio
// choices, more become one closed dropdown, and a long list gets a search box at the top of it.
export const RADIO_MAX = 5;
export const PLAIN_DROPDOWN_MAX = 10;
export type ChoiceControl = "radio" | "dropdown" | "search";
export function choiceControl(optionCount: number): ChoiceControl {
  if (optionCount <= RADIO_MAX) return "radio";
  return optionCount <= PLAIN_DROPDOWN_MAX ? "dropdown" : "search";
}
// The options a dropdown's search box keeps: every word typed appears in the label (lib/search-options.ts).
export function filterChoices<T extends { label: string }>(options: readonly T[], query: string): T[] {
  return query.trim() ? options.filter(o => matchesSearch(normalise(o.label), query)) : [...options];
}
