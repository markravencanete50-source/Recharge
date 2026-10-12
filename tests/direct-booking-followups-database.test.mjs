import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Direct booking follow-ups for Hostaway stays (client ask B3): the cron sweep, never a trigger.
// Every existing *.sql migration is applied, then this package's migration: the finished .sql once it is
// renamed, the .draft while it is being developed.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const NAME = '20261012180000_direct_booking_followups.sql';
const dir = 'supabase/migrations/';
const files = await fs.readdir(dir);
for (const file of files.filter(f => f.endsWith('.sql')).sort()) {
  if (file === NAME) continue;
  await db.exec(await fs.readFile(dir + file, 'utf8'));
}
const migrationText = await fs.readFile(dir + (files.includes(NAME) ? NAME : NAME + '.draft'), 'utf8');
await db.exec(migrationText);
// The live sync is paused for the new business; these tests exercise it switched back on.
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); });

const roles = ['super_admin', 'stays', 'client', 'cleans', 'accounts'];
const users = roles.map((_, i) => `95000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, STAYS, CLIENT, CLEANER, ACCOUNTS] = [0, 1, 2, 3, 4];
const session = i => users[i].replace('9500', '9600');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `dbf${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sync = async input => { await asBackend(); const result = await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', ...input }]); await db.exec('reset role'); return result; };
const sweep = async () => { await asBackend(); const result = await rpc('workspace_direct_booking_sweep'); await db.exec('reset role'); return result; };
const drain = async () => { for (let i = 0; i < 20; i++) { const r = await sweep(); if (!r.created) return; } };
const day = async n => (await sql('select (current_date+$1::int)::text d', [n]))[0].d;
const operations = async input => (await db.query('select public.workspace_operations_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;

const listing = (id, name) => ({ id, name, address: name + ' street', bedrooms: 2 });
const stay = async (id, listingId, inDays, nights, extra = {}) => ({
  id, listingId, checkIn: await day(inDays), checkOut: await day(inDays + nights), status: 'confirmed', channel: 'airbnb', channelReference: 'DBF' + id, guests: 2, payoutMinor: 50000, ...extra,
});
const reservationId = async ref => (await sql("select id from private.workspace_reservations where reference=$1", ['HA:' + ref]))[0]?.id;
const itemsFor = async ref => sql(`select w.id,w.status,w.module_id,w.title,w.client_visible,w.assignee_id,w.priority,w.created_by,w.property_id,d.data
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where d.kind='direct_booking' and d.data->>'reservationId'=$1 order by w.created_at,w.id`, [String(await reservationId(ref))]);
const countAll = async () => (await sql("select count(*)::int n from private.workspace_domain_details where kind='direct_booking'"))[0].n;

const properties = {};
await sync({ listings: ['701', '702', '703', '704', '705', '706', '707', '708', '709', '710'].map(id => listing(id, 'Follow-up flat ' + id)) });
for (const row of await sql("select id,hostaway_listing_id l from public.workspace_properties where hostaway_listing_id like '7%'")) properties[row.l] = row.id;
// The Stays person looks after every one of them; the client has the first.
await as(SUPER);
for (const id of Object.values(properties)) await db.query("select public.workspace_assign_property($1,$2,'staff')", [id, users[STAYS]]);
await db.query("select public.workspace_assign_property($1,$2,'client')", [properties['701'], users[CLIENT]]);
await db.exec('reset role');

test('the booking policy is the very setting the manual path reads (7 nights)', async () => {
  const policy = await sql('select minimum_nights from private.workspace_booking_policy where singleton');
  assert.equal(policy[0].minimum_nights, 7);
});

test('a confirmed Airbnb, Booking.com or Vrbo stay of 7 nights or more gets a follow-up, made by the sweep and not by the sync', async () => {
  const stays = [
    await stay('A1', '701', 20, 8, { channel: 'airbnb' }),
    await stay('B1', '702', 20, 7, { channel: 'booking_com' }),
    await stay('V1', '703', 20, 30, { channel: 'vrbo' }),
  ];
  await sync({ reservations: stays });
  assert.equal((await itemsFor('A1')).length, 0, 'the sync itself creates no follow-up: nothing can break it');
  const first = await sweep();
  assert.equal(first.created, 3);
  assert.equal(first.skipped, 0);
  assert.equal(first.failed, 0);
  for (const ref of ['A1', 'B1', 'V1']) {
    const rows = await itemsFor(ref);
    assert.equal(rows.length, 1, ref);
    assert.equal(rows[0].module_id, 'direct-bookings');
    assert.equal(rows[0].title, 'Follow up eligible direct booking');
    assert.equal(rows[0].status, 'waiting');
    assert.equal(rows[0].client_visible, false);
    assert.equal(rows[0].assignee_id, null);
    assert.equal(rows[0].created_by, null);
    assert.deepEqual(rows[0].data, { reservationId: String(await reservationId(ref)), phase: 'follow_up', workStatus: 'waiting' });
  }
  // The people looking after the property are told, exactly as for a stay entered by hand.
  const work = (await itemsFor('A1'))[0].id;
  const told = await sql('select user_id from private.workspace_notification_outbox where work_id=$1', [work]);
  assert.ok(told.some(r => r.user_id === users[STAYS]), 'the assigned Stays person is notified');
  assert.ok(told.some(r => r.user_id === users[SUPER]), 'admins are notified');
  assert.ok(!told.some(r => r.user_id === users[CLIENT] || r.user_id === users[CLEANER]), 'clients and cleaners never are');
});

test('a second run creates nothing', async () => {
  const before = await countAll();
  const again = await sweep();
  assert.deepEqual(again, { created: 0, skipped: 0, failed: 0 });
  assert.equal(await countAll(), before);
});

test('a short stay gets none, and the minimum comes from the policy', async () => {
  await sync({ reservations: [await stay('S6', '704', 20, 6), await stay('S4', '705', 20, 4)] });
  assert.equal((await sweep()).created, 0);
  assert.equal((await itemsFor('S6')).length, 0);
  assert.equal((await itemsFor('S4')).length, 0);
  // Super admins can change the minimum; the sweep follows the same setting the manual path uses.
  await sql('update private.workspace_booking_policy set minimum_nights=4 where singleton');
  try {
    const run = await sweep();
    assert.equal(run.created, 2, 'the 6 and 4 night stays now qualify');
    assert.equal((await itemsFor('S4')).length, 1);
  } finally {
    await sql('update private.workspace_booking_policy set minimum_nights=7 where singleton');
  }
});

test('owner stays, direct and other-channel stays get none', async () => {
  await sync({ reservations: [
    await stay('O1', '706', 20, 10, { channel: 'other', channelReference: 'Owner stay' }),
    await stay('D1', '707', 20, 10, { channel: 'direct' }),
    await stay('X1', '708', 20, 10, { channel: 'other', channelReference: 'Agency block' }),
  ] });
  const run = await sweep();
  assert.equal(run.created, 0);
  for (const ref of ['O1', 'D1', 'X1']) assert.equal((await itemsFor(ref)).length, 0, ref);
});

test('a stay entered by hand already has its own follow-up and gets no second one', async () => {
  await as(STAYS);
  const recorded = await operations({ action: 'recordReservation', propertyId: properties['709'], reference: 'MANUAL-LONG', checkIn: await day(30), checkOut: await day(40), status: 'confirmed' });
  assert.ok(recorded.followUpWorkId, 'the manual path made its follow-up');
  const run = await sweep();
  assert.equal(run.created, 0);
  const id = recorded.reservation.id;
  const rows = await sql("select w.id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='direct_booking' and d.data->>'reservationId'=$1", [id]);
  assert.equal(rows.length, 1);
  // Even with an OTA channel on it, the source decides: a stay entered by hand is never swept.
  await as(STAYS);
  const short = await operations({ action: 'recordReservation', propertyId: properties['709'], reference: 'MANUAL-OTA', checkIn: await day(50), checkOut: await day(53), status: 'confirmed' });
  assert.equal(short.followUpWorkId, null);
  await sql("update private.workspace_reservations set channel='airbnb',channel_reference='MAN-OTA' where id=$1", [short.reservation.id]);
  await sql('update private.workspace_booking_policy set minimum_nights=3 where singleton');
  try {
    assert.equal((await sweep()).created, 0, 'a manual stay stays untouched');
  } finally {
    await sql('update private.workspace_booking_policy set minimum_nights=7 where singleton');
  }
});

test('the swept item has the same shape as the one the manual path makes', async () => {
  await as(STAYS);
  const recorded = await operations({ action: 'recordReservation', propertyId: properties['710'], reference: 'SHAPE-MANUAL', checkIn: await day(60), checkOut: await day(68), status: 'confirmed' });
  await sync({ reservations: [await stay('SH1', '710', 80, 8)] });
  assert.equal((await sweep()).created, 1);
  const manual = (await sql(`select w.module_id,w.title,w.client_visible,w.status,w.priority,w.assignee_id,w.property_id,d.kind,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1`, [recorded.followUpWorkId]))[0];
  const swept = (await itemsFor('SH1'))[0];
  for (const key of ['module_id', 'title', 'client_visible', 'status', 'priority', 'assignee_id', 'property_id']) assert.equal(swept[key], manual[key], key);
  assert.deepEqual(Object.keys(swept.data).sort(), Object.keys(manual.data).sort());
  assert.equal(swept.data.phase, manual.data.phase);
  assert.equal(swept.data.workStatus, manual.data.workStatus);
  // And it is a normal item: the Stays person can work it like any other.
  await as(STAYS);
  const read = (await db.query('select public.workspace_operations_read($1) data', [properties['710']])).rows[0].data;
  const listed = read.filter(w => w.kind === 'direct_booking');
  assert.equal(listed.length, 2, 'the manual and the swept item both appear');
  assert.ok(listed.every(w => w.data.phase === 'follow_up'));
});

test('cancelled, enquiry and past stays get none; a stay checking in today does', async () => {
  const ghost = await stay('C1', '701', 120, 9);
  await sync({ reservations: [
    ghost,
    await stay('E1', '702', 120, 9, { status: 'enquiry' }),
    await stay('P1', '703', -20, 10),
    await stay('P2', '704', -1, 10),
    await stay('T1', '705', 0, 9),
  ] });
  // C1 is confirmed first (no sweep yet), then cancelled in Hostaway before the sweep sees it.
  await sync({ reservations: [{ ...ghost, status: 'cancelled' }] });
  const run = await sweep();
  assert.equal(run.created, 1, 'only today\'s check-in');
  assert.equal((await itemsFor('T1')).length, 1);
  for (const ref of ['C1', 'E1', 'P1', 'P2']) assert.equal((await itemsFor(ref)).length, 0, ref);
  // An enquiry that is later confirmed is picked up.
  await sync({ reservations: [await stay('E1', '702', 120, 9)] });
  assert.equal((await sweep()).created, 1);
  assert.equal((await itemsFor('E1')).length, 1);
});

test('"today or later" is the London date of the run', async () => {
  await sync({ reservations: [await stay('L1', '706', 4, 9)] });
  await asBackend();
  const late = (await db.query("select private.workspace_direct_booking_sweep(now()+interval '10 days') r")).rows[0].r;
  await db.exec('reset role');
  assert.equal(late.created, 0, 'by then the stay has begun');
  assert.equal((await itemsFor('L1')).length, 0);
  assert.equal((await sweep()).created, 1);
});

test('an archived property is left alone', async () => {
  await sync({ reservations: [await stay('AR1', '707', 25, 9)] });
  await sql("update public.workspace_properties set status='archived' where id=$1", [properties['707']]);
  try {
    assert.equal((await sweep()).created, 0);
  } finally {
    await sql("update public.workspace_properties set status='active' where id=$1", [properties['707']]);
  }
  assert.equal((await sweep()).created, 1);
});

test('a follow-up closed by hand is never brought back, but one cancelled because the stay changed is replaced', async () => {
  await sync({ reservations: [await stay('K1', '708', 150, 9), await stay('K2', '709', 150, 9)] });
  assert.equal((await sweep()).created, 2);
  // K1: staff cancel the follow-up themselves.
  const k1 = (await itemsFor('K1'))[0];
  await sql("update private.workspace_domain_details set data=data||'{\"workStatus\":\"cancelled\"}'::jsonb where work_id=$1", [k1.id]);
  await sql("update public.workspace_work_items set status='cancelled' where id=$1", [k1.id]);
  assert.equal((await sweep()).created, 0);
  assert.equal((await itemsFor('K1')).length, 1);
  // K2: the dates change in Hostaway, which cancels the quote and the item; the sweep replaces it.
  await sync({ reservations: [await stay('K2', '709', 151, 9)] });
  const after = await itemsFor('K2');
  assert.equal(after.length, 1);
  assert.equal(after[0].status, 'cancelled');
  assert.ok(after[0].data.reservationChangedAt, 'cancelled because the stay changed');
  assert.equal((await sweep()).created, 1);
  const replaced = await itemsFor('K2');
  assert.equal(replaced.length, 2);
  assert.deepEqual(replaced.map(r => r.status), ['cancelled', 'waiting']);
  assert.equal((await sweep()).created, 0, 'and only once');
  // Shortened below the minimum: nothing new.
  await sync({ reservations: [await stay('K2', '709', 151, 5)] });
  assert.equal((await sweep()).created, 0);
});

test('at most 50 per run, soonest first, the rest on the next runs', async () => {
  await drain();
  const reservations = [];
  for (let i = 0; i < 55; i++) reservations.push(await stay('CAP' + i, '701', 200 + i * 9, 8));
  // The client property used above has stays at other dates; these do not overlap them.
  await sync({ reservations });
  const first = await sweep();
  assert.equal(first.created, 50);
  assert.equal(first.skipped, 5);
  const done = await sql("select r.reference from private.workspace_domain_details d join private.workspace_reservations r on r.id::text=d.data->>'reservationId' where d.kind='direct_booking' and r.reference like 'HA:CAP%'");
  assert.equal(done.length, 50);
  for (let i = 0; i < 50; i++) assert.ok(done.some(r => r.reference === 'HA:CAP' + i), 'soonest stays first: CAP' + i);
  const second = await sweep();
  assert.deepEqual(second, { created: 5, skipped: 0, failed: 0 });
  assert.deepEqual(await sweep(), { created: 0, skipped: 0, failed: 0 });
  assert.equal((await sql("select count(*)::int n from private.workspace_domain_details d join private.workspace_reservations r on r.id::text=d.data->>'reservationId' where d.kind='direct_booking' and r.reference like 'HA:CAP%'"))[0].n, 55);
});

test('a client never reads these follow-ups, and only the backend can run the sweep', async () => {
  const work = (await itemsFor('A1'))[0].id;
  await as(CLIENT);
  const seen = await db.query('select id from public.workspace_work_items where id=$1', [work]);
  assert.equal(seen.rows.length, 0, 'the client does not see staff follow-ups');
  const hidden = await db.query("select count(*)::int n from public.workspace_activity where work_id=$1", [work]);
  assert.equal(hidden.rows[0].n, 0);
  for (const who of [SUPER, STAYS, CLIENT, CLEANER, ACCOUNTS]) {
    await as(who);
    await assert.rejects(db.query('select public.workspace_direct_booking_sweep()'), /permission denied/, 'public wrapper, role ' + roles[who]);
    await assert.rejects(db.query('select private.workspace_direct_booking_sweep(now())'), /permission denied/, 'private function, role ' + roles[who]);
  }
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_direct_booking_sweep()'), /permission denied/);
  await db.exec('reset role');
  const grants = await sql(`select r.rolname from pg_proc p cross join pg_roles r
    where p.oid='public.workspace_direct_booking_sweep()'::regprocedure and has_function_privilege(r.oid,p.oid,'execute') and r.rolname in ('anon','authenticated','service_role')`);
  assert.deepEqual(grants.map(r => r.rolname), ['service_role']);
  const inner = await sql(`select r.rolname from pg_proc p cross join pg_roles r
    where p.oid='private.workspace_direct_booking_sweep(timestamptz)'::regprocedure and has_function_privilege(r.oid,p.oid,'execute') and r.rolname in ('anon','authenticated','service_role')`);
  assert.deepEqual(inner.map(r => r.rolname), ['service_role']);
  await asBackend();
  assert.ok((await rpc('workspace_direct_booking_sweep')).created >= 0);
  await db.exec('reset role');
});

test('the functions are security definer with an empty search path, and the lookup index exists', async () => {
  const defs = await sql(`select proname,prosecdef,proconfig from pg_proc where oid in ('private.workspace_direct_booking_sweep(timestamptz)'::regprocedure,'public.workspace_direct_booking_sweep()'::regprocedure) order by proname`);
  assert.equal(defs.length, 2);
  for (const d of defs) assert.deepEqual(d.proconfig, ['search_path=""']);
  assert.equal(defs.find(d => d.proname === 'workspace_direct_booking_sweep' && d.prosecdef) !== undefined, true);
  const index = await sql("select indexdef from pg_indexes where schemaname='private' and tablename='workspace_domain_details' and indexname='workspace_domain_details_reservation_idx'");
  assert.equal(index.length, 1);
  assert.match(index[0].indexdef, /reservationId/);
});

test('the migration is safe to run twice', async () => {
  const before = (await sql(`select pg_get_functiondef('private.workspace_direct_booking_sweep(timestamptz)'::regprocedure) a,pg_get_functiondef('public.workspace_direct_booking_sweep()'::regprocedure) b`))[0];
  const items = await countAll();
  await db.exec(migrationText);
  await db.exec(migrationText);
  const after = (await sql(`select pg_get_functiondef('private.workspace_direct_booking_sweep(timestamptz)'::regprocedure) a,pg_get_functiondef('public.workspace_direct_booking_sweep()'::regprocedure) b`))[0];
  assert.deepEqual(after, before);
  assert.equal((await sql("select count(*)::int n from pg_indexes where indexname='workspace_domain_details_reservation_idx'"))[0].n, 1);
  assert.deepEqual(await sweep(), { created: 0, skipped: 0, failed: 0 });
  assert.equal(await countAll(), items);
  const grants = await sql(`select r.rolname from pg_proc p cross join pg_roles r
    where p.oid='public.workspace_direct_booking_sweep()'::regprocedure and has_function_privilege(r.oid,p.oid,'execute') and r.rolname in ('anon','authenticated','service_role')`);
  assert.deepEqual(grants.map(r => r.rolname), ['service_role']);
});

test('the Hostaway sync does not mention the sweep: it cannot be broken by it', async () => {
  const def = (await sql("select pg_get_functiondef('private.workspace_hostaway_sync(jsonb)'::regprocedure) d"))[0].d;
  assert.ok(!def.includes('direct_booking'), 'the sync function is untouched by this migration');
  const triggers = await sql("select tgname from pg_trigger where tgrelid='private.workspace_reservations'::regclass and not tgisinternal order by tgname");
  assert.ok(!triggers.some(t => /direct_booking|sweep/.test(t.tgname)), 'no new trigger on reservations: ' + triggers.map(t => t.tgname).join(','));
});
