import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The guest inbox: logged and channel-manager messages grouped into conversations, seen only by
// people with the guest communication tool on that property, with replies timed for performance.
// Also the per-platform logins on a property (no passwords).
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { inboxActionSchema, inboxListSchema, inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const { otaAccountsSchema } = await vite.ssrLoadModule('/lib/ota-accounts.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'stays', 'stays', 'cleans', 'client'];
const users = roles.map((_, i) => `99300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9930', '9940');
const [ADMIN, ANNA, BEN, CLEANER, OWNER] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `inbox${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Anna', 'Ben', 'Cleo', 'Owner'][i]]);
}
const props = [];
for (const name of ['Harbour Flat', 'Castle Loft']) props.push((await db.query('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', [name, users[ADMIN]])).rows[0].id);
const [HARBOUR, CASTLE] = props;
// Anna looks after Harbour Flat and Ben Castle Loft; both hold the guest communication tool.
for (const [who, prop] of [[ANNA, HARBOUR], [BEN, CASTLE]]) {
  await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication'),($1,'ota-logins'),($1,'property-database')", [users[who]]);
  await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3)", [prop, users[who], users[ADMIN]]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule')", [users[CLEANER]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_guest_inbox_action', [inboxActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const list = async (status = 'waiting') => inboxListSchema.parse(await rpc('workspace_guest_inbox_read', ['list', null, status]));
const thread = async id => inboxThreadSchema.parse(await rpc('workspace_guest_inbox_read', ['thread', id, null]));
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();

test('staff log a guest message and reply; the wait is graded and credited to the shift', async () => {
  await db.query("insert into private.workspace_shifts(user_id,department,clocked_in_at,request_id) values($1,'guest_relations',$2,gen_random_uuid())", [users[ANNA], ago(60)]);
  await as(ANNA);
  assert.deepEqual((await list()).threads, []);
  const requestId = crypto.randomUUID();
  const input = { action: 'logMessage', requestId, channel: 'airbnb', guestName: 'Sam Guest', propertyId: HARBOUR, reservationRef: 'HM123', body: 'What time is check-in?', sentAt: ago(12) };
  const t = await act(input);
  assert.equal(t.guestName, 'Sam Guest');
  assert.equal(t.propertyName, 'Harbour Flat');
  assert.equal(t.status, 'open');
  assert.ok(t.waitingSince);
  // Sending the same request again doesn't duplicate anything.
  await rpc('workspace_guest_inbox_action', [inboxActionSchema.parse(input)]);
  let waiting = await list();
  assert.deepEqual([waiting.waiting, waiting.threads.length, waiting.connected], [1, 1, false]);
  assert.equal(waiting.threads[0].preview, 'What time is check-in?');

  // A reply 4 minutes later is green, credited to Anna, who was on guest relations.
  await act({ action: 'reply', threadId: t.id, body: 'From 3pm. The key safe code is in your app.', sentAt: ago(8) });
  const after = await thread(t.id);
  assert.deepEqual(after.messages.map(m => [m.direction, m.delivery, m.author]), [['guest', null, null], ['team', 'logged', 'Anna']]);
  assert.equal(after.thread.waitingSince, null);
  assert.equal((await list()).waiting, 0);
  await db.exec('reset role');
  const graded = (await db.query("select grade,user_id from private.workspace_response_rows(now()-interval '1 day',now())")).rows;
  assert.deepEqual(graded.map(r => [r.grade, r.user_id]), [['green', users[ANNA]]]);
  await as(ANNA);

  // A reply can't be dated before the guest's message, and a done conversation leaves "open".
  await act({ action: 'logMessage', threadId: t.id, body: 'Can we leave bags early?', sentAt: ago(2) });
  await assert.rejects(act({ action: 'reply', threadId: t.id, body: 'Yes', sentAt: ago(5) }), /before the guest/);
  await act({ action: 'reply', threadId: t.id, body: '' });
  assert.equal((await thread(t.id)).messages.at(-1).body, null, 'replied on the platform');
  await act({ action: 'setStatus', threadId: t.id, status: 'done' });
  assert.deepEqual([(await list('open')).threads.length, (await list('done')).threads.length], [0, 1]);
});

test('each person sees only conversations for their properties; cleaners and owners see none', async () => {
  await as(BEN);
  assert.deepEqual((await list('all')).threads, [], 'Ben has no Harbour Flat conversations');
  await assert.rejects(act({ action: 'logMessage', channel: 'direct', guestName: 'Pat', propertyId: HARBOUR, body: 'Hello' }), /Property not found/);
  const mine = await act({ action: 'logMessage', channel: 'direct', guestName: 'Pat', propertyId: CASTLE, body: 'Is parking free?' });
  const unmatched = await act({ action: 'logMessage', channel: 'booking_com', guestName: 'Lee', body: 'Which property is this?' });
  await as(ANNA);
  const annaSees = (await list('all')).threads.map(t => t.guestName).sort();
  assert.deepEqual(annaSees, ['Lee', 'Sam Guest'], 'conversations without a property are shared');
  await assert.rejects(thread(mine.id), /Conversation not found/);
  await assert.rejects(act({ action: 'reply', threadId: mine.id, body: 'Hi' }), /Conversation not found/);
  // Matching the unmatched conversation to Castle Loft moves it to Ben.
  await as(BEN);
  await act({ action: 'editThread', threadId: unmatched.id, propertyId: CASTLE, guestName: 'Lee Park', reservationRef: 'BK-77' });
  await as(ANNA);
  assert.deepEqual((await list('all')).threads.map(t => t.guestName), ['Sam Guest']);
  await as(ADMIN);
  assert.equal((await list('all')).threads.length, 3, 'admins see everything');
  for (const who of [CLEANER, OWNER]) {
    await as(who);
    await assert.rejects(list(), /Guest inbox access required/);
  }
  assert.throws(() => inboxActionSchema.parse({ action: 'logMessage', requestId: crypto.randomUUID(), body: 'Hi' }), /guest’s name/);
});

test('the channel manager feed creates conversations with text, matched to the property', async () => {
  await as(ANNA);
  await assert.rejects(rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [] }]), /permission denied/);
  await asBackend();
  const m = (n, direction, minutes, extra = {}) => ({ externalId: `u-${n}`, threadRef: 'conv-1', propertyId: HARBOUR, channel: 'airbnb', direction, sentAt: ago(minutes), ...extra });
  const added = await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [
    m(1, 'guest', 30, { body: 'Hi, we are arriving late', guestName: 'Alex Kim', reservationRef: 'HMXYZ', checkIn: '2026-10-10', checkOut: '2026-10-12' }),
    m(2, 'team', 27, { body: 'No problem, self check-in' })] }]);
  assert.equal(added.added, 2);
  await assert.rejects(rpc('workspace_guest_messages_ingest', [{ source: 'manual', messages: [] }]), /Reserved source/);
  await as(ANNA);
  const feed = await list('all');
  const conv = feed.threads.find(t => t.guestName === 'Alex Kim');
  assert.ok(feed.connected);
  assert.deepEqual([conv.source, conv.reservationRef, conv.checkIn, conv.lastFrom], ['uplisting', 'HMXYZ', '2026-10-10', 'team']);
  // Done, then a new guest message reopens it.
  await act({ action: 'setStatus', threadId: conv.id, status: 'done' });
  await asBackend();
  await rpc('workspace_guest_messages_ingest', [{ source: 'uplisting', messages: [m(3, 'guest', 1, { body: 'Where do we park?' })] }]);
  await as(ANNA);
  const reopened = (await list()).threads.find(t => t.id === conv.id);
  assert.equal(reopened.status, 'open');
  assert.equal((await thread(conv.id)).messages.filter(x => x.delivery === 'sent').length, 1);
});

test('platform logins: one row per platform, admins edit, no passwords', async () => {
  const rows = [{ platform: 'Airbnb', login: 'hosts@recharge.example', holder: 'recharge', passwordWhere: '1Password, Stays vault', twoFactor: 'Ops phone', notes: '' },
    { platform: 'Booking.com', login: 'owner@example.com', holder: 'owner', passwordWhere: 'Owner keeps it', twoFactor: 'Owner mobile', notes: 'Ask before changing prices' }];
  assert.ok(otaAccountsSchema.safeParse(rows).success);
  assert.equal(otaAccountsSchema.safeParse([{ ...rows[0], notes: 'password: Summer2024!' }]).success, false, 'a typed password is refused');
  assert.equal(otaAccountsSchema.safeParse([{ ...rows[0], password: 'x' }]).success, false, 'there is no password field');
  await as(ADMIN);
  const version = (await db.query('select version from public.workspace_properties where id=$1', [HARBOUR])).rows[0].version;
  await rpc('workspace_save_property_details', [HARBOUR, version, 'otaAccounts', { accounts: rows }]);
  await assert.rejects(rpc('workspace_save_property_details', [HARBOUR, version + 1, 'otaAccounts', { accounts: [{ ...rows[0], password: 'secret' }] }]), /Check the platform logins/);
  await assert.rejects(rpc('workspace_save_property_details', [HARBOUR, version + 1, 'otaAccounts', { accounts: [{ ...rows[0], holder: 'someone' }] }]), /Check the platform logins/);
  await as(ANNA);
  assert.deepEqual((await rpc('workspace_property_details', [HARBOUR, 'ota'])).otaAccounts, rows);
  await assert.rejects(rpc('workspace_save_property_details', [HARBOUR, version + 1, 'otaAccounts', { accounts: [] }]), /Admin access required/);
  await as(BEN);
  await assert.rejects(rpc('workspace_property_details', [HARBOUR, 'ota']), /OTA access denied/);
});
