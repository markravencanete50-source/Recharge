import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, useColorScheme } from "react-native";
import { commitThemeChange } from './commitThemeChange';
import { MODULE_IDS, type WorkspaceRole } from "../../lib/modules";
import { designTokenCss } from "../../lib/design-tokens";
import { movePin } from "../../lib/pinned-tools";
let sessionPins: Partial<Record<WorkspaceRole, string[]>> = {};
export function usePreviewBookmarks(role: WorkspaceRole) {
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const parsed =
        Platform.OS === "web"
          ? JSON.parse(
              sessionStorage.getItem("recharge:preview:session-pins") || "{}",
            )
          : sessionPins;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, ids]) => [
          key,
          Array.isArray(ids) ? ids.filter((id) => MODULE_IDS.includes(id)) : [],
        ]),
      ) as Partial<Record<WorkspaceRole, string[]>>;
    } catch {
      return sessionPins;
    }
  });
  const [error, setError] = useState("");
  useEffect(() => {
    sessionPins = bookmarks;
    if (Platform.OS === "web")
      try {
        sessionStorage.setItem(
          "recharge:preview:session-pins",
          JSON.stringify(bookmarks),
        );
      } catch {
        queueMicrotask(() =>
          setError("Pins will remain available until this preview closes."),
        );
      }
  }, [bookmarks]);
  return {
    saved: bookmarks[role] || [],
    loaded: true,
    error,
    move: (id: string, target: number) => setBookmarks(current => ({...current, [role]: movePin(current[role] || [], id, target)})),
    toggle: (id: string) => {
      if (!MODULE_IDS.includes(id as (typeof MODULE_IDS)[number])) return;
      setBookmarks((current) => {
        const saved = current[role] || [];
        return {
          ...current,
          [role]: saved.includes(id)
            ? saved.filter((value) => value !== id)
            : [...saved, id],
        };
      });
    },
  };
}
export function useThemePreference() {
  const selected = useRef(false);
  const version = useRef(0);
  type ThemeTransition = { skipTransition: () => void; finished: Promise<void>; ready: Promise<void> };
  const transition = useRef<ThemeTransition | null>(null);
  const system = useColorScheme();
  const [choice, setChoice] = useState<"light" | "dark" | null>(null);
  const theme = choice || (system === "dark" ? "dark" : "light");
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem("recharge:theme:v2")
      .then((value) => {
        if (active && !selected.current && (value === "light" || value === "dark")) setChoice(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    let style = document.getElementById("recharge-design-tokens");
    if (!style) {
      style = document.createElement("style");
      style.id = "recharge-design-tokens";
      document.head.appendChild(style);
    }
    style.textContent = designTokenCss + '[data-pin-grip="true"]{touch-action:none;cursor:grab;user-select:none}';
    document.documentElement.dataset.rechargeTheme = theme;
  }, [theme]);
  function setTheme(value: "light" | "dark", reduced = false) {
    selected.current = true;
    const current = ++version.current;
    transition.current?.skipTransition();
    transition.current = null;
    const update = () => {
      if (current === version.current) commitThemeChange(() => setChoice(value));
    };
    if (
      Platform.OS === "web" && !reduced &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      "startViewTransition" in document
    ) {
      const next = (
        document as Document & {
          startViewTransition: (callback: () => void) => ThemeTransition;
        }
      ).startViewTransition(update);
      transition.current = next;
      void next.ready.catch(() => {});
      void next.finished.catch(() => {}).then(() => {
        if (transition.current === next) transition.current = null;
      });
    } else update();
    void AsyncStorage.setItem("recharge:theme:v2", value).catch(() => {});
  }
  useEffect(() => () => transition.current?.skipTransition(), []);
  return { theme, setTheme };
}
