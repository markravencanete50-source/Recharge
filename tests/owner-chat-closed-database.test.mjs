import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The Clients tab's Closed (round 5): the team that answers an owner closes and reopens the owner conversation; any new message
// reopens it; owners never close one and never see that it was closed. Every migration is applied in order; this one again.
const MINE = '20261015320000_owner_chat_closed';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const SIGS = ['private.workspace_chat_action(jsonb)', 'private.chat_summary(private.chat_conversations,uuid)', 'private.chat_close_action(jsonb)'];
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['admin', 'stays', 'stays', 'cleans', 'client'];
const [ADMIN, STAYS, OTHER_STAYS, CLEANER, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `98300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9830', '9840');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `closed${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const chat = input => rpc('workspace_chat_action', [input]);
const listed = async (who, id) => { await as(who); return (await rpc('workspace_chat_read', ['list', null, null])).find(c => c.id === id); };

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Closed flat', address: 'Example closed address', region: 'Edinburgh', bedrooms: 1 }]);
for (const [who, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [OWNER, 'client']]) await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);
await as(OWNER);
const conversation = (await chat({ action: 'startOwner' })).id;
await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId: conversation, body: 'Is the boiler fixed?' });

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('the owner team closes and reopens; a new message reopens it; the owner never sees it', async () => {
  assert.equal((await listed(STAYS, conversation)).closed, false);
  await as(STAYS);
  const closed = await chat({ action: 'closeConversation', conversationId: conversation, closed: true });
  assert.equal(closed.closed, true);
  assert.equal((await listed(ADMIN, conversation)).closed, true, 'closed for the whole team');
  assert.equal((await listed(OWNER, conversation)).closed, false, 'the owner never sees it as closed');
  // The owner writes again: open again.
  await as(OWNER);
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId: conversation, body: 'Hello?' });
  assert.equal((await listed(STAYS, conversation)).closed, false);
  // Closed, then the team writes: open again too. Reopening by hand works as well.
  await as(ADMIN);
  await chat({ action: 'closeConversation', conversationId: conversation, closed: true });
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId: conversation, body: 'Fixed this morning' });
  assert.equal((await listed(ADMIN, conversation)).closed, false);
  await chat({ action: 'closeConversation', conversationId: conversation, closed: true });
  assert.equal((await chat({ action: 'closeConversation', conversationId: conversation, closed: false })).closed, false);
});

test('only the owner team can close an owner conversation, and only owner conversations close', async () => {
  for (const who of [OWNER, CLEANER, OTHER_STAYS]) {
    await as(who);
    await assert.rejects(chat({ action: 'closeConversation', conversationId: conversation, closed: true }), /Team access required|Conversation not found/, roles[who]);
  }
  await as(STAYS);
  const direct = (await chat({ action: 'startDirect', userId: users[ADMIN] })).id;
  await assert.rejects(chat({ action: 'closeConversation', conversationId: direct, closed: true }), /Conversation not found/);
  await assert.rejects(chat({ action: 'closeConversation', conversationId: conversation, closed: 'yes' }), /Choose close or reopen/);
  await assert.rejects(chat({ action: 'closeConversation', conversationId: conversation, closed: true, extra: 1 }), /Unknown or oversized/);
  await db.exec('reset role');
  await assert.rejects(db.query("update private.chat_conversations set closed_at=now() where id=$1", [direct]), /chat_conversations_closed_owner_only/);
});
