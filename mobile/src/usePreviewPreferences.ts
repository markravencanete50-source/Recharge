import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { MODULE_IDS, type WorkspaceRole } from "../../lib/modules";

// Device-local preview bookmarks only. Never persist passwords or session tokens here.
export function usePreviewBookmarks(role: WorkspaceRole) {
  const [bookmarks, setBookmarks] = useState<Partial<Record<WorkspaceRole, string[]>>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem("recharge:preview:bookmarks:v1").then(value => {
      if (!active) return;
      if (value) {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const clean: Partial<Record<WorkspaceRole, string[]>> = {};
          for (const key of ["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "client"] as const) {
            if (Array.isArray(parsed[key])) clean[key] = parsed[key].filter((id: unknown) => typeof id === "string" && MODULE_IDS.includes(id as typeof MODULE_IDS[number]));
          }
          setBookmarks(clean);
        }
      }
    }).catch(() => { if (active) setError("Saved tools could not be loaded. Changes will stay in this session."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    writes.current = writes.current.then(() => AsyncStorage.setItem("recharge:preview:bookmarks:v1", JSON.stringify(bookmarks)))
      .catch(() => { setError("These bookmarks could not be saved to this device."); });
  }, [bookmarks, loaded]);
  return { saved: bookmarks[role] || [], loaded, error, toggle: (id: string) => {
    if (!loaded) return;
    setBookmarks(current => {
      const saved = current[role] || [];
      return { ...current, [role]: saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id] };
    });
  } };
}
