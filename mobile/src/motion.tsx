import { createContext, useContext, useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import { Text } from './Typography';
// One motion language for the whole app: quick, calm and without overshoot. Most decoration is
// now still: entrances and swaps only fade, numbers appear at once, and nothing loops or springs.
// fast: presses and toggles. ui: small changes. page: tabs, views and sheets. reveal: charts and
// progress. entrance eases out (things arrive), exit eases in (things leave).
export const motionTokens = {
  fast: 140, ui: 200, page: 240, reveal: 520, stagger: 40,
  entrance: Easing.bezier(0.22, 1, 0.36, 1), standard: Easing.bezier(0.2, 0, 0, 1), exit: Easing.bezier(0.4, 0, 1, 1),
};
const nativeDriver = Platform.OS !== 'web';
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
  useEffect(()=>{if(reduced){position.setValue({x,y});return;}const animation=Animated.timing(position,{toValue:{x,y},duration:motionTokens.page,easing:motionTokens.entrance,useNativeDriver:nativeDriver});animation.start();return()=>animation.stop();},[x,y,position,reduced]);
  return <Animated.View pointerEvents="none" style={{position:'absolute',left:0,top:0,width,height,borderRadius:999,backgroundColor:color,opacity:visible?1:0,transform:position.getTranslateTransform()}}/>;
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function MotionPress({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const reduced = useReducedMotion();
  const scale = useState(()=>new Animated.Value(1))[0];
  const [pressed, setPressed] = useState(false);
  useEffect(() => { if (reduced) { scale.stopAnimation(); scale.setValue(1); } return () => scale.stopAnimation(); }, [scale, reduced]);
  return <AnimatedPressable {...props} {...(Platform.OS === 'web' ? { 'aria-checked': props.accessibilityState?.checked, 'aria-selected': props.accessibilityState?.selected, 'aria-disabled': props.accessibilityState?.disabled, 'aria-busy': props.accessibilityState?.busy, 'aria-expanded': props.accessibilityState?.expanded } : {})}
    onPressIn={event => { setPressed(true); if (!reduced) Animated.timing(scale, {toValue:0.975,duration:90,easing:motionTokens.standard,useNativeDriver:nativeDriver}).start(); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); if (reduced) scale.setValue(1); else Animated.timing(scale,{toValue:1,duration:180,easing:motionTokens.entrance,useNativeDriver:nativeDriver}).start(); onPressOut?.(event); }}
    style={[typeof style === 'function' ? style({pressed}) : style, {transform:[{scale}]}]} />;
}
export function useReveal(key: string, delay = 0, duration = motionTokens.page) {
  const {reduced, ready, seen} = useContext(Motion);
  const progress = useState(()=>new Animated.Value(1))[0];
  useEffect(() => {
    if (!ready) return;
    if (reduced || seen.has(key)) { progress.setValue(1); return; }
    seen.add(key); progress.setValue(0);
    const animation = Animated.timing(progress, {toValue:1,duration,delay:Math.min(delay,240),easing:motionTokens.entrance,useNativeDriver:nativeDriver});
    animation.start(); return () => { animation.stop(); progress.setValue(1); };
  }, [key, delay, duration, progress, ready, reduced, seen]);
  return progress;
}
export function Entrance({ children, style, delay = 0, trigger = '', sessionKey, nativeID }: {children:ReactNode;style?:StyleProp<ViewStyle>;delay?:number;trigger?:string;sessionKey?:string;nativeID?:string}) {
  const instance = useState(()=>'entrance-' + Math.random())[0];
  const progress = useReveal(sessionKey || instance + trigger, delay, motionTokens.ui);
  return <Animated.View nativeID={nativeID} style={[style,{opacity:progress}]}>{children}</Animated.View>;
}
// Numbers appear at once: no counting up. `sessionKey` is kept so callers stay as they were.
export function CountUp({value, sessionKey, format = (n: number) => String(n), ...props}: ComponentProps<typeof Text> & {value:number;sessionKey:string;format?:(n:number)=>string}) {
  void sessionKey;
  return <Text {...props} accessibilityLabel={format(value)}>{format(value)}</Text>;
}
const FILLED:string[]=['home','grid','bar-chart-2','check-square','calendar','key','check-circle','message-circle','star'];
export function NavSymbol({name,active,color}: {name:ComponentProps<typeof Feather>['name'];active:boolean;color:string}) {
  const reduced = useReducedMotion(), scale = useState(()=>new Animated.Value(1))[0];
  useEffect(() => { if (!active || reduced) { scale.setValue(1);return; } scale.setValue(0.94); const a=Animated.timing(scale,{toValue:1,duration:motionTokens.ui,easing:motionTokens.entrance,useNativeDriver:nativeDriver});a.start();return()=>a.stop(); },[active,reduced,scale]);
  return <Animated.View style={{transform:[{scale}]}}>{active&&FILLED.includes(name)?<Svg width={22} height={22} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {name==='home'?<Path d="M3 10 12 3 21 10V20H15V13H9V20H3Z"/>:name==='grid'?<><Rect x={3} y={3} width={7} height={7} rx={1}/><Rect x={14} y={3} width={7} height={7} rx={1}/><Rect x={3} y={14} width={7} height={7} rx={1}/><Rect x={14} y={14} width={7} height={7} rx={1}/></>:name==='bar-chart-2'?<><Rect x={4} y={12} width={3} height={9} rx={1}/><Rect x={10} y={4} width={3} height={17} rx={1}/><Rect x={16} y={8} width={3} height={13} rx={1}/></>:name==='check-square'?<><Path d="M3 3H15V6H6V18H18V13H21V21H3Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:name==='calendar'?<><Path d="M3 7H21V21H3Z"/><Path d="M7 2V6M17 2V6" fill="none"/></>:name==='key'?<><Circle cx={7.5} cy={15.5} r={5}/><Path d="M11 12 21 2M16 7l3 3M14 9l2 2" fill="none"/></>:name==='check-circle'?<><Path d="M10 3a9 9 0 1 0 11 11h-3a6 6 0 1 1-8-8Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:name==='star'?<Path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z"/>:<Path d="M3 3H21V16H9L3 21Z"/>}
  </Svg>:<Feather name={name} size={22} color={color}/>}</Animated.View>;
}

// Content that fades in whenever its key changes (tabs, views, steps, selections, messages):
// every time, not only the first, so switching back and forth always feels the same.
export function SwapIn({ children, swapKey, style }: { children: ReactNode; swapKey: string; style?: StyleProp<ViewStyle> }) {
  const {reduced, ready} = useContext(Motion);
  const progress = useState(()=>new Animated.Value(1))[0];
  useEffect(() => {
    if (!ready || reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, {toValue:1,duration:motionTokens.page,easing:motionTokens.entrance,useNativeDriver:nativeDriver});
    animation.start(); return () => { animation.stop(); progress.setValue(1); };
  }, [swapKey, progress, ready, reduced]);
  return <Animated.View style={[style,{opacity:progress}]}>{children}</Animated.View>;
}
// Illustrations used to bob; they now stay still. The props are kept so callers stay as they were.
export function Float({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle>; distance?: number; duration?: number; delay?: number }) {
  return <View style={style}>{children}</View>;
}
// Mount and unmount with an animation both ways, for panels and overlays: `shown` stays true
// until the exit has finished, and `progress` runs 0 → 1 on the way in and back on the way out.
export function usePresence(visible: boolean, enter: number = motionTokens.page, exit: number = motionTokens.ui - 20) {
  const reduced = useReducedMotion();
  const progress = useState(()=>new Animated.Value(visible ? 1 : 0))[0];
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) {
      queueMicrotask(() => setShown(true));
      if (reduced) { progress.setValue(1); return; }
      const animation = Animated.timing(progress, {toValue:1,duration:enter,easing:motionTokens.entrance,useNativeDriver:nativeDriver});
      animation.start(); return () => animation.stop();
    }
    if (reduced) { progress.setValue(0); queueMicrotask(() => setShown(false)); return; }
    const animation = Animated.timing(progress, {toValue:0,duration:exit,easing:motionTokens.exit,useNativeDriver:nativeDriver});
    animation.start(({finished}) => { if (finished) setShown(false); });
    return () => animation.stop();
  }, [visible, reduced, progress, enter, exit]);
  return { shown: shown || visible, progress };
}
// Items used to arrive one after another; they now share one short fade with no wait.
export function Stagger({ children, index, style }: { children: ReactNode; index: number; style?: StyleProp<ViewStyle> }) {
  void index;
  return <Entrance style={style}>{children}</Entrance>;
}
// A total that changes as people type or tap. It shows each new value at once.
export function TweenNumber({ value, format = (n: number) => String(n), ...props }: ComponentProps<typeof Text> & { value: number; format?: (n: number) => string }) {
  return <Text {...props} accessibilityLabel={format(value)}>{format(value)}</Text>;
}
// A bar that grows to its share (0 to 1), and moves smoothly when the share changes.
export function GrowBar({ share, color, track, height = 10 }: { share: number; color: string; track: string; height?: number }) {
  const reduced = useReducedMotion();
  const [width] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const target = Math.max(0, Math.min(1, share));
    if (reduced) { width.setValue(target); return; }
    const animation = Animated.timing(width, { toValue: target, duration: motionTokens.reveal, easing: motionTokens.entrance, useNativeDriver: false });
    animation.start(); return () => animation.stop();
  }, [share, reduced, width]);
  return <Animated.View style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
    <Animated.View style={{ height, borderRadius: height / 2, backgroundColor: color, width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
  </Animated.View>;
}
// Selected pills, tabs and chips used to spring; they now change at once. `active` is kept for callers.
export function Pop({ children, style }: { children: ReactNode; active: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}
// Placeholders while content loads, shaped like the rows that are coming. Static: a fixed soft opacity, no loop,
// so there is nothing to reduce when motion is reduced.
export function Shimmer({ rows = 3, color, highlight }: { rows?: number; color: string; highlight: string }) {
  return <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap: 10, opacity: 0.6 }}>
    {Array.from({ length: rows }, (_, i) => (
      <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: color, overflow: 'hidden' }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: highlight }} />
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ height: 12, width: `${70 - i * 12}%`, borderRadius: 6, backgroundColor: highlight }} />
          <View style={{ height: 10, width: `${45 - i * 6}%`, borderRadius: 5, backgroundColor: highlight }} />
        </View>
      </View>
    ))}
  </View>;
}
// A badge count used to spring when it changed; it now just shows the new value.
export function Bump({ children, style, pointerEvents }: { value: string | number; children: ReactNode; style?: StyleProp<ViewStyle>; pointerEvents?: 'none' | 'auto' | 'box-none' }) {
  return <View pointerEvents={pointerEvents} style={style}>{children}</View>;
}
// A page title accent line. It used to draw itself across; it now simply sits there.
export function DrawLine({ width, height = 3, color, style }: { width: number; height?: number; color: string; sessionKey: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[style, { width, height, borderRadius: height, backgroundColor: color }]} />;
}
// A chevron that turns to point the way a section opens or closes.
export function ExpandChevron({ open, color, size = 18 }: { open: boolean; color: string; size?: number }) {
  const reduced = useReducedMotion(), turn = useState(() => new Animated.Value(open ? 1 : 0))[0];
  useEffect(() => {
    if (reduced) { turn.setValue(open ? 1 : 0); return; }
    const a = Animated.timing(turn, { toValue: open ? 1 : 0, duration: motionTokens.ui, easing: motionTokens.standard, useNativeDriver: nativeDriver });
    a.start(); return () => a.stop();
  }, [open, reduced, turn]);
  return <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}><Feather name="chevron-down" size={size} color={color} /></Animated.View>;
}
