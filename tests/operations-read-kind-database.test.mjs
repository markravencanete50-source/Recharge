import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Faster repair screens (20261025800000): the work read limited to one kind of work gives exactly what the full read gives
// for that kind, under the same access rules, and a second run of the migration changes nothing.
const MINE = '20261025800000_operations_read_kind';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_operations_read_kind(uuid,text)', 'public.workspace_operations_read_kind(uuid,text)'];
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['admin', 'stays', 'client', 'client', 'cleans'];
const [ADMIN, STAYS, OWNER, OTHER_OWNER, CLEANER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `98800000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9880', '9881');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `kindread-${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
await db.exec('reset role');
await db.query("select set_config('request.jwt.claims','',false)");
const newProperty = async name => (await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values($1,$1||', Edinburgh','Edinburgh',$2,gen_random_uuid()) returning id", [name, users[ADMIN]])).rows[0].id;
const property = await newProperty('Harbour Flat'), otherProperty = await newProperty('Other Flat');
for (const [who, kind, prop] of [[STAYS, 'staff', property], [OWNER, 'client', property], [OTHER_OWNER, 'client', otherProperty], [CLEANER, 'staff', property]])
  await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [prop, users[who], kind, users[ADMIN]]);
async function workItem(kind, title, moduleId, { clientVisible = false, prop = property, data = {} } = {}) {
  const id = (await db.query('insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),$1,$2,$3,$4,$5) returning id', [prop, moduleId, title, users[ADMIN], clientVisible])).rows[0].id;
  await db.query('insert into private.workspace_domain_details(work_id,kind,data) values($1,$2,$3)', [id, kind, data]);
  return id;
}
await workItem('maintenance', 'Boiler not working', 'stays-maintenance-reporting', { clientVisible: true, data: { guestEvidence: 'secret note' } });
await workItem('maintenance', 'Leak elsewhere', 'stays-maintenance-reporting', { clientVisible: true, prop: otherProperty });
await workItem('daily_pricing', '3 empty nights to price', 'daily-pricing');
const all = async who => { await as(who); return (await db.query('select public.workspace_operations_read(null) r')).rows[0].r; };
const ofKind = async (who, kind, prop = null) => { await as(who); return (await db.query('select public.workspace_operations_read_kind($1,$2) r', [prop, kind])).rows[0].r; };

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('one kind gives exactly what the full read gives for that kind, for every role', async () => {
  for (const who of [ADMIN, STAYS, OWNER, OTHER_OWNER, CLEANER]) {
    const full = (await all(who)).filter(w => w.kind === 'maintenance');
    assert.deepEqual(await ofKind(who, 'maintenance'), full, roles[who] + ' ' + who);
    assert.ok((await ofKind(who, 'maintenance')).every(w => w.kind === 'maintenance'));
  }
  // The owner sees only their own property's repair, and in the owner view.
  const mine = await ofKind(OWNER, 'maintenance');
  assert.deepEqual(mine.map(w => w.title), ['Boiler not working']);
  assert.ok(!('guestEvidence' in mine[0].data));
  assert.equal((await ofKind(ADMIN, 'maintenance')).length, 2);
  assert.deepEqual((await ofKind(ADMIN, 'maintenance', otherProperty)).map(w => w.title), ['Leak elsewhere']);
});

test('a missing or odd kind is refused, and signed-out callers cannot read', async () => {
  for (const bad of [null, '', 'Maintenance', "x'; select 1"]) await assert.rejects(ofKind(ADMIN, bad), /Choose a kind of work/);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.workspace_operations_read_kind(null,'maintenance')"), /permission denied/);
  await db.exec('reset role');
});
