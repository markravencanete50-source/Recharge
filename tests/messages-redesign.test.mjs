import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Messages redesign (Lee, round 5: "keep it simple, clean, and professional", "like a messenger or WhatsApp"): three tabs at
// most and never Updates, no channel chips, three statuses for Guests and Clients, one search box, and a conversation that
// opens in place (beside the list on a wide screen, instead of it on a phone).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const chat = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const filters = await vite.ssrLoadModule('/lib/inbox-filters.ts');
const source = file => readFileSync('mobile/src/' + file, 'utf8');
const live = source('LiveChat.tsx'), guests = source('LiveGuestInbox.tsx'), layout = source('MessagesLayout.tsx');
const GUEST_TOOL = ['guest-communication'];

test('the tabs per role: Guests, Clients, Guest emails, Client emails and Team, never Updates; owners have none', () => {
  const tabs = (role, modules = GUEST_TOOL, hasOwner = false) => chat.messageTabs({ role, modules }, hasOwner);
  const ALL = ['guests', 'clients', 'guestEmails', 'clientEmails', 'team'];
  assert.deepEqual(tabs('super_admin'), ALL, 'in the order Lee asked for');
  assert.deepEqual(tabs('admin'), ALL);
  assert.deepEqual(tabs('stays'), ALL);
  assert.deepEqual(tabs('stays', []), ['clients', 'clientEmails', 'team'], 'Stays without the guest tool');
  assert.deepEqual(tabs('accounts'), ['guests', 'guestEmails', 'team'], 'accounts with the tool');
  assert.deepEqual(tabs('cleaning_manager'), ['guests', 'guestEmails', 'team']);
  assert.deepEqual(tabs('accounts', [], true), ['clients', 'team'], 'anyone already in an owner conversation sees Clients, but not the client mailbox');
  for (const role of ['cleans', 'ready']) assert.deepEqual(tabs(role), ['team'], role + ' never gets Guests, even with the tool');
  assert.deepEqual(tabs('client'), [], 'owners have no tabs');
  for (const role of ['super_admin', 'admin', 'stays', 'accounts', 'cleaning_manager', 'cleans', 'ready', 'client'])
    assert.ok(!tabs(role, GUEST_TOOL, true).includes('updates'), role + ' has no Updates tab');
  assert.match(live, /const TAB_LABEL: Record<Tab, string> = \{ guests: "Guests", clients: "Clients", guestEmails: "Guest emails", clientEmails: "Client emails", team: "Team" \};/);
  assert.match(live, /tab === "guestEmails" \? <GuestInbox key="guest-emails" emails/);
  assert.match(guests, /const mine = \(data\?\.threads \?\? \[\]\)\.filter\(t => isGuestEmail\(t\) === emails\);/);
  assert.match(live, /messageTabs\(account,/);
  assert.doesNotMatch(live, /"updates" as const|TAB_ICON/);
});

test('Updates stays reachable: a link to it opens the feed in place, with a way back to Messages', () => {
  assert.match(live, /updates\?: ReactNode/);
  assert.match(live, /initialTab\?: "updates"/);
  assert.match(live, /const openUpdates = initialTab === "updates" && !openConversation && !!updates;/);
  assert.match(live, /if \(showUpdates && updates && !owner\) return \(/);
  assert.match(live, /<ThreadHeader p=\{p\} onBack=\{\(\) => setShowUpdates\(false\)\}>/);
});

test('three statuses and their counts: Needs a reply, Engaged (green), Closed', () => {
  assert.deepEqual([...filters.MESSAGE_STATUSES], ['reply', 'waiting', 'closed']);
  assert.deepEqual(filters.MESSAGE_STATUS_LABEL, { reply: 'Needs a reply', waiting: 'Engaged', closed: 'Closed' });
  // Lee renamed "Waiting for reply" to Engaged: the tags read the label from the map, never a literal of their own.
  assert.doesNotMatch(live + guests + layout, /Waiting for reply/);
  assert.match(guests, /<Tag label=\{MESSAGE_STATUS_LABEL\.waiting\} tone="good" p=\{p\} \/>/);
  assert.match(guests, /<Tag label=\{MESSAGE_STATUS_LABEL\[t\.status === "done" \? "closed" : "waiting"\]\}/);
  const threads = [
    { status: 'open', waitingSince: '2026-10-15T09:00:00Z' }, { status: 'open', waitingSince: '2026-10-15T09:05:00Z' },
    { status: 'open', waitingSince: null }, { status: 'done', waitingSince: null }, { status: 'done', waitingSince: '2026-10-14T09:00:00Z' },
  ];
  assert.deepEqual(threads.map(filters.guestStatus), ['reply', 'reply', 'waiting', 'closed', 'closed']);
  assert.deepEqual(filters.statusCounts(threads, filters.guestStatus), { reply: 2, waiting: 1, closed: 2 });
  const owners = [
    { closed: false, last: { fromOwner: true } }, { closed: false, last: { fromOwner: false } }, { last: null },
    { closed: true, last: { fromOwner: true } },
  ];
  assert.deepEqual(owners.map(filters.clientStatus), ['reply', 'waiting', 'waiting', 'closed']);
  assert.deepEqual(filters.statusCounts(owners, filters.clientStatus), { reply: 1, waiting: 2, closed: 1 });
  // The colours: attention for Needs a reply, green for Engaged.
  assert.match(layout, /reply: p\.waiting, waiting: p\.success, closed: p\.muted/);
  assert.match(guests, /<StatusFilter p=\{p\} value=\{status\} counts=\{statusCounts\(found, guestStatus\)\}/);
  // Clients counts owner conversations by clientStatus and email conversations by clientEmailStatus (round 7, Session F).
  assert.match(live, /clients && !!list && <StatusFilter p=\{p\} value=\{status\} counts=\{statusCounts\(found, statusOf\)\}/);
  assert.match(live, /const statusOf = \(r: Row\) => r\.kind === "email" \? clientEmailStatus\(r\.t\) : clientStatus\(r\.c\);/);
  assert.doesNotMatch(live + guests, /InboxChips|CHAT_CHIPS|GUEST_CHIPS|propertyChips|All properties/);
});

test('one search box: guest or property (name and address), owner or property, conversation or people', () => {
  const s = filters.matchesSearch;
  const fields = ['Gina Guest', 'Harbour Flat', '10 Barnet Crescent EH6 1AB'];
  assert.ok(s('', fields), 'an empty search shows everything');
  assert.ok(s('gina', fields));
  assert.ok(s('HARBOUR', fields));
  assert.ok(s('barnet eh6', fields), 'words in any order, from the address');
  assert.ok(s('gina barnet', fields), 'name and address together');
  assert.ok(!s('gina leith', fields));
  assert.ok(s('cafe', ['Café Chloé']), 'accents are ignored');
  assert.ok(s('x', [null, undefined, 'x']));
  assert.match(guests, /placeholder="Search guest or property"/);
  assert.match(guests, /matchesSearch\(query, \[t\.guestName, t\.propertyName, t\.propertyId \? address\.get\(t\.propertyId\) : null, t\.reservationRef\]\)/);
  assert.match(live, /"Search owner or property" : "Search conversations or people"/);
  assert.equal(filters.emptyStatusMessage('guests', 'reply', true), 'Nothing matches your search.');
  assert.equal(filters.emptyStatusMessage('guests', 'reply', false), 'Nobody is waiting for a reply.');
});

test('a conversation opens in place, never as a pop-up: list and thread side by side on a wide screen, full screen with a back arrow on a phone', () => {
  assert.match(layout, /export function MessagesSplit/);
  assert.match(layout, /if \(!desktop\) return <View style=\{\[ui\.card, \{ backgroundColor: p\.surface, borderColor: p\.border \}\]\}>\{detail \?\? list\}<\/View>;/);
  assert.match(layout, /accessibilityLabel="Back to messages"/);
  assert.match(guests, /<MessagesSplit p=\{p\} desktop=\{desktop\} list=\{list\} detail=\{detail\} \/>/);
  assert.match(guests, /<GuestThreadPane key=\{openId\} p=\{p\} threadId=\{openId\} properties=\{properties\} onBack=\{desktop \? undefined : \(\) => open\(null\)\}/);
  assert.doesNotMatch(guests, /function ThreadSheet|<ThreadSheet/);
  // The only sheet left in the guest inbox is the form for logging a message.
  assert.equal((guests.match(/<Sheet /g) ?? []).length, 1);
  assert.match(live, /<MessagesSplit p=\{p\} desktop=\{desktop\} list=\{listView\} detail=\{open \? thread\(open, desktop \? undefined : \(\) => \{ setOpen\(null\); void loadList\(\); \}\) : null\} \/>/);
  // Everything the guest thread could do stays: Send through Hostaway, save a reply, close and reopen, guest details.
  for (const action of ['"sendReply"', '"reply"', 'status: "done"', 'status: "open"', '"editThread"', '"logMessage"']) assert.ok(guests.includes(action), action);
});

test('fewer buttons: no channel chips, no Refresh, a small + to log a guest message, one quiet line for long waits', () => {
  assert.doesNotMatch(live, /channelBar|openChannel|name="hash"/);
  assert.doesNotMatch(source('ChatParts.tsx'), /"hash"/, 'channels look like any group, with no #');
  assert.doesNotMatch(live + guests, /RefreshButton|label="Log a guest message"/);
  assert.match(guests, /action=\{\{ icon: "plus", label: "Log a guest message", onPress: \(\) => setLogging\(true\) \}\}/);
  assert.match(guests, /<QuietLine p=\{p\} tone="bad" text=\{`\$\{red\} guest/);
  // Helper lines wrap on a phone rather than being cut short with an ellipsis (Session E, item 19).
  const quiet = layout.slice(layout.indexOf('export function QuietLine'), layout.indexOf('export function MessagesSplit'));
  assert.doesNotMatch(quiet, /numberOfLines/);
  assert.match(quiet, /<Text style=\{\[ui\.small, \{ color: ink, flex: 1 \}\]\}>\{text\}<\/Text>/);
  assert.match(live, /icon: "edit-3", label: clients \? "New message to an owner" : "New message"/);
});

test('calm style: thin type, no looping motion, no em dashes', () => {
  for (const [name, text] of [['LiveChat', live], ['LiveGuestInbox', guests], ['MessagesLayout', layout]]) {
    assert.doesNotMatch(text, /fontWeight: "(7|8|9)00"|fontWeight: "bold"/, name + ' has heavy type');
    assert.doesNotMatch(text, /\b(Entrance|SwapIn|Pop|Shimmer|Float|Stagger)\b|Animated\.loop/, name + ' loops');
    assert.ok(!text.includes('—'), name + ' has an em dash');
  }
});
