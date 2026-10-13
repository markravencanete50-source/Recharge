import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Guest message notices and onboarding (20261015330000): a Stays person still mid-onboarding cannot open the guest inbox, so they
// are not told about guest messages; once their onboarding is complete they are told about the next one. Admins never onboard.
// Every migration is applied in order; this one again to prove a second run changes nothing.
const MINE = '20261015330000_guest_message_notices_onboarded';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async () => (await db.query("select pg_get_functiondef('private.workspace_guest_message_recipients(uuid)'::regprocedure) def")).rows[0].def;
const firstRun = await definition();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await definition();
after(() => db.close());

const roles = ['admin', 'stays', 'stays'];
const [ADMIN, STAYS, NEW_STAYS] = roles.map((_, i) => i);
const users = roles.map((_, i) => `98500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `onboardnotice${i}@example.com`]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
const property = (await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values('Onboard flat','Example onboard address','Edinburgh',$1,gen_random_uuid()) returning id", [users[ADMIN]])).rows[0].id;
for (const who of [STAYS, NEW_STAYS]) await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3)", [property, users[who], users[ADMIN]]);
// A contract every Stays person must sign. The established Stays person has signed it; the new starter has not.
const contract = (await db.query("insert into private.workspace_contracts(title,audience,created_by,request_id) values('Stays agreement','{stays}',$1,gen_random_uuid()) returning id", [users[ADMIN]])).rows[0].id;
await db.query("insert into private.workspace_contract_versions(contract_id,version,title,body,published_by) values($1,1,'Stays agreement','The terms every Stays team member agrees to.',$2)", [contract, users[ADMIN]]);
const sign = who => db.query("insert into private.workspace_contract_signatures(contract_id,version,user_id,signed_name) values($1,1,$2,$3)", [contract, users[who], 'Person ' + who]);
await sign(STAYS);

let n = 0;
async function guestMessage() {
  n++;
  await db.query('select private.workspace_guest_messages_ingest($1)', [{ source: 'feed', messages: [
    { externalId: 'onb-' + n, threadRef: 'onb-thread', propertyId: property, channel: 'airbnb', direction: 'guest', sentAt: new Date().toISOString(), body: 'Message ' + n, guestName: 'Gail Guest' },
  ] }]);
  const rows = (await db.query("select o.user_id from private.workspace_notification_outbox o where o.event_id=(select max(id) from public.workspace_activity where event_type='guest.message')")).rows;
  return rows.map(r => users.indexOf(r.user_id)).sort((a, b) => a - b);
}
const toldTotal = async who => (await db.query("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='guest.message' and o.user_id=$1", [users[who]])).rows[0].n;

test('the migration runs twice without change', () => assert.equal(secondRun, firstRun));

test('a Stays person mid-onboarding is not told; once onboarding is complete they are told about the next message', async () => {
  assert.equal((await db.query('select private.workspace_onboarding_status($1)->>$2 done', [users[NEW_STAYS], 'complete'])).rows[0].done, 'false');
  assert.deepEqual(await guestMessage(), [ADMIN, STAYS], 'the new starter is not told yet');
  assert.deepEqual(await guestMessage(), [ADMIN, STAYS]);
  await sign(NEW_STAYS);
  assert.equal((await db.query('select private.workspace_onboarding_status($1)->>$2 done', [users[NEW_STAYS], 'complete'])).rows[0].done, 'true');
  assert.deepEqual(await guestMessage(), [ADMIN, STAYS, NEW_STAYS], 'told once onboarding is complete');
  assert.equal(await toldTotal(NEW_STAYS), 1, 'earlier messages are not sent again');
});

test('a new required course pauses notices again until it is done; admins are never paused', async () => {
  const course = (await db.query(`insert into private.workspace_training_courses(title,audience,body,minutes,published,required,created_by,request_id)
    values('Guest care','{stays}','How we look after guests, start to finish.',20,true,true,$1,gen_random_uuid()) returning id`, [users[ADMIN]])).rows[0].id;
  assert.deepEqual(await guestMessage(), [ADMIN], 'neither Stays person has done the new required course');
  for (const who of [STAYS, NEW_STAYS]) await db.query('insert into private.workspace_training_progress(course_id,user_id,completed_at) values($1,$2,now())', [course, users[who]]);
  assert.deepEqual(await guestMessage(), [ADMIN, STAYS, NEW_STAYS]);
});
