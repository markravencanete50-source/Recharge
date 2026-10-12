import { useMemo, useState, type ReactNode } from "react";
import { Platform, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { matchesSearch, normalise, propertyOption, searchOptions, textOfRow, type SearchOption } from "../../lib/search-options";

// Choosing one property (or person) from a long list, on phones and on the web: a search box over
// the list, the best dozen matches as chips, and the current choice always in view. Short lists
// (eight or fewer) show every chip with no search box, as before.
const SHOW_SEARCH_ABOVE = 8, SHOWN = 12;

export function SearchBox({ p, value, onChange, placeholder }: { p: Palette; value: string; onChange: (v: string) => void; placeholder: string }) {
  // On the web the browser's own focus ring would sit as a second box inside this one. The box shows focus itself instead: a thicker
  // border in the primary colour, with the padding one pixel less so the text does not move.
  const [focused, setFocused] = useState(false);
  return (
    <View {...(Platform.OS === "web" ? { dataSet: { bareInput: "true" } } : {})} style={[ui.row, { gap: 10, paddingHorizontal: focused ? 13 : 14, minHeight: 48, borderRadius: 14, borderWidth: focused ? 2 : 1, borderColor: focused ? p.primary : p.controlBorder, backgroundColor: p.background }]}>
      <Feather name="search" size={18} color={p.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} accessibilityLabel={placeholder} autoCapitalize="none" autoCorrect={false}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ flex: 1, minWidth: 0, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14, ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : {}) }} />
      {!!value && <MotionPress accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => onChange("")} style={{ padding: 6 }}>
        <Feather name="x" size={16} color={p.muted} />
      </MotionPress>}
    </View>
  );
}

function OptionChip({ p, label, on, onPress }: { p: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: 40, maxWidth: "100%", paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
      <Text numberOfLines={1} style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </MotionPress>
  );
}

// `fixed` options (like "Every property" or "Not sure yet") always show first and are never
// filtered. With `clearable`, choosing the selected chip again clears the choice ("").
export function SearchPicker({ p, options, value, onChange, fixed = [], placeholder = "Search", nouns = "items", clearable = false, empty }: {
  p: Palette; options: readonly SearchOption[]; value: string; onChange: (id: string) => void; fixed?: readonly SearchOption[];
  placeholder?: string; nouns?: string; clearable?: boolean; empty?: string;
}) {
  const [query, setQuery] = useState("");
  const searchable = options.length > SHOW_SEARCH_ABOVE;
  const { shown, matches } = useMemo(() => searchable ? searchOptions(options, query, SHOWN) : { shown: options, matches: options.length }, [options, query, searchable]);
  // The current choice stays visible even when the search doesn't match it.
  const chosen = options.find(o => o.id === value);
  const list = chosen && !shown.some(o => o.id === chosen.id) ? [chosen, ...shown] : shown;
  const pick = (id: string) => onChange(clearable && id === value ? "" : id);
  return (
    <View style={{ gap: 8 }}>
      {searchable && <SearchBox p={p} value={query} onChange={setQuery} placeholder={placeholder} />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {fixed.map(o => <OptionChip key={"fixed:" + o.id} p={p} label={o.label} on={value === o.id} onPress={() => pick(o.id)} />)}
        {list.map(o => <OptionChip key={o.id} p={p} label={o.label} on={value === o.id} onPress={() => pick(o.id)} />)}
      </View>
      {!options.length && !!empty && <Text style={[ui.small, { color: p.muted }]}>{empty}</Text>}
      {searchable && !!query.trim() && !matches && <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{query.trim()}”. Try part of the name, the street or the postcode.</Text>}
      {searchable && matches > shown.length && <Text style={[ui.small, { color: p.muted }]}>
        Showing {shown.length} of {matches} {nouns}. Type to find the rest.
      </Text>}
    </View>
  );
}

// The property picker used across the app: search by name, street, area or postcode.
export function PropertySelect({ p, properties, value, onChange, fixed, clearable, empty = "No properties are assigned to you yet." }: {
  p: Palette; properties: readonly { id: string; name: string; address?: string | null; region?: string | null }[]; value: string; onChange: (id: string) => void;
  fixed?: readonly SearchOption[]; clearable?: boolean; empty?: string;
}) {
  const options = useMemo(() => properties.map(propertyOption), [properties]);
  return <SearchPicker p={p} options={options} value={value} onChange={onChange} fixed={fixed} clearable={clearable} empty={empty}
    placeholder="Search properties by name, street or postcode" nouns="properties" />;
}

// Long lists and tables get a search box once they pass eight rows. A row matches when every word
// typed appears in what it shows: the text and labels inside it, and the plain values it was given.
export const SEARCH_LIST_ABOVE = SHOW_SEARCH_ABOVE;
export const searchTextOf = (row: ReactNode | Record<string, unknown>) => normalise(textOfRow(row));
export { matchesSearch };

// The same for lists a screen lays out itself: `textOf` gives the words a row is found by (a
// string, or the values it shows). The box only appears past eight rows.
export function useListSearch<T>(rows: readonly T[], textOf: (row: T) => unknown) {
  const [query, setQuery] = useState("");
  const searchable = rows.length > SEARCH_LIST_ABOVE, typed = searchable ? query.trim() : "";
  const shown = typed ? rows.filter(row => matchesSearch(normalise(textOfRow(textOf(row))), typed)) : rows;
  return { query, setQuery, searchable, total: rows.length, shown, missed: !!typed && !shown.length };
}
export function ListSearchBox({ p, search, nouns }: { p: Palette; search: { query: string; setQuery: (v: string) => void; searchable: boolean; total: number; missed: boolean }; nouns: string }) {
  if (!search.searchable) return null;
  return (
    <View style={{ gap: 8 }}>
      <SearchBox p={p} value={search.query} onChange={search.setQuery} placeholder={`Search ${search.total} ${nouns}`} />
      {search.missed && <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{search.query.trim()}”.</Text>}
    </View>
  );
}
