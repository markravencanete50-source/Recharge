import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Edit a property's name and address from Properties (20261022800000), run against the real database functions. Admins
// and super admins edit any property; Stays edit the properties they are on; owners, cleaners and every other role are
// refused. The change is versioned, recorded in the activity, and the Hostaway sync never puts the old name back.
const db = new PGlite();
const MIGRATION = 'supabase/migrations/20261022800000_property_edit.sql';
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// The live sync is paused for the new business; the Hostaway test runs it switched back on.
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); });

const roles = ['super_admin', 'admin', 'stays', 'stays', 'client', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'stays'];
const [SUPER, ADMIN, STAYS, OTHER_STAYS, OWNER, CLEANER, MANAGER, READY, ACCOUNTS, STAYS_NO_TOOL] = roles.map((_, i) => i);
const users = roles.map((_, i) => `7c000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('7c00', '7d00');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `property-edit${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query(i === STAYS_NO_TOOL ? "insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features where module_id<>'property-database'"
    : 'insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]); await db.exec('set role authenticated'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const owner = async (sql, args = []) => (await db.exec('reset role'), (await db.query(sql, args)).rows);
const act = async input => (await db.query('select public.workspace_portfolio_action($1::jsonb) r', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].r;
const row = async id => (await owner('select name,address,region,version,hostaway_listing_id from public.workspace_properties where id=$1', [id]))[0];
const edit = async (id, name, address, version) => act({ action: 'saveNameAddress', propertyId: id, version: version ?? (await row(id)).version, name, address });

await as(SUPER);
const create = async (name, address, region = '') => (await db.query('select public.workspace_save_property($1) r', [{ requestId: crypto.randomUUID(), name, address, region, bedrooms: 2 }])).rows[0].r;
const flat = await create('Leith flat', '1 Shore, Leith, Edinburgh EH6');
const other = await create('Other flat', '2 High Street, Dundee');
const chosen = await create('Chosen region', '3 Main Street, Glasgow', 'Edinburgh');
for (const [i, kind] of [[STAYS, 'staff'], [STAYS_NO_TOOL, 'staff'], [OWNER, 'client'], [CLEANER, 'cleaner'], [MANAGER, 'cleaning_manager'], [READY, 'staff']]) {
  await db.query('select public.workspace_assign_property($1,$2,$3)', [flat, users[i], kind]);
}

test('the migration is safe to run twice, leaves the patch in once, and grants nothing new', async () => {
  const defs = async () => (await owner(`select string_agg(pg_get_functiondef(f::regprocedure),'\n' order by f) d from unnest(array['private.workspace_portfolio_action(jsonb)','private.workspace_save_property_name_address(uuid,jsonb)']) f`))[0].d;
  const before = await defs();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await defs(), before);
  const action = (await owner("select pg_get_functiondef('private.workspace_portfolio_action(jsonb)'::regprocedure) d"))[0].d;
  assert.equal(action.split("elsif a='saveNameAddress'").length - 1, 1);
  assert.equal(action.split("elsif a='recordLocalEvent'").length - 1, 1);
  assert.equal(action.split("elsif a='saveListingLinks'").length - 1, 1, 'the listing links patch is untouched');
  const text = await fs.readFile(MIGRATION, 'utf8');
  const migration = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(migration, /\bdrop\b|\bdelete\s+from\b/i, 'no DROP, no DELETE');
  assert.doesNotMatch(migration, /grant execute/i, 'nothing new is granted');
  assert.match(migration, /revoke all on function private\.workspace_save_property_name_address\(uuid,jsonb\) from public,anon,authenticated;/);
  assert.match(migration, /security definer set search_path=''/);
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.match(text, /\r\n/, 'CRLF');
  // The helper is internal: nobody signed in calls it directly.
  await as(ADMIN);
  await assert.rejects(db.query('select private.workspace_save_property_name_address($1,$2::jsonb)', [flat, '{}']), /permission denied/);
});

test('an admin edits any property: trimmed, versioned and recorded', async () => {
  await as(ADMIN);
  const before = await row(other);
  const saved = await edit(other, '  Dundee riverside flat  ', '  2 High Street, Dundee DD1 1AA  ');
  assert.deepEqual({ name: saved.name, address: saved.address, version: saved.version }, { name: 'Dundee riverside flat', address: '2 High Street, Dundee DD1 1AA', version: before.version + 1 });
  const after = await row(other);
  assert.equal(after.name, 'Dundee riverside flat');
  assert.equal(after.address, '2 High Street, Dundee DD1 1AA');
  const events = await owner("select actor_id from public.workspace_activity where property_id=$1 and event_type='portfolio.saveNameAddress'", [other]);
  assert.deepEqual(events.map(e => e.actor_id), [users[ADMIN]]);
  const receipt = await owner("select input->>'name' n from private.workspace_action_receipts where actor_id=$1 and input->>'action'='saveNameAddress'", [users[ADMIN]]);
  assert.equal(receipt.length, 1);
  // A super admin too.
  await as(SUPER);
  assert.equal((await edit(other, 'Dundee flat', '2 High Street, Dundee DD1 1AA')).name, 'Dundee flat');
});

test('Stays on the property edit it; Stays elsewhere or without the property tool are refused', async () => {
  await as(STAYS);
  assert.equal((await edit(flat, 'Leith shore flat', '1 Shore, Leith, Edinburgh EH6 6QW')).name, 'Leith shore flat');
  await assert.rejects(edit(other, 'Not mine', '2 High Street, Dundee'), /Property access denied/);
  await as(OTHER_STAYS);
  await assert.rejects(edit(flat, 'Not mine', '1 Shore'), /Property access denied/);
  await as(STAYS_NO_TOOL);
  await assert.rejects(edit(flat, 'Not mine', '1 Shore'), /Property access denied/);
  assert.equal((await row(flat)).name, 'Leith shore flat');
});

test('owners, cleaners, the cleaning manager, Ready and Accounts are refused, even on their own property', async () => {
  for (const i of [OWNER, CLEANER, MANAGER, READY, ACCOUNTS]) {
    await as(i);
    await assert.rejects(edit(flat, 'Renamed by ' + roles[i], '1 Shore'), /Property team permission required/, roles[i]);
  }
  assert.equal((await row(flat)).name, 'Leith shore flat');
});

test('a name of 2 to 200 characters, an address of 1 to 1000, and the current version', async () => {
  await as(ADMIN);
  const { version } = await row(flat);
  await assert.rejects(edit(flat, ' A ', '1 Shore'), /name of at least 2 characters/);
  await assert.rejects(edit(flat, 'x'.repeat(201), '1 Shore'), /200 characters or fewer/);
  await assert.rejects(edit(flat, 'Leith flat', '   '), /Add the property's address/);
  await assert.rejects(edit(flat, 'Leith flat', 'x'.repeat(1001)), /1000 characters or fewer/);
  await assert.rejects(act({ action: 'saveNameAddress', propertyId: flat, name: 'Leith flat', address: '1 Shore' }), /version required/);
  await assert.rejects(act({ action: 'saveNameAddress', propertyId: flat, version, name: 'Leith flat', address: '1 Shore', region: 'Fife' }), /Unknown or oversized/);
  await assert.rejects(edit(flat, 'Leith flat', '1 Shore', version - 1), /Property changed/);
  assert.equal((await row(flat)).version, version, 'nothing changed');
  // Saving the same name and address changes nothing.
  assert.equal((await edit(flat, 'Leith shore flat', '1 Shore, Leith, Edinburgh EH6 6QW')).version, version);
});

test('a region worked out from the old address follows the new one; a region chosen by hand stays', async () => {
  await as(ADMIN);
  assert.equal((await row(flat)).region, 'Edinburgh');
  await edit(flat, 'Leith shore flat', '9 Union Street, Aberdeen AB11');
  assert.equal((await row(flat)).region, 'Aberdeen');
  assert.equal((await row(chosen)).region, 'Edinburgh');
  await edit(chosen, 'Chosen region', '4 Main Street, Dundee');
  assert.equal((await row(chosen)).region, 'Edinburgh');
});

test('the Hostaway sync never puts back the name or address of a linked property', async () => {
  await owner("update public.workspace_properties set hostaway_listing_id='HE-1' where id=$1", [other]);
  await as(ADMIN);
  await edit(other, 'Riverside, edited', '5 Edited Road, Dundee DD2');
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
  await db.query('select public.workspace_hostaway_sync($1::jsonb)', [JSON.stringify({ trigger: 'schedule', listings: [{ id: 'HE-1', name: 'Hostaway name', address: 'Hostaway address', bedrooms: 2 }], reservations: [] })]);
  const after = await row(other);
  assert.equal(after.name, 'Riverside, edited');
  assert.equal(after.address, '5 Edited Road, Dundee DD2');
  assert.equal(after.hostaway_listing_id, 'HE-1');
  assert.equal((await owner("select count(*)::int n from public.workspace_properties where hostaway_listing_id='HE-1'"))[0].n, 1, 'no second property');
});
