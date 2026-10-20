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
  // The guest conversation (20261025500000), so a tap opens it and Mark as read marks it read.
  const [thread] = (await db.query("select id from private.workspace_guest_threads where source='feed' and thread_ref='push-thread'")).rows;
  assert.deepEqual(await popup(MARK, 'guest.message'), { recipient: 'Mark Raven', who: 'John Smith', preview: 'What time is check-in?', replied: false, guestThreadId: thread.id });
  await guest('Thanks!');
  assert.equal((await popup(MARK, 'guest.message')).replied, true, 'the second message in the conversation is a reply');
  assert.equal((await popup(MARK, 'guest.message')).guestThreadId, thread.id);
  await guest('Another guest', 'push-thread-other');
  const [other] = (await db.query("select id from private.workspace_guest_threads where source='feed' and thread_ref='push-thread-other'")).rows;
  assert.equal((await popup(MARK, 'guest.message')).guestThreadId, other.id, 'each conversation its own');
  assert.notEqual(other.id, thread.id);
});

test('team chat carries who wrote, the message and the group name; an owner sees "Recharge", never a staff name', async () => {
  await as(MARK);
  const group = (await rpc('workspace_chat_action', [{ action: 'startGroup', title: 'Deep clean Friday', userIds: [users[ALEX]] }])).id;
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: group, body: 'Can you check the linen?' }]);
  // With the conversation, its kind, the unread count and the sender's colour for the picture (migration 20261021400000).
  assert.deepEqual(await popup(ALEX, 'chat.message'), { recipient: 'Alex Coghill', who: 'Mark Raven', preview: 'Can you check the linen?', context: 'Deep clean Friday', replied: false, actorName: 'Mark Raven',
    conversationId: group, conversationKind: 'group', unreadCount: 1, senderColour: 'ocean' });
  // A photo it carries (20261025500000): its kind, and the first photo's private path for the server to sign (never a device).
  await asDatabase();
  const [last] = (await db.query('select id from private.chat_messages where conversation_id=$1 order by created_at desc limit 1', [group])).rows;
  for (const [i, kind, mime] of [[1, 'image', 'image/jpeg'], [0, 'image', 'image/png'], [2, 'video', 'video/mp4']])
    await db.query('insert into private.chat_attachments(conversation_id,message_id,uploader_id,path,kind,mime,bytes,position) values($1,$2,$3,$4,$5,$6,100,$7)',
      [group, last.id, users[MARK], `${group}/${crypto.randomUUID()}.${mime.split('/')[1]}`, kind, mime, i]);
  const withPhoto = await popup(ALEX, 'chat.message');
  assert.equal(withPhoto.attachmentKind, 'image');
  assert.match(withPhoto.attachmentPath, new RegExp(`^${group}/[0-9a-f-]{36}\\.png$`), 'the first photo by its place');
  await as(MARK);
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
  assert.match(job.details.guestThreadId, /^[0-9a-f-]{36}$/, 'the guest conversation travels with the pop-up');
  // The time the message was written (20261025400000), so the pop-up shows it and keeps a conversation's messages in order.
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

// Lee: notices name people, not labels (20261025500000). The feed said "Guest message · 64/2 Rannoch" with "Guest" below it.
test('the guest is named in the feed and the pop-up, from the conversation or its stay, and the name outlasts the pop-up details', async () => {
  await asDatabase();
  const prop = (await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values('64/2 Rannoch','64/2 Rannoch Road, Edinburgh','Edinburgh',$1,gen_random_uuid()) returning id", [users[MARK]])).rows[0].id;
  await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3)", [prop, users[ALEX], users[MARK]]);
  const stay = (await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,channel_reference)
    values($1,'HA-NAMED-1','2026-11-12','2026-11-15','confirmed','manual',$2,'airbnb','HMNAMED1') returning id`, [prop, users[MARK]])).rows[0].id;
  await db.query("insert into private.workspace_stay_contacts(reservation_id,first_name) values($1,'Priya')", [stay]);
  const ingest = (threadRef, extra) => db.query('select private.workspace_guest_messages_ingest($1)', [{ source: 'feed', messages: [
    { externalId: 'named-' + ++n, threadRef, channel: 'airbnb', direction: 'guest', sentAt: new Date(Date.now() - 30000 + n * 1000).toISOString(), body: 'Hello there', propertyId: prop, ...extra }] }]);
  // The conversation has no name of its own: the first name on its stay, by the booking code.
  await ingest('named-by-stay', { reservationRef: 'hmnamed1', checkIn: '2026-11-12', checkOut: '2026-11-15' });
  assert.equal((await popup(MARK, 'guest.message')).who, 'Priya', 'the pop-up is titled with the stay\'s first name');
  // The conversation's own name comes first.
  await ingest('named-by-thread', { guestName: 'Rebecca Hall', checkIn: '2026-11-12', checkOut: '2026-11-15' });
  assert.equal((await popup(MARK, 'guest.message')).who, 'Rebecca Hall');
  // Neither: no name, and the app says "Guest".
  await ingest('named-nobody', {});
  assert.equal((await popup(MARK, 'guest.message')).who, undefined);
  await asDatabase();
  const kept = (await db.query(`select g.guest_name from private.workspace_guest_notices g join private.workspace_guest_threads t on t.id=g.guest_thread_id
    where t.thread_ref=any($1) order by t.thread_ref`, [['named-by-stay', 'named-by-thread', 'named-nobody']])).rows.map(r => r.guest_name);
  assert.deepEqual(kept, ['Priya', 'Rebecca Hall', null]);
  // The pop-up details go after 3 days; the feed still names the guest.
  await db.exec("update private.workspace_activity_details set created_at=now()-interval '4 days'");
  await db.exec("delete from private.workspace_activity_details where created_at<now()-interval '3 days'");
  await as(MARK);
  const feed = (await db.query('select public.workspace_notifications_read(null) r')).rows[0].r.filter(x => x.event_type === 'guest.message' && x.property_id === prop);
  assert.deepEqual(feed.map(x => [x.guest_name ?? null, x.guest_channel, x.guest_check_in, x.guest_check_out, x.property_name]), [
    [null, 'airbnb', null, null, '64/2 Rannoch'],
    ['Rebecca Hall', 'airbnb', '2026-11-12', '2026-11-15', '64/2 Rannoch'],
    ['Priya', 'airbnb', '2026-11-12', '2026-11-15', '64/2 Rannoch']]);
  // Each row names its conversation, so a tap opens it.
  const threads = (await db.query("select public.workspace_notifications_read(null) r")).rows[0].r.filter(x => x.event_type === 'guest.message' && x.property_id === prop).map(x => x.guest_thread_id);
  await asDatabase();
  assert.deepEqual(threads, (await db.query("select id from private.workspace_guest_threads where thread_ref=any($1) order by array_position($1,thread_ref)", [['named-nobody', 'named-by-thread', 'named-by-stay']])).rows.map(r => r.id));
  // A Stays person on the property sees the name too (guest names are for admins, Stays and Accounts).
  await as(ALEX);
  const stays = (await db.query('select public.workspace_notifications_read(null) r')).rows[0].r.filter(x => x.event_type === 'guest.message' && x.property_id === prop);
  assert.deepEqual(stays.map(x => x.guest_name ?? null), [null, 'Rebecca Hall', 'Priya']);
  // Nobody signed in reads the kept names directly.
  await assert.rejects(db.query('select * from private.workspace_guest_notices'), /permission denied/);
  await assert.rejects(db.query('select private.workspace_guest_thread_name(gen_random_uuid())'), /permission denied/);
});
