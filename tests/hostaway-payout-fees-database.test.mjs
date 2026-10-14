import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// 20261020820000: the sync keeps what the expected payout was worked out from (payout_breakdown), the payout row shows it,
// and management's Home counts only payouts that are overdue and still missing or different.
const MIGRATION = 'supabase/migrations/20261020820000_hostaway_payout_fees.sql';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { overviewSchema } = await vite.ssrLoadModule('/lib/oversight-policy.ts');
const { payoutRowSchema } = await vite.ssrLoadModule('/lib/accounts-live.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'accounts'];
const users = roles.map((_, i) => `95000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ACCOUNTS] = [0, 1];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `fees${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('9500', '9600'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('9500', '9600'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Fees ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('9500', '9600') })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const sync = async input => { await asBackend(); return rpc('workspace_hostaway_sync', [{ trigger: 'schedule', ...input }]); };
const day = n => db.query('select (current_date+$1::int)::text d', [n]).then(r => r.rows[0].d);
const listings = [{ id: '601', name: 'Payout Fees Flat', address: '2 Quay Street, Bristol', bedrooms: 1, accessInfo: '' }];
const stay = (id, checkIn, checkOut, extra = {}) => ({ id, listingId: '601', checkIn, checkOut, status: 'confirmed', channel: 'booking_com', channelReference: 'BK' + id, guests: 2, payoutMinor: 48360, ...extra });
const stored = async id => (await sql('select payout_breakdown b,payout_minor p,version v from private.workspace_reservations where reference=$1', ['HA:' + id]))[0];

test('the sync keeps the breakdown it was sent, only what is known, without changing the stay’s version', async () => {
  const [checkIn, checkOut] = await Promise.all([day(30), day(33)]);
  const breakdown = { source: 'itemised', grossMinor: 60000, commissionMinor: 9000, guestFeeMinor: null, paymentChargeMinor: 840.5, commissionVatMinor: -1, cleaningFeeMinor: 6000, cityTaxMinor: '4000', surprise: 'x' };
  await sync({ listings, reservations: [stay('7101', checkIn, checkOut, { payoutBreakdown: breakdown })] });
  const first = await stored('7101');
  assert.deepEqual(first.b, { source: 'itemised', grossMinor: 60000, commissionMinor: 9000, cleaningFeeMinor: 6000 }, 'fractions, negatives, text and unknown keys are dropped');
  assert.equal(first.p, 48360);

  await sync({ listings, reservations: [stay('7101', checkIn, checkOut, { payoutBreakdown: { ...breakdown, paymentChargeMinor: 840, commissionVatMinor: 1800 } })] });
  const second = await stored('7101');
  assert.equal(second.b.paymentChargeMinor, 840); assert.equal(second.b.commissionVatMinor, 1800);
  assert.equal(second.v, first.v, 'a breakdown alone is not a change to the stay');

  await sync({ listings, reservations: [stay('7101', checkIn, checkOut)] });
  assert.deepEqual((await stored('7101')).b, second.b, 'an older sync that sends no breakdown leaves it alone');
  await sync({ listings, reservations: [stay('7101', checkIn, checkOut, { payoutBreakdown: { source: 'guess', commissionMinor: 9000 } })] });
  assert.equal((await stored('7101')).b, null, 'an unknown source is not kept');
  await sync({ listings, reservations: [stay('7101', checkIn, checkOut, { payoutBreakdown: { ...breakdown, paymentChargeMinor: 840 } })] });
  await sync({ listings, reservations: [stay('7101', checkIn, checkOut, { payoutMinor: null, payoutBreakdown: null })] });
  assert.equal((await stored('7101')).b, null, 'not in pounds any more: the breakdown goes too');
  await assert.rejects(sql("update private.workspace_reservations set payout_breakdown='[1]' where reference='HA:7101'"), /payout_breakdown_object/);
});

test('the payout row shows the breakdown to Accounts', async () => {
  const [checkIn, checkOut] = await Promise.all([day(40), day(42)]);
  await sync({ listings, reservations: [stay('7102', checkIn, checkOut, { payoutBreakdown: { source: 'totals', grossMinor: 30000, commissionMinor: 4500 } })] });
  const [{ row }] = await sql("select private.workspace_payout_row(r) row from private.workspace_reservations r where reference='HA:7102'");
  assert.deepEqual(row.expectedBreakdown, { source: 'totals', grossMinor: 30000, commissionMinor: 4500 });
  await as(ACCOUNTS);
  const rec = await rpc('workspace_finance_read', ['reconciliation', null, checkIn.slice(0, 7), null, null]);
  const mine = rec.rows.find(r => r.reservationId === row.reservationId);
  assert.deepEqual(payoutRowSchema.parse(mine).expectedBreakdown, { source: 'totals', grossMinor: 30000, commissionMinor: 4500 });
  const [{ none }] = await sql("select private.workspace_payout_row(r)->'expectedBreakdown' none from private.workspace_reservations r where reference='HA:7101'");
  assert.equal(none, null);
});

test('Home counts payouts overdue and still missing or different, for Airbnb, Booking.com and Vrbo', async () => {
  await as(SUPER);
  const home = async () => { await as(SUPER); return overviewSchema.parse(await rpc('workspace_oversight_read', ['overview', null])).accounts.payoutsToReconcile; };
  const before = await home();
  const [{ id: property }] = await sql("select id from public.workspace_properties where hostaway_listing_id='601'");
  const [{ last }] = await sql("select (date_trunc('month',current_date)-interval '1 month')::date::text last");
  const at = async (base, n) => (await sql('select ($1::date+$2::int)::text d', [base, n]))[0].d;
  const today = await day(0);
  let n = 0;
  async function add(channel, checkIn, checkOut, { payout = 30000, received = null, reference = `R${++n}`, status = 'confirmed', agreed = null } = {}) {
    const [{ id }] = await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
      values($1,$2,$3,$4,$5,'hostaway',$6,$7,$8) returning id`, [property, 'Fees ' + reference, checkIn, checkOut, status, channel, channel === 'direct' ? null : reference, payout]);
    if (received !== null) {
      const [rep] = await sql(`insert into private.workspace_payout_reports(channel,file_name,content_hash,line_count,total_minor,new_line_count,new_minor,uploaded_by,request_id)
        values($1,'fees.csv',md5(random()::text),1,$2,1,$2,$3,gen_random_uuid()) returning id`, [channel, received, users[ACCOUNTS]]);
      await sql('insert into private.workspace_payout_lines(report_id,channel,reference,amount_minor) values($1,$2,$3,$4)', [rep.id, channel, reference, received]);
    }
    if (agreed !== null) await sql('insert into private.workspace_payout_agreements(reservation_id,received_snapshot_minor,agreed_minor,note,agreed_by) values($1,$2,$3,$4,$5)', [id, received, agreed, 'Agreed in a test', users[ACCOUNTS]]);
    const [{ state }] = await sql('select private.workspace_payout_row(r)->>$2 state from private.workspace_reservations r where id=$1', [id, 'state']);
    return state;
  }
  const d = n => at(today, n);
  // Counted: overdue and missing or different.
  assert.equal(await add('airbnb', await d(-3), await d(1)), 'missing'); // due 2 days after check-in: yesterday
  assert.equal(await add('vrbo', await d(-3), await d(2)), 'missing');
  assert.equal(await add('booking_com', await d(-9), await d(-6)), 'missing'); // due 5 days after check-out: yesterday
  assert.equal(await add('booking_com', await d(-14), await d(-10), { received: 25000 }), 'different');
  assert.equal(await add('airbnb', await at(last, -2), await at(last, 1)), 'missing'); // due on the first of last month
  // Not counted.
  assert.equal(await add('airbnb', await d(-2), await d(1)), 'missing'); // due today: not overdue yet
  assert.equal(await add('vrbo', await d(-1), await d(3)), 'missing');
  assert.equal(await add('booking_com', await d(-8), await d(-5)), 'missing'); // due today
  assert.equal(await add('booking_com', await d(-3), await d(2)), 'missing'); // still staying
  assert.equal(await add('booking_com', await d(-14), await d(-10), { received: 30000 }), 'matched');
  assert.equal(await add('airbnb', await d(-14), await d(-10), { received: 25000, agreed: 25000 }), 'agreed');
  assert.equal(await add('airbnb', await at(last, -3), await at(last, 1)), 'missing'); // due before the first of last month
  assert.equal(await add('airbnb', await d(-10), await d(-7), { status: 'cancelled' }), 'missing');
  assert.equal(await add('direct', await d(-10), await d(-7)), 'no_reference');
  assert.equal(await add('booking_com', await d(-14), await d(-10), { payout: null, received: 25000 }), 'no_expected_amount');
  assert.equal(await home() - before, 5);
});

test('the due dates are the named constants', async () => {
  const rows = await sql(`select private.workspace_payout_due_on(c,'2026-11-02','2026-11-06')::text d from unnest(array['airbnb','vrbo','booking_com','direct','other']) c`);
  assert.deepEqual(rows.map(r => r.d), ['2026-11-04', '2026-11-04', '2026-11-11', null, null]);
});

test('safe to run twice; the anchors are patched once and the new functions are for the database only', async () => {
  const names = ['private.workspace_hostaway_sync(jsonb)', 'private.workspace_payout_row(private.workspace_reservations)', 'private.workspace_management_overview()',
    'private.workspace_payout_breakdown(jsonb)', 'private.workspace_payout_due_on(text,date,date)'];
  const defs = async () => (await sql('select pg_get_functiondef(n::regprocedure) d from unnest($1::text[]) n', [names])).map(r => r.d);
  const before = await defs();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await defs(), before);
  const sentinels = ["set payout_breakdown=private.workspace_payout_breakdown(r->'payoutBreakdown')", "'expectedBreakdown',target.payout_breakdown", 'private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)<today'];
  sentinels.forEach((s, i) => assert.equal(before[i].split(s).length - 1, 1, names[i]));
  assert.ok(before[2].includes("'booking_com','vrbo')"), 'Vrbo is still counted');
  assert.equal((await sql("select count(*)::int n from pg_constraint where conname='workspace_reservations_payout_breakdown_object'"))[0].n, 1);
  for (const fn of names.slice(3)) {
    for (const role of ['anon', 'authenticated']) assert.equal((await sql('select has_function_privilege($1,$2,$3) ok', [role, fn, 'execute']))[0].ok, false, `${role} ${fn}`);
  }
});
