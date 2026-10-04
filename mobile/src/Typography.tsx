import { createContext, useContext } from "react";
import { Text as NativeText, StyleSheet, type TextProps } from "react-native";

export const FontsReady = createContext(false);
export function Text({ style, ...props }: TextProps) {
  const loaded = useContext(FontsReady);
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const font =
    weight === "700" ||
    weight === "800" ||
    weight === "900" ||
    weight === "bold"
      ? "Inter_700Bold"
      : weight === "600"
        ? "Inter_600SemiBold"
        : weight === "500"
          ? "Inter_500Medium"
          : "Inter_400Regular";
  return (
    <NativeText
      {...props}
      style={[
        style,
        loaded ? { fontFamily: font, fontWeight: "normal" } : null,
      ]}
    />
  );
}
