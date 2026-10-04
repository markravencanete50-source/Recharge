// A small architectural illustration, separate from the 37 functional icons.
export const buildingFaces = {
  roof: 'M16 32 48 14 80 32 48 50Z',
  front: 'M16 32 48 50V92L16 74Z',
  side: 'M48 50 80 32V74L48 92Z',
  windows: 'M24 47 32 51V61L24 57Z M36 54 42 57V67L36 64Z M58 54 65 50V60L58 64Z M69 48 75 45V55L69 58Z',
  door: 'M36 72 43 76V89L36 85Z',
  ground: 'M8 79 47 102 88 79',
};
export function tiltPosition(x:number,y:number,width:number,height:number) {
  const clamp=(value:number)=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
  return {x:clamp((x/Math.max(1,width)-.5)*2),y:clamp((y/Math.max(1,height)-.5)*2)};
}
