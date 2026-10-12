import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Replies sent from the Guest inbox through Hostaway, as the database sees them: the request recorded once
// for the signed-in user, the backend's result (service role) storing the message, and the Hostaway import
// not storing the same message a second time.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// The live sync is paused for the new business; these tests exercise it switched back on.
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); });

const people = ['super_admin', 'stays', 'stays', 'stays'].map((_, i) => `97000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => people[i].replace('9700', '9710');
const [ADMIN, ANNA, NOMODULE, OTHER] = [0, 1, 2, 3];
for (let i = 0; i < people.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [people[i], `reply${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), people[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), people[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [people[i], ['super_admin', 'stays', 'stays', 'stays'][i], ['Reply Admin', 'Anna Lee', 'No Module', 'Other Staff'][i]]);
}
await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [people[ADMIN]]);
for (const who of [ANNA, OTHER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication')", [people[who]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: people[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => {
  await db.exec('reset role');
  await db.exec("delete from private.workspace_write_limits;delete from private.workspace_guest_reply_requests;delete from private.workspace_guest_thread_marks;delete from private.workspace_guest_messages;delete from private.workspace_guest_threads");
});
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const msg = (id, incoming, minutes, body = incoming ? 'Hello, a question' : 'Happy to help') => ({ id: String(id), incoming, body, sentAt: ago(minutes) });
const conversation = (id, messages, extra = {}) => ({ id: String(id), listingId: '', reservationId: '', guestName: 'Alex Kim', checkIn: null, checkOut: null, channel: 'airbnb', marker: `m-${id}-${Math.random()}`, messages, ...extra });
const ingest = async conversations => { await asBackend(); return rpc('workspace_hostaway_messages_ingest', [{ conversations }]); };
const send = async (who, threadId, body, requestId = crypto.randomUUID()) => { await as(who); return rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId, threadId, body }]); };
const result = async input => { await asBackend(); return rpc('workspace_guest_reply_result', [input]); };
const threadId = async ref => (await sql("select id from private.workspace_guest_threads where source='hostaway' and thread_ref=$1", [ref]))[0].id;
const stored = async ref => sql("select external_id,direction,body,delivery,author_user_id,sent_at from private.workspace_guest_messages where source='hostaway' and thread_ref=$1 order by sent_at,external_id", [ref]);
const requests = async () => sql('select request_id,status,hostaway_message_id,error,user_id,body from private.workspace_guest_reply_requests order by created_at');
const view = async (who, id) => { await as(who); return rpc('workspace_guest_inbox_read', ['thread', id, null]); };

// A guest waiting on a Hostaway conversation (number-like id, as Hostaway's are).
async function waiting(ref = '4101') {
  await ingest([conversation(ref, [msg(ref + '1', true, 7, 'What time is check in?')])]);
  return threadId(ref);
}

test('only a Hostaway conversation can be replied to, by someone who can see it, with a valid reply', async () => {
  const id = await waiting();
  await as(ADMIN);
  await rpc('workspace_guest_inbox_action', [{ action: 'logMessage', requestId: crypto.randomUUID(), channel: 'whatsapp', guestName: 'Sam', body: 'Hi from WhatsApp' }]);
  const [{ id: manual }] = await sql("select id from private.workspace_guest_threads where source='manual'");
  await assert.rejects(send(ADMIN, manual, 'Hello'), /Only Hostaway conversations/);
  await assert.rejects(send(NOMODULE, id, 'Hello'), /Guest inbox access required/);
  // Someone with the tool who looks after other properties only sees what is theirs: this thread has a property.
  await asBackend();
  await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: '601', name: 'Quay Flat', address: '', bedrooms: 1 }] }]);
  const [{ id: quay }] = await sql("select id from public.workspace_properties where hostaway_listing_id='601'");
  await sql('update private.workspace_guest_threads set property_id=$1 where id=$2', [quay, id]);
  await assert.rejects(send(OTHER, id, 'Hello'), /Conversation not found/);
  await sql('update private.workspace_guest_threads set property_id=null where id=$1', [id]);
  for (const body of ['', '   \n ', 'x'.repeat(5001)]) await assert.rejects(send(ADMIN, id, body), /Write the reply/, JSON.stringify(body.length));
  await assert.rejects(send(ADMIN, null, 'Hello'), /Only Hostaway conversations/);
  await as(ADMIN);
  await assert.rejects(rpc('workspace_guest_inbox_action', [{ action: 'sendReply', threadId: id, body: 'Hello' }]), /Request identifier required/);
  await assert.rejects(rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId: crypto.randomUUID(), threadId: id, body: 'Hello', sentAt: ago(1) }]));
  assert.deepEqual(await requests(), [], 'nothing was recorded by refused requests');
  assert.equal((await stored('4101')).length, 1, 'and no message was stored');
  // A trimmed reply of exactly 5000 is fine.
  const ok = await send(ADMIN, id, '  ' + 'y'.repeat(5000) + '  ');
  assert.deepEqual([ok.send, ok.conversationId], [true, '4101']);
  assert.equal((await requests())[0].body.length, 5000);
  // Sending is refused while the Hostaway sync is paused.
  await sql('update private.workspace_hostaway_sync_state set paused=true where singleton');
  try { await assert.rejects(send(ADMIN, id, 'Hello'), /Hostaway is paused/); } finally { await sql('update private.workspace_hostaway_sync_state set paused=false where singleton'); }
});

test('a request id is recorded once: a repeat is not sent again, a stuck or failed one may be tried again', async () => {
  const id = await waiting();
  const req = crypto.randomUUID();
  const first = await send(ADMIN, id, 'Check in is from 3pm', req);
  assert.deepEqual(first, { send: true, conversationId: '4101', requestId: req });
  assert.equal((await stored('4101')).length, 1, 'nothing is stored until Hostaway took it');
  assert.deepEqual((await requests()).map(r => [r.request_id, r.status, r.user_id, r.body]), [[req, 'sending', people[ADMIN], 'Check in is from 3pm']]);

  const again = await send(ADMIN, id, 'Check in is from 3pm', req);
  assert.equal(again.send, false);
  assert.equal(again.thread.id, id, 'the thread comes back instead');
  assert.equal((await requests()).length, 1);
  // The request id belongs to the person and conversation that made it.
  await assert.rejects(send(OTHER, id, 'Check in is from 3pm', req), /Request identifier already used/);
  const second = await waiting('4102');
  await assert.rejects(send(ADMIN, second, 'Check in is from 3pm', req), /Request identifier already used/);

  // Still sending after 2 minutes: the backend may have stopped half way, so it may be tried again.
  await sql("update private.workspace_guest_reply_requests set created_at=now()-interval '3 minutes' where request_id=$1", [req]);
  assert.equal((await send(ADMIN, id, 'Check in is from 3pm', req)).send, true);
  assert.equal((await requests())[0].status, 'sending');
  assert.equal((await send(ADMIN, id, 'Check in is from 3pm', req)).send, false, 'and is again blocked for 2 minutes');

  // Failed: it may be tried again with the same text or new text.
  await result({ requestId: req, ok: false, error: 'Hostaway is limiting requests.' });
  assert.deepEqual((await requests()).map(r => [r.status, r.error]), [['failed', 'Hostaway is limiting requests.']]);
  const retry = await send(ADMIN, id, 'Check in is from 3pm today', req);
  assert.equal(retry.send, true);
  assert.deepEqual((await requests()).map(r => [r.status, r.error, r.body]), [['sending', null, 'Check in is from 3pm today']]);

  // Once sent, always blocked.
  await result({ requestId: req, ok: true, hostawayMessageId: '90001' });
  assert.equal((await send(ADMIN, id, 'Check in is from 3pm today', req)).send, false);
  assert.equal((await stored('4101')).filter(m => m.direction === 'team').length, 1);
});

test('a sent reply is stored as the sender’s team message and ends the wait', async () => {
  const id = await waiting();
  const before = await view(ADMIN, id);
  assert.ok(before.thread.waitingSince, 'the guest is waiting');
  const { requestId } = await send(ANNA, id, '  Check in is from 3pm.  ');
  assert.deepEqual(await result({ requestId, ok: true, hostawayMessageId: '90010' }), { recorded: true });
  const [guest, reply] = await stored('4101');
  assert.deepEqual([reply.external_id, reply.direction, reply.body, reply.delivery, reply.author_user_id], ['90010', 'team', 'Check in is from 3pm.', 'sent', people[ANNA]]);
  assert.ok(Math.abs(Date.parse(reply.sent_at) - Date.now()) < 60000);
  assert.equal(guest.direction, 'guest');
  const after = await view(ADMIN, id);
  assert.deepEqual([after.thread.waitingSince, after.thread.lastFrom, after.thread.messages, after.thread.preview], [null, 'team', 2, 'Check in is from 3pm.']);
  assert.deepEqual(after.messages.map(m => [m.direction, m.author, m.delivery]), [['guest', null, null], ['team', 'Anna Lee', 'sent']]);
  assert.equal(after.thread.status, 'open', 'replied, not done');
  const timed = await sql("select grade,minutes::float8 minutes from private.workspace_response_rows(now()-interval '1 day',now()+interval '1 minute') where message_id=(select id from private.workspace_guest_messages where external_id='41011')");
  assert.equal(timed.length, 1, 'the wait is timed');
  assert.ok(timed[0].minutes >= 6.9 && timed[0].minutes < 9, String(timed[0].minutes));
  assert.deepEqual((await requests()).map(r => [r.status, r.hostaway_message_id]), [['sent', '90010']]);
  assert.ok((await sql("select last_message_at from private.workspace_guest_threads where id=$1", [id]))[0].last_message_at > new Date(Date.now() - 60000));
  // The same result again changes nothing.
  assert.deepEqual(await result({ requestId, ok: true, hostawayMessageId: '90010' }), { recorded: false });
  assert.equal((await stored('4101')).length, 2);
  // Anna now counts as having replied here (the Mine chip).
  await as(ANNA);
  assert.equal((await rpc('workspace_guest_inbox_read', ['thread', id, null])).thread.mine, true);
});

test('a failed send stores nothing and the guest keeps waiting', async () => {
  const id = await waiting();
  const { requestId } = await send(ADMIN, id, 'Check in is from 3pm');
  assert.deepEqual(await result({ requestId, ok: false, error: 'Hostaway refused the message (HTTP 400: nope).' }), { recorded: true });
  assert.equal((await stored('4101')).length, 1);
  assert.ok((await view(ADMIN, id)).thread.waitingSince);
  assert.deepEqual((await requests()).map(r => [r.status, r.error]), [['failed', 'Hostaway refused the message (HTTP 400: nope).']]);
  // A late "ok" for the same request (for example after trying again) still records the message once.
  await send(ADMIN, id, 'Check in is from 3pm', requestId);
  await result({ requestId, ok: true });
  assert.deepEqual((await stored('4101')).map(m => m.external_id), ['41011', 'app:' + requestId]);
});

test('the sync bringing the reply in first, or last, never leaves two copies', async () => {
  // The sync stored it first, then the result arrives with the same Hostaway id: one row, now with its author.
  let id = await waiting('4201');
  let { requestId } = await send(ADMIN, id, 'On my way');
  await ingest([conversation('4201', [msg('4201x', false, 0.5, 'On my way')])]);
  assert.deepEqual((await stored('4201')).map(m => [m.external_id, m.author_user_id]), [['42011', null], ['4201x', null]]);
  await result({ requestId, ok: true, hostawayMessageId: '4201x' });
  assert.deepEqual((await stored('4201')).map(m => [m.external_id, m.author_user_id, m.delivery]), [['42011', null, null], ['4201x', people[ADMIN], 'sent']]);

  // The result first, then the sync with the same Hostaway id: skipped as already stored.
  id = await waiting('4202');
  ({ requestId } = await send(ANNA, id, 'On my way'));
  await result({ requestId, ok: true, hostawayMessageId: '4202x' });
  assert.deepEqual(await ingest([conversation('4202', [msg('42021', true, 7), msg('4202x', false, 0.2, 'On my way')])]), { added: 0, conversations: 1 });
  assert.deepEqual((await stored('4202')).map(m => [m.external_id, m.author_user_id]), [['42021', null], ['4202x', people[ANNA]]]);

  // Hostaway gave no id: stored under a Recharge id, and the sync's copy (same text, within 10 minutes) takes it over.
  id = await waiting('4203');
  ({ requestId } = await send(ADMIN, id, 'On my way'));
  await result({ requestId, ok: true });
  assert.deepEqual((await stored('4203')).map(m => m.external_id), ['42031', 'app:' + requestId]);
  assert.deepEqual(await ingest([conversation('4203', [msg('42031', true, 7), msg('4203x', false, 0.1, '  On my   way ')])]), { added: 0, conversations: 1 });
  assert.deepEqual((await stored('4203')).map(m => [m.external_id, m.author_user_id, m.body]), [['42031', null, 'What time is check in?'], ['4203x', people[ADMIN], 'On my way']]);
  // Importing again changes nothing.
  assert.deepEqual(await ingest([conversation('4203', [msg('4203x', false, 0.1, 'On my way')])]), { added: 0, conversations: 1 });
  assert.equal((await stored('4203')).length, 2);

  // Hostaway gave no id and the sync had already stored the message: the result adopts that copy.
  id = await waiting('4204');
  ({ requestId } = await send(ADMIN, id, 'On my way'));
  await ingest([conversation('4204', [msg('4204x', false, 0.1, 'On my way')])]);
  await result({ requestId, ok: true });
  assert.deepEqual((await stored('4204')).map(m => [m.external_id, m.author_user_id, m.delivery]), [['42041', null, null], ['4204x', people[ADMIN], 'sent']]);
  assert.deepEqual((await requests()).map(r => r.hostaway_message_id).slice(-1), ['4204x']);
});

test('only the same text from the same team, close in time, is merged', async () => {
  const id = await waiting('4301');
  const { requestId } = await send(ADMIN, id, 'On my way');
  await result({ requestId, ok: true });
  // Different text, a guest message with the same text, an old team message, and another conversation are all kept apart.
  await ingest([conversation('4301', [msg('43011', true, 7), msg('4301a', false, 0.1, 'On my way, see you soon'), msg('4301b', true, 0.1, 'On my way')])]);
  await ingest([conversation('4302', [msg('4302a', true, 7), msg('4302b', false, 0.1, 'On my way')])]);
  assert.deepEqual((await stored('4301')).map(m => m.external_id).sort(), ['43011', '4301a', '4301b', 'app:' + requestId].sort());
  assert.equal((await stored('4302')).length, 2);
  // Over 10 minutes apart: not the same message.
  await sql("update private.workspace_guest_messages set sent_at=now()-interval '11 minutes' where external_id=$1", ['app:' + requestId]);
  await ingest([conversation('4301', [msg('4301c', false, 0.1, 'On my way')])]);
  assert.ok((await stored('4301')).some(m => m.external_id === '4301c') && (await stored('4301')).some(m => m.external_id === 'app:' + requestId));
});

test('only the backend can record a result, nobody signed in can read the requests, and bad results are refused', async () => {
  const id = await waiting();
  const { requestId } = await send(ADMIN, id, 'Hello');
  for (const who of [ADMIN, ANNA]) {
    await as(who);
    await assert.rejects(rpc('workspace_guest_reply_result', [{ requestId, ok: true }]), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_guest_reply_requests'), /permission denied/);
  }
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(rpc('workspace_guest_reply_result', [{ requestId, ok: true }]), /permission denied/);
  await assert.rejects(db.query('select private.workspace_guest_reply_result($1)', [{ requestId, ok: true }]), /permission denied/);
  await assert.rejects(db.query('select private.workspace_guest_reply_begin(null,$1,$2)', [requestId, 'x']), /permission denied/);
  await asBackend();
  for (const bad of [{ ok: true }, { requestId: 'nope', ok: true }, { requestId, ok: 'yes' }, { requestId }, { requestId, ok: true, extra: 1 }, { requestId, ok: true, hostawayMessageId: 'x'.repeat(101) }, { requestId, ok: true, hostawayMessageId: 5 }, { requestId, ok: false, error: 5 }, []])
    await assert.rejects(rpc('workspace_guest_reply_result', [bad]), /Invalid reply result/, JSON.stringify(bad));
  await assert.rejects(rpc('workspace_guest_reply_result', [{ requestId: crypto.randomUUID(), ok: true }]), /Reply request not found/);
  assert.equal((await stored('4101')).length, 1, 'nothing was stored by refused results');
  assert.equal((await requests())[0].status, 'sending');
  // A long error is cut to fit.
  await result({ requestId, ok: false, error: 'e'.repeat(400) });
  assert.equal((await requests())[0].error.length, 300);
});

test('conversations show the tidy Airbnb booking code; stays keep the full reference', async () => {
  const cleanup = (await fs.readFile('supabase/migrations/20261012060000_guest_replies_via_hostaway.sql', 'utf8')).split('\n-- Conversations already stored show the tidy Airbnb booking code.\n')[1];
  await asBackend();
  const stay = (id, ref) => ({ id, listingId: '701', checkIn: `2031-0${id}-10`, checkOut: `2031-0${id}-14`, status: 'confirmed', channel: 'airbnb', channelReference: ref, guests: 2, payoutMinor: 1000 });
  // The same Airbnb booking under two Airbnb accounts: only the full reference tells them apart.
  await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: '701', name: 'Code Cottage', address: '', bedrooms: 1 }], reservations: [
    stay(1, '579754-guest-40852018-confirmation-HMFMWDE8AH'), stay(2, '507365-guest-40852018-confirmation-HMFMWDE8AH'), stay(3, 'HMPLAIN001')] }]);
  const refs = (await sql("select channel_reference from private.workspace_reservations where reference in ('HA:1','HA:2') order by reference")).map(r => r.channel_reference);
  assert.deepEqual(refs, ['579754-guest-40852018-confirmation-HMFMWDE8AH', '507365-guest-40852018-confirmation-HMFMWDE8AH']);
  await ingest([conversation('4401', [msg('44011', true, 5)], { listingId: '701', reservationId: '1' }), conversation('4402', [msg('44021', true, 5)], { listingId: '701', reservationId: '3' })]);
  assert.deepEqual((await sql("select reservation_ref from private.workspace_guest_threads where thread_ref in ('4401','4402') order by thread_ref")).map(r => r.reservation_ref), ['HMFMWDE8AH', 'HMPLAIN001']);
  // Conversations stored before: tidied once.
  await sql("update private.workspace_guest_threads set reservation_ref='473976-guest-651540639-confirmation-HMOLD00001' where thread_ref='4401'");
  await sql("insert into private.workspace_guest_threads(source,thread_ref,reservation_ref) values('manual','manual:keep','ABC-123'),('manual','manual:empty','9-confirmation-')");
  await db.exec(cleanup);
  assert.deepEqual((await sql("select reservation_ref from private.workspace_guest_threads where thread_ref in ('4401','manual:keep','manual:empty') order by thread_ref")).map(r => r.reservation_ref), ['HMOLD00001', '9-confirmation-', 'ABC-123']);
  assert.deepEqual((await sql("select channel_reference from private.workspace_reservations where reference in ('HA:1','HA:2') order by reference")).map(r => r.channel_reference), refs, 'stays untouched');
});
