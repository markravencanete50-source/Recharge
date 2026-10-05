import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { rechargeWordmark } from '../../lib/recharge-brand';
import type { Palette } from './theme';

// The existing company wordmark, shared with the desktop portal.
export function CompanyLogo({palette:p,width=144}:{palette:Palette;width?:number}) {
  const xml = rechargeWordmark.replaceAll('#fff',p.text).replaceAll('#1c3934',p.background);
  return <View accessible accessibilityRole="image" accessibilityLabel="Recharge company logo" style={{width,height:width*160/940}}><SvgXml xml={xml} width={width} height={width*160/940}/></View>;
}
