import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Reporting guest and client messages (Lee, 14 October): the same "…" menu and report sheet as Team chat on every incoming
// message in Messages > Guests and Clients, and the reports in the same Reported messages view, where admins hide a message in
// the app or dismiss the report. The database side is tests/inbox-message-reports-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const chat = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const teams = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const mod = await vite.ssrLoadModule('/lib/chat-moderation.ts');
const guestPolicy = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const emailPolicy = await vite.ssrLoadModule('/lib/client-email-policy.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const read = f => readFileSync(f, 'utf8');
const ID = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222';

test('the report is a chat action for a guest message or a client email, with the Team chat reasons', () => {
  const ok = chat.chatActionSchema.parse({ action: 'reportInboxMessage', requestId: ID, source: 'guest', messageId: ID2, reason: 'harassment', note: ' Threats ' });
  assert.equal(ok.note, 'Threats');
  assert.ok(chat.chatActionSchema.safeParse({ action: 'reportInboxMessage', requestId: ID, source: 'client_email', messageId: ID2, reason: 'spam' }).success);
  for (const bad of [{ source: 'chat' }, { reason: 'rude' }, { note: 'x'.repeat(501) }, { blockUser: true }])
    assert.ok(!chat.chatActionSchema.safeParse({ action: 'reportInboxMessage', requestId: ID, source: 'guest', messageId: ID2, reason: 'spam', ...bad }).success, JSON.stringify(bad));
});

test('the decision is hide or dismiss, never remove or block', () => {
  for (const decision of ['hide', 'dismiss']) assert.ok(teams.teamsActionSchema.safeParse({ action: 'decideMessageReport', requestId: ID, reportId: ID2, version: 1, decision }).success);
  for (const decision of ['remove', 'block']) assert.ok(!teams.teamsActionSchema.safeParse({ action: 'decideMessageReport', requestId: ID, reportId: ID2, version: 1, decision }).success);
});

test('one list of reports: Team chat reports read as before, guest and client ones carry their source and conversation', () => {
  const base = { id: ID, status: 'open', reason: 'offensive', note: '', createdAt: '2026-10-14T09:00:00Z', version: 1, messageId: ID2, conversationId: ID, conversation: 'Team channel',
    body: 'Hello', sentAt: '2026-10-14T08:00:00Z', removed: false, removedAt: null, attachmentCount: 0, authorName: 'Fiona', authorRole: 'stays', reporterId: ID2, reporterName: 'Ada',
    handledAt: null, handledByName: null, sameMessageReports: 1, authorReports: 1 };
  const old = mod.chatReportSchema.parse({ ...base, authorId: ID });
  assert.deepEqual([old.source, old.openId, mod.isInboxReport(old)], ['chat', null, false]);
  const guest = mod.chatReportSchema.parse({ ...base, source: 'guest_message', openId: 'guest:' + ID, propertyName: 'Harbour View', authorId: null, authorRole: null, status: 'actioned', removed: true });
  assert.deepEqual([mod.REPORT_SOURCE_LABEL[guest.source], mod.reportStatusLabel(guest), mod.reportStatusLabel({ ...old, status: 'actioned' })], ['Guest message', 'Hidden in the app', 'Message removed']);
  assert.deepEqual(['guest_email', 'client_email'].map(s => mod.REPORT_SOURCE_LABEL[s]), ['Guest email', 'Client email']);
  assert.match(mod.HIDE_EXPLAINED, /Airbnb, Booking\.com or the sender’s mailbox/);
  assert.equal(mod.HIDDEN_LABEL, 'Hidden by an admin');
});

test('a hidden message reads as hidden in both conversations; older reads without the flag still parse', () => {
  const g = { id: ID, direction: 'guest', body: '', sentAt: '2026-10-14T08:00:00Z', delivery: null, author: null };
  assert.equal(guestPolicy.guestMessageSchema.parse({ ...g, hidden: true }).hidden, true);
  assert.equal(guestPolicy.guestMessageSchema.parse(g).hidden, false);
  const thread = { id: ID, address: 'nia@example.org', name: 'Nia', subject: 'Flat', status: 'open', lastMessageAt: null, preview: null, lastFrom: 'in', waitingSince: null, messages: 1 };
  const email = { id: ID, direction: 'in', body: '', sentAt: '2026-10-14T08:00:00Z', author: null };
  assert.equal(emailPolicy.clientEmailDetailSchema.parse({ thread, messages: [{ ...email, hidden: true }] }).messages[0].hidden, true);
  assert.equal(emailPolicy.clientEmailDetailSchema.parse({ thread, messages: [email] }).messages[0].hidden, false);
});

test('Guests and Clients: one "…" per incoming message, the Team chat sheet, no block, our own messages untouched', () => {
  for (const file of ['mobile/src/LiveGuestInbox.tsx', 'mobile/src/ClientEmailThread.tsx']) {
    const src = read(file);
    assert.equal(src.match(/<MessageMenuButton /g)?.length, 1, file);
    assert.match(src, /\{!team && <MessageMenuButton p=\{p\} onPress=\{\(\) => setReporting\(m\)\} \/>\}/);
    assert.match(src, /\{m\.hidden \? <HiddenMessage p=\{p\} \/> :/);
    assert.match(src, /<InboxMessageSafety key=\{reporting\.id\} p=\{p\} source="(guest|client_email)"/);
  }
  const sheet = read('mobile/src/ChatSafety.tsx');
  const inbox = sheet.slice(sheet.indexOf('export function InboxMessageSafety'));
  assert.ok(!/Block|blockUser/.test(inbox), 'no block for guests or email senders');
  assert.match(inbox, /action: "reportInboxMessage"/);
  assert.equal(sheet.match(/<ReportForm /g).length, 2, 'one report form, shared with Team chat');
  assert.match(inbox, /<Button label="Report message" icon="flag"/);
});

test('Reported messages: labelled by source, hidden rather than removed, with a link to the conversation', () => {
  const src = read('mobile/src/LiveModeration.tsx');
  assert.match(src, /action: "decideMessageReport"/);
  assert.match(src, /inbox \? "Hide in the app" : "Remove message"/);
  assert.match(src, /inbox \? HIDE_EXPLAINED :/);
  assert.match(src, /Open the conversation/);
  assert.match(src, /REPORT_SOURCE_LABEL\[r\.source\], r\.propertyName/);
  assert.match(read('mobile/src/LiveWorkspace.tsx'), /<LiveModeration palette=\{p\} onOpenConversation=\{openMessages\} \/>/);
  const chatList = read('mobile/src/LiveChat.tsx');
  assert.match(chatList, /guestLink \? "guests" : openConversation\?\.startsWith\("email:"\) \? "clientEmails"/);
  assert.match(chatList, /openThread=\{guestLink\}/);
});

test('admins are told, then whoever reported it; the words are plain', () => {
  assert.equal(noticeCopy('inbox.reported').title, 'A guest or client message was reported');
  assert.match(noticeCopy('inbox.report_hidden').message, /hid the message you reported in the app/);
  for (const file of ['mobile/src/ChatSafety.tsx', 'mobile/src/LiveModeration.tsx', 'mobile/src/LiveGuestInbox.tsx', 'mobile/src/ClientEmailThread.tsx', 'lib/chat-moderation.ts',
    'supabase/migrations/20261020300000_inbox_message_reports.sql', 'tests/inbox-message-reports-database.test.mjs']) {
    assert.ok(!read(file).includes(String.fromCharCode(0x2014)), 'no em dashes: ' + file);
  }
  for (const file of ['mobile/src/ChatSafety.tsx', 'mobile/src/LiveModeration.tsx']) assert.doesNotMatch(read(file), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'theme colours only: ' + file);
  assert.ok(!/(^|[^\r])\n/.test(read('supabase/migrations/20261020300000_inbox_message_reports.sql')), 'the migration keeps CRLF line endings');
});
