import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The cleaner flow (migration 20261021500000): stay times from Hostaway, the cleaner's notices (new, moved, cancelled,
// taken off, redo, good morning) with their pop-up sentences, no generic "Update in Recharge" for cleans, start and
// finish times on the form, reviews (guest feedback only to reject, a redo deadline), and pay rates set by admins and
// Accounts only, with their history.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// Safe to run twice.
await db.exec(await fs.readFile('supabase/migrations/20261021500000_cleaner_flow.sql', 'utf8'));
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');

const roles = ['super_admin', 'cleaning_manager', 'accounts', 'stays', 'cleans', 'cleans'];
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, ACCOUNTS, STAYS, ANGELA, BEN] = roles.map((_, i) => i);
const session = i => users[i].replace('9750', '9850');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `flow${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Manager', 'Accounts', 'Stays', 'Angela Cleaner', 'Ben Cleaner'][i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  if (i === 'backend') { await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); return; }
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const teams = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const sync = async reservations => { await as('backend'); return rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: 'L-HAWK', name: '110 Hawk' }], reservations }]); };
const day = async n => (await owner("select (current_date+$1::int)::text d,to_char(current_date+$1::int,'Dy FMDD Mon') label", [n]))[0];
// Every notice a person has, oldest first, with its pop-up sentence.
const notices = async user => owner(`select a.event_type,o.work_id,a.work_id activity_work,d.preview from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join private.workspace_activity_details d on d.event_id=a.id where o.user_id=$1 order by a.id`, [users[user]]);
const cleanOf = async ref => (await owner(`select w.id,w.version,w.status,w.due_on::text due,w.assignee_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  join private.workspace_reservations r on r.id::text=d.data->>'reservationId' where d.kind='cleaning' and r.reference=$1 order by w.created_at desc limit 1`, ['HA:' + ref]))[0];
const stay = (id, checkIn, checkOut, extra = {}) => ({ id, listingId: 'L-HAWK', checkIn, checkOut, status: 'confirmed', channel: 'airbnb', guests: 2, ...extra });

await as(ADMIN);
const hawk = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '110 Hawk' }]);
const leith = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '12 Leith St' }]);
for (const prop of [hawk, leith]) for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [ANGELA, 'cleaner'], [BEN, 'cleaner']]) await rpc('workspace_assign_property', [prop, users[user], kind]);
await teams({ action: 'setDefaultCleaner', propertyId: hawk, cleanerId: users[ANGELA] });
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

const D3 = await day(3), D4 = await day(4), D5 = await day(5), D1 = await day(-1);

test('a booking brings a clean to the usual cleaner: "New clean" with the checkout and next guests times', async () => {
  // The next stay is listed first, so it is known when the first stay's clean is made.
  const summary = await sync([stay('A2', D3.d, D5.d, { checkInTime: 15, checkOutTime: '11:00' }), stay('A1', D1.d, D3.d, { checkInTime: '16', checkOutTime: '10' })]);
  assert.equal(summary.newCleans, 2);
  const times = await owner("select reference,to_char(check_in_time,'HH24:MI') i,to_char(check_out_time,'HH24:MI') o from private.workspace_reservations where property_id=$1 order by reference", [hawk]);
  assert.deepEqual(times.map(t => [t.reference, t.i, t.o]), [['HA:A1', '16:00', '10:00'], ['HA:A2', '15:00', '11:00']]);
  const first = await cleanOf('A1');
  assert.equal(first.assignee_id, users[ANGELA]);
  const mine = (await notices(ANGELA)).filter(n => n.event_type.startsWith('cleaning.'));
  assert.deepEqual(mine.map(n => n.event_type), ['cleaning.assigned', 'cleaning.assigned']);
  assert.deepEqual(mine.map(n => n.preview).sort(), [`New clean: 110 Hawk, ${D3.label} · checkout 10:00 · next guests 15:00`, `New clean: 110 Hawk, ${D5.label} · checkout 11:00`].sort());
  assert.equal(mine.find(n => n.preview.includes(D3.label)).work_id, first.id, 'the notice opens the clean');
  // The details go to the pop-up.
  const [{ details }] = await owner("select private.integration_push_details(o.id) details from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type='cleaning.assigned' order by o.id limit 1", [users[ANGELA]]);
  assert.match(details.preview, /^New clean: 110 Hawk/);
  // A later sync with the same data sends nothing more, and Hostaway leaving a time out keeps the one already known.
  await sync([stay('A1', D1.d, D3.d), stay('A2', D3.d, D5.d, { checkInTime: 15, checkOutTime: '11:00' })]);
  assert.equal((await notices(ANGELA)).filter(n => n.event_type.startsWith('cleaning.')).length, 2);
  assert.equal((await owner("select to_char(check_out_time,'HH24:MI') o from private.workspace_reservations where reference='HA:A1'"))[0].o, '10:00');
});

test('the cleaner\'s schedule shows the times and never who the guests are', async () => {
  const first = await cleanOf('A1');
  await as(ANGELA);
  const schedule = await rpc('workspace_teams_read', ['schedule', D1.d, D5.d, null, users[ANGELA]]);
  assert.deepEqual(schedule.stays, []);
  assert.deepEqual(schedule.cleanGuests.find(g => g.workId === first.id), { workId: first.id, guestsLeaving: 2, nextArrivalOn: D3.d, nextArrivalGuests: 2, checkoutTime: '10:00', nextArrivalTime: '15:00' });
  const text = JSON.stringify(schedule);
  for (const secret of ['HA:A1', 'airbnb', 'reservationId', 'guestName']) assert.ok(!text.includes(secret), secret);
});

test('a stay that moves or is cancelled tells the cleaner in plain words', async () => {
  await sync([stay('A1', D1.d, D4.d, { checkOutTime: '10' }), stay('A2', D4.d, D5.d, { checkInTime: 15 })]);
  const moved = (await notices(ANGELA)).filter(n => n.event_type === 'cleaning.moved');
  assert.deepEqual(moved.map(n => n.preview), [`Clean moved: 110 Hawk, now ${D4.label}`]);
  const clean = await cleanOf('A1');
  assert.equal(clean.due, D4.d);
  await sync([stay('A1', D1.d, D4.d, { status: 'cancelled' }), stay('A2', D4.d, D5.d)]);
  const cancelled = (await notices(ANGELA)).filter(n => n.event_type === 'cleaning.cancelled');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].preview, `Clean cancelled: 110 Hawk, ${D4.label}. The stay was cancelled in Hostaway`);
});

test('reassigning a clean: "New clean" to the new cleaner, "taken off your list" to the old one; nothing to the person who did it', async () => {
  const clean = await cleanOf('A2');
  const before = (await notices(MANAGER)).length;
  await as(MANAGER);
  await rpc('workspace_assign_work', [clean.id, clean.version, users[BEN]]);
  const ben = (await notices(BEN)).filter(n => n.event_type.startsWith('cleaning.'));
  assert.deepEqual(ben.map(n => n.event_type), ['cleaning.assigned']);
  assert.match(ben[0].preview, new RegExp(`^New clean: 110 Hawk, ${D5.label}`));
  const off = (await notices(ANGELA)).filter(n => n.event_type === 'cleaning.unassigned');
  assert.equal(off.length, 1);
  assert.equal(off[0].preview, `Clean taken off your list: 110 Hawk, ${D5.label}`);
  assert.equal(off[0].work_id, null, 'no longer hers to open'); assert.equal(off[0].activity_work, null);
  assert.equal((await notices(MANAGER)).length, before, 'the manager is not told about their own change');
  await as(ANGELA);
  assert.ok((await rpc('workspace_controls_read', ['notifications', null, null])).some(n => n.event_type === 'cleaning.unassigned'), 'in her Updates');
});

test('no generic "Update in Recharge" to a clean\'s cleaner; other work still gets it', async () => {
  const clean = await cleanOf('A2');
  await owner("update public.workspace_work_items set title='Checkout clean, deep',version=version+1 where id=$1", [clean.id]);
  for (const who of [ANGELA, BEN]) assert.ok(!(await notices(who)).some(n => n.event_type === 'workspace_work_items.update' || n.event_type === 'workspace_work_items.insert'), who);
  assert.ok((await owner("select 1 from public.workspace_activity where work_id=$1 and event_type='workspace_work_items.update'", [clean.id])).length > 0, 'still on the record');
  const [{ id: repair }] = await owner(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'ready-schedule','Fix the tap',$2) returning id`, [hawk, users[ADMIN]]);
  await owner("update public.workspace_work_items set assignee_id=$2 where id=$1", [repair, users[STAYS]]);
  await owner("update public.workspace_work_items set title='Fix the kitchen tap' where id=$1", [repair]);
  assert.ok((await notices(STAYS)).filter(n => n.event_type === 'workspace_work_items.update').length >= 2, 'other kinds of work are unchanged');
  assert.ok(!(await notices(STAYS)).some(n => n.event_type.startsWith('cleaning.')));
});

// A clean by hand at 12 Leith St, assigned to the cleaner and submitted with one verified photo.
async function submitted(cleaner = BEN, form = {}) {
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: leith, kind: 'cleaning', data: { dueOn: D3.d, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[cleaner]]);
  const [{ id: photo }] = await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id", [leith, clean.workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()]);
  await as(cleaner);
  const work = (await rpc('workspace_operations_read', [leith])).find(w => w.workId === clean.workId);
  const done = await operation({ action: 'updateOperation', workId: clean.workId, version: work.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [photo], mailAction: 'none', ...form } });
  return { workId: clean.workId, version: done.version, photo };
}

test('the form takes optional start and finish times, shown to the reviewer', async () => {
  const clean = await submitted(BEN, { startedAt: '22:30', finishedAt: '01:15' });
  await as(MANAGER);
  const seen = (await rpc('workspace_operations_read', [leith])).find(w => w.workId === clean.workId);
  assert.deepEqual([seen.data.startedAt, seen.data.finishedAt], ['22:30', '01:15'], 'overnight is fine');
  const plain = await submitted(BEN);
  assert.equal((await rpc('workspace_operations_read', [leith])).find(w => w.workId === plain.workId).data.startedAt, null);
  for (const [form, pattern] of [[{ startedAt: '9:00' }, /start time as HH:MM/], [{ finishedAt: '25:00' }, /finish time as HH:MM/], [{ startedAt: '10:00', finishedAt: '10:00' }, /after the start time/],
    [{ startedAt: '08:00', finishedAt: '21:00' }, /at most 12 hours/], [{ startedAt: 1000 }, /start time as HH:MM/]]) {
    await assert.rejects(submitted(BEN, form), pattern, JSON.stringify(form));
  }
});

test('accepting needs no guest feedback; rejecting needs it and a redo time, and tells the cleaner to redo it by then', async () => {
  const good = await submitted(BEN);
  await as(MANAGER);
  const accepted = await operation({ action: 'updateOperation', workId: good.workId, version: good.version, step: 'reviewCleaning', data: { accepted: true, reviewNote: 'All checks fine' } });
  assert.equal(accepted.status, 'completed');
  assert.equal((await owner('select guest_feedback from private.workspace_cleaning_reviews where work_id=$1', [good.workId]))[0].guest_feedback, '');
  assert.ok((await notices(BEN)).some(n => n.event_type === 'cleaning.accepted' && n.work_id === good.workId));

  const bad = await submitted(BEN);
  await as(MANAGER);
  const reject = data => operation({ action: 'updateOperation', workId: bad.workId, version: bad.version, step: 'reviewCleaning', data: { accepted: false, reviewNote: 'Kitchen floor not mopped', ...data } });
  await assert.rejects(reject({ redoBy: new Date(Date.now() + 3600000).toISOString() }), /guestFeedback/, 'guest feedback to reject');
  await assert.rejects(reject({ guestFeedback: 'Guest saw crumbs' }), /redone by/, 'a redo time to reject');
  await assert.rejects(reject({ guestFeedback: 'Guest saw crumbs', redoBy: '2026-10-15 18:00' }), /redone by/, 'with its time zone');
  await assert.rejects(reject({ guestFeedback: 'Guest saw crumbs', redoBy: new Date(Date.now() - 60000).toISOString() }), /next seven days/);
  await assert.rejects(reject({ guestFeedback: 'Guest saw crumbs', redoBy: new Date(Date.now() + 8 * 86400000).toISOString() }), /next seven days/);
  await assert.rejects(operation({ action: 'updateOperation', workId: bad.workId, version: bad.version, step: 'reviewCleaning', data: { accepted: true, reviewNote: 'All fine here', redoBy: new Date(Date.now() + 3600000).toISOString() } }), /only for a clean that is not accepted/);
  const redoAt = new Date(Date.now() + 2 * 3600000);
  redoAt.setUTCSeconds(0, 0);
  const done = await reject({ guestFeedback: 'Guest saw crumbs', redoBy: redoAt.toISOString() });
  assert.equal(done.data.redoBy, redoAt.toISOString().replace('.000Z', 'Z'));
  const redo = (await notices(BEN)).filter(n => n.event_type === 'cleaning.redo');
  assert.equal(redo.length, 1);
  const [{ expected }] = await owner(`select 'Please redo: 12 Leith St by '||case when ($1::timestamptz at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date
    then to_char($1::timestamptz at time zone 'Europe/London','HH24:MI') else to_char($1::timestamptz at time zone 'Europe/London','Dy FMDD Mon HH24:MI') end||' — Kitchen floor not mopped' expected`, [redoAt.toISOString()]);
  assert.equal(redo[0].preview, expected);
  assert.equal(redo[0].work_id, bad.workId);
  assert.ok(!(await notices(BEN)).some(n => n.event_type === 'cleaning.rejected' && n.work_id === bad.workId), 'the redo notice replaces the rejection notice');
  assert.equal((await owner("select count(*)::int n from public.workspace_activity where work_id=$1 and event_type='cleaning.rejected'", [bad.workId]))[0].n, 1, 'the rejection is still recorded');
  // The cleaner sees the deadline on the clean; the reviewer stays independent of the cleaner.
  await as(BEN);
  assert.equal((await rpc('workspace_operations_read', [leith])).find(w => w.workId === bad.workId).data.redoBy, done.data.redoBy);
});

test('the morning notice: once per cleaner per day, from 07:00 London (BST and GMT), catching up until 11:00', async () => {
  await as(MANAGER);
  const make = async (prop, dueOn, cleaner) => { const c = await operation({ action: 'createOperation', propertyId: prop, kind: 'cleaning', data: { dueOn, checklist: ['Kitchen'] } }); await rpc('workspace_assign_work', [c.workId, c.version, users[cleaner]]); return c; };
  // Winter (GMT): two cleans for Angela, next guests at 110 Hawk at 15:00 that day.
  await make(hawk, '2027-01-12', ANGELA); await make(leith, '2027-01-12', ANGELA);
  // Summer (BST): one clean for Ben.
  await make(leith, '2027-07-13', BEN);
  await sync([stay('W1', '2027-01-12', '2027-01-14', { checkInTime: 15 })]);
  const run = at => owner('select private.workspace_clean_morning_notices($1::timestamptz) r', [at]).then(r => r[0].r.sent);
  const morning = async who => (await notices(who)).filter(n => n.event_type === 'cleaning.morning');

  assert.equal(await run('2027-01-12T06:59:00Z'), 0, '06:59 GMT is too early');
  assert.equal(await run('2027-01-12T07:00:00Z'), 1, '07:00 GMT');
  assert.equal(await run('2027-01-12T07:15:00Z'), 0, 'once a day');
  assert.equal(await run('2027-01-12T09:45:00Z'), 0);
  const angela = await morning(ANGELA);
  assert.equal(angela.length, 1);
  assert.equal(angela[0].preview, 'Good morning — 2 cleans today: 110 Hawk (next guests 15:00), 12 Leith St (no guests today)');
  assert.equal(angela[0].work_id, null);
  assert.equal((await morning(BEN)).length, 0, 'only cleaners with a clean that day');

  assert.equal(await run('2027-07-13T05:59:00Z'), 0, '06:59 BST is too early');
  assert.equal(await run('2027-07-13T10:00:00Z'), 0, '11:00 BST is too late, even if the morning was missed');
  assert.equal(await run('2027-07-13T09:30:00Z'), 1, '10:30 BST catches up');
  assert.equal(await run('2027-07-13T09:45:00Z'), 0);
  assert.deepEqual((await morning(BEN)).map(n => n.preview), ['Good morning — 1 clean today: 12 Leith St (no guests today)']);
  assert.deepEqual((await owner("select on_day::text d from private.workspace_clean_morning_sent where cleaner_id=$1", [users[BEN]])).map(r => r.d), ['2027-07-13']);

  // Only the backend may run it.
  await as(ANGELA);
  await assert.rejects(rpc('workspace_clean_morning_notices'), /permission denied/);
  await as('backend');
  assert.equal((await rpc('workspace_clean_morning_notices')).sent >= 0, true);
});

test('pay rates: admins and Accounts set them, every change is in the history, cleaning managers cannot', async () => {
  const set = (rateMinor, version) => teams({ action: 'setCleanerRate', cleanerId: users[ANGELA], rateMinor, version });
  for (const who of [MANAGER, STAYS, ANGELA]) { await as(who); await assert.rejects(set(2500, 0), /Only admins and Accounts can set/, roles[who]); }
  await as(ADMIN);
  await assert.rejects(teams({ action: 'setCleanerRate', cleanerId: users[STAYS], rateMinor: 2500, version: 0 }), /Only cleaners have a rate/);
  assert.equal((await set(2500, 0)).version, 1);
  await as(ACCOUNTS);
  assert.equal((await set(2700, 1)).version, 2);
  const history = await owner('select old_rate_minor,new_rate_minor,changed_by,changed_at is not null at from private.workspace_cleaner_rate_history where cleaner_id=$1 order by id', [users[ANGELA]]);
  assert.deepEqual(history, [{ old_rate_minor: null, new_rate_minor: 2500, changed_by: users[ADMIN], at: true }, { old_rate_minor: 2500, new_rate_minor: 2700, changed_by: users[ACCOUNTS], at: true }]);
  await as(MANAGER);
  assert.equal((await rpc('workspace_teams_read', ['cleanerRates'])).find(r => r.cleanerId === users[ANGELA]).rateMinor, 2700, 'managers still see their cleaners\' rates');
  await as(ANGELA);
  await assert.rejects(db.query('select * from private.workspace_cleaner_rate_history'), /permission denied/);
});

test('new cleaners get the cleaning tools without Clean invoices', async () => {
  assert.deepEqual((await owner("select private.workspace_role_tools('cleans') t"))[0].t, ['cleaning-schedule', 'cleaner-performance']);
  assert.ok((await owner("select private.workspace_role_tools('accounts') t"))[0].t.includes('cleans-invoices'), 'Accounts keep it');
});

test('nothing in the migration drops or deletes', async () => {
  const text = await fs.readFile('supabase/migrations/20261021500000_cleaner_flow.sql', 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
});
