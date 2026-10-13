import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Owner privacy, round 3 (20261013090000): an owner reads a work item's timeline without the names of staff, and cannot read the
// internal event names (management flags, AirCover, reflections, routine visits) in the activity table. Staff are unchanged.
// The migration is applied twice to prove it is safe to run again.
const MINE = '20261013090000_owner_privacy_round3';
const dir = 'supabase/migrations/';
const files = await fs.readdir(dir);
const mineFile = files.find(f => f === MINE + '.sql') ?? files.find(f => f === MINE + '.sql.draft');
assert.ok(mineFile, 'the migration exists');
const mine = await fs.readFile(dir + mineFile, 'utf8');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of files.filter(f => f.endsWith('.sql') && !f.startsWith(MINE)).sort()) await db.exec(await fs.readFile(dir + file, 'utf8'));
await db.exec(mine);
await db.exec(mine);
after(() => db.close());

const roles = ['super_admin', 'admin', 'ready', 'client'];
const names = ['Sue Super', 'Ada Admin', 'Ada Admin', 'Owen Owner'];
const users = roles.map((_, i) => `98300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9830', '9840');
const [SUPER, ADMIN, READY, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ownerprivacy3-${i}@example.com`]);
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
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Round3 flat', address: '4 Example Row, Edinburgh', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[ADMIN, 'staff'], [READY, 'staff'], [OWNER, 'client']]) await rpc('workspace_assign_property', [HOME, users[who], kind]);
await as(ADMIN);
const repair = await rpc('workspace_operations_action', [JSON.stringify({ requestId: crypto.randomUUID(), action: 'createOperation', propertyId: HOME, kind: 'maintenance', data: { issue: 'Leaking tap', estimatedCostMinor: 12000, hazard: false, repairType: 'heating' } })]);
const work = repair.workId;
const EVENTS = ['management.flag_raised', 'aircover.flagged', 'reflection.saved', 'routine.visit_form_recorded', 'stays.direct_booking_follow_up', 'cleaning.form_missing', 'operations.updateOperation.resolveRepair', 'operations.updateOperation.bookRepair', 'handover.created'];
for (const e of EVENTS) await sql('insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,$4)', [users[READY], HOME, work, e]);

test('an owner reads the timeline without staff names; staff still see them', async () => {
  const entries = r => r.entries;
  await as(OWNER);
  const owner = entries(await rpc('workspace_oversight_read', ['history', work]));
  assert.ok(owner.length >= 2, 'the owner still sees the timeline');
  assert.ok(owner.some(e => e.note === 'Leaking tap'), 'with its notes');
  assert.ok(owner.every(e => !('by' in e)), 'but no entry names a person');
  assert.ok(!JSON.stringify(owner).includes('Ada'), 'The admin name is not anywhere in it');
  for (const who of [ADMIN, SUPER]) {
    await as(who);
    const staff = entries(await rpc('workspace_oversight_read', ['history', work]));
    assert.ok(staff.some(e => e.by === 'Ada Admin'), 'staff see who did it');
  }
});

test('an owner cannot read internal activity event names; staff and admins still can', async () => {
  const seen = async i => { await as(i); return (await db.query('select event_type from public.workspace_activity where work_id=$1', [work])).rows.map(r => r.event_type); };
  const owner = await seen(OWNER);
  for (const hidden of ['management.flag_raised', 'aircover.flagged', 'reflection.saved', 'routine.visit_form_recorded', 'stays.direct_booking_follow_up', 'cleaning.form_missing', 'operations.updateOperation.resolveRepair']) assert.ok(!owner.includes(hidden), hidden);
  for (const shown of ['operations.updateOperation.bookRepair', 'handover.created']) assert.ok(owner.includes(shown), shown);
  const admin = await seen(ADMIN);
  for (const e of EVENTS) assert.ok(admin.includes(e), 'admin sees ' + e);
  const ready = await seen(READY);
  for (const e of EVENTS) assert.ok(ready.includes(e), 'the person who did it sees ' + e);
});
