import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The live People, Properties and owner screens send these exact requests and
// parse these exact responses. Run them through the HTTP schemas and the database.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/admin-live.ts');
const { adminActionSchema, adminReadSchema } = await vite.ssrLoadModule('/lib/workspace-admin-policy.ts');
const { businessWriteSchema } = await vite.ssrLoadModule('/lib/business-policy.ts');
const { defaultModulesForRole } = await vite.ssrLoadModule('/lib/modules.ts');
const { statementSchema } = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { scheduleSchema } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { financeReadSchema } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });
const names = ['super', 'admin', 'newcomer', 'owner', 'other admin'];
const users = names.map((_, i) => `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, NEWCOMER, OWNER, OTHER_ADMIN] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `admin${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
}
for (const [i, role] of [[SUPER, 'super_admin'], [ADMIN, 'admin'], [OTHER_ADMIN, 'admin']]) {
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], role, names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('e100', 'e200') })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const read = section => rpc('workspace_admin_read', [adminReadSchema.parse({ section }).section]);
const save = input => rpc('workspace_admin_action', [adminActionSchema.parse({ action: 'saveAccess', ...input })]);
const workspace = input => businessWriteSchema.parse(input);

test('people: a pending request is approved, assigned a property and revoked', async () => {
  // A new person signs up and asks for Stays access.
  await as(NEWCOMER);
  await rpc('workspace_request_access', ['New Person', 'stays']);
  await as(OWNER);
  await rpc('workspace_request_access', ['Owner Person', 'client']);

  await as(NEWCOMER);
  await assert.rejects(read('people'), /Admin access required/);
  await as(ADMIN);
  let people = live.peopleSchema.parse(await read('people'));
  assert.equal(people[0].status, 'pending', 'pending requests come first');
  const newcomer = people.find(p => p.userId === users[NEWCOMER]);
  assert.equal(newcomer.role, 'stays'); assert.equal(newcomer.emailVerified, true);

  // Approve with the role's default tools, as the screen pre-fills them.
  const modules = live.toolsOnRoleChange('stays');
  assert.deepEqual(modules, defaultModulesForRole('stays'));
  const approved = await save({ userId: users[NEWCOMER], fullName: 'New Person', role: 'stays', status: 'active', modules, responsibilities: 'Guest stays for the north region' });
  assert.equal(approved.status, 'active');

  // Properties: create, assign with the role's assignment kind, edit, archive.
  const create = workspace({ action: 'saveProperty', input: { requestId: crypto.randomUUID(), name: 'Admin test flat', address: '1 High Street', region: 'North', bedrooms: 2, status: 'onboarding' } });
  const propertyId = await rpc('workspace_save_property', [create.input]);
  assert.equal(live.assignmentFor('stays'), 'staff');
  const assign = workspace({ action: 'assignProperty', propertyId, userId: users[NEWCOMER], assignment: live.assignmentFor('stays') });
  await rpc('workspace_assign_property', [assign.propertyId, assign.userId, assign.assignment]);
  await assert.rejects(rpc('workspace_assign_property', [propertyId, users[NEWCOMER], 'client']), /matching assignment/);

  people = live.peopleSchema.parse(await read('people'));
  assert.deepEqual(people.find(p => p.userId === users[NEWCOMER]).assignments.map(a => [a.propertyName, a.assignment]), [['Admin test flat', 'staff']]);
  let properties = live.adminPropertiesSchema.parse(await read('properties'));
  let flat = properties.find(p => p.id === propertyId);
  assert.deepEqual(flat.people.map(p => p.fullName), ['New Person']);
  const edit = workspace({ action: 'saveProperty', input: { id: propertyId, version: flat.version, name: 'Admin test flat', address: '1 High Street', region: 'North', bedrooms: 3, status: 'active' } });
  await rpc('workspace_save_property', [edit.input]);
  await rpc('workspace_save_property_details', [propertyId, flat.version + 1, 'access', { accessInstructions: 'Key safe 1234' }]);
  properties = live.adminPropertiesSchema.parse(await read('properties'));
  flat = properties.find(p => p.id === propertyId);
  assert.equal(flat.bedrooms, 3); assert.equal(flat.status, 'active'); assert.equal(flat.version, 3);
  assert.deepEqual(live.detailSchemas.access.parse(await rpc('workspace_property_details', [propertyId, 'access'])), { accessInstructions: 'Key safe 1234' });

  // Unassign, then revoke.
  const unassign = workspace({ action: 'unassignProperty', propertyId, userId: users[NEWCOMER] });
  await rpc('workspace_unassign_property', [unassign.propertyId, unassign.userId]);
  const revoked = await save({ userId: users[NEWCOMER], fullName: 'New Person', role: 'stays', status: 'revoked', modules, responsibilities: '' });
  assert.equal(revoked.status, 'revoked');
  await as(NEWCOMER);
  await assert.rejects(rpc('workspace_operations_read', [null]), /Active|access/i);
});

test('people: the role hierarchy and tool limits are enforced', async () => {
  assert.equal(live.canEdit('admin', { role: 'admin' }), false);
  assert.equal(live.canEdit('super_admin', { role: 'admin' }), true);
  assert.equal(live.rolesFor('admin').includes('admin'), false);
  await as(ADMIN);
  await assert.rejects(save({ userId: users[OTHER_ADMIN], fullName: 'other admin', role: 'stays', status: 'active', modules: ['listing-health'], responsibilities: '' }), /Only a super admin/);
  assert.equal(adminActionSchema.safeParse({ action: 'saveAccess', userId: users[NEWCOMER], fullName: 'Cleaner', role: 'cleans', status: 'active', modules: ['owner-statements'] }).success, false);
  assert.equal(adminActionSchema.safeParse({ action: 'saveAccess', userId: users[NEWCOMER], fullName: 'Nobody', role: 'stays', status: 'active', modules: [] }).success, false);
  await as(SUPER);
  await assert.rejects(save({ userId: users[SUPER], fullName: 'super', role: 'admin', status: 'active', modules: [], responsibilities: '' }), /Another super admin/);
});

test('owners: an owner sees their issued statements and stays', async () => {
  await as(SUPER);
  const propertyId = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Owner flat', status: 'active' }]);
  assert.ok(defaultModulesForRole('client').includes('owner-statements'), 'owners get statements by default');
  await save({ userId: users[OWNER], fullName: 'Owner Person', role: 'client', status: 'active', modules: live.toolsOnRoleChange('client'), responsibilities: '' });
  await rpc('workspace_assign_property', [propertyId, users[OWNER], live.assignmentFor('client')]);
  // A stay this month, recorded and reconciled as a direct booking, then a statement issued.
  const day = (await db.query("select to_char(current_date,'YYYY-MM') m,(date_trunc('month',current_date))::date::text first,(date_trunc('month',current_date)+interval '2 days')::date::text out")).rows[0];
  await rpc('workspace_operations_action', [{ action: 'recordReservation', requestId: crypto.randomUUID(), propertyId, reference: 'Owner stay', checkIn: day.first, checkOut: day.out, status: 'confirmed' }]);
  const reservation = (await rpc('workspace_controls_read', ['reservations', propertyId, null])).find(r => r.reference === 'Owner stay');
  await rpc('workspace_finance_action', [{ action: 'setReservationFinancials', requestId: crypto.randomUUID(), propertyId, reservationId: reservation.id, version: reservation.version, channel: 'direct', guests: 2, payoutMinor: 30000 }]);
  await rpc('workspace_finance_action', [{ action: 'setStatementTerms', requestId: crypto.randomUUID(), propertyId, managementFeeBps: 1500, cleaningCostMinor: 4000 }]);
  const draft = await rpc('workspace_finance_action', [{ action: 'prepareStatement', requestId: crypto.randomUUID(), propertyId, period: day.m }]);

  await as(OWNER);
  const q = financeReadSchema.parse({ section: 'statements', propertyId });
  assert.equal((await rpc('workspace_finance_read', [q.section, q.propertyId, null, null, null])).length, 0, 'drafts stay private');
  await as(SUPER);
  await rpc('workspace_finance_action', [{ action: 'issueStatement', requestId: crypto.randomUUID(), statementId: draft.id, version: draft.version }]);
  await as(OWNER);
  const statements = (await rpc('workspace_finance_read', ['statements', null, null, null, null])).map(s => statementSchema.parse(s));
  assert.equal(statements.length, 1); assert.equal(statements[0].status, 'issued'); assert.equal(statements[0].payoutMinor, 30000 - 4500);
  const schedule = scheduleSchema.parse(await rpc('workspace_teams_read', ['schedule', day.first, day.out, null, null]));
  assert.equal(schedule.stays.length, 1);
  assert.equal(schedule.stays[0].guests, 2);
});
