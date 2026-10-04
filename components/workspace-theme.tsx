"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { designTokenCss } from "@/lib/design-tokens";
import { Moon, Sun } from "lucide-react";

export function WorkspaceTheme({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{designTokenCss}</style>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="recharge-theme"
      >
        {children}
      </ThemeProvider>
    </>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeMounted,
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        const apply = () => {
          document.documentElement.classList.toggle("dark", next === "dark");
          setTheme(next);
        };
        if (
          !matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.reduceMotion !== "true" &&
          "startViewTransition" in document
        ) {
          (
            document as Document & {
              startViewTransition: (callback: () => void) => unknown;
            }
          ).startViewTransition(apply);
        } else apply();
      }}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
function subscribeMounted() {
  return () => {};
}
