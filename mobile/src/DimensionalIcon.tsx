import { Platform, View } from "react-native";
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { iconNodes } from "../../lib/artwork";
import { themes } from "./theme";

// Outline glyphs for departments and headline features: Lucide geometry drawn
// as a thin single-colour line, like the Recharge logo. No fills, gradients,
// shadows or depth. Names stay the same so every caller keeps working.
export type DimensionalName =
  | "house"
  | "building"
  | "hardhat"
  | "spray"
  | "people"
  | "coins"
  | "clipboard"
  | "hourglass"
  | "medal"
  | "key"
  | "chart"
  | "toolbox"
  | "calendar"
  | "chat"
  | "compass"
  | "sun"
  | "sunset"
  | "moon"
  | "tag"
  | "relist"
  | "signature"
  | "shield"
  | "box"
  | "bell"
  | "receipt"
  | "wallet"
  | "pie"
  | "cart"
  | "sofa"
  | "search"
  | "mail"
  | "star";


type Node = readonly [string, Record<string, string | number>];

// Lucide v1.31.0 geometry (ISC licensed, see docs/LUCIDE-ARTWORK-LICENSE.txt)
// for glyphs that lib/artwork.ts does not already carry.
const extraNodes: Record<string, readonly Node[]> = {
  "house": [["path",{"d":"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{"d":"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],
  "hourglass": [["path",{"d":"M5 22h14"}],["path",{"d":"M5 2h14"}],["path",{"d":"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"}],["path",{"d":"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"}]],
  "toolbox": [["path",{"d":"M16 12v4"}],["path",{"d":"M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"}],["path",{"d":"M17 6a2 2 0 011.414.586l3 3A2 2 0 0122 11v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 01.586-1.414l3-3A2 2 0 017 6z"}],["path",{"d":"M2 14h20"}],["path",{"d":"M8 12v4"}]],
  "compass": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"}]],
  "sun": [["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],
  "sunset": [["path",{"d":"M12 10V2"}],["path",{"d":"m4.93 10.93 1.41 1.41"}],["path",{"d":"M2 18h2"}],["path",{"d":"M20 18h2"}],["path",{"d":"m19.07 10.93-1.41 1.41"}],["path",{"d":"M22 22H2"}],["path",{"d":"m16 6-4 4-4-4"}],["path",{"d":"M16 18a4 4 0 0 0-8 0"}]],
  "moon": [["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],
  "tag": [["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],
  "refresh-cw": [["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],
  "signature": [["path",{"d":"m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284"}],["path",{"d":"M3 21h18"}]],
  "bell": [["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],
  "wallet": [["path",{"d":"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"}],["path",{"d":"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"}]],
  "star": [["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
};

const shapes = { path: Path, circle: Circle, rect: Rect, line: Line, polyline: Polyline, polygon: Polygon, ellipse: Ellipse };

// Which Lucide glyph draws each name.
function glyphFor(name: DimensionalName): string {
  switch (name) {
    case "house":
      return "house";
    case "building":
      return "building-2";
    case "hardhat":
      return "hard-hat";
    case "spray":
      return "spray-can";
    case "people":
      return "users";
    case "coins":
      return "circle-pound-sterling";
    case "clipboard":
      return "clipboard-list";
    case "hourglass":
      return "hourglass";
    case "medal":
      return "award";
    case "key":
      return "key-round";
    case "chart":
      return "chart-no-axes-combined";
    case "toolbox":
      return "toolbox";
    case "calendar":
      return "calendar-days";
    case "chat":
      return "messages-square";
    case "compass":
      return "compass";
    case "sun":
      return "sun";
    case "sunset":
      return "sunset";
    case "moon":
      return "moon";
    case "tag":
      return "tag";
    case "relist":
      return "refresh-cw";
    case "signature":
      return "signature";
    case "shield":
      return "shield-check";
    case "box":
      return "package-open";
    case "bell":
      return "bell";
    case "receipt":
      return "receipt-pound-sterling";
    case "wallet":
      return "wallet";
    case "pie":
      return "chart-pie";
    case "cart":
      return "shopping-bag";
    case "sofa":
      return "sofa";
    case "search":
      return "scan-search";
    case "mail":
      return "mail";
    case "star":
      return "star";
  }
}

export function DimensionalIcon({ name, size = 44, color = themes.light.primary }: { name: DimensionalName; size?: number; color?: string }) {
  const glyph = glyphFor(name);
  const nodes: readonly Node[] = extraNodes[glyph] ?? iconNodes[glyph] ?? [];
  return (
    <View accessible={false} pointerEvents="none" {...(Platform.OS === "web" ? { dataSet: { dimensional: "1" } } : {})} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        {nodes.map(([tag, attrs], index) => {
          const Shape = shapes[tag as keyof typeof shapes];
          return Shape ? <Shape key={index} {...attrs} {...(attrs.fill === "currentColor" ? { fill: color } : {})} /> : null;
        })}
      </Svg>
    </View>
  );
}

export const departmentDimensional = {
  stays: "building",
  ready: "hardhat",
  cleans: "spray",
  clients: "people",
  accounts: "coins",
} as const satisfies Record<string, DimensionalName>;
