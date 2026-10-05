import { Image, View } from 'react-native';
import type { Palette } from './theme';
import { brandCanvas } from '../../lib/design-tokens';

// Display the exact supplied artwork. Clip its generous outer margins in the
// layout rather than redrawing, recolouring or modifying the original file.
export function CompanyLogo({width=144}:{palette:Palette;width?:number}) {
  const scale=width/1900;
  // Metro requires a static asset reference to bundle the image on iOS/Android.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const logo=require('../../public/recharge-company-logo.png');
  return <View accessible accessibilityRole="image" accessibilityLabel="Recharge company logo" style={{width,height:400*scale,overflow:'hidden',backgroundColor:brandCanvas}}><Image accessible={false} source={logo} resizeMode="contain" style={{position:'absolute',width:2171*scale,height:724*scale,left:-105*scale,top:-110*scale}}/></View>;
}
