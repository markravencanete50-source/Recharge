import { Image, View } from 'react-native';
import type { Palette } from './theme';
import { darkBrandCanvas } from '../../lib/design-tokens';

// Display the exact supplied artwork. Clip its generous outer margins in the
// layout rather than redrawing, recolouring or modifying the original file.
export function CompanyLogo({width:requested=144,palette,variant='dark'}:{palette:Palette;width?:number;variant?:'light'|'dark'}) {
  // The artwork carries its own canvas colour. On the dark-mode night bar it sits
  // on a small plate of that canvas so the file itself is never altered.
  const plate=variant==='dark'&&palette.isDark;
  const width=plate?requested-20:requested;
  const scale=width/1900;
  // Metro requires a static asset reference to bundle the image on iOS/Android.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lightLogo=require('../../public/recharge-company-logo.png');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const darkLogo=require('../../public/recharge-company-logo-dark.png');
  const logo=<View accessible={!plate} accessibilityRole={plate?undefined:'image'} accessibilityLabel={plate?undefined:'Recharge company logo'} style={{width,height:400*scale,overflow:'hidden',backgroundColor:variant==='dark'?darkBrandCanvas:palette.header}}><Image accessible={false} source={variant==='dark'?darkLogo:lightLogo} resizeMode="contain" style={{position:'absolute',width:(variant==='dark'?2172:2171)*scale,height:724*scale,left:-105*scale,top:-110*scale}}/></View>;
  if(!plate)return logo;
  return <View accessible accessibilityRole="image" accessibilityLabel="Recharge company logo" style={{paddingVertical:7,paddingHorizontal:10,borderRadius:12,backgroundColor:darkBrandCanvas,borderWidth:1,borderColor:palette.headerBorder}}>{logo}</View>;
}
