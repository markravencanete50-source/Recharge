import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import { Text } from './Typography';
// One motion language for the whole app: quick, calm and without overshoot.
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
  // The light on cards that lift follows the pointer (lib/design-tokens.ts premiumCss): one listener,
  // at most one update a frame, and only for the card under the pointer.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || reduced) return;
    let frame = 0, last: PointerEvent | null = null;
    const update = () => {
      frame = 0;
      const target = last?.target;
      if (!last || !(target instanceof Element)) return;
      const card = target.closest('[data-hover="lift"]');
      if (!(card instanceof HTMLElement)) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', Math.round(last.clientX - box.left) + 'px');
      card.style.setProperty('--my', Math.round(last.clientY - box.top) + 'px');
    };
    const move = (event: PointerEvent) => { last = event; if (!frame) frame = requestAnimationFrame(update); };
    document.addEventListener('pointermove', move, { passive: true });
    return () => { document.removeEventListener('pointermove', move); if (frame) cancelAnimationFrame(frame); };
  }, [reduced]);
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
  const progress = useReveal(sessionKey || instance + trigger, delay, 420);
  return <Animated.View nativeID={nativeID} style={[style,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[14,0]})}]}]}>{children}</Animated.View>;
}
// Runs fn(t) every frame for `duration` ms with t easing from 0 to 1 (expo-out), then stops.
function tween(duration: number, fn: (t: number) => void) {
  const start = Date.now(); let frame = 0;
  const step = () => { const t = Math.min(1, (Date.now() - start) / duration); fn(t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)); if (t < 1) frame = requestAnimationFrame(step); };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
export function CountUp({value, sessionKey, format = (n: number) => String(n), ...props}: ComponentProps<typeof Text> & {value:number;sessionKey:string;format?:(n:number)=>string}) {
  const {reduced,ready,seen} = useContext(Motion);
  const [shown,setShown] = useState(value);
  useEffect(() => {
    if (!ready || reduced || seen.has('count:'+sessionKey)) { queueMicrotask(()=>setShown(value)); return; }
    seen.add('count:'+sessionKey);
    return tween(900, t => setShown(t >= 1 ? value : Math.round(value * t)));
  },[value,sessionKey,reduced,ready,seen]);
  return <Text {...props} accessibilityLabel={format(value)}>{format(shown)}</Text>;
}
const FILLED:string[]=['home','grid','bar-chart-2','check-square','calendar','key','check-circle','message-circle','star'];
export function NavSymbol({name,active,color}: {name:ComponentProps<typeof Feather>['name'];active:boolean;color:string}) {
  const reduced = useReducedMotion(), scale = useState(()=>new Animated.Value(1))[0];
  useEffect(() => { if (!active || reduced) { scale.setValue(1);return; } scale.setValue(0.9); const a=Animated.spring(scale,{toValue:1,speed:20,bounciness:3,useNativeDriver:nativeDriver});a.start();return()=>a.stop(); },[active,reduced,scale]);
  return <Animated.View style={{transform:[{scale}]}}>{active&&FILLED.includes(name)?<Svg width={22} height={22} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {name==='home'?<Path d="M3 10 12 3 21 10V20H15V13H9V20H3Z"/>:name==='grid'?<><Rect x={3} y={3} width={7} height={7} rx={1}/><Rect x={14} y={3} width={7} height={7} rx={1}/><Rect x={3} y={14} width={7} height={7} rx={1}/><Rect x={14} y={14} width={7} height={7} rx={1}/></>:name==='bar-chart-2'?<><Rect x={4} y={12} width={3} height={9} rx={1}/><Rect x={10} y={4} width={3} height={17} rx={1}/><Rect x={16} y={8} width={3} height={13} rx={1}/></>:name==='check-square'?<><Path d="M3 3H15V6H6V18H18V13H21V21H3Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:name==='calendar'?<><Path d="M3 7H21V21H3Z"/><Path d="M7 2V6M17 2V6" fill="none"/></>:name==='key'?<><Circle cx={7.5} cy={15.5} r={5}/><Path d="M11 12 21 2M16 7l3 3M14 9l2 2" fill="none"/></>:name==='check-circle'?<><Path d="M10 3a9 9 0 1 0 11 11h-3a6 6 0 1 1-8-8Z"/><Path d="m10 10 3 3 8-8" fill="none"/></>:name==='star'?<Path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z"/>:<Path d="M3 3H21V16H9L3 21Z"/>}
  </Svg>:<Feather name={name} size={22} color={color}/>}</Animated.View>;
}

// Content that eases in whenever its key changes (tabs, views, steps, selections, messages):
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
  const focus = Platform.OS === 'web' ? { filter: progress.interpolate({ inputRange: [0, 1], outputRange: ['blur(6px)', 'blur(0px)'] }) } : {};
  return <Animated.View style={[style,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[10,0]})},{scale:progress.interpolate({inputRange:[0,1],outputRange:[0.995,1]})}]},focus as object]}>{children}</Animated.View>;
}
// A gentle float for illustrations (empty states, heroes): a slow bob and a hint of tilt.
export function Float({ children, style, distance = 4, duration = 3200, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; distance?: number; duration?: number; delay?: number }) {
  const reduced = useReducedMotion(), drift = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (reduced) { drift.setValue(0); return; }
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration, delay, easing: ease, useNativeDriver: nativeDriver }),
      Animated.timing(drift, { toValue: 0, duration, easing: ease, useNativeDriver: nativeDriver }),
    ]));
    loop.start(); return () => loop.stop();
  }, [drift, reduced, duration, delay]);
  return <Animated.View style={[style, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }, { rotate: drift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-2deg'] }) }] }]}>{children}</Animated.View>;
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
// Items that arrive one after another (lists, cards, form fields). Only the first dozen wait.
export function Stagger({ children, index, style }: { children: ReactNode; index: number; style?: StyleProp<ViewStyle> }) {
  return <Entrance delay={Math.min(index, 12) * motionTokens.stagger} style={style}>{children}</Entrance>;
}
// A number that glides to each new value, for totals that change as people type or tap.
// The first time it appears it counts up from zero; after that it glides between values.
export function TweenNumber({ value, format = (n: number) => String(n), ...props }: ComponentProps<typeof Text> & { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const fromRef = useRef(reduced ? value : 0);
  useEffect(() => {
    if (reduced || fromRef.current === value) { fromRef.current = value; queueMicrotask(() => setShown(value)); return; }
    const begin = fromRef.current, first = begin === 0;
    return tween(first ? 900 : 480, t => { const next = t >= 1 ? value : Math.round(begin + (value - begin) * t); fromRef.current = next; setShown(next); });
  }, [value, reduced]);
  return <Text {...props} accessibilityLabel={format(value)}>{format(shown)}</Text>;
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
// A gentle spring when something becomes selected (pills, tabs, chips).
export function Pop({ children, active, style }: { children: ReactNode; active: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion(), scale = useState(() => new Animated.Value(1))[0];
  useEffect(() => { if (!active || reduced) { scale.setValue(1); return; } scale.setValue(0.96); const a = Animated.spring(scale, { toValue: 1, speed: 18, bounciness: 3, useNativeDriver: nativeDriver }); a.start(); return () => a.stop(); }, [active, reduced, scale]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}
// Shimmering placeholders while content loads, shaped like the rows that are coming.
export function Shimmer({ rows = 3, color, highlight }: { rows?: number; color: string; highlight: string }) {
  const reduced = useReducedMotion(), pulse = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (reduced) { pulse.setValue(0.5); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start(); return () => loop.stop();
  }, [reduced, pulse]);
  const sweep = Platform.OS === 'web' ? { dataSet: { shimmer: '' } } : {};
  return <Animated.View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap: 10, opacity: Platform.OS === 'web' ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }}>
    {Array.from({ length: rows }, (_, i) => (
      <Animated.View key={i} {...sweep} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: color, overflow: 'hidden' }}>
        <Animated.View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: highlight }} />
        <Animated.View style={{ flex: 1, gap: 8 }}>
          <Animated.View style={{ height: 12, width: `${70 - i * 12}%`, borderRadius: 6, backgroundColor: highlight }} />
          <Animated.View style={{ height: 10, width: `${45 - i * 6}%`, borderRadius: 5, backgroundColor: highlight }} />
        </Animated.View>
      </Animated.View>
    ))}
  </Animated.View>;
}
// A small spring whenever a value changes (a badge count going up), so the change is noticed.
export function Bump({ value, children, style, pointerEvents }: { value: string | number; children: ReactNode; style?: StyleProp<ViewStyle>; pointerEvents?: 'none' | 'auto' | 'box-none' }) {
  const reduced = useReducedMotion(), scale = useState(() => new Animated.Value(1))[0];
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced) return;
    scale.setValue(1.28);
    const a = Animated.spring(scale, { toValue: 1, speed: 14, bounciness: 12, useNativeDriver: nativeDriver });
    a.start(); return () => a.stop();
  }, [value, reduced, scale]);
  return <Animated.View pointerEvents={pointerEvents} style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}
// A line that draws itself across from the left when it first appears (page title accents).
export function DrawLine({ width, height = 3, color, sessionKey, style }: { width: number; height?: number; color: string; sessionKey: string; style?: StyleProp<ViewStyle> }) {
  const progress = useReveal('line:' + sessionKey, 120, 700);
  return <Animated.View style={[style, { width, height, borderRadius: height, backgroundColor: color, transformOrigin: 'left', transform: [{ scaleX: progress }] } as object]} />;
}
// A chevron that turns to point the way a section opens or closes.
export function ExpandChevron({ open, color, size = 18 }: { open: boolean; color: string; size?: number }) {
  const reduced = useReducedMotion(), turn = useState(() => new Animated.Value(open ? 1 : 0))[0];
  useEffect(() => {
    if (reduced) { turn.setValue(open ? 1 : 0); return; }
    const a = Animated.spring(turn, { toValue: open ? 1 : 0, speed: 20, bounciness: 4, useNativeDriver: nativeDriver });
    a.start(); return () => a.stop();
  }, [open, reduced, turn]);
  return <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}><Feather name="chevron-down" size={size} color={color} /></Animated.View>;
}
