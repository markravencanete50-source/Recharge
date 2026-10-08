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
