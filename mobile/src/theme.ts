import { StyleSheet, type ViewStyle } from "react-native";
import type { DepartmentTone } from "../../lib/workspace-map";
import { Platform } from "react-native";
import { designTokens, departmentTokens, navHueTokens, type NavHue } from "../../lib/design-tokens";
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
// The client-approved green header has its own contrasting branding/control palette.
export function headerPalette(p: Palette): Palette {
  return {...p,background:p.header,surface:p.headerControl,text:p.headerControlText,
    muted:p.headerMuted,border:p.headerBorder,primary:p.headerControlText,onPrimary:p.headerControl};
}
export function departmentColor(tone: DepartmentTone, palette: Palette) {
  const values = departmentTokens[palette.isDark ? "dark" : "light"][tone];
  return {
    ink: Platform.OS === "web" ? "var(--rc-" + tone + "-ink)" : values.ink,
    wash: Platform.OS === "web" ? "var(--rc-" + tone + "-wash)" : values.wash,
    art: Platform.OS === "web" ? "var(--rc-" + tone + "-wash)" : values.wash,
  };
}
// A left-panel hue: CSS variables on the web (so the theme can switch), values on phones.
export function navHue(hue: NavHue, palette: Palette) {
  const values = navHueTokens[palette.isDark ? "dark" : "light"][hue];
  return Platform.OS === "web" ? { ink: `var(--rc-hue-${hue}-ink)`, wash: `var(--rc-hue-${hue}-wash)` } : values;
}
// Styles that only exist in the browser (gradients, layered shadows, blur); nothing elsewhere.
export const web = (style: Record<string, unknown>): ViewStyle => (Platform.OS === "web" ? style : {}) as ViewStyle;
// Depth (lib/design-tokens.ts depthTokens): resting cards, raised cards and floating sheets. The web
// uses the layered CSS shadows with a hairline top highlight; phones use one soft native shadow.
const shadow = (opacity: number, radius: number, y: number, elevation: number) => ({ shadowColor: "#0B1F1A", shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation });
export const depth = {
  card: Platform.OS === "web" ? { boxShadow: "var(--rc-elev-1),var(--rc-sheen)" } : shadow(0.07, 14, 6, 2),
  raised: Platform.OS === "web" ? { boxShadow: "var(--rc-elev-2),var(--rc-sheen)" } : shadow(0.12, 20, 10, 5),
  floating: Platform.OS === "web" ? { boxShadow: "var(--rc-elev-3)" } : shadow(0.2, 32, 16, 12),
};
// The primary action: forest with a soft lift of light from the top (web), and a coloured shadow.
export const primaryFill = (p: { primary: string; isDark: boolean }) => Platform.OS === "web"
  ? { backgroundColor: p.primary, backgroundImage: p.isDark ? "linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0) 60%)" : "linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0) 55%)", boxShadow: p.isDark ? "0 10px 24px -14px rgba(167,217,193,.55),inset 0 1px 0 rgba(255,255,255,.25)" : "0 10px 22px -12px rgba(21,45,40,.55),inset 0 1px 0 rgba(255,255,255,.18)" }
  : { backgroundColor: p.primary };
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
    letterSpacing: -1.3,
    lineHeight: 40,
    paddingRight: 3,
  },
  // Small uppercase labels above figures and groups.
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    lineHeight: 16,
    textTransform: "uppercase",
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
    borderRadius: 24,
    padding: 18,
    gap: 12,
    ...(Platform.OS === "web"
      ? { boxShadow: "var(--rc-elev-1),var(--rc-sheen)" }
      : { shadowColor: "#0B1F1A", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 }),
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
