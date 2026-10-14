import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Two figures for management's Home (20261020910000):
// 1. Guest replies on time: workspace_guest_reply_glance, admins and super admins only, built on
//    private.workspace_response_rows so it agrees with the Messages report.
// 2. Bookings value as booked: the Performance report's bookedValueMinor, every stay with nights in the dates, settled
//    or not, shared by nights like grossRevenueMinor. Every figure below was worked out by hand.
const MIGRATION = 'supabase/migrations/20261020910000_home_figures.sql';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false } });
const { performanceReportSchema } = await vite.ssrLoadModule('/lib/performance.ts');
const { guestReplyGlanceSchema } = await vite.ssrLoadModule('/lib/home-overview.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { messagesReportSchema } = await vite.ssrLoadModule('/lib/business-reports-view.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'stays', 'client'];
const users = roles.map((_, i) => `f3100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('f310', 'f320');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `figures${i}@example.com`]);
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
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const glance = async onDay => (await db.query('select public.workspace_guest_reply_glance($1) r', [onDay])).rows[0].r;

// ---------- guest replies: green within 15 minutes, amber within 60 ----------
await sql('update private.workspace_performance_targets set green_minutes=15,amber_minutes=60 where singleton');
let ref = 0;
// A guest message and, after `minutes`, the team's reply (none: still waiting).
async function asked(channel, at, minutes) {
  const thread = 't' + ++ref;
  await sql(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,body) values('test',gen_random_uuid()::text,$1,$2,'guest',$3,'Hi')`, [thread, channel, at]);
  if (minutes !== null) await sql(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,author_user_id,delivery,body)
    values('test',gen_random_uuid()::text,$1,$2,'team',$3::timestamptz+make_interval(mins=>$4),$5,'sent','Hello')`, [thread, channel, at, minutes, users[ADMIN]]);
}
// October so far (to the 14th): 5, 10 and 14 minutes are on time, 30 is not, and one still waiting is late.
await asked('airbnb', '2026-10-03 10:00+01', 10);
await asked('airbnb', '2026-10-05 11:00+01', 30);
await asked('booking_com', '2026-10-07 12:00+01', 5);
await asked('vrbo', '2026-10-10 13:00+01', 14);
await asked('airbnb', '2026-10-02 10:00+01', null);
await asked('airbnb', '2026-10-15 10:00+01', 3); // after the 14th: not this month so far
// The same days of September (1st to 14th): 20 minutes (late) and 10 (on time). The 20th is outside them.
await asked('airbnb', '2026-09-03 10:00+01', 20);
await asked('booking_com', '2026-09-05 09:00+01', 10);
await asked('airbnb', '2026-09-20 09:00+01', 5);

// ---------- bookings value as booked ----------
async function property(name) {
  return (await sql("insert into public.workspace_properties(name,region,status,created_by,request_id) values($1,'Fife','active',$2,gen_random_uuid()) returning id", [name, users[ADMIN]]))[0].id;
}
async function stay(prop, reference, channel, code, checkIn, checkOut, payout, status = 'confirmed') {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,$5,'manual',$6,$7,$8) returning id`, [prop, reference, checkIn, checkOut, status, channel, code, payout]))[0].id;
}
const line = (channel, reference, amountMinor, { gross = null, hostFee = null } = {}) => ({
  reference, amountMinor, grossMinor: gross, commissionMinor: null, hostFeeMinor: hostFee, paymentFeeMinor: null, cleaningFeeMinor: null,
  paidOn: '2026-10-31', lineType: 'Reservation', key: [channel, reference.toUpperCase(), '2026-10-31', 'Reservation', amountMinor, 'PO-7', 1].join('|'),
});
const finance = input => db.query('select public.workspace_finance_action($1) r', [{ requestId: crypto.randomUUID(), ...input }]);
const perf = async (from, to, filters = null) => {
  await as(ACCOUNTS);
  return performanceReportSchema.parse((await db.query("select public.workspace_finance_report('performance',null,null,$1,$2,$3) r", [from, to, filters])).rows[0].r);
};

const BRAE = await property('Brae House');
// August: one Airbnb stay, settled (20000 + Airbnb's 600 fee = 20600): a closed, fully settled month.
await stay(BRAE, 'B0', 'airbnb', 'HMBOOK0000', '2026-08-10', '2026-08-12', 20000);
// September.
await stay(BRAE, 'B1', 'airbnb', 'HMBOOK0001', '2026-09-05', '2026-09-10', 50000); // settled: gross 51546
const B2 = await stay(BRAE, 'B2', 'booking_com', '5550000201', '2026-09-12', '2026-09-15', 30000); // not settled: 30000 + fees 6600 = 36600
await stay(BRAE, 'B3', 'vrbo', 'HA-BOOK0001', '2026-09-28', '2026-10-02', 40000); // not settled, no breakdown: 3 of 4 nights in Sept, 30000
await stay(BRAE, 'B4', 'direct', null, '2026-09-20', '2026-09-22', 20000); // direct: 20000 either way
await stay(BRAE, 'B5', 'other', 'Owner stay', '2026-09-23', '2026-09-25', null); // owner stay: nothing
await stay(BRAE, 'B6', 'direct', null, '2026-09-16', '2026-09-18', 99999, 'cancelled');
// The fees the sync recorded for B2 (the guest fee Booking.com keeps is not the host's money, so it is left out).
await sql(`update private.workspace_reservations set payout_breakdown='{"source":"itemised","grossMinor":36900,"commissionMinor":5000,"guestFeeMinor":300,"paymentChargeMinor":600,"commissionVatMinor":1000}'::jsonb where id=$1`, [B2]);
// B0's expected fees say 700, but its payout has settled: the settled gross (20600) counts, as on the Performance page.
await sql(`update private.workspace_reservations set payout_breakdown='{"source":"airbnb","commissionMinor":700}'::jsonb where reference='B0'`);
await as(ACCOUNTS);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-booked.csv', lines: [line('airbnb', 'HMBOOK0001', 50000, { hostFee: 1546 }), line('airbnb', 'HMBOOK0000', 20000, { hostFee: 600 })] });

test('guest replies on time: this month so far against the same days of last month', async () => {
  await as(ADMIN);
  const r = guestReplyGlanceSchema.parse(await glance('2026-10-14'));
  assert.deepEqual([r.greenMinutes, r.amberMinutes], [15, 60]);
  // [5, 10, 14, 30, waiting]: 3 of 5 on time; the median is the middle one, 14.
  assert.deepEqual(r.thisMonth, { from: '2026-10-01', to: '2026-10-14', replies: 5, onTime: 3, onTimeBps: 6000, medianMinutes: 14 });
  // [10, 20]: 1 of 2; the median is halfway, 15.
  assert.deepEqual(r.lastMonth, { from: '2026-09-01', to: '2026-09-14', replies: 2, onTime: 1, onTimeBps: 5000, medianMinutes: 15 });
  // The super admin reads the same; the app's read section is accepted.
  await as(SUPER);
  assert.deepEqual(guestReplyGlanceSchema.parse(await glance('2026-10-14')), r);
  assert.deepEqual(teamsReadSchema.parse({ section: 'guestReplies' }), { section: 'guestReplies' });
});

test('it agrees with the Messages report for the same dates', async () => {
  await as(ADMIN);
  const r = guestReplyGlanceSchema.parse(await glance('2026-10-14'));
  const m = messagesReportSchema.parse((await db.query("select public.workspace_business_report('messages','2026-10-01','2026-10-14') r")).rows[0].r);
  const guestTimes = m.replyTimes.filter(x => ['airbnb', 'booking_com', 'vrbo'].includes(x.channel));
  assert.equal(guestTimes.reduce((n, x) => n + x.count, 0), r.thisMonth.replies, 'the same replies counted, the waiting one included');
});

test('the same days stop at the end of a short month, and the 1st compares with the 1st', async () => {
  await as(ADMIN);
  const march = await glance('2026-03-31');
  assert.deepEqual([march.thisMonth.from, march.thisMonth.to, march.lastMonth.from, march.lastMonth.to], ['2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28']);
  const first = await glance('2026-10-01');
  assert.deepEqual([first.thisMonth.to, first.lastMonth.to], ['2026-10-01', '2026-09-01']);
  // Nothing in the dates: no share and no median, never a division by zero.
  const quiet = guestReplyGlanceSchema.parse(await glance('2027-02-10'));
  assert.deepEqual(quiet.thisMonth, { from: '2027-02-01', to: '2027-02-10', replies: 0, onTime: 0, onTimeBps: null, medianMinutes: null });
  // Today in London when no day is given.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  assert.equal((await db.query('select public.workspace_guest_reply_glance() r')).rows[0].r.thisMonth.to, today);
});

test('only admins and super admins; anon cannot call it at all', async () => {
  for (const who of [ACCOUNTS, STAYS, OWNER]) {
    await as(who);
    await assert.rejects(glance('2026-10-14'), /Management access required/, roles[who]);
  }
  // Signed in but the helpers stay private.
  await as(ADMIN);
  await assert.rejects(db.query("select private.workspace_guest_reply_window('2026-10-01','2026-10-15')"), /permission denied/);
  await asDb(); await db.exec('set role anon');
  await assert.rejects(glance('2026-10-14'), /permission denied/);
  await assert.rejects(db.query("select private.workspace_guest_reply_glance('2026-10-14')"), /permission denied/);
  await db.exec('reset role');
});

test('bookings value as booked counts every stay with nights in the dates, settled or not', async () => {
  const sept = await perf('2026-09-01', '2026-10-01');
  assert.equal(sept.totals.grossRevenueMinor, 51546 + 20000, 'settled: B1 and the direct stay');
  assert.equal(sept.bookedValueMinor, 51546 + 36600 + 30000 + 20000, 'as booked: B2 and three nights of B3 too');
  // October holds B3's last night: floor(40000*4/4) - floor(40000*3/4) = 10000.
  assert.equal((await perf('2026-10-01', '2026-11-01')).bookedValueMinor, 10000);
  // The filters apply as they do to the rest of the report.
  const booking = await perf('2026-09-01', '2026-10-01', { channel: 'booking_com' });
  assert.deepEqual([booking.totals.grossRevenueMinor, booking.bookedValueMinor], [0, 36600]);
  assert.equal((await perf('2026-09-01', '2026-10-01', { channel: 'other' })).bookedValueMinor, 0, 'owner stays count nothing');
});

test('a closed, fully settled month: booked and settled are the same', async () => {
  const aug = await perf('2026-08-01', '2026-09-01');
  assert.deepEqual([aug.totals.grossRevenueMinor, aug.bookedValueMinor], [20600, 20600]);
  // Across both months the parts add up.
  const both = await perf('2026-08-01', '2026-10-01');
  assert.equal(both.bookedValueMinor, 20600 + 138146);
});

test('admins read it with the report; the Stays team and owners do not', async () => {
  await as(ADMIN);
  assert.equal(performanceReportSchema.parse((await db.query("select public.workspace_finance_report('performance',null,null,'2026-09-01','2026-10-01',null) r")).rows[0].r).bookedValueMinor, 138146);
  for (const who of [STAYS, OWNER]) {
    await as(who);
    await assert.rejects(db.query("select public.workspace_finance_report('performance',null,null,'2026-09-01','2026-10-01',null) r"), /Accounts access required/);
  }
});

test('the migration is safe to run twice, patches once, and deletes or drops nothing', async () => {
  await asDb();
  const text = await fs.readFile(MIGRATION, 'utf8');
  assert.doesNotMatch(text, /\b(drop|delete|truncate)\b/i);
  const def = async () => (await db.query("select pg_get_functiondef('private.workspace_report_performance(uuid,uuid,date,date,jsonb)'::regprocedure) d")).rows[0].d;
  const before = await def();
  await db.exec(text);
  assert.equal(await def(), before);
  for (const sentinel of ['private.workspace_performance_expected_gross(r) expected', 'end booked_share', "'bookedValueMinor',"]) assert.equal(before.split(sentinel).length - 1, 1, sentinel);
  assert.equal((await perf('2026-09-01', '2026-10-01')).bookedValueMinor, 138146);
});
