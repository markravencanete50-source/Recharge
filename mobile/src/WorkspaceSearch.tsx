import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, Platform, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { DimensionalIcon } from "./DimensionalIcon";
import { MotionPress, Stagger, SwapIn, useReducedMotion } from "./motion";
import { depth, ui, type Palette } from "./theme";
import { FavoriteStar, FavoritesMessage, FilledStar, useFavorites } from "./Favorites";
import { PageHeading } from "./LivePages";
import { titleParts } from "../../lib/tool-finder";
import { resolveFavorites, searchWorkspace, suggestedFavorites, type SearchEntry } from "../../lib/workspace-search";

const isWeb = Platform.OS === "web";
const mac = isWeb && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
export const SEARCH_SHORTCUT = mac ? "⌘ K" : "Ctrl K";
const heading = (p: Palette) => ({ color: p.muted, fontSize: 11, fontWeight: "600" as const, letterSpacing: 1.4, textTransform: "uppercase" as const, paddingHorizontal: 10 });

function Art({ entry, size = 40, palette: p }: { entry: SearchEntry; size?: number; palette: Palette }) {
  return <View style={{ width: size, height: size, borderRadius: 13, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={entry.art} size={size - 10} color={p.primary} /></View>;
}
function Highlight({ text, query, palette: p }: { text: string; query: string; palette: Palette }) {
  // The first word typed is picked out in the name, so the eye finds why it matched.
  const word = query.trim().split(/\s+/)[0] ?? "";
  return <>{titleParts(text, word).map((part, i) => <Text key={i} style={part.match ? { color: p.primary, fontWeight: "800" } : undefined}>{part.text}</Text>)}</>;
}

// The search panel: type anything (a page, a tool, a property, a job, an invoice) and open it,
// or star it to keep it in Favorites. With nothing typed it shows Favorites and the main pages.
export function SearchPanel({ visible, onClose, palette: p, entries, onOpen }: { visible: boolean; onClose: () => void; palette: Palette; entries: SearchEntry[]; onOpen: (entry: SearchEntry) => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 768;
  // On a computer the panel sits 72 from the top and stops 24 above the bottom. Its height is set in pixels,
  // not as a percentage, so the results list always gets the room it needs and never collapses to a sliver.
  const panelMax = Math.max(320, height - 72 - 24);
  const favorites = useFavorites();
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(0);
  const input = useRef<TextInput>(null), list = useRef<ScrollView>(null);
  const result = useMemo(() => searchWorkspace(entries, query), [entries, query]);
  const saved = useMemo(() => resolveFavorites(favorites?.items ?? [], entries).flatMap(f => f.entry ? [f.entry] : []), [favorites?.items, entries]);
  const sections = query.trim()
    ? result.groups.map(g => ({ title: g.group, entries: g.entries, more: g.total - g.entries.length }))
    : [...(saved.length ? [{ title: "Your favorites", entries: saved.slice(0, 8), more: 0 }] : []), { title: "Go to", entries: entries.filter(e => e.group === "Pages" && e.key.startsWith("section:")), more: 0 }];
  const flat = sections.flatMap(s => s.entries);
  const choose = (entry: SearchEntry | undefined) => { if (!entry) return; close(); onOpen(entry); };
  function close() { setQuery(""); setSelected(0); onClose(); }
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);
  // Keyboard on the web: arrows move, Enter opens, Escape closes.
  useEffect(() => {
    if (!visible || !isWeb) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = flat.length ? (selected + (event.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length : 0;
        setSelected(next);
        document.querySelector(`[data-search-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); choose(flat[selected]); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  });
  let index = -1;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View {...(isWeb ? { dataSet: { overlay: "blur" } } : {})} style={{ flex: 1, backgroundColor: p.overlay, alignItems: "center", paddingTop: wide ? 72 : 0 }}>
        <MotionPress accessibilityLabel="Close search" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <SwapIn swapKey={visible ? "open" : "closed"} style={{ width: "100%", maxWidth: wide ? 680 : undefined, flex: wide ? undefined : 1, alignItems: "center" }}><View accessibilityViewIsModal style={{ width: "100%", maxWidth: wide ? 680 : undefined, flex: wide ? undefined : 1, maxHeight: wide ? panelMax : undefined, backgroundColor: p.surface, borderRadius: wide ? 28 : 0, ...(wide ? depth.floating : {}), borderWidth: wide ? 1 : 0, borderColor: p.border, paddingTop: wide ? 16 : insets.top + 12, paddingHorizontal: 16, paddingBottom: wide ? 12 : insets.bottom + 8, gap: 10, overflow: "hidden", ...(isWeb ? { boxShadow: "0 40px 80px -30px rgba(10, 26, 21, 0.55)" } : { elevation: 12 }) }}>
          <View style={[ui.row, { gap: 10 }]}>
            <View {...(isWeb ? { dataSet: { bareInput: "true" } } : {})} style={[ui.row, { flex: 1, minWidth: 0, gap: 10, borderWidth: 2, borderColor: p.primary, borderRadius: 18, paddingHorizontal: 14, backgroundColor: p.background }]}>
              <Feather name="search" size={20} color={p.primary} />
              <TextInput ref={input} accessibilityLabel="Search the workspace" placeholder="Search pages, tools, properties, work…" placeholderTextColor={p.muted} value={query}
                onChangeText={value => { setQuery(value); setSelected(0); }} autoCorrect={false} autoCapitalize="none" returnKeyType="go" onSubmitEditing={isWeb ? undefined : () => choose(flat[selected])}
                style={{ flex: 1, minWidth: 0, minHeight: 52, fontSize: 16, color: p.text, fontFamily: "Montserrat_400Regular", ...(isWeb ? { outlineStyle: "none" } as object : {}) }} />
              {!!query && <MotionPress accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setQuery(""); input.current?.focus(); }} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><Feather name="x-circle" size={18} color={p.muted} /></MotionPress>}
            </View>
            <MotionPress accessibilityRole="button" onPress={close} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 6 }}><Text style={{ color: p.primary, fontWeight: "700", fontSize: 14 }}>{wide ? "Esc" : "Cancel"}</Text></MotionPress>
          </View>
          <FavoritesMessage palette={p} />
          <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted, paddingHorizontal: 4 }]}>
            {query.trim() ? (result.total ? `${result.total} ${result.total === 1 ? "match" : "matches"} · tap the star to save one to Favorites` : "Nothing matches. Try one word, such as a street, a tool or a guest's job.") : "Tip: search by property name, street, postcode, job title or tool."}
          </Text>
          <ScrollView ref={list} keyboardShouldPersistTaps="handled" style={wide ? { flexGrow: 0, flexShrink: 1, flexBasis: "auto" } : undefined} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            {sections.map(section => (
              <View key={section.title} style={{ gap: 2 }}>
                <Text style={heading(p)}>{section.title}</Text>
                {section.entries.map(entry => {
                  const at = ++index, active = at === selected;
                  return (
                    <View key={entry.key} {...(isWeb ? { dataSet: { searchRow: String(at) } } : {})} style={[ui.row, { gap: 4, borderRadius: 16, backgroundColor: active && isWeb ? p.wash : "transparent" }]}>
                      <MotionPress accessibilityRole="button" accessibilityLabel={`Open ${entry.label}. ${entry.detail}`} onPress={() => choose(entry)} onHoverIn={() => setSelected(at)}
                        style={[ui.row, { flex: 1, minWidth: 0, gap: 12, minHeight: 56, paddingHorizontal: 8, paddingVertical: 6 }]}>
                        <Art entry={entry} palette={p} />
                        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                          <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}><Highlight text={entry.label} query={query} palette={p} /></Text>
                          <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{entry.detail}</Text>
                        </View>
                        {active && isWeb && <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}><Text style={{ fontSize: 11, fontWeight: "600", color: p.muted }}>Enter</Text></View>}
                      </MotionPress>
                      {entry.key !== "section:favorites" && <FavoriteStar entryKey={entry.key} label={entry.label} palette={p} />}
                    </View>
                  );
                })}
                {section.more > 0 && <Text style={[ui.small, { color: p.muted, paddingHorizontal: 10, paddingTop: 2 }]}>{section.more} more {section.title.toLowerCase()}. Add another word to narrow it down.</Text>}
              </View>
            ))}
          </ScrollView>
          {wide && isWeb && <View style={[ui.row, { gap: 14, flexWrap: "wrap", paddingTop: 2, paddingHorizontal: 4 }]}>{[["↑ ↓", "move"], ["Enter", "open"], ["Esc", "close"], [SEARCH_SHORTCUT, "search from anywhere"]].map(([key, label]) => <View key={key} style={[ui.row, { gap: 6 }]}><View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}><Text style={{ fontSize: 11, fontWeight: "600", color: p.text }}>{key}</Text></View><Text style={{ fontSize: 12, color: p.muted }}>{label}</Text></View>)}</View>}
        </View></SwapIn>
      </View>
    </Modal>
  );
}

// The search field in the desktop header.
export function HeaderSearch({ palette: p, onOpen }: { palette: Palette; onOpen: () => void }) {
  return (
    <MotionPress accessibilityRole="search" accessibilityLabel={`Search the workspace, shortcut ${SEARCH_SHORTCUT}`} onPress={onOpen}
      style={[ui.row, { flex: 1, maxWidth: 440, minWidth: 200, gap: 10, minHeight: 46, paddingHorizontal: 14, borderRadius: 16, backgroundColor: p.headerControl, borderWidth: 1, borderColor: p.headerBorder }]}>
      <Feather name="search" size={17} color={p.headerMuted} />
      <Text numberOfLines={1} style={{ flex: 1, color: p.headerMuted, fontSize: 14 }}>Search pages, tools, properties, work…</Text>
      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1, borderColor: p.headerBorder }}><Text style={{ color: p.headerMuted, fontSize: 11, fontWeight: "600" }}>{SEARCH_SHORTCUT}</Text></View>
    </MotionPress>
  );
}

// Phones: a round star button in the corner, just above the Help button, that opens Favorites.
// It shrinks away while the page scrolls, like Help, so it never covers what is being read.
export function FavoritesShortcut({ palette: p, onOpen, tucked, lifted, count }: { palette: Palette; onOpen: () => void; tucked: boolean; lifted: boolean; count: number }) {
  const reduced = useReducedMotion();
  const [away] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const to = tucked ? 1 : 0;
    if (reduced) { away.setValue(to); return; }
    const a = Animated.spring(away, { toValue: to, speed: 18, bounciness: tucked ? 0 : 6, useNativeDriver: !isWeb });
    a.start();
    return () => a.stop();
  }, [tucked, reduced, away]);
  return (
    <Animated.View pointerEvents={tucked ? "none" : "box-none"} style={{ position: "absolute", right: 16, bottom: lifted ? 172 : 118, zIndex: 20, opacity: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }] }}>
      <MotionPress accessibilityRole="button" accessibilityLabel={count ? `Open Favorites, ${count} saved` : "Open Favorites"} onPress={onOpen}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.primary, borderWidth: 1, borderColor: p.headerBorder, ...(isWeb ? { boxShadow: "0 12px 30px -12px rgba(8, 22, 18, 0.55)" } : { elevation: 6 }) }}>
        <FilledStar size={20} color={p.onPrimary} />
      </MotionPress>
    </Animated.View>
  );
}

// The Favorites page: everything saved, in the person's order, to open, reorder or remove.
export function FavoritesPage({ palette: p, desktop, entries, onOpen, onSearch }: { palette: Palette; desktop: boolean; entries: SearchEntry[]; onOpen: (entry: SearchEntry) => void; onSearch: () => void }) {
  const favorites = useFavorites();
  const { width } = useWindowDimensions();
  if (!favorites) return null;
  const list = resolveFavorites(favorites.items, entries);
  const suggestions = suggestedFavorites(entries, favorites.items);
  const columns = desktop ? 4 : width >= 600 ? 3 : 2;
  const rows = Array.from({ length: Math.ceil(list.length / columns) }, (_, r) => list.slice(r * columns, r * columns + columns));
  const searchButton = (
    <MotionPress accessibilityRole="button" onPress={onSearch} style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: p.primary }]}>
      <Feather name="search" size={16} color={p.onPrimary} /><Text style={{ color: p.onPrimary, fontSize: 14, fontWeight: "700" }}>Search to add</Text>
    </MotionPress>
  );
  return (
    <>
      <PageHeading palette={p} title="Favorites" subtitle="The places you use most, saved by you. They follow you on every device." action={searchButton} />
      <FavoritesMessage palette={p} />
      {!favorites.loaded ? <Text style={[ui.small, { color: p.muted }]}>Loading your favorites…</Text> : !list.length ? (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 30, gap: 10 }]}>
          <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><FilledStar size={30} color={p.primary} /></View>
          <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>Nothing saved yet</Text>
          <Text style={[ui.body, { color: p.muted, textAlign: "center", maxWidth: 460 }]}>Search for anything and tap its star: a tool, a page, a property or a job. It is kept here: in the left panel on a computer, and behind the star button above Help on your phone.</Text>
        </View>
      ) : rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 10 }}>
          {row.map(({ item, entry }, i) => {
            const at = r * columns + i;
            return (
              <Stagger key={item.key} index={at} style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flex: 1, borderRadius: 22, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, opacity: entry ? 1 : 0.75 }}>
                  <MotionPress accessibilityRole="button" accessibilityLabel={entry ? `Open ${entry.label}. ${entry.detail}` : `${item.label} is no longer available`} disabled={!entry} onPress={() => entry && onOpen(entry)} style={{ padding: 14, gap: 10, minHeight: 128 }}>
                    <View style={ui.between}>
                      {entry ? <Art entry={entry} size={46} palette={p} /> : <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: p.cautionWash, alignItems: "center", justifyContent: "center" }}><Feather name="slash" size={18} color={p.waiting} /></View>}
                      <FavoriteStar entryKey={item.key} label={item.label} palette={p} size={36} />
                    </View>
                    <View style={{ gap: 2 }}>
                      <Text numberOfLines={2} style={{ color: p.text, fontSize: 14, lineHeight: 19, fontWeight: "700" }}>{entry?.label ?? item.label}</Text>
                      <Text numberOfLines={2} style={{ color: p.muted, fontSize: 12, lineHeight: 16 }}>{entry ? entry.detail : "No longer available: finished, or outside your access now. Tap the star to remove it."}</Text>
                    </View>
                  </MotionPress>
                  {list.length > 1 && <View style={[ui.between, { borderTopWidth: 1, borderColor: p.border, paddingHorizontal: 4 }]}>
                    <MotionPress accessibilityRole="button" accessibilityLabel={`Move ${item.label} earlier`} disabled={at === 0} onPress={() => favorites.move(item.key, at - 1)} style={{ width: 44, height: 40, alignItems: "center", justifyContent: "center" }}><Feather name="chevron-left" size={18} color={at === 0 ? p.border : p.primary} /></MotionPress>
                    <Text style={{ color: p.muted, fontSize: 11 }}>{at + 1}</Text>
                    <MotionPress accessibilityRole="button" accessibilityLabel={`Move ${item.label} later`} disabled={at === list.length - 1} onPress={() => favorites.move(item.key, at + 1)} style={{ width: 44, height: 40, alignItems: "center", justifyContent: "center" }}><Feather name="chevron-right" size={18} color={at === list.length - 1 ? p.border : p.primary} /></MotionPress>
                  </View>}
                </View>
              </Stagger>
            );
          })}
          {Array.from({ length: columns - row.length }, (_, i) => <View key={"gap" + i} style={{ flex: 1 }} />)}
        </View>
      ))}
      {!!suggestions.length && favorites.loaded && <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Suggested for your role</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {suggestions.map(entry => (
            <MotionPress key={entry.key} accessibilityRole="button" accessibilityLabel={`Save ${entry.label} to Favorites`} onPress={() => favorites.toggle({ key: entry.key, label: entry.label })}
              style={[ui.row, { gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 14, borderRadius: 999, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={entry.art} size={22} color={p.primary} /></View>
              <Text style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>{entry.label}</Text>
              <Feather name="plus" size={15} color={p.primary} />
            </MotionPress>
          ))}
        </View>
      </View>}
    </>
  );
}
