import type { CSSProperties } from 'react';
import Image from 'next/image';

// The client-supplied image is shared with the native app, without recolouring.
export function CompanyLogo({width=175,variant='theme'}:{width?:CSSProperties['width'];variant?:'theme'|'light'|'dark'}) {
  const imageStyle:CSSProperties={position:'absolute',width:'114.263%',maxWidth:'none',height:'auto',left:'-5.526%',top:'-27.5%',filter:'none',opacity:1};
  return <span className="recharge-company-logo" data-logo-variant={variant} role="img" aria-label="Recharge company logo" style={{display:'inline-block',position:'relative',width,aspectRatio:'1900 / 400',overflow:'hidden',background:'var(--rc-header, #EFE9DB)',flexShrink:0}}><Image className="recharge-logo-light" src="/recharge-company-logo.png" alt="" width={2171} height={724} unoptimized style={imageStyle}/><Image className="recharge-logo-dark" src="/recharge-company-logo-dark.png" alt="" width={2172} height={724} unoptimized style={imageStyle}/></span>;
}
