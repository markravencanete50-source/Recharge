import { Redirect } from "expo-router";
import { liveApiOrigin } from '../backend/client';
export default function Index() {
  return <Redirect href={liveApiOrigin()?'/live':'/home'} />;
}
