import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// To-dos like ClickUp (migration 20261025100000): priority and start date, comments with replies, @mentions (who then see the
// to-do), reactions, unread counts, and an activity log of what changed and who changed it.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { todoHubSchema, todoHubItemSchema, todoFeed, changeWords } = await vite.ssrLoadModule('/lib/todo.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'stays', 'cleans', 'client'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, DAN, ERIC, ANGELA, OWNER] = roles.map((_, i) => i);
const NAMES = ['Admin', 'Dan', 'Eric', 'Angela', 'Owner'];
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `clickup${i}@example.com`]);
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

const view = x => todoHubItemSchema.parse(x);
let task;
test('priority and start date: set on a new to-do, changed from the to-do itself, and checked', async () => {
  await as(ADMIN);
  task = view(await act({ action: 'saveHubItem', kind: 'todo', title: "Negotiate with Kay's price", assigneeId: users[DAN], priority: 'high', startOn: '2026-10-20', dueOn: '2026-10-24' }));
  assert.deepEqual([task.priority, task.startOn, task.dueOn], ['high', '2026-10-20', '2026-10-24']);
  await as(DAN);
  task = view(await act({ action: 'setTodoFields', id: task.id, priority: 'urgent', dueOn: '2026-10-28' }));
  assert.deepEqual([task.priority, task.startOn, task.dueOn], ['urgent', '2026-10-20', '2026-10-28'], 'only the keys sent change');
  await assert.rejects(act({ action: 'setTodoFields', id: task.id, startOn: '2026-11-01' }), /start date must be on or before the due date/);
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'setTodoFields', requestId: crypto.randomUUID(), id: task.id, priority: 'asap' }]), /Choose a priority/);
  assert.throws(() => teamsActionSchema.parse({ action: 'setTodoFields', requestId: crypto.randomUUID(), id: task.id, startOn: '2026-11-02', dueOn: '2026-11-01' }));
  assert.throws(() => teamsActionSchema.parse({ action: 'saveHubItem', requestId: crypto.randomUUID(), kind: 'approval', title: 'Hoover', amountMinor: 100, priority: 'high' }));
  // Editing keeps them unless they are sent.
  await as(ADMIN);
  task = view(await act({ action: 'saveHubItem', id: task.id, version: task.version, kind: 'todo', title: "Negotiate with Kay's price", assigneeId: users[DAN], dueOn: '2026-10-28' }));
  assert.deepEqual([task.priority, task.startOn], ['urgent', '2026-10-20']);
  task = view(await act({ action: 'setTodoFields', id: task.id, priority: null, startOn: null }));
  assert.deepEqual([task.priority, task.startOn], [null, null]);
  // Eric cannot see Dan's to-do, so he cannot set it.
  await as(ERIC);
  await assert.rejects(act({ action: 'setTodoFields', id: task.id, priority: 'low' }), /To-do not found/);
});

test('activity: what changed and who changed it, oldest first in the feed', async () => {
  await as(DAN);
  const t = view(await find(task.id));
  const lines = t.activity.map(e => changeWords(e)).reverse();
  assert.ok(lines.includes('Admin created this to-do'));
  assert.ok(lines.includes('Dan set the due date to 28 Oct 2026'));
  assert.ok(lines.includes('Dan set the priority to Urgent'));
  assert.ok(lines.includes('Admin removed the start date'));
  assert.ok(lines.includes('Admin cleared the priority'));
  assert.ok(!lines.some(l => /version|updated_at/.test(l)));
  await as(ADMIN);
  const current = view(await find(task.id));
  const moved = view(await act({ action: 'saveHubItem', id: task.id, version: current.version, kind: 'todo', title: 'Negotiate with Kay', department: 'client_relations', assigneeId: null, dueOn: '2026-10-28' }));
  const latest = moved.activity.map(e => e.text);
  assert.ok(latest.includes('renamed it to “Negotiate with Kay”'));
  assert.ok(latest.includes('took it off Dan'));
  assert.ok(latest.includes('moved it to Client relations'));
  // Ticking stays with the updates, and the feed shows it as a change.
  const done = view(await act({ action: 'moveHubItem', id: task.id, version: moved.version, status: 'done' }));
  assert.equal(todoFeed(done).at(-1).text, 'marked it done');
  task = view(await act({ action: 'moveHubItem', id: task.id, version: done.version, status: 'open' }));
});

test('comments, replies and @mentions: a reply joins its comment, a mention is told and can see the to-do', async () => {
  // Angela cleans: not in client relations, so she cannot see it until she is mentioned.
  await as(ANGELA);
  assert.equal(await find(task.id), undefined);
  await as(ERIC);
  const first = view(await act({ action: 'addTodoUpdate', id: task.id, text: '@Angela Can you check the flat first?', mentions: [users[ANGELA]] }));
  const comment = first.updates[0];
  assert.deepEqual(comment.mentions.map(m => m.name), ['Angela']);
  await as(ANGELA);
  const seen = view(await find(task.id));
  assert.ok(seen, 'mentioned, she sees the to-do');
  assert.equal(seen.updates[0].mentions[0].you, true);
  const reply = view(await act({ action: 'addTodoUpdate', id: task.id, text: 'Yes, tomorrow morning', replyTo: comment.id }));
  assert.equal(reply.updates[0].parentId, comment.id);
  // A reply to a reply joins the same thread.
  await as(ERIC);
  const deeper = view(await act({ action: 'addTodoUpdate', id: task.id, text: 'Thanks', replyTo: reply.updates[0].id }));
  assert.equal(deeper.updates[0].parentId, comment.id);
  const thread = todoFeed(deeper).find(e => e.kind === 'comment' && e.comment.id === comment.id);
  assert.deepEqual(thread.replies.map(r => r.text), ['Yes, tomorrow morning', 'Thanks']);
  // Checks: the reply must be on this to-do, mentions only people on the team.
  await as(ADMIN);
  const other = view(await act({ action: 'saveHubItem', kind: 'todo', title: 'Something else' }));
  await assert.rejects(act({ action: 'addTodoUpdate', id: other.id, text: 'Wrong thread', replyTo: comment.id }), /Reply to a comment on this to-do/);
  await assert.rejects(act({ action: 'addTodoUpdate', id: task.id, text: 'Hello owner', mentions: [users[OWNER]] }), /people on the team only/);
  // Angela heard about the mention; Dan (no longer on it) and the owner did not.
  const told = await owner("select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='hub.todo_mentioned'");
  assert.deepEqual(told.map(r => r.user_id), [users[ANGELA]]);
  const heard = new Set((await owner("select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='hub.todo_updated'")).map(r => r.user_id));
  assert.ok(heard.has(users[ERIC]), 'Eric wrote on it, so he hears Angela\'s reply');
  assert.ok(heard.has(users[ADMIN]), 'the admin set it');
  assert.ok(!heard.has(users[OWNER]));
});

test('reactions: one per person, changed or taken off', async () => {
  await as(DAN);
  // Dan is in client relations, so he sees the department's to-do.
  const t = view(await find(task.id));
  const comment = t.updates.find(u => u.parentId == null && u.kind === 'note');
  let r = view(await act({ action: 'reactTodoUpdate', updateId: comment.id, emoji: '👍' }));
  assert.deepEqual(r.updates.find(u => u.id === comment.id).reactions.map(x => [x.emoji, x.count, x.mine, x.names]), [['👍', 1, true, ['Dan']]]);
  await as(ERIC);
  r = view(await act({ action: 'reactTodoUpdate', updateId: comment.id, emoji: '👍' }));
  assert.deepEqual(r.updates.find(u => u.id === comment.id).reactions.map(x => [x.emoji, x.count, x.mine]), [['👍', 2, true]]);
  r = view(await act({ action: 'reactTodoUpdate', updateId: comment.id, emoji: '🎉' }));
  assert.deepEqual(r.updates.find(u => u.id === comment.id).reactions.map(x => [x.emoji, x.count]), [['👍', 1], ['🎉', 1]]);
  r = view(await act({ action: 'reactTodoUpdate', updateId: comment.id, emoji: null }));
  assert.deepEqual(r.updates.find(u => u.id === comment.id).reactions.map(x => [x.emoji, x.count]), [['👍', 1]]);
  assert.throws(() => teamsActionSchema.parse({ action: 'reactTodoUpdate', requestId: crypto.randomUUID(), updateId: comment.id, emoji: '🍕' }));
  await as(OWNER);
  await assert.rejects(act({ action: 'reactTodoUpdate', updateId: comment.id, emoji: '👍' }), /Team access/);
});

test('unread: other people\'s comments since you last opened it', async () => {
  await as(DAN);
  assert.ok(view(await find(task.id)).unread > 0, 'comments by others are new to Dan');
  const read = view(await act({ action: 'readTodo', id: task.id }));
  assert.equal(read.unread, 0);
  await as(ERIC);
  await act({ action: 'addTodoUpdate', id: task.id, text: 'Kay called back' });
  assert.equal(view(await find(task.id)).unread, 0, 'your own comments are never unread');
  await as(DAN);
  assert.equal(view(await find(task.id)).unread, 1);
  await as(ANGELA);
  await assert.rejects(act({ action: 'readTodo', id: (await owner("select id from private.workspace_hub_items where title='Something else'"))[0].id }), /To-do not found/);
});

test('no direct table access, and the migration runs twice without changing anything', async () => {
  await as(DAN);
  for (const t of ['workspace_hub_item_reactions', 'workspace_hub_item_reads', 'workspace_hub_item_events']) await assert.rejects(db.query(`select * from private.${t}`), /permission denied/);
  const sql = await fs.readFile('supabase/migrations/' + files.find(f => f.startsWith('20261025100000')), 'utf8');
  const defs = "select pg_get_functiondef('private.workspace_hub_action(jsonb)'::regprocedure) a, pg_get_functiondef('private.workspace_hub_view(private.workspace_hub_items)'::regprocedure) v, pg_get_functiondef('private.workspace_teams_action(jsonb)'::regprocedure) t, pg_get_functiondef('private.workspace_hub_can_see(private.workspace_hub_items)'::regprocedure) c";
  const before = (await owner(defs))[0];
  const events = (await owner('select count(*)::int n from private.workspace_hub_item_events'))[0].n;
  await db.exec(sql);
  assert.deepEqual((await owner(defs))[0], before);
  assert.equal((await owner('select count(*)::int n from private.workspace_hub_item_events'))[0].n, events);
  assert.equal(before.a.split('todo fields added: 20261025100000').length, 2, 'patched once');
  assert.equal(sql.includes('—'), false, 'no em dash');
});
