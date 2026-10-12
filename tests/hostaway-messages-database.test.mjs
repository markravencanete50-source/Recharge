import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Hostaway guest messages as the backend stores them (service role), and what the Guest inbox then reads.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// The live sync is paused for the new business; these tests exercise it switched back on.
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); });

const ADMIN = '95000000-0000-4000-8000-000000000001';
await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [ADMIN, 'messages@example.com']);
await db.query('insert into auth.sessions(id,user_id) values($1,$2)', ['96000000-0000-4000-8000-000000000001', ADMIN]);
await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', ['96000000-0000-4000-8000-000000000001', ADMIN]);
await db.query("update public.workspace_profiles set status='active',role='super_admin',full_name='Messages Admin' where user_id=$1", [ADMIN]);
await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [ADMIN]);
async function asAdmin() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ADMIN, session_id: '96000000-0000-4000-8000-000000000001' })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.exec("delete from private.workspace_guest_messages where source='hostaway';delete from private.workspace_guest_threads where source='hostaway'");
});
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const due = async conversations => { await asBackend(); return rpc('workspace_hostaway_conversations_due', [{ conversations }]); };
const ingest = async conversations => { await asBackend(); return rpc('workspace_hostaway_messages_ingest', [{ conversations }]); };
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const msg = (id, incoming, minutes, body = incoming ? 'Hello, a question' : 'Happy to help') => ({ id: String(id), incoming, body, sentAt: ago(minutes) });
const conversation = (id, messages, extra = {}) => ({ id: String(id), listingId: '', reservationId: '', guestName: 'Alex Kim', checkIn: null, checkOut: null, channel: 'other', marker: `m-${id}`, messages, ...extra });
const thread = async id => (await sql(`select status,property_id,channel,guest_name,reservation_ref,check_in::text check_in,check_out::text check_out,remote_marker,last_message_at from private.workspace_guest_threads where source='hostaway' and thread_ref=$1`, [String(id)]))[0];
const inbox = async (status = 'all') => { await asAdmin(); return rpc('workspace_guest_inbox_read', ['list', null, status]); };

// A property, and a stay at it, as the reservation sync brings them in.
await asBackend();
await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: '501', name: 'Harbour View Flat', address: '1 Quay Street', bedrooms: 2 }],
  reservations: [{ id: '9001', listingId: '501', checkIn: '2030-01-10', checkOut: '2030-01-14', status: 'confirmed', channel: 'booking_com', channelReference: '4455667788', guests: 2, payoutMinor: 30000 }] }]);
const [{ id: HARBOUR }] = await sql("select id from public.workspace_properties where hostaway_listing_id='501'");

test('only the backend can use the message functions, and bad input is refused', async () => {
  await asAdmin();
  await assert.rejects(rpc('workspace_hostaway_conversations_due', [{ conversations: [] }]), /permission denied/);
  await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: [] }]), /permission denied/);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: [] }]), /permission denied/);
  await asBackend();
  await assert.rejects(rpc('workspace_hostaway_conversations_due', [{ conversations: [{ marker: 'x' }] }]), /Invalid conversations/);
  await assert.rejects(rpc('workspace_hostaway_conversations_due', [{ surprise: 1, conversations: [] }]), /Invalid conversations/);
  await assert.rejects(rpc('workspace_hostaway_conversations_due', [{ conversations: Array.from({ length: 501 }, (_, i) => ({ id: String(i) })) }]), /Invalid conversations/);
  for (const bad of [
    conversation('', []), conversation('1', [], { channel: 'telegram' }), conversation('1', [], { checkIn: '10/01/2030' }), conversation('1', [], { guestName: 'x'.repeat(121) }),
    conversation('1', [{ ...msg(1, true, 5), sentAt: 'yesterday' }]), conversation('1', [{ ...msg(1, true, 5), incoming: 'yes' }]), conversation('1', [{ ...msg(1, true, 5), body: 'x'.repeat(20001) }]),
    conversation('1', Array.from({ length: 301 }, (_, i) => msg(i, true, 5))),
  ]) await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: [bad] }]), /Invalid conversations/);
  await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: Array.from({ length: 101 }, (_, i) => conversation(i, [])), extra: 1 }]), /Invalid conversations/);
  await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: Array.from({ length: 101 }, (_, i) => conversation(i, [])) }]), /Invalid conversations/);
  assert.equal((await sql("select count(*)::int n from private.workspace_guest_threads where source='hostaway'"))[0].n, 0, 'nothing stored by refused calls');
});

test('conversations are due when new or when their marker changes', async () => {
  const asked = [{ id: 'd1', marker: 'a|b' }, { id: 'd2', marker: 'c|' }, { id: 'd1', marker: 'a|b' }];
  assert.deepEqual(await due(asked), { due: ['d1', 'd2'], paused: false });
  await ingest([conversation('d1', [msg('d1-1', true, 5)], { marker: 'a|b' })]);
  assert.deepEqual(await due(asked), { due: ['d2'], paused: false }, 'd1 is up to date');
  assert.deepEqual((await due([{ id: 'd1', marker: 'a|b2' }, { id: 'd2', marker: 'c|' }])).due, ['d1', 'd2'], 'a moved marker is due again');
  assert.deepEqual((await due([])).due, []);
  assert.equal((await thread('d1')).remote_marker, 'a|b');
});

test('a conversation lands on its property and stay; the stay wins over the conversation', async () => {
  const result = await ingest([
    conversation('c1', [msg('c1-1', true, 20, 'What time is check in?'), msg('c1-2', false, 15, 'From 3pm')],
      { listingId: '501', reservationId: '9001', channel: 'airbnb', checkIn: '2030-02-01', checkOut: '2030-02-03', guestName: 'Alex Kim' }),
    conversation('c2', [msg('c2-1', true, 10)], { listingId: '777', reservationId: '12345', channel: 'vrbo', checkIn: '2030-03-01', checkOut: '2030-03-04' }),
  ]);
  assert.deepEqual(result, { added: 3, conversations: 2 });
  const c1 = await thread('c1');
  assert.deepEqual([c1.property_id, c1.channel, c1.guest_name, c1.reservation_ref, c1.check_in, c1.check_out, c1.status],
    [HARBOUR, 'booking_com', 'Alex Kim', '4455667788', '2030-01-10', '2030-01-14', 'open']);
  // No listing or stay known: the conversation's own details, and no property yet.
  const c2 = await thread('c2');
  assert.deepEqual([c2.property_id, c2.channel, c2.reservation_ref, c2.check_in, c2.check_out], [null, 'vrbo', null, '2030-03-01', '2030-03-04']);
  assert.deepEqual((await sql("select direction,delivery,body,property_id from private.workspace_guest_messages where source='hostaway' and thread_ref='c1' order by sent_at")).map(m => [m.direction, m.delivery, m.body, m.property_id]),
    [['guest', null, 'What time is check in?', HARBOUR], ['team', 'sent', 'From 3pm', HARBOUR]]);
  const feed = await inbox();
  assert.ok(feed.connected, 'the inbox now shows as connected');
  assert.equal(feed.threads.find(t => t.guestName === 'Alex Kim' && t.propertyName === 'Harbour View Flat').reservationRef, '4455667788');

  // Once the listing is in Recharge a later message fills in the property the thread was missing.
  await asBackend();
  await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: '777', name: 'Old Mill Cottage', address: '', bedrooms: 3 }] }]);
  await ingest([conversation('c2', [msg('c2-2', true, 2, 'Anyone there?')], { listingId: '777', channel: 'vrbo', marker: 'm-c2b' })]);
  const [mill] = await sql("select id from public.workspace_properties where hostaway_listing_id='777'");
  assert.equal((await thread('c2')).property_id, mill.id);
  assert.deepEqual((await sql("select distinct property_id from private.workspace_guest_messages where thread_ref='c2'")).map(r => r.property_id), [mill.id], 'earlier messages follow');
});

test('an old new conversation starts Done; a recent guest message is Waiting until the team replies', async () => {
  await ingest([
    conversation('o1', [msg('o1-1', true, 3 * 1440), msg('o1-2', false, 3 * 1440 - 5)]),
    conversation('o2', [msg('o2-1', true, 3 * 1440)]), // the guest's message went unanswered, but it is old news
    conversation('n1', [msg('n1-1', true, 7)]),
    conversation('n2', [msg('n2-1', true, 23 * 60)]), // under 24 hours: still counts
  ]);
  assert.deepEqual(await Promise.all(['o1', 'o2', 'n1', 'n2'].map(async id => (await thread(id)).status)), ['done', 'done', 'open', 'open']);
  let waiting = await inbox('waiting');
  assert.equal(waiting.threads.length, 2);
  assert.equal(waiting.waiting, 2);
  const n1 = (await sql("select id from private.workspace_guest_threads where thread_ref='n1' and source='hostaway'"))[0].id;
  assert.ok(waiting.threads.some(t => t.id === n1 && t.lastFrom === 'guest' && t.waitingSince));

  // The team answers in Hostaway: the next import carries that reply and the wait ends.
  const reply = await ingest([conversation('n1', [msg('n1-1', true, 7), msg('n1-2', false, 2, 'On my way')], { marker: 'm-n1b' })]);
  assert.equal(reply.added, 1, 'the first message was already stored');
  waiting = await inbox('waiting');
  assert.equal(waiting.waiting, 1);
  assert.ok(!waiting.threads.some(t => t.id === n1));
  assert.equal((await thread('n1')).status, 'open', 'replied, not done');
  const all = (await inbox('all')).threads.find(t => t.id === n1);
  assert.deepEqual([all.lastFrom, all.waitingSince, all.messages], ['team', null, 2]);
});

test('re-importing is idempotent, only 14 days are kept, and Done stays Done until the guest writes again', async () => {
  const first = conversation('r1', [msg('r1-1', true, 30), msg('r1-2', false, 25), msg('r1-old', true, 15 * 1440), msg('r1-future', true, -60)]);
  assert.deepEqual(await ingest([first]), { added: 2, conversations: 1 });
  assert.deepEqual(await ingest([first]), { added: 0, conversations: 1 });
  assert.equal((await sql("select count(*)::int n from private.workspace_guest_messages where thread_ref='r1' and source='hostaway'"))[0].n, 2);
  // Nothing recent and not known: no empty conversation is created.
  assert.deepEqual(await ingest([conversation('r-old', [msg('r-old-1', true, 20 * 1440)])]), { added: 0, conversations: 0 });
  assert.equal(await thread('r-old'), undefined);

  const [{ id }] = await sql("select id from private.workspace_guest_threads where thread_ref='r1' and source='hostaway'");
  await sql("update private.workspace_guest_threads set status='done' where id=$1", [id]);
  await ingest([conversation('r1', [msg('r1-1', true, 30), msg('r1-2', false, 25)], { marker: 'm-r1b' })]);
  assert.equal((await thread('r1')).status, 'done', 'nothing new: stays done');
  assert.equal((await thread('r1')).remote_marker, 'm-r1b');
  await ingest([conversation('r1', [msg('r1-3', false, 3, 'Anything else?')], { marker: 'm-r1c' })]);
  assert.equal((await thread('r1')).status, 'done', 'a team message does not reopen it');
  await ingest([conversation('r1', [msg('r1-4', true, 1, 'One more thing')], { marker: 'm-r1d' })]);
  assert.equal((await thread('r1')).status, 'open', 'the guest writing again does');
});

test('nothing is read or stored while the sync is paused', async () => {
  await db.exec('update private.workspace_hostaway_sync_state set paused=true where singleton');
  try {
    assert.deepEqual(await due([{ id: 'p1', marker: 'x' }]), { due: [], paused: true });
    await asBackend();
    await assert.rejects(rpc('workspace_hostaway_messages_ingest', [{ conversations: [conversation('p1', [msg('p1-1', true, 5)])] }]), /Hostaway sync is paused/);
    assert.equal(await thread('p1'), undefined);
  } finally { await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton'); }
  assert.deepEqual((await due([{ id: 'p1', marker: 'x' }])).due, ['p1']);
});
