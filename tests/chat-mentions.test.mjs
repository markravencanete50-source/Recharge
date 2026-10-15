import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// @mentions in team group chats (Lee: "like WhatsApp"): "@" opens a list of the people in the conversation and @everyone, narrowed
// as you type; picking one writes "@Name " into the message; the bubble shows mentions in bold in the primary colour, your own
// name most of all; the list shows "@" on a conversation with an unread mention. The database side: chat-mentions-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const m = await vite.ssrLoadModule('/lib/chat-mentions.ts');
const { chatActionSchema, conversationSchema, messageSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const people = [
  { userId: '5a1e0000-0000-4000-8000-000000000001', fullName: 'Erika Smith', you: true },
  { userId: '5a1e0000-0000-4000-8000-000000000002', fullName: 'Alex Coghill' },
  { userId: '5a1e0000-0000-4000-8000-000000000003', fullName: 'Alexandra Kerr' },
  { userId: '5a1e0000-0000-4000-8000-000000000004', fullName: 'Mark Raven' },
  { userId: '5a1e0000-0000-4000-8000-000000000005', fullName: 'Mark' },
];
const [, ALEX, ALEXANDRA, MARK, MARK_ONLY] = people.map(p => p.userId);

test('"@" opens the list where a word starts, and not inside an email address', () => {
  assert.deepEqual(m.mentionQuery('@'), { start: 0, query: '' });
  assert.deepEqual(m.mentionQuery('Hi @Al'), { start: 3, query: 'Al' });
  assert.deepEqual(m.mentionQuery('Hi @Alex Cog'), { start: 3, query: 'Alex Cog' });
  assert.deepEqual(m.mentionQuery('line one\n@Ma'), { start: 9, query: 'Ma' });
  assert.equal(m.mentionQuery('mail erika@example.com'), null);
  assert.equal(m.mentionQuery('@ '), null, 'a space straight after closes it');
  assert.equal(m.mentionQuery('@Alex Coghill and then some more words'), null, 'a whole sentence later it is closed');
  // The caret counts: typing in the middle of the text.
  assert.deepEqual(m.mentionQuery('Hi @Al, see you', 6), { start: 3, query: 'Al' });
});

test('the list: people whose name starts with what is typed, then @everyone; never you', () => {
  assert.deepEqual(m.mentionOptions('', people).map(o => o.label), ['Alex Coghill', 'Alexandra Kerr', 'Mark', 'Mark Raven', 'everyone']);
  assert.deepEqual(m.mentionOptions('al', people).map(o => o.label), ['Alex Coghill', 'Alexandra Kerr', 'everyone'], '"al" is also @all');
  assert.deepEqual(m.mentionOptions('rav', people).map(o => o.label), ['Mark Raven']);
  assert.deepEqual(m.mentionOptions('ev', people).map(o => o.kind), ['everyone']);
  assert.deepEqual(m.mentionOptions('erika', people), [], 'you are not listed');
  assert.equal(m.mentionOptions('', people, 2).filter(o => o.kind === 'person').length, 2);
});

test('picking writes "@Name " in place of what was typed, and the caret goes after it', () => {
  const picked = m.insertMention('Hi @al can you', 3, 6, { kind: 'person', userId: ALEX, label: 'Alex Coghill' });
  assert.deepEqual(picked, { text: 'Hi @Alex Coghill can you', caret: 17 });
  assert.deepEqual(m.insertMention('@ev', 0, 3, { kind: 'everyone', label: 'everyone' }), { text: '@everyone ', caret: 10 });
});

test('who a message mentions comes from the people in the conversation, longest name first; @all is everyone', () => {
  assert.deepEqual(m.mentionsIn('@Alex Coghill and @Mark Raven, see @Mark', people), { userIds: [ALEX, MARK, MARK_ONLY], everyone: false });
  assert.deepEqual(m.mentionsIn('@alexandra kerr hi', people), { userIds: [ALEXANDRA], everyone: false }, 'any case');
  assert.deepEqual(m.mentionsIn('@Alexander hi', people), { userIds: [], everyone: false }, 'not part of a longer word');
  assert.deepEqual(m.mentionsIn('@Erika Smith note to self', people), { userIds: [], everyone: false });
  assert.deepEqual(m.mentionsIn('@everyone the boiler is fixed', people), { userIds: [], everyone: true });
  assert.deepEqual(m.mentionsIn('ok @all', people), { userIds: [], everyone: true });
  assert.deepEqual(m.mentionsIn('erika@all.com', people), { userIds: [], everyone: false });
});

test('the bubble highlights only what the message really mentions; yours stands out', () => {
  const parts = m.mentionParts('@Alex Coghill and @Erika Smith, @Mark Raven was not mentioned', [{ name: 'Alex Coghill', you: false }, { name: 'Erika Smith', you: true }], false);
  assert.deepEqual(parts, [
    { text: '@Alex Coghill', mention: 'other' }, { text: ' and ' }, { text: '@Erika Smith', mention: 'you' }, { text: ', @Mark Raven was not mentioned' },
  ]);
  assert.deepEqual(m.mentionParts('@all go home', [], true), [{ text: '@all', mention: 'everyone' }, { text: ' go home' }]);
  assert.deepEqual(m.mentionParts('@all go home', [], false), [{ text: '@all go home' }], 'typed but not a mention');
  assert.deepEqual(m.mentionParts('', [], true), []);
});

test('the request and the replies carry mentions', () => {
  const id = ALEX;
  assert.ok(chatActionSchema.parse({ action: 'send', requestId: id, conversationId: id, body: '@Alex hi', mentions: [ALEX], mentionEveryone: true }));
  assert.throws(() => chatActionSchema.parse({ action: 'send', requestId: id, conversationId: id, body: 'hi', mentions: ['Alex'] }));
  assert.equal(conversationSchema.shape.mentioned.parse(undefined), false);
  const msg = messageSchema.parse({ id, body: 'hi', at: '2026-10-15T09:00:00Z', mine: false, authorName: 'Alex' });
  assert.deepEqual([msg.mentions, msg.mentionsEveryone], [[], false], 'older replies read as no mentions');
});

test('the composer: the list above the box in group conversations only, Enter or a tap picks, Escape closes; mentions are sent as ids', async () => {
  const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8'), parts = await fs.readFile('mobile/src/ChatParts.tsx', 'utf8');
  assert.match(chat, /const mentionable = c\?\.kind === "group" && !readOnly;/, 'team channels and group chats; not 1-to-1, owners or email');
  assert.match(chat, /const typing = mentionable \? mentionQuery\(text, caret\) : null;/);
  assert.match(chat, /<MentionPicker p=\{p\} options=\{options\} members=\{members\?\.members \?\? \[\]\} onPick=\{pickMention\} \/>/);
  assert.match(chat, /if \(options\.length && \(key\.key === "Enter" \|\| key\.key === "Tab"\) && !key\.shiftKey\) \{ stop\(\); pickMention\(options\[0\]\); return; \}/);
  assert.match(chat, /key\.key === "Escape" && typing\) \{ stop\(\); setDismissed\(typing\.start\); return; \}/);
  assert.match(chat, /const mentioned = mentionable \? mentionsIn\(body, mentionPeople\) : \{ userIds: \[\], everyone: false \};/);
  assert.match(chat, /\.\.\.\(mentioned\.userIds\.length \? \{ mentions: mentioned\.userIds \} : \{\}\), \.\.\.\(mentioned\.everyone \? \{ mentionEveryone: true \} : \{\}\)/);
  // The picker: each person's photo and name, and @everyone.
  assert.match(parts, /export function MentionPicker\(/);
  assert.match(parts, /accessibilityRole="menu" accessibilityLabel="Mention someone"/);
  assert.match(parts, /<PersonAvatar p=\{p\} name=\{o\.label\} userId=\{o\.userId\} photo=\{person\?\.photo\}/);
  assert.match(parts, /"Tell everyone in this conversation"/);
});

test('the bubble and the list: bold primary mentions, yours on a wash; "@" on a conversation that mentions you', async () => {
  const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8'), parts = await fs.readFile('mobile/src/ChatParts.tsx', 'utf8');
  assert.match(chat, /<MessageText p=\{p\} m=\{m\} \/>/);
  assert.match(parts, /const parts = mentionParts\(m\.body, m\.mentions, m\.mentionsEveryone\);/);
  assert.match(parts, /fontWeight: "700", color: m\.mine \? p\.onPrimary : p\.primary/);
  assert.match(parts, /part\.mention === "you" \? \{ backgroundColor: m\.mine \? "rgba\(255,255,255,0\.24\)" : p\.wash/);
  assert.match(chat, /\{c\.mentioned && <View \{\.\.\.\(Platform\.OS === "web" \? \{ dataSet: \{ mentioned: "true" \} \} : \{\}\)\}/);
  assert.match(chat, />@<\/Text><\/View>\}/);
  assert.match(chat, /\$\{c\.mentioned \? ", you were mentioned" : ""\}/);
});
