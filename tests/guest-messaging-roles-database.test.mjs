import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Guest messaging (client answer 12): landlords (client), cleaners (cleans) and maintenance (ready) never read or reply to
// guest conversations, even when given the guest communication tool. Everyone else keeps the access they had. Every migration
// is applied in order; this one is applied a second time to prove a second run changes nothing.
const MINE = '20261014310000_guest_messaging_roles';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'), 'the migration exists');
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const SIGS = ['private.workspace_guest_inbox_read(text,uuid,text)', 'private.workspace_guest_inbox_action(jsonb)', 'private.guest_inbox_can(uuid)', 'private.saved_replies_can_read()'];
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['admin', 'stays', 'accounts', 'cleaning_manager', 'ready', 'cleans', 'client'];
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9750', '9760');
const [ADMIN, STAYS, ACCOUNTS, MANAGER, READY, CLEANER, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `guestroles${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  // Everyone is given every tool, the guest communication tool included: the role alone must keep the three out.
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const inbox = (section, target = null, status = null) => rpc('workspace_guest_inbox_read', [section, target, status]);
const act = input => rpc('workspace_guest_inbox_action', [{ requestId: crypto.randomUUID(), ...input }]);
const savedReplies = () => rpc('workspace_chat_read', ['savedReplies', null, null]);

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Guest flat', address: 'Example guest address', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[STAYS, 'staff'], [ACCOUNTS, 'staff'], [MANAGER, 'cleaning_manager'], [READY, 'staff'], [CLEANER, 'cleaner'], [OWNER, 'client']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);
await asDatabase();
// A Hostaway conversation on the property, and one not yet matched to a property (shared with everyone who has the inbox).
const [placed] = (await db.query(`insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,last_message_at)
  values('hostaway','conv-placed',$1,'airbnb','Gina Guest',now()) returning id`, [property])).rows;
const [unplaced] = (await db.query(`insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,last_message_at)
  values('hostaway','conv-unplaced',null,'vrbo','Una Unplaced',now()) returning id`)).rows;
await db.query(`insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,body)
  values('hostaway','m1','conv-placed',$1,'airbnb','guest',now()-interval '3 minutes','Is there parking?'),('hostaway','m2','conv-unplaced',null,'vrbo','guest',now()-interval '2 minutes','Can we check in early?')`, [property]);

test('the migration runs twice without change, and each gate was added once', async () => {
  assert.deepEqual(secondRun, firstRun);
  for (const def of firstRun.slice(0, 2)) assert.equal(def.split('workspace_guest_messaging_role(private.workspace_actor_role())').length - 1, 1);
  assert.equal(firstRun[0].split("raise exception 'Guest inbox access required'").length - 1, 2, 'the original gate stays, the new one follows it');
});

test('guest relations, accounts, the cleaning manager and admins keep the guest inbox', async () => {
  for (const who of [ADMIN, STAYS, ACCOUNTS, MANAGER]) {
    await as(who);
    const list = await inbox('list', null, 'all');
    assert.deepEqual(list.threads.map(t => t.guestName).sort(), ['Gina Guest', 'Una Unplaced'], roles[who] + ' sees both conversations');
    const thread = await inbox('thread', placed.id);
    assert.equal(thread.messages[0].body, 'Is there parking?');
    const replied = await act({ action: 'reply', threadId: placed.id, body: 'Yes, one space. (' + roles[who] + ')' });
    assert.equal(replied.lastFrom, 'team', roles[who] + ' can reply');
    assert.ok(Array.isArray((await savedReplies()).replies), roles[who] + ' reads saved replies');
  }
});

test('landlords, cleaners and Ready cannot read or reply to guest conversations, even with the tool', async () => {
  for (const who of [OWNER, CLEANER, READY]) {
    await as(who);
    await assert.rejects(inbox('list', null, 'all'), /Guest inbox access required/, roles[who] + ' cannot list');
    await assert.rejects(inbox('list'), /Guest inbox access required/);
    for (const id of [placed.id, unplaced.id]) await assert.rejects(inbox('thread', id), /Guest inbox access required/, roles[who] + ' cannot open a conversation');
    await assert.rejects(act({ action: 'reply', threadId: placed.id, body: 'Hello' }), /Guest inbox access required/, roles[who] + ' cannot reply');
    await assert.rejects(act({ action: 'sendReply', threadId: placed.id, body: 'Hello' }), /Guest inbox access required/, roles[who] + ' cannot send through Hostaway');
    await assert.rejects(act({ action: 'logMessage', channel: 'email', guestName: 'New Guest', body: 'Hi' }), /Guest inbox access required/, roles[who] + ' cannot start a conversation');
    await assert.rejects(act({ action: 'setStatus', threadId: unplaced.id, status: 'done' }), /Guest inbox access required/);
    await assert.rejects(act({ action: 'editThread', threadId: unplaced.id, propertyId: property, guestName: 'Renamed' }), /Guest inbox access required/);
    await assert.rejects(savedReplies(), /Saved replies are for the guest inbox team|Team access required|access required/, roles[who] + ' does not read saved replies');
  }
  await asDatabase();
  assert.equal((await db.query("select count(*)::int n from private.workspace_guest_messages where thread_ref='conv-placed' and direction='team' and body='Hello'")).rows[0].n, 0, 'nothing was written');
  assert.equal((await db.query("select count(*)::int n from private.workspace_guest_threads where guest_name in ('New Guest','Renamed')")).rows[0].n, 0);
  assert.equal((await db.query("select status from private.workspace_guest_threads where id=$1", [unplaced.id])).rows[0].status, 'open');
});

test('the rule is one function, private, and the tables stay closed', async () => {
  await asDatabase();
  const allowed = (await db.query("select r,private.workspace_guest_messaging_role(r) ok from unnest(array['admin','super_admin','stays','accounts','cleaning_manager','ready','cleans','client',null]) r")).rows;
  assert.deepEqual(allowed.map(x => [x.r, x.ok]), [['admin', true], ['super_admin', true], ['stays', true], ['accounts', true], ['cleaning_manager', true], ['ready', false], ['cleans', false], ['client', false], [null, false]]);
  await as(READY);
  await assert.rejects(db.query('select private.workspace_guest_messaging_role($1)', ['ready']), /permission denied/);
  await assert.rejects(db.query('select private.guest_inbox_can(null)'), /permission denied/);
  await assert.rejects(db.query('select * from private.workspace_guest_threads'), /permission denied/);
  await assert.rejects(db.query('select * from private.workspace_guest_messages'), /permission denied/);
});
