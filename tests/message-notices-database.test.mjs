import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Message notices, round 5 (Lee's decisions): every chat message notifies everyone who hears the chat (one per message); owner
// conversations keep telling the team that answers owners; every guest message tells Stays on the property (with the guest tool)
// and the admins, at any hour. The sender is never told, blocks hold, and nobody outside the audience is told.
const MINE = ['20261015300000_chat_notice_every_message', '20261015310000_guest_message_notices'];
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const m of MINE) assert.ok(files.includes(m + '.sql'), m + ' exists');
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const SIGS = ['private.chat_notice_due(uuid,uuid)', 'private.workspace_guest_message_recipients(uuid)', 'private.workspace_guest_message_notices()'];
const firstRun = await Promise.all(SIGS.map(definition));
for (const m of MINE) await db.exec(await fs.readFile(`supabase/migrations/${m}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['super_admin', 'admin', 'stays', 'stays', 'stays', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'];
const [SUPER, ADMIN, STAYS, OTHER_STAYS, NO_TOOL_STAYS, CLIENT_REL, CLEANER, MANAGER, READY, ACCOUNTS, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `98100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9810', '9820');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `notice5-${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
// One Stays person without the guest communication tool; one on the client relations rota (not on the property).
await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='guest-communication'", [users[NO_TOOL_STAYS]]);
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[CLIENT_REL]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const chat = input => rpc('workspace_chat_action', [input]);
// Who was told about the newest activity row of this type.
async function toldAbout(eventType) {
  await asDatabase();
  const rows = (await db.query(`select o.user_id from private.workspace_notification_outbox o where o.event_id=(select max(id) from public.workspace_activity where event_type=$1)`, [eventType])).rows;
  return rows.map(r => users.indexOf(r.user_id)).sort((a, b) => a - b);
}
const count = async eventType => { await asDatabase(); return (await db.query('select count(*)::int n from public.workspace_activity where event_type=$1', [eventType])).rows[0].n; };
async function send(who, conversationId, body) {
  await as(who);
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId, body });
  return toldAbout(who === OWNER ? 'chat.owner_message' : 'chat.message');
}

await as(SUPER);
await chat({ action: 'openTeams' });
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Notice flat', address: 'Example notice five', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[STAYS, 'staff'], [NO_TOOL_STAYS, 'staff'], [CLEANER, 'cleaner'], [MANAGER, 'cleaning_manager'], [READY, 'staff'], [ACCOUNTS, 'staff'], [OWNER, 'client']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);

test('both migrations run twice without change', () => assert.deepEqual(secondRun, firstRun));

test('every chat message notifies; the sender, blocks and people outside the chat are left out', async () => {
  await as(STAYS);
  const group = (await chat({ action: 'startGroup', title: 'Friday changeover', userIds: [users[CLEANER], users[MANAGER]] })).id;
  assert.deepEqual(await send(STAYS, group, 'One'), [CLEANER, MANAGER]);
  assert.deepEqual(await send(STAYS, group, 'Two'), [CLEANER, MANAGER], 'told again although they have not opened it');
  assert.deepEqual(await send(CLEANER, group, 'Three'), [STAYS, MANAGER], 'never the sender');
  await as(MANAGER);
  await chat({ action: 'blockUser', userId: users[CLEANER] });
  assert.deepEqual(await send(CLEANER, group, 'Four'), [STAYS], 'not the person who blocked the sender');
  // A team channel: its department on every message; admins, Ready and owners are not in Cleaning.
  await asDatabase();
  const cleaning = (await db.query("select id from private.chat_conversations where department='cleaning'")).rows[0].id;
  assert.deepEqual(await send(MANAGER, cleaning, 'Towels'), [CLEANER]);
  assert.deepEqual(await send(MANAGER, cleaning, 'Bin bags'), [CLEANER]);
});

test('owner conversations keep today\'s team: admins, client relations and Stays on the owner\'s properties; the owner hears the team', async () => {
  await as(OWNER);
  const owner = (await chat({ action: 'startOwner' })).id;
  const team = [SUPER, ADMIN, STAYS, NO_TOOL_STAYS, CLIENT_REL];
  assert.deepEqual(await send(OWNER, owner, 'Is the boiler fixed?'), team);
  assert.deepEqual(await send(OWNER, owner, 'Hello?'), team, 'on every message');
  for (const who of [OTHER_STAYS, CLEANER, MANAGER, READY, ACCOUNTS]) assert.ok(!team.includes(who), 'never ' + roles[who] + ' who is not on the owner team');
  assert.deepEqual(await send(ADMIN, owner, 'Yes, this morning'), [SUPER, STAYS, NO_TOOL_STAYS, CLIENT_REL, OWNER], 'the owner and the rest of the team');
  assert.deepEqual(await send(CLIENT_REL, owner, 'Anything else?'), [SUPER, ADMIN, STAYS, NO_TOOL_STAYS, OWNER]);
});

test('a guest message from the Hostaway import tells Stays on the property with the tool, and the admins, on every message', async () => {
  await asDatabase();
  await db.query("update public.workspace_properties set hostaway_listing_id='L-500' where id=$1", [property]);
  await db.query('update private.workspace_hostaway_sync_state set paused=false where singleton');
  const now = Date.now(), at = offset => new Date(now - offset * 60000).toISOString();
  const conversation = messages => ({ conversations: [{ id: 'conv-500', listingId: 'L-500', guestName: 'Gina Guest', channel: 'airbnb', messages }] });
  await db.query('select public.workspace_hostaway_messages_ingest($1)', [conversation([{ id: 'h1', incoming: true, body: 'Is there parking?', sentAt: at(5) }])]);
  assert.deepEqual(await toldAbout('guest.message'), [SUPER, ADMIN, STAYS]);
  for (const who of [OTHER_STAYS, NO_TOOL_STAYS, CLIENT_REL, CLEANER, MANAGER, READY, ACCOUNTS, OWNER]) assert.ok(!(await toldAbout('guest.message')).includes(who));
  const before = await count('guest.message');
  // Two more guest messages and a team reply in one import: two notices; the reply tells nobody.
  await db.query('select public.workspace_hostaway_messages_ingest($1)', [conversation([
    { id: 'h1', incoming: true, body: 'Is there parking?', sentAt: at(5) },
    { id: 'h2', incoming: true, body: 'And a cot?', sentAt: at(3) },
    { id: 'h3', incoming: false, body: 'Yes to both', sentAt: at(2) },
    { id: 'h4', incoming: true, body: 'Thanks!', sentAt: at(1) },
  ])]);
  assert.equal(await count('guest.message'), before + 2, 'one per new guest message; the stored one and the reply add none');
  // The notice carries the property and no work item, so owners never read it in the activity list.
  const row = (await db.query("select property_id,work_id,actor_id from public.workspace_activity where event_type='guest.message' order by id desc limit 1")).rows[0];
  assert.deepEqual([row.property_id, row.work_id, row.actor_id], [property, null, null]);
  await as(OWNER);
  assert.equal((await db.query("select count(*)::int n from public.workspace_activity where event_type='guest.message'")).rows[0].n, 0);
});

test('history older than a day tells nobody; a conversation not on a property tells every Stays person with the tool', async () => {
  await asDatabase();
  const before = await count('guest.message');
  await db.query('select private.workspace_guest_messages_ingest($1)', [{ source: 'feed', messages: [
    { externalId: 'old-1', threadRef: 'feed-old', propertyId: property, channel: 'vrbo', direction: 'guest', sentAt: new Date(Date.now() - 3 * 86400000).toISOString(), body: 'Old question', guestName: 'Olive Old' },
  ] }]);
  assert.equal(await count('guest.message'), before, 'old history is stored but tells nobody');
  await db.query('select private.workspace_guest_messages_ingest($1)', [{ source: 'feed', messages: [
    { externalId: 'loose-1', threadRef: 'feed-loose', propertyId: null, channel: 'email', direction: 'guest', sentAt: new Date().toISOString(), body: 'Do you have availability?', guestName: 'Lou Loose' },
  ] }]);
  assert.deepEqual(await toldAbout('guest.message'), [SUPER, ADMIN, STAYS, OTHER_STAYS, CLIENT_REL], 'every Stays person with the tool, and the admins');
});

test('a guest message logged by hand tells the others, never the person who logged it', async () => {
  await as(STAYS);
  const logged = await rpc('workspace_guest_inbox_action', [{ requestId: crypto.randomUUID(), action: 'logMessage', propertyId: property, channel: 'email', guestName: 'Ed Email', body: 'Can we check in at noon?' }]);
  assert.ok(logged.id);
  assert.deepEqual(await toldAbout('guest.message'), [SUPER, ADMIN]);
  await as(STAYS);
  await rpc('workspace_guest_inbox_action', [{ requestId: crypto.randomUUID(), action: 'reply', threadId: logged.id, body: 'Yes, noon is fine' }]);
  assert.equal((await toldAbout('guest.message')).length, 2, 'a reply adds no guest notice');
});

test('the functions are private', async () => {
  await as(STAYS);
  await assert.rejects(db.query('select private.workspace_guest_message_recipients(null)'), /permission denied/);
  await assert.rejects(db.query('select private.chat_notice_due($1,$2)', [crypto.randomUUID(), users[STAYS]]), /permission denied/);
});
