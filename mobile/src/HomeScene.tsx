import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

// A small 2.5D street scene for the mobile welcome panel: a gabled house in
// front of an apartment block, lit from the top left. Fixed colours suit the
// forest header in both themes.
export function HomeScene({ width = 176 }: { width?: number }) {
  // Solid fills only: one flat colour per surface.
  const solid: Record<string, string> = {
    ground: "#A7D9C1", shadow: "#06110E", front: "#F2EBDD", side: "#CCC1A8", top: "#EBE4D3",
    towerFront: "#D8E3DD", towerSide: "#8EA89E", roof: "#CC7050", roofSide: "#B0502F",
    glass: "#7898A8", lit: "#F0C676", door: "#235849", leaf: "#7DAA5E", leafDark: "#5B9870",
  };
  const u = (name: string) => solid[name];
  const height = width * 0.75;
  const glass = (x: number, y: number, w: number, h: number, lit = false, key?: string) => (
    <G key={key}>
      <Rect x={x} y={y} width={w} height={h} rx={1.6} fill={lit ? u("lit") : u("glass")} />
      <Rect x={x + 1} y={y + 1} width={w * 0.45} height={h - 2} rx={1} fill="#FFFFFF" opacity={lit ? 0.28 : 0.18} />
    </G>
  );
  const towerRows = [0, 1, 2, 3, 4, 5];
  const lit = new Set(["1-1", "3-0", "4-2"]);
  return (
    <View pointerEvents="none" accessible={false} style={{ width, height }}>
      <Svg width={width} height={height} viewBox="0 0 240 180">
        {/* Ground tint and contact shadows. */}
        <Ellipse cx={124} cy={158} rx={116} ry={18} fill={u("ground")} opacity={0.2} />
        <Ellipse cx={170} cy={154} rx={44} ry={7} fill={u("shadow")} opacity={0.2} />
        <Ellipse cx={88} cy={156} rx={52} ry={7} fill={u("shadow")} opacity={0.2} />

        {/* Apartment block: top, front and shaded side faces. */}
        <Path d="M134 34 L156 24 L206 24 L184 34 Z" fill={u("top")} />
        <Rect x={134} y={34} width={50} height={118} fill={u("towerFront")} />
        <Path d="M184 34 L206 24 L206 142 L184 152 Z" fill={u("towerSide")} />
        <Rect x={134} y={34} width={50} height={4} fill="#FFFFFF" opacity={0.5} />
        {towerRows.map(row => [0, 1, 2].map(col => glass(140 + col * 14.5, 44 + row * 16, 9.5, 10, lit.has(row + "-" + col), "t" + row + col)))}
        {towerRows.map(row => <Path key={"s" + row} d={`M189 ${46 + row * 16 - 2.3} L201 ${41 + row * 16 - 2.3} L201 ${50 + row * 16 - 2.3} L189 ${55 + row * 16 - 2.3} Z`} fill="#5E7F87" opacity={0.55} />)}
        <Rect x={152} y={134} width={14} height={18} rx={2} fill={u("door")} />

        {/* House: shaded side wall, gable front, two roof planes and chimney. */}
        <Path d="M116 112 L138 102 L138 144 L116 154 Z" fill={u("side")} />
        <Path d="M50 154 L50 112 L83 84 L116 112 L116 154 Z" fill={u("front")} />
        <Path d="M83 84 L105 74 L138 102 L116 112 Z" fill={u("roofSide")} />
        <Rect x={112} y={70} width={9} height={18} rx={1.5} fill={u("side")} />
        <Rect x={110.5} y={67} width={12} height={4.5} rx={1.5} fill="#99401F" />
        <Path d="M44 116 L83 82 L122 116" fill="none" stroke={u("roof")} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M83 82 L105 72" fill="none" stroke="#C8643F" strokeWidth={8} strokeLinecap="round" />
        <Circle cx={83} cy={103} r={6.5} fill={u("lit")} />
        <Circle cx={83} cy={103} r={6.5} fill="none" stroke="#FFFDF7" strokeWidth={1.6} />
        {glass(57, 122, 15, 14, false)}
        <Path d="M64.5 122 V136 M57 129 H72" stroke="#FFFDF7" strokeWidth={1.4} />
        {glass(94, 122, 15, 14, true)}
        <Path d="M101.5 122 V136 M94 129 H109" stroke="#FFFDF7" strokeWidth={1.4} />
        <Path d="M76 154 V134 a7 7 0 0 1 14 0 V154 Z" fill={u("door")} />
        <Circle cx={86.5} cy={145} r={1.3} fill="#F6D58A" />
        <Path d="M122 120 L132 115.5 L132 127 L122 131.5 Z" fill="#5E7F87" opacity={0.6} />
        <Path d="M74 154 L92 154 L98 164 L68 164 Z" fill="#EFE9DB" opacity={0.75} />

        {/* Trees and a hedge soften the edges. */}
        <Rect x={27.5} y={132} width={4} height={22} rx={2} fill="#6B4A2B" />
        <Circle cx={29.5} cy={124} r={14} fill={u("leaf")} />
        <Circle cx={21} cy={133} r={9} fill={u("leaf")} />
        <Circle cx={38} cy={134} r={8.5} fill={u("leafDark")} />
        <Rect x={218} y={140} width={3.5} height={14} rx={1.7} fill="#6B4A2B" />
        <Circle cx={220} cy={134} r={10} fill={u("leafDark")} />
        <Ellipse cx={128} cy={153} rx={12} ry={6} fill={u("leafDark")} />
        <Ellipse cx={194} cy={151} rx={10} ry={5.5} fill={u("leaf")} />
      </Svg>
    </View>
  );
}
