import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Team channels in Messages: Everyone and one per department, found by rota department or by
// role, readable by admins, heard once until read, and never open to owners.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { threadSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const db = new PGlite();
const roles = ['super_admin', 'stays', 'stays', 'cleans', 'ready', 'accounts', 'client', 'cleaning_manager'];
const names = ['Admin', 'Client Rel', 'Plain Stays', 'Cleaner', 'Ready Person', 'Accounts Person', 'Owner', 'Cleaning Mgr'];
const [ADMIN, CLIENT_REL, PLAIN_STAYS, CLEANER, READY, ACCOUNTS, OWNER, CLEAN_MGR] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`), session = i => users[i].replace('9760', '9860');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `chan${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
// Client Rel is on the rota for client relations; Plain Stays has no rota row at all.
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[CLIENT_REL]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
after(async () => { await db.close(); await vite.close(); });
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const read = async (section, target = null) => (await db.query('select public.workspace_chat_read($1,$2) r', [section, target])).rows[0].r;
const act = async input => (await db.query('select public.workspace_chat_action($1::jsonb) r', [JSON.stringify(input)])).rows[0].r;
const send = (conversationId, body) => act({ action: 'send', requestId: crypto.randomUUID(), conversationId, body });
const outbox = async user => (await db.exec('reset role'), (await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type='chat.message'", [user])).rows[0].n);
const channels = async () => (await read('list')).filter(c => c.department).map(c => c.department).sort();
const ALL = ['accounts', 'all', 'cleaning', 'client_relations', 'guest_relations', 'management', 'ready'];

test('the first person to open Messages makes the seven channels, once', async () => {
  await as(CLIENT_REL);
  assert.deepEqual(await act({ action: 'openTeams' }), { ready: true });
  await act({ action: 'openTeams' });
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from private.chat_conversations where department is not null")).rows[0].n, 7);
  assert.deepEqual((await db.query("select title from private.chat_conversations where department is not null order by department")).rows.map(r => r.title),
    ['Accounts', 'Everyone', 'Cleaning', 'Client relations', 'Guest relations', 'Management', 'Ready']);
  await as(OWNER);
  await assert.rejects(act({ action: 'openTeams' }), /Team access/, 'owners have no team channels');
});

test('each person finds their department\'s channel, and Everyone', async () => {
  await as(CLIENT_REL); assert.deepEqual(await channels(), ['all', 'client_relations'], 'a rota department wins over the role');
  await as(PLAIN_STAYS); assert.deepEqual(await channels(), ['all', 'client_relations', 'guest_relations'], 'Stays with no rota are in both Stays channels');
  await as(CLEANER); assert.deepEqual(await channels(), ['all', 'cleaning']);
  await as(CLEAN_MGR); assert.deepEqual(await channels(), ['all', 'cleaning']);
  await as(READY); assert.deepEqual(await channels(), ['all', 'ready']);
  await as(ACCOUNTS); assert.deepEqual(await channels(), ['accounts', 'all']);
  await as(ADMIN); assert.deepEqual(await channels(), ALL, 'admins can read every channel');
  await as(OWNER); assert.deepEqual(await channels(), [], 'owners see none');
});

test('messages stay inside the channel, and are heard once until read', async () => {
  await as(CLEANER);
  const cleaning = (await read('list')).find(c => c.department === 'cleaning');
  assert.equal(cleaning.title, 'Cleaning'); assert.equal(cleaning.subtitle, 'Team channel'); assert.equal(cleaning.mine, true);
  await send(cleaning.id, 'Short of towels at the Leith flat');
  await send(cleaning.id, 'Also bin bags');
  assert.equal(await outbox(users[CLEAN_MGR]), 1, 'the cleaning manager is told once');
  assert.equal(await outbox(users[ADMIN]), 0, 'admins are not told about department channels');
  assert.equal(await outbox(users[READY]), 0);
  await as(READY);
  await assert.rejects(read('messages', cleaning.id), /Conversation not found/);
  await assert.rejects(send(cleaning.id, 'Hello?'), /Conversation not found/);
  await as(CLEAN_MGR);
  assert.equal((await read('unread')), 2);
  const thread = await read('messages', cleaning.id);
  assert.deepEqual(thread.messages.map(m => [m.authorName, m.body]), [['Cleaner', 'Short of towels at the Leith flat'], ['Cleaner', 'Also bin bags']]);
  await act({ action: 'markRead', conversationId: cleaning.id });
  assert.equal(await read('unread'), 0);
  await as(ADMIN);
  assert.equal((await read('messages', cleaning.id)).messages.length, 2, 'admins can read it');
  await as(OWNER);
  await assert.rejects(read('messages', cleaning.id), /Conversation not found/);
  await assert.rejects(send(cleaning.id, 'Hi'), /Conversation not found/);
});

test('Everyone and Management reach the right people', async () => {
  await as(ACCOUNTS);
  const everyone = (await read('list')).find(c => c.department === 'all');
  await send(everyone.id, 'Payroll runs on Friday');
  for (const who of [ADMIN, CLIENT_REL, PLAIN_STAYS, CLEANER, CLEAN_MGR, READY]) assert.ok(await outbox(users[who]) >= 1, names[who] + ' hears Everyone');
  assert.equal(await outbox(users[OWNER]), 0);
  await as(ADMIN);
  const management = (await read('list')).find(c => c.department === 'management');
  await send(management.id, 'Board meeting moved');
  await as(CLIENT_REL);
  assert.deepEqual((await read('list')).filter(c => c.department === 'management'), [], 'only management and admins are in Management');
  await db.exec('reset role');
  await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'management','early') on conflict(user_id) do update set department='management'", [users[PLAIN_STAYS]]);
  await as(PLAIN_STAYS);
  assert.deepEqual(await channels(), ['all', 'management'], 'a rota department of management puts them in Management');
});

test('direct messages and channel threads pass the app\'s own check (no empty fromOwner)', async () => {
  await as(CLEANER);
  const direct = await act({ action: 'startDirect', userId: users[CLEAN_MGR] });
  await send(direct.id, 'Can you cover Saturday?');
  const channel = (await read('list')).find(c => c.department === 'cleaning');
  for (const id of [direct.id, channel.id]) {
    const raw = await read('messages', id);
    assert.ok(raw.messages.length >= 1 && raw.messages.every(m => m.fromOwner === false), 'false, not empty');
    const parsed = threadSchema.parse(raw);
    assert.ok(parsed.messages.every(m => m.fromOwner === false));
  }
  assert.equal(threadSchema.parse({ conversation: (await read('messages', direct.id)).conversation, messages: [{ id: crypto.randomUUID(), body: 'x', at: '2026-10-10T09:00:00Z', mine: true, authorName: 'You', fromOwner: null }] }).messages[0].fromOwner, false, 'an older reply with an empty value is still accepted');
});
