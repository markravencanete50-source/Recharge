import { StyleSheet } from "react-native";
import type { DepartmentTone } from "../../lib/workspace-map";
import { Platform } from "react-native";
import { designTokens, departmentTokens } from "../../lib/design-tokens";
export const themes = Object.fromEntries(
  Object.entries(designTokens).map(([mode, values]) => [
    mode,
    {
      ...Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          Platform.OS === "web" ? "var(--rc-" + key + ")" : value,
        ]),
      ),
      isDark: mode === "dark",
    },
  ]),
) as Record<"light" | "dark", typeof designTokens.light & { isDark: boolean }>;
export type Palette = typeof themes.light;
// Light mode pairs a green toolbar with the bone canvas; dark mode reverses it.
export function headerPalette(p: Palette): Palette {
  return {...p,background:p.header,surface:p.headerControl,text:p.headerText,
    muted:p.headerMuted,border:p.headerBorder,primary:p.headerText,onPrimary:p.header};
}
export function departmentColor(tone: DepartmentTone, palette: Palette) {
  const values = departmentTokens[palette.isDark ? "dark" : "light"][tone];
  return {
    ink: Platform.OS === "web" ? "var(--rc-" + tone + "-ink)" : values.ink,
    wash: Platform.OS === "web" ? "var(--rc-" + tone + "-wash)" : values.wash,
    art: Platform.OS === "web" ? "var(--rc-" + tone + "-wash)" : values.wash,
  };
}
export const ui = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  page: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 112,
    gap: 24,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -1.2,
    lineHeight: 40,
    paddingRight: 3,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0,
    marginBottom: 6,
  },
  body: { fontSize: 15, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 20 },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "600",
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px var(--rc-shadow)" }
      : {}),
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  iconButton: {
    height: 48,
    width: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: {
    flexBasis: "46%",
    flexGrow: 1,
    minHeight: 120,
    borderWidth: 1,
    padding: 16,
    borderRadius: 18,
    gap: 10,
  },
  statValue: {
    fontSize: 32,
    fontWeight: "600",
    letterSpacing: -1.2,
    fontVariant: ["tabular-nums"],
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  tagText: { fontSize: 13, fontWeight: "500", lineHeight: 19 },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
    gap: 4,
    borderRadius: 999,
  },
  tabLabel: { fontSize: 11, fontWeight: "500", lineHeight: 16 },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 26,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Montserrat_400Regular",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor:
      Platform.OS === "web" ? "var(--rc-overlay)" : designTokens.light.overlay,
    justifyContent: "flex-end",
  },
  modalSheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    paddingBottom: 28,
    gap: 18,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 4,
    alignSelf: "center",
    opacity: 0.5,
  },
});
