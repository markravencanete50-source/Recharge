import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Messages lists follow the time (Lee: "any new message or email should always be on top. It should follow the time."):
// Guests, Clients and Team are ordered by the latest message, newest first, whatever the status or channel; the status
// buttons only filter. The database side is tests/messages-newest-first-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const f = await vite.ssrLoadModule('/lib/inbox-filters.ts');
const at = minutes => new Date(Date.parse('2026-10-14T09:00:00Z') - minutes * 60000).toISOString();
const latest = list => f.byLatest(list, t => t.lastMessageAt, t => t.id);

// Guest conversations from every channel and in every status.
const threads = [
  { id: 'hostaway-waiting', channel: 'airbnb', status: 'open', waitingSince: at(90), lastMessageAt: at(90) },
  { id: 'email-new', channel: 'email', status: 'open', waitingSince: at(2), lastMessageAt: at(2) },
  { id: 'logged-engaged', channel: 'booking', status: 'open', waitingSince: null, lastMessageAt: at(40) },
  { id: 'closed-recent', channel: 'direct', status: 'done', waitingSince: null, lastMessageAt: at(10) },
  { id: 'no-messages', channel: 'email', status: 'open', waitingSince: null, lastMessageAt: null },
];

test('newest message first, whatever the status or the channel; no time goes last', () => {
  assert.deepEqual(latest(threads).map(t => t.id), ['email-new', 'closed-recent', 'logged-engaged', 'hostaway-waiting', 'no-messages']);
  // Times written with different offsets compare as times, not as text.
  const mixed = [{ id: 'a', lastMessageAt: '2026-10-14T10:30:00+01:00' }, { id: 'b', lastMessageAt: '2026-10-14T09:45:00Z' }, { id: 'c', lastMessageAt: '2026-10-14T09:15:00.000+00:00' }];
  assert.deepEqual(latest(mixed).map(t => t.id), ['b', 'a', 'c']);
  // The input is left as it was.
  assert.equal(threads[0].id, 'hostaway-waiting');
});

test('a new message or a team reply moves a conversation to the top', () => {
  const replied = threads.map(t => t.id === 'hostaway-waiting' ? { ...t, waitingSince: null, lastMessageAt: at(0) } : t);
  assert.equal(latest(replied)[0].id, 'hostaway-waiting');
  const emailed = threads.map(t => t.id === 'no-messages' ? { ...t, lastMessageAt: at(1) } : t);
  assert.deepEqual(latest(emailed).slice(0, 2).map(t => t.id), ['no-messages', 'email-new']);
});

test('equal times keep a fixed order by id, so a refresh never shuffles the list', () => {
  const same = ['c3', 'a1', 'b2'].map(id => ({ id, lastMessageAt: at(5) }));
  assert.deepEqual(latest(same).map(t => t.id), ['a1', 'b2', 'c3']);
  assert.deepEqual(latest([...same].reverse()).map(t => t.id), ['a1', 'b2', 'c3']);
});

test('the status buttons only filter: each status keeps the time order', () => {
  const sorted = latest(threads);
  for (const status of f.MESSAGE_STATUSES) {
    const shown = sorted.filter(t => f.guestStatus(t) === status);
    assert.deepEqual(shown, latest(shown), status);
  }
  assert.deepEqual(sorted.filter(t => f.guestStatus(t) === 'reply').map(t => t.id), ['email-new', 'hostaway-waiting']);
});

test('Guests, Clients and Team all use it; the wait warning and tags stay', () => {
  const guests = readFileSync('mobile/src/LiveGuestInbox.tsx', 'utf8'), chat = readFileSync('mobile/src/LiveChat.tsx', 'utf8');
  assert.match(guests, /const threads = byLatest\(data\?\.threads \?\? \[\], t => t\.lastMessageAt, t => t\.id\);/);
  // Chat conversations and (Clients only) email conversations go through the same byLatest, by time, ids never colliding.
  assert.match(chat, /const inTab = byLatest<Row>\(\[\.\.\.\(list \?\? \[\]\)\.filter\(c => tabs\.length < 2 \|\| tabOf\(c\) === tab\)\.map\(chatRow\), \.\.\.\(tab === "clients" \? emails\.map\(emailRow\) : \[\]\)\], r => r\.at, r => r\.id\);/);
  assert.match(chat, /const emailRow = \(t: ClientEmailThread\): Row => \(\{ kind: "email", id: "email:" \+ t\.id, at: t\.lastMessageAt, t \}\);/);
  assert.equal((chat.match(/byLatest[<(]/g) ?? []).length, 1, 'one sort only');
  // The red-wait warning still counts every open conversation, and the row tags are unchanged.
  assert.match(guests, /const red = data \? data\.threads\.filter\(t => t\.status === "open" && waitGrade\(t\.waitingSince, data\.targets\)\?\.grade === "red"\)\.length : 0;/);
  assert.match(guests, /Needs a reply · waiting \$\{waitLabel\(wait\.minutes\)\}/);
  // A refresh does not close the open conversation: its pane is keyed by its id, not by the list.
  assert.match(guests, /const detail = openId \? <GuestThreadPane key=\{openId\}/);
});
