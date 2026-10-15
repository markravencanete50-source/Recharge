import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The live Cleans screens send these exact actions and parse these exact
// responses. Run them through the HTTP schemas and the real database functions.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { scheduleSchema, performanceSchema, candidatesSchema } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { businessWriteSchema } = await vite.ssrLoadModule('/lib/business-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { operationViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });
const roles = ['super_admin', 'cleaning_manager', 'cleans'];
const users = roles.map((_, i) => `a1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, CLEANER] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `cleans${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('a100', 'a200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('a100', 'a200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('a100', 'a200') })]);
  await db.exec('set role authenticated');
}
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
// Each request passes the HTTP schema first, exactly as the endpoint does.
const operation = input => { const parsed = operationsActionSchema.parse(input); return rpc('workspace_operations_action', [parsed]); };
const teams = input => rpc('workspace_teams_action', [teamsActionSchema.parse(input)]);
const read = (query) => { const q = teamsReadSchema.parse(query); return rpc('workspace_teams_read', [q.section, q.from ?? null, q.to ?? null, q.propertyId ?? null, q.userId ?? null]); };
const today = (await db.query("select current_date::text d,(current_date+28)::text later,(current_date-7)::text earlier")).rows[0];

test('the live Cleans flow parses every response and passes every request schema', async () => {
  await as(ADMIN);
  const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Live cleans property' }]);
  await rpc('workspace_assign_property', [property, users[MANAGER], 'cleaning_manager']);
  await rpc('workspace_assign_property', [property, users[CLEANER], 'cleaner']);

  // Manager: New clean, then the candidate list, then Assign.
  await as(MANAGER);
  const created = await operation({ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: property, kind: 'cleaning', data: { dueOn: today.d, checklist: ['Kitchen', 'Wi-Fi and broadband working'] } });
  const candidates = candidatesSchema.parse(await rpc('workspace_controls_read', ['resources', property, created.workId])).filter(c => c.role === 'cleans');
  assert.deepEqual(candidates.map(c => c.userId), [users[CLEANER]]);
  const assign = businessWriteSchema.parse({ action: 'assignWork', workId: created.workId, version: created.version, userId: users[CLEANER] });
  await rpc('workspace_assign_work', [assign.workId, assign.version, assign.userId]);

  // Cleaner: own schedule and the job's checklist.
  await as(CLEANER);
  const schedule = scheduleSchema.parse(await read({ section: 'schedule', from: today.earlier, to: today.later, userId: users[CLEANER] }));
  const row = schedule.work.find(w => w.workId === created.workId);
  assert.equal(row.kind, 'cleaning'); assert.equal(row.assigneeId, users[CLEANER]); assert.equal(row.dueOn, today.d);
  const ops = (await rpc('workspace_operations_read', [property])).map(o => operationViewSchema.parse(o));
  let job = ops.find(o => o.workId === created.workId);
  assert.deepEqual(job.data.checklist, ['Kitchen', 'Wi-Fi and broadband working']);
  await assert.rejects(read({ section: 'schedule', from: today.earlier, to: today.later, userId: users[MANAGER] }), /Schedule access denied/);

  // Cleaner: submit with a verified photo (stored by the upload service in production).
  await db.exec('reset role');
  const photo = (await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning','TEST-ONLY-live-clean',now()) returning id", [property, created.workId, users[CLEANER]])).rows[0].id;
  await as(CLEANER);
  job = await operation({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: job.workId, version: job.version, step: 'submitCleaning', data: { checks: job.data.checklist, report: 'Kitchen cleaned, Wi-Fi tested', photoIds: [photo], mailAction: 'none' } });
  assert.equal(job.status, 'in_review');

  // Manager: reject, which opens a complaint the cleaner can answer.
  await as(MANAGER);
  await operation({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: job.workId, version: job.version, step: 'reviewCleaning', data: { accepted: false, redoBy: new Date(Date.now() + 3600000).toISOString(), guestFeedback: 'Guest found crumbs', reviewNote: 'Counter missed' } });
  const team = performanceSchema.parse(await read({ section: 'performance' }));
  assert.equal(team.find(r => r.cleanerId === users[CLEANER]).rejected, 1);

  await as(CLEANER);
  const mine = performanceSchema.parse(await read({ section: 'performance' }))[0];
  assert.equal(mine.openComplaints.length, 1);
  await teams({ action: 'addCleanerStatement', requestId: crypto.randomUUID(), workId: mine.openComplaints[0].workId, statement: 'Photos show the counter wiped clean' });
  const after = performanceSchema.parse(await read({ section: 'performance' }))[0];
  assert.equal(after.openComplaints[0].cleanerStatement, 'Photos show the counter wiped clean');
});

test('the screen refuses to build a submission the server would reject', () => {
  const base = { action: 'updateOperation', requestId: crypto.randomUUID(), workId: crypto.randomUUID(), version: 1, step: 'submitCleaning' };
  assert.equal(operationsActionSchema.safeParse({ ...base, data: { checks: ['Kitchen'], report: 'Done', photoIds: [], mailAction: 'none' } }).success, false, 'needs a photo');
  assert.equal(operationsActionSchema.safeParse({ ...base, data: { checks: ['Kitchen'], report: 'Cleaned', photoIds: [crypto.randomUUID()] } }).success, false, 'needs mailAction');
  assert.ok(operationsActionSchema.safeParse({ ...base, data: { checks: ['Kitchen'], report: 'Cleaned', photoIds: [crypto.randomUUID()], mailAction: 'none' } }).success);
});
