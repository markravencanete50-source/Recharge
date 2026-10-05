import { Image, View } from 'react-native';
import type { Palette } from './theme';

// Display the exact supplied artwork. Clip its generous outer margins in the
// layout rather than redrawing, recolouring or modifying the original file.
export function CompanyLogo({width=144,palette,variant=palette.isDark?'dark':'light'}:{palette:Palette;width?:number;variant?:'light'|'dark'}) {
  const scale=width/1900;
  // Metro requires a static asset reference to bundle the image on iOS/Android.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lightLogo=require('../../public/recharge-company-logo.png');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const darkLogo=require('../../public/recharge-company-logo-dark.png');
  return <View accessible accessibilityRole="image" accessibilityLabel="Recharge company logo" style={{width,height:400*scale,overflow:'hidden',backgroundColor:palette.header}}><Image accessible={false} source={variant==='dark'?darkLogo:lightLogo} resizeMode="contain" style={{position:'absolute',width:(variant==='dark'?2172:2171)*scale,height:724*scale,left:-105*scale,top:-110*scale}}/></View>;
}
