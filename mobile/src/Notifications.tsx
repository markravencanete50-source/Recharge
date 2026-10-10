import { useCallback, useEffect, useState } from "react";
import { Platform, Switch, View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { message } from "./LiveKit";
import { readNotificationKey, writeNotifications } from "./backend/client";

// Notifications in the browser, on computers and Android phones, and on iPhones where Recharge
// has been added to the Home Screen. The backend sends every in-app notice to the browsers a
// person has switched on.
type State = "unsupported" | "install" | "unavailable" | "off" | "on" | "blocked" | "loading";
const SW = "/workspace/sw.js";
const supported = () => Platform.OS === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
const iosBrowser = () => Platform.OS === "web" && typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone);
const toKey = (key: string) => { const plain = key.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(plain + "=".repeat((4 - plain.length % 4) % 4)), c => c.charCodeAt(0)); };

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/workspace/");
  return registration ? registration.pushManager.getSubscription() : null;
}
async function save(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("This browser did not give a notification address.");
  await writeNotifications({ action: "subscribe", endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}
// Before signing out: this browser stops receiving the person's notices (on a shared computer the next
// person would otherwise see them). The browser permission stays, so whoever signs in next is linked again.
export async function unlinkNotifications() {
  if (!supported()) return;
  const subscription = await currentSubscription().catch(() => null);
  if (subscription) await writeNotifications({ action: "unsubscribe", endpoint: subscription.endpoint }).catch(() => undefined);
}
// When the app opens: a browser that already allowed notifications is kept linked to whoever is signed in now.
export async function refreshNotificationLink() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription().catch(() => null);
  if (subscription) await save(subscription).catch(() => undefined);
}

export function NotificationsSetting({ p }: { p: Palette }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    if (!supported()) { setState(iosBrowser() ? "install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    const key = await readNotificationKey().catch(() => null);
    if (!key) { setState("unavailable"); return; }
    setState(Notification.permission === "granted" && await currentSubscription().catch(() => null) ? "on" : "off");
  }, []);
  useEffect(() => { queueMicrotask(() => void check()); }, [check]);
  async function turnOn() {
    setError(""); setState("loading");
    try {
      const key = await readNotificationKey();
      if (!key) { setState("unavailable"); return; }
      const registration = await navigator.serviceWorker.register(SW, { scope: "/workspace/" });
      await navigator.serviceWorker.ready;
      if (await Notification.requestPermission() !== "granted") { setState(Notification.permission === "denied" ? "blocked" : "off"); return; }
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
      await save(subscription);
      setState("on");
    } catch (e) { setError(message(e)); setState("off"); }
  }
  async function turnOff() {
    setError(""); setState("loading");
    try {
      const subscription = await currentSubscription();
      if (subscription) { await writeNotifications({ action: "unsubscribe", endpoint: subscription.endpoint }).catch(() => undefined); await subscription.unsubscribe(); }
      setState("off");
    } catch (e) { setError(message(e)); void check(); }
  }
  if (Platform.OS !== "web" || state === "unsupported") return null;
  const detail = state === "install" ? "On iPhone and iPad, first add Recharge to your Home Screen: tap Share, then Add to Home Screen. Open it from there and switch this on."
    : state === "blocked" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here."
    : state === "unavailable" ? "Notifications are being set up by the office."
    : state === "on" ? "You'll be told about new jobs, updates and messages on this device, even when Recharge is closed."
    : "Get told about new jobs, updates and messages on this device, even when Recharge is closed.";
  return (
    <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Notifications on this device</Text>
        <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
        {!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{error}</Text>}
      </View>
      <Switch accessibilityLabel="Notifications on this device" disabled={state === "loading" || state === "install" || state === "blocked" || state === "unavailable"} value={state === "on"}
        onValueChange={value => void (value ? turnOn() : turnOff())} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
    </View>
  );
}
