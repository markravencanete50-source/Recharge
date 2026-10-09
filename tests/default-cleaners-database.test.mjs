import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Each property's usual cleaner: who may choose one, cleans going to them automatically (by hand or
// from a Hostaway stay), and nothing going to a cleaner who has lost access.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, defaultCleanersSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { cleanConditionSchema, purchaseFromClean, repairFromClean, cleanAnswers } = await vite.ssrLoadModule('/lib/clean-report.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'cleaning_manager', 'cleaning_manager', 'stays', 'cleans', 'cleans', 'cleans'];
const users = roles.map((_, i) => `97200000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, OTHER_MANAGER, STAYS, ANGELA, BEN, NO_TOOL] = roles.map((_, i) => i);
const session = i => users[i].replace('9720', '9820');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `defaults${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  if (i !== NO_TOOL) await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const setDefault = (propertyId, cleanerId) => rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'setDefaultCleaner', requestId: crypto.randomUUID(), propertyId, cleanerId })]);
const read = async () => defaultCleanersSchema.parse(await rpc('workspace_teams_read', ['defaultCleaners', null, null, null, null]));
const assignee = async workId => (await owner('select assignee_id from public.workspace_work_items where id=$1', [workId]))[0].assignee_id;
const today = (await db.query('select current_date::text d')).rows[0].d;
const yesterday = (await db.query("select (current_date-1)::text d")).rows[0].d;

await as(ADMIN);
const flat = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Address Drive flat' }]);
const lodge = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Other lodge' }]);
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [BEN, 'cleaner']]) await rpc('workspace_assign_property', [flat, users[user], kind]);
await rpc('workspace_assign_property', [lodge, users[OTHER_MANAGER], 'cleaning_manager']);
after(async () => { await db.close(); await vite.close(); });

async function clean(target = flat, dueOn = today) {
  await as(MANAGER);
  return operation({ action: 'createOperation', propertyId: target, kind: 'cleaning', data: { dueOn, checklist: ['Kitchen'] } });
}

test('an admin chooses the usual cleaner, who gets the property and its open upcoming cleans', async () => {
  const waiting = await clean(), past = await clean(flat, yesterday), taken = await clean();
  await as(MANAGER); await rpc('workspace_assign_work', [taken.workId, taken.version, users[BEN]]);
  await as(ADMIN);
  const done = await setDefault(flat, users[ANGELA]);
  assert.equal(done.assignedCleans, 1);
  assert.equal(await assignee(waiting.workId), users[ANGELA]);
  assert.equal(await assignee(past.workId), null, 'past cleans are left alone');
  assert.equal(await assignee(taken.workId), users[BEN], 'a clean someone has keeps them');
  assert.equal((await owner("select assignment from public.workspace_property_assignments where property_id=$1 and user_id=$2", [flat, users[ANGELA]]))[0].assignment, 'cleaner');
  const row = (await read()).properties.find(p => p.propertyId === flat);
  assert.equal(row.cleanerName, 'Person 4'); assert.equal(row.canEdit, true);
});

test('new cleans go to the usual cleaner, by hand or from a Hostaway stay', async () => {
  const made = await clean();
  assert.equal(await assignee(made.workId), users[ANGELA]);
  const fromStay = (await owner(`select private.workspace_handover($1,'cleaning-schedule','Checkout clean','cleaning',jsonb_build_object('dueOn',current_date+3,'checklist',jsonb_build_array('Kitchen'),'phase','assigned','workStatus','waiting','source','hostaway')) id`, [flat]))[0].id;
  assert.equal(await assignee(fromStay), users[ANGELA]);
  await as(OTHER_MANAGER);
  const elsewhere = await operation({ action: 'createOperation', propertyId: lodge, kind: 'cleaning', data: { dueOn: today, checklist: ['Kitchen'] } });
  assert.equal(await assignee(elsewhere.workId), null, 'no usual cleaner, nobody assigned');
  // Angela can see and do her clean.
  await as(ANGELA);
  assert.ok((await rpc('workspace_operations_read', [null])).some(w => w.workId === made.workId));
});

test('only admins and the property\'s cleaning manager choose; a manager picks from cleaners already on it', async () => {
  await as(MANAGER);
  const done = await setDefault(flat, users[BEN]);
  assert.equal(done.cleanerId, users[BEN]);
  await as(ADMIN); await setDefault(lodge, null);
  await as(MANAGER);
  await assert.rejects(setDefault(lodge, users[BEN]), /cleaning manager can choose/);
  await as(OTHER_MANAGER);
  await assert.rejects(setDefault(lodge, users[BEN]), /admin to give this cleaner the property/);
  await assert.rejects(setDefault(flat, users[BEN]), /cleaning manager can choose/);
  for (const who of [STAYS, ANGELA]) { await as(who); await assert.rejects(setDefault(flat, users[ANGELA]), /cleaning manager can choose/); }
  await as(ADMIN);
  await assert.rejects(setDefault(flat, users[NO_TOOL]), /active cleaner with the Cleans tool/);
  await assert.rejects(setDefault(flat, users[STAYS]), /active cleaner with the Cleans tool/);
  await as(STAYS);
  const seen = await read();
  assert.equal(seen.properties.find(p => p.propertyId === flat).canEdit, false, 'Stays can see who cleans, not change it');
  assert.ok(seen.cleaners.some(c => c.userId === users[BEN]));
});

test('a cleaner who loses access gets nothing new, and clearing stops it', async () => {
  await owner("update public.workspace_profiles set status='revoked' where user_id=$1", [users[BEN]]);
  assert.equal(await assignee((await clean()).workId), null);
  await as(ADMIN);
  assert.equal((await read()).properties.find(p => p.propertyId === flat).cleanerId, null);
  await owner("update public.workspace_profiles set status='active' where user_id=$1", [users[BEN]]);
  await as(MANAGER); await setDefault(flat, null);
  assert.equal(await assignee((await clean()).workId), null);
  assert.throws(() => teamsActionSchema.parse({ action: 'setDefaultCleaner', requestId: crypto.randomUUID(), propertyId: flat }), 'the route needs a cleaner or null');
});
