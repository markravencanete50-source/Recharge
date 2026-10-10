import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Deleting training courses and staff agreements (contracts).
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { onboardingSchema, contractsSchema, coursesSchema } = await vite.ssrLoadModule('/lib/management-live.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'cleans', 'stays', 'client'];
const users = roles.map((_, i) => `97200000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9720', '9820');
const [ADMIN, CLEANER, STAYS] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `del${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule'),($2,'property-database')", [users[CLEANER], users[STAYS]]);
await db.query("insert into public.workspace_properties(id,name,created_by,request_id) values('97200000-0000-4000-8000-0000000000aa','Gate Flat',$1,gen_random_uuid())", [users[ADMIN]]);
await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values('97200000-0000-4000-8000-0000000000aa',$1,'cleaner',$2)", [users[CLEANER], users[ADMIN]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = section => rpc('workspace_teams_read', [section, null, null, null, null]);
const { myContractsSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const contractText = 'You agree to follow the Recharge cleaning standards and keep guest details private.';


test('deleting a course takes its completions and files with it, and frees anyone waiting on it', async () => {
  await as(ADMIN);
  const course = await act({ action: 'saveCourse', title: 'Key safe codes', audience: ['cleans'], body: 'Never write the key safe code down anywhere.', minutes: 5, published: true });
  await act({ action: 'setCourseRequired', courseId: course.id, required: true });
  await db.exec('reset role');
  await db.query("insert into private.workspace_course_files(course_id,name,mime,bytes,storage_path,created_by) values($1,'Codes.pdf','application/pdf',1000,$2,$3)", [course.id, `courses/${course.id}/${crypto.randomUUID()}.pdf`, users[ADMIN]]);
  await as(CLEANER);
  assert.equal(onboardingSchema.parse(await read('onboarding')).complete, false, 'the required course holds them up');
  await assert.rejects(act({ action: 'deleteCourse', courseId: course.id, version: 1 }), /Management access required/);
  await as(ADMIN);
  const current = coursesSchema.parse(await read('training')).find(c => c.id === course.id);
  await assert.rejects(act({ action: 'deleteCourse', courseId: course.id, version: current.version + 1 }), /changed by someone else/);
  const deleted = await act({ action: 'deleteCourse', courseId: course.id, version: current.version });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.paths.length, 1, 'the stored file is handed back for deleting');
  assert.equal(coursesSchema.parse(await read('training')).some(c => c.id === course.id), false);
  assert.equal((await act({ action: 'deleteCourse', courseId: course.id, version: current.version })).paths.length, 0, 'a second tap does nothing');
  await as(CLEANER);
  assert.equal(onboardingSchema.parse(await read('onboarding')).complete, true, 'nothing left to do');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from private.workspace_course_files where course_id=$1', [course.id])).rows[0].n, 0);
});

test('an unsigned agreement goes completely; a signed one leaves the list but the signed copy is kept', async () => {
  await as(ADMIN);
  const draft = await act({ action: 'saveContract', title: 'Ready agreement', audience: ['ready'], body: contractText, active: false });
  const signedOne = await act({ action: 'saveContract', title: 'Cleaner agreement', audience: ['cleans'], body: contractText, active: true });
  await as(CLEANER);
  await act({ action: 'signContract', contractId: signedOne.id, version: signedOne.version, signedName: 'Person 1', agree: true });
  await as(STAYS);
  await assert.rejects(act({ action: 'deleteContract', contractId: draft.id, version: draft.version }), /Management access required/);
  await as(ADMIN);
  assert.equal((await act({ action: 'deleteContract', contractId: draft.id, version: draft.version })).kept, false);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from private.workspace_contracts where id=$1', [draft.id])).rows[0].n, 0, 'gone completely');
  await as(ADMIN);
  assert.equal((await act({ action: 'deleteContract', contractId: signedOne.id, version: signedOne.version })).kept, true);
  const overview = contractsSchema.parse(await read('contracts'));
  assert.deepEqual(overview.contracts.map(c => c.title), [], 'neither is listed any more');
  await assert.rejects(act({ action: 'saveContract', contractId: signedOne.id, version: signedOne.version, title: 'Cleaner agreement', audience: ['cleans'], body: contractText, active: true }), /Contract not found/, 'it cannot be edited back into use');
  await as(CLEANER);
  const mine = myContractsSchema.parse(await read('myContracts'));
  assert.deepEqual(mine.map(c => c.title), ['Cleaner agreement'], 'the cleaner still has the copy they signed');
  const status = onboardingSchema.parse(await read('onboarding'));
  assert.equal(status.contracts.length, 0, 'nobody is asked to sign it any more');
});
