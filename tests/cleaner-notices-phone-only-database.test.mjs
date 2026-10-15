import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Cleaners get their notices on their phone only (migration 20261021900000, Lee): a cleaner's notice gets a push job and
// stays in the app, but never an email job; an admin's same kind of notice is still emailed.
const MIGRATION = 'supabase/migrations/20261021900000_cleaner_notices_phone_only.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// Safe to run twice.
await db.exec(await fs.readFile(MIGRATION, 'utf8'));

const roles = ['super_admin', 'cleans'];
const users = roles.map((_, i) => `97900000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, CLEANER] = [0, 1];
const session = i => users[i].replace('9790', '9890');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `phone${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2 where user_id=$1", [users[i], roles[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
  await db.query("insert into private.workspace_device_tokens(user_id,device_id,push_token,platform) values($1,gen_random_uuid(),$2,'android')", [users[i], `ExponentPushToken[phone-only-000${i}]`]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  if (i === 'service') { await db.query("select set_config('request.jwt.claims','{}',false)"); await db.exec('set role service_role'); return; }
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
// Claimed a few at a time: keep claiming until every waiting job has been seen.
const claimAll = async (email, push) => { await as('service'); const all = []; for (let i = 0; i < 40; i++) { const jobs = await rpc('integration_claim_notifications', [email, push]); if (!jobs.length) break; all.push(...jobs); } return all; };
const jobsFor = async (outbox, channel) => owner('select id,state,last_error from private.workspace_notification_deliveries where outbox_id=$1 and channel=$2', [outbox, channel]);
// The same kind of notice, straight into the outbox, for one person.
const notice = async (user, work, type = 'cleaning.assigned') => {
  const [{ id: event }] = await owner('insert into public.workspace_activity(actor_id,work_id,event_type) values($1,$2,$3) returning id', [users[ADMIN], work, type]);
  return (await owner('insert into private.workspace_notification_outbox(user_id,work_id,event_id) values($1,$2,$3) returning id', [users[user], work, event]))[0].id;
};
const leasedEmail = async (outbox, user) => (await owner(`insert into private.workspace_notification_deliveries(outbox_id,channel,destination,lease,lease_until,attempts)
  select $1,'email',email,gen_random_uuid(),now()+interval '5 minutes',1 from auth.users where id=$2 returning id,lease`, [outbox, users[user]]))[0];

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '7 Phone Lane' }]);
await rpc('workspace_assign_property', [property, users[CLEANER], 'cleaner']);
const clean = await rpc('workspace_operations_action', [{ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: property, kind: 'cleaning', data: { dueOn: '2026-10-20', checklist: ['Kitchen'] } }]);
await rpc('workspace_assign_work', [clean.workId, clean.version, users[CLEANER]]);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

test('the real cleaner flow: assigning a clean tells the cleaner by push only', async () => {
  const assigned = await owner(`select o.id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    where o.user_id=$1 and a.event_type like 'cleaning.%'`, [users[CLEANER]]);
  assert.ok(assigned.length, 'assigning the clean left the cleaner a notice');
  await claimAll(true, true);
  for (const { id } of assigned) assert.equal((await jobsFor(id, 'email')).length, 0);
  for (const { id } of assigned) assert.equal((await jobsFor(id, 'push')).length, 1);
});

test("a cleaner's notice gets a push job but no email job; an admin's same notice is still emailed", async () => {
  const cleanerNotice = await notice(CLEANER, clean.workId);
  const adminNotice = await notice(ADMIN, clean.workId);
  const pushes = await claimAll(false, true);
  const emails = await claimAll(true, false);
  assert.ok(pushes.every(j => j.channel === 'push') && emails.every(j => j.channel === 'email'));
  assert.equal((await jobsFor(cleanerNotice, 'push')).length, 1, 'the cleaner gets the push');
  assert.equal((await jobsFor(cleanerNotice, 'email')).length, 0, 'the cleaner never gets an email');
  assert.equal((await jobsFor(adminNotice, 'push')).length, 1);
  assert.equal((await jobsFor(adminNotice, 'email')).length, 1, 'the admin is still emailed');
  assert.ok(emails.some(j => j.destination === 'phone0@example.com'));
  assert.ok(!emails.some(j => j.destination === 'phone1@example.com'), 'no email job goes to the cleaner');
  // Both keep the notice in the app.
  assert.equal((await owner('select count(*)::int n from private.workspace_notification_outbox where id=any($1)', [[cleanerNotice, adminNotice]]))[0].n, 2);
});

test('an email already queued for a cleaner is cancelled, and a claimed one is turned down before the send', async () => {
  const queued = await notice(CLEANER, clean.workId, 'cleaning.moved');
  await owner("insert into private.workspace_notification_deliveries(outbox_id,channel,destination) select $1,'email',email from auth.users where id=$2", [queued, users[CLEANER]]);
  const emails = await claimAll(true, false);
  assert.ok(!emails.some(j => j.destination === 'phone1@example.com'));
  assert.deepEqual((await jobsFor(queued, 'email')).map(j => j.state), ['cancelled']);
  // A job claimed just before the change (already leased) is checked again before the individual send.
  const late = await notice(CLEANER, clean.workId, 'cleaning.redo');
  const job = await leasedEmail(late, CLEANER);
  await as('service');
  assert.equal(await rpc('integration_check_notification', [job.id, job.lease]), false);
  assert.deepEqual((await jobsFor(late, 'email')).map(j => j.state), ['cancelled']);
  // An admin's claimed email still passes the check.
  const adminJob = await leasedEmail(await notice(ADMIN, clean.workId, 'cleaning.redo'), ADMIN);
  await as('service');
  assert.equal(await rpc('integration_check_notification', [adminJob.id, adminJob.lease]), true);
});

test('the patch is in place once, is safe to run again, and keeps the grants', async () => {
  const source = await fs.readFile(MIGRATION, 'utf8');
  await owner(source);
  const [{ claim, check }] = await owner("select pg_get_functiondef('private.integration_claim_notifications(boolean,boolean)'::regprocedure) claim,pg_get_functiondef('private.integration_check_notification(uuid,uuid)'::regprocedure) check");
  const count = (text, part) => text.split(part).length - 1;
  assert.equal(count(claim, "p.role<>'cleans'"), 1);
  assert.equal(count(claim, "(d.channel='email' and p.role='cleans')"), 1);
  assert.equal(count(check, "cp.role='cleans'"), 1);
  const [grants] = await owner(`select has_function_privilege('service_role','public.integration_claim_notifications(boolean,boolean)','execute') svc,
    has_function_privilege('service_role','public.integration_check_notification(uuid,uuid)','execute') svc_check,
    has_function_privilege('authenticated','public.integration_claim_notifications(boolean,boolean)','execute') auth,
    has_function_privilege('authenticated','private.integration_claim_notifications(boolean,boolean)','execute') priv`);
  assert.deepEqual(grants, { svc: true, svc_check: true, auth: false, priv: false });
  assert.ok(source.includes('\r\n') && !source.replace(/\r\n/g, '').includes('\n'), 'CRLF line endings');
  const code = source.split('\r\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b|\bdelete\b/i);
});
