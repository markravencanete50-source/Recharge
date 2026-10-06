import { createContext, useContext, useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import { Text } from './Typography';
export const motionTokens = { ui: 200, reveal: 550, stagger: 55, entrance: Easing.bezier(0.22, 1, 0.36, 1) };
const Motion = createContext({ reduced: true, ready: false, system: false, preference: false, setPreference: (value: boolean) => { void value; }, seen: new Set<string>() });
export function MotionProvider({ children }: {children: ReactNode}) {
  const [system, setSystem] = useState(true), [preference, setPreference] = useState(false), [ready, setReady] = useState(false);
  const seen = useState(()=>new Set<string>())[0];
  useEffect(() => {
    let active = true;
    Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AsyncStorage.getItem('recharge:reduce-motion')]).then(([os, choice]) => {
      if (active) { setSystem(os); setPreference(choice === 'true'); setReady(true); }
    }).catch(() => { if (active) setReady(true); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => { active = false; listener.remove(); };
  }, []);
  const reduced = system || preference;
  useEffect(() => { if (Platform.OS === 'web') document.documentElement.dataset.reduceMotion = String(reduced); }, [reduced]);
  return <Motion.Provider value={{ reduced, ready, system, preference, seen, setPreference: value => { setPreference(value); void AsyncStorage.setItem('recharge:reduce-motion', String(value)).catch(() => {}); } }}>{children}</Motion.Provider>;
}
export const useReducedMotion = () => useContext(Motion).reduced;
export const useMotionPreference = () => useContext(Motion);
export function SlidingPill({x,y=0,width,height,color,visible=true}:{x:number;y?:number;width:number;height:number;color:string;visible?:boolean}) {
  const reduced=useReducedMotion(); const [position]=useState(()=>new Animated.ValueXY({x,y}));
  useEffect(()=>{if(reduced){position.setValue({x,y});return;}const animation=Animated.timing(position,{toValue:{x,y},duration:motionTokens.ui,easing:motionTokens.entrance,useNativeDriver:Platform.OS!=='web'});animation.start();return()=>animation.stop();},[x,y,position,reduced]);
  return <Animated.View pointerEvents="none" style={{position:'absolute',left:0,top:0,width,height,borderRadius:999,backgroundColor:color,opacity:visible?1:0,transform:position.getTranslateTransform()}}/>;
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function MotionPress({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const reduced = useReducedMotion();
  const scale = useState(()=>new Animated.Value(1))[0];
  const [pressed, setPressed] = useState(false);
  useEffect(() => { if (reduced) { scale.stopAnimation(); scale.setValue(1); } return () => scale.stopAnimation(); }, [scale, reduced]);
  return <AnimatedPressable {...props} {...(Platform.OS === 'web' ? { 'aria-checked': props.accessibilityState?.checked, 'aria-selected': props.accessibilityState?.selected, 'aria-disabled': props.accessibilityState?.disabled, 'aria-busy': props.accessibilityState?.busy, 'aria-expanded': props.accessibilityState?.expanded } : {})}
    onPressIn={event => { setPressed(true); if (!reduced) Animated.timing(scale, {toValue:0.97,duration:100,useNativeDriver:Platform.OS !== 'web'}).start(); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); if (reduced) scale.setValue(1); else Animated.spring(scale,{toValue:1,speed:24,bounciness:5,useNativeDriver:Platform.OS !== 'web'}).start(); onPressOut?.(event); }}
    style={[typeof style === 'function' ? style({pressed}) : style, {transform:[{scale}]}]} />;
}
export function useReveal(key: string, delay = 0, duration = motionTokens.ui) {
  const {reduced, ready, seen} = useContext(Motion);
  const progress = useState(()=>new Animated.Value(1))[0];
  useEffect(() => {
    if (!ready) return;
    if (reduced || seen.has(key)) { progress.setValue(1); return; }
    seen.add(key); progress.setValue(0);
    const animation = Animated.timing(progress, {toValue:1,duration,delay:Math.min(delay,220),easing:motionTokens.entrance,useNativeDriver:Platform.OS !== 'web'});
    animation.start(); return () => { animation.stop(); progress.setValue(1); };
  }, [key, delay, duration, progress, ready, reduced, seen]);
  return progress;
}
export function Entrance({ children, style, delay = 0, trigger = '', sessionKey }: {children:ReactNode;style?:StyleProp<ViewStyle>;delay?:number;trigger?:string;sessionKey?:string}) {
  const instance = useState(()=>'entrance-' + Math.random())[0];
  const progress = useReveal(sessionKey || instance + trigger, delay);
  return <Animated.View style={[style,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[8,0]})}]}]}>{children}</Animated.View>;
}
export function CountUp({value, sessionKey, ...props}: ComponentProps<typeof Text> & {value:number;sessionKey:string}) {
  const {reduced,ready,seen} = useContext(Motion);
  const [shown,setShown] = useState(value);
  useEffect(() => {
    if (!ready || reduced || seen.has('count:'+sessionKey)) { queueMicrotask(()=>setShown(value)); return; }
    seen.add('count:'+sessionKey);
    const start = Date.now(); const timer = setInterval(() => { const t = Math.min(1,(Date.now()-start)/motionTokens.reveal); setShown(Math.round(value*(1-Math.pow(1-t,3)))); if(t===1) clearInterval(timer); },32);
    return () => clearInterval(timer);
  },[value,sessionKey,reduced,ready,seen]);
  return <Text {...props} accessibilityLabel={String(value)}>{shown}</Text>;
}
const FILLED:string[]=['home','grid','bar-chart-2','check-square','calendar','key','check-circle','message-circle'];
export function NavSymbol({name,active,color}: {name:ComponentProps<typeof Feather>['name'];active:boolean;color:string}) {
  const reduced = useReducedMotion(), scale = useState(()=>new Animated.Value(1))[0];
  useEffect(() => { if (!active || reduced) { scale.setValue(1);return; } scale.setValue(0.88); const a=Animated.spring(scale,{toValue:1,speed:22,bounciness:6,useNativeDriver:Platform.OS!=='web'});a.start();return()=>a.stop(); },[active,reduced,scale]);
  return <Animated.View style={{transform:[{scale}]}}>{active&&FILLED.includes(name)?<Svg width={22} height={22} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {name==='home'?<Path d="M3 10 12 3 21 10V20H15V13H9V20H3Z"/>:name==='grid'?<><Rect x={3} y={3} width={7} height={7} rx={1}/><Rect x={14} y={3} width={7} height={7} rx={1}/><Rect x={3} y={14} width={7} height={7} rx={1}/><Rect x={14} y={14} width={7} height={7} rx={1}/></>:name==='bar-chart-2'?<><Rect x={4} y={12} width={3} height={9} rx={1}/><Rect x={10} y={4} width={3} height={17} rx={1}/><Rect x={16} y={8} width={3} height={13} rx={1}/></>:name==='check-square'?<><Path d="M3 3H15V6H6V18H18V13H21V21H3Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:name==='calendar'?<><Path d="M3 7H21V21H3Z"/><Path d="M7 2V6M17 2V6" fill="none"/></>:name==='key'?<><Circle cx={7.5} cy={15.5} r={5}/><Path d="M11 12 21 2M16 7l3 3M14 9l2 2" fill="none"/></>:name==='check-circle'?<><Path d="M10 3a9 9 0 1 0 11 11h-3a6 6 0 1 1-8-8Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:<Path d="M3 3H21V16H9L3 21Z"/>}
  </Svg>:<Feather name={name} size={22} color={color}/>}</Animated.View>;
}
