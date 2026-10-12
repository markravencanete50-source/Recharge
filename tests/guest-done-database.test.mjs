import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Marking a guest conversation Done stops the wait: a guest message nobody replied to (a final
// "Thanks!") stops counting in reply times once the conversation was marked Done after it.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { inboxActionSchema, inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// The live Hostaway sync is paused for the new business; the import is exercised switched back on.
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); await vite.close(); });

const users = ['admin', 'stays', 'stays'].map((_, i) => `99500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9950', '9960');
const [ADMIN, ANNA, BEN] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `done${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], ['admin', 'stays', 'stays'][i], ['Admin', 'Anna', 'Ben'][i]]);
}
for (const who of [ANNA, BEN]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication')", [users[who]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('delete from private.workspace_write_limits;delete from private.workspace_guest_thread_marks;delete from private.workspace_guest_messages;delete from private.workspace_guest_threads;delete from private.workspace_shifts');
});
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_guest_inbox_action', [inboxActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const thread = async id => inboxThreadSchema.parse(await rpc('workspace_guest_inbox_read', ['thread', id, null]));
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rows = async () => sql("select message_id,grade,user_id,minutes::float8 minutes from private.workspace_response_rows(now()-interval '3 days',now()+interval '1 minute') order by sent_at");
const marks = async () => sql('select source,thread_ref,marked_by from private.workspace_guest_thread_marks order by marked_at');
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
// The tests move time around, so make messages already stored look as if they arrived when sent.
const arrivedWhenSent = () => sql('update private.workspace_guest_messages set created_at=sent_at where created_at>sent_at');
const shift = (who, from, to = null) => sql("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,$3,gen_random_uuid())", [users[who], ago(from), to === null ? null : ago(to)]);
const guest = (guestName, body, minutes, threadId) => act({ action: 'logMessage', channel: 'airbnb', guestName, body, sentAt: ago(minutes), ...(threadId ? { threadId } : {}) });

test('an unreplied "Thanks!" counts red until the conversation is marked Done', async () => {
  await shift(ANNA, 120);
  await as(ANNA);
  const t = await guest('Sam Guest', 'Thanks!', 30);
  assert.deepEqual((await rows()).map(r => [r.grade, r.user_id]), [['red', users[ANNA]]]);
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.deepEqual(await rows(), []);
  assert.equal((await thread(t.id)).thread.waitingSince, null);
  assert.deepEqual(await marks(), [{ source: 'manual', thread_ref: (await sql('select thread_ref from private.workspace_guest_threads'))[0].thread_ref, marked_by: users[ANNA] }]);
});

test('a conversation reopened after Done starts a new wait at the new message', async () => {
  await shift(ANNA, 300, 90);
  await shift(BEN, 90);
  await as(ANNA);
  const t = await guest('Sam Guest', 'Thanks!', 120);
  await arrivedWhenSent();
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  // The mark was made an hour ago; the guest writes again 15 minutes ago.
  await sql("update private.workspace_guest_thread_marks set marked_at=$1 where source='manual'", [ago(60)]);
  const second = await guest('Sam Guest', 'One more thing: can we keep the bags here?', 15, t.id);
  assert.equal(second.status, 'open');
  const newest = (await sql("select id,sent_at from private.workspace_guest_messages where body like 'One more%'"))[0];
  assert.equal(new Date(second.waitingSince).getTime(), new Date(newest.sent_at).getTime(), 'the wait starts at the new message, not at "Thanks!"');
  // Only the new wait counts, credited to Ben who was on shift when it arrived.
  assert.deepEqual((await rows()).map(r => [r.message_id, r.grade, r.user_id]), [[newest.id, 'red', users[BEN]]]);
  // A reply 3 minutes later is timed from the new message: green.
  await act({ action: 'reply', threadId: t.id, body: 'Of course', sentAt: ago(12) });
  assert.deepEqual((await rows()).map(r => [r.message_id, r.grade, r.minutes, r.user_id]), [[newest.id, 'green', 3, users[BEN]]]);
  assert.equal((await thread(t.id)).thread.waitingSince, null);
});

test('replies made before Done are graded as before', async () => {
  await shift(ANNA, 240);
  await as(ANNA);
  const quick = await guest('Quick', 'Where is the key?', 30);
  const middling = await guest('Middling', 'Is there parking?', 29);
  const slow = await guest('Slow', 'Can we check in early?', 28);
  await act({ action: 'reply', threadId: quick.id, body: 'In the safe', sentAt: ago(27) });
  await act({ action: 'reply', threadId: middling.id, body: 'Yes, free', sentAt: ago(21) });
  await act({ action: 'reply', threadId: slow.id, body: 'From 1pm', sentAt: ago(10) });
  const before = (await rows()).map(r => [r.grade, r.minutes]);
  assert.deepEqual(before, [['green', 3], ['amber', 8], ['red', 18]]);
  for (const x of [quick, middling, slow]) await act({ action: 'setStatus', threadId: x.id, status: 'done' });
  assert.deepEqual((await rows()).map(r => [r.grade, r.minutes]), before, 'Done after a reply changes nothing');
  assert.equal((await marks()).length, 3);
});

test('an unreplied message after an earlier reply is left out too once Done', async () => {
  await shift(ANNA, 240);
  await as(ANNA);
  const t = await guest('Sam Guest', 'Hello', 100);
  await act({ action: 'reply', threadId: t.id, body: 'Hi', sentAt: ago(98) });
  await guest('Sam Guest', 'Thanks!', 90, t.id);
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.deepEqual((await rows()).map(r => r.grade), ['green'], 'only the answered question is graded');
});

test('a message sent before Done but delivered after it still waits and is counted', async () => {
  await shift(ANNA, 240);
  await asBackend();
  const m = (n, direction, minutes) => ({ externalId: `late-${n}`, threadRef: 'late', channel: 'airbnb', direction, sentAt: ago(minutes), body: 'Hi', guestName: 'Lee Park' });
  await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [m(1, 'guest', 60), m(2, 'team', 58)] }]);
  const t = (await sql("select id from private.workspace_guest_threads where thread_ref='late'"))[0];
  await arrivedWhenSent();
  await as(ANNA);
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  await sql("update private.workspace_guest_thread_marks set marked_at=$1 where thread_ref='late'", [ago(20)]);
  // The guest wrote 30 minutes ago, 10 minutes before Done was pressed, but the feed only brings it in now.
  await asBackend();
  await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [m(3, 'guest', 30)] }]);
  await as(ANNA);
  const late = (await sql("select id,sent_at from private.workspace_guest_messages where external_id='late-3'"))[0];
  const read = await thread(t.id);
  assert.equal(read.thread.status, 'open');
  assert.equal(new Date(read.thread.waitingSince).getTime(), new Date(late.sent_at).getTime());
  assert.deepEqual((await rows()).map(r => [r.message_id, r.grade, r.user_id]).slice(-1), [[late.id, 'red', users[ANNA]]]);
  // Done again, and it stops counting.
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.equal((await rows()).some(r => r.message_id === late.id), false);
});

test('pressing Done again adds no mark; each real change to Done adds one', async () => {
  await as(ANNA);
  const t = await guest('Sam Guest', 'Thanks!', 30);
  await act({ action: 'setStatus', threadId: t.id, status: 'open' });
  assert.equal((await marks()).length, 0, 'open to open is not a mark');
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.equal((await marks()).length, 1);
  await as(BEN);
  await act({ action: 'setStatus', threadId: t.id, status: 'open' });
  assert.equal((await marks()).length, 1, 'reopening keeps the mark');
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.deepEqual((await marks()).map(m => m.marked_by), [users[ANNA], users[BEN]]);
});

test('an old Hostaway conversation that starts as Done is marked; a recent one is not', async () => {
  await shift(ANNA, 3000);
  const msg = (id, minutes) => ({ id, incoming: true, body: 'Hello, a question', sentAt: ago(minutes) });
  const conversation = (id, messages) => ({ id, listingId: '', reservationId: '', guestName: 'Alex Kim', checkIn: null, checkOut: null, channel: 'other', marker: `m-${id}`, messages });
  await asBackend();
  await rpc('workspace_hostaway_messages_ingest', [{ conversations: [conversation('old', [msg('old-1', 30 * 60)]), conversation('new', [msg('new-1', 20)])] }]);
  assert.deepEqual(await sql("select thread_ref,status from private.workspace_guest_threads order by thread_ref"), [{ thread_ref: 'new', status: 'open' }, { thread_ref: 'old', status: 'done' }]);
  assert.deepEqual(await marks(), [{ source: 'hostaway', thread_ref: 'old', marked_by: null }]);
  // The old unreplied message isn't counted; the recent one is, now past amber.
  assert.deepEqual((await rows()).map(r => r.grade), ['red']);
  assert.equal((await rows())[0].message_id, (await sql("select id from private.workspace_guest_messages where external_id='new-1'"))[0].id);
  // Importing the same conversations again adds nothing.
  await asBackend();
  await rpc('workspace_hostaway_messages_ingest', [{ conversations: [{ ...conversation('old', [msg('old-1', 30 * 60)]), marker: 'moved' }] }]);
  assert.equal((await marks()).length, 1);
});

test('conversations already Done are marked by the migration, and running it again is safe', async () => {
  await shift(ANNA, 3000);
  await sql("insert into private.workspace_guest_threads(source,thread_ref,status,last_message_at) values('uplisting','c-done','done',now()-interval '1 hour'),('uplisting','c-open','open',now()-interval '1 hour')");
  for (const ref of ['c-done', 'c-open']) await sql("insert into private.workspace_guest_messages(source,external_id,thread_ref,direction,sent_at) values('uplisting',$1,$1,'guest',now()-interval '1 hour')", [ref]);
  assert.equal((await rows()).length, 2, 'both unreplied messages count before the backfill');
  const file = await fs.readFile('supabase/migrations/20261012050000_guest_done_stops_wait.sql', 'utf8');
  await db.exec(file);
  assert.deepEqual((await marks()).map(m => m.thread_ref), ['c-done']);
  assert.deepEqual((await rows()).map(r => r.message_id), [(await sql("select id from private.workspace_guest_messages where external_id='c-open'"))[0].id]);
  await db.exec(file);
  assert.equal((await marks()).length, 1, 'no second mark');
  // The patched functions did not get patched twice.
  const defs = (await sql("select pg_get_functiondef('private.workspace_guest_inbox_action(jsonb)'::regprocedure) a,pg_get_functiondef('private.workspace_hostaway_messages_ingest(jsonb)'::regprocedure) h,pg_get_functiondef('private.guest_thread_json(private.workspace_guest_threads)'::regprocedure) j"))[0];
  for (const def of Object.values(defs)) assert.equal(def.split('workspace_guest_thread_marks').length - 1, 1);
});

test('only the backend side can touch the marks; signed-in users and the public cannot read them', async () => {
  await sql("insert into private.workspace_guest_thread_marks(source,thread_ref) values('manual','x')");
  for (const who of [ADMIN, ANNA]) {
    await as(who);
    await assert.rejects(db.query('select * from private.workspace_guest_thread_marks'), /permission denied/);
    await assert.rejects(db.query("insert into private.workspace_guest_thread_marks(source,thread_ref) values('manual','y')"), /permission denied/);
  }
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query('select * from private.workspace_guest_thread_marks'), /permission denied/);
  await assert.rejects(db.query("select * from private.workspace_response_rows(now()-interval '1 day',now())"), /permission denied/);
  assert.equal((await sql("select relrowsecurity from pg_class where oid='private.workspace_guest_thread_marks'::regclass"))[0].relrowsecurity, true);
});
