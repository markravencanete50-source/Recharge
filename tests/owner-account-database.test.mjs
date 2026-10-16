import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Proceed makes the owner's app account (migration 20261020880000): the server asks the database who, makes the sign-in
// when there is none, links it (an active owner with the owner tools and the property) and claims the email, so a double
// press or a retry never makes two accounts or sends two emails. The team sees whether it went and can send it again.
const MINE = '20261020880000_proceed_owner_account.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_owner_account(jsonb)', 'private.workspace_estimate_public(jsonb)', 'private.workspace_journey_view(private.workspace_journeys)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();
after(() => db.close());

const users = ['33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000003', '33000000-0000-4000-8000-000000000004', '33000000-0000-4000-8000-000000000005'];
const roles = ['super_admin', 'stays', 'cleans', 'stays', 'client'];
const [ADMIN, STAYS, CLEANER, OTHER_STAYS, OWNER] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  const id = users[i], session = id.replace('33000000', '43000000');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `account${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session, id]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [id, roles[i], 'Person ' + i]);
  if (i !== OTHER_STAYS) for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [id, m]);
}
// Each step starts a fresh minute of the write limit (60 changes a minute per person), as in the other database tests:
// since 20261022400000 an enquiry the team adds is also a Client enquiries row, which counts too.
async function as(i) { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('33000000', '43000000') })]); await db.exec('set role authenticated'); }
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const journey = async input => (await db.query('select public.workspace_journey_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const read = async (i, propertyId) => { await as(i); return (await db.query('select public.workspace_journey_read($1) result', [propertyId])).rows[0].result[0]; };
const pub = async input => { await asBackend(); return (await db.query('select public.workspace_estimate_public($1::jsonb) result', [JSON.stringify(input)])).rows[0].result; };
const server = async input => { await asBackend(); return (await db.query('select public.workspace_owner_account($1::jsonb) result', [JSON.stringify(input)])).rows[0].result; };
const team = async (i, input) => { await as(i); return (await db.query('select public.workspace_owner_account($1::jsonb) result', [JSON.stringify(input)])).rows[0].result; };
const hash = n => n.toString(16).padStart(64, '0');
const estimate = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' };
let tokens = 100;
// An enquiry, its published estimate and its link; the team (stays) is assigned so they may follow it.
async function enquiryWithLink(name, contact) {
  await as(ADMIN);
  let j = await journey({ action: 'createEnquiry', name, address: '1 Test Street, Glasgow', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, enquiry: contact });
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate });
  await sql("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3) on conflict do nothing", [j.propertyId, users[STAYS], users[ADMIN]]);
  const tokenHash = hash(tokens++);
  await as(ADMIN);
  await db.query('select public.workspace_estimate_link_action($1::jsonb)', [JSON.stringify({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash, delivery: 'link' })]);
  return { j, tokenHash };
}
// What the sign-in service does on createUser: the account, and (by trigger) its pending owner profile.
async function signUp(email, confirmed = true) {
  const id = crypto.randomUUID();
  await sql('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,$4)', [id, email, JSON.stringify({ full_name: '' }), confirmed ? new Date().toISOString() : null]);
  return id;
}

test('the migration runs twice without change', () => {
  assert.deepEqual(secondRun, firstRun);
  assert.match(firstRun[1], /l\.decision is distinct from 'proceed'\)/);
  assert.match(firstRun[2], /'ownerAccountEmail'/);
});

test('before Proceed nothing happens; Proceed then makes one account, links it and claims one email', async () => {
  const { j, tokenHash } = await enquiryWithLink('Proceed flat', { contactName: 'Morag Example', email: 'Morag@Example.com' });
  assert.equal((await server({ action: 'prepare', tokenHash })).state, 'none', 'not decided yet');
  await assert.rejects(team(STAYS, { action: 'prepare', propertyId: j.propertyId }), /once the owner chooses Proceed/);
  assert.equal((await pub({ action: 'decide', tokenHash, decision: 'proceed', feedback: '' })).state, 'proceeding');

  const ready = await server({ action: 'prepare', tokenHash });
  assert.deepEqual([ready.state, ready.email, ready.name, ready.userId, ready.propertyName], ['ready', 'morag@example.com', 'Morag Example', null, 'Proceed flat']);
  const id = await signUp('morag@example.com');
  const claimed = await server({ action: 'link', tokenHash, userId: id, created: true });
  assert.deepEqual([claimed.send, claimed.kind, claimed.email, claimed.name, claimed.attempt], [true, 'welcome', 'morag@example.com', 'Morag Example', 1]);

  const [profile] = await sql('select role,status,full_name from public.workspace_profiles where user_id=$1', [id]);
  assert.deepEqual(profile, { role: 'client', status: 'active', full_name: 'Morag Example' });
  const tools = (await sql('select module_id from public.workspace_module_grants where user_id=$1 order by 1', [id])).map(r => r.module_id);
  assert.deepEqual(tools, ['client-dashboard', 'client-furnishing', 'client-mailbox', 'client-property-maintenance', 'client-purchase-order-quotes', 'owner-statements', 'property-onboarding']);
  assert.equal((await sql('select client_id from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].client_id, id);
  assert.deepEqual(await sql("select assignment,granted_by from public.workspace_property_assignments where property_id=$1 and user_id=$2", [j.propertyId, id]), [{ assignment: 'client', granted_by: users[ADMIN] }]);

  // A double press or a retry: the email is already claimed, then sent; nothing is made twice.
  assert.equal((await server({ action: 'link', tokenHash, userId: id, created: false })).send, false);
  const again = await server({ action: 'prepare', tokenHash });
  assert.equal(again.userId, id, 'a retry finds the account it made');
  assert.equal((await server({ action: 'markEmail', tokenHash, emailStatus: 'sent' })).emailStatus, 'sent');
  assert.equal((await server({ action: 'prepare', tokenHash })).state, 'done');
  assert.equal((await server({ action: 'markEmail', tokenHash, emailStatus: 'failed' })).emailStatus, 'sent', 'only a claimed email is marked');
  assert.equal((await sql("select count(*)::int n from auth.users where lower(email)='morag@example.com'"))[0].n, 1);

  // The link still opens for the client, and the owner can see their property in the app.
  assert.equal((await pub({ action: 'open', tokenHash })).state, 'proceeding');
  const mine = await (async () => { await db.exec('reset role'); await sql('insert into auth.sessions(id,user_id) values($1,$1)', [id]); await sql('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$1)', [id]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: id })]); await db.exec('set role authenticated');
    return (await db.query('select public.workspace_journey_read($1) result', [j.propertyId])).rows[0].result[0]; })();
  assert.equal(mine.ownerAccount, true);
  assert.equal(mine.ownerAccountEmail, null, 'the owner does not see the team’s note');

  const seen = await read(STAYS, j.propertyId);
  assert.deepEqual([seen.ownerAccountEmail.status, seen.ownerAccountEmail.kind, seen.ownerAccountEmail.email, seen.ownerAccountEmail.createdAccount, seen.ownerAccountEmail.attempts], ['sent', 'welcome', 'morag@example.com', true, 1]);
});

test('the team sends it again: once per request, and a failure shows', async () => {
  const [{ property_id: propertyId }] = await sql("select property_id from private.workspace_owner_accounts where email='morag@example.com'");
  const requestId = crypto.randomUUID();
  const ready = await team(STAYS, { action: 'prepare', propertyId, requestId });
  assert.equal(ready.state, 'ready');
  const claimed = await team(STAYS, { action: 'link', propertyId, requestId, userId: ready.userId, created: false });
  assert.deepEqual([claimed.send, claimed.kind, claimed.attempt], [true, 'welcome', 2], 'still the choose-your-password email');
  assert.equal((await team(STAYS, { action: 'markEmail', propertyId, requestId, emailStatus: 'failed' })).emailStatus, 'failed');
  assert.equal((await team(STAYS, { action: 'link', propertyId, requestId, userId: ready.userId, created: false })).send, false, 'the same request is not sent twice');
  assert.equal((await read(ADMIN, propertyId)).ownerAccountEmail.status, 'failed');
  const next = crypto.randomUUID();
  assert.equal((await team(ADMIN, { action: 'link', propertyId, requestId: next, userId: ready.userId, created: false })).send, true);
  assert.equal((await team(ADMIN, { action: 'markEmail', propertyId, requestId: next, emailStatus: 'sent' })).emailStatus, 'sent');
  for (const who of [CLEANER, OTHER_STAYS, OWNER]) await assert.rejects(team(who, { action: 'prepare', propertyId }), /Onboarding access denied/);
  await assert.rejects(team(STAYS, { action: 'link', propertyId, userId: users[OWNER], created: false }), /does not match/);
  await assert.rejects(team(STAYS, { action: 'prepare', propertyId, extra: 1 }), /Unknown or oversized/);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_owner_account($1::jsonb)', [JSON.stringify({ action: 'prepare', tokenHash: hash(1) })]), /permission denied/);
  await as(STAYS);
  await assert.rejects(db.query('select * from private.workspace_owner_accounts'), /permission denied/);
});

test('an owner who already has an account gets the property added and the "added" email', async () => {
  const { j, tokenHash } = await enquiryWithLink('Second flat', { contactName: 'Person 4', email: 'ACCOUNT4@example.com' });
  await pub({ action: 'decide', tokenHash, decision: 'proceed', feedback: '' });
  const ready = await server({ action: 'prepare', tokenHash });
  assert.equal(ready.userId, users[OWNER]);
  const claimed = await server({ action: 'link', tokenHash, userId: users[OWNER], created: false });
  assert.deepEqual([claimed.send, claimed.kind], [true, 'added']);
  assert.equal((await sql('select client_id from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].client_id, users[OWNER]);
  assert.equal((await sql("select count(*)::int n from public.workspace_property_assignments where property_id=$1 and user_id=$2 and assignment='client'", [j.propertyId, users[OWNER]]))[0].n, 1);
  assert.equal((await sql('select full_name from public.workspace_profiles where user_id=$1', [users[OWNER]]))[0].full_name, 'Person 4', 'their own name is kept');
});

test('an account signed up but never confirmed gets the choose-your-password email, never "sign in"', async () => {
  const id = await signUp('unconfirmed@example.com', false);
  const { tokenHash } = await enquiryWithLink('Unconfirmed flat', { contactName: 'Una Example', email: 'unconfirmed@example.com' });
  await pub({ action: 'decide', tokenHash, decision: 'proceed', feedback: '' });
  assert.equal((await server({ action: 'prepare', tokenHash })).userId, id);
  assert.equal((await server({ action: 'link', tokenHash, userId: id, created: false })).kind, 'welcome');
});

test('skipped with the reason: a team member’s email, no email, and owner accounts switched off', async () => {
  const staff = await enquiryWithLink('Staff flat', { contactName: 'Person 1', email: 'account1@example.com' });
  await pub({ action: 'decide', tokenHash: staff.tokenHash, decision: 'proceed', feedback: '' });
  assert.deepEqual(await server({ action: 'prepare', tokenHash: staff.tokenHash }), { state: 'skipped', reason: 'team_account' });
  await assert.rejects(server({ action: 'link', tokenHash: staff.tokenHash, userId: users[STAYS], created: false }), /does not match/);
  assert.equal((await read(ADMIN, staff.j.propertyId)).ownerAccountEmail.reason, 'team_account');
  assert.equal((await sql("select role from public.workspace_profiles where user_id=$1", [users[STAYS]]))[0].role, 'stays', 'never changed');

  const phone = await enquiryWithLink('Phone flat', { contactName: 'Ali Example', phone: '07700 900456' });
  await pub({ action: 'decide', tokenHash: phone.tokenHash, decision: 'proceed', feedback: '' });
  assert.deepEqual(await server({ action: 'prepare', tokenHash: phone.tokenHash }), { state: 'skipped', reason: 'no_email' });

  const beta = await enquiryWithLink('Beta flat', { contactName: 'Bea Example', email: 'bea@example.com' });
  await pub({ action: 'decide', tokenHash: beta.tokenHash, decision: 'proceed', feedback: '' });
  await sql('update private.workspace_beta_mode set team_only=true');
  assert.deepEqual(await server({ action: 'prepare', tokenHash: beta.tokenHash }), { state: 'skipped', reason: 'owner_accounts_off' });
  // Switched back on: the team tries again and it goes ahead.
  await sql('update private.workspace_beta_mode set team_only=false');
  const ready = await team(STAYS, { action: 'prepare', propertyId: beta.j.propertyId, requestId: crypto.randomUUID() });
  assert.equal(ready.state, 'ready');
  const id = await signUp('bea@example.com');
  assert.equal((await team(STAYS, { action: 'link', propertyId: beta.j.propertyId, requestId: crypto.randomUUID(), userId: id, created: true })).send, true);
  assert.deepEqual(await sql('select role,status from public.workspace_profiles where user_id=$1', [id]), [{ role: 'client', status: 'active' }]);
});
