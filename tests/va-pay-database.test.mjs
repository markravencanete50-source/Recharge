import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// VA pay (migration 20261022200000): who the VAs are, who sees and sets their pay (management only, never their own),
// the monthly Request for Invoice (hours from the timesheet less unpaid pauses, at the hourly rate in force at the month's
// end, plus the bonus of the highest KPI tier reached), made once per VA per month, numbered RC-VA-YYYY-NNNN; approve,
// query, adjust (hours and bonus, with a reason), reject and mark paid, each version-checked and recorded; the in-app
// notices; and who sees which request.
const MIGRATION = 'supabase/migrations/20261022200000_va_pay.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// Safe to run twice.
await db.exec(await fs.readFile(MIGRATION, 'utf8'));

const people = [
  ['super_admin', 'Lee Super', null], ['admin', 'Alex Admin', null], ['stays', 'Mia Manager', 'management'], ['stays', 'Gina Guest', 'guest_relations'],
  ['stays', 'Gus Norota', null], ['accounts', 'Ava Accounts', null], ['cleans', 'Cal Cleaner', null], ['cleans', 'Cora Cleaner', 'management'],
  ['cleaning_manager', 'Carl Manager', null], ['ready', 'Rex Ready', null], ['client', 'Olive Owner', null], ['admin', 'Ada Admin', null],
];
const users = people.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, MGR, GUEST, NOROTA, ACCT, CLEANER, CLEANER_MGMT, CMGR, READY, OWNER, ADMIN2] = people.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `va${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], people[i][0], people[i][1]]);
  if (people[i][2]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,$2,'early')", [users[i], people[i][2]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  if (i === 'backend') { await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); return; }
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_va_pay_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, target = null) => rpc('workspace_va_pay_read', [section, target]);
const run = async at => (await owner('select private.workspace_va_pay_run($1::timestamptz) r', [at]))[0].r;
const requestOf = async i => (await owner('select q.*,q.issue_on::text issued,q.due_on::text due,q.period_start::text ps,q.period_end::text pe,q.paid_on::text paid from private.workspace_va_pay_requests q where q.va_id=$1 order by q.period_start desc', [users[i]]))[0];
const notices = async i => (await owner(`select a.event_type,d.preview,o.id outbox from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join private.workspace_activity_details d on d.event_id=a.id where o.user_id=$1 and a.event_type like 'vapay.%' order by a.id`, [users[i]]));
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

// A clocked shift (London times), optionally with an unpaid lunch pause inside it.
async function shift(i, from, to, dept = 'guest_relations', lunch = null) {
  const [{ id }] = await owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id)
    values($1,$2,($3::timestamp at time zone 'Europe/London'),case when $4::text is null then null else ($4::timestamp at time zone 'Europe/London') end,gen_random_uuid()) returning id`, [users[i], dept, from, to]);
  if (lunch) await owner(`insert into private.workspace_shift_pauses(shift_id,user_id,kind,started_at,ended_at) values($1,$2,'lunch',($3::timestamp at time zone 'Europe/London'),($4::timestamp at time zone 'Europe/London'))`, [id, users[i], lunch[0], lunch[1]]);
  return id;
}
// A guest message and the team's reply after `minutes`, in its own conversation.
async function reply(at, minutes, n) {
  await owner(`insert into private.workspace_guest_messages(source,external_id,thread_ref,direction,sent_at) values('test',$1,$2,'guest',($3::timestamp at time zone 'Europe/London')),
    ('test',$4,$2,'team',($3::timestamp at time zone 'Europe/London')+make_interval(mins=>$5))`, ['g' + n, 't' + n, at, 'r' + n, minutes]);
}

test('the VA rule: the admin and Stays team, by KPI area; never cleaners, owners, Ready or super admins', async () => {
  const is = async i => (await owner('select private.workspace_is_va($1) v,private.workspace_va_area($1) a', [users[i]]))[0];
  const expected = { [SUPER]: false, [ADMIN]: true, [MGR]: true, [GUEST]: true, [NOROTA]: true, [ACCT]: true, [CLEANER]: false, [CLEANER_MGMT]: false, [CMGR]: false, [READY]: false, [OWNER]: false, [ADMIN2]: true };
  for (const [i, va] of Object.entries(expected)) assert.equal((await is(Number(i))).v, va, people[i][1]);
  assert.deepEqual([(await is(ADMIN)).a, (await is(MGR)).a, (await is(GUEST)).a, (await is(NOROTA)).a, (await is(ACCT)).a], ['management', 'management', 'guest_relations', 'guest_relations', 'accounts']);
  // Ready on the guest relations rota is a VA; on its own it is not.
  await owner("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'guest_relations','early')", [users[READY]]);
  assert.equal((await is(READY)).v, true);
  await owner("update private.workspace_staff_rota set department='ready' where user_id=$1", [users[READY]]);
  assert.equal((await is(READY)).v, false);
});

test('who sees VA pay: management (admins, super admins, the management area) set it; VAs only their own requests; nobody else', async () => {
  for (const [i, manage, va] of [[SUPER, true, false], [ADMIN, true, true], [MGR, true, true], [GUEST, false, true], [ACCT, false, true], [CLEANER, false, false], [CLEANER_MGMT, false, false], [CMGR, false, false], [READY, false, false], [OWNER, false, false]]) {
    await as(i);
    assert.deepEqual(await read('access'), { canManage: manage, isVa: va }, people[i][1]);
    if (manage) assert.equal((await read('setup')).canEdit, true, people[i][1]);
    else await assert.rejects(read('setup'), /42501|Only management|VA pay access required/, people[i][1]);
    if (!manage && !va) await assert.rejects(read('requests'), /VA pay access required/, people[i][1]);
  }
  await as(MGR);
  const setup = await read('setup');
  assert.deepEqual(setup.vas.map(v => v.fullName).sort(), ['Ada Admin', 'Alex Admin', 'Ava Accounts', 'Gina Guest', 'Gus Norota', 'Mia Manager']);
  assert.equal(setup.currency, 'USD');
  assert.ok(setup.bonusKpis.find(k => k.area === 'guest_relations' && k.targetPercent === 90), 'the area bonus KPIs with their tiers');
});

test('pay setup: hourly rate and bonus per tier in cents, version-checked, every change kept with who and when; never your own', async () => {
  await as(MGR);
  const saved = await act({ action: 'saveVaPay', vaId: users[GUEST], version: 0, hourlyRateMinor: 1250, bonusTargetMinor: 5000, bonusTier2Minor: 10000, bonusTier3Minor: 20000 });
  assert.deepEqual(saved, { vaId: users[GUEST], hourlyRateMinor: 1250, bonusTargetMinor: 5000, bonusTier2Minor: 10000, bonusTier3Minor: 20000, currency: 'USD', version: 1 });
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[GUEST], version: 0, hourlyRateMinor: 1300 }), /changed by someone else/, 'a stale version');
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[MGR], version: 0, hourlyRateMinor: 9000 }), /your own pay/, 'not your own pay');
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[CLEANER], version: 0, hourlyRateMinor: 1000 }), /Only VAs/);
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[ACCT], version: 0, hourlyRateMinor: 0 }), /hourly rate/);
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[ACCT], version: 0, hourlyRateMinor: 1000, currency: 'GBP' }), /22023|Unknown|unexpected|key/i, 'no currency choice');
  await as(GUEST);
  await assert.rejects(act({ action: 'saveVaPay', vaId: users[ACCT], version: 0, hourlyRateMinor: 1000 }), /Only management/);
  await as(ADMIN);
  await act({ action: 'saveVaPay', vaId: users[MGR], version: 0, hourlyRateMinor: 2000, bonusTargetMinor: 10000, bonusTier2Minor: 20000, bonusTier3Minor: 30000 });
  await act({ action: 'saveVaPay', vaId: users[ACCT], version: 0, hourlyRateMinor: 1500, bonusTargetMinor: 1000, bonusTier2Minor: 2000, bonusTier3Minor: 3000 });
  await act({ action: 'saveVaPay', vaId: users[NOROTA], version: 0, hourlyRateMinor: 1000 });
  const history = await owner('select h.before,h.after,h.changed_by from private.workspace_va_pay_settings_history h where h.user_id=$1 order by h.id', [users[GUEST]]);
  assert.equal(history.length, 1);
  assert.equal(history[0].before, null); assert.equal(history[0].after.hourly_rate_minor, 1250); assert.equal(history[0].changed_by, users[MGR]);
  await as(SUPER);
  assert.equal((await read('setup')).history.length, 4);
});

test('the monthly run: on the 1st, one request per VA with a rate and clocked time, hours less unpaid pauses, once only', async () => {
  // September 2026 (BST). Gina: 08:00-16:30 with a 30-minute unpaid lunch (480) and 09:00-13:15 (255) = 735 minutes; a
  // shift that starts at 00:30 on 1 October London (23:30 UTC on 30 September) belongs to October; an open shift is left out.
  await shift(GUEST, '2026-09-07 08:00', '2026-09-07 16:30', 'guest_relations', ['2026-09-07 12:00', '2026-09-07 12:30']);
  await shift(GUEST, '2026-09-08 09:00', '2026-09-08 13:15');
  await shift(GUEST, '2026-08-31 22:00', '2026-08-31 23:30');
  await shift(GUEST, '2026-10-01 00:30', '2026-10-01 02:00');
  // An admin's correction changes the shift itself: 09:00-13:00 corrected to 09:00-13:15 above is what counts.
  await owner("update private.workspace_shifts set edited_by=$1,edited_at=now(),edit_note='Forgot to clock out' where user_id=$2 and clocked_in_at=('2026-09-08 09:00'::timestamp at time zone 'Europe/London')", [users[ADMIN], users[GUEST]]);
  // Guest replies on 9 September while Gina is on shift: 19 of 20 within 5 minutes = 95%, the first tier beyond the
  // guest relations target of 90 (tiers 95 and 100), so "tier 2".
  await shift(GUEST, '2026-09-09 09:00', '2026-09-09 10:00');
  for (let n = 0; n < 20; n++) await reply(`2026-09-09 09:${String(n * 2).padStart(2, '0')}`, n === 0 ? 20 : 2, n);
  // Mia (management): 6 hours. Her bonus KPI is both teams combined: guest relations 95%, client relations nobody, so 95,
  // the second tier beyond the target of 80 (tiers 90 and 95): "tier 3".
  await shift(MGR, '2026-09-10 10:00', '2026-09-10 16:00', 'management');
  // Ava (accounts): 3 hours; her performance score has nothing to measure, so no bonus.
  await shift(ACCT, '2026-09-11 09:00', '2026-09-11 12:00', 'accounts');
  // Alex has hours but no rate; Gus has a rate but no hours: neither gets a request. Cleaners are never VAs.
  await shift(ADMIN, '2026-09-11 09:00', '2026-09-11 17:00', 'management');
  await shift(CLEANER, '2026-09-11 09:00', '2026-09-11 17:00', 'cleaning');
  await shift(GUEST, '2026-09-30 09:00', null);
  // A rate changed after the month ended does not apply to it.
  await as(MGR);
  await act({ action: 'saveVaPay', vaId: users[GUEST], version: 1, hourlyRateMinor: 9999, bonusTargetMinor: 5000, bonusTier2Minor: 10000, bonusTier3Minor: 20000 });
  // The setup was made in August; the new rate on 1 October, after September ended.
  await owner("update private.workspace_va_pay_settings_history set changed_at='2026-08-01 12:00+01'");
  await owner("update private.workspace_va_pay_settings_history set changed_at='2026-10-01 00:10+01' where user_id=$1 and (after->>'hourly_rate_minor')::int=9999", [users[GUEST]]);

  assert.equal((await run('2026-09-30T12:00:00Z')).requests, 0, '30 September: the month has not ended');
  const first = await run('2026-09-30T23:30:00Z');
  assert.deepEqual([first.requests, first.periodStart, first.periodEnd], [3, '2026-09-01', '2026-09-30'], '00:30 on 1 October London');
  assert.equal((await run('2026-10-01T05:00:00Z')).requests, 0, 'again: nothing new');
  assert.equal((await run('2026-10-06T05:00:00Z')).requests, 0, 'a catch-up run in the first week: nothing new');
  assert.equal((await run('2026-10-20T05:00:00Z')).requests, 0, 'outside the first week nothing runs');
  assert.equal((await owner('select count(*)::int n from private.workspace_va_pay_requests'))[0].n, 3);
  assert.equal(await requestOf(ADMIN), undefined); assert.equal(await requestOf(NOROTA), undefined); assert.equal(await requestOf(CLEANER), undefined);
  // The unique key holds whatever calls it.
  await assert.rejects(owner("insert into private.workspace_va_pay_requests(number,va_id,va_name,period_start,period_end,hourly_rate_minor,worked_minutes,hours_minor,total_minor,issue_on,due_on) values('RC-VA-2026-9999',$1,'x','2026-09-01','2026-09-30',1,1,1,1,'2026-10-01','2026-10-08')", [users[GUEST]]), /duplicate key/);

  const g = await requestOf(GUEST);
  assert.match(g.number, /^RC-VA-2026-000[123]$/);
  assert.deepEqual([g.status, g.ps, g.pe, g.issued, g.due, g.currency, g.va_name, g.area], ['to_approve', '2026-09-01', '2026-09-30', '2026-10-01', '2026-10-08', 'USD', 'Gina Guest', 'guest_relations']);
  assert.equal(g.worked_minutes, 795, '735 + the 60-minute shift on the 9th');
  assert.deepEqual(g.days, [{ day: '2026-09-07', minutes: 480 }, { day: '2026-09-08', minutes: 255 }, { day: '2026-09-09', minutes: 60 }]);
  assert.equal(g.hourly_rate_minor, 1250, 'the rate in force at the end of the month');
  // 795 x 1250 / 60 = 16562.5 cents: half a cent rounds up.
  assert.equal(Number(g.hours_minor), 16563);
  assert.deepEqual([g.kpi_name, g.kpi_value, g.kpi_tier, Number(g.bonus_auto_minor), Number(g.total_minor)], ['Replies within 5 minutes', 95, 'tier2', 10000, 26563]);
  const m = await requestOf(MGR);
  assert.deepEqual([m.worked_minutes, Number(m.hours_minor), m.kpi_value, m.kpi_tier, Number(m.bonus_auto_minor), Number(m.total_minor)], [360, 12000, 95, 'tier3', 30000, 42000]);
  const a = await requestOf(ACCT);
  assert.deepEqual([a.worked_minutes, Number(a.hours_minor), a.kpi_value, a.kpi_tier, Number(a.bonus_auto_minor), Number(a.total_minor)], [180, 4500, null, null, 0, 4500]);
  assert.deepEqual((await owner("select change from private.workspace_va_pay_request_changes where request_id=$1", [g.id])).map(r => r.change), ['issued']);
  const numbers = (await owner('select number from private.workspace_va_pay_requests order by number')).map(r => r.number);
  assert.deepEqual(numbers, ['RC-VA-2026-0001', 'RC-VA-2026-0002', 'RC-VA-2026-0003']);
});

test('the bonus rule: the highest tier reached pays, alone; below the target or nothing measured, none', async () => {
  const tier = async (r) => (await owner('select private.workspace_va_bonus_tier($1::jsonb) t', [JSON.stringify(r)]))[0].t;
  assert.equal(await tier({ value: 85, onTarget: false, tier: null }), null);
  assert.equal(await tier({ value: 90, onTarget: true, tier: null }), 'target');
  assert.equal(await tier({ value: 95, onTarget: true, tier: 1 }), 'tier2');
  assert.equal(await tier({ value: 100, onTarget: true, tier: 2 }), 'tier3');
  assert.equal(await tier({ value: 100, onTarget: true, tier: 3 }), 'tier3', 'a third tier beyond the target still pays tier 3');
  assert.equal(await tier({ value: null, onTarget: null, tier: null }), null);
  const s = { bonus_target_minor: 5000, bonus_tier2_minor: 10000, bonus_tier3_minor: 20000 };
  const amount = async t => Number((await owner('select private.workspace_va_bonus_amount($1,$2::jsonb) a', [t, JSON.stringify(s)]))[0].a);
  assert.deepEqual([await amount('target'), await amount('tier2'), await amount('tier3'), await amount(null)], [5000, 10000, 20000, 0], 'never added up');
  // Against the real KPI tier function (lower is better works the same way).
  const real = async (dir, target, tiers, value) => (await owner('select private.workspace_va_bonus_tier(private.workspace_kpi_tier($1,$2,$3::int[],$4)||jsonb_build_object(\'value\',$4::int)) t', [dir, target, tiers, value]))[0].t;
  assert.deepEqual([await real('higher', 80, [90, 95], 79), await real('higher', 80, [90, 95], 80), await real('higher', 80, [90, 95], 92), await real('higher', 80, [90, 95], 99)], [null, 'target', 'tier2', 'tier3']);
  assert.deepEqual([await real('lower', 10, [5, 2], 11), await real('lower', 10, [5, 2], 10), await real('lower', 10, [5, 2], 4), await real('lower', 10, [5, 2], 1)], [null, 'target', 'tier2', 'tier3']);
});

test('who sees which request: a VA only their own, management all, with the changes; nobody else', async () => {
  const g = await requestOf(GUEST), m = await requestOf(MGR);
  await as(GUEST);
  const mine = await read('requests');
  assert.deepEqual(mine.map(r => r.number), [g.number]);
  assert.equal(mine[0].own, true);
  await assert.rejects(read('request', m.id), /Request not found/);
  const one = await read('request', g.id);
  assert.deepEqual(one.days.length, 3); assert.equal(one.changes, undefined, 'the VA does not see the change log');
  await as(ACCT);
  assert.equal((await read('requests')).length, 1);
  for (const i of [ADMIN, MGR, SUPER]) { await as(i); assert.equal((await read('requests')).length, 3, people[i][1]); assert.ok(Array.isArray((await read('request', g.id)).changes)); }
  for (const i of [CLEANER, CLEANER_MGMT, CMGR, READY, OWNER]) { await as(i); await assert.rejects(read('request', g.id), /VA pay access required/, people[i][1]); }
  // The run is for the backend only.
  await as(ADMIN);
  await assert.rejects(rpc('workspace_va_pay_run'), /permission denied/);
  await as('backend');
  assert.equal(typeof (await rpc('workspace_va_pay_run')).requests, 'number');
});

test('approve, query, adjust with a reason, reject and mark paid; version-checked, recorded, never your own', async () => {
  let g = await requestOf(GUEST);
  await as(GUEST);
  await assert.rejects(act({ action: 'approveVaRequest', id: g.id, version: g.version }), /Only management/);
  await as(MGR);
  await assert.rejects(act({ action: 'approveVaRequest', id: (await requestOf(MGR)).id, version: 1 }), /your own request/);
  // Query with a note: still to approve, the VA sees the note.
  let r = await act({ action: 'queryVaRequest', id: g.id, version: g.version, note: 'Was the 9th a full hour?' });
  assert.deepEqual([r.status, r.queried, r.queryNote, r.version], ['to_approve', true, 'Was the 9th a full hour?', 2]);
  await assert.rejects(act({ action: 'approveVaRequest', id: g.id, version: 1 }), /changed by someone else/, 'a stale version');
  // Adjust the hours (+30 minutes) and the bonus, each with the reason recorded.
  await assert.rejects(act({ action: 'adjustVaRequest', id: g.id, version: 2, hoursAdjustMinutes: 30 }), /reason/i);
  await assert.rejects(act({ action: 'adjustVaRequest', id: g.id, version: 2, reason: 'Nothing to change' }), /Change the hours or the bonus/);
  await assert.rejects(act({ action: 'adjustVaRequest', id: g.id, version: 2, hoursAdjustMinutes: -900, reason: 'Too much off' }), /below zero/);
  r = await act({ action: 'adjustVaRequest', id: g.id, version: 2, hoursAdjustMinutes: 30, reason: 'Clocked out late on the 7th' });
  // 825 x 1250 / 60 = 17187.5, rounded up to 17188.
  assert.deepEqual([r.minutes, r.hoursMinor, r.bonusMinor, r.totalMinor, r.hoursAdjustReason], [825, 17188, 10000, 27188, 'Clocked out late on the 7th']);
  r = await act({ action: 'adjustVaRequest', id: g.id, version: 3, bonusMinor: 2500, reason: 'Two guest complaints this month' });
  assert.deepEqual([r.bonusMinor, r.bonusAdjusted, r.bonusAutoMinor, r.totalMinor, r.minutes], [2500, true, 10000, 19688, 825], 'the hours correction stays');
  r = await act({ action: 'adjustVaRequest', id: g.id, version: 4, bonusMinor: null, reason: 'Back to the KPI bonus' });
  assert.deepEqual([r.bonusMinor, r.bonusAdjusted, r.totalMinor], [10000, false, 27188]);
  const changes = await owner('select change,reason,changed_by from private.workspace_va_pay_request_changes where request_id=$1 order by id', [g.id]);
  assert.deepEqual(changes.map(c => [c.change, c.reason]), [['issued', null], ['queried', 'Was the 9th a full hour?'], ['adjusted', 'Clocked out late on the 7th'], ['adjusted', 'Two guest complaints this month'], ['adjusted', 'Back to the KPI bonus']]);
  assert.ok(changes.slice(1).every(c => c.changed_by === users[MGR]));
  // Approve: due 7 days after issue; the VA is told in the app.
  r = await act({ action: 'approveVaRequest', id: g.id, version: 5 });
  assert.deepEqual([r.status, r.dueOn], ['approved', '2026-10-08']);
  await assert.rejects(act({ action: 'adjustVaRequest', id: g.id, version: 6, hoursAdjustMinutes: 0, reason: 'Too late now' }), /waiting for approval/);
  await assert.rejects(act({ action: 'markVaRequestPaid', id: g.id, version: 6, paidOn: '2026-09-30' }), /between the issue date and today/);
  r = await act({ action: 'markVaRequestPaid', id: g.id, version: 6, paidOn: '2026-10-07' });
  assert.deepEqual([r.status, r.paidOn, r.version], ['paid', '2026-10-07', 7]);
  assert.deepEqual((await notices(GUEST)).map(n => [n.event_type, n.preview]), [
    ['vapay.request_queried', `Request ${g.number} queried: Was the 9th a full hour?`],
    ['vapay.request_approved', `Request ${g.number} approved: please send us your invoice for $271.88`],
    ['vapay.request_paid', `Paid: $271.88 (${g.number})`]]);
  // Reject: a note, and then it cannot be approved.
  const a = await requestOf(ACCT);
  await as(SUPER);
  await assert.rejects(act({ action: 'rejectVaRequest', id: a.id, version: a.version, note: 'no' }), /note/i);
  r = await act({ action: 'rejectVaRequest', id: a.id, version: a.version, note: 'Hours belong to another month' });
  assert.equal(r.status, 'rejected');
  await assert.rejects(act({ action: 'approveVaRequest', id: a.id, version: r.version }), /waiting for approval/);
  assert.deepEqual((await notices(ACCT)).map(n => [n.event_type, n.preview]), [['vapay.request_rejected', `Request ${a.number} rejected: Hours belong to another month`]], 'the VA is told why');
  // Mia's own request is approved by an admin.
  const m = await requestOf(MGR);
  await as(ADMIN2);
  assert.equal((await act({ action: 'approveVaRequest', id: m.id, version: m.version })).status, 'approved');
  // The same request identifier with the same input answers again without acting twice.
  const requestId = crypto.randomUUID();
  await as(ADMIN);
  const once = await rpc('workspace_va_pay_action', [{ action: 'markVaRequestPaid', requestId, id: m.id, version: 2, paidOn: '2026-10-09' }]);
  assert.deepEqual(await rpc('workspace_va_pay_action', [{ action: 'markVaRequestPaid', requestId, id: m.id, version: 2, paidOn: '2026-10-09' }]), once);
  g = await requestOf(GUEST);
  assert.equal(g.paid, '2026-10-07');
});

test('vapay notices stay in the app: no email or phone push is queued for them', async () => {
  await owner("insert into private.workspace_device_tokens(user_id,device_id,push_token,platform) values($1,gen_random_uuid(),'test-token-for-gina-000000001','ios')", [users[GUEST]]);
  // Recent notices only get a delivery: make Gina's vapay notices and one ordinary notice recent.
  await owner("update public.workspace_activity a set created_at=now() from private.workspace_notification_outbox o where o.event_id=a.id and o.user_id=$1", [users[GUEST]]);
  await owner("with e as (insert into public.workspace_activity(event_type) values('team.rota_planned') returning id) insert into private.workspace_notification_outbox(user_id,event_id) select $1,id from e", [users[GUEST]]);
  await owner('select private.integration_claim_notifications(true,true)');
  const delivered = await owner(`select a.event_type,d.channel from private.workspace_notification_deliveries d join private.workspace_notification_outbox o on o.id=d.outbox_id
    join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 order by d.channel`, [users[GUEST]]);
  assert.deepEqual(delivered.map(d => [d.event_type, d.channel]), [['team.rota_planned', 'email'], ['team.rota_planned', 'push']]);
  assert.match((await owner("select pg_get_functiondef('private.integration_claim_web_push()'::regprocedure) d"))[0].d, /a\.event_type not like 'vapay\.%'/);
  assert.equal((await notices(GUEST)).length, 3, 'still in the in-app list');
  // Queried and rejected notices stay in the app too.
  await owner("update public.workspace_activity a set created_at=now() from private.workspace_notification_outbox o where o.event_id=a.id and o.user_id=$1", [users[ACCT]]);
  await owner('select private.integration_claim_notifications(true,true)');
  assert.deepEqual(await owner('select d.id from private.workspace_notification_deliveries d join private.workspace_notification_outbox o on o.id=d.outbox_id where o.user_id=$1', [users[ACCT]]), []);
});

test('issue now: management issues one VA\'s request for a month that has ended, as the run would; version-checked, once, never your own', async () => {
  const version = async i => (await owner('select coalesce((select version from private.workspace_va_pay_settings where user_id=$1),0) v', [users[i]]))[0].v;
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const v = await version(GUEST);
  await as(GUEST);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[ACCT], month: '2026-08', version: await version(ACCT) }), /Only management/);
  await as(MGR);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[MGR], month: '2026-08', version: await version(MGR) }), /your own request/, 'not your own pay');
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: thisMonth, version: v }), /has ended/, 'this month has not ended');
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: '2020-01', version: v }), /last two years/);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: '2026-13', version: v }), /Choose a month/);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: '2026-08', version: v - 1 }), /changed by someone else/, 'a stale version');
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: '2026-09', version: v }), /already a request/, 'the same unique key');
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[NOROTA], month: '2026-08', version: await version(NOROTA) }), /No clocked time/);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[ADMIN], month: '2026-09', version: await version(ADMIN) }), /hourly rate/);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[CLEANER], month: '2026-08', version: 0 }), /Only VAs/);
  const before = (await owner('select count(*)::int n from private.workspace_va_pay_requests'))[0].n;
  // Gina, August 2026: the 22:00-23:30 shift on 31 August (90 minutes) at the rate in force then ($12.50); nothing to
  // measure for the bonus.
  const requestId = crypto.randomUUID(), input = { action: 'issueVaRequest', requestId, vaId: users[GUEST], month: '2026-08', version: v };
  const r = await rpc('workspace_va_pay_action', [input]);
  assert.deepEqual([r.status, r.periodStart, r.periodEnd, r.minutes, r.hourlyRateMinor, r.hoursMinor, r.bonusMinor, r.totalMinor], ['to_approve', '2026-08-01', '2026-08-31', 90, 1250, 1875, 0, 1875]);
  assert.match(r.number, /^RC-VA-\d{4}-\d{4}$/);
  assert.deepEqual(await rpc('workspace_va_pay_action', [input]), r, 'the same request identifier answers again');
  assert.equal((await owner('select count(*)::int n from private.workspace_va_pay_requests'))[0].n, before + 1);
  await assert.rejects(act({ action: 'issueVaRequest', vaId: users[GUEST], month: '2026-08', version: v }), /already a request/);
  const [c] = await owner('select change,reason,changed_by from private.workspace_va_pay_request_changes where request_id=$1', [r.id]);
  assert.deepEqual([c.change, c.reason, c.changed_by], ['issued', 'Issued now by management', users[MGR]]);
  assert.equal((await owner('select count(*)::int n from private.workspace_action_receipts where request_id=$1', [requestId]))[0].n, 1);
  // The run for August then leaves it alone.
  assert.equal((await run('2026-09-01T05:00:00Z')).requests, 0, 'August: Gina is already issued and nobody else has August hours');
  await as(GUEST);
  assert.ok((await read('requests')).some(x => x.id === r.id), 'Gina sees it');
});
