// Recharge notifications in the browser. It only shows notices sent by the Recharge backend and
// opens the app when one is tapped; it does not cache pages or files.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
// The colour app icon (a notice without a sender picture), and the small icon Android shows in the status bar and at the top
// left of a pop-up: Android keeps only its shape and paints it white, so it is the white mark on a transparent background
// (scripts/generate-notification-icons.py). The colour icon there shows as a plain white square.
const APP_ICON = "/workspace/icon-192.png";
const BADGE = "/workspace/badge-96.png";
// A conversation's pop-up lists its latest messages, newest last, like WhatsApp.
const MAX_LINES = 5;
const safeUrl = url => typeof url === "string" && url.startsWith("/workspace") ? url : "/workspace/live";
const CONVERSATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const oneLine = text => String(text || "").replace(/\s+/g, " ").trim();
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
// Each notice once: the ids seen lately (a pop-up already closed is not shown again for the same message while the worker runs).
const seen = [];
// What to show for a push (data, from lib/web-push.ts pushPayload) given the pop-up of the same conversation already on screen
// (shown: its data, or null). Returns null for a message already shown. Pure, so tests/web-push-sw.test.mjs runs it as is.
//  * A message (it has a thread): one pop-up per conversation, laid out as WhatsApp does. Its title is the sender ("Rebecca"),
//    or, when several people wrote, the conversation with "(3 messages)"; its body starts with the conversation ("Guest ·
//    Bornisketaig", a group's name; none for a one-to-one chat), then the latest messages one per line, newest last (with the
//    sender's first name in front when several people wrote), at the message's own time. A photo the newest message carries is
//    the pop-up's picture (an hour's signed link). Reply and Mark as read below it.
//  * Anything else: its own title and words, replacing the last general notice.
function noticeFor(data, shown, now) {
  const url = safeUrl(data.url);
  // Pop-ups of one conversation share a tag, so the newest replaces the last (and still alerts), like a phone messenger.
  const tag = typeof data.tag === "string" && /^[a-z0-9-]{1,80}$/.test(data.tag) ? data.tag : "recharge";
  const time = Number.isFinite(data.time) && data.time > 0 ? data.time : now;
  const id = typeof data.id === "string" && /^[a-z0-9-]{1,40}$/.test(data.id) ? data.id : null;
  const thread = oneLine(data.thread).slice(0, 120);
  const options = {
    tag, renotify: true, requireInteraction: true, vibrate: [120, 60, 120], timestamp: time, badge: BADGE,
  };
  if (!thread) return { title: data.title || "Recharge", options: { ...options, body: data.body || "There is an update in Recharge.", data: { url, tag, id } } };
  const earlier = shown && shown.tag === tag && Array.isArray(shown.lines) ? shown.lines.filter(l => l && typeof l.text === "string") : [];
  if (id && earlier.some(l => l.id === id)) return null;
  // The message itself (`line`); an older payload has only its body.
  const text = oneLine(typeof data.line === "string" ? data.line : data.body).slice(0, 300) || "New message";
  const who = oneLine(data.who).slice(0, 120), context = oneLine(data.context).slice(0, 120);
  let lines = [...earlier, { id, text, time, who }].sort((a, b) => (a.time || 0) - (b.time || 0));
  let total = (Number(shown && shown.total) || earlier.length) + 1;
  // A team chat says how many messages are unread there: messages read in the app since the last pop-up drop out.
  const count = Number(data.count);
  if (Number.isInteger(count) && count > 0) { lines = lines.slice(-count); total = count; }
  lines = lines.slice(-MAX_LINES);
  total = Math.max(total, lines.length);
  const conversation = typeof data.conversation === "string" && CONVERSATION.test(data.conversation) ? data.conversation : null;
  const guest = typeof data.guest === "string" && CONVERSATION.test(data.guest) ? data.guest : null;
  // One sender: their name on top. Several: the conversation and how many, each line with its sender's first name.
  const senders = new Set(lines.map(l => l.who || "")), single = senders.size === 1 && !senders.has("");
  const title = single ? lines[0].who : total > 1 ? `${thread} (${total > 99 ? "99+" : total} messages)` : thread;
  const said = lines.map(l => !single && senders.size > 1 && l.who ? `${l.who.split(" ")[0]}: ${l.text}` : l.text);
  const image = typeof data.image === "string" && data.image.startsWith("https://") ? data.image : undefined;
  return {
    title,
    options: {
      ...options, body: [context, ...said].filter(Boolean).join("\n"), timestamp: Math.max(...lines.map(l => l.time || 0), time),
      ...(image ? { image } : {}),
      data: { url, tag, id, thread, context, lines, total, conversation, guest },
      actions: [{ action: "reply", title: "Reply" }, { action: "read", title: "Mark as read" }],
    },
  };
}
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  if (!data || typeof data !== "object") data = {};
  const id = typeof data.id === "string" ? data.id : null, again = !!id && seen.includes(id);
  if (id && !again) { seen.push(id); if (seen.length > 200) seen.shift(); }
  const tag = typeof data.tag === "string" && /^[a-z0-9-]{1,80}$/.test(data.tag) ? data.tag : "recharge";
  const picture = typeof data.icon === "string" && data.icon.startsWith("https://") ? Promise.resolve(data.icon) : initialsIcon(data.initials, data.colour);
  // The pop-up of this conversation still on screen, if any, so the new message joins it.
  const current = self.registration.getNotifications ? self.registration.getNotifications({ tag }).catch(() => []) : Promise.resolve([]);
  event.waitUntil(Promise.all([picture, current]).then(([icon, list]) => {
    const last = list.length ? list[list.length - 1] : null;
    const notice = again ? null : noticeFor(data, last && last.data, Date.now());
    // The same message twice: the pop-up on screen stays as it is, without a second alert.
    if (!notice) return last ? self.registration.showNotification(last.title, {
      body: last.body, tag: last.tag, data: last.data, icon: last.icon, badge: last.badge, timestamp: last.timestamp, actions: last.actions, image: last.image,
      requireInteraction: last.requireInteraction, renotify: false, silent: true,
    }).then(() => false) : false;
    // On computers the pop-up stays on screen until it is clicked or closed (Lee, 14 October: make it clearer).
    // A new pop-up with the same tag replaces the last one and alerts again; phones also buzz.
    return self.registration.showNotification(notice.title, { ...notice.options, icon: icon || APP_ICON }).then(() => true);
  }).then(fresh => fresh ? self.clients.matchAll({ type: "window", includeUncontrolled: true }) : []).then(list => {
    // An open Recharge window, even minimized, refreshes straight away and plays its chime.
    for (const client of list) client.postMessage({ type: "recharge-push" });
  }));
});
// Mark as read: the conversation is marked read for the person signed in on this browser (the same call the app makes when it
// opens a conversation, with the browser's own sign-in), and the pop-up goes without opening anything.
function markRead(conversation) {
  if (!conversation) return Promise.resolve();
  return fetch("/api/workspace/chat", {
    method: "POST", credentials: "same-origin", redirect: "manual", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "markRead", conversationId: conversation }),
  }).catch(() => undefined).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(list => {
    for (const client of list) client.postMessage({ type: "recharge-push" });
  });
}
// A guest conversation is read on the device (the guest inbox keeps when each was last opened, in this browser's storage), so
// Mark as read leaves a note here for the app: it is written to this browser's cache storage, which the app reads and clears
// when its guest inbox next opens, and any open Recharge window is told straight away (mobile/src/LiveGuestInbox.tsx).
const GUEST_READ_CACHE = "recharge-guest-read", GUEST_READ_KEY = "/workspace/guest-read";
function markGuestRead(guest, now) {
  if (!guest) return Promise.resolve();
  const at = new Date(now).toISOString();
  const saved = typeof caches === "undefined" ? Promise.resolve() : caches.open(GUEST_READ_CACHE).then(cache => cache.match(GUEST_READ_KEY)
    .then(found => found ? found.json() : {}).catch(() => ({}))
    .then(read => {
      const next = { ...(read && typeof read === "object" && !Array.isArray(read) ? read : {}), [guest]: at };
      const kept = Object.fromEntries(Object.entries(next).filter(([k, v]) => CONVERSATION.test(k) && typeof v === "string").sort((a, b) => b[1].localeCompare(a[1])).slice(0, 200));
      return cache.put(GUEST_READ_KEY, new Response(JSON.stringify(kept), { headers: { "Content-Type": "application/json" } }));
    })).catch(() => undefined);
  return saved.then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(list => {
    for (const client of list) { client.postMessage({ type: "recharge-guest-read", thread: guest, at }); client.postMessage({ type: "recharge-push" }); }
  });
}
// Where a tap goes: the place the pop-up is about (the conversation, for a message). Reply opens it with the message box ready.
function openUrl(data, action) {
  const url = safeUrl(data && data.url);
  return action === "reply" ? url + (url.includes("?") ? "&" : "?") + "reply=1" : url;
}
// A tap opens it in an open Recharge window if there is one, otherwise in a new one.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === "read") { event.waitUntil(data.guest ? markGuestRead(data.guest, Date.now()) : markRead(data.conversation)); return; }
  const url = openUrl(data, event.action);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/workspace"));
    if (!open) return self.clients.openWindow(url);
    open.postMessage({ type: "recharge-open", url });
    return open.focus();
  }));
});
