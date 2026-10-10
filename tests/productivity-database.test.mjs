import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The Productivity Tool: clock in and clock out are locked. Only a super admin changes hours
// directly; an admin's change waits for a super admin's approval and only then reaches the hours.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema, productivitySchema, shiftChangesSchema, timesheetSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { londonInstant } = await vite.ssrLoadModule('/lib/team-time.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'stays', 'client', 'admin'];
const names = ['Sam', 'Alex', 'Dan', 'Eric', 'Owner', 'Bea'];
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, DAN, ERIC, OWNER, ADMIN2] = roles.map((_, i) => i);
const session = i => users[i].replace('9760', '9860');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `prod${i}@example.com`]);
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
const shiftOf = async id => (await owner('select clocked_in_at,clocked_out_at,edited_by,approved_by,edit_note from private.workspace_shifts where id=$1', [id]))[0];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const shift = async (i, from, to) => (await owner("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,$3,gen_random_uuid()) returning id", [users[i], from, to]))[0].id;
after(async () => { await db.close(); await vite.close(); });

test('nobody edits their own hours; only admins can ask and only super admins decide', async () => {
  const id = await shift(DAN, londonInstant(day(-3), '08:00'), londonInstant(day(-3), '16:00'));
  await as(DAN);
  await assert.rejects(act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-3), '07:00'), clockedOutAt: londonInstant(day(-3), '18:00'), note: 'More hours please' }), /Only admins/);
  await assert.rejects(act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(-4), '08:00'), clockedOutAt: londonInstant(day(-4), '16:00'), department: 'guest_relations', note: 'I was in' }), /Only admins/);
  await assert.rejects(read('shiftChanges'), /Management access/);
  await assert.rejects(read('productivity', day(-30), day(0), users[ERIC]), /only see your own/);
  await as(OWNER);
  await assert.rejects(read('productivity', day(-30), day(0)), /Team access/);
  await as(ADMIN);
  const asked = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-3), '08:00'), clockedOutAt: londonInstant(day(-3), '17:00'), note: 'Stayed for a late check-in' });
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'decideShiftChange', requestId: crypto.randomUUID(), changeId: asked.id, decision: 'approve' }]), /Only a super admin/);
  assert.deepEqual((await shiftOf(id)).clocked_out_at, new Date(londonInstant(day(-3), '16:00')), 'nothing changes while it waits');
});

test('an admin\'s correction waits for a super admin, then reaches the hours', async () => {
  const id = await shift(ERIC, londonInstant(day(-2), '09:00'), londonInstant(day(-2), '17:00'));
  await as(ADMIN);
  const before = productivitySchema.parse(await read('productivity', day(-6), day(0))).people.find(p => p.userId === users[ERIC]).minutes;
  assert.equal(before, 480);
  const asked = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-2), '08:00'), clockedOutAt: londonInstant(day(-2), '17:00'), note: 'Opened the office early' });
  assert.equal(asked.status, 'pending');
  assert.equal(Date.parse(asked.before.clockedInAt), Date.parse(londonInstant(day(-2), '09:00')));
  assert.equal(await notified(SUPER, 'team.shift_change_requested'), 2, 'every super admin hears (and this is the second request)');
  assert.equal(await notified(ERIC, 'team.shift_corrected'), 0, 'the person hears only once it is approved');
  await assert.rejects(act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-2), '07:00'), clockedOutAt: londonInstant(day(-2), '17:00'), note: 'Even earlier' }), /already waiting/);

  // While it waits the timesheet shows it, and the hours, productivity and performance do not change.
  const sheet = timesheetSchema.parse(await read('timesheet', day(-6), day(0)));
  assert.equal(sheet.canApprove, false);
  assert.deepEqual(sheet.pending.filter(c => c.userId === users[ERIC]).map(c => [c.id, c.requestedByName, c.fullName]), [[asked.id, 'Alex', 'Eric']]);
  assert.equal(sheet.people.find(p => p.userId === users[ERIC]).totalMinutes, 480);
  const perf = await read('teamPerformance', day(-6), day(0));
  assert.equal(perf.people.find(p => p.userId === users[ERIC]).minutes, 480);

  await as(SUPER);
  const queue = shiftChangesSchema.parse(await read('shiftChanges'));
  assert.equal(queue.canApprove, true);
  assert.ok(queue.pending.some(c => c.id === asked.id));
  assert.throws(() => teamsActionSchema.parse({ action: 'decideShiftChange', requestId: crypto.randomUUID(), changeId: asked.id, decision: 'decline' }), /why/);
  const approved = await act({ action: 'decideShiftChange', changeId: asked.id, decision: 'approve' });
  assert.deepEqual([approved.status, approved.decidedByName], ['approved', 'Sam']);
  const applied = await shiftOf(id);
  assert.deepEqual([applied.clocked_in_at, applied.edited_by, applied.approved_by, applied.edit_note], [new Date(londonInstant(day(-2), '08:00')), users[ADMIN], users[SUPER], 'Opened the office early']);
  assert.equal(await notified(ADMIN, 'team.shift_change_approved'), 1);
  assert.equal(await notified(ERIC, 'team.shift_corrected'), 1);
  await assert.rejects(act({ action: 'decideShiftChange', changeId: asked.id, decision: 'decline', note: 'Changed my mind' }), /already been decided/);

  await as(ADMIN);
  const after = productivitySchema.parse(await read('productivity', day(-6), day(0))).people.find(p => p.userId === users[ERIC]);
  assert.equal(after.minutes, 540);
  assert.equal((await read('teamPerformance', day(-6), day(0))).people.find(p => p.userId === users[ERIC]).minutes, 540, 'performance follows the approved hours');
});

test('declined, withdrawn and added shifts; a super admin changes hours directly', async () => {
  const id = await shift(DAN, londonInstant(day(-5), '08:00'), londonInstant(day(-5), '16:00'));
  await as(ADMIN);
  const add = await act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(-6), '10:00'), clockedOutAt: londonInstant(day(-6), '14:00'), department: 'guest_relations', note: 'Forgot to clock in' });
  const late = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-5), '08:00'), clockedOutAt: londonInstant(day(-5), '20:00'), note: 'Worked till eight' });
  await as(ADMIN2);
  await assert.rejects(act({ action: 'withdrawShiftChange', changeId: late.id }), /Only the admin who asked/);
  await as(ADMIN);
  const withdrawn = await act({ action: 'withdrawShiftChange', changeId: late.id });
  assert.equal(withdrawn.status, 'withdrawn');
  const again = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-5), '08:00'), clockedOutAt: londonInstant(day(-5), '19:00'), note: 'Worked till seven' });

  await as(SUPER);
  const declined = await act({ action: 'decideShiftChange', changeId: again.id, decision: 'decline', note: 'The rota says four o\'clock' });
  assert.deepEqual([declined.status, declined.decisionNote], ['declined', 'The rota says four o\'clock']);
  assert.equal(await notified(ADMIN, 'team.shift_change_declined'), 1);
  assert.deepEqual((await shiftOf(id)).clocked_out_at, new Date(londonInstant(day(-5), '16:00')), 'a declined change never reaches the hours');
  await act({ action: 'decideShiftChange', changeId: add.id, decision: 'approve', note: 'Seen on the door log' });
  const [{ n: added }] = await owner('select count(*)::int n from private.workspace_shifts where user_id=$1 and approved_by=$2 and edited_by=$3', [users[DAN], users[SUPER], users[ADMIN]]);
  assert.equal(added, 1, 'the forgotten shift is added once approved');

  // The super admin's own change applies at once and is kept on record.
  const direct = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-5), '08:30'), clockedOutAt: londonInstant(day(-5), '16:00'), note: 'Arrived at half past' });
  assert.equal(direct.status, 'direct');
  assert.equal((await shiftOf(id)).clocked_in_at.toISOString(), new Date(londonInstant(day(-5), '08:30')).toISOString());
  const queue = shiftChangesSchema.parse(await read('shiftChanges'));
  assert.deepEqual(queue.recent.slice(0, 4).map(c => c.status), ['direct', 'approved', 'declined', 'withdrawn']);
  assert.deepEqual(queue.recent[0].before, { clockedInAt: queue.recent[0].before.clockedInAt, clockedOutAt: queue.recent[0].before.clockedOutAt, department: 'guest_relations' });
});

test('closing a shift left open is a change too', async () => {
  const id = await shift(ERIC, new Date(Date.now() - 5 * 3600000).toISOString(), null);
  await as(ADMIN);
  const close = await act({ action: 'closeShift', shiftId: id, endedAt: new Date(Date.now() - 3600000).toISOString() });
  assert.deepEqual([close.status, close.kind, close.note], ['pending', 'close', 'Forgot to clock out']);
  assert.equal((await shiftOf(id)).clocked_out_at, null, 'still open until approved');
  await as(SUPER);
  await act({ action: 'decideShiftChange', changeId: close.id, decision: 'approve' });
  const closed = await owner('select clocked_out_at,closed_by from private.workspace_shifts where id=$1', [id]);
  assert.ok(closed[0].clocked_out_at);
  assert.equal(closed[0].closed_by, users[ADMIN]);
  await as(ADMIN);
  await assert.rejects(act({ action: 'closeShift', shiftId: id, endedAt: new Date().toISOString() }), /already ended/);
});

test('productivity: hours by week and by month, everyone for admins, your own for the team', async () => {
  const year = Number(today.slice(0, 4)) - 1;
  // Last year: two shifts in March (one week apart) and one in April.
  await shift(DAN, londonInstant(`${year}-03-02`, '09:00'), londonInstant(`${year}-03-02`, '17:00'));
  await shift(DAN, londonInstant(`${year}-03-09`, '09:00'), londonInstant(`${year}-03-09`, '13:30'));
  await shift(DAN, londonInstant(`${year}-04-15`, '22:00'), londonInstant(`${year}-04-16`, '06:00'));
  await as(ADMIN);
  const data = productivitySchema.parse(await read('productivity', `${year}-01-01`, `${year}-12-31`));
  assert.equal(data.canEdit, true);
  assert.equal(data.canApprove, false);
  const dan = data.people.find(p => p.userId === users[DAN]);
  assert.deepEqual([dan.minutes, dan.shifts, dan.days], [480 + 270 + 480, 3, 3]);
  assert.deepEqual(dan.months.map(m => [m.month, m.minutes]), [[`${year}-03`, 750], [`${year}-04`, 480]], 'a night shift counts in the month it started');
  assert.equal(dan.weeks.length, 3);
  assert.ok(dan.weeks.every(w => new Date(w.start + 'T12:00:00Z').getUTCDay() === 1), 'weeks start on Monday');
  assert.ok(data.people.some(p => p.userId === users[ERIC]), 'everyone on the team, even with no hours');
  assert.equal(data.people.some(p => p.userId === users[OWNER]), false);
  assert.throws(() => teamsReadSchema.parse({ section: 'productivity', from: `${year}-01-01`, to: `${year + 1}-06-01` }), /up to a year/);
  await assert.rejects(rpc('workspace_teams_read', ['productivity', `${year}-01-01`, `${year + 1}-06-01`, null, null]), /up to a year/);

  await as(DAN);
  const mine = productivitySchema.parse(await read('productivity', `${year}-01-01`, `${year}-12-31`));
  assert.deepEqual(mine.people.map(p => p.fullName), ['Dan']);
  assert.equal(mine.pending, 0);
});
