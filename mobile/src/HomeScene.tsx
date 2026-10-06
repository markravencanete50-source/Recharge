import { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

// A small 2.5D street scene for the mobile welcome panel: a gabled house in
// front of an apartment block, lit from the top left. Fixed colours suit the
// forest header in both themes.
export function HomeScene({ width = 176 }: { width?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const u = (name: string) => "url(#" + id + name + ")";
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
        <Defs>
          <RadialGradient id={id + "ground"} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#A7D9C1" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#A7D9C1" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={id + "shadow"} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#06110E" stopOpacity={0.45} />
            <Stop offset="1" stopColor="#06110E" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={id + "front"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFDF7" />
            <Stop offset="1" stopColor="#E9E1CF" />
          </LinearGradient>
          <LinearGradient id={id + "side"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#D9CFB8" />
            <Stop offset="1" stopColor="#BFB397" />
          </LinearGradient>
          <LinearGradient id={id + "top"} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#F4EFE4" />
            <Stop offset="1" stopColor="#E3DAC6" />
          </LinearGradient>
          <LinearGradient id={id + "towerFront"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#E7EEEA" />
            <Stop offset="1" stopColor="#C9D7D0" />
          </LinearGradient>
          <LinearGradient id={id + "towerSide"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9DB5AC" />
            <Stop offset="1" stopColor="#7E998E" />
          </LinearGradient>
          <LinearGradient id={id + "roof"} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E9906A" />
            <Stop offset="1" stopColor="#B4512F" />
          </LinearGradient>
          <LinearGradient id={id + "roofSide"} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#C8643F" />
            <Stop offset="1" stopColor="#99401F" />
          </LinearGradient>
          <LinearGradient id={id + "glass"} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#A9C6D2" />
            <Stop offset="1" stopColor="#4F7383" />
          </LinearGradient>
          <LinearGradient id={id + "lit"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBE3A6" />
            <Stop offset="1" stopColor="#E3A846" />
          </LinearGradient>
          <LinearGradient id={id + "door"} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2F6F5E" />
            <Stop offset="1" stopColor="#163A32" />
          </LinearGradient>
          <RadialGradient id={id + "leaf"} cx="0.35" cy="0.3" r="0.75">
            <Stop offset="0" stopColor="#C9E3A4" />
            <Stop offset="1" stopColor="#4F7F35" />
          </RadialGradient>
          <RadialGradient id={id + "leafDark"} cx="0.35" cy="0.3" r="0.75">
            <Stop offset="0" stopColor="#8FC79A" />
            <Stop offset="1" stopColor="#2F6A4A" />
          </RadialGradient>
        </Defs>

        {/* Ground glow and contact shadows. */}
        <Ellipse cx={124} cy={158} rx={116} ry={18} fill={u("ground")} />
        <Ellipse cx={170} cy={154} rx={44} ry={7} fill={u("shadow")} />
        <Ellipse cx={88} cy={156} rx={52} ry={7} fill={u("shadow")} />

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
