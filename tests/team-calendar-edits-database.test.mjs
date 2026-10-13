import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Team calendar, who may edit (Lee, 13 October 2026): anyone on the team, cleaners included, adds, changes and cancels
// anyone's entry; owners never. Each entry records who last edited it and when. The migrations before this one are
// applied, then a few entries are saved the old way (to check they are filled in), then this one twice, then the rest.
const MINE = '20261014300000_team_calendar_anyone_edits';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'), 'the migration exists');
for (const file of files.filter(f => f < MINE)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const mine = await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8');
after(() => db.close());

const roles = ['admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client', 'stays'];
const users = roles.map((_, i) => `97300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9730', '9740');
const [ADMIN, STAYS, CLEANER, MANAGER, READY, ACCOUNTS, OWNER, LEAVER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `teamedit${i}@example.com`]);
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
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const events = (from, to) => rpc('workspace_teams_read', ['teamEvents', from, to, null, null]);
const act = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const sql = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const definition = async sig => (await sql('select pg_get_functiondef($1::regprocedure) def', [sig]))[0].def;

// Saved before this migration: one an admin added for the stays person, one the cleaner added and then cancelled.
await as(ADMIN);
const oldForOther = await act({ action: 'saveTeamEvent', userId: users[STAYS], kind: 'training', title: 'Old training', startsOn: iso(3), endsOn: iso(3) });
await as(CLEANER);
const oldCancelled = await act({ action: 'saveTeamEvent', kind: 'away', title: 'Old away', startsOn: iso(4), endsOn: iso(4) });
await act({ action: 'cancelTeamEvent', id: oldCancelled.id });
await db.exec('reset role');
await db.exec(mine);
const firstRun = [await definition('private.workspace_team_events_read(date,date)'), await definition('private.workspace_team_events_action(jsonb)')];
await db.exec(mine);
const secondRun = [await definition('private.workspace_team_events_read(date,date)'), await definition('private.workspace_team_events_action(jsonb)')];
for (const file of files.filter(f => f > MINE + '.sql')) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));

test('the migration runs twice without change, and older entries get who last edited them', async () => {
  assert.deepEqual(secondRun, firstRun);
  assert.equal((await sql("select count(*)::int n from pg_indexes where indexname='workspace_team_events_editor_idx'"))[0].n, 1);
  const rows = await sql('select id,updated_by from private.workspace_team_events where id=any($1::uuid[]) order by title', [[oldForOther.id, oldCancelled.id]]);
  assert.deepEqual(rows.map(r => [r.id, r.updated_by]), [[oldCancelled.id, users[CLEANER]], [oldForOther.id, users[ADMIN]]]);
  await as(STAYS);
  const shown = (await events(iso(0), iso(10))).events.find(e => e.id === oldForOther.id);
  assert.deepEqual([shown.editedById, shown.editedBy, shown.added], [users[ADMIN], 'Person ' + ADMIN, true]);
});

test('every team role, cleaners included, adds, changes and cancels anyone\'s entry, and the person is told', async () => {
  await as(STAYS);
  const leave = await act({ action: 'saveTeamEvent', kind: 'absence', title: 'Annual leave', startsOn: iso(2), endsOn: iso(5) });
  let version = leave.version;
  for (const who of [CLEANER, MANAGER, READY, ACCOUNTS, ADMIN]) {
    await as(who);
    assert.equal((await events(iso(0), iso(10))).canEditAll, true, roles[who] + ' may edit everyone\'s');
    const changed = await act({ action: 'saveTeamEvent', id: leave.id, version, kind: 'absence', title: 'Annual leave by ' + roles[who], startsOn: iso(2), endsOn: iso(5) });
    assert.equal(changed.userId, users[STAYS], 'it stays with the person it is for');
    version = changed.version;
    const read = (await events(iso(0), iso(10))).events.find(e => e.id === leave.id);
    assert.deepEqual([read.title, read.editedById, read.editedBy, read.added, read.mine], ['Annual leave by ' + roles[who], users[who], 'Person ' + who, false, false]);
    assert.ok(Date.parse(read.editedAt) > Date.now() - 60000, 'when it was edited');
  }
  // A cleaner adds one for someone else, and cancels another person's.
  await as(CLEANER);
  const forReady = await act({ action: 'saveTeamEvent', userId: users[READY], kind: 'meeting', title: 'Supplier call', startsOn: iso(6), endsOn: iso(6), startTime: '10:00', endTime: '10:30' });
  assert.equal(forReady.userId, users[READY]);
  const row = (await sql('select created_by,updated_by from private.workspace_team_events where id=$1', [forReady.id]))[0];
  assert.deepEqual([row.created_by, row.updated_by], [users[CLEANER], users[CLEANER]]);
  await as(MANAGER);
  const cancelled = await act({ action: 'cancelTeamEvent', id: forReady.id, version: forReady.version });
  assert.equal(cancelled.cancelled, true);
  const after = (await sql('select cancelled_by,updated_by from private.workspace_team_events where id=$1', [forReady.id]))[0];
  assert.deepEqual([after.cancelled_by, after.updated_by], [users[MANAGER], users[MANAGER]]);
  // The person is told each time someone else changes their calendar; nobody is told about their own change.
  const told = await sql(`select o.user_id,a.event_type,a.actor_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    where a.event_type in ('team.event_set','team.event_cancelled') and a.actor_id<>$1 order by a.id`, [users[ADMIN]]);
  assert.deepEqual(told.map(r => [r.user_id, r.event_type, r.actor_id]), [
    [users[STAYS], 'team.event_set', users[CLEANER]], [users[STAYS], 'team.event_set', users[MANAGER]], [users[STAYS], 'team.event_set', users[READY]],
    [users[STAYS], 'team.event_set', users[ACCOUNTS]], [users[READY], 'team.event_set', users[CLEANER]], [users[READY], 'team.event_cancelled', users[MANAGER]],
  ]);
  assert.equal((await sql("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='team.event_set' and o.user_id=a.actor_id"))[0].n, 0, 'nobody is told about their own change');
});

test('owners never read, add, change or cancel an entry', async () => {
  await as(STAYS);
  const meeting = await act({ action: 'saveTeamEvent', kind: 'meeting', title: 'Team meeting', startsOn: iso(1), endsOn: iso(1) });
  await as(OWNER);
  await assert.rejects(events(iso(0), iso(10)), /Team access required/);
  await assert.rejects(act({ action: 'saveTeamEvent', kind: 'absence', title: 'Owner away', startsOn: iso(2), endsOn: iso(3) }), /Team access required/);
  await assert.rejects(act({ action: 'saveTeamEvent', id: meeting.id, kind: 'meeting', title: 'Owner edit', startsOn: iso(1), endsOn: iso(1) }), /Team access required/);
  await assert.rejects(act({ action: 'cancelTeamEvent', id: meeting.id }), /Team access required/);
  // Nobody can put an entry on an owner's calendar.
  await as(CLEANER);
  await assert.rejects(act({ action: 'saveTeamEvent', userId: users[OWNER], kind: 'other', title: 'Owner thing', startsOn: iso(2), endsOn: iso(2) }), /Choose someone on the team/);
  // The notices about team entries carry no work, so an owner's activity read never shows them.
  await as(OWNER);
  const seen = (await db.query("select count(*)::int n from public.workspace_activity where event_type like 'team.%'")).rows[0].n;
  assert.equal(seen, 0);
});

test('two people editing at once: the second is asked to refresh; a person who left cannot be edited by others', async () => {
  await as(READY);
  const call = await act({ action: 'saveTeamEvent', kind: 'meeting', title: 'Owner call', startsOn: iso(7), endsOn: iso(7) });
  await as(STAYS);
  await act({ action: 'saveTeamEvent', id: call.id, version: 1, kind: 'meeting', title: 'Owner call moved', startsOn: iso(8), endsOn: iso(8) });
  await as(CLEANER);
  await assert.rejects(act({ action: 'saveTeamEvent', id: call.id, version: 1, kind: 'meeting', title: 'Stale', startsOn: iso(7), endsOn: iso(7) }), /Changed by someone else/);
  await assert.rejects(act({ action: 'cancelTeamEvent', id: call.id, version: 1 }), /Changed by someone else/);

  await as(LEAVER);
  const theirs = await act({ action: 'saveTeamEvent', kind: 'absence', title: 'Last week', startsOn: iso(9), endsOn: iso(9) });
  await sql("update public.workspace_profiles set status='revoked' where user_id=$1", [users[LEAVER]]);
  await as(STAYS);
  await assert.rejects(act({ action: 'saveTeamEvent', id: theirs.id, kind: 'absence', title: 'Edited', startsOn: iso(9), endsOn: iso(9) }), /no longer on the team/);
  assert.ok(!(await events(iso(0), iso(10))).events.some(e => e.id === theirs.id), 'and it is not on the calendar');
});

test('the switch is one function, and the functions stay private', async () => {
  assert.equal((await sql('select private.workspace_team_events_anyone_edits() v'))[0].v, true);
  await as(CLEANER);
  await assert.rejects(db.query('select private.workspace_team_events_anyone_edits()'), /permission denied/);
  await assert.rejects(db.query('select private.workspace_team_events_read($1,$2)', [iso(0), iso(1)]), /permission denied/);
  await assert.rejects(db.query('select private.workspace_team_events_action($1::jsonb)', [JSON.stringify({ action: 'cancelTeamEvent' })]), /permission denied/);
});
