import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The Updates feed read, round 6 (20261016300000): each notice carries the work title and kind, the property's name and address,
// and who did it (a name for the team, "Recharge" for owners, nobody when automatic), in the same one query. Email and push claims
// carry the work kind. Every migration is applied in order; this one again to prove a second run changes nothing.
const MINE = '20261016300000_notice_details';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_controls_read(text,uuid,uuid)', 'private.integration_claim_notifications(boolean,boolean)', 'private.integration_claim_web_push()'];
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
after(() => db.close());

const roles = ['admin', 'stays', 'client'];
const [ADMIN, STAYS, OWNER] = roles.map((_, i) => i);
const names = ['Ada Admin', 'Sam Reid', 'Olive Owner'];
const users = roles.map((_, i) => `98700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9870', '9880');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `noticedetail${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const feed = async who => { await as(who); return (await db.query("select public.workspace_controls_read('notifications',null,null) r")).rows[0].r; };

await asDatabase();
const property = (await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values('Harbour Flat','10 Barnet Crescent, Edinburgh','Edinburgh',$1,gen_random_uuid()) returning id", [users[ADMIN]])).rows[0].id;
for (const [who, kind] of [[STAYS, 'staff'], [OWNER, 'client']]) await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [property, users[who], kind, users[ADMIN]]);
async function workItem(kind, title, moduleId, clientVisible = false) {
  const id = (await db.query(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),$1,$2,$3,$4,$5) returning id`, [property, moduleId, title, users[ADMIN], clientVisible])).rows[0].id;
  await db.query('insert into private.workspace_domain_details(work_id,kind,data) values($1,$2,$3)', [id, kind, {}]);
  return id;
}
async function notify(eventType, { actor = null, work = null, prop = property, to = [] } = {}) {
  const ev = (await db.query('insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,$4) returning id', [actor, prop, work, eventType])).rows[0].id;
  for (const who of to) await db.query('insert into private.workspace_notification_outbox(user_id,event_id,work_id) values($1,$2,$3) on conflict do nothing', [users[who], ev, work]);
  return ev;
}
const pricing = await workItem('daily_pricing', '3 empty nights to price', 'daily-pricing');
const repair = await workItem('maintenance', 'Boiler not working', 'stays-maintenance-reporting', true);
const autoEvent = await notify('handover.created', { work: pricing, to: [STAYS, ADMIN] });
const staffEvent = await notify('operations.updateOperation.completeRepair', { actor: users[STAYS], work: repair, to: [ADMIN, OWNER] });
const chatEvent = await notify('chat.owner_message', { actor: users[OWNER], prop: null, to: [STAYS] });

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('the team gets the work title and kind, the property, and who did it (nobody when automatic)', async () => {
  const stays = await feed(STAYS);
  const auto = stays.find(n => n.id === autoEvent);
  assert.deepEqual([auto.work_title, auto.work_kind, auto.work_module, auto.property_name, auto.property_address, auto.automatic, auto.actor_name],
    ['3 empty nights to price', 'daily_pricing', 'daily-pricing', 'Harbour Flat', '10 Barnet Crescent, Edinburgh', true, null]);
  const chat = stays.find(n => n.id === chatEvent);
  assert.deepEqual([chat.actor_name, chat.automatic, chat.work_title], ['Olive Owner', false, null], 'the owner who wrote is named to the team');
  const admin = await feed(ADMIN);
  const done = admin.find(n => n.id === staffEvent);
  assert.deepEqual([done.work_title, done.work_kind, done.actor_name, done.automatic], ['Boiler not working', 'maintenance', 'Sam Reid', false]);
});

test('owners see "Recharge" and never a staff name, never "automatic", and only their own notices', async () => {
  const owner = await feed(OWNER);
  assert.deepEqual(owner.map(n => n.id), [staffEvent], 'only what was sent to them');
  const done = owner[0];
  assert.deepEqual([done.work_title, done.work_kind, done.property_name, done.actor_name, done.automatic], ['Boiler not working', 'maintenance', 'Harbour Flat', 'Recharge', false]);
  assert.ok(!JSON.stringify(owner).includes('Sam Reid'), 'no staff name anywhere in an owner read');
  // Their own action reads as "You".
  await asDatabase();
  const own = await notify('chat.owner_message', { actor: users[OWNER], prop: null, to: [OWNER] });
  assert.equal((await feed(OWNER)).find(n => n.id === own).actor_name, 'You');
});

test('email and push claims carry the kind of work', async () => {
  await asDatabase();
  const email = (await db.query('select private.integration_claim_notifications(true,false) r')).rows[0].r;
  const forAuto = email.filter(j => j.eventType === 'handover.created');
  assert.ok(forAuto.length >= 1 && forAuto.every(j => j.workKind === 'daily_pricing'), 'the email job names the kind');
  assert.ok(email.filter(j => j.eventType === 'chat.owner_message').every(j => j.workKind === null), 'no work, no kind');
  await db.query("insert into private.workspace_web_push(user_id,endpoint,p256dh,auth,created_at) values($1,'https://fcm.googleapis.com/fcm/send/notice-details','BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM','tBHItJI5svbpez7KI4CCXg',now()-interval '1 hour')", [users[STAYS]]);
  const push = (await db.query('select private.integration_claim_web_push() r')).rows[0].r;
  assert.ok(push.some(j => j.eventType === 'handover.created' && j.workKind === 'daily_pricing'));
});
