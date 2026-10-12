import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The end-of-day reflection (A7): required before clocking out for Stays, Ready, Accounts and the
// cleaning manager; it signs off the day; admins read and mark them; owners are refused everything.
const NAME = 'supabase/migrations/20261012150000_day_reflection.sql';
// While the migration is still a draft it is applied after every finished migration (rule R1).
const DRAFT = !existsSync(NAME);
const MIGRATION = DRAFT ? NAME + '.draft' : NAME;
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { REFLECTION_REQUIRED_ROLES, reflectionRequired } = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
if (DRAFT) await db.exec(await fs.readFile(MIGRATION, 'utf8'));

const roles = ['super_admin', 'admin', 'stays', 'stays', 'ready', 'accounts', 'cleaning_manager', 'cleans', 'client', 'stays'];
const names = ['Sam Super', 'Alex Admin', 'Dan Stays', 'Erin Stays', 'Rory Ready', 'Aileen Accounts', 'Cara Manager', 'Col Cleaner', 'Owen Owner', 'Fay Stays'];
const [SUPER, ADMIN, DAN, ERIN, READY, ACC, CM, CLEANER, OWNER, FAY] = roles.map((_, i) => i);
const DEPT = { stays: 'guest_relations', ready: 'ready', accounts: 'accounts', cleaning_manager: 'cleaning', cleans: 'cleaning', admin: 'management', super_admin: 'management' };
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `reflection${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
// Trusted database work with nobody signed in.
async function automatic() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
const owner = async (text, args = []) => { await automatic(); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
// Straight to the database, past the app's schema, to check the database's own rules.
const raw = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, from = null, to = null) => {
  teamsReadSchema.parse({ section, ...(from ? { from, to } : {}) });
  return rpc('workspace_teams_read', [section, from, to, null, null]);
};
const notified = async (i, event, actor = null) => (await owner(`select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  where o.user_id=$1 and a.event_type=$2 and ($3::uuid is null or a.actor_id=$3)`, [users[i], event, actor === null ? null : users[actor]]))[0].n;
const signoffs = async (i, day) => (await owner('select day::text,confirmations from private.workspace_daily_signoffs where user_id=$1 and ($2::date is null or day=$2) order by day', [users[i], day]));
const today = (await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const day = n => (new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000)).toISOString().slice(0, 10);
// A moment on a UK day, at a UK clock time.
const at = (d, time) => `(('${d}'::date + time '${time}') at time zone 'Europe/London')`;
const note = (wentWell, notWell = '', feedback = '', completed = []) => ({ action: 'saveReflection', wentWell, notWell, feedback, completed });
const REFUSED = /Fill in your end-of-day reflection before clocking out/;
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(async () => { await db.close(); await vite.close(); });
const shifts = {};

test('the rule is one immutable function that matches the app', async () => {
  await automatic();
  for (const role of ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client', null]) {
    const got = (await db.query('select private.workspace_reflection_required($1) r', [role])).rows[0].r;
    assert.equal(got, reflectionRequired(role), String(role));
  }
  assert.deepEqual([...REFLECTION_REQUIRED_ROLES].sort(), ['accounts', 'cleaning_manager', 'ready', 'stays']);
  assert.equal((await db.query("select provolatile from pg_proc where oid='private.workspace_reflection_required(text)'::regprocedure")).rows[0].provolatile, 'i');
});

test('stays, ready, accounts and the cleaning manager cannot clock out without a reflection; cleaners and admins can', async () => {
  for (const i of [DAN, READY, ACC, CM]) {
    await as(i);
    shifts[i] = (await act({ action: 'clockIn', department: DEPT[roles[i]] })).id;
    const mine = await read('reflection');
    assert.deepEqual([mine.required, mine.missing, mine.shift.id, mine.day, mine.reflection], [true, true, shifts[i], today, null], roles[i]);
    await assert.rejects(act({ action: 'clockOut' }), REFUSED, roles[i]);
    assert.equal((await owner('select clocked_out_at from private.workspace_shifts where id=$1', [shifts[i]]))[0].clocked_out_at, null, 'still on the clock');
  }
  for (const i of [CLEANER, ADMIN, SUPER]) {
    await as(i);
    await act({ action: 'clockIn', department: DEPT[roles[i]] });
    const mine = await read('reflection');
    assert.deepEqual([mine.required, mine.missing], [false, false], roles[i]);
    assert.ok((await act({ action: 'clockOut' })).clockedOutAt, roles[i]);
  }
  // Once written, they clock out as before.
  await as(READY);
  const saved = await act(note('Fixed the boiler at Leith', '', '', [{ kind: 'ticket', ref: null, label: 'Boiler at Leith' }]));
  assert.deepEqual([saved.shiftId, saved.day, saved.wentWell, saved.completed], [shifts[READY], today, 'Fixed the boiler at Leith', [{ kind: 'ticket', ref: null, label: 'Boiler at Leith' }]]);
  assert.equal((await read('reflection')).missing, false);
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt);
  await as(ACC);
  await act(note('', 'The bank feed was late again'));
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt);
  await assert.rejects(act({ action: 'clockOut' }), /not clocked in/, 'not clocked in is still the answer once out');
});

test('saving signs off the day once, replays safely, and a second save changes it', async () => {
  await as(DAN);
  const input = teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...note('Cleared the inbox', 'Two late check-ins', 'More cover on Fridays', [{ kind: 'todo', ref: 'abc', label: 'Called the Leith owner' }]) });
  const first = await rpc('workspace_teams_action', [input]);
  const again = await rpc('workspace_teams_action', [input]);
  assert.deepEqual(again, first, 'the same request gives the same answer');
  await assert.rejects(rpc('workspace_teams_action', [{ ...input, feedback: 'Something else' }]), /Request identifier reused/);
  assert.deepEqual(await signoffs(DAN, today), [{ day: today, confirmations: { reflection: true } }]);
  assert.equal(await notified(ADMIN, 'reflection.saved', DAN), 1, 'admins hear about it');
  assert.equal(await notified(SUPER, 'reflection.saved', DAN), 1);
  assert.equal(await notified(DAN, 'reflection.saved', DAN), 0, 'not the writer');
  await as(DAN);
  const changed = await act(note('Cleared the inbox by 3pm', 'Two late check-ins', 'More cover on Fridays'));
  assert.deepEqual([changed.id, changed.version, changed.wentWell, changed.completed], [first.id, 2, 'Cleared the inbox by 3pm', []]);
  assert.equal((await signoffs(DAN, today)).length, 1, 'still one sign-off');
  assert.equal((await owner('select count(*)::int n from private.workspace_day_reflections where user_id=$1', [users[DAN]]))[0].n, 1);
  assert.equal(await notified(ADMIN, 'reflection.saved', DAN), 1, 'changing it is not news');
  // The reflection is the Stays sign-off for the day.
  await as(DAN);
  await assert.rejects(act({ action: 'signOffDay', allVisible: true, reviewsHandled: true, suspensionsHandled: true, relistingsDone: true }), /already signed off today/);
  // The database's own checks.
  await assert.rejects(raw(note('ok', 'no')), /Say what went well or what did not/);
  await assert.rejects(raw(note('Fine day', '', '', [{ kind: 'ticket', label: ' ' }])), /Check the list of things done/);
  await assert.rejects(raw(note('Fine day', '', '', [{ kind: 'ticket', label: 'A', extra: 1 }])), /Check the list of things done/);
  await assert.rejects(raw(note('Fine day', '', '', 'none')), /Check the list of things done/);
  await assert.rejects(raw(note('Fine day', 'x'.repeat(2001))), /Invalid field notWell/);
  await assert.rejects(raw({ ...note('Fine day'), mood: 'happy' }), /Unknown or oversized/);
  await assert.rejects(raw({ action: 'saveReflection', wentWell: 'Fine day', notWell: '', completed: [] }), /Invalid field feedback/);
  // Out of the shift, it is closed.
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt);
  await assert.rejects(act(note('One more thing')), /You are not clocked in/);
  await assert.rejects(act({ ...note('One more thing'), shiftId: shifts[DAN] }), /That shift has already ended/);
  const mine = await read('reflection');
  assert.deepEqual([mine.shift, mine.missing, mine.reflection.id], [null, false, first.id], 'the day still shows what was written');
});

test('the summary counts what the person did that day, and only that', async () => {
  await as(ADMIN);
  const property = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Reflection flat', address: '2 Test Street', region: 'Glasgow', bedrooms: 2 })])).rows[0].id;
  await automatic();
  const moduleId = (await db.query('select module_id from public.workspace_features order by module_id limit 1')).rows[0].module_id;
  const work = [];
  for (const title of ['Leith boiler', 'Portobello keys', 'Old fence']) {
    work.push((await db.query("insert into public.workspace_work_items(property_id,module_id,title,status,created_by,request_id) values($1,$2,$3,'waiting',$4,gen_random_uuid()) returning id", [property, moduleId, title, users[ADMIN]])).rows[0].id);
  }
  const [W1, W2, W3] = work;
  const [E, D] = [users[ERIN], users[DAN]];
  await db.query(`insert into public.workspace_activity(actor_id,property_id,work_id,event_type,created_at) values
   ($1,$3,$4,'test.touch',${at(today, '09:00')}),($1,$3,$4,'test.touch',${at(today, '10:00')}),($1,$3,$5,'test.touch',${at(today, '11:00')}),
   ($1,$3,$6,'test.touch',${at(day(-1), '23:30')}),($2,$3,$6,'test.touch',${at(today, '11:00')}),($1,null,null,'test.nowork',${at(today, '11:00')})`, [E, D, property, W1, W2, W3]);
  await db.query(`insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,expected_version,created_at) values
   ($2,$1,gen_random_uuid(),'waiting','completed',1,${at(today, '12:00')}),($3,$1,gen_random_uuid(),'waiting','completed',1,${at(day(-1), '12:00')}),
   ($4,$1,gen_random_uuid(),'waiting','in_progress',1,${at(today, '12:00')})`, [E, W2, W3, W1]);
  await db.query(`insert into private.workspace_hub_items(kind,title,assignee_id,status,decided_by,decided_at,created_by) values
   ('todo','Order bin bags',$1,'done',$1,${at(today, '13:00')},$1),('todo','Ring the plumber',$1,'done',$1,${at(today, '14:00')},$2),
   ('todo','Yesterday task',$1,'done',$1,${at(day(-1), '14:00')},$1),('todo','Dan task',$2,'done',$2,${at(today, '14:00')},$2),('todo','Still open',$1,'open',null,null,$1)`, [E, D]);
  await db.query(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,author_user_id,delivery) values
   ('manual','r1','t1','airbnb','team',${at(today, '09:30')},$1,'logged'),('manual','r2','t1','airbnb','team',${at(today, '15:30')},$1,'sent'),
   ('manual','r3','t1','airbnb','team',${at(today, '16:30')},$1,'failed'),('manual','r4','t1','airbnb','team',${at(day(-1), '16:30')},$1,'sent'),
   ('manual','r5','t1','airbnb','guest',${at(today, '09:00')},null,null),('manual','r6','t1','airbnb','team',${at(today, '10:30')},$2,'sent')`, [E, D]);
  await as(ERIN);
  shifts[ERIN] = (await act({ action: 'clockIn', department: 'guest_relations' })).id;
  const mine = await read('reflection');
  const { items, ...counts } = mine.summary;
  assert.deepEqual(counts, { day: today, ticketsTouched: 2, ticketsCompleted: 1, todosDone: 2, guestReplies: 2 });
  assert.deepEqual(items.map(x => [x.kind, x.label]), [['todo', 'Ring the plumber'], ['todo', 'Order bin bags'], ['ticket', 'Portobello keys']], 'newest first');
  assert.equal(items.find(x => x.kind === 'ticket').ref, W2);
  // The summary as it stood is kept with the reflection; its items fit the "completed" list.
  const saved = await act(note('Busy but fine', '', '', items));
  assert.deepEqual(saved.summary, mine.summary);
  assert.deepEqual(saved.completed, items);
  // Dan's summary is his own.
  await automatic();
  const dan = (await db.query('select private.workspace_day_summary($1,$2::date) s', [D, today])).rows[0].s;
  assert.deepEqual([dan.ticketsTouched, dan.todosDone, dan.guestReplies], [1, 1, 1]);
});

test('nobody can write into someone else\'s shift', async () => {
  for (const i of [DAN, SUPER, CLEANER]) {
    await as(i);
    await assert.rejects(act({ ...note('Not mine to write'), shiftId: shifts[CM] }), /Shift not found/, roles[i]);
  }
  assert.equal((await owner('select count(*)::int n from private.workspace_day_reflections where shift_id=$1', [shifts[CM]]))[0].n, 0);
  await as(CM);
  assert.equal((await read('reflection')).missing, true, 'still waiting for her own');
});

test('admins read everyone\'s reflections and mark them read; nobody else can', async () => {
  await as(ADMIN);
  const list = await read('reflections', day(-1), today);
  const byName = Object.fromEntries(list.items.map(x => [x.fullName, x]));
  assert.deepEqual(Object.keys(byName).sort(), ['Aileen Accounts', 'Dan Stays', 'Erin Stays', 'Rory Ready']);
  assert.equal(list.unreviewed, 4);
  assert.deepEqual([byName['Dan Stays'].role, byName['Dan Stays'].department, byName['Dan Stays'].feedback], ['stays', 'guest_relations', 'More cover on Fridays']);
  await assert.rejects(rpc('workspace_teams_read', ['reflections', day(-40), today, null, null]), /Choose up to 31 days/);
  await assert.rejects(rpc('workspace_teams_read', ['reflections', null, null, null, null]), /Choose up to 31 days/);
  for (const i of [DAN, READY, CM, CLEANER]) {
    await as(i);
    await assert.rejects(read('reflections', day(-1), today), /Management access required/, roles[i]);
    await assert.rejects(act({ action: 'markReflectionsReviewed', ids: [byName['Dan Stays'].id] }), /Management access required/, roles[i]);
  }
  await as(ADMIN);
  const input = teamsActionSchema.parse({ action: 'markReflectionsReviewed', requestId: crypto.randomUUID(), ids: [byName['Dan Stays'].id, byName['Rory Ready'].id] });
  const marked = await rpc('workspace_teams_action', [input]);
  assert.equal(marked.reviewed, 2);
  assert.deepEqual(await rpc('workspace_teams_action', [input]), marked, 'a replay changes nothing');
  assert.equal((await act({ action: 'markReflectionsReviewed', ids: [byName['Dan Stays'].id] })).reviewed, 0, 'already read');
  assert.deepEqual([await notified(DAN, 'reflection.reviewed'), await notified(READY, 'reflection.reviewed'), await notified(ACC, 'reflection.reviewed')], [1, 1, 0]);
  await as(ADMIN);
  await assert.rejects(raw({ action: 'markReflectionsReviewed', ids: ['not-an-id'] }), /Choose the reflections/);
  assert.equal((await read('reflections', day(-1), today)).unreviewed, 2);
  await as(DAN);
  const mine = await read('reflection');
  assert.ok(mine.reflection.reviewedAt);
  assert.equal(mine.reflection.reviewedByName, 'Alex Admin');
});

test('a shift that began yesterday belongs to yesterday, and the missed-day roll-over sees the sign-off', async () => {
  const [fay] = await owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,request_id) values($1,'guest_relations',${at(day(-1), '21:00')},gen_random_uuid()) returning id`, [users[FAY]]);
  await owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',${at(day(-1), '09:00')},${at(day(-1), '17:00')},gen_random_uuid())`, [users[DAN]]);
  await as(FAY);
  await assert.rejects(act({ action: 'clockOut' }), REFUSED);
  const saved = await act(note('Covered the night inbox'));
  assert.deepEqual([saved.shiftId, saved.day], [fay.id, day(-1)]);
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt);
  assert.deepEqual((await signoffs(FAY, null)).map(x => x.day), [day(-1)]);
  await automatic();
  const run = (await db.query(`select private.workspace_roll_over_signoffs(${at(today, '12:00')}) r`)).rows[0].r;
  assert.equal(run.ran, true);
  const missed = (await db.query('select user_id from private.workspace_missed_days where day=$1', [day(-1)])).rows.map(r => r.user_id);
  assert.ok(missed.includes(users[DAN]), 'Dan worked yesterday and did not sign off');
  assert.ok(!missed.includes(users[FAY]), 'Fay\'s reflection signed her day off');
});

test('the admin closeShift still ends a stuck shift', async () => {
  // Cara has not written hers and is stuck on the clock: a super admin ends the shift directly.
  await as(SUPER);
  const closed = await act({ action: 'closeShift', shiftId: shifts[CM], endedAt: new Date().toISOString() });
  assert.equal(closed.status, 'direct');
  assert.ok(closed.clockedOutAt);
  // An admin's closeShift waits for a super admin, as before.
  const [stuck] = await owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,request_id) values($1,'ready',${at(day(-2), '09:00')},gen_random_uuid()) returning id`, [users[READY]]);
  await as(ADMIN);
  const asked = await act({ action: 'closeShift', shiftId: stuck.id, endedAt: new Date(Date.parse(day(-2) + 'T16:00:00Z')).toISOString(), note: 'Forgot to clock out' });
  assert.equal(asked.status, 'pending');
});

test('owners are refused everything', async () => {
  await as(OWNER);
  for (const [section, from, to] of [['reflection', null, null], ['reflections', day(-1), today]]) await assert.rejects(read(section, from, to), /Team access required/, section);
  await assert.rejects(act(note('An owner writing')), /Team access required/);
  await assert.rejects(act({ action: 'markReflectionsReviewed', ids: [users[DAN]] }), /Team access required/);
  // The private functions are not reachable by any signed-in user.
  for (const i of [OWNER, ADMIN]) {
    await as(i);
    await assert.rejects(db.query('select private.workspace_day_summary($1,$2::date)', [users[DAN], today]), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_day_reflections'), /permission denied/);
  }
});

test('the migration runs twice, each anchor occurs once, and it stays locked down', async () => {
  await automatic();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  const def = async fn => (await db.query('select pg_get_functiondef($1::regprocedure) d', [fn])).rows[0].d;
  const count = (text, part) => text.split(part).length - 1;
  const shift = await def('private.workspace_shift_action(jsonb)');
  const clockOut = ["elsif a='clockOut' then", "  perform private.workspace_json_keys(input,array['action','requestId']);"];
  assert.equal(count(shift, clockOut.join('\r\n')) + count(shift, clockOut.join('\n')), 1, 'clockOut anchor');
  assert.equal(count(shift, "elsif a='clockOut' then"), 1);
  assert.equal(count(shift, 'private.workspace_reflection_missing(actor)'), 1, 'clockOut patch once');
  assert.ok(shift.indexOf('private.workspace_reflection_missing(actor)') < shift.indexOf("set clocked_out_at=now()"), 'checked before the shift ends');
  const teamsRead = await def('private.workspace_teams_read(text,date,date,uuid,uuid)');
  assert.equal(count(teamsRead, "elsif section='hub' then result:=private.workspace_hub_read();"), 1);
  assert.equal(count(teamsRead, 'private.workspace_reflection_read()'), 1);
  assert.equal(count(teamsRead, 'private.workspace_reflections_read(start_on,end_on)'), 1);
  const teamsAction = await def('private.workspace_teams_action(jsonb)');
  assert.equal(count(teamsAction, "if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;"), 1);
  assert.equal(count(teamsAction, 'return private.workspace_reflection_action(input);'), 1);
  const table = (await db.query(`select c.relrowsecurity rls,has_table_privilege('authenticated',c.oid,'select') sel,has_table_privilege('anon',c.oid,'insert') ins,
    exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='business_write_limit') limited from pg_class c where c.oid='private.workspace_day_reflections'::regclass`)).rows[0];
  assert.deepEqual(table, { rls: true, sel: false, ins: false, limited: true });
  for (const fn of ['private.workspace_day_summary(uuid,date)', 'private.workspace_reflection_read()', 'private.workspace_reflections_read(date,date)',
    'private.workspace_reflection_action(jsonb)', 'private.workspace_reflection_missing(text)', 'private.workspace_reflection_required(text)']) {
    const rows = (await db.query("select has_function_privilege('authenticated',$1,'execute') a,has_function_privilege('anon',$1,'execute') b,p.prosecdef d,p.proconfig c from pg_proc p where p.oid=$1::regprocedure", [fn])).rows[0];
    assert.deepEqual([rows.a, rows.b], [false, false], fn);
    assert.ok(rows.c?.some(x => /^search_path=("")?$/.test(x)), fn + ' pins the search path');
  }
  // Still the same behaviour: a second shift the same day needs its own reflection but signs off nothing new.
  await as(DAN);
  shifts.dan2 = (await act({ action: 'clockIn', department: 'guest_relations' })).id;
  await assert.rejects(act({ action: 'clockOut' }), REFUSED);
  await act(note('Evening cover went fine'));
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt);
  assert.equal((await signoffs(DAN, today)).length, 1, 'one sign-off a day');
  await as(CLEANER);
  await act({ action: 'clockIn', department: 'cleaning' });
  assert.ok((await act({ action: 'clockOut' })).clockedOutAt, 'cleaners clock out as before');
});
