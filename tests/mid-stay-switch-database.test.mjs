import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Mid-stay cleans switch (20261014110000, client answer 5): ON by default, so nothing changes; while OFF no new
// mid-stay clean is made and an automatic one nobody has started is cancelled, a started one is left alone, and a
// clean made by hand is never touched; ON again brings mid-stay cleans back for stays still ahead.
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
async function setClean(id, status, data = {}) {
  await sql('update private.workspace_domain_details set data=data||$2::jsonb where work_id=$1', [id, JSON.stringify({ workStatus: status, ...data })]);
  await sql('update public.workspace_work_items set status=$2,version=version+1 where id=$1', [id, status]);
}
// Flip the switch the way a later one-line migration would.
const setSwitch = on => sql(`create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select ${on} $$`);

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Switch flat' }]);
await sql('insert into private.workspace_default_cleaners(property_id,cleaner_id,updated_by) values($1,$2,$3)', [HOME, users[CLEANER], users[ADMIN]]);

test('the switch is on by default, so long stays still get their mid-stay clean', async () => {
  assert.equal((await sql('select private.workspace_mid_stay_cleans_enabled() v'))[0].v, true);
  assert.equal((await sql("select provolatile v from pg_proc where oid='private.workspace_mid_stay_cleans_enabled()'::regprocedure"))[0].v, 'i');
  const long = await stay(HOME, 'Twenty nights', '2026-11-05', '2026-11-25');
  const result = await midStay();
  assert.equal(result.created, 1);
  const [made] = await cleansFor(long);
  assert.equal(made.due, '2026-11-15'); assert.equal(made.status, 'waiting');
});

test('switched off: no new mid-stay cleans, unstarted automatic ones are cancelled, started ones are left alone', async () => {
  const unstarted = await stay(HOME, 'Sixteen nights', '2026-11-26', '2026-12-12');
  const started = await stay(HOME, 'Eighteen nights', '2026-12-13', '2026-12-31');
  assert.equal((await midStay()).created, 2);
  const [startedClean] = await cleansFor(started);
  await setClean(startedClean.id, 'in_progress', { submittedBy: users[CLEANER], phase: 'review' });
  // A clean made by hand for a long stay is not one the run made, so the switch never touches it.
  const manual = (await sql(`with w as (insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,due_on)
    values(gen_random_uuid(),$1,'cleaning-schedule','Extra clean',$2,'2026-11-20') returning id)
    insert into private.workspace_domain_details(work_id,kind,data) select id,'cleaning','{"phase":"assigned","workStatus":"waiting"}'::jsonb from w returning work_id`, [HOME, users[ADMIN]]))[0].work_id;

  await setSwitch(false);
  const later = await stay(HOME, 'Twenty-two nights', '2027-01-02', '2027-01-24');
  const off = await midStay();
  assert.equal(off.created, 0, 'nothing new while switched off');
  assert.equal(off.cancelled, 2, 'the first test\'s clean and the unstarted one');
  assert.equal(off.leftAlone, 1, 'the started one');
  const [cancelled] = await cleansFor(unstarted);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.data.cancelledBecause, 'Mid-stay cleans are switched off'); assert.equal(cancelled.data.midStayCancelled, true);
  assert.equal((await cleansFor(started))[0].status, 'in_progress');
  assert.equal((await cleansFor(later)).length, 0);
  assert.equal((await sql('select status from public.workspace_work_items where id=$1', [manual]))[0].status, 'waiting');
  assert.deepEqual(await midStay(), { created: 0, cancelled: 0, leftAlone: 1, remaining: 0 }, 'a second run changes nothing');

  // Switched back on, stays still ahead get a mid-stay clean again (one cancelled by the switch is not counted).
  await setSwitch(true);
  const on = await midStay();
  assert.equal(on.created, 3);
  assert.equal((await cleansFor(later)).length, 1);
  assert.equal((await cleansFor(unstarted)).filter(c => c.status === 'waiting').length, 1);
});

test('the migration runs twice without changing a definition, and the switch is not callable by anyone', async () => {
  const fns = ['private.workspace_mid_stay_cleans_enabled()', 'private.workspace_mid_stay_wanted(private.workspace_reservations)', 'private.workspace_mid_stay_cleans(timestamptz)'];
  const read = () => Promise.all(fns.map(async fn => (await sql('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d));
  const before = await read();
  await asDb(); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await read(), before);
  assert.equal(before[2].split('Mid-stay cleans are switched off').length - 1, 1, 'the reason is patched in once');
  for (const role of ['anon', 'authenticated']) {
    const [row] = await sql(`select has_function_privilege($1,'private.workspace_mid_stay_cleans_enabled()','execute') a,has_function_privilege($1,'private.workspace_mid_stay_wanted(private.workspace_reservations)','execute') b`, [role]);
    assert.equal(row.a, false, role); assert.equal(row.b, false, role);
  }
});
