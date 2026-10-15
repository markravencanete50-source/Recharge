import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Why guests stay (migration 20261021800000), as the database sees it: the two switches (off to start, admins only),
// the question 3 days before check-in (once per stay, never for owner or cancelled stays, a guard against two workers),
// reading the guest's next reply (and never overwriting a reason), the survey after direct stays with an email only,
// its single-stay link that expires, the report's new figures and the grants. The worker's sends are not made here.
const MIGRATION = 'supabase/migrations/20261021800000_stay_reason.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const R = await vite.ssrLoadModule('/lib/stay-reason.ts');
const policy = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { stayAnalyticsSchema } = await vite.ssrLoadModule('/lib/stay-analytics-view.ts');
const { inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'cleans'];
const users = roles.map((_, i) => `97800000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, CLEANS] = roles.map((_, i) => i);
const session = i => users[i].replace('9780', '9880');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `reason${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam Super', 'Ada Admin', 'Stan Stays', 'Cleo Cleans'][i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); });
const sql = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const one = async (text, args = []) => (await sql(text, args))[0]?.r;
const sync = async reservations => { await asBackend(); return (await db.query('select public.workspace_hostaway_sync($1) r', [{ trigger: 'schedule', listings, reservations }])).rows[0].r; };
const ingest = async conversations => { await asBackend(); return (await db.query('select public.workspace_hostaway_messages_ingest($1) r', [{ conversations }])).rows[0].r; };
const switchTo = async (who, which, on) => { await as(who); return (await db.query('select public.workspace_stay_reason_switch($1) r', [teamsActionSchema.parse({ action: 'setStayReasonSwitch', switch: which, on })])).rows[0].r; };

// Times: London today at 09:30, 10:30 and 12:30 (the job runs from 10:00 and catches up until 12:59).
const at = async (hhmm, days = 0) => one("select ((current_date+$2::int)::timestamp+$1::time) at time zone 'Europe/London' r", [hhmm, days]);
const day = async n => one('select (current_date+$1::int)::text r', [n]);
const due = async (when) => one('select private.workspace_stay_reason_questions_due($1) r', [when]);
const claim = async (input, when) => one('select private.workspace_stay_reason_question_claim($1,$2) r', [input, when]);
const result = async input => { await asBackend(); return (await db.query('select public.workspace_stay_reason_question_result($1) r', [input])).rows[0].r; };
const stayId = async ref => one('select id::text r from private.workspace_reservations where reference=$1', ['HA:' + ref]);
const reasonOf = async ref => (await sql('select stay_reason,stay_reason_from from private.workspace_reservations where reference=$1', ['HA:' + ref]))[0];

const listings = [{ id: '901', name: 'Reason Cottage', address: '1 Loch Road, Oban', bedrooms: 2, accessInfo: '' }];
const stay = (id, checkIn, checkOut, extra = {}) => ({ id, listingId: '901', checkIn, checkOut, status: 'confirmed', channel: 'airbnb', channelReference: 'HM' + id, guests: 2, payoutMinor: 30000, ...extra });
const T10 = await at('10:30'), T09 = await at('09:30'), T12 = await at('12:30'), T13 = await at('13:05');
const D = {}; for (const n of [-3, -2, -1, 0, 1, 2, 3, 5]) D[n] = await day(n);

await sync([
  stay('9101', D[3], D[5], { guestContact: { firstName: 'Morag' } }), // due in 3 days
  stay('9102', D[3], D[5], { channel: 'other', channelReference: 'Owner stay' }), // owner stay
  stay('9103', D[3], D[5], { status: 'cancelled' }), // cancelled
  stay('9104', D[5], await day(7)), // 5 days away: not yet
  stay('9105', D[1], D[3], { guestContact: { firstName: 'Late' } }), // booked late, check-in tomorrow: still asked
  stay('9106', D[0], D[2]), // arrives today: too late
  stay('9107', D[2], D[5], { channel: 'direct', guestContact: { firstName: 'Dora', email: 'Dora.Direct@example.org' } }), // direct, 2 days away
]);
// Conversations: 9101 has one Hostaway says is its own; 9107's last message is the guest's and waits for the team.
const now = () => new Date().toISOString();
await ingest([
  { id: '5101', listingId: '901', reservationId: '9101', guestName: 'Morag Example', checkIn: D[3], checkOut: D[5], channel: 'airbnb', marker: 'a', messages: [{ id: 'g-1', incoming: true, body: 'Thanks for confirming', sentAt: new Date(Date.now() - 3600e3).toISOString() }, { id: 't-1', incoming: false, body: 'You are welcome', sentAt: new Date(Date.now() - 1800e3).toISOString() }] },
  { id: '5107', listingId: '901', reservationId: '9107', guestName: 'Dora Direct', checkIn: D[2], checkOut: D[5], channel: 'direct', marker: 'b', messages: [{ id: 'g-7', incoming: true, body: 'Is there parking?', sentAt: new Date(Date.now() - 600e3).toISOString() }] },
]);

test('the sync keeps a first name for every guest and an email for direct bookings only', async () => {
  const mapped = policy.syncReservation({ id: 9201, listingMapId: 901, channelName: 'direct', status: 'new', arrivalDate: D[3], departureDate: D[5], guestFirstName: 'Ailsa', guestEmail: 'Ailsa@Example.org', currency: 'GBP', totalPrice: 300 });
  assert.deepEqual(mapped.guestContact, { firstName: 'Ailsa', email: 'ailsa@example.org' });
  const airbnb = policy.syncReservation({ id: 9202, listingMapId: 901, channelName: 'airbnbOfficial', status: 'new', arrivalDate: D[3], departureDate: D[5], guestName: 'Rory Example', guestEmail: 'relay@guest.airbnb.com' });
  assert.deepEqual(airbnb.guestContact, { firstName: 'Rory' }, 'no email from another channel');
  assert.equal('guestContact' in policy.syncReservation({ id: 9203, listingMapId: 901, status: 'ownerStay', arrivalDate: D[3], departureDate: D[5], guestFirstName: 'Owner', guestEmail: 'o@example.org' }), false, 'nothing for an owner stay');
  // The database checks again: an email sent for a non-direct stay is not kept.
  await sync([{ ...stay('9204', await day(20), await day(22)), guestContact: { firstName: 'Iona', email: 'iona@example.org' } }]);
  const contacts = await sql("select r.reference,c.first_name,c.email from private.workspace_stay_contacts c join private.workspace_reservations r on r.id=c.reservation_id order by r.reference");
  assert.deepEqual(contacts.map(c => [c.reference, c.first_name, c.email]), [['HA:9101', 'Morag', null], ['HA:9105', 'Late', null], ['HA:9107', 'Dora', 'dora.direct@example.org'], ['HA:9204', 'Iona', null]]);
  const [{ ref }] = await sql("select hostaway_reservation_id ref from private.workspace_guest_threads where thread_ref='5101'");
  assert.equal(ref, '9101', 'a conversation keeps its Hostaway reservation id');
});

test('both switches start off: nothing is due and nothing can be claimed; only admins can switch them, and who and when are kept', async () => {
  assert.deepEqual(await due(T10), { switchedOff: true, stays: [] });
  assert.deepEqual(await claim({ reservationId: await stayId('9101'), conversationId: '5101', body: 'Hi' }, T10), { send: false });
  assert.deepEqual(await one('select private.workspace_stay_surveys_due($1) r', [T10]), { switchedOff: true, stays: [] });
  for (const who of [STAYS, CLEANS]) {
    await as(who);
    await assert.rejects(db.query('select public.workspace_stay_reason_switch($1)', [{ action: 'setStayReasonSwitch', switch: 'ask', on: true }]), /Management access required/);
    await assert.rejects(db.query('select public.workspace_stay_reason_settings()'), /Management access required/);
  }
  await as(ADMIN);
  const off = R.staySwitchesSchema.parse((await db.query('select public.workspace_stay_reason_settings() r')).rows[0].r);
  assert.deepEqual([off.ask.on, off.survey.on, off.ask.changedBy], [false, false, null]);
  assert.equal(teamsReadSchema.safeParse({ section: R.STAY_SWITCHES_SECTION }).success, true);
  const on = R.staySwitchesSchema.parse(await switchTo(ADMIN, 'ask', true));
  assert.deepEqual([on.ask.on, on.ask.changedBy, on.survey.on], [true, 'Ada Admin', false]);
  assert.ok(on.ask.changedAt);
  await as(ADMIN);
  await assert.rejects(db.query('select public.workspace_stay_reason_switch($1)', [{ action: 'setStayReasonSwitch', switch: 'everything', on: true }]), /Choose the switch/);
});

test('the question: 3 days ahead from 10:00, never owner, cancelled, too-late or waiting stays', async () => {
  assert.deepEqual((await due(T09)).stays, [], 'not before 10:00');
  assert.deepEqual((await due(T13)).stays, [], 'not after 12:59');
  const list = (await due(T10)).stays;
  assert.deepEqual(list.map(s => s.hostawayReservationId), ['9105', '9101'], 'tomorrow first; not the owner stay, the cancelled one, 5 days away, today, or the direct stay waiting for an answer');
  const morag = list.find(s => s.hostawayReservationId === '9101');
  assert.deepEqual([morag.conversationId, morag.firstName, morag.propertyName, morag.checkIn], ['5101', 'Morag', 'Reason Cottage', D[3]]);
  assert.equal(list.find(s => s.hostawayReservationId === '9105').conversationId, null, 'no conversation known yet: the worker looks it up');
  // Once the team answers the waiting guest, that stay is due too.
  await ingest([{ id: '5107', listingId: '901', reservationId: '9107', guestName: 'Dora Direct', channel: 'direct', marker: 'b2', messages: [{ id: 't-7', incoming: false, body: 'Yes, free parking', sentAt: now() }] }]);
  assert.deepEqual((await due(T10)).stays.map(s => s.hostawayReservationId), ['9105', '9107', '9101']);
  // The owner and cancelled stays cannot be claimed either.
  // (A stay first seen already cancelled may not be kept at all.)
  for (const ref of ['9102', '9103', '9104', '9106']) {
    const id = await stayId(ref);
    if (id) assert.deepEqual(await claim({ reservationId: id, conversationId: '99', body: 'Hi' }, T10), { send: false }, ref);
  }
});

test('sent once per stay: two workers claim, one sends; the thread shows when it was asked', async () => {
  const id = await stayId('9101');
  const body = R.stayReasonQuestion({ firstName: 'Morag', propertyName: 'Reason Cottage', checkIn: D[3] });
  const [a, b] = await Promise.all([claim({ reservationId: id, conversationId: '5101', body }, T10), claim({ reservationId: id, conversationId: '5101', body }, T10)]);
  assert.deepEqual([a.send, b.send].sort(), [false, true], 'only one claim sends');
  assert.deepEqual(await claim({ reservationId: id, conversationId: '5101', body }, T12), { send: false }, 'still sending: never sent again');
  assert.deepEqual(await result({ reservationId: id, ok: true, messageId: 'hm-501' }), { recorded: true });
  assert.deepEqual(await result({ reservationId: id, ok: true }), { recorded: false });
  assert.deepEqual(await claim({ reservationId: id, conversationId: '5101', body }, T12), { send: false });
  assert.ok(!(await due(T12)).stays.some(s => s.reservationId === id), 'not due again');
  const [msg] = await sql("select body,direction,delivery from private.workspace_guest_messages where source='hostaway' and external_id='hm-501'");
  assert.deepEqual([msg.body, msg.direction, msg.delivery], [body, 'team', 'sent'], 'the question shows on the thread');
  await as(ADMIN);
  const [{ thread_id }] = await sql("select id::text thread_id from private.workspace_guest_threads where thread_ref='5101'");
  await as(ADMIN);
  const read = inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [thread_id])).rows[0].r);
  assert.equal(read.thread.stayReason.reason, null);
  assert.match(R.threadStayReasonLines(read.thread.stayReason)[0], /^Asked reason for stay on \d{1,2} [A-Z][a-z]{2}$/);
  assert.equal(R.threadStayReasonLines(read.thread.stayReason)[1], 'No answer yet');
});

test('a failed send is tried again after an hour, at most 3 times', async () => {
  const id = await stayId('9105');
  assert.deepEqual(await claim({ reservationId: id, conversationId: '5105', body: 'Hi Late' }, T10), { send: true });
  assert.deepEqual(await result({ reservationId: id, ok: false, error: 'Hostaway took too long' }), { recorded: true });
  assert.ok(!(await due(T10)).stays.some(s => s.reservationId === id), 'not straight away');
  assert.ok((await due(T12)).stays.some(s => s.reservationId === id), 'an hour later');
  assert.deepEqual(await claim({ reservationId: id, conversationId: '5105', body: 'Hi Late' }, T12), { send: true });
  assert.deepEqual(await sql('select attempts,status from private.workspace_stay_reason_asks where reservation_id=$1', [id]), [{ attempts: 2, status: 'sending' }]);
  await result({ reservationId: id, ok: true });
});

test('the reply: the next guest message is read once, a reason is never overwritten, anything else is left alone', async () => {
  // 9101: "2." is work; a later "1" changes nothing.
  await ingest([{ id: '5101', listingId: '901', reservationId: '9101', guestName: 'Morag Example', channel: 'airbnb', marker: 'c', messages: [{ id: 'g-2', incoming: true, body: '2.', sentAt: new Date(Date.now() + 1000).toISOString() }] }]);
  assert.deepEqual(await reasonOf('9101'), { stay_reason: 'work', stay_reason_from: 'message' });
  await ingest([{ id: '5101', listingId: '901', reservationId: '9101', guestName: 'Morag Example', channel: 'airbnb', marker: 'd', messages: [{ id: 'g-3', incoming: true, body: '1', sentAt: new Date(Date.now() + 2000).toISOString() }] }]);
  assert.deepEqual(await reasonOf('9101'), { stay_reason: 'work', stay_reason_from: 'message' }, 'never overwritten');
  await as(ADMIN);
  const [{ thread_id }] = await sql("select id::text thread_id from private.workspace_guest_threads where thread_ref='5101'");
  await as(ADMIN);
  const read = inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [thread_id])).rows[0].r);
  assert.equal(R.threadStayReasonLines(read.thread.stayReason)[1], 'Reason for stay: Work');
  // 9105 (its conversation 5105, not imported until now): a question back is left for the team, and a later "1" is not read.
  await ingest([{ id: '5105', listingId: '901', reservationId: '9105', guestName: 'Late Guest', channel: 'airbnb', marker: 'e', messages: [{ id: 'g-5', incoming: true, body: 'Can we check in early?', sentAt: new Date(Date.now() + 1000).toISOString() }] }]);
  await ingest([{ id: '5105', listingId: '901', reservationId: '9105', guestName: 'Late Guest', channel: 'airbnb', marker: 'f', messages: [{ id: 'g-6', incoming: true, body: '1', sentAt: new Date(Date.now() + 2000).toISOString() }] }]);
  assert.deepEqual(await reasonOf('9105'), { stay_reason: null, stay_reason_from: null });
  const [ask] = await sql("select reply_reason,reply_checked_at is not null checked from private.workspace_stay_reason_asks a join private.workspace_reservations r on r.id=a.reservation_id where r.reference='HA:9105'");
  assert.deepEqual(ask, { reply_reason: null, checked: true });
});

test('the reply parser in the database matches the app', async () => {
  const cases = ['1', '1.', '1 holiday', '1) Holiday', 'Holiday', 'holiday!', 'HOLIDAY thanks', 'work', '2 - Work!', 'business trip', '3', '3 visiting family or friends', 'Visiting family', 'friends',
    '4', '4 an event', 'An event.', '5', '5 something else', 'something else', '6', '0', '12', '1 work', '1st', 'Hi! 1', 'thanks', '', '  2  ', 'We are here for a wedding and some sightseeing', 'Can we check in early?'];
  for (const c of cases) assert.equal(await one('select private.workspace_stay_reason_parse($1) r', [c]), R.parseStayReason(c), JSON.stringify(c));
});

test('switched off, nothing more is sent', async () => {
  await switchTo(SUPER, 'ask', false);
  assert.deepEqual(await due(T10), { switchedOff: true, stays: [] });
  assert.deepEqual(await claim({ reservationId: await stayId('9107'), conversationId: '5107', body: 'Hi Dora' }, T10), { send: false });
  const [s] = await sql('select ask_enabled,ask_changed_by::text by from private.workspace_stay_reason_settings');
  assert.deepEqual(s, { ask_enabled: false, by: users[SUPER] });
});

test('the survey: direct stays with an email only, the day after checkout, once, with a link for that stay only', async () => {
  await sync([
    stay('9301', D[-3], D[-1], { channel: 'direct', guestContact: { firstName: 'Fiona', email: 'fiona@example.org' } }), // due
    stay('9302', D[-3], D[-1], { channel: 'direct' }), // no email
    stay('9303', D[-3], D[-1], { guestContact: { firstName: 'Hamish', email: 'hamish@example.org' } }), // Airbnb
    stay('9304', D[-2], D[0], { channel: 'direct', guestContact: { email: 'today@example.org' } }), // checks out today
    stay('9305', D[-3], D[-1], { channel: 'direct', status: 'cancelled', guestContact: { email: 'gone@example.org' } }),
  ]);
  await as(STAYS);
  await assert.rejects(db.query('select public.workspace_stay_reason_switch($1)', [{ action: 'setStayReasonSwitch', switch: 'survey', on: true }]), /Management access required/);
  await switchTo(ADMIN, 'survey', true);
  const surveysDue = async when => one('select private.workspace_stay_surveys_due($1) r', [when]);
  assert.deepEqual((await surveysDue(T09)).stays, []);
  const list = (await surveysDue(T10)).stays;
  assert.deepEqual(list.map(s => [s.email, s.firstName, s.propertyName, s.checkOut]), [['fiona@example.org', 'Fiona', 'Reason Cottage', D[-1]]]);
  const id = list[0].reservationId;
  const hash = createHash('sha256').update('f'.repeat(64)).digest('hex');
  const surveyClaim = async (input, when = T10) => one('select private.workspace_stay_survey_claim($1,$2) r', [input, when]);
  const [a, b] = await Promise.all([surveyClaim({ reservationId: id, tokenHash: hash }), surveyClaim({ reservationId: id, tokenHash: hash })]);
  assert.deepEqual([a.send, b.send].sort(), [false, true]);
  await asBackend();
  assert.deepEqual((await db.query('select public.workspace_stay_survey_result($1) r', [{ reservationId: id, ok: true }])).rows[0].r, { recorded: true });
  assert.deepEqual((await surveysDue(T12)).stays, [], 'sent once');
  // A link belongs to one stay.
  await sync([stay('9306', D[-3], D[-1], { channel: 'direct', guestContact: { email: 'other@example.org' } })]);
  const other = await stayId('9306');
  await assert.rejects(surveyClaim({ reservationId: other, tokenHash: hash }), /Invalid survey/);
  assert.equal(await sql("select 1 from private.workspace_stay_surveys where reservation_id=$1", [other]).then(r => r.length), 0);
});

test('the survey page: only the property and the dates; the answer is kept; the link expires after 30 days', async () => {
  const hash = createHash('sha256').update('f'.repeat(64)).digest('hex');
  const page = async (input, when = null) => { await asBackend(); return (await db.query(when ? 'select private.workspace_stay_survey_public($1,$2) r' : 'select public.workspace_stay_survey_public($1) r', when ? [input, when] : [input])).rows[0].r; };
  const open = await page({ action: 'open', tokenHash: hash });
  assert.deepEqual(open, { state: 'open', propertyName: 'Reason Cottage', checkIn: D[-3], checkOut: D[-1] }, 'nothing else');
  await assert.rejects(page({ action: 'open', tokenHash: createHash('sha256').update('0'.repeat(64)).digest('hex') }), /This link isn’t working/);
  await assert.rejects(page({ action: 'answer', tokenHash: hash, rating: 6 }), /Choose a rating from 1 to 5/);
  await assert.rejects(page({ action: 'answer', tokenHash: hash, reason: 'shopping' }), /Choose what brought you here/);
  await assert.rejects(page({ action: 'answer', tokenHash: hash }), /Choose an answer/);
  assert.equal(R.surveyAnswerSchema.safeParse({ token: 'f'.repeat(64) }).success, false);
  // One tap (the rating), then the reason and a comment.
  assert.deepEqual(await page({ action: 'answer', tokenHash: hash, rating: 4 }), { state: 'thanks', propertyName: 'Reason Cottage', checkIn: D[-3], checkOut: D[-1] });
  await page({ action: 'answer', tokenHash: hash, reason: 'event', comment: '  Lovely views  ' });
  const [kept] = await sql("select v.rating,v.reason,v.comment,v.answered_at is not null answered,r.stay_reason,r.stay_reason_from from private.workspace_stay_surveys v join private.workspace_reservations r on r.id=v.reservation_id where r.reference='HA:9301'");
  assert.deepEqual(kept, { rating: 4, reason: 'event', comment: 'Lovely views', answered: true, stay_reason: 'event', stay_reason_from: 'survey' });
  // The survey's reason never replaces one already known.
  await sql("update private.workspace_reservations set stay_reason='holiday',stay_reason_from='message' where reference='HA:9301'");
  await page({ action: 'answer', tokenHash: hash, reason: 'work' });
  assert.deepEqual(await reasonOf('9301'), { stay_reason: 'holiday', stay_reason_from: 'message' });
  await sql("update private.workspace_reservations set stay_reason='event',stay_reason_from='survey' where reference='HA:9301'");
  // 30 days on, the link says only that it has expired.
  const later = await one("select now()+interval '31 days' r");
  assert.deepEqual(await page({ action: 'open', tokenHash: hash }, later), { state: 'expired' });
  assert.deepEqual(await page({ action: 'answer', tokenHash: hash, rating: 1 }, later), { state: 'expired' });
  assert.equal(await one("select rating r from private.workspace_stay_surveys where token_hash=$1", [hash]), 4, 'an expired link changes nothing');
});

test('the report: why they stay, the average rating and the survey replies, names-free', async () => {
  await as(ADMIN);
  const r = stayAnalyticsSchema.parse((await db.query('select public.workspace_stay_analytics($1,$2) r', [D[-3], D[5]])).rows[0].r);
  // Confirmed, not owner: 9101 (work), 9104, 9105, 9106, 9107, 9301 (event), 9302, 9303, 9304, 9306, and 9204 is outside the dates.
  assert.equal(r.stays, 10);
  assert.deepEqual(r.reasons, { known: 2, counts: [{ reason: 'holiday', stays: 0 }, { reason: 'work', stays: 1 }, { reason: 'family_friends', stays: 0 }, { reason: 'event', stays: 1 }, { reason: 'other', stays: 0 }] });
  assert.deepEqual(r.rating, { known: 1, average: 4 });
  assert.deepEqual(r.survey, { sent: 1, answered: 1 });
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /Morag|Fiona|example\.org|Lovely|HA:|HM9/, 'no names, emails, comments or references');
});

test('grants: the worker functions are for the service role only, the switches for signed-in admins', async () => {
  for (const who of [ADMIN, STAYS]) {
    await as(who);
    for (const call of ['public.workspace_stay_reason_questions_due()', "public.workspace_stay_reason_question_claim('{}')", "public.workspace_stay_reason_question_result('{}')",
      'public.workspace_stay_surveys_due()', "public.workspace_stay_survey_claim('{}')", "public.workspace_stay_survey_result('{}')", "public.workspace_stay_survey_public('{}')",
      "private.workspace_stay_reason_parse('1')", "private.workspace_store_stay_contact(gen_random_uuid(),'{}')"]) {
      await assert.rejects(db.query(`select ${call}`), /permission denied/, call);
    }
  }
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_stay_reason_settings()'), /permission denied/);
  await assert.rejects(db.query("select public.workspace_stay_survey_public('{}')"), /permission denied/);
  for (const t of ['workspace_stay_reason_asks', 'workspace_stay_surveys', 'workspace_stay_contacts', 'workspace_stay_reason_settings']) {
    await as(ADMIN);
    await assert.rejects(db.query(`select * from private.${t}`), /permission denied/, t);
  }
});

test('the migration runs twice, patches each function once and has no DROP or DELETE', async () => {
  const text = await fs.readFile(MIGRATION, 'utf8');
  await db.exec('reset role'); await db.exec(text); await db.exec(text);
  const def = async sig => one('select pg_get_functiondef($1::regprocedure) r', [sig]);
  const count = (s, part) => s.split(part).length - 1;
  const syncDef = await def('private.workspace_hostaway_sync(jsonb)');
  assert.equal(count(syncDef, 'workspace_store_stay_contact(res.id'), 1);
  assert.equal(count(syncDef, 'workspace_store_stay_details(res.id'), 1, 'the stay details patch on the same anchor is still there once');
  assert.equal(count(syncDef, 'touched:=touched||res.property_id;'), 1, 'the anchor is kept for later patches');
  assert.equal(count(await def('private.workspace_hostaway_messages_ingest(jsonb)'), 'set hostaway_reservation_id='), 1);
  assert.equal(count(await def('private.guest_thread_json(private.workspace_guest_threads)'), "'stayReason'"), 1);
  const analytics = await def('private.workspace_stay_analytics(date,date,uuid,text)');
  assert.equal(count(analytics, "'reasons'"), 1);
  assert.equal(count(analytics, 'r.stay_reason,'), 1);
  assert.equal(await one("select count(*)::int r from pg_trigger where tgname='workspace_stay_reason_reply'"), 1);
  assert.equal(await one('select count(*)::int r from private.workspace_stay_reason_settings'), 1);
  assert.doesNotMatch(text.replace(/^--.*$/gm, ''), /\b(drop|delete)\b/i);
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'CRLF line endings');
  assert.doesNotMatch(text.replace(/^--.*$/gm, ''), /—/);
  // Still syncs and imports after running twice.
  assert.deepEqual((await sync([stay('9401', await day(40), await day(42), { guestContact: { firstName: 'Skye' } })])).problems, []);
  await sync([stay('9101', D[3], D[5], { guestContact: { firstName: 'Morag' } })]);
  assert.deepEqual(await reasonOf('9101'), { stay_reason: 'work', stay_reason_from: 'message' }, 'a sync never clears the reason');
});
