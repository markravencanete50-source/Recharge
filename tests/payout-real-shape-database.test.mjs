import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';
import { airbnbYear, render } from './payout-real-shape-fixture.mjs';

// A made-up Airbnb year the size and shape of a real export, read by the server's own code (prepareFinanceAction)
// and sent to the database exactly as the finance route sends it. All migrations are applied to pglite.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
const { prepareFinanceAction } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const user = 'e4000000-0000-4000-8000-000000000001', sessionId = 'e5000000-0000-4000-8000-000000000001';
await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [user, 'realshape@example.com']);
await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionId, user]);
await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [sessionId, user]);
await db.query("update public.workspace_profiles set status='active',role='accounts',full_name='Accounts' where user_id=$1", [user]);
await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [user]);
const asAccounts = async () => {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: sessionId })]);
  await db.exec('set role authenticated');
};
const asDb = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
// What the finance route does with an upload: read the CSV on the server, then call workspace_finance_action with the lines.
async function upload(csv, fileName) {
  const prepared = prepareFinanceAction({ action: 'importPayoutReport', requestId: crypto.randomUUID(), channel: 'airbnb', fileName, csv });
  assert.ok(!('error' in prepared), prepared.error);
  await asAccounts();
  return (await db.query('select public.workspace_finance_action($1) result', [prepared.input])).rows[0].result;
}

const year = airbnbYear();
const lines = year.coded.length, total = year.coded.reduce((sum, line) => sum + line.minor, 0);
// A later export of the same account: 100 newer lines at the top, then every line of the first file.
const newer = airbnbYear({ seed: 99, days: 10, start: '2026-10-20' }).coded.slice(0, 100);
const extraMinor = newer.reduce((sum, line) => sum + line.minor, 0);

test('a full year imports line by line, and an identical file is refused', async () => {
  const first = await upload(render(year.rows), 'airbnb-year.csv');
  assert.deepEqual([first.lineCount, first.totalMinor, first.newLines, first.newMinor, first.alreadyHeld, first.cancelledStay, first.matchedReservations, first.unexpectedLines],
    [lines, total, lines, total, 0, 0, 0, lines]);
  await asDb();
  const held = (await db.query("select count(*)::int n,count(distinct line_key)::int keys,sum(amount_minor)::bigint minor,count(*) filter(where paid_on is null)::int undated from private.workspace_payout_lines where channel='airbnb'")).rows[0];
  assert.deepEqual([held.n, held.keys, Number(held.minor), held.undated], [lines, lines, total, 0]);
  const types = (await db.query("select line_type t,count(*)::int n from private.workspace_payout_lines where channel='airbnb' group by 1 order by 1")).rows;
  const expected = {}; for (const line of year.coded) expected[line.type] = (expected[line.type] ?? 0) + 1;
  assert.deepEqual(Object.fromEntries(types.map(r => [r.t, r.n])), expected);
  await assert.rejects(upload(render(year.rows), 'airbnb-year-again.csv'), /already been uploaded/);
  await asDb();
  assert.equal((await db.query('select count(*)::int n from private.workspace_payout_reports')).rows[0].n, 1);
});

test('an overlapping later export adds only its 100 new lines', async () => {
  assert.equal(newer.length, 100);
  const codes = new Set(year.coded.map(line => line.code));
  assert.ok(newer.every(line => !codes.has(line.code)), 'the newer lines are for other stays');
  const overlap = await upload(render([...newer.map(line => line.row), ...year.rows]), 'airbnb-later.csv');
  assert.deepEqual([overlap.lineCount, overlap.newLines, overlap.newMinor, overlap.alreadyHeld, overlap.totalMinor], [lines + 100, 100, extraMinor, lines, total + extraMinor]);
  await asDb();
  assert.equal((await db.query("select count(*)::int n from private.workspace_payout_lines where channel='airbnb'")).rows[0].n, lines + 100);
  const reports = (await db.query('select line_count,new_line_count from private.workspace_payout_reports order by created_at,line_count')).rows;
  assert.deepEqual(reports.map(r => [r.line_count, r.new_line_count]), [[lines, lines], [lines + 100, 100]]);
});

test('a confirmed stay with a code in the file is matched', async () => {
  // One reservation in the made-up year becomes a stay; its lines then count as matched in a further export.
  await asDb();
  const admin = 'e4000000-0000-4000-8000-000000000002', adminSession = 'e5000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [admin, 'realshape-admin@example.com']);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [adminSession, admin]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [adminSession, admin]);
  await db.query("update public.workspace_profiles set status='active',role='super_admin',full_name='Admin' where user_id=$1", [admin]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, session_id: adminSession })]);
  await db.exec('set role authenticated');
  const property = (await db.query('select public.workspace_save_property($1) result', [{ requestId: crypto.randomUUID(), name: 'Real shape flat' }])).rows[0].result;
  await asDb();
  const stay = year.coded.find(line => line.type === 'Reservation');
  await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,'Real shape stay','2026-03-01','2026-03-03','confirmed','hostaway','airbnb',$2,$3)`, [property, stay.code, stay.minor]);
  const extra = airbnbYear({ seed: 123, days: 2, start: '2026-11-20' }).coded.slice(0, 5);
  const mixed = [...extra.map(line => line.row), Object.assign([...stay.row], { 0: '11/25/2026', 13: '1.00' })];
  const result = await upload(render(mixed), 'airbnb-november.csv');
  assert.deepEqual([result.newLines, result.matchedReservations, result.unexpectedLines], [6, 1, 5]);
});
