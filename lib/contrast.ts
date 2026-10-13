// Every colour pair the app draws from the design tokens, with the contrast it must keep in both themes
// (tests/contrast-tokens.test.mjs checks each one). A pair is [ink, ground, minimum, where it is used].
//   4.5  body text (WCAG AA)
//   3    large text, icons, and the outlines that mark a control or its focus (WCAG AA, 1.4.3 and 1.4.11)
//   1.3  an "edge": a card on the page, a hairline, a raised strip. Not text, so WCAG sets no figure, but it
//        has to be visible: the dark theme used to sit at 1.17 (cards melting into the page).
// When a screen starts drawing a new pair, add it here so both themes are checked.
import { departmentTokens, designTokens, navHueTokens } from "./design-tokens";

export type Tokens = typeof designTokens.light;
export type TokenName = keyof Tokens;
export type ContrastPair = readonly [ink: TokenName, ground: TokenName, minimum: number, use: string, only?: "dark"];

export const TEXT = 4.5, UI = 3, EDGE = 1.3;

const grounds: TokenName[] = ["background", "surface", "elevated"];
const each = (inks: TokenName[], on: TokenName[], min: number, use: string): ContrastPair[] =>
  inks.flatMap(ink => on.map(ground => [ink, ground, min, use] as const));

export const contrastPairs: ContrastPair[] = [
  // Text on the page, cards, raised parts (inputs, table heads, popovers) and the secondary button.
  ...each(["text", "muted"], [...grounds, "wash", "hover"], TEXT, "text and secondary text"),
  // Links, icons and secondary button labels in the brand colour.
  ...each(["primary"], [...grounds, "wash", "hover"], TEXT, "links and secondary button labels"),
  ["onPrimary", "primary", TEXT, "primary button label"],
  ["onPrimary", "primaryHover", TEXT, "primary button label under the pointer"],
  ["onSelected", "selected", TEXT, "selected pill, tab, option or calendar day"],
  // Disabled labels are exempt from AA, but must still be readable.
  ...each(["disabled"], grounds, UI, "disabled label"),
  // Status words and figures, on cards and on their own washes.
  ...each(["success", "waiting", "danger"], grounds, TEXT, "status text"),
  ["success", "successWash", TEXT, "success badge"],
  ["waiting", "cautionWash", TEXT, "waiting badge"],
  ["danger", "dangerWash", TEXT, "problem badge"],
  ...each(["text"], ["successWash", "cautionWash", "dangerWash"], TEXT, "notice text"),
  ["chart", "surface", UI, "chart lines"],
  ["chart", "elevated", UI, "bars on their track"],
  ["utilityInk", "utilityArt", TEXT, "utility tile"],
  // Controls: field and outlined-button outlines, the focus ring, the selected outline.
  ...each(["controlBorder"], [...grounds, "wash"], UI, "field and control outline"),
  ...each(["primary"], grounds, UI, "focus ring and today ring"),
  ...each(["selectedBorder"], ["background", "surface"], UI, "selected outline"),
  // The header (green in light mode, bone in dark mode), its buttons, toasts and the Help button.
  ["headerText", "header", TEXT, "header text and toasts"],
  ["headerMuted", "header", TEXT, "header secondary text"],
  ["headerControlText", "headerControl", TEXT, "header buttons"],
  ["headerBorder", "header", UI, "header button outline"],
  ["onBadge", "badge", TEXT, "unread count"],
  ["heroText", "hero", TEXT, "Home panel"],
  ["heroMuted", "hero", TEXT, "Home panel secondary text"],
  ["onSuccess", "success", TEXT, "label or tick on a success fill (saved toast, Accept)"],
  // Edges: each layer stands off the one under it.
  // In the light theme a card stands off the bone page by its soft shadow (depthTokens), which a dark page
  // swallows, so there the colour step has to do the work.
  ["surface", "background", EDGE, "card on the page", "dark"],
  ["elevated", "surface", EDGE, "raised strip on a card"],
  ["border", "surface", EDGE, "hairline on a card"],
  ["border", "background", EDGE, "hairline on the page"],
  ["washBorder", "surface", EDGE, "secondary button edge"],
  ["selected", "surface", EDGE, "selected pill against unselected"],
  ["selected", "wash", EDGE, "chosen tab on its track"],
];

const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
// Relative luminance of #RRGGBB (an alpha byte, if any, is ignored: tokens drawn as text are opaque).
export function luminance(hex: string) {
  const [r, g, b] = (hex.slice(1, 7).match(/../g) ?? []).map(v => channel(parseInt(v, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export type ContrastResult = { mode: "light" | "dark"; ink: string; ground: string; inkHex: string; groundHex: string; ratio: number; minimum: number; use: string };
// Every pair in both themes, plus the department and left-panel tiles (ink on its wash, and its bar on a raised track).
export function contrastReport(): ContrastResult[] {
  return (["light", "dark"] as const).flatMap(mode => {
    const t = designTokens[mode];
    const rows: ContrastResult[] = contrastPairs.filter(([, , , , only]) => !only || only === mode).map(([ink, ground, minimum, use]) =>
      ({ mode, ink, ground, inkHex: t[ink], groundHex: t[ground], ratio: contrastRatio(t[ink], t[ground]), minimum, use }));
    for (const [name, d] of Object.entries(departmentTokens[mode])) {
      rows.push({ mode, ink: `${name}-ink`, ground: `${name}-wash`, inkHex: d.ink, groundHex: d.wash, ratio: contrastRatio(d.ink, d.wash), minimum: TEXT, use: "department tile" });
      rows.push({ mode, ink: `${name}-ink`, ground: "elevated", inkHex: d.ink, groundHex: t.elevated, ratio: contrastRatio(d.ink, t.elevated), minimum: UI, use: "department bar" });
    }
    for (const [name, h] of Object.entries(navHueTokens[mode]))
      rows.push({ mode, ink: `hue-${name}-ink`, ground: `hue-${name}-wash`, inkHex: h.ink, groundHex: h.wash, ratio: contrastRatio(h.ink, h.wash), minimum: TEXT, use: "left panel icon tile" });
    return rows;
  });
}
