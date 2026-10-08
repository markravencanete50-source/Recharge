import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Staff onboarding, completed: per-person progress, notifications, doing a course again, course
// files and the contracts a team member has signed.
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
const users = roles.map((_, i) => `97100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9710', '9810');
const [ADMIN, CLEANER, STAYS, CLIENT] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `onboard2${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule'),($2,'property-database')", [users[CLEANER], users[STAYS]]);
await db.query("insert into public.workspace_properties(id,name,created_by,request_id) values('97100000-0000-4000-8000-0000000000aa','Gate Flat',$1,gen_random_uuid())", [users[ADMIN]]);
await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values('97100000-0000-4000-8000-0000000000aa',$1,'cleaner',$2)", [users[CLEANER], users[ADMIN]]);
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
const { myContractsSchema, onboardingFor } = await vite.ssrLoadModule('/lib/management-live.ts');
const { trainingFileType } = await vite.ssrLoadModule('/lib/training-files.ts');
const contractText = 'You agree to follow the Recharge cleaning standards and keep guest details private.';
const notices = async who => { await db.exec('reset role'); return (await db.query('select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 order by o.id', [users[who]])).rows.map(r => r.event_type); };

test('admins see each person\'s contracts and courses; finishing tells the admins; new wording tells the person', async () => {
  await as(ADMIN);
  const contract = await act({ action: 'saveContract', title: 'Cleaner agreement', audience: ['cleans'], body: contractText, active: true });
  const course = await act({ action: 'saveCourse', title: 'Guest privacy', audience: ['cleans'], body: 'Never share guest details with anyone outside Recharge.', minutes: 5, published: true });
  await act({ action: 'setCourseRequired', courseId: course.id, required: true });
  const optional = await act({ action: 'saveCourse', title: 'Linen folding', audience: ['all'], body: 'Fold towels in thirds, then in half.', minutes: 3, published: true });
  let overview = contractsSchema.parse(await read('contracts'));
  let cleaner = overview.people.find(x => x.userId === users[CLEANER]);
  assert.deepEqual(cleaner.contracts.map(c => [c.title, Boolean(c.current)]), [['Cleaner agreement', false]]);
  assert.deepEqual(cleaner.courses.map(c => c.title), ['Guest privacy']);
  assert.deepEqual(cleaner.training.map(c => [c.title, c.required]), [['Guest privacy', true], ['Linen folding', false]]);
  assert.equal(cleaner.onboardedAt, null);
  // What a new cleaner is asked for, worked out from the same lists.
  const plan = onboardingFor('cleans', overview.contracts, coursesSchema.parse(await read('training')));
  assert.deepEqual([plan.contracts.map(c => c.title), plan.courses.map(c => c.title), plan.minutes], [['Cleaner agreement'], ['Guest privacy'], 5]);
  assert.equal(onboardingFor('stays', overview.contracts, []).nothing, true);
  assert.equal(onboardingFor('admin', overview.contracts, []), null);

  // The cleaner signs and finishes: the admin hears once.
  await as(CLEANER);
  const status = onboardingSchema.parse(await read('onboarding'));
  await act({ action: 'signContract', contractId: contract.id, version: status.contracts[0].version, signedName: 'Person One', agree: true });
  assert.deepEqual(await notices(ADMIN), []);
  await as(CLEANER);
  await act({ action: 'completeCourse', courseId: course.id });
  assert.deepEqual(await notices(ADMIN), ['onboarding.completed']);
  await as(CLEANER);
  await act({ action: 'completeCourse', courseId: optional.id });
  assert.deepEqual(await notices(ADMIN), ['onboarding.completed'], 'only once');
  await as(ADMIN);
  cleaner = contractsSchema.parse(await read('contracts')).people.find(x => x.userId === users[CLEANER]);
  assert.ok(cleaner.onboardedAt);
  assert.ok(cleaner.training.every(c => c.completedAt));

  // The cleaner reads what they signed, in its exact wording.
  await as(CLEANER);
  const signed = myContractsSchema.parse(await read('myContracts'));
  assert.deepEqual(signed.map(c => [c.title, c.version, c.signedName, c.body, c.latest]), [['Cleaner agreement', 1, 'Person One', contractText, true]]);

  // New wording to sign again closes their tools and tells them.
  await as(ADMIN);
  const current = contractsSchema.parse(await read('contracts')).contracts.find(c => c.id === contract.id);
  await act({ action: 'saveContract', contractId: contract.id, version: current.version, title: 'Cleaner agreement', audience: ['cleans'], body: contractText + ' Updated pay dates.', active: true, resignRequired: true });
  // Once when the contract was first published (their tools closed), and again now.
  assert.deepEqual(await notices(CLEANER), ['onboarding.action_needed', 'onboarding.action_needed']);
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), false);
  await as(CLEANER);
  assert.equal(myContractsSchema.parse(await read('myContracts'))[0].latest, false);
  const again = onboardingSchema.parse(await read('onboarding'));
  await act({ action: 'signContract', contractId: contract.id, version: again.contracts[0].version, signedName: 'Person One', agree: true });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
  assert.deepEqual(await notices(ADMIN), ['onboarding.completed', 'onboarding.completed']);

  // "Do it again" on a required course closes tools until it is redone.
  await as(ADMIN);
  const saved = coursesSchema.parse(await read('training')).find(c => c.id === course.id);
  await act({ action: 'saveCourse', courseId: course.id, version: saved.version, title: 'Guest privacy', audience: ['cleans'], body: 'Never share guest details. New: no photos of guests.', minutes: 5, published: true, redoRequired: true });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), false);
  assert.deepEqual((await notices(CLEANER)).at(-1), 'onboarding.action_needed');
  await as(CLEANER);
  await act({ action: 'completeCourse', courseId: course.id });
  assert.equal(await hasTool(CLEANER, 'cleaning-schedule'), true);
  // Owners and admins have no contracts to read.
  await as(CLIENT);
  assert.deepEqual(await read('myContracts'), []);
});

test('course files: admins add and remove them; people the course is for can open them', async () => {
  await as(ADMIN);
  const course = await act({ action: 'saveCourse', title: 'Laundry', audience: ['cleans'], body: 'How the laundry run works each week.', minutes: 4, published: true });
  const draft = await act({ action: 'saveCourse', title: 'Draft course', audience: ['cleans'], body: 'Not ready yet, still writing it.', minutes: 4, published: false });
  const fileId = crypto.randomUUID(), path = `courses/${course.id}/${fileId}.pdf`;
  const added = await rpc('workspace_course_file_action', [{ action: 'addFile', fileId, courseId: course.id, name: 'Laundry guide.pdf', mime: 'application/pdf', bytes: 12345, path }]);
  assert.equal(added.name, 'Laundry guide.pdf');
  await assert.rejects(rpc('workspace_course_file_action', [{ action: 'addFile', fileId: crypto.randomUUID(), courseId: course.id, name: 'x.pdf', mime: 'application/pdf', bytes: 1, path: `courses/${draft.id}/${crypto.randomUUID()}.pdf` }]), /Invalid file/);
  await assert.rejects(rpc('workspace_course_file_action', [{ action: 'addFile', fileId: crypto.randomUUID(), courseId: course.id, name: 'x.exe', mime: 'application/x-msdownload', bytes: 1, path: `courses/${course.id}/${crypto.randomUUID()}.pdf` }]));
  const draftFile = crypto.randomUUID();
  await rpc('workspace_course_file_action', [{ action: 'addFile', fileId: draftFile, courseId: draft.id, name: 'draft.pdf', mime: 'application/pdf', bytes: 10, path: `courses/${draft.id}/${draftFile}.pdf` }]);
  assert.deepEqual(coursesSchema.parse(await read('training')).find(c => c.id === course.id).files.map(f => f.name), ['Laundry guide.pdf']);

  await as(CLEANER);
  assert.equal((await rpc('workspace_course_file', [fileId])).path, path, 'the cleaner can open it, even while onboarding');
  await assert.rejects(rpc('workspace_course_file', [draftFile]), /File not found/, 'not from a draft');
  await assert.rejects(rpc('workspace_course_file_action', [{ action: 'removeFile', fileId }]), /Management access required/);
  await as(STAYS);
  await assert.rejects(rpc('workspace_course_file', [fileId]), /File not found/, 'not for another role');
  await as(ADMIN);
  assert.equal((await rpc('workspace_course_file_action', [{ action: 'removeFile', fileId }])).path, path);
  await assert.rejects(rpc('workspace_course_file', [fileId]), /File not found/);
});

test('course files are recognised by their contents, not their name', () => {
  const bytes = (...parts) => new Uint8Array(parts.flatMap(p => typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p).concat(Array(64).fill(0)));
  assert.equal(trainingFileType(bytes('%PDF-1.7'), 'guide.pdf').ext, 'pdf');
  assert.equal(trainingFileType(bytes([0xff, 0xd8, 0xff, 0xe0]), 'a.png').ext, 'jpg');
  assert.equal(trainingFileType(bytes([0, 0, 0, 0x18], 'ftypmp42'), 'clip').ext, 'mp4');
  assert.equal(trainingFileType(bytes([0, 0, 0, 0x14], 'ftypqt  '), 'clip.mov').ext, 'mov');
  assert.equal(trainingFileType(bytes([0x50, 0x4b, 3, 4], 'xxxx[Content_Types].xml word/document.xml'), 'Handbook.docx').ext, 'docx');
  assert.equal(trainingFileType(bytes([0x50, 0x4b, 3, 4], 'word/'), 'archive.zip'), null, 'a zip that isn\'t a Word document');
  assert.equal(trainingFileType(bytes('MZ'), 'setup.pdf'), null, 'a program renamed .pdf');
});
