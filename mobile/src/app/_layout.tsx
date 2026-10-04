import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { FontsReady } from "../Typography";
export default function Layout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return (
    <FontsReady.Provider value={loaded}>
      <Stack screenOptions={{ headerShown: false, animation: "none" }} />
    </FontsReady.Provider>
  );
}
