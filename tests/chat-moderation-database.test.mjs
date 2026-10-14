import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Reporting and blocking in Messages, and the admins' Reported messages view: anyone in a
// conversation reports a message that is not theirs (once), blocking hides a person's messages for
// the blocker only, and admins remove a reported message for everyone (photos and videos too) or
// dismiss the report. Nobody else can moderate.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { chatActionSchema, chatReadSchema, threadSchema, conversationSchema, blockedPeopleSchema, reportedSchema, chatPeopleSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { chatReportsSchema, reportCounts } = await vite.ssrLoadModule('/lib/chat-moderation.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'accounts', 'client', 'admin'];
const names = ['Mark Hunt', 'Maria Cole', 'Dan Fox', 'Ewan Lyle', 'Ava Ross', 'Olive Grant', 'Alex Reid'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, CLEANS, ACCOUNTS, CLIENT, ADMIN2] = roles.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `moderation${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_chat_action', [chatActionSchema.parse(input)]);
const read = (section, target = null) => { chatReadSchema.parse(target ? { section, conversationId: target } : { section }); return rpc('workspace_chat_read', [section, target, null]); };
const thread = async id => threadSchema.parse(await read('messages', id));
const send = (conversationId, body, attachments) => act({ action: 'send', requestId: crypto.randomUUID(), conversationId, body, ...(attachments ? { attachments } : {}) });
const report = (messageId, reason = 'offensive', note, requestId = crypto.randomUUID()) => act({ action: 'reportMessage', requestId, messageId, reason, ...(note === undefined ? {} : { note }) });
const reports = async () => { teamsReadSchema.parse({ section: 'chatReports' }); return chatReportsSchema.parse(await rpc('workspace_teams_read', ['chatReports', null, null, null, null])); };
const decide = async (item, decision, extra = {}) => rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'decideChatReport', requestId: crypto.randomUUID(), reportId: item.id, version: item.version, decision, ...extra })]);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const find = (t, body) => t.messages.find(m => m.body === body);
const files = async ids => rpc('workspace_chat_files', [ids]);
after(async () => { await db.close(); await vite.close(); });

// A group of Stays, Cleans and Accounts; Cleans also has a direct message with Stays.
let group, direct;
const said = {};
test('set-up: a group, a direct message and some messages', async () => {
  await as(STAYS);
  group = conversationSchema.parse(await act({ action: 'startGroup', title: 'Flat 3 turnover', userIds: [users[CLEANS], users[ACCOUNTS]] }));
  direct = conversationSchema.parse(await act({ action: 'startDirect', userId: users[CLEANS] }));
  await send(group.id, 'Keys are in the safe');
  await as(CLEANS);
  for (const body of ['That is rubbish, you are useless', 'Second rude message', 'Spam spam spam']) await send(group.id, body);
  await send(direct.id, 'Direct note from Ewan');
  // A photo-only message.
  const prepared = await act({ action: 'prepareFiles', conversationId: group.id, files: [{ name: 'oops.jpg', mime: 'image/jpeg', bytes: 2048 }] });
  said.fileId = prepared.files[0].id; said.filePath = prepared.files[0].path;
  await send(group.id, '', [said.fileId]);
  const t = await thread(group.id);
  for (const body of ['That is rubbish, you are useless', 'Second rude message', 'Spam spam spam']) said[body] = find(t, body).id;
  said.photo = t.messages.find(m => m.attachments.length).id;
  assert.equal(t.messages.every(m => !m.removed && !m.blocked), true);
});

test('reporting: any participant reports a message that is not theirs, once, and admins are told', async () => {
  await as(ACCOUNTS);
  const rude = said['That is rubbish, you are useless'];
  const made = reportedSchema.parse(await report(rude, 'harassment', '  Keeps doing this  '));
  assert.equal(made.authorId, users[CLEANS]); assert.equal(made.blocked, false);
  // Every active admin and super admin hears; nobody else, and not the reporter.
  for (const i of [SUPER, ADMIN, ADMIN2]) assert.equal(await notified(i, 'chat.reported'), 1, roles[i] + names[i]);
  for (const i of [STAYS, CLEANS, ACCOUNTS, CLIENT]) assert.equal(await notified(i, 'chat.reported'), 0, roles[i]);
  // One open report per person per message.
  await as(ACCOUNTS);
  await assert.rejects(report(rude, 'spam'), /already reported this message/);
  // The same request replays what happened rather than reporting twice.
  const again = crypto.randomUUID();
  await as(STAYS);
  const first = await report(rude, 'offensive', undefined, again);
  assert.deepEqual(await report(rude, 'offensive', undefined, again), first);
  await assert.rejects(report(rude, 'spam'), /already reported this message/);
  assert.equal((await owner("select count(*)::int n from private.chat_reports where message_id=$1", [rude]))[0].n, 2, 'two people, one report each');
  // Your own message, someone else's conversation, a bad reason and a long note.
  await as(CLEANS);
  await assert.rejects(report(rude), /cannot report your own message/);
  await as(CLIENT);
  await assert.rejects(report(rude), /Message not found/);
  await as(ACCOUNTS);
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: said['Second rude message'], reason: 'bogus' }]), /Choose a reason/);
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: said['Second rude message'], reason: 'spam', note: 'x'.repeat(501) }]), /500 characters/);
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: said['Second rude message'], reason: 'spam', extra: 1 }]), /Unknown or oversized/);
  assert.throws(() => chatActionSchema.parse({ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: rude, reason: 'bogus' }));
  assert.throws(() => chatActionSchema.parse({ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: rude, reason: 'spam', note: 'x'.repeat(501) }));
  assert.throws(() => chatActionSchema.parse({ action: 'reportMessage', requestId: crypto.randomUUID(), messageId: rude, reason: 'spam', anonymous: true }));
  // Direct messages are reportable by the other person, and the report is in the table the admins read.
  await as(STAYS);
  const note = conversationSchema.parse((await read('list')).find(c => c.id === direct.id));
  assert.equal(note.id, direct.id);
  const directMessage = (await thread(direct.id)).messages.find(m => m.body === 'Direct note from Ewan');
  reportedSchema.parse(await report(directMessage.id, 'other', 'Not for work'));
  // Nothing reaches the tables directly.
  await assert.rejects(db.query('select * from private.chat_reports'), /permission denied/);
  await assert.rejects(db.query('select * from private.chat_blocks'), /permission denied/);
});

test('reports are limited to ten an hour', async () => {
  await as(CLEANS);
  const ids = [];
  for (let n = 0; n < 11; n++) ids.push((await send(group.id, `Limit message ${n}`)).id);
  await as(ADMIN2);
  // Admin 2 is not in the group, so they are put in it (directly in the table) just to have messages to report.
  await owner('insert into private.chat_members(conversation_id,user_id) values($1,$2) on conflict do nothing', [group.id, users[ADMIN2]]);
  await as(ADMIN2);
  for (const id of ids.slice(0, 10)) await report(id, 'spam');
  await assert.rejects(report(ids[10], 'spam'), /a lot of reports/);
  await owner('delete from private.chat_members where conversation_id=$1 and user_id=$2', [group.id, users[ADMIN2]]);
});

test('blocking hides a person for the blocker only, and stops new direct conversations', async () => {
  await as(ACCOUNTS);
  const before = await read('list');
  const unreadBefore = conversationSchema.parse(before.find(c => c.id === group.id)).unread;
  assert.ok(unreadBefore > 0);
  // Not someone you share nothing with, and not yourself.
  await assert.rejects(act({ action: 'blockUser', userId: users[CLIENT] }), /Person not found/);
  await assert.rejects(act({ action: 'blockUser', userId: users[ACCOUNTS] }), /someone else/);
  await act({ action: 'blockUser', userId: users[CLEANS] });
  await act({ action: 'blockUser', userId: users[CLEANS] });
  const blocks = blockedPeopleSchema.parse(await read('blocks'));
  assert.deepEqual(blocks.map(b => [b.userId, b.fullName]), [[users[CLEANS], 'Ewan Lyle']]);
  // Their words, photos and reactions are withheld; everyone else's are not.
  let t = await thread(group.id);
  const rude = t.messages.find(m => m.id === said['That is rubbish, you are useless']);
  assert.deepEqual([rude.blocked, rude.body, rude.attachments.length, rude.reactions.length, rude.mine], [true, '', 0, 0, false]);
  assert.equal(rude.authorName, 'Ewan Lyle');
  assert.equal(t.messages.find(m => m.id === said.photo).blocked, true);
  assert.equal(find(t, 'Keys are in the safe').blocked, false);
  assert.equal(t.messages.some(m => m.body.includes('rubbish')), false, 'the words never reach the blocker');
  // Not unread, not shown in the list, no files.
  const listed = conversationSchema.parse((await read('list')).find(c => c.id === group.id));
  assert.equal(listed.unread, 1, 'only Dan\'s message counts; Ewan\'s do not');
  assert.equal(listed.last.body, 'Message from someone you blocked');
  assert.equal(await read('unread') >= 0, true);
  assert.deepEqual(await files([said.fileId]), [], 'no photo from someone you blocked');
  await assert.rejects(act({ action: 'react', messageId: rude.id, emoji: '👍' }), /Message not found/);
  // Nobody else notices: the others still read everything, and still open the photo.
  await as(STAYS);
  t = await thread(group.id);
  assert.equal(find(t, 'That is rubbish, you are useless').body, 'That is rubbish, you are useless');
  assert.equal(t.messages.every(m => !m.blocked), true);
  assert.equal((await files([said.fileId])).length, 1);
  // No notification for a message from someone you blocked; others still get theirs.
  await owner('delete from private.workspace_notification_outbox');
  await as(ACCOUNTS); await act({ action: 'markRead', conversationId: group.id });
  await as(STAYS); await act({ action: 'markRead', conversationId: group.id });
  await as(CLEANS);
  await send(group.id, 'Hello again everyone');
  assert.equal(await notified(ACCOUNTS, 'chat.message'), 0, 'the blocker is not notified');
  assert.equal(await notified(STAYS, 'chat.message'), 1);
  // A new direct conversation, either way round, cannot be started; Ewan has none with Ava.
  await assert.rejects(act({ action: 'startDirect', userId: users[ACCOUNTS] }), /cannot start a new conversation/);
  await as(ACCOUNTS);
  await assert.rejects(act({ action: 'startDirect', userId: users[CLEANS] }), /cannot start a new conversation/);
  const people = chatPeopleSchema.parse(await read('people'));
  assert.equal(people.team.some(x => x.userId === users[CLEANS]), false, 'not offered in New message');
  await as(CLEANS);
  assert.equal(chatPeopleSchema.parse(await read('people')).team.some(x => x.userId === users[ACCOUNTS]), false, 'nor are they offered to the blocked person');
  // An existing conversation carries on: Stays blocks Ewan, whose direct messages are hidden from Dan only.
  await as(STAYS);
  await act({ action: 'blockUser', userId: users[CLEANS] });
  assert.equal(conversationSchema.parse(await act({ action: 'startDirect', userId: users[CLEANS] })).id, direct.id, 'the existing conversation is returned, never a new one');
  t = await thread(direct.id);
  assert.deepEqual(t.messages.map(m => [m.body, m.blocked]), [['', true]]);
  await as(CLEANS);
  assert.equal(find(await thread(direct.id), 'Direct note from Ewan').blocked, false, 'the blocked person sees their own words');
  await send(direct.id, 'Anyone there?');
  // Unblocking brings it all back.
  await as(ACCOUNTS);
  await act({ action: 'unblockUser', userId: users[CLEANS] });
  await act({ action: 'unblockUser', userId: users[CLEANS] });
  assert.deepEqual(blockedPeopleSchema.parse(await read('blocks')), []);
  t = await thread(group.id);
  assert.equal(find(t, 'That is rubbish, you are useless').blocked, false);
  assert.equal(find(t, 'That is rubbish, you are useless').body, 'That is rubbish, you are useless');
  assert.equal(conversationSchema.parse((await read('list')).find(c => c.id === group.id)).last.body, 'Hello again everyone');
  assert.equal((await files([said.fileId])).length, 1);
  assert.ok(chatPeopleSchema.parse(await read('people')).team.some(x => x.userId === users[CLEANS]));
  await as(STAYS);
  await act({ action: 'unblockUser', userId: users[CLEANS] });
});

test('blocking an admin only hides them for you, in shared channels too; owners can block as well', async () => {
  await as(ADMIN);
  await act({ action: 'openTeams' });
  const everyone = conversationSchema.parse((await read('list')).find(c => c.department === 'all'));
  await send(everyone.id, 'Rota change for Friday');
  await as(ACCOUNTS);
  await act({ action: 'blockUser', userId: users[ADMIN] });
  assert.equal((await thread(everyone.id)).messages[0].blocked, true, 'hidden for the blocker');
  await as(STAYS);
  assert.equal((await thread(everyone.id)).messages[0].body, 'Rota change for Friday', 'still there for everyone else');
  await as(ACCOUNTS);
  await act({ action: 'unblockUser', userId: users[ADMIN] });
  // An owner's conversation with Recharge: an owner can hide a team member's replies, by the name the app shows.
  await as(CLIENT);
  const ownerThread = conversationSchema.parse(await act({ action: 'startOwner' }));
  await send(ownerThread.id, 'Can someone ring me?');
  await as(ADMIN);
  await send(ownerThread.id, 'Of course, calling now');
  await as(CLIENT);
  await act({ action: 'blockUser', userId: users[ADMIN] });
  assert.deepEqual(blockedPeopleSchema.parse(await read('blocks')).map(b => b.fullName), ['Recharge · Maria']);
  assert.equal((await thread(ownerThread.id)).messages.at(-1).blocked, true);
  await as(SUPER);
  assert.equal((await thread(ownerThread.id)).messages.at(-1).blocked, false, 'the rest of the team still answers');
  await as(CLIENT);
  await act({ action: 'unblockUser', userId: users[ADMIN] });
});

test('only admins and super admins read the reported messages; they see who, what and why', async () => {
  for (const i of [STAYS, CLEANS, ACCOUNTS, CLIENT]) {
    await as(i);
    await assert.rejects(reports(), /Moderation access required/, roles[i]);
  }
  await as(ADMIN);
  const list = await reports();
  assert.ok(list.open >= 4);
  const rude = list.items.filter(r => r.messageId === said['That is rubbish, you are useless']);
  assert.equal(rude.length, 2);
  const mine = rude.find(r => r.reporterName === 'Ava Ross');
  assert.deepEqual([mine.status, mine.reason, mine.note, mine.authorName, mine.authorRole, mine.body, mine.conversation, mine.sameMessageReports], ['open', 'harassment', 'Keeps doing this', 'Ewan Lyle', 'cleans', 'That is rubbish, you are useless', 'Flat 3 turnover', 2]);
  assert.equal(list.items.find(r => r.reason === 'other').conversation, 'Direct message: Dan Fox and Ewan Lyle');
  assert.ok(list.items.every((r, i, all) => i === 0 || all[i - 1].status === 'open' || r.status !== 'open'), 'open reports first');
  assert.ok(mine.authorReports >= 2);
  assert.equal(reportCounts(list.items).open, list.open);
  // Admins can open the photo of a reported message to judge it, while the report is open.
  const photoReport = await (async () => { await as(ACCOUNTS); await report(said.photo, 'media', 'Not for work'); await as(ADMIN); return (await reports()).items.find(r => r.messageId === said.photo); })();
  assert.equal(photoReport.attachmentCount, 1); assert.equal(photoReport.attachments.length, 1); assert.equal(photoReport.attachments[0].kind, 'image');
  assert.equal((await files([said.fileId])).length, 1, 'an admin outside the group opens it for the report');
  // Not the files of an unreported message.
  await as(ADMIN2);
  assert.equal((await files([said.fileId])).length, 1);
  await as(CLIENT);
  assert.deepEqual(await files([said.fileId]), []);
  await as(SUPER);
  assert.ok((await reports()).items.length >= 5);
});

test('an admin removes a reported message for everyone, with its photos; every open report on it is closed together', async () => {
  await as(ADMIN);
  const list = await reports();
  const first = list.items.find(r => r.messageId === said['That is rubbish, you are useless'] && r.reporterName === 'Ava Ross');
  // Stale versions and non-admins.
  await as(STAYS);
  await assert.rejects(decide(first, 'remove'), /Moderation access required/);
  await as(ADMIN);
  await assert.rejects(decide({ ...first, version: first.version + 5 }, 'remove'), /Changed by someone else/);
  assert.throws(() => teamsActionSchema.parse({ action: 'decideChatReport', requestId: crypto.randomUUID(), reportId: first.id, version: 1, decision: 'ban' }));
  const requestId = crypto.randomUUID();
  const done = await decide(first, 'remove', { requestId });
  assert.equal(done.status, 'actioned'); assert.equal(done.removed, true); assert.equal(done.handledByName, 'Maria Cole'); assert.deepEqual(done.paths, []);
  assert.deepEqual(await decide(first, 'remove', { requestId }), done, 'the same request replays');
  // Both reporters are told it was reviewed and removed; the sender is told once; nobody is named; replays add nothing.
  const tally = async () => Promise.all([ACCOUNTS, STAYS, CLEANS, ADMIN].map(async i => [await notified(i, 'chat.report_removed'), await notified(i, 'chat.report_reviewed'), await notified(i, 'chat.message_removed')]));
  assert.deepEqual(await tally(), [[1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0]]);
  await decide(first, 'remove', { requestId });
  assert.deepEqual(await tally(), [[1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0]], 'replaying the request does not repeat the notices');
  assert.equal((await owner("select count(*)::int n from public.workspace_activity where event_type in ('chat.report_removed','chat.report_reviewed','chat.message_removed') and actor_id is not null"))[0].n, 0, 'no admin is named');
  const after = await reports();
  const sameMessage = after.items.filter(r => r.messageId === first.messageId);
  assert.deepEqual(sameMessage.map(r => r.status), ['actioned', 'actioned'], 'both reporters\' reports are closed');
  assert.deepEqual(reportCounts(after.items), { open: after.open, actioned: 2, dismissed: 0, all: after.items.length });
  // Hidden for everyone, including the person who wrote it; replaced in the list too.
  for (const i of [STAYS, CLEANS, ACCOUNTS]) {
    await as(i);
    const m = (await thread(group.id)).messages.find(x => x.id === first.messageId);
    assert.deepEqual([m.removed, m.body, m.attachments.length], [true, '', 0], roles[i]);
  }
  await assert.rejects(act({ action: 'react', messageId: first.messageId, emoji: '👍' }), /Message not found/);
  await assert.rejects(report(first.messageId), /Message not found|already been removed/);
  // Already dealt with.
  await as(ADMIN);
  const closed = (await reports()).items.find(r => r.id === first.id);
  await assert.rejects(decide(closed, 'dismiss'), /already been dealt with/);
  // Removing the photo message stops access to its file for everyone, admins included, and lists its stored path.
  const photo = (await reports()).items.find(r => r.messageId === said.photo);
  await as(SUPER);
  const removed = await decide(photo, 'remove');
  assert.deepEqual(removed.paths, [said.filePath]);
  for (const i of [STAYS, CLEANS, ACCOUNTS, ADMIN, SUPER, ADMIN2]) { await as(i); assert.deepEqual(await files([said.fileId]), [], roles[i]); }
  await as(STAYS);
  const gone = (await thread(group.id)).messages.find(m => m.id === said.photo);
  assert.deepEqual([gone.removed, gone.attachments.length], [true, 0]);
  // The conversation list says so too, and a removed message is not unread.
  await as(STAYS);
  await act({ action: 'markRead', conversationId: direct.id });
  await as(CLEANS);
  await send(direct.id, 'A very rude direct message');
  await as(STAYS);
  const rudeDirect = find(await thread(direct.id), 'A very rude direct message');
  await report(rudeDirect.id, 'offensive');
  await as(ADMIN);
  await decide((await reports()).items.find(r => r.messageId === rudeDirect.id), 'remove');
  await as(STAYS);
  const row = conversationSchema.parse((await read('list')).find(c => c.id === direct.id));
  assert.deepEqual([row.last.body, row.unread], ['Message removed', 0]);
});

test('dismissing a report leaves the message; nobody decides a report about their own message', async () => {
  await as(ADMIN);
  const spam = (await reports()).items.find(r => r.messageId === said['Spam spam spam']);
  assert.equal(spam, undefined, 'nobody has reported it yet');
  await as(STAYS);
  await report(said['Spam spam spam'], 'spam');
  await as(ADMIN2);
  const item = (await reports()).items.find(r => r.messageId === said['Spam spam spam']);
  const senderTold = await notified(CLEANS, 'chat.message_removed');
  const dismissed = await decide(item, 'dismiss');
  assert.equal(dismissed.status, 'dismissed'); assert.equal(dismissed.removed, false); assert.equal(dismissed.paths, undefined);
  // The reporter hears it was left in place; the sender is not told anything more.
  assert.deepEqual([await notified(STAYS, 'chat.report_reviewed'), await notified(STAYS, 'chat.message_removed'), await notified(CLEANS, 'chat.message_removed')], [1, 0, senderTold]);
  assert.equal(await notified(CLEANS, 'chat.report_reviewed'), 0);
  await as(CLEANS);
  assert.equal(find(await thread(group.id), 'Spam spam spam').body, 'Spam spam spam');
  await as(ADMIN2);
  assert.equal(reportCounts((await reports()).items).dismissed, 1);
  // A dismissed report no longer stops the same person reporting it again.
  await as(STAYS);
  await report(said['Spam spam spam'], 'spam');
  // An admin's own message is reviewed by someone else.
  await as(ADMIN);
  await act({ action: 'openTeams' });
  const everyone = conversationSchema.parse((await read('list')).find(c => c.department === 'all'));
  await send(everyone.id, 'Everyone must work Sunday');
  const posted = find(await thread(everyone.id), 'Everyone must work Sunday');
  await as(ACCOUNTS);
  await report(posted.id, 'other', 'Not agreed with us');
  await as(ADMIN);
  const theirs = (await reports()).items.find(r => r.messageId === posted.id);
  await assert.rejects(decide(theirs, 'remove'), /Another admin needs to review/);
  await as(SUPER);
  assert.equal((await decide(theirs, 'dismiss')).status, 'dismissed');
});

test('applying the migration again changes nothing', async () => {
  const before = (await owner("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::text)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like any(array['workspace_chat_%','chat_%','workspace_teams_%'])"))[0].h;
  // 20261020300000 replaces the reports read whole (guest and client message reports beside these), so it runs again after them.
  for (const file of ['20261012010000_chat_reports_blocks.sql', '20261012030000_chat_report_outcomes.sql', '20261020300000_inbox_message_reports.sql']) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  const after2 = (await owner("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::text)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like any(array['workspace_chat_%','chat_%','workspace_teams_%'])"))[0].h;
  assert.equal(after2, before);
  assert.ok(migrations.includes('20261012010000_chat_reports_blocks.sql') && migrations.includes('20261012030000_chat_report_outcomes.sql'));
});
