import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Message notices (client answer 12): any chat you are in tells you about new messages, once per conversation until you open it,
// including when you have never opened it; cleaners and landlords too; a team channel tells its department, and admins only
// Management and Everyone. Every migration is applied in order; this one again to prove a second run changes nothing.
const MINE = '20261014320000_chat_notices';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'), 'the migration exists');
// 20261015300000 makes every message notify (one per message), replacing the rule this file proves; it has its own test,
// tests/message-notices-database.test.mjs, so it is left out here.
const REPLACED_BY = ['20261015300000_chat_notice_every_message'];
for (const file of files.filter(f => !REPLACED_BY.some(r => f.startsWith(r)))) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const SIGS = ['private.workspace_chat_action(jsonb)', 'private.chat_notice_due(uuid,uuid)'];
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['admin', 'admin', 'stays', 'cleans', 'cleans', 'cleaning_manager', 'client', 'ready'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9770', '9780');
const [ADMIN, QUIET_ADMIN, STAYS, CLEANER, OTHER_CLEANER, MANAGER, OWNER, READY] = roles.map((_, i) => i);
async function addPerson(i) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `chatnotice${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
// The second cleaner joins later, once the Cleaning channel already has messages.
for (let i = 0; i < users.length; i++) if (i !== OTHER_CLEANER) await addPerson(i);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const chat = input => rpc('workspace_chat_action', [input]);
// Send as someone and return who was told about that message.
async function send(who, conversationId, body = 'Hello') {
  await as(who);
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId, body });
  await asDatabase();
  const rows = (await db.query(`select o.user_id from private.workspace_notification_outbox o where o.event_id=(select max(a.id) from public.workspace_activity a where a.actor_id=$1 and a.event_type like 'chat.%')`, [users[who]])).rows;
  return rows.map(r => users.indexOf(r.user_id)).sort((a, b) => a - b);
}
const read = async (who, conversationId) => { await as(who); await chat({ action: 'markRead', conversationId }); };
const channel = async department => { await asDatabase(); return (await db.query('select id from private.chat_conversations where department=$1', [department])).rows[0].id; };

await as(ADMIN);
await chat({ action: 'openTeams' });
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Notice flat', address: 'Example notice address', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [MANAGER, 'cleaning_manager'], [OWNER, 'client'], [READY, 'staff']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);

test('the migration runs twice without change, and the send branch was patched once', () => {
  assert.deepEqual(secondRun, firstRun);
  assert.equal(firstRun[0].split('private.chat_notice_due(target,u)').length - 1, 1);
  assert.equal(firstRun[0].split('insert into private.workspace_notification_outbox(user_id,event_id)').length - 1, 2, 'the old notice stays and the new one follows it');
});

test('a team channel tells its department; admins only Management and Everyone', async () => {
  const cleaning = await channel('cleaning');
  // The cleaning team hears it; admins are not members and it is not their department, even after writing there.
  assert.deepEqual(await send(CLEANER, cleaning, 'Out of bin bags'), [MANAGER]);
  assert.deepEqual(await send(MANAGER, cleaning, 'Bags are in the van'), [CLEANER]);
  await read(CLEANER, cleaning); await read(MANAGER, cleaning);
  assert.deepEqual(await send(ADMIN, cleaning, 'I will order more'), [CLEANER, MANAGER]);
  await read(CLEANER, cleaning); await read(MANAGER, cleaning);
  assert.deepEqual(await send(CLEANER, cleaning, 'Thanks'), [MANAGER], 'no admin is told about the Cleaning channel');
  // Management and Everyone tell every admin, as before.
  const management = await channel('management');
  assert.deepEqual(await send(ADMIN, management, 'Weekly numbers'), [QUIET_ADMIN]);
  // A department message does not reach other departments.
  assert.ok(!(await send(STAYS, await channel('guest_relations'), 'Late check-in tonight')).some(x => [CLEANER, MANAGER, READY, ADMIN, QUIET_ADMIN].includes(x)));
});

test('once per conversation until it is opened, and someone who never opened it is still told', async () => {
  const cleaning = await channel('cleaning');
  await read(CLEANER, cleaning); await read(MANAGER, cleaning);
  assert.deepEqual(await send(MANAGER, cleaning, 'One'), [CLEANER]);
  assert.deepEqual(await send(MANAGER, cleaning, 'Two'), [], 'nobody is told twice before opening it');
  await read(CLEANER, cleaning);
  assert.deepEqual(await send(MANAGER, cleaning, 'Three'), [CLEANER], 'told again once they have opened it');
  // A cleaner who starts after the channel has messages, and has never opened it, is told (before, never).
  await asDatabase();
  await addPerson(OTHER_CLEANER);
  assert.deepEqual(await send(MANAGER, cleaning, 'Welcome'), [OTHER_CLEANER]);
  assert.deepEqual(await send(MANAGER, cleaning, 'Rota is up'), [], 'and then not again until they open it');
  await read(OTHER_CLEANER, cleaning); await read(CLEANER, cleaning);
  assert.deepEqual(await send(MANAGER, cleaning, 'Four'), [CLEANER, OTHER_CLEANER]);
});

test('cleaners and landlords are told about the chats they are in; a block still stops it', async () => {
  // A group with a cleaner.
  await as(STAYS);
  const group = (await chat({ action: 'startGroup', title: 'Deep clean Friday', userIds: [users[CLEANER], users[MANAGER]] })).id;
  assert.deepEqual(await send(STAYS, group, 'Can you do Friday?'), [CLEANER, MANAGER]);
  await read(STAYS, group);
  assert.deepEqual(await send(CLEANER, group, 'Yes'), [STAYS]);
  // The landlord's conversation with Recharge: the owner is told about the team's messages, and the team about the owner's.
  await as(OWNER);
  const owner = (await chat({ action: 'startOwner' })).id;
  const toTeam = await send(OWNER, owner, 'Is the boiler fixed?');
  assert.ok(toTeam.includes(ADMIN) && toTeam.includes(QUIET_ADMIN) && toTeam.includes(STAYS), 'admins and the Stays person on the property');
  assert.ok(!toTeam.includes(CLEANER) && !toTeam.includes(READY), 'not cleaners or Ready');
  assert.deepEqual(await send(ADMIN, owner, 'Yes, this morning'), [OWNER]);
  // A block is a filter on the blocker's own side: the cleaner who blocked someone is not told about their messages.
  await as(CLEANER);
  await chat({ action: 'blockUser', userId: users[STAYS] });
  await read(CLEANER, group); await read(MANAGER, group);
  assert.deepEqual(await send(STAYS, group, 'Great'), [MANAGER], 'the cleaner who blocked the sender is not told');
});

test('the record is private', async () => {
  await as(CLEANER);
  await assert.rejects(db.query('select * from private.chat_notified'), /permission denied/);
  await assert.rejects(db.query('select private.chat_notice_due($1,$2)', [crypto.randomUUID(), users[CLEANER]]), /permission denied/);
});
