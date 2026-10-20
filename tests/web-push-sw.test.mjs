import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// The browser's side of a pop-up (mobile/web-static/sw.js), run as the phone runs it: like WhatsApp, one pop-up per conversation
// listing its latest messages, Reply and Mark as read under it, the message's own time, and never the same message twice.
const source = await fs.readFile('mobile/web-static/sw.js', 'utf8');
const CONV = '5a1e0000-0000-4000-8000-000000000001';
// Objects made inside the worker's own realm, compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

// A pretend phone: the notifications on screen (one per tag, as the browser keeps them), the open windows, and what was fetched.
function phone({ windows = [] } = {}) {
  const handlers = {}, screen = new Map(), shown = [], fetched = [], opened = [], messages = [];
  const registration = {
    showNotification: async (title, options) => { const n = { title, ...options, close: () => screen.delete(options.tag) }; screen.set(options.tag, n); shown.push(n); },
    getNotifications: async ({ tag }) => screen.has(tag) ? [screen.get(tag)] : [],
  };
  const clients = {
    matchAll: async () => windows.map(w => ({ ...w, postMessage: m => messages.push(m), focus: async () => { w.focused = true; } })),
    openWindow: async url => { opened.push(url); }, claim: async () => undefined,
  };
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => undefined, registration, clients };
  const context = vm.createContext({ self, URL, Promise, JSON, Math, Number, Array, String, Date, fetch: async (url, init) => { fetched.push([url, init]); return { ok: true }; } });
  vm.runInContext(source, context);
  const run = async (type, event) => { let work; handlers[type]({ ...event, waitUntil: p => { work = p; } }); await work; };
  const push = data => run('push', { data: { json: () => data, text: () => JSON.stringify(data) } });
  const click = (tag, action = '') => run('notificationclick', { action, notification: screen.get(tag) ?? { data: {}, close: () => undefined } });
  return { context, screen, shown, fetched, opened, messages, push, click };
}
const guest = (id, body, time) => ({ title: 'Jack (guest) · 2 Panmure', body, url: '/workspace/live?section=inbox', tag: 'guest-jack-2-panmure', initials: 'J', colour: '#3B5866', id, time, thread: 'Jack (guest) · 2 Panmure' });

test('one message: the conversation on top, the message below, at the time it was written, with Reply and Mark as read', () => {
  const { context } = phone();
  const n = context.noticeFor(guest('n1', 'Is there a hairdryer?', 1_000), null, 9_999);
  assert.equal(n.title, 'Jack (guest) · 2 Panmure');
  assert.equal(n.options.body, 'Is there a hairdryer?');
  assert.equal(n.options.timestamp, 1_000);
  assert.equal(n.options.tag, 'guest-jack-2-panmure');
  assert.equal(n.options.renotify, true);
  assert.equal(n.options.badge, '/workspace/badge-96.png');
  assert.deepEqual(plain(n.options.actions.map(a => [a.action, a.title])), [['reply', 'Reply'], ['read', 'Mark as read']]);
  // Without a time it shows when it arrived.
  assert.equal(context.noticeFor(guest('n1', 'Hi'), null, 9_999).options.timestamp, 9_999);
});

test('more messages in the same conversation join its pop-up: "(3 messages)", one per line, newest last, up to five lines', () => {
  const { context } = phone();
  let shown = null;
  const words = ['Hi', 'Is there a hairdryer?', 'Also the wifi password', 'Thanks!', 'See you at 4', 'Running late, 5 instead'];
  const titles = [];
  words.forEach((w, i) => { const n = context.noticeFor(guest('n' + i, w, 1_000 + i), shown, 0); titles.push(n.title); shown = n.options.data; });
  assert.deepEqual(titles, ['Jack (guest) · 2 Panmure', 'Jack (guest) · 2 Panmure (2 messages)', 'Jack (guest) · 2 Panmure (3 messages)', 'Jack (guest) · 2 Panmure (4 messages)',
    'Jack (guest) · 2 Panmure (5 messages)', 'Jack (guest) · 2 Panmure (6 messages)']);
  assert.equal(shown.lines.map(l => l.text).join('\n'), words.slice(1).join('\n'), 'the five newest, newest last');
  // A message that arrives late still goes in its place.
  const late = context.noticeFor(guest('n9', 'Earlier one', 1_002.5), shown, 0);
  assert.deepEqual(late.options.body.split('\n'), ['Also the wifi password', 'Earlier one', 'Thanks!', 'See you at 4', 'Running late, 5 instead']);
  assert.equal(late.options.timestamp, 1_005, 'the pop-up keeps the newest time');
  // A message over several lines takes one line.
  assert.equal(context.noticeFor(guest('n1', 'Line one\nline two', 1), null, 0).options.body, 'Line one line two');
});

test('a team chat uses its unread count, so messages read in the app drop out; a different conversation never mixes in', () => {
  const { context } = phone();
  const chat = (id, body, count) => ({ title: 'Guest relations', body, url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, id, time: 1, thread: 'Guest relations', count, conversation: CONV });
  const one = context.noticeFor(chat('n1', 'Erika: Morning team!', 1), null, 0);
  const two = context.noticeFor(chat('n2', 'Alex: On my way', 2), one.options.data, 0);
  assert.equal(two.title, 'Guest relations (2 messages)');
  assert.equal(two.options.body, 'Erika: Morning team!\nAlex: On my way');
  assert.equal(two.options.data.conversation, CONV);
  // Read in between: the server says 1 unread, so the pop-up starts again.
  const fresh = context.noticeFor(chat('n3', 'Erika: Lunch?', 1), two.options.data, 0);
  assert.equal(fresh.title, 'Guest relations');assert.equal(fresh.options.body, 'Erika: Lunch?');
  assert.equal(context.noticeFor(chat('n4', 'x', 250), null, 0).title, 'Guest relations (99+ messages)');
  // Lines of another conversation are never joined.
  const other = context.noticeFor(guest('n5', 'Hello', 2), two.options.data, 0);
  assert.equal(other.options.body, 'Hello');
});

test('the same message twice is not shown again; a notice that is not a message stays plain', () => {
  const { context } = phone();
  const first = context.noticeFor(guest('n1', 'Hi', 1), null, 0);
  assert.equal(context.noticeFor(guest('n1', 'Hi', 1), first.options.data, 0), null);
  const notice = context.noticeFor({ title: 'Mark, new to-do for you', body: 'Alex · Call the plumber', url: '/workspace/live', tag: 'recharge', id: 'n8' }, null, 5);
  assert.equal(notice.title, 'Mark, new to-do for you');assert.equal(notice.options.body, 'Alex · Call the plumber');
  assert.equal(notice.options.actions, undefined, 'no Reply on a notice');assert.equal(notice.options.badge, '/workspace/badge-96.png');
  // Anything unusual is cleaned up.
  const odd = context.noticeFor({ url: 'https://elsewhere.example', tag: 'Bad Tag!' }, null, 5);
  assert.deepEqual([odd.title, odd.options.body, odd.options.tag, odd.options.data.url], ['Recharge', 'There is an update in Recharge.', 'recharge', '/workspace/live']);
});

test('on the phone: pushes of one conversation become one pop-up that alerts each time, and a repeat does not alert', async () => {
  const p = phone({ windows: [{ url: 'https://app.example/workspace/live' }] });
  await p.push(guest('n1', 'Hi', 1));
  await p.push(guest('n2', 'Is there a hairdryer?', 2));
  await p.push({ title: 'Mark, new to-do for you', body: 'Call the plumber', url: '/workspace/live', tag: 'recharge', id: 'n3' });
  assert.equal(p.screen.size, 2, 'one pop-up for the conversation, one for the notice');
  const chat = p.screen.get('guest-jack-2-panmure');
  assert.equal(chat.title, 'Jack (guest) · 2 Panmure (2 messages)');assert.equal(chat.body, 'Hi\nIs there a hairdryer?');
  assert.equal(chat.icon, '/workspace/icon-192.png', 'no canvas here, so the app icon');
  assert.equal(chat.renotify, true);
  assert.equal(p.messages.length, 3, 'an open window chimes for each new one');
  await p.push(guest('n2', 'Is there a hairdryer?', 2));
  assert.equal(p.shown.at(-1).silent, true);assert.equal(p.shown.at(-1).renotify, false);
  assert.equal(p.screen.get('guest-jack-2-panmure').body, 'Hi\nIs there a hairdryer?');
  assert.equal(p.messages.length, 3, 'and no chime for a repeat');
});

test('Reply opens the conversation with the message box ready; Mark as read marks it read without opening anything', async () => {
  const p = phone();
  const chat = { title: 'Alex', body: 'Can you call the owner?', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, id: 'n1', thread: 'Alex', count: 1, conversation: CONV };
  await p.push(chat);
  await p.click('chat-' + CONV, 'reply');
  assert.deepEqual(p.opened, [`/workspace/live?section=inbox&chat=${CONV}&reply=1`]);
  assert.equal(p.screen.size, 0, 'the pop-up goes');
  await p.push({ ...chat, id: 'n2' });
  await p.click('chat-' + CONV, 'read');
  assert.equal(p.opened.length, 1, 'nothing opens');
  assert.equal(p.fetched.length, 1);
  const [url, init] = p.fetched[0];
  assert.equal(url, '/api/workspace/chat');assert.equal(init.method, 'POST');assert.equal(init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(init.body), { action: 'markRead', conversationId: CONV });
  // A guest conversation is read on the device that opens it: the pop-up just goes.
  await p.push(guest('n3', 'Hi', 3));
  await p.click('guest-jack-2-panmure', 'read');
  assert.equal(p.fetched.length, 1);assert.equal(p.screen.size, 0);
});

test('a tap opens the conversation in the open Recharge window, or a new one', async () => {
  const win = { url: 'https://app.example/workspace/live' };
  const p = phone({ windows: [win] });
  await p.push({ title: 'Alex', body: 'Hi', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, id: 'n1', thread: 'Alex', conversation: CONV });
  await p.click('chat-' + CONV);
  assert.equal(win.focused, true);assert.deepEqual(p.opened, []);
  assert.deepEqual(plain(p.messages.at(-1)), { type: 'recharge-open', url: `/workspace/live?section=inbox&chat=${CONV}` });
});

test('the icons: a white mark on a transparent badge, and maskable home-screen icons in the manifest', async () => {
  const png = await fs.readFile('mobile/web-static/badge-96.png');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [96, 96]);
  assert.equal(png[25], 6, 'RGBA: the background is transparent');
  const manifest = JSON.parse(await fs.readFile('mobile/web-static/manifest.webmanifest', 'utf8'));
  assert.deepEqual(manifest.icons.filter(i => i.purpose === 'maskable').map(i => i.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) await fs.access('mobile/web-static/' + icon.src.replace('/workspace/', ''));
});

test('a phone picks up new notification code each time the app opens, and it takes over at once', async () => {
  const notifications = await fs.readFile('mobile/src/Notifications.tsx', 'utf8');
  assert.match(notifications, /getRegistration\("\/workspace\/"\)[^\n]*\n\s*await registration\?\.update\(\)/, 'the app asks the browser for the latest sw.js');
  const workspace = await fs.readFile('mobile/src/LiveWorkspace.tsx', 'utf8');
  assert.match(workspace, /useEffect\(\(\) => \{ void refreshNotificationLink\(\); \}, \[account\.userId\]\);/, 'on every app open');
  assert.match(source, /self\.skipWaiting\(\)/);
  assert.match(source, /self\.clients\.claim\(\)/);
});
