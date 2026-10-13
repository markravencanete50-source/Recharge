import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Round 6, from Alex's video: each to-do keeps a log of updates (text, who, when). Anyone who can see the
// to-do can add one; owners never see staff to-dos; ticking a to-do done logs "Marked done".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { todoHubSchema, todoHubItemSchema } = await vite.ssrLoadModule('/lib/todo.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'stays', 'cleans', 'client'];
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, DAN, ERIC, ANGELA, OWNER] = roles.map((_, i) => i);
const NAMES = ['Admin', 'Dan', 'Eric', 'Angela', 'Owner'];
const session = i => users[i].replace('9760', '9860');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `todo${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], NAMES[i]]);
}
// Dan and Eric are client relations; Angela cleans.
for (const i of [DAN, ERIC]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const hub = async () => todoHubSchema.parse(await rpc('workspace_teams_read', ['hub', null, null, null, null]));
const find = async id => (await hub()).items.find(i => i.id === id);
after(async () => { await db.close(); await vite.close(); });

let forDan, forTeam, angelas;
test('setup: a to-do for Dan, one for client relations, and one of Angela\'s own', async () => {
  await as(ADMIN);
  forDan = await act({ action: 'saveHubItem', kind: 'todo', title: 'Chase the 2 Holmhead Place gas certificate', assigneeId: users[DAN] });
  forTeam = await act({ action: 'saveHubItem', kind: 'todo', title: 'Call back every owner who messaged today', department: 'client_relations' });
  await as(ANGELA);
  angelas = await act({ action: 'saveHubItem', kind: 'todo', title: 'Buy more bin bags' });
  const fresh = todoHubItemSchema.parse(angelas);
  assert.deepEqual([fresh.updateCount, fresh.updates], [0, []], 'a new to-do has no updates yet');
});

test('adding updates: newest first, with who and when, and the running total', async () => {
  await as(DAN);
  await act({ action: 'addTodoUpdate', id: forDan.id, text: 'Emailed the engineer' });
  await as(ADMIN);
  const after2 = todoHubItemSchema.parse(await act({ action: 'addTodoUpdate', id: forDan.id, text: '  Booked for Thursday  ' }));
  assert.equal(after2.updateCount, 2);
  assert.deepEqual(after2.updates.map(u => [u.text, u.byName, u.kind]), [['Booked for Thursday', 'Admin', 'note'], ['Emailed the engineer', 'Dan', 'note']]);
  assert.ok(after2.updates.every(u => !Number.isNaN(Date.parse(u.at))));
  assert.ok(after2.updates[0].id > after2.updates[1].id, 'newest first');
  // The same history on the hub read, for anyone who sees it.
  await as(DAN);
  assert.deepEqual((await find(forDan.id)).updates.map(u => u.text), ['Booked for Thursday', 'Emailed the engineer']);
});

test('visibility follows the to-do: department, own, admin; others are refused', async () => {
  await as(ERIC);
  // Eric is in client relations: he sees the department's to-do and can update it, but not Dan's own.
  const eric = todoHubItemSchema.parse(await act({ action: 'addTodoUpdate', id: forTeam.id, text: 'Called 3 of 5' }));
  assert.equal(eric.updates[0].byName, 'Eric');
  await assert.rejects(act({ action: 'addTodoUpdate', id: forDan.id, text: 'Not mine' }), /To-do not found/);
  assert.equal(await find(forDan.id), undefined);
  await as(ANGELA);
  await assert.rejects(act({ action: 'addTodoUpdate', id: forTeam.id, text: 'Not my department' }), /To-do not found/);
  await act({ action: 'addTodoUpdate', id: angelas.id, text: 'Ordered online' });
  await as(DAN);
  await assert.rejects(act({ action: 'addTodoUpdate', id: angelas.id, text: 'Someone else\'s' }), /To-do not found/);
  await as(ADMIN);
  assert.equal((await find(angelas.id)).updateCount, 1, 'the admin sees every to-do and its log');
});

test('owners are refused: no hub read, no updates, even with the id', async () => {
  await as(OWNER);
  await assert.rejects(hub(), /Team access/);
  await assert.rejects(act({ action: 'addTodoUpdate', id: forDan.id, text: 'Hello' }), /Team access/);
  const rows = await owner('select count(*)::int n from private.workspace_hub_item_updates where created_by=$1', [users[OWNER]]);
  assert.equal(rows[0].n, 0);
  // No direct table access for signed-in users either.
  await as(DAN);
  await assert.rejects(db.query('select * from private.workspace_hub_item_updates'), /permission denied/);
});

test('ticking done logs "Marked done"; reopening logs "Reopened"; approvals log nothing', async () => {
  await as(DAN);
  const current = await find(forDan.id);
  const done = todoHubItemSchema.parse(await act({ action: 'moveHubItem', id: forDan.id, version: current.version, status: 'done' }));
  assert.equal(done.status, 'done');
  assert.deepEqual([done.updates[0].text, done.updates[0].kind, done.updates[0].byName, done.updateCount], ['Marked done', 'done', 'Dan', 3]);
  const reopened = todoHubItemSchema.parse(await act({ action: 'moveHubItem', id: forDan.id, version: done.version, status: 'open' }));
  assert.deepEqual([reopened.updates[0].text, reopened.updateCount], ['Reopened', 4]);
  await as(ANGELA);
  const ticket = await act({ action: 'saveHubItem', kind: 'approval', title: 'New hoover', amountMinor: 14999 });
  await as(ADMIN);
  const decided = todoHubItemSchema.parse(await act({ action: 'moveHubItem', id: ticket.id, version: ticket.version, status: 'approved' }));
  assert.deepEqual([decided.updateCount, decided.updates], [0, []]);
  await assert.rejects(act({ action: 'addTodoUpdate', id: ticket.id, text: 'Not a to-do' }), /To-do not found/);
});

test('input checks: text required and capped, unknown keys refused, a repeated request returns the same answer', async () => {
  assert.throws(() => teamsActionSchema.parse({ action: 'addTodoUpdate', requestId: crypto.randomUUID(), id: forDan.id, text: '   ' }));
  assert.throws(() => teamsActionSchema.parse({ action: 'addTodoUpdate', requestId: crypto.randomUUID(), id: forDan.id, text: 'x'.repeat(2001) }));
  await as(DAN);
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'addTodoUpdate', requestId: crypto.randomUUID(), id: forDan.id, text: 'ok', extra: 1 }]), /Unknown or oversized/);
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'addTodoUpdate', requestId: crypto.randomUUID(), id: forDan.id, text: '' }]), /Invalid field text/);
  const input = { action: 'addTodoUpdate', requestId: crypto.randomUUID(), id: forDan.id, text: 'Once only' };
  const first = await rpc('workspace_teams_action', [input]);
  const again = await rpc('workspace_teams_action', [input]);
  assert.deepEqual(again, first);
  assert.equal((await find(forDan.id)).updates.filter(u => u.text === 'Once only').length, 1);
});

test('notifies whoever it is for and whoever set it, not the writer', async () => {
  const n = await owner("select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='hub.todo_updated'");
  const heard = new Set(n.map(r => r.user_id));
  assert.ok(heard.has(users[ADMIN]), 'the admin set Dan\'s to-do');
  assert.ok(heard.has(users[DAN]), 'Dan hears the admin\'s update on his to-do');
  assert.ok(!heard.has(users[OWNER]));
});

test('the migration runs twice without changing anything', async () => {
  const sql = await fs.readFile('supabase/migrations/' + files.find(f => f.startsWith('20261016200000')), 'utf8');
  await db.exec('reset role');
  const before = (await owner("select pg_get_functiondef('private.workspace_hub_action(jsonb)'::regprocedure) a, pg_get_functiondef('private.workspace_hub_view(private.workspace_hub_items)'::regprocedure) v, pg_get_functiondef('private.workspace_teams_action(jsonb)'::regprocedure) t"))[0];
  await db.exec(sql);
  const again = (await owner("select pg_get_functiondef('private.workspace_hub_action(jsonb)'::regprocedure) a, pg_get_functiondef('private.workspace_hub_view(private.workspace_hub_items)'::regprocedure) v, pg_get_functiondef('private.workspace_teams_action(jsonb)'::regprocedure) t"))[0];
  assert.deepEqual(again, before);
  assert.equal(before.a.split("'Marked done'").length, 2, 'patched once');
  assert.equal((await owner('select count(*)::int n from private.workspace_hub_item_updates'))[0].n > 0, true, 'the log is kept');
});
