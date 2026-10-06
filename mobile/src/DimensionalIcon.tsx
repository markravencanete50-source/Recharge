import { useId, type ReactNode } from "react";
import { Platform, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

// Small dimensional illustrations for departments and headline features.
// Each object is lit from the top left: a gradient body, a soft highlight and
// a grounded shadow, drawn in the bone, forest and earth palette.
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
  | "moon";

const C = {
  forest: ["#2F6F5E", "#163A32"],
  mint: ["#C9EBDB", "#7FC3A6"],
  bone: ["#FFFDF7", "#E3DAC6"],
  gold: ["#F6D58A", "#C68B2C"],
  terracotta: ["#F0A27E", "#B4512F"],
  slate: ["#A9C6D2", "#4A6B7A"],
  heather: ["#E2C3DE", "#8C6189"],
  moss: ["#C9E3A4", "#5E8A3A"],
} as const;

type Grad = (key: keyof typeof C, x2?: string, y2?: string) => string;

function draw(name: DimensionalName, g: Grad): ReactNode {
  switch (name) {
    case "house":
      // 2.5D: gable front, shaded side wall and a receding roof plane.
      return <>
        <Path d="M44 30 L54 25 L54 49 L44 54 Z" fill="#C9BEA4" />
        <Path d="M12 54 L12 32 L28 17 L44 32 L44 54 Z" fill={g("bone", "0", "1")} />
        <Path d="M28 17 L38 12 L54 26 L44 31 Z" fill="#B4512F" />
        <Path d="M9 34 L28 16 L47 34" fill="none" stroke={g("terracotta")} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        <Rect x={41} y={12} width={5} height={10} rx={1} fill="#C9BEA4" />
        <Circle cx={28} cy={29} r={3.4} fill={g("gold")} />
        <Path d="M23.5 54 V44.5 a4.5 4.5 0 0 1 9 0 V54 Z" fill={g("forest")} />
        <Rect x={15} y={40} width={6.5} height={6.5} rx={1} fill={g("slate")} />
        <Rect x={34.5} y={40} width={6.5} height={6.5} rx={1} fill={g("gold")} />
      </>;
    case "building":
      // 2.5D block: lit front, shaded side and a calm window rhythm.
      return <>
        <Path d="M18 14 L28 9 L50 9 L40 14 Z" fill="#F4EFE4" />
        <Rect x={18} y={14} width={22} height={41} fill={g("bone", "0", "1")} />
        <Path d="M40 14 L50 9 L50 50 L40 55 Z" fill="#9DB5AC" />
        {[0, 1, 2, 3].map(row => [0, 1].map(col => <Rect key={row + "-" + col} x={21.5 + col * 9} y={18 + row * 8.5} width={6} height={5} rx={1} fill={row === 1 && col === 0 || row === 3 && col === 1 ? g("gold") : g("slate")} />))}
        {[0, 1, 2, 3].map(row => <Path key={"s" + row} d={`M42.5 ${19 + row * 8.5} L47.5 ${16.5 + row * 8.5} L47.5 ${21.5 + row * 8.5} L42.5 ${24 + row * 8.5} Z`} fill="#5E7F87" opacity={0.55} />)}
        <Rect x={26} y={48} width={6} height={7} rx={1} fill={g("forest")} />
      </>;
    case "hardhat":
      return <>
        <Path d="M14 40 C14 25 22 16 32 16 C42 16 50 25 50 40 Z" fill={g("gold")} />
        <Path d="M29 16.4 C29 16.4 30 26 30 40 L34 40 C34 26 35 16.4 35 16.4 C34 16.1 30 16.1 29 16.4 Z" fill="#E9B65C" />
        <Rect x={8} y={39} width={48} height={7} rx={3.5} fill={g("terracotta")} />
      </>;
    case "spray":
      return <>
        <Path d="M22 24 L38 24 L42 50 C42 52 40.5 53 39 53 L21 53 C19.5 53 18 52 18 50 Z" fill={g("mint")} />
        <Rect x={21} y={31} width={18} height={11} rx={2} fill={g("bone")} />
        <Path d="M23 13 L37 13 C39 13 40 14 40 16 L40 24 L20 24 L20 16 C20 14 21 13 23 13 Z" fill={g("forest")} />
        <Path d="M40 15 L49 15 L49 19 L40 19 Z" fill={g("forest")} />
        <Path d="M53 9 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 Z" fill="#F6D58A" />
        <Path d="M54 22 l.8 1.8 1.8 .8 -1.8 .8 -.8 1.8 -.8 -1.8 -1.8 -.8 1.8 -.8 Z" fill="#C9EBDB" />
      </>;
    case "people":
      return <>
        <Circle cx={40} cy={21} r={7} fill={g("heather")} />
        <Path d="M27 50 C27 38 33 32 40 32 C47 32 53 38 53 50 Z" fill={g("heather")} />
        <Circle cx={25} cy={23} r={8} fill={g("slate")} />
        <Path d="M10 52 C10 39 17 34 25 34 C33 34 40 39 40 52 Z" fill={g("slate")} />
      </>;
    case "coins":
      return <>
        {[0, 1, 2].map(i => <G key={i}>
          <Ellipse cx={30} cy={46 - i * 7} rx={16} ry={6} fill="#B07A26" />
          <Rect x={14} y={40 - i * 7} width={32} height={6} fill="#B07A26" />
          <Ellipse cx={30} cy={40 - i * 7} rx={16} ry={6} fill={g("gold", "1", "0")} />
        </G>)}
        <Path d="M27.5 30 c0-3 4.5-3 4.5 0 M26 26 l7 0 M26.5 23 l6 0" stroke="#9A6A1E" strokeWidth={1.4} strokeLinecap="round" fill="none" />
        <Circle cx={47} cy={18} r={8.5} fill={g("gold")} />
        <Circle cx={47} cy={18} r={5.5} fill="none" stroke="#B07A26" strokeWidth={1.3} />
      </>;
    case "clipboard":
      return <>
        <Rect x={14} y={12} width={36} height={44} rx={5} fill={g("terracotta")} />
        <Rect x={18} y={17} width={28} height={35} rx={3} fill={g("bone")} />
        <Rect x={24} y={9} width={16} height={8} rx={3} fill={g("forest")} />
        {[0, 1, 2].map(i => <G key={i}>
          <Path d={`M21.5 ${26 + i * 8} l2.2 2.2 4 -4.4`} stroke={i < 2 ? "#3F8A5E" : "#C9C1AE"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Rect x={30} y={24.5 + i * 8} width={12} height={3} rx={1.5} fill={i < 2 ? "#BFD8C6" : "#E3DAC6"} />
        </G>)}
      </>;
    case "hourglass":
      return <>
        <Rect x={16} y={9} width={32} height={6} rx={3} fill={g("forest")} />
        <Rect x={16} y={49} width={32} height={6} rx={3} fill={g("forest")} />
        <Path d="M20 15 L44 15 C44 24 36 28 34 32 C36 36 44 40 44 49 L20 49 C20 40 28 36 30 32 C28 28 20 24 20 15 Z" fill={g("mint")} opacity={0.75} />
        <Path d="M24 20 L40 20 C38 25 33 27 32 30 C31 27 26 25 24 20 Z" fill={g("gold")} />
        <Path d="M32 36 C33 40 41 42 42 47 L22 47 C23 42 31 40 32 36 Z" fill={g("gold")} />
      </>;
    case "medal":
      return <>
        <Path d="M20 8 L30 8 L36 26 L28 30 Z" fill={g("terracotta")} />
        <Path d="M44 8 L34 8 L28 26 L36 30 Z" fill={g("forest")} />
        <Circle cx={32} cy={39} r={15} fill={g("gold")} />
        <Circle cx={32} cy={39} r={10.5} fill="none" stroke="#B07A26" strokeWidth={1.5} />
        <Path d="M32 32.5 l2 4.1 4.5 .6 -3.3 3.1 .8 4.4 -4 -2.1 -4 2.1 .8 -4.4 -3.3 -3.1 4.5 -.6 Z" fill="#FFF3D2" />
      </>;
    case "key":
      return <>
        <Circle cx={22} cy={24} r={12} fill={g("gold")} />
        <Circle cx={22} cy={24} r={4.5} fill="#EFE9DB" />
        <Path d="M30 31 L50 51 L45 56 L42 53 L39 56 L35 52 L38 49 L26 37 Z" fill={g("gold")} />
        <Rect x={11} y={42} width={16} height={11} rx={3} fill={g("forest")} transform="rotate(-12 19 47)" />
        <Circle cx={15} cy={47} r={1.6} fill="#C9EBDB" />
      </>;
    case "chart":
      return <>
        <Rect x={10} y={50} width={44} height={5} rx={2.5} fill={g("forest")} />
        <Rect x={14} y={34} width={9} height={16} rx={2.5} fill={g("mint")} />
        <Rect x={27.5} y={24} width={9} height={26} rx={2.5} fill={g("gold")} />
        <Rect x={41} y={14} width={9} height={36} rx={2.5} fill={g("terracotta")} />
        <Path d="M15 26 L30 16 L38 20 L50 8" stroke="#2F6F5E" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Circle cx={50} cy={8} r={2.6} fill="#2F6F5E" />
      </>;
    case "toolbox":
      return <>
        <Path d="M24 22 L24 16 C24 14 25 13 27 13 L37 13 C39 13 40 14 40 16 L40 22" stroke="#163A32" strokeWidth={3.4} fill="none" strokeLinecap="round" />
        <Rect x={9} y={21} width={46} height={31} rx={5} fill={g("terracotta")} />
        <Rect x={9} y={30} width={46} height={4} fill="#9A4426" opacity={0.55} />
        <Rect x={27} y={27} width={10} height={10} rx={2} fill={g("gold")} />
      </>;
    case "calendar":
      return <>
        <Rect x={11} y={14} width={42} height={40} rx={6} fill={g("bone")} />
        <Path d="M11 20 C11 16.7 13.7 14 17 14 L47 14 C50.3 14 53 16.7 53 20 L53 25 L11 25 Z" fill={g("terracotta")} />
        <Rect x={20} y={9} width={4} height={10} rx={2} fill={g("forest")} />
        <Rect x={40} y={9} width={4} height={10} rx={2} fill={g("forest")} />
        {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => <Rect key={r + "" + c} x={16 + c * 8.5} y={30 + r * 7.5} width={5.5} height={4.5} rx={1.2} fill={r === 1 && c === 2 ? "#2F6F5E" : "#E3DAC6"} />))}
      </>;
    case "chat":
      return <>
        <Path d="M30 12 C43 12 52 19 52 29 C52 39 43 46 30 46 C27 46 24 45.6 21.5 44.8 L12 50 L14.5 41.5 C10.4 38.3 8 34 8 29 C8 19 17 12 30 12 Z" fill={g("mint")} />
        <Path d="M44 30 C52 30 57 34.5 57 40 C57 43 55.5 45.6 53 47.4 L54.5 53 L48.5 49.6 C47 50 45.6 50.2 44 50.2 C36 50.2 31 45.6 31 40 C31 34.5 36 30 44 30 Z" fill={g("forest")} />
        <Circle cx={21} cy={29} r={2.6} fill="#2F6F5E" />
        <Circle cx={30} cy={29} r={2.6} fill="#2F6F5E" />
        <Circle cx={39} cy={29} r={2.6} fill="#2F6F5E" />
      </>;
    case "sun":
      return <>
        {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <Rect key={angle} x={30} y={4} width={4} height={10} rx={2} fill={g("gold")} transform={`rotate(${angle} 32 30)`} />)}
        <Circle cx={32} cy={30} r={14} fill={g("gold")} />
        <Circle cx={27} cy={25} r={5} fill="#FFF3D2" opacity={0.65} />
      </>;
    case "sunset":
      return <>
        {[-60, -30, 0, 30, 60].map(angle => <Rect key={angle} x={30} y={6} width={4} height={9} rx={2} fill={g("terracotta")} transform={`rotate(${angle} 32 38)`} />)}
        <Path d="M14 40 A18 18 0 0 1 50 40 Z" fill={g("terracotta")} />
        <Rect x={8} y={40} width={48} height={4} rx={2} fill={g("forest")} />
        <Rect x={16} y={47} width={32} height={3} rx={1.5} fill={g("slate")} />
        <Rect x={23} y={53} width={18} height={3} rx={1.5} fill={g("slate")} opacity={0.7} />
      </>;
    case "moon":
      return <>
        <Path d="M38 10 A22 22 0 1 0 54 42 A17 17 0 1 1 38 10 Z" fill={g("bone")} />
        <Circle cx={26} cy={34} r={3} fill="#E3DAC6" />
        <Circle cx={33} cy={45} r={2} fill="#E3DAC6" />
        <Path d="M50 12 l1.1 2.6 2.6 1.1 -2.6 1.1 -1.1 2.6 -1.1 -2.6 -2.6 -1.1 2.6 -1.1 Z" fill="#F6D58A" />
        <Path d="M56 26 l.8 1.8 1.8 .8 -1.8 .8 -.8 1.8 -.8 -1.8 -1.8 -.8 1.8 -.8 Z" fill="#C9EBDB" />
      </>;
    case "compass":
      return <>
        <Circle cx={32} cy={32} r={22} fill={g("forest")} />
        <Circle cx={32} cy={32} r={17} fill={g("bone")} />
        <Path d="M32 17 L36 32 L32 34 L28 32 Z" fill={g("terracotta")} />
        <Path d="M32 47 L28 32 L32 30 L36 32 Z" fill={g("slate")} />
        <Circle cx={32} cy={32} r={2.5} fill="#163A32" />
      </>;
  }
}

export function DimensionalIcon({ name, size = 44 }: { name: DimensionalName; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const used = new Map<string, string>();
  const g: Grad = (key, x2 = "0.9", y2 = "1") => {
    const ref = id + key + x2 + y2;
    used.set(ref, key + "|" + x2 + "|" + y2);
    return "url(#" + ref + ")";
  };
  const body = draw(name, g);
  return (
    <View accessible={false} pointerEvents="none" {...(Platform.OS === "web" ? { dataSet: { dimensional: "1" } } : {})} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          {[...used.entries()].map(([ref, spec]) => {
            const [key, x2, y2] = spec.split("|");
            const [light, dark] = C[key as keyof typeof C];
            return <LinearGradient key={ref} id={ref} x1="0.1" y1="0" x2={x2} y2={y2}>
              <Stop offset="0" stopColor={light} />
              <Stop offset="1" stopColor={dark} />
            </LinearGradient>;
          })}
          <RadialGradient id={id + "shadow"} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#0B1714" stopOpacity={0.28} />
            <Stop offset="1" stopColor="#0B1714" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={32} cy={58} rx={22} ry={4.2} fill={"url(#" + id + "shadow)"} />
        {body}
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
