import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Pauses on the clock (lunch, a break, an emergency), overtime, the pay rules for pauses, and who
// is online in Access control.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { myShiftSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const { accessPeopleSchema, shiftStatus, presenceText } = await vite.ssrLoadModule('/lib/access-control.ts');
const { pauseSummary } = await vite.ssrLoadModule('/lib/productivity.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'stays', 'client', 'admin'];
const names = ['Sam', 'Alex', 'Dan', 'Eric', 'Owner', 'Bea'];
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, DAN, ERIC, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9750', '9850');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `pause${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
for (const i of [DAN, ERIC]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'guest_relations','early')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = (section, from = null, to = null, user = null) => {
  teamsReadSchema.parse({ section, ...(from ? { from, to } : {}), ...(user ? { userId: user } : {}) });
  return rpc('workspace_teams_read', [section, from, to, null, user]);
};
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const shift = async (i, from, to) => (await owner("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,$3,gen_random_uuid()) returning id", [users[i], from, to]))[0].id;
after(async () => { await db.close(); await vite.close(); });


test('lunch, a break and an emergency while clocked in; back to work; overtime; clocking out ends a pause', async () => {
  await as(DAN);
  await act({ action: 'clockIn', department: 'guest_relations' });
  let mine = myShiftSchema.parse(await read('shift'));
  assert.deepEqual(mine.pausePolicy, { ...mine.pausePolicy, lunchPaid: false, breakPaid: true, emergencyPaid: true }, 'lunch is unpaid to start with');
  await act({ action: 'startPause', kind: 'lunch' });
  await act({ action: 'startPause', kind: 'lunch' });
  mine = myShiftSchema.parse(await read('shift'));
  assert.equal(mine.open.pause.kind, 'lunch');
  assert.equal(mine.open.pauses.length, 1, 'a second tap changes nothing');
  await act({ action: 'endPause' });
  await act({ action: 'startPause', kind: 'break' });
  await act({ action: 'startOvertime' });
  mine = myShiftSchema.parse(await read('shift'));
  assert.equal(mine.open.pause, null, 'overtime ends the break');
  assert.ok(mine.open.overtimeFrom);
  assert.deepEqual(mine.open.pauses.map(x => x.kind), ['lunch', 'break']);
  // An emergency tells the managers straight away (not the person themselves).
  await act({ action: 'startPause', kind: 'emergency', note: 'Burst pipe at Leith flat' });
  assert.equal(await notified(SUPER, 'team.emergency'), 1);
  assert.equal(await notified(ADMIN, 'team.emergency'), 1);
  assert.equal(await notified(DAN, 'team.emergency'), 0);
  await act({ action: 'clockOut' });
  const open = (await owner('select count(*)::int n from private.workspace_shift_pauses where ended_at is null'))[0].n;
  assert.equal(open, 0, 'clocking out ends the emergency');
  await assert.rejects(act({ action: 'startPause', kind: 'lunch' }), /Clock in first/);
  await as(OWNER);
  await assert.rejects(act({ action: 'startPause', kind: 'lunch' }), /Team access required/);
});

test('unpaid pauses come off the hours everywhere, by the rules admins choose', async () => {
  // Eric worked 09:00–17:00 yesterday (8h) with a 1h lunch and a 15m break, and overtime from 16:00.
  const at = h => new Date(Date.parse(day(-1) + 'T00:00:00Z') + h * 3600000).toISOString();
  const id = await shift(ERIC, at(9), at(17));
  await owner("update private.workspace_shifts set overtime_from=$2 where id=$1", [id, at(16)]);
  await owner("insert into private.workspace_shift_pauses(shift_id,user_id,kind,started_at,ended_at) values($1,$2,'lunch',$3,$4),($1,$2,'break',$5,$6)", [id, users[ERIC], at(12), at(13), at(15), at(15.25)]);
  const hours = async () => {
    await as(SUPER);
    const prod = (await read('productivity', day(-1), day(-1))).people.find(x => x.userId === users[ERIC]);
    const sheet = (await read('timesheet', day(-1), day(-1))).people.find(x => x.userId === users[ERIC]);
    return { prod: prod.minutes, overtime: prod.overtimeMinutes, sheet: sheet.totalMinutes, pauses: sheet.days[0].shifts[0].pauses.length };
  };
  assert.deepEqual(await hours(), { prod: 420, overtime: 60, sheet: 420, pauses: 2 }, 'lunch unpaid: 8h less 1h');
  // Only admins set the rules, against the version they read.
  await as(DAN);
  await assert.rejects(act({ action: 'savePausePolicy', lunchPaid: true, breakPaid: false, emergencyPaid: true, version: 1 }), /Management access required/);
  await as(ADMIN);
  await act({ action: 'savePausePolicy', lunchPaid: true, breakPaid: false, emergencyPaid: true, version: 1 });
  await assert.rejects(act({ action: 'savePausePolicy', lunchPaid: true, breakPaid: false, emergencyPaid: true, version: 1 }), /Someone else changed/);
  assert.deepEqual(await hours(), { prod: 465, overtime: 60, sheet: 465, pauses: 2 }, 'now only the 15m break comes off');
  const summary = pauseSummary((await read('timesheet', day(-1), day(-1))).people.find(x => x.userId === users[ERIC]).days[0].shifts);
  assert.equal(summary, 'Lunch 1h · Break 15m · Overtime 1h');
});

test('Access control shows who is online and where they are with their shift', async () => {
  await as(ERIC);
  await rpc('workspace_chat_action', [{ action: 'heartbeat' }]);
  await act({ action: 'clockIn', department: 'guest_relations' });
  await act({ action: 'startPause', kind: 'lunch' });
  await as(SUPER);
  const people = accessPeopleSchema.parse(await rpc('workspace_admin_read', ['accessControl']));
  const eric = people.find(x => x.userId === users[ERIC]), dan = people.find(x => x.userId === users[DAN]);
  assert.equal(presenceText(eric), 'Online now');
  assert.match(shiftStatus(eric.shift).label, /^Lunch since \d\d:\d\d$/);
  assert.equal(shiftStatus(dan.shift), null, 'Dan has clocked out');
  assert.equal(presenceText(dan), 'Never signed in', 'no app check-in yet');
});
