import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { FontsReady } from "../Typography";
export default function Layout() {
  // Montserrat cut down to the Latin characters the app uses (about 40 KB a weight instead of 330 KB).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const [loaded] = useFonts({
    Montserrat_400Regular: require("../../assets/fonts/Montserrat_400Regular.ttf"),
    Montserrat_500Medium: require("../../assets/fonts/Montserrat_500Medium.ttf"),
    Montserrat_600SemiBold: require("../../assets/fonts/Montserrat_600SemiBold.ttf"),
  });
  /* eslint-enable @typescript-eslint/no-require-imports */
  return (
    <FontsReady.Provider value={loaded}>
      <Stack screenOptions={{ headerShown: false, animation: "none" }} />
    </FontsReady.Provider>
  );
}
