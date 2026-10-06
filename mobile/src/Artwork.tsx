import { useId, type ComponentProps, type ReactNode } from "react";
import Feather from "@expo/vector-icons/Feather";
import { DimensionalIcon, departmentDimensional } from "./DimensionalIcon";
import { Platform, View } from "react-native";
import Svg, {
  Path,
  Circle,
  Rect,
  Line,
  Polyline,
  Polygon,
  Ellipse,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
} from "react-native-svg";
import type { ModuleId } from "./model";
import type { DepartmentTone } from "../../lib/workspace-map";
import { featureGlyphs, iconNodes, toolHues, toolHueSwatches, type ToolHue } from "../../lib/artwork";
import { themes, type Palette } from "./theme";
const shapes = {
  path: Path,
  circle: Circle,
  rect: Rect,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
};
export function Glyph({
  name,
  size = 24,
  color,
  filled = false,
}: {
  name: string;
  size?: number;
  color: string;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke={color}
      fill={filled ? color : "none"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconNodes[name]?.map(([tag, attrs], index) => {
        const Shape = shapes[tag as keyof typeof shapes];
        return Shape ? <Shape key={index} {...attrs} /> : null;
      })}
    </Svg>
  );
}
function TileFrame({
  hue,
  size,
  palette,
  children,
}: {
  hue: ToolHue;
  size: number;
  palette: Palette;
  children: ReactNode;
}) {
  const c = toolHueSwatches[hue][palette.isDark ? "dark" : "light"];
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const radius = Math.round(size * 0.3);
  return (
    <View
      accessible={false}
      {...(Platform.OS === "web" ? { dataSet: { glyphTile: "1" } } : {})}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: c.ink + "33",
      }}
    >
      {/* Soft gradient tile with a glow orb and a top-left sheen. */}
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <Defs>
          <LinearGradient id={"t" + id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.wash} />
            <Stop offset="1" stopColor={c.glow} stopOpacity={palette.isDark ? 0.9 : 0.55} />
          </LinearGradient>
          <RadialGradient id={"g" + id} cx="0.78" cy="0.82" r="0.55">
            <Stop offset="0" stopColor={c.glow} stopOpacity={palette.isDark ? 0.75 : 0.9} />
            <Stop offset="1" stopColor={c.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill={"url(#t" + id + ")"} />
        <Rect x={0} y={0} width={size} height={size} fill={"url(#g" + id + ")"} />
        <Ellipse cx={size * 0.28} cy={size * 0.18} rx={size * 0.34} ry={size * 0.16} fill="#FFFFFF" opacity={palette.isDark ? 0.06 : 0.45} />
      </Svg>
      <View {...(Platform.OS === "web" ? { dataSet: { glyphMark: "1" } } : {})}>{children}</View>
    </View>
  );
}
function Tile({ name, hue, size, palette }: { name: string; hue: ToolHue; size: number; palette: Palette }) {
  const c = toolHueSwatches[hue][palette.isDark ? "dark" : "light"];
  const glyph = Math.min(26, Math.round(size * 0.5));
  return (
    <TileFrame hue={hue} size={size} palette={palette}>
      {/* Duotone: a faint filled echo sits behind the crisp stroke. */}
      <View style={{ width: glyph, height: glyph }}>
        <View style={{ position: "absolute", left: 1.5, top: 1.5, opacity: palette.isDark ? 0.3 : 0.22 }}>
          <Glyph name={name} size={glyph} color={c.ink} filled />
        </View>
        <Glyph name={name} size={glyph} color={c.ink} />
      </View>
    </TileFrame>
  );
}
type FeatherName = ComponentProps<typeof Feather>["name"];
// Workspace features outside the tool list get their own hue too, keyed by icon.
const featureIconHues: Partial<Record<FeatherName, ToolHue>> = {
  "help-circle": "slate",
  activity: "clay",
  "bar-chart-2": "moss",
  calendar: "teal",
  "message-circle": "heather",
  user: "ochre",
  grid: "forest",
  moon: "heather",
  droplet: "teal",
  map: "terracotta",
  wind: "slate",
  bookmark: "ochre",
  search: "forest",
  "check-square": "moss",
  clock: "teal",
  home: "forest",
};
export function FeatureTile({
  icon,
  size = 40,
  palette = themes.light,
  hue,
}: {
  icon: FeatherName;
  size?: number;
  palette?: Palette;
  hue?: ToolHue;
}) {
  const tone = hue ?? featureIconHues[icon] ?? "forest";
  const c = toolHueSwatches[tone][palette.isDark ? "dark" : "light"];
  return (
    <TileFrame hue={tone} size={size} palette={palette}>
      <Feather name={icon} size={Math.min(22, Math.round(size * 0.46))} color={c.ink} />
    </TileFrame>
  );
}
export function Artwork({
  id,
  size = 48,
  palette = themes.light,
}: {
  id: ModuleId;
  size?: number;
  palette?: Palette;
}) {
  return (
    <Tile
      name={featureGlyphs[id]}
      hue={toolHues[id]}
      size={size}
      palette={palette}
    />
  );
}
export function DepartmentArtwork({
  department,
  size = 48,
}: {
  department: DepartmentTone;
  size?: number;
  palette?: Palette;
}) {
  // Departments use dimensional illustrations so they read as places, while
  // individual tools keep their flat duotone tiles.
  return <DimensionalIcon name={departmentDimensional[department]} size={size} />;
}
