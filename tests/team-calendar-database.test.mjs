import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Team calendar (ask A9): the guest's name on a stay for staff other than cleaners (matched on the booking
// code, else on property and dates), and team events (absences, meetings and so on) the whole team can see.
// Every other migration is applied first; this one is applied from its .sql (or its .sql.draft while it is
// being developed) twice, to prove it is safe to run again.
const MINE = '20261012210000_team_calendar';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = await fs.readdir('supabase/migrations');
// Later migrations that replace this one's functions have their own tests (who may edit, 20261014300000:
// tests/team-calendar-edits-database.test.mjs; the guest name without the date match, 20261014330000:
// tests/stay-guest-name-database.test.mjs); this file proves the original migration on its own. Later migrations whose SQL
// functions call this one's (Recharge invoices, 20261022100000: tests/recharge-invoices-database.test.mjs) cannot load before it.
const REPLACED_BY = ['20261014300000_team_calendar_anyone_edits', '20261014330000_stay_guest_name_dates', '20261022100000_recharge_invoices'];
for (const file of files.filter(f => f.endsWith('.sql') && !f.startsWith(MINE) && !REPLACED_BY.some(r => f.startsWith(r))).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const mineFile = files.find(f => f === MINE + '.sql') ?? files.find(f => f === MINE + '.sql.draft');
assert.ok(mineFile, 'the team calendar migration exists');
const mine = await fs.readFile('supabase/migrations/' + mineFile, 'utf8');
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def.replaceAll(String.fromCharCode(13), '');
const count = (text, part) => text.split(part).length - 1;
const READ = 'private.workspace_teams_read(text,date,date,uuid,uuid)';
const ACTION = 'private.workspace_teams_action(jsonb)';
const ANCHORS = [
  [READ, "'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,"],
  [READ, "elsif section='hub' then result:=private.workspace_hub_read();"],
  [ACTION, "if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;"],
];
const anchorsBefore = [];
for (const [sig, anchor] of ANCHORS) anchorsBefore.push(count(await definition(sig), anchor));
await db.exec(mine);
const afterFirst = [await definition(READ), await definition(ACTION)];
await db.exec(mine);
const afterSecond = [await definition(READ), await definition(ACTION)];
after(() => db.close());

const roles = ['admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client', 'cleans', 'admin', 'stays'];
const users = roles.map((_, i) => `97100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9710', '9720');
const [ADMIN, STAYS, CLEANER, MANAGER, READY, ACCOUNTS, OWNER, OTHER_CLEANER, OTHER_ADMIN, OTHER_STAYS] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `teamcal${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const schedule = (from, to) => rpc('workspace_teams_read', ['schedule', from, to, null, null]);
const events = (from, to) => rpc('workspace_teams_read', ['teamEvents', from, to, null, null]);
const act = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Calendar flat', address: 'Example calendar address', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [MANAGER, 'cleaning_manager'], [READY, 'staff'], [OWNER, 'client'], [OTHER_CLEANER, 'cleaner'], [OTHER_ADMIN, 'staff'], [OTHER_STAYS, 'staff']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const WINDOW = [iso(-5), iso(40)];

let stayNumber = 0;
const stay = async (checkIn, checkOut, extra = {}) => {
  stayNumber++;
  const { channel = 'airbnb', code = 'HMCODE' + stayNumber, reference = 'Stay ' + stayNumber } = extra;
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,guests,created_by)
    values($1,$2,$3,$4,'confirmed','manual',$5,$6,2,$7) returning id`, [property, reference, checkIn, checkOut, channel, code, users[ADMIN]]))[0].id;
};
const thread = (ref, guestName, extra = {}) => sql(`insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,reservation_ref,check_in,check_out,last_message_at)
  values('hostaway',$1,$2,'airbnb',$3,$4,$5,$6,$7)`, [crypto.randomUUID(), extra.property === null ? null : property, guestName, ref, extra.checkIn ?? null, extra.checkOut ?? null, extra.last ?? new Date().toISOString()]);
const guestOf = async (who, reservationId) => {
  await as(who);
  return (await schedule(...WINDOW)).stays.find(s => s.reservationId === reservationId);
};

test('anchors occur once, the patches landed once, and the migration runs twice without change', () => {
  assert.deepEqual(anchorsBefore, [1, 1, 1], 'each anchor occurred exactly once before this migration');
  assert.equal(count(afterFirst[0], "'guestName',case when private.workspace_guest_name_visible(actor)"), 1);
  assert.equal(count(afterFirst[0], "section='teamEvents'"), 1);
  assert.equal(count(afterFirst[1], "'saveTeamEvent','cancelTeamEvent'"), 1);
  assert.deepEqual(afterSecond, afterFirst, 'a second run changes nothing');
  assert.ok(afterFirst[0].includes(ANCHORS[0][1] + "'guestName'"), 'the anchor stays first in its replacement');
  assert.ok(afterFirst[0].includes(ANCHORS[1][1] + '\n elsif section=\'teamEvents\''), 'the route follows its anchor');
});

test('a second run of the migration leaves the tables, rows and indexes as they were', async () => {
  const before = (await sql("select count(*)::int n from pg_indexes where indexname like 'workspace_team_events%' or indexname like 'workspace_guest_threads_%'"))[0].n;
  await db.exec(mine);
  assert.equal((await sql("select count(*)::int n from pg_indexes where indexname like 'workspace_team_events%' or indexname like 'workspace_guest_threads_%'"))[0].n, before);
  assert.equal((await sql("select count(*)::int n from pg_trigger where tgrelid='private.workspace_team_events'::regclass and tgname='business_write_limit'"))[0].n, 1);
  assert.equal((await sql("select relrowsecurity from pg_class where oid='private.workspace_team_events'::regclass"))[0].relrowsecurity, true);
});

test('the guest name shows for staff other than cleaners, and never for owners, cleaners or owner stays', async () => {
  await asDatabase();
  const id = await stay(iso(3), iso(6), { code: 'HM-NAME-1' });
  await thread('HM-NAME-1', 'Sam Guest');
  for (const who of [ADMIN, STAYS, READY, OTHER_STAYS, OTHER_ADMIN]) assert.equal((await guestOf(who, id))?.guestName, 'Sam Guest', roles[who] + ' sees the name');
  // The cleaning manager is on the cleaning side: no name.
  assert.equal((await guestOf(MANAGER, id))?.guestName ?? null, null);
  for (const who of [CLEANER, OTHER_CLEANER]) {
    await as(who);
    const read = await schedule(...WINDOW);
    assert.deepEqual(read.stays, [], 'cleaners get no stays, so no names');
    assert.ok(!JSON.stringify(read).includes('Sam Guest'), 'the name is nowhere in a cleaner schedule');
  }
  await as(OWNER);
  const owner = await schedule(...WINDOW);
  assert.ok(!JSON.stringify(owner).includes('Sam Guest'), 'the name is nowhere in an owner schedule');
  assert.ok(owner.stays.every(s => s.guestName == null));
  await as(ACCOUNTS);
  const accounts = await schedule(...WINDOW);
  assert.equal(accounts.stays.find(s => s.reservationId === id)?.guestName, 'Sam Guest', 'accounts is staff other than a cleaner');
});

test('an owner stay never carries a name, even when a conversation matches its dates', async () => {
  await asDatabase();
  const id = await stay(iso(10), iso(12), { channel: 'other', code: 'Owner stay', reference: 'Owner stay Nov' });
  await thread(null, 'Owner Person', { checkIn: iso(10), checkOut: iso(12) });
  await thread('Owner stay', 'Owner Person Too');
  assert.equal((await sql('select private.workspace_stay_guest_name($1) name', [id]))[0].name, null);
  assert.equal((await guestOf(ADMIN, id))?.guestName ?? null, null);
});

test('threads match on the booking code first, then on property and dates', async () => {
  await asDatabase();
  const byCode = await stay(iso(14), iso(16), { code: 'HM-CODE-A' });
  // The conversation for another set of dates still matches on the code (a changed booking).
  await thread('HM-CODE-A', 'Code Guest', { checkIn: iso(30), checkOut: iso(31) });
  // A conversation on the same dates but without the code loses to the code.
  await thread(null, 'Dates Guest', { checkIn: iso(14), checkOut: iso(16) });
  assert.equal((await guestOf(STAYS, byCode)).guestName, 'Code Guest');

  // Hostaway's long reference is tidied to the booking code in the conversation.
  const tidy = await stay(iso(17), iso(18), { code: 'airbnb-confirmation-HMTIDY1' });
  await thread('HMTIDY1', 'Tidy Guest');
  assert.equal((await guestOf(STAYS, tidy)).guestName, 'Tidy Guest');

  // Lower case in the thread still matches.
  const lower = await stay(iso(19), iso(20), { code: 'HMLOWER9' });
  await thread('hmlower9', 'Lower Guest');
  assert.equal((await guestOf(STAYS, lower)).guestName, 'Lower Guest');

  // No code on the conversation: the same property and dates.
  const byDates = await stay(iso(21), iso(24), { code: 'HM-NOCODE' });
  await thread(null, 'Dates Only', { checkIn: iso(21), checkOut: iso(24) });
  assert.equal((await guestOf(STAYS, byDates)).guestName, 'Dates Only');

  // Different dates and no code: unknown.
  const unknown = await stay(iso(25), iso(27), { code: 'HM-UNKNOWN' });
  await thread(null, 'Elsewhere', { checkIn: iso(26), checkOut: iso(28) });
  assert.equal((await guestOf(STAYS, unknown)).guestName ?? null, null);

  // A conversation carrying another confirmed stay's code is not borrowed by date.
  const first = await stay(iso(33), iso(35), { code: 'HM-FIRST' });
  const second = await stay(iso(33), iso(35), { code: 'HM-SECOND' });
  await thread('HM-FIRST', 'First Guest', { checkIn: iso(33), checkOut: iso(35) });
  assert.equal((await guestOf(STAYS, first)).guestName, 'First Guest');
  assert.equal((await guestOf(STAYS, second)).guestName ?? null, null, 'the other stay does not take the name');

  // Another property's conversation on the same code is not used.
  await as(ADMIN);
  const elsewhere = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Elsewhere flat', address: 'Example elsewhere address', region: 'Glasgow', bedrooms: 1 }]);
  await asDatabase();
  const lonely = await stay(iso(36), iso(37), { code: 'HM-LONELY' });
  await sql("insert into private.workspace_guest_threads(source,thread_ref,property_id,guest_name,reservation_ref,last_message_at) values('hostaway',$1,$2,'Wrong House','HM-LONELY',now())", [crypto.randomUUID(), elsewhere]);
  assert.equal((await guestOf(STAYS, lonely)).guestName ?? null, null);
  // A conversation not yet placed on any property still matches on the code.
  const unplaced = await stay(iso(38), iso(39), { code: 'HM-UNPLACED' });
  await thread('HM-UNPLACED', 'Unplaced Guest', { property: null });
  assert.equal((await guestOf(STAYS, unplaced)).guestName, 'Unplaced Guest');
});

test('the newest conversation wins when two carry the same code', async () => {
  await asDatabase();
  const id = await stay(iso(39), iso(40), { code: 'HM-TWICE' });
  await thread('HM-TWICE', 'Old Name', { last: new Date(Date.now() - 86400000).toISOString() });
  await thread('HM-TWICE', 'New Name', { last: new Date().toISOString() });
  assert.equal((await guestOf(ADMIN, id)).guestName, 'New Name');
});

test('a date match gives a name only when it is not ambiguous, and never when a conversation carries the stay\'s code', async () => {
  await asDatabase();
  const nameOf = async id => (await sql('select private.workspace_stay_guest_name($1) name', [id]))[0].name;
  // The reviewer's case: a direct stay with no booking code, and an enquiry on the same dates.
  const direct = await stay(iso(7), iso(9), { channel: 'direct', code: null, reference: 'Direct 7' });
  await thread(null, 'Enquiry Only Ed', { checkIn: iso(7), checkOut: iso(9) });
  assert.equal(await nameOf(direct), 'Enquiry Only Ed', 'one conversation on the dates still names the stay');
  // A second enquiry on the same dates: which one booked is unknown, so no name.
  await thread(null, 'Another Enquirer', { checkIn: iso(7), checkOut: iso(9) });
  assert.equal(await nameOf(direct), null, 'ambiguous dates give no name');
  assert.equal((await guestOf(STAYS, direct))?.guestName ?? null, null);
  // Two conversations from the same guest are not ambiguous.
  const twice = await stay(iso(1), iso(2), { channel: 'direct', code: null, reference: 'Direct 1' });
  await thread(null, 'Tina Twice', { checkIn: iso(1), checkOut: iso(2) });
  await thread(null, 'Tina Twice', { checkIn: iso(1), checkOut: iso(2) });
  assert.equal(await nameOf(twice), 'Tina Twice');
  // The stay's own conversation exists but carries no name yet: the dates are not used to guess one.
  const coded = await stay(iso(31), iso(32), { code: 'HM-UNNAMED' });
  await thread('HM-UNNAMED', null);
  await thread(null, 'Date Dora', { checkIn: iso(31), checkOut: iso(32) });
  assert.equal(await nameOf(coded), null, 'a stay with a code-matching conversation never borrows a name by date');
});

test('team events: your own are saved, read by the whole team and cancelled; owners never see them', async () => {
  await as(STAYS);
  const made = await act({ action: 'saveTeamEvent', kind: 'absence', title: 'Annual leave', startsOn: iso(2), endsOn: iso(4) });
  assert.equal(made.version, 1);
  assert.equal(made.userId, users[STAYS]);
  const timed = await act({ action: 'saveTeamEvent', kind: 'meeting', title: 'Owner call', startsOn: iso(3), endsOn: iso(3), startTime: '10:30', endTime: '11:15', location: 'Office' });
  for (const who of [ADMIN, STAYS, CLEANER, MANAGER, READY, ACCOUNTS, OTHER_CLEANER]) {
    await as(who);
    const read = await events(iso(0), iso(10));
    assert.equal(read.canEditAll, who === ADMIN);
    const leave = read.events.find(e => e.id === made.id);
    assert.ok(leave, roles[who] + ' sees where the team is');
    assert.deepEqual([leave.fullName, leave.role, leave.kind, leave.title, leave.startsOn, leave.endsOn, leave.startTime, leave.endTime, leave.mine],
      ['Person ' + STAYS, 'stays', 'absence', 'Annual leave', iso(2), iso(4), null, null, who === STAYS]);
    const call = read.events.find(e => e.id === timed.id);
    assert.deepEqual([call.startTime, call.endTime, call.location], ['10:30', '11:15', 'Office']);
    assert.deepEqual(read.events.map(e => e.id), [made.id, timed.id], 'in date order');
  }
  await as(OWNER);
  await assert.rejects(events(iso(0), iso(10)), /Team access required/);
  await assert.rejects(act({ action: 'saveTeamEvent', kind: 'absence', title: 'Owner away', startsOn: iso(2), endsOn: iso(3) }), /Team access required/);
  assert.ok(!JSON.stringify(await schedule(...WINDOW)).includes('Annual leave'), 'the owner schedule carries no team events');

  await as(STAYS);
  const cancelled = await act({ action: 'cancelTeamEvent', id: made.id });
  assert.deepEqual([cancelled.cancelled, cancelled.version], [true, 2]);
  assert.deepEqual((await events(iso(0), iso(10))).events.map(e => e.id), [timed.id], 'a cancelled event leaves the calendar');
  const again = await act({ action: 'cancelTeamEvent', id: made.id });
  assert.equal(again.version, 2, 'cancelling twice changes nothing more');
  const row = (await sql('select cancelled_at,cancelled_by from private.workspace_team_events where id=$1', [made.id]))[0];
  assert.ok(row.cancelled_at && row.cancelled_by === users[STAYS], 'the row stays on record, soft cancelled');
});

test('cleaners keep their own events, and nobody changes another person\'s unless an admin', async () => {
  await as(CLEANER);
  const mineEvent = await act({ action: 'saveTeamEvent', kind: 'away', title: 'Dentist', startsOn: iso(5), endsOn: iso(5), startTime: '09:00' });
  const edited = await act({ action: 'saveTeamEvent', id: mineEvent.id, version: 1, kind: 'away', title: 'Dentist and back', startsOn: iso(5), endsOn: iso(5), startTime: '09:00', endTime: '12:00' });
  assert.equal(edited.version, 2);
  await assert.rejects(act({ action: 'saveTeamEvent', id: mineEvent.id, version: 1, kind: 'away', title: 'Stale edit', startsOn: iso(5), endsOn: iso(5) }), /Changed by someone else/);

  for (const who of [STAYS, OTHER_CLEANER, MANAGER, READY, ACCOUNTS]) {
    await as(who);
    await assert.rejects(act({ action: 'saveTeamEvent', id: mineEvent.id, kind: 'away', title: 'Not mine', startsOn: iso(5), endsOn: iso(5) }), /only change your own/, roles[who] + ' cannot edit it');
    await assert.rejects(act({ action: 'cancelTeamEvent', id: mineEvent.id }), /only cancel your own/, roles[who] + ' cannot cancel it');
    await assert.rejects(act({ action: 'saveTeamEvent', userId: users[CLEANER], kind: 'away', title: 'For someone', startsOn: iso(6), endsOn: iso(6) }), /only add your own/, roles[who] + ' cannot add one for another person');
  }
  assert.equal((await sql('select title from private.workspace_team_events where id=$1', [mineEvent.id]))[0].title, 'Dentist and back');

  // Admins can change and cancel anyone's, and add one for anyone; the person is told.
  await as(ADMIN);
  const changed = await act({ action: 'saveTeamEvent', id: mineEvent.id, kind: 'training', title: 'First aid course', startsOn: iso(5), endsOn: iso(6) });
  assert.equal(changed.userId, users[CLEANER], 'it stays with the cleaner');
  await assert.rejects(act({ action: 'saveTeamEvent', id: mineEvent.id, userId: users[STAYS], kind: 'training', title: 'First aid course', startsOn: iso(5), endsOn: iso(6) }), /stays with the person/);
  const forOther = await act({ action: 'saveTeamEvent', userId: users[STAYS], kind: 'training', title: 'Fire safety', startsOn: iso(8), endsOn: iso(8) });
  assert.equal(forOther.userId, users[STAYS]);
  await assert.rejects(act({ action: 'saveTeamEvent', userId: users[OWNER], kind: 'other', title: 'Owner thing', startsOn: iso(8), endsOn: iso(8) }), /Choose someone on the team/);
  await assert.rejects(act({ action: 'saveTeamEvent', userId: crypto.randomUUID(), kind: 'other', title: 'Nobody', startsOn: iso(8), endsOn: iso(8) }), /Choose someone on the team/);
  await act({ action: 'cancelTeamEvent', id: forOther.id });
  const told = await sql(`select o.user_id,a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    where a.event_type in ('team.event_set','team.event_cancelled') order by a.id`);
  assert.deepEqual(told.map(r => [r.user_id, r.event_type]), [
    [users[CLEANER], 'team.event_set'], [users[STAYS], 'team.event_set'], [users[STAYS], 'team.event_cancelled'],
  ]);
  // A cancelled event cannot be edited.
  await assert.rejects(act({ action: 'saveTeamEvent', id: forOther.id, kind: 'training', title: 'Fire safety', startsOn: iso(8), endsOn: iso(8) }), /was cancelled/);
  // A second admin can cancel too, and an unknown id is not found.
  await as(OTHER_ADMIN);
  assert.equal((await act({ action: 'cancelTeamEvent', id: mineEvent.id })).cancelled, true);
  await assert.rejects(act({ action: 'cancelTeamEvent', id: crypto.randomUUID() }), /Event not found/);
});

test('saving twice with the same request is one event, and overlapping duplicates are allowed', async () => {
  await as(STAYS);
  const requestId = crypto.randomUUID();
  const input = { action: 'saveTeamEvent', requestId, kind: 'meeting', title: 'Stand-up', startsOn: iso(1), endsOn: iso(1) };
  const first = await rpc('workspace_teams_action', [input]);
  const replay = await rpc('workspace_teams_action', [input]);
  assert.deepEqual(replay, first);
  assert.equal((await sql('select count(*)::int n from private.workspace_team_events where title=$1', ['Stand-up']))[0].n, 1);
  await as(STAYS);
  await assert.rejects(rpc('workspace_teams_action', [{ ...input, title: 'Stand-up changed' }]), /Request identifier reused/);
  // The same cancel replayed answers the same.
  const cancelRequest = { action: 'cancelTeamEvent', requestId: crypto.randomUUID(), id: first.id };
  const cancelled = await rpc('workspace_teams_action', [cancelRequest]);
  assert.deepEqual(await rpc('workspace_teams_action', [cancelRequest]), cancelled);
  // Two identical overlapping events are both kept.
  const one = await act({ action: 'saveTeamEvent', kind: 'meeting', title: 'Overlap', startsOn: iso(7), endsOn: iso(8), startTime: '09:00', endTime: '10:00' });
  const two = await act({ action: 'saveTeamEvent', kind: 'meeting', title: 'Overlap', startsOn: iso(7), endsOn: iso(8), startTime: '09:00', endTime: '10:00' });
  assert.notEqual(one.id, two.id);
  assert.equal((await events(iso(7), iso(8))).events.filter(e => e.title === 'Overlap').length, 2);
});

test('the read window is capped at 62 days and shows only what touches it', async () => {
  await as(STAYS);
  await act({ action: 'saveTeamEvent', kind: 'absence', title: 'Long leave', startsOn: iso(20), endsOn: iso(60) });
  await act({ action: 'saveTeamEvent', kind: 'training', title: 'Far away', startsOn: iso(200), endsOn: iso(201) });
  assert.equal((await events(iso(0), iso(62))).events.filter(e => ['Long leave', 'Far away'].includes(e.title)).length, 1, '62 days is allowed');
  assert.deepEqual((await events(iso(55), iso(56))).events.map(e => e.title).filter(t => t === 'Long leave'), ['Long leave'], 'an event spanning the window shows');
  assert.deepEqual((await events(iso(70), iso(71))).events.map(e => e.title).filter(t => ['Long leave', 'Far away'].includes(t)), []);
  await assert.rejects(events(iso(0), iso(63)), /Choose up to 62 days/);
  await assert.rejects(events(iso(5), iso(1)), /Choose up to 62 days/);
  await assert.rejects(rpc('workspace_teams_read', ['teamEvents', null, null, null, null]), /Choose up to 62 days/);
});

test('team events are checked: kind, title, dates, times, place and unknown fields', async () => {
  await as(STAYS);
  const ok = { action: 'saveTeamEvent', kind: 'other', title: 'Valid', startsOn: iso(1), endsOn: iso(2) };
  await assert.rejects(act({ ...ok, kind: 'holiday' }), /Choose what this is/);
  await assert.rejects(act({ ...ok, title: 'x' }), /Invalid field title/);
  await assert.rejects(act({ ...ok, title: 'x'.repeat(201) }), /Invalid field title/);
  await assert.rejects(act({ ...ok, startsOn: iso(3), endsOn: iso(2) }), /end date must be on or after/);
  await assert.rejects(act({ ...ok, startsOn: iso(0), endsOn: iso(366) }), /Choose up to a year/);
  await assert.rejects(act({ ...ok, startsOn: '2026-02-31', endsOn: '2026-02-31' }), /Choose the dates/);
  await assert.rejects(act({ ...ok, startsOn: 'tomorrow' }), /Choose the dates/);
  await assert.rejects(act({ ...ok, startsOn: iso(-800), endsOn: iso(-799) }), /within the last year/);
  await assert.rejects(act({ ...ok, startsOn: iso(900), endsOn: iso(901) }), /within the last year/);
  await assert.rejects(act({ ...ok, startTime: '25:00' }), /Choose the times/);
  await assert.rejects(act({ ...ok, startTime: 900 }), /Choose the times/);
  await assert.rejects(act({ ...ok, endTime: '10:00' }), /Add the start time too/);
  await assert.rejects(act({ ...ok, startsOn: iso(1), endsOn: iso(1), startTime: '10:00', endTime: '10:00' }), /end time must be after/);
  await assert.rejects(act({ ...ok, location: 'x'.repeat(201) }), /place is too long/);
  await assert.rejects(act({ ...ok, extra: true }), /Unknown or oversized/);
  await assert.rejects(rpc('workspace_teams_action', [{ ...ok }]), /Request identifier required/);
  // Explicit nulls are fine; a multi-day event may end earlier in the day than it starts.
  const fine = await act({ ...ok, startTime: null, endTime: null, location: null });
  assert.equal(fine.version, 1);
  const multi = await act({ ...ok, title: 'Two days', startsOn: iso(1), endsOn: iso(2), startTime: '18:00', endTime: '09:00' });
  assert.equal(multi.version, 1);
  await assert.rejects(act({ action: 'cancelTeamEvent', id: fine.id, extra: 1 }), /Unknown or oversized/);
  await assert.rejects(act({ action: 'cancelTeamEvent', id: fine.id, version: 5 }), /Changed by someone else/);
});

test('the table is private and safe: no direct access, row security on, write limit in place', async () => {
  await as(STAYS);
  await assert.rejects(db.query('select * from private.workspace_team_events'), /permission denied|does not exist/);
  await assert.rejects(db.query('select private.workspace_stay_guest_name($1)', [crypto.randomUUID()]), /permission denied/);
  await assert.rejects(db.query('select private.workspace_team_events_read($1,$2)', [iso(0), iso(1)]), /permission denied/);
  await assert.rejects(db.query('select private.workspace_team_events_action($1::jsonb)', [JSON.stringify({ action: 'cancelTeamEvent' })]), /permission denied/);
  await assert.rejects(db.query('select public.workspace_teams_read($1,$2,$3)', ['teamEvents', iso(0), iso(100)]), /Choose up to 62 days/);
  const grants = await sql(`select has_table_privilege('anon','private.workspace_team_events','select') anon_read,has_table_privilege('authenticated','private.workspace_team_events','insert') auth_write`);
  assert.deepEqual(grants[0], { anon_read: false, auth_write: false });
});
