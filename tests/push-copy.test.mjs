import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Message pop-ups are laid out as WhatsApp lays them out (Alex, then Lee): the sender's name on top, the conversation on the first
// line ("Guest · Bornisketaig", a group's name; none for a one-to-one chat), then the message.
// Lee's earlier rule (14 October: the pop-up names the person it is for) stays for everything else: "Mark, new to-do for you".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { pushCopy, pushTarget, pushInitials, pushThread } = await vite.ssrLoadModule('/lib/push-copy.ts');
const { pushPayload } = await vite.ssrLoadModule('/lib/web-push.ts');
const CONV = '5a1e0000-0000-4000-8000-000000000001';
const GUEST = '6b2f0000-0000-4000-8000-000000000002';

test('a 1-to-1 chat: the sender on top, the message below; a voice note and a photo say what they are', () => {
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark Raven', who: 'Alex Coghill', preview: 'Can you call the owner?', conversationKind: 'direct' }),
    { title: 'Alex Coghill', message: 'Can you call the owner?' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: '🎤 Voice note (0:42)', conversationKind: 'direct' }),
    { title: 'Alex', message: '🎤 Voice note (0:42)' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: '📷 Photo' }), { title: 'Alex', message: '📷 Photo' });
  // Nobody's name in front any more.
  assert.doesNotMatch(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: 'Hi' }).title, /Mark/);
});

test('a group (Lee, WhatsApp layout): the sender on top, the group on the first line, then the message; a mention says so', () => {
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'John Pagueran', preview: 'Morning team!', context: 'Recharge Stays | 3 3, 18 Byres Rd', conversationKind: 'group' }),
    { title: 'John Pagueran', message: 'Recharge Stays | 3 3, 18 Byres Rd\nMorning team!' });
  assert.deepEqual(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'Can you check 110 Hawk?', context: 'Guest relations', conversationKind: 'group', mention: 'you' }),
    { title: 'Erika Smith', message: 'Guest relations\nMentioned you: Can you check 110 Hawk?' });
  assert.equal(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'Fixed', context: 'Everyone', mention: 'everyone' }).message, 'Everyone\nMentioned everyone: Fixed');
  // What a message carries, in words (no emoji): a voice note, a photo, a video.
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: '🎤 Voice note (4:59)', context: 'Deep clean Friday', attachmentKind: 'audio' }).message, 'Deep clean Friday\nVoice note (4:59)');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: '📷 Photo', context: 'Deep clean Friday', attachmentKind: 'image' }).message, 'Deep clean Friday\nPhoto');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: '📷 3 photos', context: 'Deep clean Friday', attachmentKind: 'image' }).message, 'Deep clean Friday\n3 photos');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: 'The broken tap', context: 'Deep clean Friday', attachmentKind: 'image' }).message, 'Deep clean Friday\nPhoto: The broken tap', 'no picture: the line says Photo');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: 'The broken tap', context: 'Deep clean Friday', attachmentKind: 'image', attachmentShown: true }).message, 'Deep clean Friday\nThe broken tap', 'the picture shows it');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: '🎬 Video', attachmentKind: 'video' }).message, 'Video');
});
test('the title is the sender only; the phone adds "(3 messages)" when several people wrote (tests/web-push-sw.test.mjs)', () => {
  assert.equal(pushCopy('chat.message', null, { who: 'Erika Smith', preview: 'And another', context: 'Guest relations', unreadCount: 3 }).title, 'Erika Smith');
  assert.equal(pushCopy('chat.message', null, { who: 'Alex', preview: 'Hi', unreadCount: 250 }).title, 'Alex');
  const long = pushCopy('chat.message', null, { who: 'x'.repeat(200), preview: 'Hi', context: 'y'.repeat(200) });
  assert.ok(long.title.length <= 80 && long.title.endsWith('…'));
  assert.ok(long.message.split('\n')[0].length <= 80, 'the conversation line is cut too');
});
test('owners and guests: "Rebecca" on top, "Guest · Bornisketaig" first; an owner hears from "Recharge"', () => {
  assert.deepEqual(pushCopy('guest.message', null, { recipient: 'Mark Raven', who: 'Rebecca', propertyName: 'Bornisketaig', preview: 'What time is check-in?' }),
    { title: 'Rebecca', message: 'Guest · Bornisketaig\nWhat time is check-in?' });
  assert.deepEqual(pushCopy('guest.message', null, { recipient: 'Alex Coghill', who: 'John', replied: true, preview: 'Thanks' }), { title: 'John', message: 'Guest\nThanks' });
  assert.deepEqual(pushCopy('chat.owner_message', null, { recipient: 'Mark', who: 'Sarah Jones', preview: 'The boiler is fixed' }),
    { title: 'Sarah Jones', message: 'Owner\nThe boiler is fixed' });
  assert.deepEqual(pushCopy('chat.owner_message', null, { recipient: 'Mark', who: 'Sarah Jones', preview: '🎤 Voice note (1:05)', propertyName: 'Rose Cottage', attachmentKind: 'audio' }),
    { title: 'Sarah Jones', message: 'Owner · Rose Cottage\nVoice note (1:05)' });
  // Someone on the team answered the owner: who answered on top, the owner's conversation first.
  assert.deepEqual(pushCopy('chat.message', null, { who: 'Alex Coghill', preview: 'On it', conversationKind: 'owner', ownerName: 'Sarah Jones' }),
    { title: 'Alex Coghill', message: 'Sarah Jones (owner)\nOn it' });
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Sarah Jones', who: 'Recharge', preview: 'Yes, this morning.', conversationKind: 'owner' }),
    { title: 'Recharge', message: 'Yes, this morning.' });
  // A one-to-one chat has no conversation line, as in WhatsApp.
  assert.deepEqual(pushCopy('chat.message', null, { who: 'Alex Coghill', preview: 'Hi', conversationKind: 'direct' }), { title: 'Alex Coghill', message: 'Hi' });
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
  assert.equal(bare.title, 'Guest');
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
  // A guest message with its conversation (20261025500000): one pop-up per guest conversation, and a tap opens it.
  assert.deepEqual(pushTarget('guest.message', { who: 'Sam', propertyName: '110 Hawk', guestThreadId: GUEST.toUpperCase() }), { tag: 'guest-' + GUEST, url: `/workspace/live?section=inbox&guest=${GUEST}` });
  assert.deepEqual(pushTarget('guest.message', { who: 'Sam', propertyName: '110 Hawk', guestThreadId: 'nope' }), { tag: 'guest-sam-110-hawk', url: '/workspace/live?section=inbox' });
  assert.equal(pushTarget('chat.message', { guestThreadId: GUEST }).tag, 'recharge-chat', 'only a guest message uses it');
  assert.deepEqual(pushTarget('hub.todo_added', {}), { tag: 'recharge', url: '/workspace/live' });
});

test('the picture: a signed link to the sender\'s photo, otherwise their initials and colour; the private path is never sent', () => {
  const job = { eventType: 'chat.message', details: { who: 'Erika Smith', preview: 'Hi', context: 'Guest relations', conversationId: CONV, senderPhotoPath: 'u/p.jpg', senderColour: 'plum' } };
  const withPhoto = pushPayload(job, undefined, 'https://project.supabase.co/storage/v1/object/sign/avatars/u/p.jpg?token=abc');
  const parts = { thread: 'Guest relations', who: 'Erika Smith', context: 'Guest relations', line: 'Hi', conversation: CONV };
  assert.deepEqual(withPhoto, { title: 'Erika Smith', body: 'Guest relations\nHi', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, icon: 'https://project.supabase.co/storage/v1/object/sign/avatars/u/p.jpg?token=abc', ...parts });
  assert.doesNotMatch(JSON.stringify(withPhoto), /u\/p\.jpg"|senderPhotoPath/);
  assert.deepEqual(pushPayload(job), { title: 'Erika Smith', body: 'Guest relations\nHi', url: `/workspace/live?section=inbox&chat=${CONV}`, tag: 'chat-' + CONV, initials: 'ES', colour: '#5B4A5E', ...parts });
  // A photo in the message: an hour's signed link becomes the pop-up's picture, and the line need not say Photo; without one it does.
  const photo = { ...job, details: { ...job.details, preview: 'The broken tap', attachmentKind: 'image', attachmentPath: CONV + '/x.jpg' } };
  const shown = pushPayload(photo, undefined, null, 'https://project.supabase.co/storage/v1/object/sign/chat-files/x.jpg?token=abc');
  assert.equal(shown.image, 'https://project.supabase.co/storage/v1/object/sign/chat-files/x.jpg?token=abc');
  assert.equal(shown.line, 'The broken tap');
  const unsigned = pushPayload(photo);
  assert.equal(unsigned.image, undefined);assert.equal(unsigned.line, 'Photo: The broken tap');
  assert.equal(pushPayload(photo, undefined, null, 'http://insecure.example/x.jpg').image, undefined, 'only an https link');
  assert.doesNotMatch(JSON.stringify(shown), /attachmentPath|x\.jpg"/, 'the private path never travels');
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
  assert.deepEqual(guest, { title: 'Jack', body: 'Guest · 2 Panmure\nIs there a hairdryer?', url: '/workspace/live?section=inbox', tag: 'guest-jack-2-panmure',
    initials: 'J', colour: '#3B5866', id: 'n42', time: Date.parse('2026-10-20T09:15:00Z'), thread: 'Guest · 2 Panmure', who: 'Jack', context: 'Guest · 2 Panmure', line: 'Is there a hairdryer?' });
  // A team chat: the conversation (the phone adds "(3 messages)" when several wrote), the sender, the message, the unread count,
  // and the conversation to mark read.
  assert.deepEqual(pushThread('chat.message', { who: 'Erika Smith', preview: 'Hi', context: 'Guest relations', conversationKind: 'group', conversationId: CONV.toUpperCase(), unreadCount: 3 }),
    { thread: 'Guest relations', who: 'Erika Smith', context: 'Guest relations', line: 'Hi', count: 3, conversation: CONV });
  assert.deepEqual(pushThread('chat.message', { who: 'Alex', preview: 'Hi', conversationId: 'nope' }), { thread: 'Alex', who: 'Alex', line: 'Hi' });
  // A guest conversation: the guest's conversation to open and mark read, never a team conversation.
  assert.deepEqual(pushThread('guest.message', { who: 'Jack', propertyName: '2 Panmure', preview: 'Thanks', guestThreadId: GUEST, conversationId: CONV }),
    { thread: 'Guest · 2 Panmure', who: 'Jack', context: 'Guest · 2 Panmure', line: 'Thanks', guest: GUEST });
  assert.equal(pushThread('chat.message', { who: 'Alex', guestThreadId: GUEST }).guest, undefined);
  assert.deepEqual(pushPayload({ eventType: 'guest.message', outboxId: 43, details: { who: 'Jack', propertyName: '2 Panmure', preview: 'Thanks', guestThreadId: GUEST } }),
    { title: 'Jack', body: 'Guest · 2 Panmure\nThanks', url: `/workspace/live?section=inbox&guest=${GUEST}`, tag: 'guest-' + GUEST, initials: 'J', colour: '#3B5866', id: 'n43',
      thread: 'Guest · 2 Panmure', who: 'Jack', context: 'Guest · 2 Panmure', line: 'Thanks', guest: GUEST });
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
  assert.match(page, /const \{ chat: chatLink, reply: replyLink, guest: guestLink \} = useLocalSearchParams<\{ chat\?: string; reply\?: string; guest\?: string \}>\(\);/);
  // A guest message opens its guest conversation in Messages > Guests, from the address or from the open window.
  assert.match(page, /openMessages\("guest:" \+ guestLink\.toLowerCase\(\), replyLink === "1"\)/);
  assert.match(page, /else if \(CHAT_LINK\.test\(guest\)\) popupOpen\.current\.openMessages\("guest:" \+ guest\.toLowerCase\(\), params\.get\("reply"\) === "1"\);/);
  const guests = await fs.readFile('mobile/src/LiveGuestInbox.tsx', 'utf8');
  assert.match(guests, /focusReply=\{focusReply && openId === openThread\}/);
  assert.match(guests, /setTimeout\(\(\) => replyBox\.current\?\.focus\(\), 80\)/, 'Reply readies the reply box');
  assert.match(guests, /takeGuestReads\(\)\.then\(read => \{ if \(active\) for \(const \[id, at\] of Object\.entries\(read\)\) mark\(id, at\); \}\)/, 'Mark as read from a pop-up reaches the inbox');
  assert.match(guests, /clearGuestNotices\(id\);/, 'reading a guest conversation takes its pop-up away');
  assert.match(await fs.readFile('mobile/src/LiveChat.tsx', 'utf8'), /openThread=\{guestLink\} focusReply=\{focusReply && !!guestLink\}/);
  assert.match(page, /openMessages\(chat, params\.get\("reply"\) === "1"\)/, 'Reply with Recharge already open');
  assert.match(page, /focusReply=\{!!chatTarget\?\.reply\}/);
  const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8');
  assert.match(chat, /setTimeout\(\(\) => input\.current\?\.focus\(\), 80\)/, 'the message box is ready to type in');
  assert.match(chat, /clearConversationNotices\(id\);/, 'reading a conversation takes its pop-up away');
  // The phone app keeps the general words (its pushes are not end-to-end encrypted) but opens the same place.
  const native = await fs.readFile('lib/integration-providers.ts', 'utf8');
  assert.match(native, /data:\{screen:'activity',url:pushTarget\(job\.eventType,job\.details\?\?\{\}\)\.url\}/);
});
