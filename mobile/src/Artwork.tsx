import type { ComponentProps, ReactNode } from "react";
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
} from "react-native-svg";
import type { ModuleId } from "./model";
import type { DepartmentTone } from "../../lib/workspace-map";
import { featureGlyphs, iconNodes, type ToolHue } from "../../lib/artwork";
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
  // A thin line, like the Recharge logo.
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke={color}
      fill={filled ? color : "none"}
      strokeWidth={1.75}
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
  size,
  palette,
  children,
}: {
  size: number;
  palette: Palette;
  children: ReactNode;
}) {
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
        borderColor: palette.border,
        backgroundColor: palette.wash,
      }}
    >
      <View {...(Platform.OS === "web" ? { dataSet: { glyphMark: "1" } } : {})}>{children}</View>
    </View>
  );
}
// Tiles are one neutral wash with an outline glyph in the primary colour; `hue` is kept so callers need no change.
function Tile({ name, size, palette }: { name: string; hue?: ToolHue; size: number; palette: Palette }) {
  const glyph = Math.min(26, Math.round(size * 0.5));
  return (
    <TileFrame size={size} palette={palette}>
      <Glyph name={name} size={glyph} color={palette.primary} />
    </TileFrame>
  );
}
type FeatherName = ComponentProps<typeof Feather>["name"];
export function FeatureTile({
  icon,
  size = 40,
  palette = themes.light,
}: {
  icon: FeatherName;
  size?: number;
  palette?: Palette;
  hue?: ToolHue;
}) {
  return (
    <TileFrame size={size} palette={palette}>
      <Feather name={icon} size={Math.min(22, Math.round(size * 0.46))} color={palette.primary} />
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
      size={size}
      palette={palette}
    />
  );
}
export function DepartmentArtwork({
  department,
  size = 48,
  palette = themes.light,
}: {
  department: DepartmentTone;
  size?: number;
  palette?: Palette;
}) {
  // Departments draw an outline glyph, tools sit on flat tinted tiles.
  return <DimensionalIcon name={departmentDimensional[department]} size={size} color={palette.primary} />;
}
