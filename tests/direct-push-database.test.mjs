import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Direct pop-ups (Lee, 14 October: "Mark, new guest message", "John, guest, replied"): each message notice keeps who sent it and the
// start of the message, and each pop-up the backend claims carries them with the name of the person it is for. Owners never see a
// staff name. Every migration is applied in order; this one again to prove a second run changes nothing.
const MINE = '20261020700000_direct_push';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_chat_action(jsonb)', 'private.workspace_client_email_in(text,text,text,text,text,timestamp with time zone,text,text,text[],jsonb)',
  'private.integration_claim_web_push()', 'private.workspace_guest_message_notices()', 'private.integration_push_details(bigint)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
// integration_push_details is made whole here and later migrations add to it by anchor (20261021400000, @mentions): run again in
// order, the chain ends where it started.
for (const file of files.filter(f => f > MINE + '.sql')) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const secondRun = await definitions();
after(() => db.close());

const roles = ['admin', 'stays', 'client'], names = ['Mark Raven', 'Alex Coghill', 'Sarah Jones'];
const [MARK, ALEX, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97900000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9790', '9791');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `push${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[ALEX]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const asDatabase = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
beforeEach(async () => { await asDatabase(); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
// What the pop-up for the latest notice of this kind says to this person.
async function popup(who, eventType) {
  await asDatabase();
  const row = (await db.query(`select o.id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    where o.user_id=$1 and a.event_type=$2 order by o.id desc limit 1`, [users[who], eventType])).rows[0];
  assert.ok(row, `${names[who]} was told about ${eventType}`);
  return (await db.query('select private.integration_push_details($1) d', [row.id])).rows[0].d;
}
let n = 0;
const guest = async (body, threadRef = 'push-thread') => db.query('select private.workspace_guest_messages_ingest($1)', [{ source: 'feed', messages: [
  { externalId: 'push-' + ++n, threadRef, channel: 'airbnb', direction: 'guest', sentAt: new Date(Date.now() - 60000 + n * 1000).toISOString(), body, guestName: 'John Smith' }] }]);

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('a guest message carries the guest, the start of the message, and whether it is a reply', async () => {
  await asDatabase();
  await guest('What time\n\nis   check-in?');
  assert.deepEqual(await popup(MARK, 'guest.message'), { recipient: 'Mark Raven', who: 'John Smith', preview: 'What time is check-in?', replied: false });
  await guest('Thanks!');
  assert.equal((await popup(MARK, 'guest.message')).replied, true, 'the second message in the conversation is a reply');
});

test('team chat carries who wrote, the message and the group name; an owner sees "Recharge", never a staff name', async () => {
  await as(MARK);
  const group = (await rpc('workspace_chat_action', [{ action: 'startGroup', title: 'Deep clean Friday', userIds: [users[ALEX]] }])).id;
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: group, body: 'Can you check the linen?' }]);
  // With the conversation, its kind, the unread count and the sender's colour for the picture (migration 20261021400000).
  assert.deepEqual(await popup(ALEX, 'chat.message'), { recipient: 'Alex Coghill', who: 'Mark Raven', preview: 'Can you check the linen?', context: 'Deep clean Friday', replied: false, actorName: 'Mark Raven',
    conversationId: group, conversationKind: 'group', unreadCount: 1, senderColour: 'ocean' });
  await as(OWNER);
  const owner = (await rpc('workspace_chat_action', [{ action: 'startOwner' }])).id;
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: owner, body: 'Is the boiler fixed?' }]);
  const toTeam = await popup(MARK, 'chat.owner_message');
  assert.equal(toTeam.who, 'Sarah Jones');
  assert.equal(toTeam.preview, 'Is the boiler fixed?');
  await as(ALEX);
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: owner, body: 'Yes, this morning.' }]);
  const toOwner = await popup(OWNER, 'chat.message');
  assert.equal(toOwner.recipient, 'Sarah Jones');
  assert.equal(toOwner.who, 'Recharge');
  assert.equal(toOwner.actorName, 'Recharge');
  assert.equal(toOwner.preview, 'Yes, this morning.');
});

test('a client email carries the sender and the subject, and a later email is a reply', async () => {
  await asDatabase(); await db.exec('set role service_role');
  await rpc('workspace_email_owner_ingest', [{ emailId: 'push-mail-1', from: 'nia@example.org', fromName: 'Nia Newman', subject: 'Managing my flat', text: 'Hello', messageId: '<push-1@example.org>' }]);
  assert.deepEqual(await popup(ALEX, 'client.email'), { recipient: 'Alex Coghill', who: 'Nia Newman', preview: 'Managing my flat', replied: false });
  await asDatabase(); await db.exec('set role service_role');
  await rpc('workspace_email_owner_ingest', [{ emailId: 'push-mail-2', from: 'nia@example.org', fromName: 'Nia Newman', subject: 'Re: Managing my flat', text: 'Any news?', inReplyTo: '<push-1@example.org>', messageId: '<push-2@example.org>' }]);
  assert.equal((await popup(ALEX, 'client.email')).replied, true);
});

test('the backend claim hands each pop-up its details; details go after 3 days; nobody else can read them', async () => {
  await as(MARK);
  await rpc('workspace_web_push_subscribe', [{ endpoint: 'https://fcm.googleapis.com/fcm/send/mark', p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) }]);
  await asDatabase();
  await guest('Is parking free?', 'push-thread-2');
  await db.exec('set role service_role');
  const jobs = await rpc('integration_claim_web_push');
  const job = jobs.find(j => j.details?.preview === 'Is parking free?');
  assert.ok(job, 'the new guest message is claimed with its details');
  assert.deepEqual([job.details.recipient, job.details.who], ['Mark Raven', 'John Smith']);
  // The time the message was written (20261024300000), so the pop-up shows it and keeps a conversation's messages in order.
  assert.ok(Math.abs(Date.parse(job.createdAt) - Date.now()) < 60_000, 'the notice time travels with the pop-up');
  await as(MARK);
  await assert.rejects(db.query('select * from private.workspace_activity_details'), /permission denied/);
  await assert.rejects(db.query('select private.integration_push_details(1)'), /permission denied/);
  await asDatabase();
  await db.exec("update private.workspace_activity_details set created_at=now()-interval '4 days'");
  await db.exec('set role service_role');
  await rpc('integration_claim_web_push');
  await asDatabase();
  assert.equal((await db.query('select count(*)::int n from private.workspace_activity_details')).rows[0].n, 0);
});
