import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const ReducedMotion = createContext(true);
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return (
    <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>
  );
}
export const useReducedMotion = () => useContext(ReducedMotion);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function MotionPress({
  style,
  onPressIn,
  onPressOut,
  ...props
}: PressableProps) {
  const reduced = useReducedMotion();
  const scale = useState(() => new Animated.Value(1))[0];
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (reduced) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    return () => scale.stopAnimation();
  }, [scale, reduced]);
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        setPressed(true);
        if (!reduced)
          Animated.timing(scale, {
            toValue: 0.975,
            duration: 100,
            useNativeDriver: true,
          }).start();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        if (reduced) scale.setValue(1);
        else
          Animated.spring(scale, {
            toValue: 1,
            speed: 24,
            bounciness: 5,
            useNativeDriver: true,
          }).start();
        onPressOut?.(event);
      }}
      style={[
        typeof style === "function" ? style({ pressed }) : style,
        { transform: [{ scale }] },
      ]}
    />
  );
}
export function Entrance({
  children,
  style,
  delay = 0,
  trigger = "",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  trigger?: string;
}) {
  const reduced = useReducedMotion();
  const progress = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    if (reduced) {
      progress.stopAnimation();
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      delay: Math.min(delay, 210),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, delay, trigger]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
