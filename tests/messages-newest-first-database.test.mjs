import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Messages lists follow the time: guest conversations from every channel carry the time of their latest message (guest or
// team), and the app orders by it. The read gives conversations waiting for a reply first, oldest wait at the top, which is
// why a new email sat at the bottom; byLatest puts it on top. The read's limit already keeps the newest 300.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { inboxActionSchema, inboxListSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const { byLatest, guestStatus } = await vite.ssrLoadModule('/lib/inbox-filters.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const ADMIN = '99500000-0000-4000-8000-000000000001', SESSION = '99510000-0000-4000-8000-000000000001';
await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'order@example.com',now())", [ADMIN]);
await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [SESSION, ADMIN]);
await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [SESSION, ADMIN]);
await db.query("update public.workspace_profiles set status='active',role='admin',full_name='Ada Admin' where user_id=$1", [ADMIN]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication')", [ADMIN]);
const asAdmin = async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ADMIN, session_id: SESSION })]); await db.exec('set role authenticated'); };
const asBackend = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const msg = (thread, direction, minutes, channel = 'airbnb') => ({ externalId: `${thread}-${direction}-${minutes}`, threadRef: thread, channel, direction, sentAt: ago(minutes) });
const list = async () => { await asAdmin(); return inboxListSchema.parse(await rpc('workspace_guest_inbox_read', ['list', null, 'all'])).threads; };
const ref = t => t.reservationRef ?? t.guestName;

// A channel-manager guest waiting 90 minutes; an engaged one (answered 50 minutes ago); one closed 20 minutes ago; and a new
// email two minutes ago.
await asBackend();
await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [msg('waiting', 'guest', 90), msg('engaged', 'guest', 60), msg('engaged', 'team', 50), msg('closed', 'guest', 20)] }]);
await rpc('workspace_guest_messages_ingest', [{ source: 'email', messages: [msg('email', 'guest', 2, 'email')] }]);
await db.exec('reset role');
const ids = Object.fromEntries((await db.query("select thread_ref,id::text from private.workspace_guest_threads")).rows.map(r => [r.thread_ref, r.id]));
await asAdmin();
await rpc('workspace_guest_inbox_action', [inboxActionSchema.parse({ requestId: crypto.randomUUID(), action: 'setStatus', threadId: ids.closed, status: 'done' })]);
const order = threads => threads.map(t => Object.entries(ids).find(([, id]) => id === t.id)[0]);

test('the read puts the oldest wait first; byLatest puts the new email on top', async () => {
  const threads = await list();
  assert.deepEqual(order(threads).slice(0, 2), ['waiting', 'email'], 'the read: waiting conversations first, oldest wait first (the reported bug)');
  assert.deepEqual(order(byLatest(threads, t => t.lastMessageAt, t => t.id)), ['email', 'closed', 'engaged', 'waiting']);
  assert.deepEqual(order(byLatest(threads, t => t.lastMessageAt, t => t.id).filter(t => guestStatus(t) === 'reply')), ['email', 'waiting']);
});

test('a team reply, and a new guest message, move a conversation to the top', async () => {
  await asAdmin();
  await rpc('workspace_guest_inbox_action', [inboxActionSchema.parse({ requestId: crypto.randomUUID(), action: 'reply', threadId: ids.waiting, body: 'Sorry for the wait, the code is 4512.' })]);
  assert.equal(order(byLatest(await list(), t => t.lastMessageAt, t => t.id))[0], 'waiting');
  // The closed conversation gets a new message: it reopens and comes to the top.
  await asBackend();
  await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [{ ...msg('closed', 'guest', 0), sentAt: new Date().toISOString(), externalId: 'closed-guest-new' }] }]);
  const after = byLatest(await list(), t => t.lastMessageAt, t => t.id);
  assert.equal(order(after)[0], 'closed');
  assert.equal(after[0].status, 'open');
});

test('the read keeps the newest 300 conversations, by their latest message', async () => {
  const def = (await db.query("select pg_get_functiondef('private.workspace_guest_inbox_read(text,uuid,text)'::regprocedure) d")).rows[0].d;
  assert.match(def, /order by t\.last_message_at desc nulls last limit 300/);
});
