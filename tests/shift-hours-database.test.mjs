import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Migration 20261025600000: every place that sums shift hours counts the period's part of each shift, and a shift left
// open counts up to 16 hours, is no longer "on shift", and is told once. Corrections need a yes over 16 hours.
const MIGRATION = 'supabase/migrations/20261025600000_shift_hours_clip_open_limit.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, timesheetSchema, productivitySchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { londonInstant } = await vite.ssrLoadModule('/lib/team-time.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'stays'];
const names = ['Lee', 'Alex', 'Erika Mendoza', 'John'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ERIKA, JOHN] = roles.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `hours${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
for (const i of [ERIKA, JOHN]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'guest_relations','early')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const raw = async input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, from = null, to = null) => rpc('workspace_teams_read', [section, from, to, null, null]);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const shift = async (i, from, to) => (await owner("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,$3,gen_random_uuid()) returning id", [users[i], from, to]))[0].id;
after(async () => { await db.close(); await vite.close(); });

// Erika: clocked in five days ago at 08:39 and never clocked out (owner's screenshot: 15 Oct, seen on 20 Oct).
const ERIKA_DAY = day(-5);
let erikaShift;

test("Erika's open shift: the day counts 15h 21m, the next day 39m, flagged, not on shift", async () => {
  erikaShift = await shift(ERIKA, londonInstant(ERIKA_DAY, '08:39'), null);
  await as(ADMIN);
  const sheet = timesheetSchema.parse(await read('timesheet', day(-6), day(0)));
  const erika = sheet.people.find(p => p.userId === users[ERIKA]);
  const on = d => erika.days.find(x => x.day === d);
  assert.equal(on(ERIKA_DAY).minutes, 15 * 60 + 21, 'the day of the clock in: at most 15h 21m');
  assert.deepEqual([on(ERIKA_DAY).shifts[0].stale, on(ERIKA_DAY).shifts[0].shiftMinutes], [true, 16 * 60]);
  assert.equal(on(day(-4)).minutes, 39, 'the rest of the 16 hours, after midnight');
  assert.equal(on(day(-3)), undefined, 'nothing after the limit');
  assert.equal(erika.totalMinutes, 16 * 60);
  assert.ok(erika.days.every(d => d.minutes <= 24 * 60));
  const prod = productivitySchema.parse(await read('productivity', day(-6), day(0)));
  const p = prod.people.find(x => x.userId === users[ERIKA]);
  assert.deepEqual([p.onShift, p.minutes, p.shifts, p.days], [false, 16 * 60, 1, 2]);
  assert.equal(new Date(p.notClockedOutSince).toISOString(), new Date(londonInstant(ERIKA_DAY, '08:39')).toISOString());
  const perf = (await read('teamPerformance', day(-6), day(0))).people.find(x => x.userId === users[ERIKA]);
  assert.equal(perf.minutes, 16 * 60, 'team performance counts the same 16 hours');
  const report = await rpc('workspace_business_report', ['time', day(-6), day(0)]);
  assert.deepEqual([report.minutes, report.running], [16 * 60, 0], 'reports: 16 hours, not running');
});

test('a shift across midnight counts on each day; periods clip it', async () => {
  await shift(JOHN, londonInstant(day(-3), '22:00'), londonInstant(day(-2), '02:10'));
  await as(ADMIN);
  const john = timesheetSchema.parse(await read('timesheet', day(-6), day(0))).people.find(p => p.userId === users[JOHN]);
  assert.deepEqual(john.days.filter(d => d.shifts.length).map(d => [d.day, d.minutes]), [[day(-3), 120], [day(-2), 130]]);
  assert.equal(john.totalMinutes, 250);
  const second = timesheetSchema.parse(await read('timesheet', day(-2), day(-2))).people.find(p => p.userId === users[JOHN]);
  assert.equal(second.totalMinutes, 130, 'a period starting after midnight counts only its part');
  const prod = productivitySchema.parse(await read('productivity', day(-2), day(0))).people.find(p => p.userId === users[JOHN]);
  assert.deepEqual([prod.minutes, prod.shifts, prod.days], [130, 1, 1]);
});

test('the person and management are told once when a shift goes past the limit', async () => {
  const told = async () => (await owner('select private.workspace_shift_stale_notify() n'))[0].n;
  assert.equal(await told(), 1);
  assert.equal(await told(), 0, 'once per shift');
  for (const i of [ERIKA, SUPER, ADMIN]) assert.equal(await notified(i, 'team.shift_not_clocked_out'), 1);
  assert.equal(await notified(JOHN, 'team.shift_not_clocked_out'), 0);
  assert.match(noticeCopy('team.shift_not_clocked_out').message, /16 hours/);
  // The hourly run sends them too (nothing new to send now).
  await owner('select private.workspace_va_pay_run(now())');
  assert.equal(await notified(ERIKA, 'team.shift_not_clocked_out'), 1);
});

test('correcting a shift: clock out after clock in, over 16 hours only with a yes, never over 24', async () => {
  const id = await shift(JOHN, londonInstant(day(-10), '14:56'), londonInstant(day(-10), '18:00'));
  await as(SUPER);
  await assert.rejects(raw({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-10), '14:56'), clockedOutAt: londonInstant(day(-10), '14:55'), note: 'Fixing times' }), /Clock out must be after clock in/);
  await assert.rejects(raw({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-10), '14:56'), clockedOutAt: londonInstant(day(-9), '14:55'), note: 'Fixing times' }), /over 16 hours\. Is that right\?/);
  await assert.rejects(raw({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-10), '14:56'), clockedOutAt: londonInstant(day(-9), '15:00'), confirmLong: true, note: 'Fixing times' }), /at most 24 hours/);
  const fixed = await act({ action: 'editShift', shiftId: id, clockedInAt: londonInstant(day(-10), '14:56'), clockedOutAt: londonInstant(day(-9), '14:55'), confirmLong: true, note: 'Double shift, checked' });
  assert.equal(fixed.status, 'direct');
  const added = await act({ action: 'addShift', userId: users[JOHN], clockedInAt: londonInstant(day(-12), '08:00'), clockedOutAt: londonInstant(day(-12), '16:00'), department: 'guest_relations', note: 'Forgot to clock in' });
  assert.equal(added.status, 'direct');
  await assert.rejects(raw({ action: 'addShift', userId: users[JOHN], clockedInAt: londonInstant(day(-14), '06:00'), clockedOutAt: londonInstant(day(-13), '05:00'), department: 'guest_relations', note: 'Long one' }), /over 16 hours/);
  // Correcting Erika's open shift ends the flag.
  await act({ action: 'editShift', shiftId: erikaShift, clockedInAt: londonInstant(ERIKA_DAY, '08:39'), clockedOutAt: londonInstant(ERIKA_DAY, '17:00'), note: 'Forgot to clock out' });
  await as(ADMIN);
  const prod = productivitySchema.parse(await read('productivity', day(-6), day(0))).people.find(x => x.userId === users[ERIKA]);
  assert.deepEqual([prod.notClockedOutSince, prod.minutes], [null, 8 * 60 + 21]);
});

test('clocking out of a shift left open past the limit ends it at 16 hours; ending one over 16 hours needs a yes', async () => {
  // John clocked in two days ago and never out: clocking out now records 16 hours, not 40-odd.
  const started = new Date(Date.now() - 40 * 3600000).toISOString();
  const id = await shift(JOHN, started, null);
  // John is on Stays, so his end-of-day reflection is filled in first.
  await owner("insert into private.workspace_day_reflections(shift_id,user_id,day) values($1,$2,current_date)", [id, users[JOHN]]);
  await as(JOHN);
  await rpc('workspace_teams_action', [{ action: 'clockOut', requestId: crypto.randomUUID() }]);
  const [row] = await owner('select extract(epoch from clocked_out_at-clocked_in_at)/3600 h from private.workspace_shifts where id=$1', [id]);
  assert.equal(Number(row.h), 16, 'ended where its hours stopped counting');
  assert.equal(await notified(SUPER, 'team.shift_not_clocked_out'), 2, 'management was told before it closed');
  await owner('update private.workspace_shifts set clocked_out_at=null where id=$1', [id]);
  // A manager ending it: over 16 hours needs the yes, over 24 is refused.
  await as(SUPER);
  await assert.rejects(raw({ action: 'closeShift', shiftId: id, endedAt: new Date(Date.parse(started) + 20 * 3600000).toISOString() }), /over 16 hours\. Is that right\?/);
  await assert.rejects(raw({ action: 'closeShift', shiftId: id, endedAt: new Date(Date.parse(started) + 25 * 3600000).toISOString(), confirmLong: true }), /at most 24 hours/);
  const closed = await act({ action: 'closeShift', shiftId: id, endedAt: new Date(Date.parse(started) + 9 * 3600000).toISOString(), note: 'Forgot to clock out' });
  assert.equal(closed.status, 'direct');
});

test('VA pay counts the month by day, a shift left open up to the limit', async () => {
  // Alex (an admin, so a VA) in a month that has ended: one shift left open, one across the end of the month.
  const first = new Date(Date.parse(today.slice(0, 7) + '-01T12:00:00Z')); first.setUTCMonth(first.getUTCMonth() - 2);
  const start = first.toISOString().slice(0, 10), next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
  const nextStart = next.toISOString().slice(0, 10), lastDay = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
  await shift(ADMIN, londonInstant(start, '09:00'), null);
  await shift(ADMIN, londonInstant(lastDay, '22:00'), londonInstant(nextStart, '02:00'));
  await owner("insert into private.workspace_va_pay_settings(user_id,hourly_rate_minor,updated_by) values($1,600,$2)", [users[ADMIN], users[SUPER]]);
  const [req] = await owner("select (r).worked_minutes w,(r).days d,(r).hours_minor h from (select private.workspace_va_pay_issue($1,$2::date,current_date,now(),'[]'::jsonb,null) r) x", [users[ADMIN], start]);
  assert.equal(req.w, 16 * 60 + 120, 'the open shift counts 16 hours, the last night only up to midnight');
  assert.equal(req.h, (16 * 60 + 120) * 600 / 60);
  assert.ok(req.d.every(x => x.minutes <= 24 * 60));
});

test('the migration runs twice without changing anything', async () => {
  const fns = ['private.workspace_timesheet_read(date,date,uuid)', 'private.workspace_productivity_read(date,date,uuid)', 'private.workspace_shift_read(text,date,date)',
    'private.workspace_business_report(text,date,date)', 'private.workspace_va_pay_issue(uuid,date,date,timestamptz,jsonb,uuid)', 'private.workspace_va_pay_run(timestamptz)',
    'private.workspace_shift_change_check(uuid,uuid,timestamptz,timestamptz,text)', 'private.workspace_shift_change_action(jsonb)'];
  const defs = async () => Promise.all(fns.map(async f => (await owner('select pg_get_functiondef($1::regprocedure) d', [f]))[0].d));
  const before = await defs();
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await defs(), before);
  const grants = await owner("select count(*)::int n from information_schema.role_routine_grants where routine_schema='private' and routine_name like 'workspace_shift_%' and grantee in ('anon','authenticated','service_role','PUBLIC')");
  assert.equal(grants[0].n, 0);
});
