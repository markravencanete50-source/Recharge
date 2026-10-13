import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Owner privacy, the remaining place (20261014130000): an owner reading the history of their own work no longer gets
// internal events (management and AirCover flags, reflections, routine visit forms, direct-booking follow-ups, the
// clean form reminder and warning). A repair resolved without a visit stays on their timeline. Staff are unchanged.
const MIGRATION = 'supabase/migrations/20261014130000_owner_history_internal_events.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['super_admin', 'admin', 'ready', 'client'];
const names = ['Sue Super', 'Ada Admin', 'Rory Ready', 'Owen Owner'];
const users = roles.map((_, i) => `98500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9850', '9860');
const [SUPER, ADMIN, READY, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ownerhistory-${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'History flat', address: '7 Example Row, Edinburgh', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[ADMIN, 'staff'], [READY, 'staff'], [OWNER, 'client']]) await rpc('workspace_assign_property', [HOME, users[who], kind]);
await as(ADMIN);
const repair = await rpc('workspace_operations_action', [JSON.stringify({ requestId: crypto.randomUUID(), action: 'createOperation', propertyId: HOME, kind: 'maintenance', data: { issue: 'Leaking tap', estimatedCostMinor: 12000, hazard: false, repairType: 'heating' } })]);
const work = repair.workId;
const HIDDEN = ['management.flag_raised', 'management.flag_resolved', 'aircover.flagged', 'reflection.saved', 'routine.visit_form_recorded', 'stays.direct_booking_follow_up', 'cleaning.form_missing', 'cleaning.form_reminder'];
const KEPT = ['operations.updateOperation.resolveRepair', 'operations.updateOperation.bookRepair'];
for (const e of [...HIDDEN, ...KEPT]) await sql('insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,$4)', [users[READY], HOME, work, e]);
const events = async i => { await as(i); return (await rpc('workspace_oversight_read', ['history', work])).entries.filter(e => e.type === 'event').map(e => e.event); };

test('an owner\'s timeline leaves out internal events but keeps the repair resolution and the ordinary steps', async () => {
  const owner = await events(OWNER);
  for (const hidden of HIDDEN) assert.ok(!owner.includes(hidden), hidden);
  for (const kept of KEPT) assert.ok(owner.includes(kept), kept);
  assert.ok(owner.includes('operations.createOperation'), 'the repair being reported is still there');
  const full = (await rpc('workspace_oversight_read', ['history', work])).entries;
  assert.ok(full.some(e => e.note === 'Leaking tap'), 'with its notes');
  assert.ok(full.every(e => !('by' in e)), 'and still no staff names');
});

test('staff and admins still see every event', async () => {
  for (const who of [ADMIN, SUPER, READY]) {
    const seen = await events(who);
    for (const e of [...HIDDEN, ...KEPT]) assert.ok(seen.includes(e), `${names[who]} sees ${e}`);
  }
});

test('the migration runs twice without changing the function', async () => {
  const definition = async () => (await sql("select pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure) d"))[0].d;
  const before = await definition();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await definition(), before);
  assert.equal(before.split("actor<>'client' or a.event_type !~").length - 1, 1, 'patched once');
  assert.ok(before.includes("case when actor='client' then h.e-'by' else h.e end"), 'the round 3 name stripping is still in place');
});
