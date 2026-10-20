import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Comparables on an estimate. 20261020400000 raised the limit from 3 to 20; Estimate Delivery (Alex, 20261025300000)
// brings a new estimate back to up to 3 hand-picked comparables (MAX_COMPARABLES), keeping the old ceiling of 20 in the
// text so this patch still finds itself done. The patch runs twice without change.
const MINE = '20261020400000_estimate_comparables_limit.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async () => (await db.query("select pg_get_functiondef('private.workspace_journey_action(jsonb)'::regprocedure) d")).rows[0].d;
const firstRun = await definition();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definition();
after(() => db.close());

const ADMIN = '33000000-0000-4000-8000-000000000001', SESSION = '43000000-0000-4000-8000-000000000001';
await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [ADMIN, 'comparables@example.com']);
await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [SESSION, ADMIN]);
await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [SESSION, ADMIN]);
await db.query("update public.workspace_profiles set status='active',role='super_admin',full_name='Admin' where user_id=$1", [ADMIN]);
await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ADMIN, session_id: SESSION })]);
await db.exec('set role authenticated');
const journey = async input => (await db.query('select public.workspace_journey_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const comparables = n => Array.from({ length: n }, (_, i) => ({ name: 'Flat ' + (i + 1), url: 'https://www.airbnb.co.uk/rooms/' + (i + 1), adrMinor: 9000 + i * 100 }));
const rates = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comments: '' };

test('the patch runs twice without change, and a new estimate is held to 3', () => {
  assert.equal(secondRun, firstRun);
  assert.match(firstRun, /jsonb_array_length\(input->'comparables'\)>20 then raise exception 'Invalid estimate'/);
  assert.match(firstRun, /jsonb_array_length\(input->'comparables'\)>3\/\* estimate comparables three: 20261025300000 \*\//);
});

test('an estimate takes 0 to 3 comparables, and refuses a 4th', async () => {
  let j = await journey({ action: 'createEnquiry', name: 'Many comparables flat', address: '3 Holmhead Place, Glasgow', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, enquiry: { contactName: 'Isla Example', email: 'isla@example.com' } });
  for (const n of [0, 1, 3]) {
    j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...rates, comparables: comparables(n) });
    assert.equal(j.estimate.comparables.length, n);
  }
  await assert.rejects(journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...rates, comparables: comparables(4) }), /Invalid estimate/);
});
