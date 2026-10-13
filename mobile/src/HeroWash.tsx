import { View } from "react-native";
import type { Palette } from "./theme";

// A see-through tile on the forest hero (round 6, E's review: no hard-coded white). The fill and the edge are the
// hero's own text colour at low opacity, drawn under the tile's content, so they follow the tokens. On the web
// a token is a CSS variable, which cannot take an alpha suffix, hence the opacity layers. Put it first inside a
// tile that sets its own size and borderRadius.
export function HeroWash({ p, radius, fill = 0.12, edge = 0.18 }: { p: Palette; radius: number; fill?: number; edge?: number }) {
  return <>
    <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius, backgroundColor: p.heroText, opacity: fill }} />
    {edge > 0 && <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius, borderWidth: 1, borderColor: p.heroText, opacity: edge }} />}
  </>;
}

// A hairline on the hero, in the hero's text colour.
export const heroRule = (p: Palette, opacity = 0.14) => <View pointerEvents="none" style={{ height: 1, backgroundColor: p.heroText, opacity }} />;
