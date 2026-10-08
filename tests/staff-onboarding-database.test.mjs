import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Staff onboarding: a team member signs the contract for their role and completes the required
// training before any tool opens. Admins and owners are never gated.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { onboardingSchema, contractsSchema, coursesSchema, onboardingProgress } = await vite.ssrLoadModule('/lib/management-live.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'cleans', 'stays', 'client'];
const users = roles.map((_, i) => `97000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9700', '9800');
const [ADMIN, CLEANER, STAYS, CLIENT] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `onboard${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule'),($2,'property-database')", [users[CLEANER], users[STAYS]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = section => rpc('workspace_teams_read', [section, null, null, null, null]);
const hasTool = async (i, tool) => { await as(i); return (await db.query('select private.has_workspace_module($1) ok', [tool])).rows[0].ok; };
const contractText = 'You agree to follow the Recharge cleaning standards and keep guest details private.';

test('nothing is gated until an admin publishes a contract or a required course', async () => {
  await as(CLEANER);
  const mine = onboardingSchema.parse(await read('onboarding'));
  assert.deepEqual([mine.required, mine.complete], [false, true]);
  assert.equal(onboardingProgress(mine), 'Nothing to complete');
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
});

test('a team member signs the contract for their role and finishes required training before tools open', async () => {
  await as(CLEANER);
  await assert.rejects(act({ action: 'saveContract', title: 'Cleaner agreement', audience: ['cleans'], body: contractText, active: true }), /Management access required/);
  await as(ADMIN);
  const contract = await act({ action: 'saveContract', title: 'Cleaner agreement', audience: ['cleans'], body: contractText, active: true });
  assert.equal(contract.version, 1);
  const course = await act({ action: 'saveCourse', title: 'Turnover standards', audience: ['cleans'], body: 'Strip the beds, then work top to bottom.', minutes: 15, published: true });
  await act({ action: 'setCourseRequired', courseId: course.id, required: true });
  assert.equal(coursesSchema.parse(await read('training')).find(c => c.id === course.id).required, true);

  // The cleaner's tools are closed; the Stays member (not in the audience) keeps theirs.
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), false);
  assert.equal(await hasTool(STAYS, 'property-database'), true);
  await as(CLEANER);
  let mine = onboardingSchema.parse(await read('onboarding'));
  assert.deepEqual([mine.required, mine.complete, mine.contracts.length, mine.courses.length], [true, false, 1, 1]);
  assert.equal(mine.contracts[0].body, contractText);
  assert.equal(onboardingProgress(mine), 'Contract 0/1 · Training 0/1');
  // Training still opens while the tools are closed.
  assert.equal(coursesSchema.parse(await read('training')).length, 1);

  assert.throws(() => teamsActionSchema.parse({ action: 'signContract', requestId: crypto.randomUUID(), contractId: contract.id, version: 1, signedName: 'Person 1', agree: false }), /Tick the box/);
  await assert.rejects(act({ action: 'signContract', contractId: contract.id, version: 2, signedName: 'Person 1', agree: true }), /just been updated/);
  await act({ action: 'signContract', contractId: contract.id, version: 1, signedName: 'Person One', agree: true });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), false, 'training is still to do');
  await as(CLEANER);
  await act({ action: 'completeCourse', courseId: course.id });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
  await as(CLEANER);
  mine = onboardingSchema.parse(await read('onboarding'));
  assert.deepEqual([mine.complete, onboardingProgress(mine)], [true, 'Onboarding complete']);

  // Admins see who has signed and how far each team member has got.
  await as(STAYS);
  await assert.rejects(read('contracts'), /Management access required/);
  await assert.rejects(act({ action: 'signContract', contractId: contract.id, version: 1, signedName: 'Person 2', agree: true }), /Contract not available/);
  await as(CLIENT);
  await assert.rejects(act({ action: 'signContract', contractId: contract.id, version: 1, signedName: 'Owner', agree: true }), /Only team members/);
  await as(ADMIN);
  const overview = contractsSchema.parse(await read('contracts'));
  assert.deepEqual(overview.contracts[0].signatures.map(s => s.signedName), ['Person One']);
  assert.deepEqual(overview.people.map(x => [x.fullName, x.complete]), [['Person 1', true], ['Person 2', true]]);
});

test('new wording asks everyone to sign again only when the admin says so', async () => {
  await as(ADMIN);
  let [contract] = contractsSchema.parse(await read('contracts')).contracts;
  // A typo fix: a new version, but existing signatures still count.
  contract = await act({ action: 'saveContract', contractId: contract.id, version: contract.version, title: contract.title, audience: ['cleans'], body: contractText + ' Thank you.', active: true });
  assert.equal(contract.version, 2);
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
  // Switching it off and on alone keeps the version.
  await as(ADMIN);
  assert.equal((await act({ action: 'saveContract', contractId: contract.id, version: 2, title: contract.title, audience: ['cleans'], body: contractText + ' Thank you.', active: true })).version, 2);
  await assert.rejects(act({ action: 'saveContract', contractId: contract.id, version: 1, title: contract.title, audience: ['cleans'], body: contractText, active: true }), /Contract changed/);
  // A real change everyone must sign again.
  contract = await act({ action: 'saveContract', contractId: contract.id, version: 2, title: contract.title, audience: ['all'], body: contractText + ' Pay is weekly.', active: true, resignRequired: true });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), false);
  assert.equal(await hasTool(STAYS, 'property-database'), false, '"all" now includes Stays');
  assert.equal(await hasTool(ADMIN, 'property-database'), true, 'admins are never gated');
  assert.equal(await hasTool(CLIENT, 'client-dashboard'), false, 'owners keep only their own tools');
  await as(CLEANER);
  const mine = onboardingSchema.parse(await read('onboarding'));
  assert.deepEqual([mine.contracts[0].signedVersion, mine.contracts[0].current, mine.contracts[0].resignRequired], [1, false, true]);
  await act({ action: 'signContract', contractId: contract.id, version: 3, signedName: 'Person One', agree: true });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
  // Switching the contract off lifts the gate for everyone else.
  await as(ADMIN);
  await act({ action: 'saveContract', contractId: contract.id, version: 3, title: contract.title, audience: ['all'], body: contractText + ' Pay is weekly.', active: false });
  assert.equal(await hasTool(STAYS, 'property-database'), true);
});
