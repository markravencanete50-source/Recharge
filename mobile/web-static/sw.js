// Recharge notifications in the browser. It only shows notices sent by the Recharge backend and
// opens the app when one is tapped; it does not cache pages or files.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const url = typeof data.url === "string" && data.url.startsWith("/workspace") ? data.url : "/workspace/live";
  event.waitUntil(self.registration.showNotification(data.title || "Recharge", {
    body: data.body || "There is an update in Recharge.", icon: "/workspace/icon-192.png", badge: "/workspace/icon-192.png", data: { url },
    // On computers the pop-up stays on screen until it is clicked or closed (Lee, 14 October: make it clearer).
    // One Recharge pop-up at a time: a new notice replaces the last one and alerts again; phones also buzz.
    tag: "recharge", renotify: true, requireInteraction: true, vibrate: [120, 60, 120], timestamp: Date.now(),
  }).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(list => {
    // An open Recharge window, even minimized, refreshes straight away and plays its chime.
    for (const client of list) client.postMessage({ type: "recharge-push" });
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/workspace/live";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/workspace"));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
