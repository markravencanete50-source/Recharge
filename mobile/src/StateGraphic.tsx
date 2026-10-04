import { useEffect, useState, type ComponentProps } from "react";
import { Animated, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { useReducedMotion } from "./motion";
import { Text } from "./Typography";
import type { Palette } from "./theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
export function ProgressRing({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const share = total ? completed / total : 0;
  useEffect(() => {
    progress.stopAnimation();
    if (reduced) {
      progress.setValue(share);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: share,
      duration: 420,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, share, reduced]);
  return (
    <View
      accessible
      accessibilityLabel={
        total
          ? `${completed} of ${total} work items complete`
          : "No recorded items in this view"
      }
      style={{
        width: 88,
        height: 88,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={88}
        height={88}
        viewBox="0 0 88 88"
        style={{ position: "absolute" }}
      >
        <Circle
          cx="44"
          cy="44"
          r="35"
          fill="none"
          stroke="#6682e0"
          strokeWidth="6"
        />
        <AnimatedCircle
          cx="44"
          cy="44"
          r="35"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="220"
          strokeDashoffset={progress.interpolate({
            inputRange: [0, 1],
            outputRange: [220, 0],
          })}
          rotation="-90"
          origin="44,44"
        />
      </Svg>
      <Text
        style={{
          fontSize: total ? 22 : 14,
          textAlign: "center",
          fontWeight: "600",
          color: "#ffffff",
          letterSpacing: -0.7,
        }}
      >
        {total ? `${Math.round(share * 100)}%` : "No items"}
      </Text>
    </View>
  );
}
export function StateGraphic({
  palette: p,
  success = false,
  icon = "search",
}: {
  palette: Palette;
  success?: boolean;
  icon?: ComponentProps<typeof Feather>["name"];
}) {
  const reduced = useReducedMotion();
  const [draw] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || !success) {
      draw.setValue(1);
      return;
    }
    draw.setValue(0);
    const animation = Animated.timing(draw, {
      toValue: 1,
      duration: 280,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [draw, reduced, success]);
  return (
    <View
      accessible={false}
      style={{
        width: 108,
        height: 90,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={108}
        height={90}
        viewBox="0 0 108 90"
        style={{ position: "absolute" }}
      >
        <Rect
          x="13"
          y="18"
          width="50"
          height="58"
          rx="10"
          fill={p.elevated}
          transform="rotate(-8 38 47)"
        />
        <Rect
          x="35"
          y="11"
          width="56"
          height="63"
          rx="12"
          fill={p.surface}
          stroke={p.border}
          strokeWidth="1.5"
        />
        <Path
          d="M47 24H77M47 31H66"
          stroke={p.primary}
          strokeOpacity="0.4"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Circle
          cx="70"
          cy="58"
          r="22"
          fill={success ? p.successWash : p.wash}
          stroke={p.surface}
          strokeWidth="4"
        />
        {success ? (
          <AnimatedPath
            d="M60 58l7 7 13-15"
            fill="none"
            stroke={p.success}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="32"
            strokeDashoffset={draw.interpolate({
              inputRange: [0, 1],
              outputRange: [32, 0],
            })}
          />
        ) : null}
        <Circle cx="13" cy="11" r="3" fill={p.primary} opacity="0.25" />
        <Circle cx="97" cy="79" r="3" fill={p.primary} opacity="0.25" />
      </Svg>
      {!success ? (
        <View style={{ position: "absolute", left: 59, top: 47 }}>
          <Feather name={icon} size={22} color={p.primary} />
        </View>
      ) : null}
    </View>
  );
}
