import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Mid-stay cleans switch (20261014110000, client answer 5, Lee's decision): OFF by default. While off the run creates
// no mid-stay clean and leaves every existing one exactly as it is, even one whose stay was cancelled. Switched on, the
// run behaves as before.
const MIGRATION = 'supabase/migrations/20261014110000_mid_stay_switch.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['super_admin', 'admin', 'cleans'];
const users = roles.map((_, i) => `e5000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, CLEANER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `midswitch${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('e500', 'e600'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('e500', 'e600'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('e500', 'e600') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const AT = '2026-11-01T12:00:00Z';
const midStay = async (at = AT) => (await sql('select private.workspace_mid_stay_cleans($1) r', [at]))[0].r;
const cleansFor = stayId => sql(`select w.id,w.status,w.due_on::text due,d.data from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning' and d.data->>'midStayOf'=$1 order by w.created_at,w.id`, [stayId]);
async function stay(prop, reference, checkIn, checkOut) {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,payout_minor)
    values($1,$2,$3,$4,'confirmed','manual','direct',50000) returning id`, [prop, reference, checkIn, checkOut]))[0].id;
}
// Flip the switch the way a later one-line migration would.
const setSwitch = on => sql(`create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select ${on} $$`);

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Switch flat' }]);
await sql('insert into private.workspace_default_cleaners(property_id,cleaner_id,updated_by) values($1,$2,$3)', [HOME, users[CLEANER], users[ADMIN]]);

test('the switch is off by default and matches the app constant', async () => {
  assert.equal((await sql('select private.workspace_mid_stay_cleans_enabled() v'))[0].v, false);
  assert.equal((await sql("select provolatile v from pg_proc where oid='private.workspace_mid_stay_cleans_enabled()'::regprocedure"))[0].v, 'i');
  const defaults = await fs.readFile('lib/feedback-defaults.ts', 'utf8');
  assert.match(defaults, /export const MID_STAY_CLEANS_ENABLED = false;/);
});

test('off: no new mid-stay cleans, and existing ones are left exactly as they are', async () => {
  // Made while the switch was on.
  await setSwitch(true);
  const kept = await stay(HOME, 'Twenty nights', '2026-11-05', '2026-11-25');
  const gone = await stay(HOME, 'Sixteen nights', '2026-11-26', '2026-12-12');
  assert.equal((await midStay()).created, 2);
  const before = await sql(`select w.id,w.status,w.version,w.due_on::text due,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and d.data->>'cleanType'='mid_stay' order by w.id`);
  assert.equal(before.length, 2);

  await setSwitch(false);
  // A stay that would need one, and a stay whose clean is no longer needed: neither is acted on.
  const later = await stay(HOME, 'Twenty-two nights', '2027-01-02', '2027-01-24');
  await sql("update private.workspace_reservations set status='cancelled' where id=$1", [gone]);
  assert.deepEqual(await midStay(), { created: 0, cancelled: 0, leftAlone: 0, remaining: 0, switchedOff: true });
  assert.deepEqual(await midStay('2026-11-30T12:00:00Z'), { created: 0, cancelled: 0, leftAlone: 0, remaining: 0, switchedOff: true });
  assert.equal((await cleansFor(later)).length, 0);
  const after = await sql(`select w.id,w.status,w.version,w.due_on::text due,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and d.data->>'cleanType'='mid_stay' order by w.id`);
  assert.deepEqual(after, before, 'not cancelled, moved or changed');
  assert.equal((await cleansFor(kept))[0].status, 'waiting');

  // The backend entry obeys it too.
  await asDb(); await db.exec('set role service_role');
  assert.equal((await db.query('select public.workspace_mid_stay_cleans() r')).rows[0].r.switchedOff, true);

  // On again: the run picks up where it was, cancelling the clean of the cancelled stay and making the new one.
  await setSwitch(true);
  const on = await midStay();
  assert.equal(on.created, 1); assert.equal(on.cancelled, 1); assert.equal(on.switchedOff, undefined);
  assert.equal((await cleansFor(later)).length, 1);
  assert.equal((await cleansFor(gone))[0].status, 'cancelled');
  await setSwitch(false);
});

test('the migration runs twice without changing a definition, and the switch is not callable by anyone', async () => {
  const fns = ['private.workspace_mid_stay_cleans_enabled()', 'private.workspace_mid_stay_cleans(timestamptz)'];
  const read = () => Promise.all(fns.map(async fn => (await sql('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d));
  const before = await read();
  await asDb(); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await read(), before);
  assert.equal(before[1].split('if not private.workspace_mid_stay_cleans_enabled() then return').length - 1, 1, 'the early return is patched in once');
  for (const role of ['anon', 'authenticated']) {
    const [row] = await sql(`select has_function_privilege($1,'private.workspace_mid_stay_cleans_enabled()','execute') a`, [role]);
    assert.equal(row.a, false, role);
  }
});
