import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Owner privacy, round 4 (20261014130000 and 20261014160000): whatever staff do on an owner's repair, everything the
// owner can read about it (the work item, its history, the activity rows and their notifications) carries no staff
// name, no staff identity field (anything named ...By), no internal event (management or AirCover flags, reflections,
// routine visit forms, direct-booking follow-ups, clean form events) and no internal note.
const MIGRATION = 'supabase/migrations/20261014160000_owner_work_staff_fields.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); });

const roles = ['super_admin', 'admin', 'stays', 'ready', 'client'];
const names = ['Sabine Superadmin', 'Agnes Adminperson', 'Stuart Staysperson', 'Rhona Readyperson', 'Owen Owner'];
const users = roles.map((_, i) => `98700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9870', '9880');
const [SUPER, ADMIN, STAYS, READY, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ownerround4-${i}@example.com`]);
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
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const teams = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Round four flat', address: '12 Example Row, Edinburgh' }]);
for (const who of [ADMIN, STAYS, READY]) await rpc('workspace_assign_property', [HOME, users[who], 'staff']);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);
// Staff work the owner's repair: reported, troubleshot and referred to Ready, flagged for management and as an AirCover claim.
await as(STAYS);
let repair = await operation({ action: 'createOperation', propertyId: HOME, kind: 'maintenance', data: { issue: 'Boiler not firing', estimatedCostMinor: 0, hazard: false, repairType: 'heating' } });
repair = await operation({ action: 'updateOperation', workId: repair.workId, version: repair.version, step: 'referReady', data: { troubleshooting: 'SECRET reset twice, pressure fine', guestUpdate: 'An engineer is coming' } });
await teams({ action: 'flagForManagement', source: 'work', workId: repair.workId, title: 'Owner unhappy', reason: 'SECRET the owner has complained twice' });
await teams({ action: 'flagAirCover', workId: repair.workId });
// And internal events of every kind on the same work, as other parts of the app log them.
const INTERNAL = ['management.flag_raised', 'aircover.flagged', 'reflection.saved', 'routine.visit_form_recorded', 'stays.direct_booking_follow_up', 'cleaning.form_missing', 'cleaning.form_reminder'];
for (const e of INTERNAL) await sql('insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,$4)', [users[READY], HOME, repair.workId, e]);
await sql('insert into private.workspace_notification_outbox(user_id,work_id,event_id) select $1,$2,a.id from public.workspace_activity a where a.work_id=$2 and a.event_type=$3', [users[OWNER], repair.workId, 'aircover.flagged']);

const STAFF_NAMES = names.slice(0, 4);
const staffIds = users.slice(0, 4);
// Every key at any depth of a JSON value.
const keysOf = v => v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [Array.isArray(v) ? '' : k, ...keysOf(x)]).filter(Boolean) : [];
async function everythingTheOwnerReads() {
  await as(OWNER);
  const work = (await rpc('workspace_operations_read', [HOME])).find(w => w.workId === repair.workId);
  const history = await rpc('workspace_oversight_read', ['history', repair.workId]);
  const activity = (await db.query('select event_type from public.workspace_activity where work_id=$1', [repair.workId])).rows;
  return { work, history, activity };
}

test('the owner reads the repair, its history and its activity, with no staff name, identity, internal event or internal note', async () => {
  const seen = await everythingTheOwnerReads();
  assert.ok(seen.work, 'the owner still sees the repair');
  assert.equal(seen.work.data.issue, 'Boiler not firing');
  assert.equal(seen.work.data.guestUpdate, 'An engineer is coming', 'what the owner is meant to read is still there');
  assert.ok(seen.history.entries.length >= 2, 'and the timeline');
  const text = JSON.stringify(seen);
  for (const name of STAFF_NAMES) assert.ok(!text.includes(name), `no staff name: ${name}`);
  for (const id of staffIds) assert.ok(!JSON.stringify({ work: seen.work, history: seen.history }).includes(id), `no staff id in the work or history: ${id}`);
  assert.ok(!text.includes('SECRET'), 'no internal note');
  const byKeys = keysOf({ work: seen.work, history: seen.history }).filter(k => /By$/.test(k));
  assert.deepEqual(byKeys, ['updatedBy'], 'only the empty last-update name is there: no staff identity field');
  assert.equal(seen.work.updatedBy, null); assert.equal(seen.work.updatedEvent, null);
  for (const e of INTERNAL) assert.ok(!text.includes(e), `no internal event: ${e}`);
});

test('staff still read everything', async () => {
  for (const who of [ADMIN, STAYS]) {
    await as(who);
    const work = (await rpc('workspace_operations_read', [HOME])).find(w => w.workId === repair.workId);
    assert.equal(work.data.reportedBy, users[STAYS]); assert.equal(work.data.referredBy, users[STAYS]);
    assert.equal(work.data.troubleshooting, 'SECRET reset twice, pressure fine');
    const events = (await rpc('workspace_oversight_read', ['history', repair.workId])).entries.filter(e => e.type === 'event').map(e => e.event);
    for (const e of INTERNAL) assert.ok(events.includes(e), `${names[who]} sees ${e}`);
  }
});

test('the owner filter is one function, and the migration runs twice without change', async () => {
  const [f] = await sql("select private.workspace_owner_work_data('{\"issue\":\"x\",\"reportedBy\":\"a\",\"ownerApprovedBy\":\"b\",\"troubleshooting\":\"t\",\"Bypass\":1}'::jsonb) v");
  assert.deepEqual(f.v, { issue: 'x', Bypass: 1 });
  assert.equal((await sql("select private.workspace_owner_work_data('null'::jsonb) v"))[0].v, null);
  const definition = async () => (await sql("select pg_get_functiondef('private.workspace_operation_view(uuid)'::regprocedure) d"))[0].d;
  const before = await definition();
  assert.ok(before.includes("then private.workspace_owner_work_data(d.data-'guestEvidence'"));
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await definition(), before);
  assert.equal((await sql("select has_function_privilege('authenticated','private.workspace_owner_work_data(jsonb)','execute') a"))[0].a, false);
});
