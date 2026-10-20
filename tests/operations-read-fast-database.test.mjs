import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Faster work read (20261025900000): the set-based list gives exactly what the per-item access and view functions gave,
// for every role, property filter and kind, and a second run of the migration changes nothing.
const MINE = '20261025900000_operations_read_fast';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_operations_list(uuid,text)', 'private.workspace_operations_read(uuid)', 'private.workspace_operations_read_kind(uuid,text)'];
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

// The previous read, one item at a time, kept here as the reference the new list must match.
await db.exec(`create function private.old_operations_read(target_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare items jsonb;begin
 select coalesce(jsonb_agg(private.workspace_operation_view(w.id) order by w.updated_at desc),'[]') into items from (
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where (target_property is null or w.property_id=target_property) and w.status not in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 5000)
  union all
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where (target_property is null or w.property_id=target_property) and w.status in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 200)
 ) w;
 return items;
end $f$;grant execute on function private.old_operations_read(uuid) to authenticated;`);

const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'cleans', 'cleaning_manager', 'accounts', 'ready'];
const users = roles.map((_, i) => `98900000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9890', '9891');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `fastread-${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  // Everyone but the second owner has every module; the second owner only has repairs, to exercise the module check.
  await db.query(`insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features where $2 or module_id='stays-maintenance-reporting' on conflict do nothing`, [users[i], i !== 4]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
await db.exec('reset role');
await db.query("select set_config('request.jwt.claims','',false)");
const props = [];
for (let i = 0; i < 6; i++) props.push((await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values($1,$1,'Edinburgh',$2,gen_random_uuid()) returning id", ['Flat ' + i, users[0]])).rows[0].id);
for (const p of props.slice(0, 3)) for (const [u, a] of [[2, 'staff'], [3, 'client'], [5, 'cleaner'], [6, 'cleaning_manager'], [8, 'staff']])
  await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4) on conflict do nothing', [p, users[u], a, users[0]]);
await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4) on conflict do nothing', [props[3], users[4], 'client', users[0]]);
const kinds = [['cleaning', 'cleaning-schedule', 30], ['pricing_gap', 'daily-pricing', 12], ['direct_booking', 'direct-bookings', 6], ['maintenance', 'stays-maintenance-reporting', 14], ['purchase', 'purchase-order', 6], ['onboarding_invoice', 'purchase-order-accounts', 3]];
for (const [kind, moduleId, n] of kinds) for (let i = 0; i < n; i++) {
  const id = (await db.query('insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible,assignee_id) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6) returning id',
    [props[i % props.length], moduleId, kind + i, users[0], i % 3 === 0, i % 4 === 1 ? users[5] : i % 4 === 2 ? users[8] : null])).rows[0].id;
  const data = kind === 'maintenance' ? { issue: 'x', guestEvidence: 'note', ...(i % 5 === 0 ? { assignedReadyId: users[8] } : {}), ...(i % 2 ? { referredAt: '2026-01-01' } : {}) }
    : kind === 'purchase' ? { phase: i % 2 ? 'ordered' : 'requested' } : {};
  await db.query('insert into private.workspace_domain_details(work_id,kind,data) values($1,$2,$3)', [id, kind, data]);
  for (let j = 0; j < 2; j++) await db.query("insert into public.workspace_activity(event_type,actor_id,work_id,property_id) values($1,$2,$3,$4)", [j ? 'workspace.updated' : 'other.event', users[0], id, props[i % props.length]]);
}
// Finished and cancelled work, set directly with the status guard out of the way for the seed only.
await db.exec("set session_replication_role=replica;update public.workspace_work_items set status=case when title like '%1' then 'cancelled' else 'completed' end,updated_at=now()-interval '1 day'-make_interval(secs=>abs(hashtext(id::text))%100000) where title ~ '[0-9]*[13]$';set session_replication_role=origin;");

const read = async (who, fn, ...args) => { await as(who); return (await db.query(`select ${fn} r`, args)).rows[0].r; };

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('the fast read matches the previous read for every role and property', async () => {
  for (let who = 0; who < roles.length; who++) for (const prop of [null, props[0], props[3]]) {
    const old = await read(who, 'private.old_operations_read($1)', prop);
    assert.deepEqual(await read(who, 'public.workspace_operations_read($1)', prop), old, `${roles[who]} ${who} ${prop}`);
  }
  // The seed reaches the cases that matter: finished work, owner-limited views and a role that sees nothing extra.
  const everything = await read(0, 'public.workspace_operations_read(null)');
  assert.ok(everything.some(w => w.status === 'completed') && everything.some(w => w.status === 'cancelled'));
  assert.ok((await read(3, 'public.workspace_operations_read(null)')).length > 0);
  assert.ok((await read(4, 'public.workspace_operations_read(null)')).every(w => w.kind === 'maintenance'));
});

test('one kind still matches the full read for that kind', async () => {
  for (let who = 0; who < roles.length; who++) for (const kind of ['maintenance', 'purchase', 'cleaning']) {
    const full = (await read(who, 'public.workspace_operations_read(null)')).filter(w => w.kind === kind);
    assert.deepEqual(await read(who, 'public.workspace_operations_read_kind(null,$1)', kind), full, `${roles[who]} ${kind}`);
  }
  await assert.rejects(read(0, "public.workspace_operations_read_kind(null,'Bad kind')"), /Choose a kind of work/);
});

test('signed-out callers cannot read and the list is not callable directly by anon', async () => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_operations_read(null)'), /permission denied/);
  await assert.rejects(db.query('select private.workspace_operations_list(null,null)'), /permission denied/);
  await db.exec('reset role');
});
