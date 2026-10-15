import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// @mentions in team group chats (Lee: "like WhatsApp"; migration 20261021400000): mentions are kept as data with the message,
// only people in the conversation can be mentioned, @everyone tells everyone who can read it, a mentioned person is told even in a
// channel they do not otherwise hear (admins only hear Management and Everyone), the list marks an unread mention, and the pop-up
// reads "Guest relations" / "Erika mentioned you: …". Never in a 1-to-1 or owner conversation. The migration runs twice unchanged.
const MINE = '20261021400000_chat_mentions';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { chatActionSchema, threadSchema, conversationSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { mentionsIn } = await vite.ssrLoadModule('/lib/chat-mentions.ts');
const { pushCopy, pushTarget } = await vite.ssrLoadModule('/lib/push-copy.ts');
const SETUP = `set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`;
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
const sql = await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8');
const db = new PGlite();
await db.exec(SETUP);
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_chat_action(jsonb)', 'private.chat_summary(private.chat_conversations,uuid)', 'private.workspace_chat_read(text,uuid,timestamp with time zone)',
  'private.integration_push_details(bigint)', 'private.integration_claim_notifications(boolean,boolean)', 'private.chat_mention_save(uuid,uuid,uuid,jsonb)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(sql);
const secondRun = await definitions();
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'stays', 'stays', 'cleans', 'client'], names = ['Mark Raven', 'Alex Coghill', 'Erika Smith', 'Isla Kerr', 'Sarah Jones'];
const [MARK, ALEX, ERIKA, ISLA, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97c00000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('97c0', '97c1');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `mention${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("update public.workspace_profiles set avatar_path=$2,avatar_preset='plum' where user_id=$1", [users[ERIKA], `${users[ERIKA]}/97c20000-0000-4000-8000-000000000001.jpg`]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const asDatabase = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_chat_action', [chatActionSchema.parse(input)]);
const raw = input => rpc('workspace_chat_action', [input]);
const send = (conversationId, body, extra = {}) => act({ action: 'send', requestId: crypto.randomUUID(), conversationId, body, ...extra });
const list = async () => (await rpc('workspace_chat_read', ['list', null, null])).map(c => conversationSchema.parse(c));
const messages = async id => threadSchema.parse(await rpc('workspace_chat_read', ['messages', id, null])).messages;
// The notices each person has for a message's event.
async function toldAbout(messageId) {
  await asDatabase();
  return (await db.query(`select o.user_id from private.workspace_notification_outbox o join private.workspace_activity_details d on d.event_id=o.event_id
    where d.message_id=$1 order by o.user_id`, [messageId])).rows.map(r => users.indexOf(r.user_id));
}
async function details(messageId, who) {
  await asDatabase();
  const row = (await db.query(`select o.id from private.workspace_notification_outbox o join private.workspace_activity_details d on d.event_id=o.event_id
    where d.message_id=$1 and o.user_id=$2`, [messageId, users[who]])).rows[0];
  assert.ok(row, `${names[who]} was told`);
  return (await db.query('select private.integration_push_details($1) d', [row.id])).rows[0].d;
}

test('the migration runs twice without change, and has no DROP or DELETE', () => {
  assert.deepEqual(secondRun, firstRun);
  const code = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i);
});

let guestRelations, everyoneChannel, group;
test('in Guest relations, Erika mentions Alex and Mark (an admin who does not hear it): both are told, structurally', async () => {
  await as(ERIKA);
  await act({ action: 'openTeams' });
  const channels = await list();
  guestRelations = channels.find(c => c.department === 'guest_relations').id;
  everyoneChannel = channels.find(c => c.department === 'all').id;
  // Without a mention, Mark (admin) is not told about Guest relations.
  const plain = await send(guestRelations, 'Morning team!');
  assert.deepEqual(await toldAbout(plain.id), [ALEX]);
  await as(ERIKA);
  const people = (await rpc('workspace_chat_read', ['members', guestRelations, null])).members.map(m => ({ userId: m.userId, fullName: m.fullName, you: m.you }));
  const body = '@Alex Coghill and @Mark Raven can you check 110 Hawk?';
  const found = mentionsIn(body, people);
  assert.deepEqual(new Set(found.userIds), new Set([users[ALEX], users[MARK]]));
  const sent = await send(guestRelations, body, { mentions: found.userIds });
  assert.deepEqual(await toldAbout(sent.id), [MARK, ALEX], 'Mark is told because he is mentioned');
  // What each reads: the mentions, with "you" for the reader.
  await as(ALEX);
  const m = (await messages(guestRelations)).find(x => x.id === sent.id);
  assert.deepEqual(m.mentions.map(x => [x.name, x.you]), [['Alex Coghill', true], ['Mark Raven', false]]);
  assert.equal(m.mentionsEveryone, false);
  await as(ERIKA);
  assert.ok((await messages(guestRelations)).find(x => x.id === sent.id).mentions.every(x => !x.you));
  // Mark's pop-up: the channel's name on top, "Erika mentioned you" in front of the message, the conversation to open.
  const popup = await details(sent.id, MARK);
  assert.deepEqual([popup.mention, popup.conversationId, popup.conversationKind, popup.context], ['you', guestRelations, 'group', 'Guest relations']);
  assert.equal(popup.senderPhotoPath, `${users[ERIKA]}/97c20000-0000-4000-8000-000000000001.jpg`, 'the backend signs it; it never reaches a device');
  assert.equal(popup.senderColour, 'plum');
  assert.deepEqual(pushCopy('chat.message', null, popup), { title: 'Guest relations (2 new messages)', message: 'Erika mentioned you: @Alex Coghill and @Mark Raven can you check 110 Hawk?' });
  assert.equal(pushTarget('chat.message', popup).url, `/workspace/live?section=inbox&chat=${guestRelations}`);
});

test('the list shows "@" on a conversation with an unread mention, until it is read', async () => {
  await as(ALEX);
  assert.equal((await list()).find(c => c.id === guestRelations).mentioned, true);
  assert.equal((await list()).find(c => c.id === everyoneChannel).mentioned, false);
  await act({ action: 'markRead', conversationId: guestRelations });
  assert.equal((await list()).find(c => c.id === guestRelations).mentioned, false);
  // Erika's own message never marks it for her.
  await as(ERIKA);
  assert.equal((await list()).find(c => c.id === guestRelations).mentioned, false);
});

test('outsiders are refused: someone not in the conversation, an owner, a made-up id, or too many', async () => {
  await as(ERIKA);
  await assert.rejects(send(guestRelations, '@Isla Kerr hello', { mentions: [users[ISLA]] }), /Mention only people in this conversation/, 'Isla (cleaning) is not in Guest relations');
  await assert.rejects(send(guestRelations, '@Sarah Jones hello', { mentions: [users[OWNER]] }), /Mention only people in this conversation/, 'an owner is never in a team channel');
  await assert.rejects(send(guestRelations, 'hi', { mentions: ['97c00000-0000-4000-8000-000000000999'] }), /Mention only people in this conversation/);
  await assert.rejects(raw({ action: 'send', requestId: crypto.randomUUID(), conversationId: guestRelations, body: 'hi', mentions: ['not-a-person'] }), /Check the mentions/);
  await assert.rejects(raw({ action: 'send', requestId: crypto.randomUUID(), conversationId: guestRelations, body: 'hi', mentionEveryone: 'yes' }), /Check the mentions/);
  assert.throws(() => chatActionSchema.parse({ action: 'send', requestId: crypto.randomUUID(), conversationId: guestRelations, body: 'hi', mentions: Array.from({ length: 51 }, () => users[ALEX]) }));
  // A refused message is not sent at all.
  assert.ok(!(await messages(guestRelations)).some(m => m.body.includes('@Isla Kerr')));
});

test('never in a 1-to-1 chat or an owner conversation', async () => {
  await as(ERIKA);
  const direct = (await act({ action: 'startDirect', userId: users[ALEX] })).id;
  await assert.rejects(send(direct, '@Alex Coghill hi', { mentions: [users[ALEX]] }), /Mentions are for group conversations/);
  await assert.rejects(send(direct, '@everyone hi', { mentionEveryone: true }), /Mentions are for group conversations/);
  await as(OWNER);
  const owner = (await act({ action: 'startOwner' })).id;
  await assert.rejects(send(owner, '@everyone hi', { mentionEveryone: true }), /Mentions are for group conversations/);
  // Words with "@" but no mentions are an ordinary message anywhere.
  await as(ERIKA);
  assert.ok((await send(direct, 'email me at erika@example.com')).id);
});

test('@everyone tells everyone who can read it, Mark (admin) included, and reads "Erika mentioned everyone"', async () => {
  await as(ERIKA);
  const sent = await send(guestRelations, '@everyone the boiler at 110 Hawk is fixed', { mentionEveryone: mentionsIn('@everyone the boiler', []).everyone });
  assert.deepEqual(await toldAbout(sent.id), [MARK, ALEX]);
  await as(MARK);
  const m = (await messages(guestRelations)).find(x => x.id === sent.id);
  assert.equal(m.mentionsEveryone, true);
  assert.equal((await list()).find(c => c.id === guestRelations).mentioned, true);
  const popup = await details(sent.id, MARK);
  assert.equal(popup.mention, 'everyone');
  assert.match(pushCopy('chat.message', null, popup).message, /^Erika mentioned everyone: @everyone the boiler/);
  // A group chat: its members.
  await as(ALEX);
  group = (await act({ action: 'startGroup', title: 'Deep clean Friday', userIds: [users[ISLA], users[ERIKA]] })).id;
  const all = await send(group, '@all please confirm', { mentionEveryone: true });
  assert.deepEqual(await toldAbout(all.id), [ERIKA, ISLA]);
  // "@all" is read as everyone too.
  assert.equal(mentionsIn('@all please confirm', []).everyone, true);
});

test('a group member is told even if the group is otherwise quiet for them; someone who blocked the sender is not', async () => {
  await as(ISLA);
  await act({ action: 'blockUser', userId: users[ALEX] });
  await as(ALEX);
  const sent = await send(group, '@Isla Kerr @Erika Smith linen?', { mentions: [users[ISLA], users[ERIKA]] });
  assert.deepEqual(await toldAbout(sent.id), [ERIKA], 'Isla blocked Alex, so she is not told');
  await as(ISLA);
  await act({ action: 'unblockUser', userId: users[ALEX] });
  // Mentioning yourself is ignored, not refused.
  await as(ALEX);
  const self = await send(group, '@Alex Coghill note to self', { mentions: [users[ALEX]] });
  await as(ALEX);
  assert.deepEqual((await messages(group)).find(x => x.id === self.id).mentions, []);
});

test('the pop-up counts unread messages and never gives an owner a staff photo; phone-app claims carry the same details', async () => {
  await as(MARK);
  const owner = (await list()).find(c => c.kind === 'owner')?.id;
  assert.ok(owner, "Sarah's conversation");
  const reply = await send(owner, 'Yes, fixed this morning.');
  const toOwner = await details(reply.id, OWNER);
  assert.equal(toOwner.who, 'Recharge');
  assert.equal(toOwner.senderPhotoPath, undefined);
  assert.equal(toOwner.conversationKind, 'owner');
  assert.deepEqual(pushCopy('chat.message', null, toOwner), { title: 'Recharge', message: 'Yes, fixed this morning.' });
  // The owner writes back: the team sees "Sarah Jones (owner)".
  await as(OWNER);
  const back = await send(owner, 'Thank you!');
  const toMark = await details(back.id, MARK);
  assert.equal(toMark.ownerName, 'Sarah Jones');
  assert.deepEqual(pushCopy('chat.owner_message', null, toMark), { title: 'Sarah Jones (owner)', message: 'Thank you!' });
  assert.equal(pushTarget('chat.owner_message', toMark).url, `/workspace/live?section=inbox&chat=${owner}`);
  // Phone-app pushes: the claim hands the push channel its details, never the email channel.
  await asDatabase();
  await db.query("insert into private.workspace_device_tokens(user_id,device_id,push_token,platform) values($1,gen_random_uuid(),'ExponentPushToken[mention-test-0001]','android')", [users[MARK]]);
  await db.exec('set role service_role');
  // Claimed five at a time: keep claiming until every waiting one has been seen.
  const claimAll = async (email, push) => { const all = []; for (let i = 0; i < 40; i++) { const jobs = await rpc('integration_claim_notifications', [email, push]); if (!jobs.length) break; all.push(...jobs); } return all; };
  const pushes = await claimAll(false, true);
  assert.ok(pushes.length && pushes.every(j => j.channel === 'push'));
  assert.ok(pushes.some(j => j.details?.conversationId === owner), 'a push job knows its conversation');
  const emails = await claimAll(true, false);
  assert.ok(emails.length && emails.every(j => j.channel === 'email' && (j.details === undefined || j.details === null)), 'email never gets details');
  // People cannot read mentions or the details directly.
  await as(ALEX);
  await assert.rejects(db.query('select * from private.chat_mentions'), /permission denied/);
  await assert.rejects(db.query(`select private.chat_mention_save('${users[ALEX]}','${users[ALEX]}','${users[ALEX]}','{}')`), /permission denied/);
});
