import { useMemo, useState, type ReactNode } from "react";
import { Keyboard, Platform, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { radius, ui, type Palette } from "./theme";
import { matchesSearch, normalise, propertyOption, textOfRow, type SearchOption } from "../../lib/search-options";
import { SHOW_SEARCH_ABOVE, pickerView } from "../../lib/search-picker";

// Choosing one property (or person) from a long list, on phones and on the web. A long list is search
// only: before anything is typed it shows the search box, the fixed options and the current choice, and
// once something is typed the best dozen matches as chips (lib/search-picker.ts). Short lists (eight or
// fewer) show every chip with no search box, as before.

// The one search field in the app: every "Search …" box uses it (tests/search-fields.test.mjs). Its frame shows focus
// itself: the border turns the primary colour (3:1 or more in both themes) and thickens by a pixel, with the padding one
// pixel less so the text does not move. On the web the frame is marked bareInput, so the browser's own focus ring and the
// global input outline never draw a second box inside it. No glow, no animation. `pill` rounds it fully (Messages).
export function SearchBox({ p, value, onChange, placeholder, label, pill = false, autoFocus = false }: { p: Palette; value: string; onChange: (v: string) => void; placeholder: string; label?: string; pill?: boolean; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View {...(Platform.OS === "web" ? { dataSet: { bareInput: "true" } } : {})} style={[ui.row, { flex: pill ? 1 : undefined, minWidth: 0, gap: 10, paddingHorizontal: focused ? 13 : 14, minHeight: pill ? 42 : 48, borderRadius: pill ? radius.pill : radius.control, borderWidth: focused ? 2 : 1, borderColor: focused ? p.primary : p.controlBorder, backgroundColor: p.background }]}>
      <Feather name="search" size={pill ? 16 : 18} color={p.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} accessibilityLabel={label ?? placeholder} autoCapitalize="none" autoCorrect={false} autoFocus={autoFocus}
        returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ flex: 1, minWidth: 0, minHeight: pill ? 38 : 44, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14, ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : {}) }} />
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
  // The current choice stays visible, typed or not; other options appear only for what is typed.
  const view = useMemo(() => pickerView(options, query, value), [options, query, value]);
  const pick = (id: string) => onChange(clearable && id === value ? "" : id);
  return (
    <View style={{ gap: 8 }}>
      {view.searchable && <SearchBox p={p} value={query} onChange={setQuery} placeholder={placeholder} />}
      {(fixed.length > 0 || view.chips.length > 0) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {fixed.map(o => <OptionChip key={"fixed:" + o.id} p={p} label={o.label} on={value === o.id} onPress={() => pick(o.id)} />)}
        {view.chips.map(o => <OptionChip key={o.id} p={p} label={o.label} on={value === o.id} onPress={() => pick(o.id)} />)}
      </View>}
      {!options.length && !!empty && <Text style={[ui.small, { color: p.muted }]}>{empty}</Text>}
      {/* A long list shows no options until something is typed, so say when nothing is chosen yet. */}
      {view.searchable && !view.typing && !view.chips.length && !fixed.some(o => o.id === value) && <Text style={[ui.small, { color: p.muted }]}>Nothing chosen yet. Type to find one of the {options.length} {nouns}.</Text>}
      {view.none && <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{query.trim()}”. Try part of the name, the street or the postcode.</Text>}
      {view.more && <Text style={[ui.small, { color: p.muted }]}>
        Showing {view.shown} of {view.matches} {nouns}. Keep typing to narrow it down.
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
    placeholder="Search property, street or postcode" nouns="properties" />;
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
