import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Message pop-ups look like a phone messenger (Alex: "do you think we can make notifications more like WhatsApp style?"): a 1-to-1
// chat is titled with the sender, a group with its name and "Erika: …" below, an owner "(owner)", a guest "(guest) · the property".
// Lee's earlier rule (14 October: the pop-up names the person it is for) stays for everything else: "Mark, new to-do for you".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { pushCopy, pushTarget, pushInitials, pushThread } = await vite.ssrLoadModule('/lib/push-copy.ts');
const { pushPayload } = await vite.ssrLoadModule('/lib/web-push.ts');
const CONV = '5a1e0000-0000-4000-8000-000000000001';

test('a 1-to-1 chat: the sender on top, the message below; a voice note and a photo say what they are', () => {
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark Raven', who: 'Alex Coghill', preview: 'Can you call the owner?', conversationKind: 'direct' }),
    { title: 'Alex Coghill', message: 'Can you call the owner?' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: '🎤 Voice note (0:42)', conversationKind: 'direct' }),
    { title: 'Alex', message: '🎤 Voice note (0:42)' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: '📷 Photo' }), { title: 'Alex', message: '📷 Photo' });
  // Nobody's name in front any more.
  assert.doesNotMatch(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: 'Hi' }).title, /Mark/);
});

test('a group: its name on top, "Erika: …" below; a mention says so', () => {
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Erika Smith', preview: 'Morning team!', context: 'Guest relations', conversationKind: 'group' }),
    { title: 'Guest relations', message: 'Erika: Morning team!' });
  assert.deepEqual(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'Can you check 110 Hawk?', context: 'Guest relations', conversationKind: 'group', mention: 'you' }),
    { title: 'Guest relations', message: 'Erika mentioned you: Can you check 110 Hawk?' });
  assert.equal(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'Fixed', context: 'Everyone', mention: 'everyone' }).message, 'Erika mentioned everyone: Fixed');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: '🎤 Voice note (4:59)', context: 'Deep clean Friday' }).message, 'Alex: 🎤 Voice note (4:59)');
});

test('several unread messages in one conversation: "(3 messages)" after the title', () => {
  assert.equal(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'And another', context: 'Guest relations', unreadCount: 3 }).title, 'Guest relations (3 messages)');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: 'Hi', unreadCount: 1 }).title, 'Alex');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: 'Hi', unreadCount: 250 }).title, 'Alex (99+ messages)');
  const long = pushCopy('chat.message', null, { who: 'Alex', preview: 'Hi', context: 'x'.repeat(200), unreadCount: 4 }).title;
  assert.ok(long.length <= 80 && long.endsWith('… (4 messages)'), 'the name is cut, never the count');
});

test('owners and guests: "Sarah Jones (owner)", "Sam (guest) · 110 Hawk"; an owner hears from "Recharge"', () => {
  assert.deepEqual(pushCopy('chat.owner_message', null, { recipient: 'Mark', who: 'Sarah Jones', preview: 'The boiler is fixed' }),
    { title: 'Sarah Jones (owner)', message: 'The boiler is fixed' });
  assert.deepEqual(pushCopy('chat.owner_message', null, { recipient: 'Mark', who: 'Sarah Jones', preview: '🎤 Voice note (1:05)', propertyName: 'Rose Cottage' }),
    { title: 'Sarah Jones (owner) · Rose Cottage', message: '🎤 Voice note (1:05)' });
  // Someone on the team answered the owner: the owner's conversation on top, who answered in front.
  assert.deepEqual(pushCopy('chat.message', null, { who: 'Alex Coghill', preview: 'On it', conversationKind: 'owner', ownerName: 'Sarah Jones' }),
    { title: 'Sarah Jones (owner)', message: 'Alex: On it' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Sarah Jones', who: 'Recharge', preview: 'Yes, this morning.', conversationKind: 'owner' }),
    { title: 'Recharge', message: 'Yes, this morning.' });
  assert.deepEqual(pushCopy('guest.message', null, { recipient: 'Mark Raven', who: 'Sam', propertyName: '110 Hawk', preview: 'What time is check-in?' }),
    { title: 'Sam (guest) · 110 Hawk', message: 'What time is check-in?' });
  assert.equal(pushCopy('guest.message', null, { recipient: 'Alex Coghill', who: 'John', replied: true, preview: 'Thanks' }).title, 'John (guest)');
});

test('everything else keeps the name of the person it is for: work notices and client email', () => {
  const todo = pushCopy('hub.todo_added', null, { recipient: 'Mark', actorName: 'Alex', workTitle: 'Call the plumber', propertyName: 'Rose Cottage' });
  assert.equal(todo.title, 'Mark, new to-do for you');
  assert.equal(todo.message, 'Alex · Call the plumber · Rose Cottage');
  // A notice the backend wrote a sentence for (cleaner notices) shows that sentence, still with the name in front.
  assert.deepEqual(pushCopy('cleaning.assigned', null, { recipient: 'Isla Kerr', actorName: 'Alex', propertyName: '110 Hawk', preview: '110 Hawk, Sat 18 Oct · checkout 10:00 · next guests 15:00' }).message,
    '110 Hawk, Sat 18 Oct · checkout 10:00 · next guests 15:00');
  assert.match(pushCopy('cleaning.assigned', null, { recipient: 'Isla Kerr', preview: 'x' }).title, /^Isla, /);
  assert.deepEqual(pushCopy('client.email', null, { recipient: 'Mark', who: 'Sarah Jones', preview: 'Managing my flat' }),
    { title: 'Mark, new email from Sarah Jones', message: 'Managing my flat' });
  assert.equal(pushCopy('client.email', null, { recipient: 'Mark', who: 'Sarah', replied: true }).title, 'Mark, Sarah replied by email');
});

test('without details it falls back to the general wording, never "Sign in to see the details", and long text is cut', () => {
  const bare = pushCopy('guest.message');
  assert.equal(bare.title, 'New guest message');
  assert.doesNotMatch(bare.message, /Sign in to Recharge/);
  assert.equal(pushCopy('chat.message').title, pushCopy('chat.message', null, {}).title);
  const long = pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: 'x'.repeat(400) });
  assert.ok(long.message.length <= 180 && long.message.endsWith('…'));
});

test('one pop-up per conversation (the tag), and a tap opens that conversation', () => {
  assert.deepEqual(pushTarget('chat.message', { conversationId: CONV }), { tag: 'chat-' + CONV, url: `/workspace/live?section=inbox&chat=${CONV}` });
  assert.equal(pushTarget('chat.owner_message', { conversationId: CONV }).tag, 'chat-' + CONV);
  assert.deepEqual(pushTarget('chat.message', { conversationId: 'not-an-id' }), { tag: 'recharge-chat', url: '/workspace/live?section=inbox' });
  assert.deepEqual(pushTarget('guest.message', { who: 'Sam', propertyName: '110 Hawk' }), { tag: 'guest-sam-110-hawk', url: '/workspace/live?section=inbox' });
  assert.deepEqual(pushTarget('hub.todo_added', {}), { tag: 'recharge', url: '/workspace/live' });
});

test('the picture: a signed link to the sender\'s photo, otherwise their initials and colour; the private path is never sent', () => {
  const job = { eventType: 'chat.message', details: { who: 'Erika Smith', preview: 'Hi', context: 'Guest relations', conversationId: CONV, senderPhotoPath: 'u/p.jpg', senderColour: 'plum' } };
  const withPhoto = pushPayload(job, undefined, 'https://project.supabase.co/storage/v1/object/sign/avatars/u/p.jpg?token=abc');
  assert.deepEqual(withPhoto, { title: 'Guest relations', body: 'Erika: Hi', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, icon: 'https://project.supabase.co/storage/v1/object/sign/avatars/u/p.jpg?token=abc', thread: 'Guest relations', conversation: CONV });
  assert.doesNotMatch(JSON.stringify(withPhoto), /u\/p\.jpg"|senderPhotoPath/);
  assert.deepEqual(pushPayload(job), { title: 'Guest relations', body: 'Erika: Hi', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, initials: 'ES', colour: '#5B4A5E', thread: 'Guest relations', conversation: CONV });
  assert.equal(pushPayload(job, undefined, 'http://insecure.example/x.jpg').icon, undefined);
  assert.equal(pushInitials('chat.message', { who: 'Recharge' }), null, 'an owner sees the app\'s own icon');
  assert.equal(pushInitials('hub.todo_added', { who: 'Alex' }), null);
  // A guest has no profile colour: one is picked from the name, the same every time (WhatsApp's coloured circles).
  assert.deepEqual(pushInitials('guest.message', { who: 'sam' }), { initials: 'S', colour: '#8E3F38' });
  assert.deepEqual(pushInitials('guest.message', { who: 'Sam' }), pushInitials('guest.message', { who: 'sam' }));
  assert.deepEqual(pushInitials('guest.message', { who: 'Jack' }), { initials: 'J', colour: '#3B5866' });
  // A test notification keeps its words and the general tag.
  assert.deepEqual(pushPayload(job, { title: 'Recharge', message: 'Test' }), { title: 'Recharge', body: 'Test', url: '/workspace/live', tag: 'recharge' });
});

test('like WhatsApp, a message carries its conversation, its id and its time, so the phone shows one pop-up per conversation', () => {
  // The client's example: a guest at 2 Panmure.
  const guest = pushPayload({ eventType: 'guest.message', outboxId: 42, createdAt: '2026-10-20T09:15:00Z', details: { recipient: 'Mark Raven', who: 'Jack', propertyName: '2 Panmure', preview: 'Is there a hairdryer?' } });
  assert.deepEqual(guest, { title: 'Jack (guest) · 2 Panmure', body: 'Is there a hairdryer?', url: '/workspace/live?section=inbox', tag: 'guest-jack-2-panmure',
    initials: 'J', colour: '#3B5866', id: 'n42', time: Date.parse('2026-10-20T09:15:00Z'), thread: 'Jack (guest) · 2 Panmure' });
  // A team chat: the conversation without its count (the phone adds "(3 messages)"), the unread count, and the conversation to mark read.
  assert.deepEqual(pushThread('chat.message', { who: 'Erika Smith', preview: 'Hi', context: 'Guest relations', conversationKind: 'group', conversationId: CONV.toUpperCase(), unreadCount: 3 }),
    { thread: 'Guest relations', count: 3, conversation: CONV });
  assert.deepEqual(pushThread('chat.message', { who: 'Alex', preview: 'Hi', conversationId: 'nope' }), { thread: 'Alex' });
  // Everything else is a plain notice: no thread, so it is never merged and has no Reply button.
  assert.deepEqual(pushThread('hub.todo_added', { who: 'Alex', recipient: 'Mark' }), {});
  const todo = pushPayload({ eventType: 'hub.todo_added', outboxId: '7', details: { recipient: 'Mark', actorName: 'Alex', workTitle: 'Call the plumber' } });
  assert.equal(todo.thread, undefined);assert.equal(todo.id, 'n7');assert.equal(todo.time, undefined, 'no time: the phone uses when it arrived');
  assert.equal(pushPayload({ eventType: 'hub.todo_added', outboxId: 'x', createdAt: 'later' }).id, undefined);
  // Copy rules: no em dash and no emoji in what Recharge itself writes.
  for (const payload of [guest, todo, pushPayload({ eventType: 'chat.message', details: { who: 'Alex', unreadCount: 4 } })]) {
    assert.doesNotMatch(payload.title + payload.body + (payload.thread ?? ''), /\u2014|\p{Extended_Pictographic}/u);
  }
});

test('the browser shows it: the tag, the picture, and a tap that opens the conversation in the open window', async () => {
  const sw = await fs.readFile('mobile/web-static/sw.js', 'utf8');
  assert.match(sw, /tag, renotify: true, requireInteraction: true/);
  assert.match(sw, /badge: BADGE/, 'the white mark on transparent, never the colour icon (a white square on Android)');
  assert.match(sw, /data\.icon\.startsWith\("https:\/\/"\) \? Promise\.resolve\(data\.icon\) : initialsIcon\(data\.initials, data\.colour\)/);
  assert.match(sw, /icon: icon \|\| APP_ICON/, 'the app icon otherwise (an iPhone always shows it)');
  assert.match(sw, /getNotifications\(\{ tag \}\)/, 'a new message joins the pop-up of its conversation (tests/web-push-sw.test.mjs)');
  assert.match(sw, /open\.postMessage\(\{ type: "recharge-open", url \}\);\s*return open\.focus\(\);/);
  assert.match(sw, /return self\.clients\.openWindow\(url\);/);
  const page = await fs.readFile('mobile/src/LiveWorkspace.tsx', 'utf8');
  assert.match(page, /data\?\.type !== "recharge-open"/);
  assert.match(page, /const \{ chat: chatLink, reply: replyLink \} = useLocalSearchParams<\{ chat\?: string; reply\?: string \}>\(\);/);
  assert.match(page, /openMessages\(chat, params\.get\("reply"\) === "1"\)/, 'Reply with Recharge already open');
  assert.match(page, /focusReply=\{!!chatTarget\?\.reply\}/);
  const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8');
  assert.match(chat, /setTimeout\(\(\) => input\.current\?\.focus\(\), 80\)/, 'the message box is ready to type in');
  assert.match(chat, /clearConversationNotices\(id\);/, 'reading a conversation takes its pop-up away');
  // The phone app keeps the general words (its pushes are not end-to-end encrypted) but opens the same place.
  const native = await fs.readFile('lib/integration-providers.ts', 'utf8');
  assert.match(native, /data:\{screen:'activity',url:pushTarget\(job\.eventType,job\.details\?\?\{\}\)\.url\}/);
});
