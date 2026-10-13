import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Privacy for the Phase 2 records (20261012220000): "Download my data" holds the person's own reflections,
// team events and the flags they raised; deleting the account erases the reflections and team events and
// anonymises the flags (management decisions stay on record). Owners no longer receive a repair's resolution
// text or who resolved it. Every other migration is applied first; this one is applied from its .sql (or its
// .sql.draft while it is being developed) twice, to prove it is safe to run again.
const MINE = '20261012220000_privacy_phase2';
const dir = 'supabase/migrations/';
const files = await fs.readdir(dir);
const mineFile = files.find(f => f === MINE + '.sql') ?? files.find(f => f === MINE + '.sql.draft');
assert.ok(mineFile, 'the migration exists');
const mine = await fs.readFile(dir + mineFile, 'utf8');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of files.filter(f => f.endsWith('.sql') && !f.startsWith(MINE)).sort()) await db.exec(await fs.readFile(dir + file, 'utf8'));
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def.replaceAll(String.fromCharCode(13), '');
const count = (text, part) => text.split(part).length - 1;
const EXPORT = 'private.workspace_privacy_read(text)';
const DELETE = 'private.workspace_delete_own_account(uuid)';
const OPERATION_VIEW = 'private.workspace_operation_view(uuid)';
const SIGS = [EXPORT, DELETE, OPERATION_VIEW];
const ANCHORS = [
  [EXPORT, "from private.workspace_shifts s where s.user_id=me),'[]'),"],
  [DELETE, 'perform private.workspace_remove_account_access(target);'],
  [OPERATION_VIEW, "d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'"],
];
const anchorsBefore = [];
for (const [sig, anchor] of ANCHORS) anchorsBefore.push(count(await definition(sig), anchor));
await db.exec(mine);
const afterFirst = [];
for (const sig of SIGS) afterFirst.push(await definition(sig));
await db.exec(mine);
const afterSecond = [];
for (const sig of SIGS) afterSecond.push(await definition(sig));
after(() => db.close());

const roles = ['super_admin', 'admin', 'ready', 'stays', 'client', 'cleans'];
const names = ['Sue Super', 'Ada Admin', 'Rory Ready', 'Sam Stays', 'Owen Owner', 'Cara Cleaner'];
const users = roles.map((_, i) => `97300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9730', '9740');
const [SUPER, ADMIN, READY, STAYS, OWNER, CLEANER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `privacy2-${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
// The server's own connection: the service key, with no signed-in person.
async function asService() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, from = null, to = null) => rpc('workspace_teams_read', [section, from, to, null, null]);
const ops = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const exportOf = async i => { await as(i); return rpc('workspace_privacy_read', ['export']); };
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Privacy flat', address: '3 Example Row, Edinburgh', region: 'Edinburgh', bedrooms: 2 }]);
for (const [who, kind] of [[ADMIN, 'staff'], [READY, 'staff'], [STAYS, 'staff'], [OWNER, 'client'], [CLEANER, 'cleaner']]) await rpc('workspace_assign_property', [HOME, users[who], kind]);

// The reviewer's scenario: Ready writes a reflection about feeling unwell, books a hospital absence and asks
// management about pay; Stays has records of their own; the admin adds an event for Ready, reads Ready's
// reflection and decides the pay flag. Ready also withdraws a second flag (a withdrawal records Ready as the decider).
await as(READY);
await act({ action: 'clockIn', department: 'ready' });
const readyReflection = await act({ action: 'saveReflection', wentWell: 'Fixed the boiler at the flat', notWell: 'Felt unwell, migraine', feedback: 'More time for van stock', completed: [] });
const readyAbsence = await act({ action: 'saveTeamEvent', kind: 'absence', title: 'Hospital appointment, oncology', startsOn: iso(3), endsOn: iso(3), startTime: '09:30', endTime: '11:00', location: 'Western General' });
const payFlag = await act({ action: 'flagForManagement', source: 'request', title: 'Pay query', reason: 'My overtime was not paid' });
const ladderFlag = await act({ action: 'flagForManagement', source: 'request', title: 'Ladder', reason: 'The old ladder is bent' });
await act({ action: 'withdrawFlag', flagId: ladderFlag.id, version: ladderFlag.version });
await as(STAYS);
await act({ action: 'clockIn', department: 'guest_relations' });
await act({ action: 'saveReflection', wentWell: 'Stays calm day', notWell: '', feedback: 'Stays private feedback', completed: [] });
const staysEvent = await act({ action: 'saveTeamEvent', kind: 'away', title: 'Stays dentist', startsOn: iso(4), endsOn: iso(4) });
const staysFlag = await act({ action: 'flagForManagement', source: 'request', title: 'Stays van', reason: 'Stays need a second van' });
await as(ADMIN);
const adminRequest = crypto.randomUUID();
const adminAdded = await rpc('workspace_teams_action', [{ requestId: adminRequest, action: 'saveTeamEvent', userId: users[READY], kind: 'training', title: 'First aid course for Rory', startsOn: iso(6), endsOn: iso(6) }]);
await act({ action: 'markReflectionsReviewed', ids: [readyReflection.id] });
await act({ action: 'decideFlag', flagId: payFlag.id, version: payFlag.version, decision: 'resolved', note: 'Paid in the next run' });
// A flag the clean form sweep raised has no person behind it.
const sweepWork = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Swept clean',$2) returning id", [HOME, users[SUPER]]))[0].id;
const sweepFlag = (await sql("insert into private.workspace_management_flags(source,work_id,property_id,title,reason) values('clean_form',$1,$2,'Clean form missing','No clean form after 24 hours') returning id", [sweepWork, HOME]))[0].id;

test('anchors occur once, the patches landed once, and the migration runs twice without change', () => {
  assert.deepEqual(anchorsBefore, [1, 1, 1], 'each anchor occurred exactly once before this migration');
  const [exp, del, opView] = afterFirst;
  assert.equal(count(exp, "'flagsRaised',coalesce("), 1);
  assert.equal(count(exp, "'reflections',coalesce("), 1);
  assert.equal(count(exp, "'teamEvents',coalesce("), 1);
  assert.ok(exp.includes(ANCHORS[0][1] + "\n   'reflections'"), 'the export lists follow their anchor');
  assert.equal(count(del, 'delete from private.workspace_day_reflections where user_id=target;'), 1);
  assert.ok(del.includes(ANCHORS[1][1] + '\n -- Phase 2 records'), 'the deletes follow the access removal');
  assert.ok(del.indexOf('workspace_day_reflections') < del.indexOf('pg_constraint'), 'the deletes run before the removable check');
  assert.equal(count(opView, "-'warrantyContactEvidence'-'resolution'-'resolvedBy'"), 1);
  assert.deepEqual(afterSecond, afterFirst, 'a second run changes nothing');
  assert.ok(!mine.includes(String.fromCharCode(0x2014)), 'no em dashes');
  assert.ok(!/(^|[^\r])\n/.test(mine), 'the migration keeps CRLF line endings');
});

test('download my data holds the person\'s own reflections, team events and flags, and nobody else\'s', async () => {
  const mineNow = await exportOf(READY);
  assert.deepEqual(mineNow.reflections.map(r => [r.day, r.wentWell, r.notWell, r.feedback, r.completed]),
    [[readyReflection.day, 'Fixed the boiler at the flat', 'Felt unwell, migraine', 'More time for van stock', []]]);
  assert.ok(mineNow.reflections[0].createdAt && mineNow.reflections[0].reviewedAt, 'created and reviewed times');
  assert.deepEqual(Object.keys(mineNow.reflections[0]).sort(), ['completed', 'createdAt', 'day', 'feedback', 'notWell', 'reviewedAt', 'summary', 'updatedAt', 'wentWell']);
  assert.deepEqual(mineNow.teamEvents.map(e => [e.kind, e.title, e.startsOn, e.endsOn, e.startTime, e.endTime, e.location, e.status, e.addedByYou]), [
    ['absence', 'Hospital appointment, oncology', iso(3), iso(3), '09:30', '11:00', 'Western General', 'active', true],
    ['training', 'First aid course for Rory', iso(6), iso(6), null, null, '', 'active', false],
  ]);
  assert.deepEqual(mineNow.flagsRaised.map(f => [f.source, f.title, f.reason, f.amountMinor, f.status, f.outcomeNote, !!f.decidedAt]), [
    ['request', 'Pay query', 'My overtime was not paid', null, 'resolved', 'Paid in the next run', true],
    ['request', 'Ladder', 'The old ladder is bent', null, 'withdrawn', '', true],
  ]);
  const text = JSON.stringify({ reflections: mineNow.reflections, teamEvents: mineNow.teamEvents, flagsRaised: mineNow.flagsRaised });
  for (const other of ['Stays calm day', 'Stays private feedback', 'Stays dentist', 'Stays van', 'Clean form missing', 'Ada Admin', 'Sue Super', users[ADMIN]])
    assert.equal(text.includes(other), false, other);

  const theirs = await exportOf(STAYS);
  assert.deepEqual(theirs.reflections.map(r => r.feedback), ['Stays private feedback']);
  assert.deepEqual(theirs.teamEvents.map(e => e.title), ['Stays dentist']);
  assert.deepEqual(theirs.flagsRaised.map(f => f.title), ['Stays van']);
  assert.ok(!/migraine|oncology|overtime/i.test(JSON.stringify(theirs)), 'never another person\'s');

  for (const who of [OWNER, CLEANER, SUPER]) {
    const none = await exportOf(who);
    assert.deepEqual([none.reflections, none.teamEvents, none.flagsRaised], [[], [], []], roles[who] + ' with none gets empty lists');
  }
});

test('the client role is still refused: no deleting from a signed-in session, no team records for owners', async () => {
  for (const who of [READY, OWNER, ADMIN]) {
    await as(who);
    await assert.rejects(db.query('select public.workspace_delete_own_account($1)', [users[READY]]), /permission denied/, roles[who]);
  }
  await as(OWNER);
  await assert.rejects(read('reflections', iso(-1), iso(1)), /Team access required/);
  await assert.rejects(read('teamEvents', iso(-1), iso(10)), /Team access required/);
  await assert.rejects(read('flags'), /Team access required/);
  // Nothing reaches the tables directly.
  await as(READY);
  for (const table of ['private.workspace_day_reflections', 'private.workspace_team_events', 'private.workspace_management_flags'])
    await assert.rejects(db.query(`select * from ${table}`), /permission denied/, table);
});

test('deleting the account erases reflections and team events and keeps the flags without the person', async () => {
  await as(ADMIN);
  assert.ok((await read('reflections', iso(-1), iso(1))).items.some(i => i.userId === users[READY]), 'before: the admin reads Ready\'s reflection');
  await asService();
  const result = await rpc('workspace_delete_own_account', [users[READY]]);
  assert.equal(result.userId, users[READY]);
  await db.exec('reset role');

  assert.equal((await sql('select count(*)::int n from private.workspace_day_reflections where user_id=$1', [users[READY]]))[0].n, 0, 'reflections erased');
  assert.equal((await sql('select count(*)::int n from private.workspace_team_events where user_id=$1', [users[READY]]))[0].n, 0, 'team events erased, the admin added one too');
  assert.equal((await sql("select count(*)::int n from private.workspace_team_events where title ilike '%oncology%' or title ilike '%Rory%'"))[0].n, 0);
  assert.equal((await sql('select count(*)::int n from private.workspace_action_receipts where request_id=$1', [adminRequest]))[0].n, 0, 'the admin\'s receipt for the event they added (it holds the title) is gone');
  assert.equal((await sql("select count(*)::int n from private.workspace_action_receipts where input::text ilike '%oncology%' or input::text ilike '%migraine%' or result::text ilike '%migraine%'"))[0].n, 0);

  const flags = await sql('select id,title,reason,status,outcome_note,raised_by,decided_by from private.workspace_management_flags where id=any($1) order by created_at', [[payFlag.id, ladderFlag.id]]);
  assert.deepEqual(flags.map(f => [f.title, f.reason, f.status, f.outcome_note, f.raised_by]), [
    ['Pay query', 'My overtime was not paid', 'resolved', 'Paid in the next run', null],
    ['Ladder', 'The old ladder is bent', 'withdrawn', '', null],
  ], 'flag rows remain for management history, without raised_by');
  assert.equal(flags[0].decided_by, users[ADMIN], 'the admin\'s decision stays on record');
  assert.equal(flags[1].decided_by, null, 'a withdrawal by the person no longer points at them');
  assert.equal((await sql('select count(*)::int n from private.workspace_management_flags where raised_by=$1 or decided_by=$1', [users[READY]]))[0].n, 0);

  // Everyone else's records are untouched.
  assert.equal((await sql('select count(*)::int n from private.workspace_day_reflections where user_id=$1', [users[STAYS]]))[0].n, 1);
  assert.equal((await sql('select title from private.workspace_team_events where id=$1', [staysEvent.id]))[0].title, 'Stays dentist');
  assert.equal((await sql('select raised_by from private.workspace_management_flags where id=$1', [staysFlag.id]))[0].raised_by, users[STAYS]);

  await as(ADMIN);
  const reflections = await read('reflections', iso(-1), iso(1));
  assert.ok(!reflections.items.some(i => i.userId === users[READY]), 'the admin reads nothing of theirs');
  assert.ok(!/migraine/i.test(JSON.stringify(reflections)));
  assert.ok(!/oncology|First aid/i.test(JSON.stringify(await read('teamEvents', iso(-1), iso(10)))));
  const shown = (await read('flags')).flags;
  const pay = shown.find(f => f.id === payFlag.id);
  assert.deepEqual([pay.source, pay.raisedBy, pay.raisedByName, pay.mine, pay.decidedByName, pay.reason], ['request', null, null, false, 'Ada Admin', 'My overtime was not paid'], 'the flag stays for management with nobody named as raiser');
  assert.equal(shown.find(f => f.id === sweepFlag).source, 'clean_form', 'only the sweep raises clean_form flags, so an anonymised flag is told apart by its source');
  assert.equal(shown.find(f => f.id === staysFlag.id).raisedByName, 'Sam Stays');

  // The old session reaches nothing, and asking again does nothing more.
  await as(READY);
  await assert.rejects(rpc('workspace_privacy_read', ['export']), /sign-in required/i);
  await asService();
  assert.equal((await rpc('workspace_delete_own_account', [users[READY]])).alreadyDeleted, true);
});

test('an admin who deletes their account leaves their decisions on record under "Deleted user"', async () => {
  await asService();
  await rpc('workspace_delete_own_account', [users[ADMIN]]);
  await db.exec('reset role');
  assert.equal((await sql('select decided_by from private.workspace_management_flags where id=$1', [payFlag.id]))[0].decided_by, users[ADMIN]);
  assert.equal((await sql("select full_name from public.workspace_profiles where user_id=$1", [users[ADMIN]]))[0].full_name, 'Deleted user');
  assert.equal((await sql('select count(*)::int n from private.workspace_closed_accounts where user_id=$1', [users[ADMIN]]))[0].n, 1, 'the anonymised profile stays, so the reference cannot block');
  await as(SUPER);
  assert.equal((await read('flags')).flags.find(f => f.id === payFlag.id).decidedByName, 'Deleted user');
});

test('owners see a repair resolved and completed, but not the resolution text or who resolved it', async () => {
  await as(STAYS);
  const repair = await ops({ action: 'createOperation', propertyId: HOME, kind: 'maintenance', data: { issue: 'Radiator cold in the hall', estimatedCostMinor: 0, hazard: false, repairType: 'heating' } });
  assert.equal(repair.data.phase, 'triage');
  const resolved = await ops({ action: 'updateOperation', workId: repair.workId, version: repair.version, step: 'resolveRepair', data: { resolution: 'Internal: guest broke it, did not charge owner' } });
  assert.equal(resolved.data.resolution, 'Internal: guest broke it, did not charge owner', 'staff keep the text');
  assert.equal(resolved.data.resolvedBy, users[STAYS]);
  await as(OWNER);
  const seen = (await rpc('workspace_operations_read', [HOME])).find(w => w.workId === repair.workId);
  assert.equal(seen.data.phase, 'resolved');
  assert.equal(seen.status, 'completed');
  assert.ok(seen.data.resolvedAt, 'when it was resolved is fine to show');
  assert.equal('resolution' in seen.data, false);
  assert.equal('resolvedBy' in seen.data, false);
  assert.ok(!JSON.stringify(seen).includes('guest broke it'), 'the resolution text is nowhere in what the owner gets');
  await as(STAYS);
  const staff = (await rpc('workspace_operations_read', [HOME])).find(w => w.workId === repair.workId);
  assert.equal(staff.data.resolution, 'Internal: guest broke it, did not charge owner');
});
