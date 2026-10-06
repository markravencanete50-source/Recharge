import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, View } from 'react-native';
import { useReducedMotion } from './motion';
import { tiltPosition } from '../../lib/building-glyph';

export function ParallaxSurface({children}:{children:ReactNode}) {
  const reduced=useReducedMotion(),[position]=useState(()=>new Animated.ValueXY({x:0,y:0}));
  const reset=()=>{position.stopAnimation();Animated.timing(position,{toValue:{x:0,y:0},duration:reduced?0:200,useNativeDriver:false}).start();};
  useEffect(()=>{if(reduced){position.stopAnimation();position.setValue({x:0,y:0});}return()=>position.stopAnimation();},[reduced,position]);
  return <View {...(Platform.OS==='web'?{dataSet:{parallaxSurface:'true'},onPointerLeave:reset,onPointerMove:(event:import('react-native').PointerEvent)=>{
    if(reduced||event.nativeEvent.pointerType!=='mouse'||!matchMedia('(hover:hover) and (pointer:fine)').matches)return;
    const bounds=(event.currentTarget as unknown as HTMLElement).getBoundingClientRect();
    position.setValue(tiltPosition(event.nativeEvent.clientX-bounds.left,event.nativeEvent.clientY-bounds.top,bounds.width,bounds.height));
  }}:{})}><Animated.View style={{transform:Platform.OS==='web'?[{perspective:1000},{rotateX:position.y.interpolate({inputRange:[-1,1],outputRange:['1.5deg','-1.5deg']})},{rotateY:position.x.interpolate({inputRange:[-1,1],outputRange:['-1.5deg','1.5deg']})}]:[]}}>{children}</Animated.View></View>;
}
