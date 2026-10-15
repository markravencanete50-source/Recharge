// Recharge notifications in the browser. It only shows notices sent by the Recharge backend and
// opens the app when one is tapped; it does not cache pages or files.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
const APP_ICON = "/workspace/icon-192.png";
const safeUrl = url => typeof url === "string" && url.startsWith("/workspace") ? url : "/workspace/live";
// The sender's initials on their colour, drawn here when they have no photo (Android and desktop Chrome show it; an iPhone always
// shows the app's icon). Anything unusual falls back to the app's icon.
async function initialsIcon(initials, colour) {
  if (typeof OffscreenCanvas === "undefined" || typeof FileReader === "undefined" || !/^[^\s<>&]{1,4}$/u.test(initials || "") || !/^#[0-9A-Fa-f]{6}$/.test(colour || "")) return null;
  try {
    const canvas = new OffscreenCanvas(192, 192), g = canvas.getContext("2d");
    g.fillStyle = colour; g.beginPath(); g.arc(96, 96, 96, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#FFFFFF"; g.font = "600 76px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(initials, 96, 100);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(typeof r.result === "string" ? r.result : null); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  } catch { return null; }
}
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const url = safeUrl(data.url);
  // Pop-ups of one conversation share a tag, so the newest replaces the last (and still alerts), like a phone messenger.
  const tag = typeof data.tag === "string" && /^[a-z0-9-]{1,80}$/.test(data.tag) ? data.tag : "recharge";
  const picture = typeof data.icon === "string" && data.icon.startsWith("https://") ? Promise.resolve(data.icon) : initialsIcon(data.initials, data.colour);
  event.waitUntil(picture.then(icon => self.registration.showNotification(data.title || "Recharge", {
    body: data.body || "There is an update in Recharge.", icon: icon || APP_ICON, badge: APP_ICON, data: { url },
    // On computers the pop-up stays on screen until it is clicked or closed (Lee, 14 October: make it clearer).
    // A new pop-up with the same tag replaces the last one and alerts again; phones also buzz.
    tag, renotify: true, requireInteraction: true, vibrate: [120, 60, 120], timestamp: Date.now(),
  })).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(list => {
    // An open Recharge window, even minimized, refreshes straight away and plays its chime.
    for (const client of list) client.postMessage({ type: "recharge-push" });
  }));
});
// A tap opens the place the pop-up is about (the conversation, for a message): in an open Recharge window if there is one,
// otherwise in a new one.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/workspace"));
    if (!open) return self.clients.openWindow(url);
    open.postMessage({ type: "recharge-open", url });
    return open.focus();
  }));
});
