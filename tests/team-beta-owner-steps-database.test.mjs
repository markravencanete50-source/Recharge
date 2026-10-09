import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Team beta: the app is told when owner accounts are off, and the team records an owner's answer on a
// repair cost, with how the owner gave it. An owner with an account still answers for themselves.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { workspaceAccountSchema } = await vite.ssrLoadModule('/lib/workspace-account-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'ready', 'client'];
const users = roles.map((_, i) => `97300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, STAYS, READY, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9730', '9830');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `beta-owner${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
// Every action goes through the HTTP schema first, as the route does.
const ops = input => rpc('workspace_operations_action', [operationsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const step = (w, name, data) => ops({ action: 'updateOperation', workId: w.workId, version: w.version, step: name, data });
const beta = on => owner('update private.workspace_beta_mode set team_only=$1', [on]);
after(async () => { await db.close(); await vite.close(); });

await as(ADMIN);
const hostawayFlat = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Old Hostaway flat' }]);
const ownedFlat = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Owned flat' }]);
for (const target of [hostawayFlat, ownedFlat]) for (const [user, kind] of [[STAYS, 'staff'], [READY, 'staff']]) await rpc('workspace_assign_property', [target, users[user], kind]);
await rpc('workspace_assign_property', [ownedFlat, users[OWNER], 'client']);
const repair = async (target, issue = 'Boiler pressure keeps dropping') => { await as(STAYS); return ops({ action: 'createOperation', propertyId: target, kind: 'maintenance', data: { issue, estimatedCostMinor: 18000, hazard: false, repairType: 'heating' } }); };

test('the account says whether owner accounts are off', async () => {
  await as(STAYS);
  assert.equal(workspaceAccountSchema.parse(await rpc('workspace_account')).teamOnly, false);
  await beta(true); await as(STAYS);
  assert.equal(workspaceAccountSchema.parse(await rpc('workspace_account')).teamOnly, true);
  await beta(false);
});

test('a property with no owner account: Stays record the owner\'s approval and how it was given', async () => {
  let r = await repair(hostawayFlat);
  assert.equal(r.data.phase, 'owner_approval', 'no limit on file, so the owner is asked');
  await assert.rejects(step(r, 'approveBudget', { consent: true }), /ownerAgreement|between 5/, 'how the owner agreed is required');
  await as(READY); await assert.rejects(step(r, 'approveBudget', { consent: true, ownerAgreement: 'By phone with the owner' }), /owner spending consent/);
  await as(STAYS);
  r = await step(r, 'approveBudget', { consent: true, ownerAgreement: 'By phone with the owner, 9 Oct' });
  assert.equal(r.data.phase, 'triage');
  assert.equal(r.data.ownerAgreement, 'By phone with the owner, 9 Oct');
  assert.equal(r.data.ownerApprovalRecordedBy, users[STAYS]);
  const declined = await step(await repair(hostawayFlat, 'Shower tray cracked across'), 'declineBudget', { reason: 'Owner wants a second quote' });
  assert.equal(declined.data.phase, 'owner_declined');
});

test('an owner with an account answers for themselves, unless the beta is on', async () => {
  let r = await repair(ownedFlat);
  await assert.rejects(step(r, 'approveBudget', { consent: true, ownerAgreement: 'By phone with the owner' }), /owner spending consent/);
  await assert.rejects(step(r, 'declineBudget', { reason: 'Owner said no' }), /Only the owner/);
  await as(OWNER);
  await assert.rejects(step(r, 'approveBudget', { consent: true, ownerAgreement: 'Myself' }), /owner spending consent/, 'an owner just approves');
  r = await step(r, 'approveBudget', { consent: true });
  assert.equal(r.data.phase, 'triage');
  await beta(true);
  const other = await repair(ownedFlat, 'Extractor fan stopped working');
  const approved = await step(other, 'approveBudget', { consent: true, ownerAgreement: 'Email from the owner today' });
  assert.equal(approved.data.phase, 'triage');
  await beta(false);
});
