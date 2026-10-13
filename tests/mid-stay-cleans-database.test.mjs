import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Mid-stay cleans (20261012130000): one clean on check-in plus half the nights for every confirmed stay of more
// than 14 nights still ahead, linked by midStayOf (never reservationId, which the Hostaway sync uses to find the
// checkout clean), safe to run again, cancelled when the stay no longer needs it unless someone has started it,
// and counted on owner statements like any changeover.
const MIGRATION = 'supabase/migrations/20261012130000_mid_stay_cleans_performance.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());
// Mid-stay cleans are switched off by 20261014110000 (client answer 5); these tests cover the run while it is on.
await db.exec(`create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select true $$`);

const roles = ['super_admin', 'admin', 'accounts', 'cleans', 'client'];
const users = roles.map((_, i) => `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, CLEANER, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `midstay${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('e100', 'e200') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
async function asBackend() { await asDb(); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const day = n => sql('select (current_date+$1::int)::text d', [n]).then(r => r[0].d);

// The run as the backend makes it, at a fixed moment: 1 November 2026, midday.
const AT = '2026-11-01T12:00:00Z';
const midStay = async (at = AT) => (await sql('select private.workspace_mid_stay_cleans($1) r', [at]))[0].r;
const cleansFor = stayId => sql(`select w.id,w.status,w.due_on::text due,w.title,w.assignee_id,w.version,w.property_id,d.data from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning' and d.data->>'midStayOf'=$1 order by w.created_at,w.id`, [stayId]);
const allMidStay = async () => Number((await sql("select count(*) n from private.workspace_domain_details where kind='cleaning' and data->>'cleanType'='mid_stay'"))[0].n);
async function stay(prop, reference, checkIn, checkOut, { status = 'confirmed', channel = 'direct', code = null, payout = 50000 } = {}) {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,$5,'manual',$6,$7,$8) returning id`, [prop, reference, checkIn, checkOut, status, channel, code, payout]))[0].id;
}
const setStay = (id, fields) => sql(`update private.workspace_reservations set ${Object.keys(fields).map((k, i) => `${k}=$${i + 2}`).join(',')} where id=$1`, [id, ...Object.values(fields)]);
// A clean's status moves with its workStatus (the schedule's guard refuses one without the other).
async function setClean(id, status, data = {}) {
  await sql('update private.workspace_domain_details set data=data||$2::jsonb where work_id=$1', [id, JSON.stringify({ workStatus: status, ...data })]);
  await sql('update public.workspace_work_items set status=$2,version=version+1 where id=$1', [id, status]);
}

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Long stay flat' }]);
await rpc('workspace_assign_property', [HOME, users[CLEANER], 'cleaner']);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);
// The property's usual cleaner, who gets its cleans the way checkout cleans are assigned.
await sql('insert into private.workspace_default_cleaners(property_id,cleaner_id,updated_by) values($1,$2,$3)', [HOME, users[CLEANER], users[ADMIN]]);

const S14 = await stay(HOME, 'Fourteen nights', '2026-11-02', '2026-11-16', { payout: 70000 });
const S15 = await stay(HOME, 'Fifteen nights', '2026-11-20', '2026-12-05', { payout: 75000 });
const S29 = await stay(HOME, 'Twenty-nine nights', '2026-12-10', '2027-01-08', { channel: 'airbnb', code: 'HMLONG0029', payout: 150000 });
const SCAN = await stay(HOME, 'Cancelled long stay', '2026-11-03', '2026-11-25', { status: 'cancelled' });
const SENQ = await stay(HOME, 'Enquiry long stay', '2026-11-04', '2026-11-26', { status: 'enquiry' });
const SOWN = await stay(HOME, 'Owner long stay', '2027-01-10', '2027-01-26', { channel: 'other', code: 'Owner stay', payout: null });
const SPAST = await stay(HOME, 'Checked out already', '2026-10-01', '2026-10-31');
const SMIDPAST = await stay(HOME, 'Middle day passed', '2026-10-10', '2026-11-10');
const SSHORT = await stay(HOME, 'Shortened later', '2027-02-01', '2027-02-21');
const SDONE = await stay(HOME, 'Clean done, then cancelled', '2027-03-01', '2027-03-21');
const SSTART = await stay(HOME, 'Clean started, then cancelled', '2027-05-01', '2027-05-21');
const SHAND = await stay(HOME, 'Clean cancelled by hand', '2027-06-01', '2027-06-20');
const SMOVE = await stay(HOME, 'Stay that moves', '2027-07-01', '2027-07-17');

test('14 nights gets none; 15 gets one on check-in plus 7; 29 gets a single one on check-in plus 14', async () => {
  const result = await midStay();
  assert.deepEqual(result, { created: 8, cancelled: 0, leftAlone: 0, remaining: 0 });
  assert.deepEqual(await cleansFor(S14), [], 'exactly 14 nights is not longer than 14');
  const [fifteen, ...more] = await cleansFor(S15);
  assert.equal(more.length, 0);
  assert.equal(fifteen.due, '2026-11-27'); assert.equal(fifteen.data.dueOn, '2026-11-27');
  const twentyNine = await cleansFor(S29);
  assert.deepEqual(twentyNine.map(c => c.due), ['2026-12-24'], 'one mid-stay clean, not one a fortnight');
  // An ordinary clean on the schedule, for the usual cleaner, linked to its stay by midStayOf only.
  for (const clean of [fifteen, twentyNine[0]]) {
    assert.equal(clean.title, 'Mid-stay clean'); assert.equal(clean.status, 'waiting'); assert.equal(clean.property_id, HOME);
    assert.equal(clean.assignee_id, users[CLEANER], 'assigned like a checkout clean');
    assert.equal(clean.data.cleanType, 'mid_stay'); assert.equal(clean.data.source, 'mid_stay'); assert.equal(clean.data.phase, 'assigned');
    assert.equal(clean.data.workStatus, 'waiting'); assert.ok(Array.isArray(clean.data.checklist) && clean.data.checklist.length > 0);
    assert.equal(clean.data.reservationId, undefined, 'never linked by reservationId');
  }
  assert.equal(fifteen.data.midStayOf, S15); assert.equal(twentyNine[0].data.midStayOf, S29);
  // The day helper and the constant behind it.
  assert.deepEqual((await sql("select private.workspace_mid_stay_nights() n,private.workspace_mid_stay_day('2026-11-20','2026-12-05')::text d15,private.workspace_mid_stay_day('2026-12-10','2027-01-08')::text d29"))[0],
    { n: 14, d15: '2026-11-27', d29: '2026-12-24' });
});

test('cancelled, enquiry and past stays get none; an owner stay is cleaned like any other', async () => {
  for (const id of [SCAN, SENQ, SPAST, SMIDPAST]) assert.deepEqual(await cleansFor(id), []);
  assert.deepEqual((await cleansFor(SOWN)).map(c => c.due), ['2027-01-18']);
  // Later runs below use today's real date; these two go far into the past so they can never qualify.
  await setStay(SPAST, { check_in: '2020-10-01', check_out: '2020-10-31' });
  await setStay(SMIDPAST, { check_in: '2020-10-10', check_out: '2020-11-10' });
});

test('a second run creates nothing and moves nothing', async () => {
  const before = await sql("select w.id,w.due_on::text,w.version from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.data->>'cleanType'='mid_stay' order by w.id");
  assert.deepEqual(await midStay(), { created: 0, cancelled: 0, leftAlone: 0, remaining: 0 });
  assert.deepEqual(await midStay('2026-11-02T08:00:00Z'), { created: 0, cancelled: 0, leftAlone: 0, remaining: 0 });
  assert.deepEqual(await sql("select w.id,w.due_on::text,w.version from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.data->>'cleanType'='mid_stay' order by w.id"), before);
});

test('a stay shortened to 14 nights loses its open clean, and gets a new one when lengthened again', async () => {
  await setStay(SSHORT, { check_out: '2027-02-15' });
  assert.deepEqual(await midStay(), { created: 0, cancelled: 1, leftAlone: 0, remaining: 0 });
  let cleans = await cleansFor(SSHORT);
  assert.deepEqual(cleans.map(c => [c.status, c.due, c.data.workStatus, c.data.cancelledBecause]), [['cancelled', '2027-02-11', 'cancelled', 'The stay is now 14 nights or fewer']]);
  await setStay(SSHORT, { check_out: '2027-02-23' });
  assert.equal((await midStay()).created, 1);
  cleans = await cleansFor(SSHORT);
  assert.deepEqual(cleans.map(c => [c.status, c.due]), [['cancelled', '2027-02-11'], ['waiting', '2027-02-12']]);
});

test('a cancelled stay cancels a clean nobody started; a completed or started one is left alone', async () => {
  const [done] = await cleansFor(SDONE);
  await setClean(done.id, 'completed', { phase: 'accepted' });
  const [started] = await cleansFor(SSTART);
  await setClean(started.id, 'in_progress', { submittedBy: users[CLEANER] });
  const [open] = await cleansFor(S29);
  for (const id of [SDONE, SSTART, S29]) await setStay(id, { status: 'cancelled' });
  assert.deepEqual(await midStay(), { created: 0, cancelled: 1, leftAlone: 1, remaining: 0 });
  assert.deepEqual((await cleansFor(SDONE)).map(c => [c.id, c.status, c.version]), [[done.id, 'completed', done.version + 1]], 'a completed clean is untouched');
  assert.deepEqual((await cleansFor(SSTART)).map(c => [c.id, c.status]), [[started.id, 'in_progress']], 'a started clean is left for staff');
  assert.deepEqual((await cleansFor(S29)).map(c => [c.id, c.status, c.data.cancelledBecause]), [[open.id, 'cancelled', 'The stay was cancelled']]);
  // Confirmed again: the stay gets its clean back, on the same day.
  await setStay(S29, { status: 'confirmed' });
  assert.equal((await midStay()).created, 1);
  assert.deepEqual((await cleansFor(S29)).map(c => [c.status, c.due]), [['cancelled', '2026-12-24'], ['waiting', '2026-12-24']]);
  // Nothing changes on the next run (the started clean is reported again, never touched).
  assert.deepEqual(await midStay(), { created: 0, cancelled: 0, leftAlone: 1, remaining: 0 });
});

test('a clean cancelled by hand is never brought back', async () => {
  const [clean] = await cleansFor(SHAND);
  await setClean(clean.id, 'cancelled');
  assert.equal((await midStay()).created, 0);
  assert.deepEqual((await cleansFor(SHAND)).map(c => c.status), ['cancelled']);
});

test('a moved stay: a clean still inside it is never re-dated; one left outside it is replaced on the new middle day', async () => {
  const [first] = await cleansFor(SMOVE);
  assert.equal(first.due, '2027-07-09');
  await setStay(SMOVE, { check_in: '2027-07-02', check_out: '2027-07-18' });
  assert.deepEqual(await midStay(), { created: 0, cancelled: 0, leftAlone: 1, remaining: 0 });
  assert.deepEqual((await cleansFor(SMOVE)).map(c => [c.id, c.status, c.due, c.version]), [[first.id, 'waiting', '2027-07-09', first.version]]);
  await setStay(SMOVE, { check_in: '2027-08-01', check_out: '2027-08-17' });
  assert.deepEqual(await midStay(), { created: 1, cancelled: 1, leftAlone: 1, remaining: 0 });
  assert.deepEqual((await cleansFor(SMOVE)).map(c => [c.status, c.due]), [['cancelled', '2027-07-09'], ['waiting', '2027-08-09']]);
});

test('owner statements count a completed mid-stay clean once, as a changeover on its day', async () => {
  await as(ADMIN);
  await rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000 }]);
  const [mid] = await cleansFor(S15);
  await setClean(mid.id, 'completed', { phase: 'accepted' });
  await as(ACCOUNTS);
  const preview = await rpc('workspace_finance_report', ['statementPreview', HOME, null, '2026-11-01', '2026-12-01', null]);
  const changeovers = preview.lines.filter(l => l.kind === 'changeover');
  assert.deepEqual(changeovers.map(l => [l.refId, l.date, l.amountMinor]), [[mid.id, '2026-11-27', 6000]], 'charged at the agreed cleaning value, exactly once');
  assert.equal(preview.changeoversMinor, 6000); assert.equal(preview.cleaningCount, 1);
  // The clean is not tied to the stay's money: the stay is counted once, for its nights in November.
  assert.deepEqual(preview.stays.filter(s => s.reservationId === S15).map(s => s.nightsInPeriod), [11]);
});

test('only the backend runs it; the stays team, owners and cleaners cannot', async () => {
  for (const who of [SUPER, OWNER, CLEANER]) {
    await as(who);
    await assert.rejects(rpc('workspace_mid_stay_cleans'), /permission denied/);
    await assert.rejects(db.query('select private.workspace_mid_stay_cleans(now())'), /permission denied/);
  }
  await asBackend();
  const result = await rpc('workspace_mid_stay_cleans');
  assert.deepEqual(Object.keys(result).sort(), ['cancelled', 'created', 'leftAlone', 'remaining']);
  await asDb();
  assert.equal((await db.query("select has_function_privilege('anon','public.workspace_mid_stay_cleans()','execute') ok")).rows[0].ok, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','private.workspace_mid_stay_cleans(timestamptz)','execute') ok")).rows[0].ok, false);
});

test('the Hostaway sync makes the mid-stay clean in the same run and never mistakes it for the checkout clean', async () => {
  await sql('update private.workspace_hostaway_sync_state set paused=false where singleton');
  try {
    await sql("update public.workspace_properties set hostaway_listing_id='LONG-1' where id=$1", [HOME]);
    const [checkIn, checkOut, later] = await Promise.all([day(200), day(220), day(221)]);
    const longStay = (out, status = 'confirmed') => ({ id: '88001', listingId: 'LONG-1', checkIn, checkOut: out, status, channel: 'airbnb', channelReference: 'HMSYNC0001', guests: 2, payoutMinor: 90000 });
    const sync = async reservations => { await asBackend(); return rpc('workspace_hostaway_sync', [{ trigger: 'schedule', reservations }]); };
    const checkoutFor = async () => sql(`select w.id,w.status,w.due_on::text due from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
      join private.workspace_reservations r on d.data->>'reservationId'=r.id::text where d.kind='cleaning' and r.reference='HA:88001' order by w.created_at`);
    let result = await sync([longStay(checkOut)]);
    assert.equal(result.newCleans, 1); assert.equal(result.newMidStayCleans, 1);
    const [res] = await sql("select id from private.workspace_reservations where reference='HA:88001'");
    let mid = await cleansFor(res.id);
    assert.deepEqual(mid.map(c => [c.status, c.due, c.data.reservationId]), [['waiting', await day(210), undefined]]);
    assert.deepEqual((await checkoutFor()).map(c => [c.status, c.due]), [['waiting', checkOut]], 'the checkout clean is the only one carrying reservationId');

    // Extended by a night: the checkout clean moves, the mid-stay clean stays on its day.
    result = await sync([longStay(later)]);
    assert.equal(result.movedCleans, 1); assert.equal(result.newMidStayCleans, 0);
    assert.deepEqual((await checkoutFor()).map(c => [c.status, c.due]), [['waiting', later]]);
    assert.deepEqual((await cleansFor(res.id)).map(c => [c.id, c.status, c.due]), mid.map(c => [c.id, 'waiting', c.due]));

    // Cancelled in Hostaway: both go in the same run.
    result = await sync([longStay(later, 'cancelled')]);
    assert.equal(result.cancelledCleans, 1); assert.equal(result.cancelledMidStayCleans, 1);
    mid = await cleansFor(res.id);
    assert.deepEqual(mid.map(c => c.status), ['cancelled']);
    assert.deepEqual((await checkoutFor()).map(c => c.status), ['cancelled']);
  } finally {
    await sql('update private.workspace_hostaway_sync_state set paused=true where singleton');
  }
});

test('the migration runs twice', async () => {
  const before = await allMidStay();
  await asDb();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  const definition = (await sql("select pg_get_functiondef('private.workspace_hostaway_sync(jsonb)'::regprocedure) d"))[0].d;
  assert.equal(definition.split('private.workspace_mid_stay_cleans(now())').length - 1, 1, 'the sync calls it once');
  assert.equal((await midStay()).created, 0);
  assert.equal(await allMidStay(), before);
});
