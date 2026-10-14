import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Notice } from "./LiveKit";
import { matchesSearch, SEARCH_LIST_ABOVE, SearchBox, searchTextOf } from "./SearchPicker";
import { ui, type Palette } from "./theme";
import { pillBox, pillInk } from "./Pills";
import { thinWidths, type ThinColumnSize } from "../../lib/thin-table";

// Rows laid out like a sheet you can tap into, and the round choice chips used with them.
// With `fit` the table is never wider than its card (E's rule, as in the thin tables): it measures its own width, the
// `fixed` columns keep theirs and the others share the rest (lib/thin-table.ts), with no sideways scroll. Without it
// the columns keep their widths and the table scrolls sideways when it is wider than its card.
export type Column<T> = Partial<ThinColumnSize> & { label: string; width: number; cell: (row: T) => ReactNode };

export function SheetTable<T>({ p, columns, rows: all, keyOf, onRow, labelOf, empty, search = true, fit = false }: { p: Palette; columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; onRow?: (row: T) => void; labelOf?: (row: T) => string; empty: string; search?: boolean; fit?: boolean }) {
  const [query, setQuery] = useState("");
  // The card's inside width (less its 1 px border on each side); until it is measured the columns flex.
  const [inner, setInner] = useState(0);
  if (!all.length) return <Notice text={empty} p={p} />;
  // Lists under a page's own search box pass search={false}, so there is never a second box.
  const searchable = search && all.length > SEARCH_LIST_ABOVE;
  // A row matches on its own values and on what its cells show.
  const rows = searchable && query.trim() ? all.filter(row => matchesSearch(searchTextOf(row as Record<string, unknown>) + " " + searchTextOf(columns.map(c => c.cell(row))), query)) : all;
  const widths = fit && inner > 0 ? thinWidths(columns.map(c => ({ ...c, fixed: !!c.fixed, grow: !!c.grow })), inner) : null;
  const box = (c: Column<T>, i: number) => widths ? { width: widths[i], flexGrow: 0, flexShrink: 0 }
    : fit ? { flexBasis: c.width, flexGrow: c.grow ? 1 : 0, flexShrink: c.fixed ? 0 : 1, minWidth: 0 }
    : { width: c.width, flexGrow: 1 };
  const sheet = (
    <View onLayout={fit ? event => { const next = Math.floor(event.nativeEvent.layout.width) - 2; if (next !== inner) setInner(next); } : undefined}
      style={{ borderWidth: 1, borderColor: p.border, borderRadius: 14, overflow: "hidden", backgroundColor: p.surface, minWidth: "100%", ...(fit ? { width: "100%" } : {}) }}>
      <View style={{ flexDirection: "row", backgroundColor: p.wash }}>
        {columns.map((c, i) => <Text key={c.label} numberOfLines={fit ? 1 : undefined} style={[ui.small, box(c, i), { paddingHorizontal: 10, paddingVertical: 8, color: p.muted, fontWeight: "700", letterSpacing: 0.3 }]}>{c.label}</Text>)}
      </View>
      {rows.map((row, r) => (
        <MotionPress key={keyOf(row)} accessibilityRole={onRow ? "button" : undefined} accessibilityLabel={labelOf?.(row)} disabled={!onRow} onPress={() => onRow?.(row)}
          style={{ flexDirection: "row", alignItems: "center", minHeight: 44, borderTopWidth: r ? 1 : 0, borderTopColor: p.border }}>
          {columns.map((c, i) => <View key={c.label} style={[box(c, i), { paddingHorizontal: 10, paddingVertical: 8, overflow: "hidden" }]}>{c.cell(row)}</View>)}
        </MotionPress>
      ))}
    </View>
  );
  const table = fit ? sheet : <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: "100%" }}>{sheet}</ScrollView>;
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

