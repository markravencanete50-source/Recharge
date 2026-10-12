import { createContext, useContext } from "react";
import { Text as NativeText, StyleSheet, type TextProps } from "react-native";

export const FontsReady = createContext(false);
export function Text({ style, ...props }: TextProps) {
  const loaded = useContext(FontsReady);
  const weight = StyleSheet.flatten(style)?.fontWeight;
  // One table for phone and web, one step lighter than the weight asked for: the heaviest face
  // is SemiBold, so no text reads as thick.
  const font =
    weight === "700" ||
    weight === "800" ||
    weight === "900" ||
    weight === "bold"
      ? "Montserrat_600SemiBold"
      : weight === "600" || weight === "500"
        ? "Montserrat_500Medium"
        : "Montserrat_400Regular";
  return (
    <NativeText
      {...props}
      style={[
        { fontVariant: ["tabular-nums"] },
        style,
        loaded ? { fontFamily: font, fontWeight: "normal" } : null,
      ]}
    />
  );
}
