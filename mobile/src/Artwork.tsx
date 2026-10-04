import { View } from "react-native";
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
import { WORKSPACE_MAP, type DepartmentTone } from "../../lib/workspace-map";
import { featureGlyphs, departmentGlyphs, iconNodes } from "../../lib/artwork";
import { departmentColor, themes, type Palette } from "./theme";
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
      accessible={false}
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
function Tile({
  name,
  tone,
  size,
  palette,
}: {
  name: string;
  tone: DepartmentTone;
  size: number;
  palette: Palette;
}) {
  const c = departmentColor(tone, palette);
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        backgroundColor: c.wash,
        borderWidth: 1,
        borderColor: c.ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glyph name={name} size={Math.min(24, size * 0.5)} color={c.ink} />
    </View>
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
      tone={WORKSPACE_MAP[id].tone}
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
  return (
    <Tile
      name={departmentGlyphs[department]}
      tone={department}
      size={size}
      palette={palette}
    />
  );
}
