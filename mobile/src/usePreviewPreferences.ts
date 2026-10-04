import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Animated, Platform, useColorScheme } from "react-native";
import { MODULE_IDS, type WorkspaceRole } from "../../lib/modules";
import { designTokenCss } from "../../lib/design-tokens";
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
  const [themeOpacity] = useState(() => new Animated.Value(1));
  const system = useColorScheme();
  const [choice, setChoice] = useState<"light" | "dark" | null>(null);
  const theme = choice || (system === "dark" ? "dark" : "light");
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem("recharge:theme:v2")
      .then((value) => {
        if (active && (value === "light" || value === "dark")) setChoice(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let style = document.getElementById("recharge-design-tokens");
    if (!style) {
      style = document.createElement("style");
      style.id = "recharge-design-tokens";
      document.head.appendChild(style);
    }
    style.textContent = designTokenCss;
    document.documentElement.dataset.rechargeTheme = theme;
  }, [theme]);
  function setTheme(value: "light" | "dark", reduced = false) {
    if (
      Platform.OS === "web" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      "startViewTransition" in document
    ) {
      (
        document as Document & {
          startViewTransition: (callback: () => void) => unknown;
        }
      ).startViewTransition(() => {
        document.documentElement.dataset.rechargeTheme = value;
        setChoice(value);
      });
    } else if (Platform.OS !== "web" && !reduced) {
      themeOpacity.stopAnimation();
      Animated.timing(themeOpacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setChoice(value);
        Animated.timing(themeOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }).start();
      });
    } else setChoice(value);
    void AsyncStorage.setItem("recharge:theme:v2", value).catch(() => {});
  }
  return { theme, setTheme, themeOpacity };
}
