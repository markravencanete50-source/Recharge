import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Messages like a messenger: reactions, photos and a video in a message, groups anyone starts and
// adds people to, who is online, and your own profile (photo, colour, a line about you).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { chatActionSchema, chatReadSchema, threadSchema, conversationSchema, membersSchema, chatPeopleSchema, chatFilesProblem, presenceLabel, presenceOf } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { workspaceAccountSchema } = await vite.ssrLoadModule('/lib/workspace-account-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'client', 'accounts'];
const names = ['Sam Reid', 'Morag Dunn', 'Fiona Hay', 'Isla Kerr', 'Owner Grant', 'Graham Bell'];
const users = roles.map((_, i) => `97800000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, , STAYS, CLEANER, OWNER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9780', '9880');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `chat${i}@example.com`]);
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
const send = (conversationId, body, attachments) => act({ action: 'send', requestId: crypto.randomUUID(), conversationId, body, ...(attachments ? { attachments } : {}) });
after(async () => { await db.close(); await vite.close(); });

let group;
test('anyone on the team starts a group, sees who is in it and adds people', async () => {
  await as(STAYS);
  group = conversationSchema.parse(await act({ action: 'startGroup', userIds: [users[CLEANER]] }));
  assert.equal(group.title, 'Isla', 'a group with no name is called after its people');
  assert.equal(group.named, false);
  let members = membersSchema.parse(await read('members', group.id));
  assert.deepEqual(members.members.map(m => [m.fullName, m.you, m.creator]), [['Fiona Hay', true, true], ['Isla Kerr', false, false]]);
  assert.deepEqual([members.canAdd, members.canRemove], [true, true]);
  await as(CLEANER);
  assert.equal(membersSchema.parse(await read('members', group.id)).canRemove, false, 'only whoever started it removes people');
  await act({ action: 'addMembers', conversationId: group.id, userIds: [users[ACCOUNTS], users[CLEANER]] });
  await assert.rejects(act({ action: 'addMembers', conversationId: group.id, userIds: [users[OWNER]] }), /Only team members/);
  members = membersSchema.parse(await read('members', group.id));
  assert.deepEqual(members.members.map(m => m.fullName), ['Isla Kerr', 'Fiona Hay', 'Graham Bell']);
  const thread = threadSchema.parse(await read('messages', group.id));
  assert.deepEqual(thread.messages.map(m => [m.kind, m.authorName, m.body]), [['event', 'You', 'added Graham Bell']]);
  await assert.rejects(act({ action: 'removeMember', conversationId: group.id, userId: users[ACCOUNTS] }), /Only whoever started the group/);
  await act({ action: 'renameGroup', conversationId: group.id, title: 'Flat 3 deep clean' });
  // Lines about the group are never unread.
  await as(ACCOUNTS);
  const listed = (await read('list')).map(c => conversationSchema.parse(c)).find(c => c.id === group.id);
  assert.deepEqual([listed.title, listed.unread, listed.last.kind, listed.last.body], ['Flat 3 deep clean', 0, 'event', 'named the group Flat 3 deep clean']);
  await act({ action: 'removeMember', conversationId: group.id, userId: users[ACCOUNTS] });
  await assert.rejects(read('messages', group.id), /Conversation not found/, 'after leaving');
  // Team channels and owner conversations do not take people.
  await as(SUPER);
  await act({ action: 'openTeams' });
  const everyone = (await read('list')).find(c => c.department === 'all');
  await assert.rejects(act({ action: 'addMembers', conversationId: everyone.id, userIds: [users[ACCOUNTS]] }), /Only group conversations/);
  const channel = membersSchema.parse(await read('members', everyone.id));
  assert.equal(channel.canAdd, false);
  assert.equal(channel.members.some(m => m.creator), false, 'nobody started a team channel');
  assert.deepEqual(channel.members.map(m => m.fullName).sort(), ['Fiona Hay', 'Graham Bell', 'Isla Kerr', 'Morag Dunn', 'Sam Reid'], 'the whole team, never owners');
});

test('reactions: one each, the same again takes it off', async () => {
  await as(STAYS);
  const sent = await send(group.id, 'Keys are in the safe');
  await as(CLEANER);
  await act({ action: 'react', messageId: sent.id, emoji: '👍' });
  await as(STAYS);
  await act({ action: 'react', messageId: sent.id, emoji: '👍' });
  let message = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.id === sent.id);
  assert.deepEqual(message.reactions, [{ emoji: '👍', count: 2, mine: true, names: ['Isla', 'You'] }]);
  await act({ action: 'react', messageId: sent.id, emoji: '❤️' });
  message = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.id === sent.id);
  assert.deepEqual(message.reactions.map(r => [r.emoji, r.count, r.mine]), [['👍', 1, false], ['❤️', 1, true]]);
  await act({ action: 'react', messageId: sent.id, emoji: '❤️' });
  message = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.id === sent.id);
  assert.deepEqual(message.reactions.map(r => r.emoji), ['👍']);
  assert.throws(() => chatActionSchema.parse({ action: 'react', messageId: sent.id, emoji: '💩' }));
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'react', messageId: sent.id, emoji: '💩' }]), /Choose a reaction/);
  await as(OWNER);
  await assert.rejects(act({ action: 'react', messageId: sent.id, emoji: '👍' }), /Message not found/, 'not in the conversation');
});

test('photos and a video: up to 5 and 1, claimed once by the person who uploaded them', async () => {
  const photo = n => ({ name: `room-${n}.jpg`, mime: 'image/jpeg', bytes: 2_000_000, width: 1600, height: 1200 });
  assert.equal(chatFilesProblem([1, 2, 3, 4, 5, 6].map(photo)), 'Send up to 5 photos at a time.');
  assert.equal(chatFilesProblem([{ mime: 'video/mp4', bytes: 60 * 1024 * 1024 }]), 'Videos can be up to 50 MB.');
  assert.equal(chatFilesProblem([...[1, 2, 3, 4, 5].map(photo), { mime: 'video/mp4', bytes: 40e6 }]), null, '5 photos and a video together');
  await as(STAYS);
  await assert.rejects(act({ action: 'prepareFiles', conversationId: group.id, files: [1, 2, 3, 4, 5, 6].map(photo) }), /up to 5 photos/);
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'prepareFiles', conversationId: group.id, files: [{ name: 'big.mp4', mime: 'video/mp4', bytes: 52428801 }] }]), /up to 50 MB/);
  await assert.rejects(rpc('workspace_chat_action', [{ action: 'prepareFiles', conversationId: group.id, files: [{ name: 'x.svg', mime: 'image/svg+xml', bytes: 10 }] }]), /Add photos/);
  const prepared = await act({ action: 'prepareFiles', conversationId: group.id, files: [photo(1), photo(2), { name: 'walkthrough.mov', mime: 'video/quicktime', bytes: 48_000_000 }] });
  assert.equal(prepared.files.length, 3);
  assert.match(prepared.files[2].path, new RegExp(`^${group.id}/[0-9a-f-]{36}\\.mov$`));
  const ids = prepared.files.map(f => f.id);
  // Someone else cannot send them, nor open them before they are sent.
  await as(CLEANER);
  await assert.rejects(send(group.id, '', ids), /was not uploaded/);
  assert.deepEqual(await rpc('workspace_chat_files', [ids]), []);
  await as(STAYS);
  await assert.rejects(send(group.id, '   '), /Write a message/);
  const sent = await send(group.id, '', ids);
  await assert.rejects(send(group.id, 'again', ids), /was not uploaded/, 'each file goes in one message');
  await as(CLEANER);
  const message = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.id === sent.id);
  assert.deepEqual(message.attachments.map(a => [a.kind, a.name, a.width]), [['image', 'room-1.jpg', 1600], ['image', 'room-2.jpg', 1600], ['video', 'walkthrough.mov', null]]);
  assert.equal((await rpc('workspace_chat_files', [ids])).length, 3);
  const listed = (await read('list')).map(c => conversationSchema.parse(c)).find(c => c.id === group.id);
  assert.equal(listed.last.body, '📎 3 photos and videos');
  await as(OWNER);
  assert.deepEqual(await rpc('workspace_chat_files', [ids]), [], 'not in the conversation');
  // Taken out before sending: let go, and the stored copies' paths returned for deleting.
  await as(STAYS);
  const extra = await act({ action: 'prepareFiles', conversationId: group.id, files: [photo(9)] });
  const discarded = await act({ action: 'discardFiles', ids: [extra.files[0].id] });
  assert.deepEqual(discarded.paths, [extra.files[0].path]);
});

test('who is online, and your own profile', async () => {
  await as(CLEANER);
  await act({ action: 'heartbeat' });
  await as(STAYS);
  const people = chatPeopleSchema.parse(await read('people'));
  const isla = people.team.find(p => p.fullName === 'Isla Kerr');
  assert.equal(presenceOf(isla.seenAt), 'online');
  assert.equal(presenceLabel(isla.seenAt), 'Online');
  assert.equal(people.team.find(p => p.fullName === 'Graham Bell').seenAt, null, 'never in');
  assert.equal(presenceLabel(new Date(Date.now() - 5 * 60_000).toISOString()), 'Active 5m ago');
  const direct = conversationSchema.parse(await act({ action: 'startDirect', userId: users[CLEANER] }));
  assert.equal(direct.peer.userId, users[CLEANER]);
  assert.equal(presenceOf(direct.peer.seenAt), 'online');
  // Owners are not shown when the team comes and goes.
  await as(OWNER);
  const mine = conversationSchema.parse(await act({ action: 'startOwner' }));
  await send(mine.id, 'Hello');
  await as(CLEANER);
  // Profiles: a line about you and a colour; a photo only from your own folder.
  const saved = workspaceAccountSchema.parse(await rpc('workspace_profile_action', [{ action: 'saveProfile', about: 'Lead cleaner, Leith', avatar: 'plum' }]));
  assert.deepEqual([saved.about, saved.avatar, saved.photo], ['Lead cleaner, Leith', 'plum', null]);
  await assert.rejects(rpc('workspace_profile_action', [{ action: 'setPhoto', path: `${users[STAYS]}/${crypto.randomUUID()}.jpg` }]), /Choose a photo/);
  const path = `${users[CLEANER]}/${crypto.randomUUID()}.jpg`;
  const withPhoto = await rpc('workspace_profile_action', [{ action: 'setPhoto', path }]);
  assert.match(withPhoto.photo, /^[0-9a-f]{12}$/);
  assert.equal(withPhoto.replaced, null);
  await as(OWNER);
  assert.equal(await rpc('workspace_profile_photo', [users[CLEANER]]), path, 'anyone in the workspace sees team photos');
  await as(STAYS);
  const message = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.authorId === users[STAYS]);
  assert.equal(message.authorPhoto, null);
  const fromIsla = (await read('people')).team.find(p => p.userId === users[CLEANER]);
  assert.equal(fromIsla.photo, withPhoto.photo);
  await as(CLEANER);
  const cleared = await rpc('workspace_profile_action', [{ action: 'clearPhoto' }]);
  assert.deepEqual([cleared.photo, cleared.replaced], [null, path]);
  await assert.rejects(rpc('workspace_profile_action', [{ action: 'saveProfile', about: 'x'.repeat(161) }]), /160 characters/);
  // Nothing here is reachable without an account.
  await owner("select set_config('request.jwt.claims','',false)");
  await db.exec('set role anon');
  await assert.rejects(rpc('workspace_profile_photo', [users[CLEANER]]), /permission denied/);
});

test('security sweep: unsent files are capped, and viewing as someone never opens their private files', async () => {
  await as(STAYS);
  const sent = threadSchema.parse(await read('messages', group.id)).messages.find(m => m.attachments.length);
  const ids = sent.attachments.map(a => a.id);
  // Viewing as Isla (the cleaner), a super admin who is not in the group sees no links.
  await as(CLEANER);
  assert.equal((await rpc('workspace_chat_files', [ids])).length, 3, 'Isla herself can open them');
  await db.query("select set_config('recharge.view_as',$1,false)", [users[SUPER]]);
  assert.deepEqual(await rpc('workspace_chat_files', [ids]), [], 'not while a super admin views as her');
  await db.query("select set_config('recharge.view_as','',false)");
  // 18 files may wait unsent; the 19th is refused until some are sent or removed.
  const photo = n => ({ name: `p${n}.jpg`, mime: 'image/jpeg', bytes: 1000 });
  await as(STAYS);
  for (let i = 0; i < 3; i++) await act({ action: 'prepareFiles', conversationId: group.id, files: [1, 2, 3, 4, 5].map(photo) });
  await act({ action: 'prepareFiles', conversationId: group.id, files: [1, 2, 3].map(photo) });
  await assert.rejects(act({ action: 'prepareFiles', conversationId: group.id, files: [photo(1)] }), /waiting to be sent/);
});
