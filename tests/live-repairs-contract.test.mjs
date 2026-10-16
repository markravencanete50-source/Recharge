import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The live Repairs screens: every action they offer passes the HTTP schema and
// succeeds in the database for that role, and the stage rules match the database.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { repairStep, visitMoves, poundsToMinor, routinePlanSchema, canReportRepair, canResolveRepair, repairClosed, visitChecklist, visitFormAction, VISIT_FORM_FIRST } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { scheduleSchema } = await vite.ssrLoadModule('/lib/cleans-live.ts');
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
const roles = ['super_admin', 'stays', 'ready', 'client'];
const users = roles.map((_, i) => `b1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, STAYS, READY, OWNER] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `repairs${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('b100', 'b200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('b100', 'b200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('b100', 'b200') })]);
  await db.exec('set role authenticated');
}
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = input => rpc('workspace_operations_action', [operationsActionSchema.parse(input)]);
const repairsFor = async (property) => (await rpc('workspace_operations_read', [property])).map(o => operationViewSchema.parse(o)).filter(o => o.kind === 'maintenance');
const step = (role, repair, data) => {
  const name = repairStep(role, repair.data.phase);
  assert.ok(name, `${role} should act at ${repair.data.phase}`);
  return operation({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: repair.workId, version: repair.version, step: name, data });
};
// Monthly routine visits fall on day 1 of the month, so the schedule window starts there (a window from 14 days back missed it from the 15th).
const day = (await db.query("select current_date::text d,to_char(current_date,'YYYY-MM') m,(date_trunc('month',current_date)::date+45)::text later,date_trunc('month',current_date)::date::text earlier")).rows[0];

test('pounds are converted exactly and ambiguous amounts refused', () => {
  assert.equal(poundsToMinor('£1,240.5'), 124050); assert.equal(poundsToMinor('95'), 9500);
  for (const bad of ['', '12.345', '-3', 'abc', '1e3']) assert.equal(poundsToMinor(bad), null, bad);
  // Exact pence for amounts that floating point gets wrong, and a comma only as a thousands separator.
  for (const [text, minor] of [['19.99', 1999], ['0.29', 29], ['£1,234.50', 123450], ['1,234', 123400], ['12,345.6', 1234560], ['£0.5', 50]]) assert.equal(poundsToMinor(text), minor, text);
  for (const bad of ['1.005', '1,50', '1,5', '1,2345', ',500', '1,,000', '12,34.50', '-5', '1e3', ' ', '£']) assert.equal(poundsToMinor(bad), null, bad);
  assert.ok(canReportRepair('client') && canReportRepair('stays') && !canReportRepair('ready') && !canReportRepair('cleans'));
});

test('a repair moves from report to completion with each role acting only where offered', async () => {
  await as(ADMIN);
  const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Live repairs property' }]);
  for (const [u, kind] of [[STAYS, 'staff'], [READY, 'staff'], [OWNER, 'client']]) await rpc('workspace_assign_property', [property, users[u], kind]);

  await as(STAYS);
  await operation({ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: property, kind: 'maintenance', data: { issue: 'Kitchen tap leaking under the sink', estimatedCostMinor: poundsToMinor('185'), hazard: false } });
  let [repair] = await repairsFor(property);
  // At or over the £100 limit: management approve first, then the owner.
  assert.equal(repair.data.phase, 'management_approval');
  for (const role of ['stays', 'ready', 'client']) assert.equal(repairStep(role, 'management_approval'), null);
  await as(ADMIN);
  [repair] = await repairsFor(property);
  await step('super_admin', repair, {});
  [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'owner_approval');
  for (const role of ['stays', 'ready', 'admin']) assert.equal(repairStep(role, 'owner_approval'), null);

  await as(OWNER);
  [repair] = await repairsFor(property);
  await step('client', repair, { consent: true });

  assert.equal(repairStep('ready', 'triage'), null, 'Stays refers before Ready can act');
  await as(STAYS);
  [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'triage');
  await step('stays', repair, { troubleshooting: 'Isolated the valve with the guest', guestUpdate: 'A plumber is being arranged', readyUserId: users[READY] });

  await as(READY);
  [repair] = await repairsFor(property);
  await step('ready', repair, { repairOn: day.d, contractor: 'Example Plumbing', guestUpdate: 'The plumber visits today', visitFrom: '09:00', visitTo: '12:00' });
  [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'booked');
  await assert.rejects(step('ready', repair, { report: 'Tap replaced and tested', actualCostMinor: poundsToMinor('200'), guestUpdate: 'All fixed' }), /Increased repair cost/);
  [repair] = await repairsFor(property);
  await step('ready', repair, { report: 'Tap replaced and tested', actualCostMinor: poundsToMinor('180'), guestUpdate: 'All fixed' });
  [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'completed'); assert.equal(repairStep('ready', 'completed'), null);
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from private.workspace_domain_details where kind='maintenance_invoice' and data->>'sourceWorkId'=$1", [repair.workId])).rows[0].n, 1);
});

test('routine visits are planned, created, done by Ready and signed off by Stays', async () => {
  await as(ADMIN);
  const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Routine property' }]);
  for (const [u, kind] of [[STAYS, 'staff'], [READY, 'staff']]) await rpc('workspace_assign_property', [property, users[u], kind]);
  await as(READY);
  await rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'saveRoutinePlan', requestId: crypto.randomUUID(), propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Monthly bins and garden', checklist: ['Bins out', 'Lawn cut'], frequency: 'monthly', dayOfMonth: 1, assigneeId: users[READY], active: true })]);
  const plans = routinePlanSchema.parse(await rpc('workspace_teams_read', ['routines', null, null, null, null]));
  assert.equal(plans.length, 1);
  await rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'generateRoutineVisits', requestId: crypto.randomUUID(), period: day.m })]);
  const q = teamsReadSchema.parse({ section: 'schedule', from: day.earlier, to: day.later });
  let visit = scheduleSchema.parse(await rpc('workspace_teams_read', [q.section, q.from, q.to, null, null])).work.find(w => w.kind === 'routine_visit' && w.propertyId === property);
  assert.equal(visit.assigneeId, users[READY]);
  const move = async (role, v) => {
    const [next] = visitMoves(role, v.status);
    const input = businessWriteSchema.parse({ action: 'transitionWork', workId: v.workId, version: v.version, status: next.status, note: '', requestId: crypto.randomUUID() });
    await rpc('workspace_transition_work', [input.workId, input.version, input.status, input.note, input.requestId]);
    return scheduleSchema.parse(await rpc('workspace_teams_read', [q.section, q.from, q.to, null, null])).work.find(w => w.workId === v.workId);
  };
  visit = await move('ready', visit); assert.equal(visit.status, 'in_progress');
  // Sending the visit for review needs its visit form: the app blocks the move, and the database refuses it.
  assert.equal(visitMoves('ready', 'in_progress', false)[0].blocked, VISIT_FORM_FIRST);
  assert.equal(visitMoves('ready', 'in_progress', true)[0].blocked, undefined);
  await assert.rejects(move('ready', visit), /visit form/);
  const op = (await rpc('workspace_operations_read', [property])).map(o => operationViewSchema.parse(o)).find(o => o.workId === visit.workId);
  assert.deepEqual(visitChecklist(op), ['Bins out', 'Lawn cut'], 'the visit carries its plan checklist');
  const form = visitFormAction({ workId: visit.workId, version: visit.version, title: visit.title, data: op.data }, [{ done: true, note: '' }, { done: false, note: 'Mower needs fuel' }], 'Visited today', crypto.randomUUID());
  assert.ok('action' in form);
  await rpc('workspace_teams_action', [teamsActionSchema.parse(form.action)]);
  visit = scheduleSchema.parse(await rpc('workspace_teams_read', [q.section, q.from, q.to, null, null])).work.find(w => w.workId === visit.workId);
  visit = await move('ready', visit); assert.equal(visit.status, 'in_review');
  assert.deepEqual(visitMoves('ready', 'in_review'), [], 'Ready cannot sign off its own visit');
  await as(STAYS);
  visit = await move('stays', visit); assert.equal(visit.status, 'approved');
  visit = await move('stays', visit); assert.equal(visit.status, 'completed');
});

test('a repair still in triage is resolved without a visit, and then counts as closed', async () => {
  assert.ok(canResolveRepair('stays', 'triage') && canResolveRepair('admin', 'triage') && canResolveRepair('super_admin', 'triage'));
  for (const [role, phase] of [['ready', 'triage'], ['client', 'triage'], ['stays', 'referred'], ['stays', 'owner_approval'], ['stays', 'resolved']]) assert.ok(!canResolveRepair(role, phase), `${role} at ${phase}`);
  assert.ok(repairClosed('resolved'));
  assert.equal(operationsActionSchema.safeParse({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: crypto.randomUUID(), version: 1, step: 'resolveRepair', data: { resolution: 'Hi' } }).success, false, 'a resolution is at least five characters');
  assert.equal(operationsActionSchema.safeParse({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: crypto.randomUUID(), version: 1, step: 'resolveRepair', data: { resolution: 'Reset the boiler', cost: 1 } }).success, false, 'no extra fields');
  await as(ADMIN);
  const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Resolve property' }]);
  for (const [u, kind] of [[STAYS, 'staff'], [READY, 'staff'], [OWNER, 'client']]) await rpc('workspace_assign_property', [property, users[u], kind]);
  await as(STAYS);
  await operation({ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: property, kind: 'maintenance', data: { issue: 'Radiator cold in the hall', estimatedCostMinor: 0, hazard: false } });
  let [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'triage');
  assert.ok(canResolveRepair('stays', repair.data.phase));
  await operation({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: repair.workId, version: repair.version, step: 'resolveRepair', data: { resolution: 'Bled the radiator and the hall is warm' } });
  [repair] = await repairsFor(property);
  assert.equal(repair.data.phase, 'resolved'); assert.equal(repair.status, 'completed');
  assert.ok(repairClosed(repair.data.phase));
  assert.ok(!canResolveRepair('stays', repair.data.phase));
});
