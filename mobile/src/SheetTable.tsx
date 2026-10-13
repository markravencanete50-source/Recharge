import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Notice } from "./LiveKit";
import { matchesSearch, SEARCH_LIST_ABOVE, SearchBox, searchTextOf } from "./SearchPicker";
import { ui, type Palette } from "./theme";
import { pillBox, pillInk } from "./Pills";

// Rows laid out like a sheet you can tap into, and the round choice chips used with them.
export type Column<T> = { label: string; width: number; cell: (row: T) => ReactNode };

export function SheetTable<T>({ p, columns, rows: all, keyOf, onRow, labelOf, empty, search = true }: { p: Palette; columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; onRow?: (row: T) => void; labelOf?: (row: T) => string; empty: string; search?: boolean }) {
  const [query, setQuery] = useState("");
  if (!all.length) return <Notice text={empty} p={p} />;
  // Lists under a page's own search box pass search={false}, so there is never a second box.
  const searchable = search && all.length > SEARCH_LIST_ABOVE;
  // A row matches on its own values and on what its cells show.
  const rows = searchable && query.trim() ? all.filter(row => matchesSearch(searchTextOf(row as Record<string, unknown>) + " " + searchTextOf(columns.map(c => c.cell(row))), query)) : all;
  const table = (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: 14, overflow: "hidden", backgroundColor: p.surface, minWidth: "100%" }}>
        <View style={{ flexDirection: "row", backgroundColor: p.wash }}>
          {columns.map(c => <Text key={c.label} style={[ui.small, { width: c.width, flexGrow: 1, paddingHorizontal: 10, paddingVertical: 8, color: p.muted, fontWeight: "700", letterSpacing: 0.3 }]}>{c.label}</Text>)}
        </View>
        {rows.map((row, i) => (
          <MotionPress key={keyOf(row)} accessibilityRole={onRow ? "button" : undefined} accessibilityLabel={labelOf?.(row)} disabled={!onRow} onPress={() => onRow?.(row)}
            style={{ flexDirection: "row", alignItems: "center", minHeight: 44, borderTopWidth: i ? 1 : 0, borderTopColor: p.border }}>
            {columns.map(c => <View key={c.label} style={{ width: c.width, flexGrow: 1, paddingHorizontal: 10, paddingVertical: 8 }}>{c.cell(row)}</View>)}
          </MotionPress>
        ))}
      </View>
    </ScrollView>
  );
  if (!searchable) return table;
  return (
    <View style={{ gap: 8 }}>
      <SearchBox p={p} value={query} onChange={setQuery} placeholder={`Search this list (${all.length})`} />
      {rows.length ? table : <Text style={[ui.small, { color: p.muted }]}>Nothing matches “{query.trim()}”.</Text>}
    </View>
  );
}

export const cellText = (p: Palette, value: string | null | undefined, strong = false) => <Text numberOfLines={2} style={[strong ? { fontWeight: "700" } : ui.small, { color: value ? p.text : p.muted, fontVariant: ["tabular-nums"] }]}>{value || "–"}</Text>;
export function Chip({ p, label, on, onPress }: { p: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress}
      style={[{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center" }, pillBox(p, on)]}>
      <Text style={{ color: pillInk(p, on), fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </MotionPress>
  );
}

