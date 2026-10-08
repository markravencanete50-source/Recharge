import { useEffect, useState, type ComponentProps } from "react";
import { Animated, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import Feather from "@expo/vector-icons/Feather";
import { useReducedMotion } from "./motion";
import type { Palette } from "./theme";

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
      useNativeDriver: true,
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
      {/* Fill the 108x90 box: an unsized wrapper anchored the drawing at the
          centre, pushing it into neighbouring text. */}
      <Animated.View style={{position:"absolute",left:0,top:0,width:108,height:90,opacity:draw,transform:[{scale:draw.interpolate({inputRange:[0,1],outputRange:[0.97,1]})}]}}><Svg
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
          <Path
            d="M60 58l7 7 13-15"
            fill="none"
            stroke={p.success}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        <Circle cx="13" cy="11" r="3" fill={p.primary} opacity="0.25" />
        <Circle cx="97" cy="79" r="3" fill={p.primary} opacity="0.25" />
      </Svg></Animated.View>
      {!success ? (
        <View style={{ position: "absolute", left: 59, top: 47 }}>
          <Feather name={icon} size={22} color={p.primary} />
        </View>
      ) : null}
    </View>
  );
}
