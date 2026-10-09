import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Who does what (the responsibilities register), the rota by date, timesheets an admin can correct,
// and times of day on dated work.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, responsibilitiesSchema, rotaPlanSchema, timesheetSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { londonInstant, timesheetRows } = await vite.ssrLoadModule('/lib/team-time.ts');
const { calendarScheduleSchema, calendarEntries } = await vite.ssrLoadModule('/lib/calendar-live.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'stays', 'cleans', 'accounts', 'client'];
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, DAN, ERIC, ANGELA, , OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9750', '9850');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `time${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Dan', 'Eric', 'Angela', 'Accounts', 'Owner'][i]]);
}
for (const i of [DAN, ERIC]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = (section, from = null, to = null, user = null) => rpc('workspace_teams_read', [section, from, to, null, user]);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
after(async () => { await db.close(); await vite.close(); });

test('responsibilities: admins keep the register, the whole team reads it', async () => {
  await as(ANGELA);
  await assert.rejects(act({ action: 'saveResponsibility', department: 'cleaning', title: 'Restock linen', ownerId: users[ANGELA], backupId: null, frequency: 'weekly' }), /Only admins/);
  assert.throws(() => teamsActionSchema.parse({ action: 'saveResponsibility', requestId: crypto.randomUUID(), department: 'management', title: 'Payroll', ownerId: users[DAN], backupId: users[DAN], frequency: 'monthly' }), /backup/i);
  await as(ADMIN);
  await assert.rejects(act({ action: 'saveResponsibility', department: 'management', title: 'Owner calls', ownerId: users[OWNER], backupId: null, frequency: 'weekly' }), /someone on the team/);
  const made = await act({ action: 'saveResponsibility', department: 'client_relations', title: 'Reply to every owner message the same day', details: 'WhatsApp and email', ownerId: users[DAN], backupId: users[ERIC], frequency: 'daily' });
  assert.equal(await notified(DAN, 'team.responsibility_given'), 1);
  assert.equal(await notified(ERIC, 'team.responsibility_given'), 1);
  const moved = await act({ action: 'saveResponsibility', id: made.id, version: made.version, department: 'client_relations', title: 'Reply to every owner message the same day', ownerId: users[DAN], backupId: users[ANGELA], frequency: 'daily' });
  assert.equal(await notified(ANGELA, 'team.responsibility_given'), 1, 'the new backup hears');
  assert.equal(await notified(DAN, 'team.responsibility_given'), 1, 'the owner already knew');
  await assert.rejects(act({ action: 'saveResponsibility', id: made.id, version: made.version, department: 'client_relations', title: 'Stale', ownerId: null, backupId: null, frequency: 'daily' }), /Changed by someone else/);

  await as(DAN);
  const seen = responsibilitiesSchema.parse(await read('responsibilities'));
  assert.equal(seen.canEdit, false);
  assert.deepEqual(seen.items.map(i => [i.title, i.ownerName, i.backupName, i.details]), [['Reply to every owner message the same day', 'Dan', 'Angela', 'WhatsApp and email']]);
  assert.equal(seen.people.some(p => p.fullName === 'Owner'), false, 'owners are not on the team list');
  await assert.rejects(act({ action: 'removeResponsibility', id: made.id, version: moved.version }), /Only admins/);
  await as(OWNER);
  await assert.rejects(read('responsibilities'), /Team access/);
  await as(ADMIN);
  await act({ action: 'removeResponsibility', id: made.id, version: moved.version });
  assert.equal(responsibilitiesSchema.parse(await read('responsibilities')).items.length, 0);
});

test('rota by date: admins plan days, everyone on the team sees the week', async () => {
  await as(DAN);
  await assert.rejects(act({ action: 'planRota', userId: users[ERIC], days: [{ day: day(1), shift: 'early' }] }), /Only admins/);
  await as(ADMIN);
  await act({ action: 'planRota', userId: users[ERIC], days: [{ day: day(1), shift: 'early' }, { day: day(2), shift: 'off', note: 'Holiday' }, { day: day(3), shift: 'late', department: 'management' }] });
  assert.equal(await notified(ERIC, 'team.rota_planned'), 1);
  await assert.rejects(act({ action: 'planRota', userId: users[ERIC], days: [{ day: day(400), shift: 'early' }] }), /a month ago to a year ahead/);
  await assert.rejects(act({ action: 'planRota', userId: users[OWNER], days: [{ day: day(1), shift: 'early' }] }), /someone on the team/);

  await as(ERIC);
  const plan = rotaPlanSchema.parse(await read('rotaPlan', day(0), day(6)));
  assert.equal(plan.canEdit, false);
  const eric = plan.people.find(p => p.userId === users[ERIC]);
  assert.equal(eric.usualShift, 'early');
  assert.deepEqual(eric.days.map(d => [d.day, d.shift, d.department, d.note]),
    [[day(1), 'early', 'client_relations', ''], [day(2), 'off', null, 'Holiday'], [day(3), 'late', 'management', '']]);
  assert.equal(plan.people.some(p => p.fullName === 'Owner'), false);
  await assert.rejects(read('rotaPlan', day(0), day(40)), /up to 31 days/);

  await as(ADMIN);
  await act({ action: 'planRota', userId: users[ERIC], days: [{ day: day(2), shift: null }] });
  assert.deepEqual(rotaPlanSchema.parse(await read('rotaPlan', day(0), day(6))).people.find(p => p.userId === users[ERIC]).days.map(d => d.day), [day(1), day(3)]);
});

test('timesheets: your own hours, everyone\'s for admins, and corrections they are told about', async () => {
  const shift = (i, from, to) => owner("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'client_relations',$2,$3,gen_random_uuid()) returning id", [users[i], from, to]);
  const [{ id: danShift }] = await shift(DAN, londonInstant(day(-1), '08:00'), londonInstant(day(-1), '16:00'));
  const [{ id: ericShift }] = await shift(ERIC, new Date(Date.now() - 2 * 3600000).toISOString(), null);
  await as(ADMIN);
  await act({ action: 'planRota', userId: users[DAN], days: [{ day: day(-1), shift: 'early' }, { day: day(-2), shift: 'early' }] });

  await as(DAN);
  const mine = timesheetSchema.parse(await read('timesheet', day(-3), day(0)));
  assert.equal(mine.canEdit, false);
  assert.deepEqual(mine.people.map(p => p.fullName), ['Dan'], 'only your own');
  assert.equal(mine.people[0].totalMinutes, 480);
  const rows = timesheetRows(mine.people[0], today);
  assert.deepEqual(rows.map(r => [r.day, r.missed, r.shifts.length]), [[day(-2), true, 0], [day(-1), false, 1]]);
  await assert.rejects(read('timesheet', day(-3), day(0), users[ERIC]), /only see your own/);
  await assert.rejects(act({ action: 'editShift', shiftId: danShift, clockedInAt: londonInstant(day(-1), '08:00'), clockedOutAt: londonInstant(day(-1), '18:00'), note: 'More hours please' }), /Only admins/);

  await as(ADMIN);
  const all = timesheetSchema.parse(await read('timesheet', day(-3), day(0)));
  assert.ok(all.canEdit);
  assert.equal(all.people.find(p => p.userId === users[ERIC]).days.at(-1).shifts[0].clockedOutAt, null, 'still on shift');
  assert.throws(() => teamsActionSchema.parse({ action: 'editShift', requestId: crypto.randomUUID(), shiftId: danShift, clockedInAt: londonInstant(day(-1), '08:00'), clockedOutAt: londonInstant(day(-1), '17:00'), note: 'x' }));
  const fixed = await act({ action: 'editShift', shiftId: danShift, clockedInAt: londonInstant(day(-1), '08:00'), clockedOutAt: londonInstant(day(-1), '17:00'), note: 'Stayed late, forgot to clock out' });
  assert.equal(fixed.editNote, 'Stayed late, forgot to clock out');
  assert.equal(await notified(DAN, 'team.shift_corrected'), 1);
  await assert.rejects(act({ action: 'editShift', shiftId: danShift, clockedInAt: londonInstant(day(-1), '08:00'), clockedOutAt: null, note: 'Reopen it' }), /when the shift ended/);
  await assert.rejects(act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(-1), '15:00'), clockedOutAt: londonInstant(day(-1), '18:00'), department: 'client_relations', note: 'Evening cover' }), /overlaps/);
  await assert.rejects(act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(-3), '10:00'), clockedOutAt: londonInstant(day(-2), '11:00'), department: 'client_relations', note: 'Long one' }), /at most 24 hours/);
  await assert.rejects(act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(1), '09:00'), clockedOutAt: londonInstant(day(1), '10:00'), department: 'client_relations', note: 'Tomorrow' }), /in the past/);
  await act({ action: 'addShift', userId: users[DAN], clockedInAt: londonInstant(day(-2), '09:00'), clockedOutAt: londonInstant(day(-2), '12:00'), department: 'client_relations', note: 'Forgot to clock in' });
  // An open shift can be corrected and stay open.
  const open = await act({ action: 'editShift', shiftId: ericShift, clockedInAt: new Date(Date.now() - 3 * 3600000).toISOString(), clockedOutAt: null, note: 'Started an hour earlier' });
  assert.equal(open.clockedOutAt ?? null, null);

  await as(DAN);
  const after = timesheetSchema.parse(await read('timesheet', day(-3), day(0))).people[0];
  assert.equal(after.totalMinutes, 540 + 180);
  assert.deepEqual(timesheetRows(after, today).map(r => [r.day, r.missed, r.edited]), [[day(-2), false, true], [day(-1), false, true]]);
  await as(OWNER);
  await assert.rejects(read('timesheet', day(-3), day(0)), /Team access/);
});

test('times on dated work: the team sets the day and time, cleaners and owners cannot', async () => {
  const [{ id: property }] = await owner("insert into public.workspace_properties(name,created_by,request_id) values('Leith Shore Flat',$1,gen_random_uuid()) returning id", [users[ADMIN]]);
  const [{ id: work, version }] = await owner("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,due_on,assignee_id) values(gen_random_uuid(),$1,'cleaning-schedule','Deep clean',$2,$3,$4) returning id,version", [property, users[ADMIN], day(2), users[ANGELA]]);
  const heard = async () => (await owner('select count(*)::int n from private.workspace_notification_outbox where user_id=$1', [users[ANGELA]]))[0].n;
  const before = await heard();
  assert.throws(() => teamsActionSchema.parse({ action: 'setWorkTime', requestId: crypto.randomUUID(), workId: work, version, dueOn: day(3), startTime: '14:00', endTime: '10:00' }), /after the start/);
  await as(ANGELA);
  await assert.rejects(act({ action: 'setWorkTime', workId: work, version, dueOn: day(3), startTime: '10:00', endTime: null }), /Only the team/);
  await as(OWNER);
  await assert.rejects(act({ action: 'setWorkTime', workId: work, version, dueOn: day(3), startTime: '10:00', endTime: null }), /Only the team/);
  await as(ADMIN);
  const set = await act({ action: 'setWorkTime', workId: work, version, dueOn: day(3), startTime: '10:00', endTime: '14:00' });
  assert.deepEqual([set.dueOn, set.dueTime, set.endTime, set.version], [day(3), '10:00', '14:00', version + 1]);
  assert.ok(await heard() > before, 'the cleaner it is assigned to hears');
  await assert.rejects(act({ action: 'setWorkTime', workId: work, version, dueOn: day(4), startTime: null, endTime: null }), /Changed by someone else/);
  await assert.rejects(act({ action: 'setWorkTime', workId: work, version: set.version, dueOn: day(500), startTime: null, endTime: null }), /a month ago to a year ahead/);
  const entries = calendarEntries(calendarScheduleSchema.parse(await read('schedule', day(0), day(6))));
  const entry = entries.find(e => e.work?.workId === work);
  assert.deepEqual([entry.date, entry.time, entry.endTime], [day(3), '10:00', '14:00']);
  const cleared = await act({ action: 'setWorkTime', workId: work, version: set.version, dueOn: day(3), startTime: null, endTime: null });
  assert.equal(cleared.dueTime, null);
  await owner("update public.workspace_work_items set status='completed' where id=$1", [work]);
  await as(ADMIN);
  await assert.rejects(act({ action: 'setWorkTime', workId: work, version: cleared.version, dueOn: day(3), startTime: '09:00', endTime: null }), /already closed/);
});
