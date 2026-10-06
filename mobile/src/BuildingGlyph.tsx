import Svg, { Path } from 'react-native-svg';
import { buildingFaces } from '../../lib/building-glyph';
import { departmentColor, type Palette } from './theme';
export function BuildingGlyph({palette:p,variant=0}:{palette:Palette;variant?:number}) {
  const tone=departmentColor(variant%2?'clients':'stays',p);
  return <Svg accessible={false} width={76} height={90} viewBox="0 0 96 112" stroke={tone.ink} strokeWidth={1.8} strokeLinejoin="round"><Path d={buildingFaces.ground} fill="none" opacity={.4}/><Path d={buildingFaces.roof} fill={tone.wash}/><Path d={buildingFaces.front} fill={p.surface}/><Path d={buildingFaces.side} fill={tone.wash}/><Path d={buildingFaces.windows} fill={tone.ink} strokeWidth={1}/><Path d={buildingFaces.door} fill={tone.ink}/></Svg>;
}
