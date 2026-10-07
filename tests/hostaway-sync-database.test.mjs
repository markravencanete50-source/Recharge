import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The Hostaway sync as the backend runs it (service role), and what the live screens then read.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { scheduleSchema } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { hostawayStatusSchema } = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'cleaning_manager', 'cleans', 'stays'];
const users = roles.map((_, i) => `93000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, MANAGER, CLEANER, STAYS] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `sync${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('9300', '9400'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('9300', '9400'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Sync ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('9300', '9400') })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sync = async input => { await asBackend(); return rpc('workspace_hostaway_sync', [{ trigger: 'schedule', ...input }]); };
const day = n => db.query('select (current_date+$1::int)::text d', [n]).then(r => r.rows[0].d);
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const cleanFor = async ref => (await sql(`select w.status,w.due_on::text due,w.priority,w.assignee_id,w.version,w.id,d.data from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id join private.workspace_reservations r on d.data->>'reservationId'=r.id::text
  where d.kind='cleaning' and r.reference=$1 order by w.created_at desc`, ['HA:' + ref]));
const stay = (id, checkIn, checkOut, extra = {}) => ({ id, listingId: '501', checkIn, checkOut, status: 'confirmed', channel: 'airbnb', channelReference: 'HM' + id, guests: 2, payoutMinor: 41250, ...extra });

const listings = [
  { id: '501', name: 'Harbour View Flat', address: '1 Quay Street, Bristol', bedrooms: 2, accessInfo: 'Key safe by the door' },
  { id: '502', name: 'Old Mill Cottage', address: '', bedrooms: 3 },
];

test('only the backend can run the sync', async () => {
  await as(SUPER);
  await assert.rejects(rpc('workspace_hostaway_sync', [{ trigger: 'manual', listings }]), /permission denied/);
  await asBackend();
  await assert.rejects(rpc('workspace_hostaway_sync', [{ trigger: 'manual', surprise: true }]), /Invalid sync input/);
  await assert.rejects(rpc('workspace_hostaway_sync', [{ trigger: 'nightly' }]), /Invalid sync trigger/);
});

test('listings become properties; a same-name property is linked instead of duplicated', async () => {
  await as(SUPER);
  const existing = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Old Mill Cottage', address: 'Mill Lane' }]);
  const result = await sync({ listings });
  assert.equal(result.createdProperties, 1);
  assert.equal(result.linkedProperties, 1);
  const rows = await sql("select id,name,address,bedrooms,status,hostaway_listing_id,created_by from public.workspace_properties where hostaway_listing_id in ('501','502') order by hostaway_listing_id");
  assert.equal(rows[0].name, 'Harbour View Flat'); assert.equal(rows[0].status, 'active'); assert.equal(rows[0].bedrooms, 2); assert.equal(rows[0].created_by, null);
  assert.equal(rows[1].id, existing, 'linked to the property staff already made');
  assert.equal(rows[1].address, 'Mill Lane', 'staff details are kept');
  assert.equal((await sql('select access_instructions a from private.workspace_property_secrets where property_id=$1', [rows[0].id]))[0].a, 'Key safe by the door');
  // Running it again changes nothing.
  const again = await sync({ listings });
  assert.equal(again.createdProperties + again.linkedProperties, 0);
});

test('reservations arrive with platform details and a checkout clean, idempotently', async () => {
  const [inA, outA, past0, past1] = await Promise.all([day(3), day(6), day(-10), day(-7)]);
  const input = { listings, reservations: [
    stay('9001', inA, outA),
    stay('9002', past0, past1, { channel: 'booking_com', channelReference: '4455667788', payoutMinor: 30000 }),
    stay('9003', inA, outA, { status: 'cancelled' }), // cancelled before we ever saw it: nothing recorded
    stay('9004', inA, outA, { listingId: '999' }), // listing not in Recharge
  ] };
  const result = await sync(input);
  assert.equal(result.newReservations, 2);
  assert.equal(result.newCleans, 1, 'past checkouts get no clean');
  assert.match(JSON.stringify(result.problems), /Listing 999 is not in Recharge yet/);

  const [r] = await sql("select status,channel,channel_reference,guests,payout_minor,source,created_by,synced_at from private.workspace_reservations where reference='HA:9001'");
  assert.deepEqual({ ...r, synced_at: undefined }, { status: 'confirmed', channel: 'airbnb', channel_reference: 'HM9001', guests: 2, payout_minor: 41250, source: 'hostaway', created_by: null, synced_at: undefined });
  assert.ok(r.synced_at);
  assert.equal((await sql("select count(*)::int n from private.workspace_reservations where reference='HA:9003'"))[0].n, 0);

  const [clean] = await cleanFor('9001');
  assert.equal(clean.status, 'waiting'); assert.equal(clean.due, outA); assert.equal(clean.assignee_id, null); assert.equal(clean.priority, 'normal');
  assert.equal(clean.data.source, 'hostaway'); assert.equal(clean.data.phase, 'assigned'); assert.equal(clean.data.checklist.length, 7);

  const again = await sync(input);
  assert.deepEqual([again.newReservations, again.changedReservations, again.newCleans, again.movedCleans], [0, 0, 0, 0]);
  assert.equal((await cleanFor('9001')).length, 1);
});

test('date changes move the clean, a same-day arrival makes it urgent, cancelling cancels it', async () => {
  const [inA, outA, outB, outC] = await Promise.all([day(3), day(6), day(7), day(10)]);
  // Extended by a night: the clean moves with the checkout.
  let result = await sync({ reservations: [stay('9001', inA, outB)] });
  assert.equal(result.changedReservations, 1); assert.equal(result.movedCleans, 1);
  let [clean] = await cleanFor('9001');
  assert.equal(clean.due, outB); assert.equal(clean.data.dueOn, outB);

  // The next guest arrives on that checkout day.
  result = await sync({ reservations: [stay('9005', outB, outC)] });
  [clean] = await cleanFor('9001');
  assert.equal(clean.priority, 'high'); assert.equal(clean.data.sameDayTurnover, true);
  const [next] = await cleanFor('9005');
  assert.equal(next.priority, 'normal');

  // That arrival is cancelled: the turnover is no longer same-day, and its own clean goes.
  result = await sync({ reservations: [stay('9005', outB, outC, { status: 'cancelled' })] });
  assert.equal(result.cancelledCleans, 1);
  assert.equal((await cleanFor('9005'))[0].status, 'cancelled');
  [clean] = await cleanFor('9001');
  assert.equal(clean.priority, 'normal'); assert.equal(clean.data.sameDayTurnover, false);
  assert.equal((await sql("select status from private.workspace_reservations where reference='HA:9005'"))[0].status, 'cancelled');
  void outA;
});

test('a blank in Hostaway never wipes what Accounts filled in; overlaps are reported', async () => {
  const [inA, outB] = await Promise.all([day(3), day(7)]);
  await sync({ reservations: [stay('9001', inA, outB, { payoutMinor: null, channelReference: '', guests: null })] });
  const [r] = await sql("select channel_reference,guests,payout_minor from private.workspace_reservations where reference='HA:9001'");
  assert.deepEqual(r, { channel_reference: 'HM9001', guests: 2, payout_minor: 41250 });

  const result = await sync({ reservations: [stay('9006', await day(4), await day(5), { channel: 'direct', payoutMinor: 15000 })] });
  assert.match(JSON.stringify(result.problems), /Overlaps another stay/);
});

test('the cleaning manager assigns a synced clean, and a started clean is never moved or cancelled', async () => {
  const [property] = await sql("select id from public.workspace_properties where hostaway_listing_id='501'");
  await as(SUPER);
  for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [CLEANER, 'cleaner'], [STAYS, 'staff']]) await rpc('workspace_assign_property', [property.id, users[user], kind]);
  let [clean] = await cleanFor('9001');
  await as(MANAGER);
  await rpc('workspace_assign_work', [clean.id, clean.version, users[CLEANER]]);
  [clean] = await cleanFor('9001');
  assert.equal(clean.assignee_id, users[CLEANER]);

  // The live schedule screen reads the synced stay and clean.
  const from = await day(0), to = await day(20);
  const schedule = scheduleSchema.parse(await rpc('workspace_teams_read', ['schedule', from, to, property.id, null]));
  assert.ok(schedule.work.some(w => w.workId === clean.id && w.assigneeId === users[CLEANER]));
  assert.ok(schedule.stays.some(s => s.propertyId === property.id && s.guests === 2));

  // The cleaner submits; then the stay is cancelled. The clean is left alone and flagged.
  await sql("update private.workspace_domain_details set data=data||'{\"submittedBy\":\"x\"}' where work_id=$1", [clean.id]);
  const result = await sync({ reservations: [stay('9001', await day(3), await day(7), { status: 'cancelled' })] });
  assert.equal(result.cancelledCleans, 0);
  assert.match(JSON.stringify(result.problems), /cancelled after its clean started/);
  assert.equal((await cleanFor('9001'))[0].status, 'waiting');
});

test('admins and Stays see the sync status; failures are recorded without changing data', async () => {
  await asBackend();
  await rpc('workspace_hostaway_sync_failed', [{ trigger: 'webhook', error: 'Hostaway rejected the saved credentials' }]);
  await as(STAYS);
  let status = hostawayStatusSchema.parse(await rpc('workspace_hostaway_status'));
  assert.equal(status.lastError, 'Hostaway rejected the saved credentials');
  assert.equal(status.lastTrigger, 'webhook');
  assert.equal(status.canSync, false);
  assert.ok(status.linkedProperties >= 2);
  await sync({ trigger: 'manual', reservations: [] });
  await as(SUPER);
  status = hostawayStatusSchema.parse(await rpc('workspace_hostaway_status'));
  assert.equal(status.lastError, null); assert.equal(status.canSync, true); assert.equal(status.lastTrigger, 'manual');
  await as(CLEANER);
  await assert.rejects(rpc('workspace_hostaway_status'), /Admin access required/);
  await asBackend();
  await assert.rejects(rpc('workspace_hostaway_status'), /permission denied/);
});
