import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { message } from "./LiveKit";
import { readNotificationStatus, testNotification, writeNotifications, type PushDevice } from "./backend/client";

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
function address(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("This browser did not give a notification address.");
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}
const save = async (subscription: PushSubscription) => { await writeNotifications({ action: "subscribe", ...address(subscription) }); };
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

// The switch's state and its two actions, shared by the setting and the reminder on the page.
function useNotificationSwitch() {
  const [state, setState] = useState<State>("loading");
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    if (!supported()) { setState(iosBrowser() ? "install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    const status = await readNotificationStatus().catch(() => null);
    if (!status?.publicKey) { setState("unavailable"); return; }
    setDevices(status.devices ?? null);
    setState(Notification.permission === "granted" && await currentSubscription().catch(() => null) ? "on" : "off");
  }, []);
  useEffect(() => { queueMicrotask(() => void check()); }, [check]);
  async function turnOn() {
    setError(""); setState("loading");
    try {
      const status = await readNotificationStatus();
      if (!status.publicKey) { setState("unavailable"); return; }
      const registration = await navigator.serviceWorker.register(SW, { scope: "/workspace/" });
      await navigator.serviceWorker.ready;
      if (await Notification.requestPermission() !== "granted") { setState(Notification.permission === "denied" ? "blocked" : "off"); return; }
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(status.publicKey) });
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
  return { state, devices, error, check, turnOn, turnOff };
}

// What the push service said to a test, in plain words.
export function testAnswer(result: { outcome: "sent" | "gone" | "failed"; status: number }) {
  if (result.outcome === "sent") return "Sent. A pop-up should appear in a few seconds. If it doesn't, this computer or phone is hiding notifications from your browser: check Do not disturb or Focus, and allow notifications for the browser in the device's settings.";
  if (result.outcome === "gone") return "This browser no longer accepts notifications from Recharge. Switch notifications off and on again here.";
  return result.status ? `The notification service refused it (code ${result.status}). Tell the office this code so they can fix it.` : "The notification service could not be reached. Try again in a minute.";
}
const deviceLine = (d: PushDevice) => [d.endpointHost?.includes("apple") ? "iPhone or Mac" : d.endpointHost?.includes("mozilla") ? "Firefox" : d.endpointHost?.includes("windows") ? "Windows" : "Chrome, Edge or Android",
  `${d.sent} delivered`, ...(d.failed ? [`${d.failed} not delivered${d.lastStatus && d.lastStatus >= 300 ? ` (code ${d.lastStatus})` : ""}`] : [])].join(" · ");

// Sound for new updates while Recharge is open (a soft chime). Kept on this device; on by default.
const SOUND_KEY = "rc-sound";
export const soundOn = () => { try { return globalThis.localStorage?.getItem(SOUND_KEY) !== "off"; } catch { return true; } };
const setSound = (on: boolean) => { try { globalThis.localStorage?.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* storage unavailable */ } };
let audio: AudioContext | null = null;
// Browsers only allow sound after someone has tapped or typed on the page, so the chime is readied then.
export function readyChime() {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => undefined;
  const ready = () => {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", ready); window.addEventListener("keydown", ready);
  return () => { window.removeEventListener("pointerdown", ready); window.removeEventListener("keydown", ready); };
}
let lastChime = 0;
export function playChime(force = false) {
  if (!audio || audio.state !== "running" || (!force && (!soundOn() || Date.now() - lastChime < 5000))) return;
  lastChime = Date.now();
  // Three clear rising notes (C, E, G), loud enough to hear across a room (Lee, 14 October: "too low").
  // Each note is a tone and its octave, through a compressor so it stays loud without distorting.
  const out = audio.createDynamicsCompressor();
  out.threshold.value = -18; out.knee.value = 6; out.ratio.value = 6;
  out.connect(audio.destination);
  [[1046.5, 0], [1318.5, 0.17], [1568, 0.34]].forEach(([freq, at]) => {
    const start = audio!.currentTime + at;
    for (const [type, mult, peak] of [["triangle", 1, 0.85], ["sine", 2, 0.3]] as const) {
      const osc = audio!.createOscillator(), gain = audio!.createGain();
      osc.type = type; osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(peak, start + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(gain).connect(out); osc.start(start); osc.stop(start + 0.65);
    }
  });
}

const rowStyle = [ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }];
export function NotificationsSetting({ p }: { p: Palette }) {
  const { state, devices, error, check, turnOn, turnOff } = useNotificationSwitch();
  const [testing, setTesting] = useState(false), [answer, setAnswer] = useState("");
  const [sound, setSoundState] = useState(soundOn);
  async function test() {
    setTesting(true); setAnswer("");
    try {
      const subscription = await currentSubscription();
      if (!subscription) { setAnswer("Switch notifications on first."); return; }
      setAnswer(testAnswer(await testNotification(address(subscription))));
      void check();
    } catch (e) { setAnswer(message(e)); } finally { setTesting(false); }
  }
  if (Platform.OS !== "web") return null;
  const detail = state === "install" ? "On iPhone and iPad, first add Recharge to your Home Screen: tap Share, then Add to Home Screen. Open it from there and switch this on."
    : state === "blocked" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here."
    : state === "unavailable" ? "Notifications are being set up by the office."
    : state === "on" ? "You'll be told about new jobs, updates and messages on this device, even when Recharge is closed."
    : "Get told about new jobs, updates and messages on this device, even when Recharge is closed.";
  return (
    <View>
      {state !== "unsupported" && <View style={rowStyle}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Notifications on this device</Text>
          <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
          {state === "on" && !!devices?.length && devices.map((d, i) => <Text key={i} style={[ui.small, { color: d.failed && !d.sent ? p.danger : p.muted }]}>{deviceLine(d)}</Text>)}
          {state === "on" && <Pressable accessibilityRole="button" disabled={testing} onPress={() => void test()} style={{ minHeight: 36, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>{testing ? "Sending…" : "Send a test notification"}</Text>
          </Pressable>}
          {!!answer && <Text accessibilityRole="alert" style={[ui.small, { color: p.text }]}>{answer}</Text>}
          {!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{error}</Text>}
        </View>
        <Switch accessibilityLabel="Notifications on this device" disabled={state === "loading" || state === "install" || state === "blocked" || state === "unavailable"} value={state === "on"}
          onValueChange={value => void (value ? turnOn() : turnOff())} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
      </View>}
      {state !== "unsupported" && <View style={{ height: 1, backgroundColor: p.border, marginLeft: 16 }} />}
      <View style={rowStyle}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Sound for new updates</Text>
          <Text style={[ui.small, { color: p.muted }]}>A chime when a new update or message arrives while Recharge is open, also when it is minimized or behind other windows.</Text>
        </View>
        <Switch accessibilityLabel="Sound for new updates" value={sound} onValueChange={value => { setSound(value); setSoundState(value); if (value) playChime(true); }} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
      </View>
    </View>
  );
}

// A reminder at the top of the page for the team, until notifications are on (or "Not now", for a week).
const PROMPT_KEY = "rc-notify-prompt";
const promptHidden = () => { try { return Date.now() - Number(globalThis.localStorage?.getItem(PROMPT_KEY) ?? 0) < 7 * 86400000; } catch { return false; } };
export function NotificationsPrompt({ p }: { p: Palette }) {
  const { state, error, turnOn } = useNotificationSwitch();
  const [hidden, setHidden] = useState(promptHidden);
  if (Platform.OS !== "web" || hidden || !(state === "off" || state === "install" || state === "blocked")) return null;
  const later = () => { try { globalThis.localStorage?.setItem(PROMPT_KEY, String(Date.now())); } catch { /* storage unavailable */ } setHidden(true); };
  const text = state === "install" ? "To get notifications on iPhone or iPad, add Recharge to your Home Screen: tap Share, then Add to Home Screen. Open it from there and switch notifications on in your profile."
    : state === "blocked" ? "Notifications are blocked for Recharge in this browser, so you won't hear about new jobs or messages. Allow them in the browser's site settings (the icon left of the address)."
    : "Turn on notifications to hear about new jobs, updates and messages, even when Recharge is closed.";
  return (
    <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderLeftWidth: 3, borderLeftColor: p.primary, flexWrap: "wrap" }]}>
      <Feather name="bell" size={16} color={p.primary} />
      <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
        <Text style={[ui.small, { color: p.text }]}>{text}</Text>
        {!!error && <Text style={[ui.small, { color: p.danger }]}>{error}</Text>}
      </View>
      {state === "off" && <Pressable accessibilityRole="button" onPress={() => void turnOn()} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: p.primary, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.onPrimary, fontWeight: "700" }]}>Turn on</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" onPress={later} style={{ minHeight: 36, paddingHorizontal: 8, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Not now</Text>
      </Pressable>
    </View>
  );
}
