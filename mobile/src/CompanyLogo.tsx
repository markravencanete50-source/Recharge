import { Image, View } from 'react-native';
import type { Palette } from './theme';
import { brandCanvas, darkBrandCanvas } from '../../lib/design-tokens';

// Display the exact supplied artwork. Clip its generous outer margins in the
// layout rather than redrawing, recolouring or modifying the original file.
export function CompanyLogo({width=144,palette,variant}:{palette:Palette;width?:number;variant?:'light'|'dark'}) {
  // The header is forest in light mode and bone in dark mode, so pick the artwork
  // whose own canvas matches it exactly: the logo then sits flush, with no plate.
  const art=variant??(palette.isDark?'light':'dark');
  const scale=width/1900;
  // Metro requires a static asset reference to bundle the image on iOS/Android.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lightLogo=require('../../public/recharge-company-logo.png');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const darkLogo=require('../../public/recharge-company-logo-dark.png');
  return <View accessible accessibilityRole="image" accessibilityLabel="Recharge company logo" style={{width,height:400*scale,overflow:'hidden',backgroundColor:art==='dark'?darkBrandCanvas:brandCanvas}}><Image accessible={false} source={art==='dark'?darkLogo:lightLogo} resizeMode="contain" style={{position:'absolute',width:(art==='dark'?2172:2171)*scale,height:724*scale,left:-105*scale,top:-110*scale}}/></View>;
}
