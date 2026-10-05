import type { CSSProperties } from 'react';
import Image from 'next/image';

// The client-supplied image is shared with the native app, without recolouring.
export function CompanyLogo({width=175}:{width?:CSSProperties['width']}) {
  return <span role="img" aria-label="Recharge company logo" style={{display:'inline-block',position:'relative',width,aspectRatio:'1900 / 400',overflow:'hidden',borderRadius:4,background:'#EFE9DB',flexShrink:0}}><Image src="/recharge-company-logo.png" alt="" width={2171} height={724} unoptimized style={{position:'absolute',width:'114.263%',maxWidth:'none',height:'auto',left:'-5.526%',top:'-27.5%',filter:'none',opacity:1}}/></span>;
}
