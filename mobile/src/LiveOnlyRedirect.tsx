import { Redirect } from "expo-router";

// In the live web build the sample-data preview (App.tsx) is left out, so its pages open the live app.
export default function LiveOnlyRedirect() {
  return <Redirect href="/live" />;
}
