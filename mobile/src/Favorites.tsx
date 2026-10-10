import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { readTeams, writeTeams, WorkspaceApiError } from "./backend/client";
import { favoritesSchema, type FavoriteItem } from "../../lib/workspace-teams-policy";
import { MAX_FAVORITES, moveFavorite, toggleFavorite } from "../../lib/workspace-search";

// Each person's Favorites, kept in the database so the same list follows them from the desktop to
// their phone. Changes show straight away and are saved in order behind the scenes; if a save
// fails the list goes back to what was saved and says why.
export type Favorites = {
  items: FavoriteItem[]; loaded: boolean; message: string;
  has: (key: string) => boolean; toggle: (entry: { key: string; label: string }) => void; move: (key: string, to: number) => void; clearMessage: () => void;
};
export const FavoritesContext = createContext<Favorites | null>(null);
export const useFavorites = () => useContext(FavoritesContext);

export function useFavoritesStore(enabled: boolean, readOnly: string): Favorites {
  const [items, setItems] = useState<FavoriteItem[]>([]), [loaded, setLoaded] = useState(false), [message, setMessage] = useState("");
  const saved = useRef<FavoriteItem[]>([]), queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    readTeams({ section: "favorites" }).then(r => {
      if (!active) return;
      const list = favoritesSchema.safeParse(r.data);
      saved.current = list.success ? list.data : [];
      setItems(saved.current);
    }).catch(() => { if (active) setMessage("Favorites could not be loaded. They will appear after the next refresh."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [enabled]);
  const save = useCallback((next: FavoriteItem[]) => {
    if (readOnly) { setMessage(readOnly); return; }
    setItems(next); setMessage("");
    queue.current = queue.current.then(async () => {
      try { await writeTeams({ action: "saveFavorites", items: next }); saved.current = next; }
      catch (e) { setItems(saved.current); setMessage(e instanceof WorkspaceApiError ? e.message : "Favorites could not be saved. Try again."); }
    });
  }, [readOnly]);
  const has = useCallback((key: string) => items.some(i => i.key === key), [items]);
  const toggle = useCallback((entry: { key: string; label: string }) => {
    if (!items.some(i => i.key === entry.key) && items.length >= MAX_FAVORITES) { setMessage(`You can keep up to ${MAX_FAVORITES} favorites. Remove one to add another.`); return; }
    save(toggleFavorite(items, entry));
  }, [items, save]);
  const move = useCallback((key: string, to: number) => save(moveFavorite(items, key, to)), [items, save]);
  return { items, loaded, message, has, toggle, move, clearMessage: () => setMessage("") };
}

export function FilledStar({ size = 18, color }: { size?: number; color: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z" fill={color} stroke={color} strokeWidth={1.4} strokeLinejoin="round" /></Svg>;
}

// The star that saves (or removes) something from Favorites.
export function FavoriteStar({ entryKey, label, palette: p, size = 40, onDark }: { entryKey: string; label: string; palette: Palette; size?: number; onDark?: boolean }) {
  const favorites = useFavorites();
  if (!favorites) return null;
  const on = favorites.has(entryKey);
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={on ? `Remove ${label} from Favorites` : `Save ${label} to Favorites`} accessibilityState={{ selected: on }}
      onPress={() => favorites.toggle({ key: entryKey, label })} hitSlop={6}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.wash : "transparent" }}>
      {on ? <FilledStar size={18} color={p.primary} /> : <Feather name="star" size={18} color={onDark ? p.headerMuted : p.muted} />}
    </MotionPress>
  );
}

// A labelled version for sheets: "Save to Favorites" / "In your Favorites".
export function FavoriteButton({ entryKey, label, palette: p }: { entryKey: string; label: string; palette: Palette }) {
  const favorites = useFavorites();
  if (!favorites) return null;
  const on = favorites.has(entryKey);
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => favorites.toggle({ key: entryKey, label })}
      style={[ui.row, { alignSelf: "flex-start", gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
      {on ? <FilledStar size={15} color={p.primary} /> : <Feather name="star" size={15} color={p.muted} />}
      <Text style={{ color: on ? p.primary : p.text, fontSize: 12, fontWeight: "700" }}>{on ? "In your Favorites" : "Save to Favorites"}</Text>
    </MotionPress>
  );
}

// Shown wherever Favorites are used, when something could not be saved.
export function FavoritesMessage({ palette: p }: { palette: Palette }) {
  const favorites = useFavorites();
  if (!favorites?.message) return null;
  return (
    <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}>
      <Feather name="star" size={16} color={p.waiting} />
      <Text style={[ui.small, { color: p.text, flex: 1 }]}>{favorites.message}</Text>
      <MotionPress accessibilityRole="button" accessibilityLabel="Dismiss" onPress={favorites.clearMessage} style={{ minHeight: 32, minWidth: 32, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={15} color={p.muted} /></MotionPress>
    </View>
  );
}
