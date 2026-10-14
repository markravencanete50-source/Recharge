import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// "Your own costs" on the estimate (migration 20261020890000): publishEstimate keeps the owner's monthly costs with the
// estimate when the team adds them and checks them; the team's form gets the categories an admin keeps in Onboarding
// settings. Without costs the estimate is stored exactly as before.
const MINE = '20261020890000_estimate_own_costs.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_journey_action(jsonb)', 'private.workspace_journey_view(private.workspace_journeys)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();
after(() => db.close());

const users = ['34000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000003'];
const roles = ['super_admin', 'stays', 'client'];
const [ADMIN, STAYS, OWNER] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  const id = users[i], session = id.replace('34000000', '44000000');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `costs${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session, id]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [id, roles[i], 'Person ' + i]);
  for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [id, m]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('34000000', '44000000') })]); await db.exec('set role authenticated'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const journey = async input => (await db.query('select public.workspace_journey_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const estimate = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '', otaFeeBps: 1500, managementFeeBps: 2000 };
let j;

test('the migration runs twice without change', () => {
  assert.deepEqual(secondRun, firstRun);
  assert.match(firstRun[0], /'managementFeeBps','ownCosts'\]/);
  assert.match(firstRun[1], /'ownCostCategories'/);
});

test('the team’s form gets the categories in use; nobody else does, and not after the estimate', async () => {
  await as(ADMIN);
  j = await journey({ action: 'createEnquiry', name: 'Costs flat', address: '3 Test Street, Glasgow', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, enquiry: { contactName: 'Cora Example', email: 'cora@example.com' } });
  assert.deepEqual(j.ownCostCategories, ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Other']);
  await sql(`update private.workspace_onboarding_settings set own_cost_categories='["Mortgage","Service charge"]'`);
  await as(ADMIN);
  j = (await db.query('select public.workspace_journey_read($1) result', [j.propertyId])).rows[0].result[0];
  assert.deepEqual(j.ownCostCategories, ['Mortgage', 'Service charge']);
});

test('an estimate without costs is stored exactly as before', async () => {
  await as(ADMIN);
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate });
  assert.deepEqual(j.estimate, estimate);
  assert.equal('ownCosts' in j.estimate, false);
});

test('costs are kept with the estimate and checked', async () => {
  await sql("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3) on conflict do nothing", [j.propertyId, users[STAYS], users[ADMIN]]);
  await as(STAYS);
  const ownCosts = [{ category: 'Mortgage', monthlyMinor: 85000 }, { category: 'Service charge', monthlyMinor: 12050 }];
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate, ownCosts });
  assert.deepEqual(j.estimate.ownCosts, ownCosts);
  const bad = [
    [{ category: 'Mortgage', monthlyMinor: 1 }, { category: ' mortgage ', monthlyMinor: 2 }],
    [{ category: '', monthlyMinor: 1 }],
    [{ category: 'Mortgage', monthlyMinor: -1 }],
    [{ category: 'Mortgage', monthlyMinor: 1.5 }],
    [{ category: 'Mortgage', monthlyMinor: 10000001 }],
    [{ category: 'Mortgage', monthlyMinor: '100' }],
    [{ category: 'Mortgage', monthlyMinor: 1, note: 'x' }],
    ['Mortgage'],
    Array.from({ length: 13 }, (_, i) => ({ category: 'Cost ' + i, monthlyMinor: 1 })),
    { category: 'Mortgage', monthlyMinor: 1 },
  ];
  for (const costs of bad) await assert.rejects(journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate, ownCosts: costs }), /own costs/, JSON.stringify(costs));
  assert.deepEqual((await sql('select estimate->\'ownCosts\' c from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].c, ownCosts, 'unchanged by the refused tries');
});

test('the owner sees the costs with their estimate, but not the team’s category list', async () => {
  await sql('update private.workspace_journeys set client_id=$2 where property_id=$1', [j.propertyId, users[OWNER]]);
  await sql("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3) on conflict do nothing", [j.propertyId, users[OWNER], users[ADMIN]]);
  await as(OWNER);
  const mine = (await db.query('select public.workspace_journey_read($1) result', [j.propertyId])).rows[0].result[0];
  assert.equal(mine.estimate.ownCosts.length, 2);
  assert.equal(mine.ownCostCategories, null);
});
