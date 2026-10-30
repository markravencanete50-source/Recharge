import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Clean forms (client answer 8): an assigned clean with no form after 18:00 UK time on its day is marked unsubmitted
// and its cleaner is reminded; from 09:00 the next day it is tagged, flagged for management and logged. Nothing here
// changes pay or blocks the cleaner, who can still send the form late; a flag a person already raised is never
// doubled; owners see none of it. A cleaner invoice cannot be approved until every clean on it has its form.
const NAME = '20261014100000_clean_form_reminders';
const DIR = 'supabase/migrations/';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile(DIR + file, 'utf8'));
// While the migration is a draft, it is applied after everything else (rule R1).
const own = files.includes(NAME + '.sql') ? NAME + '.sql' : NAME + '.sql.draft';
const migration = await fs.readFile(DIR + own, 'utf8');
if (!files.includes(NAME + '.sql')) await db.exec(migration);

const roles = ['super_admin', 'admin', 'cleaning_manager', 'stays', 'cleans', 'cleans', 'client'];
const names = ['Alex Admin', 'Mia Manager', 'Carl Cleaning', 'Sam Stays', 'Cara Cleaner', 'Cleo Cleaner', 'Owen Owner'];
const [SUPER, ADMIN, MANAGER, STAYS, CLEANER, OTHER_CLEANER, CLIENT] = roles.map((_, i) => i);
const users = roles.map((_, i) => `98100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9810', '9820');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `cleanform${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i === 'service' || i === 'anon' ? {} : { sub: users[i], session_id: session(i) })]);
  await db.exec(i === 'service' ? 'set role service_role' : i === 'anon' ? 'set role anon' : 'set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(async () => { await db.close(); });
const owner = async (text, args = []) => { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const teams = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const payables = input => rpc('workspace_payables_action', [{ requestId: crypto.randomUUID(), ...input }]);
const sweep = async at => { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claims','',false)"); return (await db.query('select private.workspace_clean_form_sweep($1::timestamptz) result', [at])).rows[0].result; };
const none = { reminded: 0, warned: 0, skipped: 0 };
const item = async workId => (await owner(`select w.status,w.version,w.assignee_id,w.due_on::text due_on,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1`, [workId]))[0];
const flagsFor = workId => owner('select * from private.workspace_management_flags where work_id=$1 order by created_at,id', [workId]);
const events = async (workId, type = 'cleaning.form_missing') => (await owner('select event_type,actor_id,property_id from public.workspace_activity where work_id=$1 and event_type=$2', [workId, type]));
const notified = async (i, workId, type = 'cleaning.form_missing') => (await owner(`select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  where o.user_id=$1 and a.event_type=$3 and a.work_id=$2`, [users[i], workId, type]))[0].n;
const definition = async fn => (await owner('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d;

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Form flat', address: '9 Form Street, Leith', region: 'Edinburgh', bedrooms: 2 }]);
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [CLEANER, 'cleaner'], [OTHER_CLEANER, 'cleaner'], [CLIENT, 'client']]) await rpc('workspace_assign_property', [property, users[user], kind]);

// A clean on a day, with a cleaner unless told otherwise.
async function clean(dueOn, cleaner = CLEANER) {
  await as(MANAGER);
  const made = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn, checklist: ['Kitchen', 'Bathroom'] } });
  if (cleaner === null) return made;
  await rpc('workspace_assign_work', [made.workId, made.version, users[cleaner]]);
  return made;
}
// The cleaner submits the form: a verified photo, then submitCleaning.
async function submit(workId, cleaner = CLEANER) {
  await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now())", [property, workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()]);
  const [{ id: photo }] = await owner("select id from private.workspace_media_evidence where work_id=$1 and owner_id=$2 order by created_at desc limit 1", [workId, users[cleaner]]);
  await as(cleaner);
  const work = (await rpc('workspace_operations_read', [property])).find(w => w.workId === workId);
  return operation({ action: 'updateOperation', workId, version: work.version, step: 'submitCleaning', data: { checks: ['Kitchen', 'Bathroom'], report: 'Kitchen and bathroom cleaned', photoIds: [photo], mailAction: 'none' } });
}

let timed;
test('after 18:00 on its day the cleaner is reminded and the clean is unsubmitted; management hears at 09:00 the next day', async () => {
  timed = await clean('2026-11-03');
  const before = await item(timed.workId);
  assert.equal(before.data.phase, 'assigned'); assert.equal(before.data.warning, undefined);
  assert.deepEqual(await sweep('2026-11-03T08:00:00Z'), none, 'morning of the day');
  assert.deepEqual(await sweep('2026-11-03T17:59:00Z'), none, 'one minute before the due time');
  assert.deepEqual(await sweep('2026-11-03T18:00:00Z'), none, 'exactly on the due time is not yet after it');
  assert.deepEqual(await sweep('2026-11-03T18:01:00Z'), { reminded: 1, warned: 0, skipped: 0 });
  const reminded = await item(timed.workId);
  assert.equal(reminded.data.unsubmittedAt, '2026-11-03T18:01:00.000Z'); assert.equal(reminded.data.warning, undefined); assert.equal(reminded.data.formWarningAt, undefined);
  assert.equal(reminded.data.phase, 'assigned'); assert.deepEqual(reminded.data.checklist, before.data.checklist, 'the rest of the clean is untouched');
  assert.equal(reminded.status, before.status); assert.equal(reminded.assignee_id, before.assignee_id);
  assert.equal(reminded.version, before.version + 1, 'the version is bumped like other system updates');
  const logged = await events(timed.workId, 'cleaning.form_reminder');
  assert.equal(logged.length, 1); assert.equal(logged[0].actor_id, null); assert.equal(logged[0].property_id, property);
  assert.equal(await notified(CLEANER, timed.workId, 'cleaning.form_reminder'), 1, 'the cleaner is reminded');
  for (const other of [SUPER, ADMIN, MANAGER, STAYS, OTHER_CLEANER, CLIENT]) assert.equal(await notified(other, timed.workId, 'cleaning.form_reminder'), 0, names[other]);
  assert.equal((await flagsFor(timed.workId)).length, 0, 'management is not told on the day');
  assert.deepEqual(await sweep('2026-11-03T22:00:00Z'), none, 'one reminder per clean');
  assert.deepEqual(await sweep('2026-11-04T08:59:00Z'), none, 'not before 09:00 the next day');
  assert.deepEqual(await sweep('2026-11-04T09:00:00Z'), { reminded: 0, warned: 1, skipped: 0 });
  const warned = await item(timed.workId);
  assert.equal(warned.data.warning, 'no_form'); assert.equal(warned.data.formWarningAt, '2026-11-04T09:00:00.000Z');
  assert.equal(warned.data.unsubmittedAt, '2026-11-03T18:01:00.000Z', 'the reminder time is kept');
  assert.equal(warned.version, before.version + 2);
  assert.equal((await events(timed.workId)).length, 1);
  // The clean still shows in the operations read for its cleaner, with the tag, and can still be submitted late.
  await as(CLEANER);
  const seen = (await rpc('workspace_operations_read', [property])).find(w => w.workId === timed.workId);
  assert.equal(seen.data.warning, 'no_form'); assert.equal(seen.data.unsubmittedAt, '2026-11-03T18:01:00.000Z');
  assert.equal(seen.updatedEvent, 'cleaning.form_missing'); assert.equal(seen.updatedBy, null);
});

test('the times follow UK clocks: 18:00 and 09:00 BST are 17:00 and 08:00 UTC', async () => {
  const summer = await clean('2026-07-10');
  assert.deepEqual(await sweep('2026-07-10T16:59:00Z'), none, '17:59 in London');
  assert.deepEqual(await sweep('2026-07-10T17:01:00Z'), { reminded: 1, warned: 0, skipped: 0 }, '18:01 in London, though still before 18:00 UTC');
  assert.deepEqual(await sweep('2026-07-11T07:59:00Z'), none, '08:59 in London');
  assert.deepEqual(await sweep('2026-07-11T08:00:00Z'), { reminded: 0, warned: 1, skipped: 0 }, '09:00 in London');
  assert.equal((await item(summer.workId)).data.warning, 'no_form');
});

test('a clean the sweep missed on its evening is reminded overnight, or warned straight away once the morning has come', async () => {
  const yesterday = await clean('2026-11-10');
  assert.deepEqual(await sweep('2026-11-10T12:00:00Z'), none);
  assert.deepEqual(await sweep('2026-11-11T00:05:00Z'), { reminded: 1, warned: 0, skipped: 0 });
  assert.deepEqual(await sweep('2026-11-11T09:30:00Z'), { reminded: 0, warned: 1, skipped: 0 });
  assert.equal((await item(yesterday.workId)).data.formWarningAt, '2026-11-11T09:30:00.000Z');
  // A clean in the future is never touched, and neither is one from before the look-back window.
  const future = await clean('2026-11-20');
  const old = await clean('2026-03-02');
  assert.deepEqual(await sweep('2026-11-11T10:00:00Z'), none);
  assert.equal((await item(future.workId)).data.unsubmittedAt, undefined); assert.equal((await item(old.workId)).data.unsubmittedAt, undefined);
  // Fourteen days on it is still inside the window; it was never reminded, so it is warned and marked unsubmitted at once.
  assert.deepEqual(await sweep('2026-03-16T09:00:00Z'), { reminded: 0, warned: 1, skipped: 0 });
  const row = await item(old.workId);
  assert.equal(row.data.warning, 'no_form'); assert.equal(row.data.unsubmittedAt, '2026-03-16T09:00:00.000Z');
  assert.equal((await events(old.workId, 'cleaning.form_reminder')).length, 0);
  assert.equal(await notified(CLEANER, old.workId), 1, 'the cleaner hears about the missing form');
});

test('a form sent after the reminder and before the next morning never reaches management', async () => {
  const quick = await clean('2026-11-24');
  // (The future clean from the test above is past its own next morning by now, so only the reminder count is checked.)
  assert.equal((await sweep('2026-11-24T18:30:00Z')).reminded, 1);
  assert.ok((await item(quick.workId)).data.unsubmittedAt);
  await submit(quick.workId);
  assert.deepEqual(await sweep('2026-11-25T09:00:00Z'), none);
  const row = await item(quick.workId);
  assert.equal(row.data.phase, 'review'); assert.equal(row.data.warning, undefined); assert.ok(row.data.unsubmittedAt, 'the reminder stays as history');
  assert.equal((await flagsFor(quick.workId)).length, 0);
});

test('only an assigned, open clean without a form is reminded or warned', async () => {
  const at = '2026-12-05T10:00:00Z', day = '2026-12-04';
  const unassigned = await clean(day, null);
  const completed = await clean(day), cancelled = await clean(day), declined = await clean(day);
  for (const [made, status] of [[completed, 'completed'], [cancelled, 'cancelled'], [declined, 'declined']]) {
    // The status guard wants the clean's own workStatus to agree.
    await owner("update private.workspace_domain_details set data=data||jsonb_build_object('workStatus',$2::text) where work_id=$1", [made.workId, status]);
    await owner('update public.workspace_work_items set status=$2 where id=$1', [made.workId, status]);
  }
  const submitted = await clean(day, OTHER_CLEANER);
  await submit(submitted.workId, OTHER_CLEANER);
  assert.equal((await item(submitted.workId)).status, 'in_review');
  // A clean sent back after a review keeps the cleaner's earlier submission, so it is not warned either.
  const returned = await clean(day);
  await owner(`update private.workspace_domain_details set data=data||jsonb_build_object('submittedBy',$2::text,'reviewedBy',$3::text,'phase','assigned') where work_id=$1`, [returned.workId, users[CLEANER], users[MANAGER]]);
  // Any other phase is not "waiting for the form" either.
  const accepted = await clean(day);
  await owner(`update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted') where work_id=$1`, [accepted.workId]);
  const eligible = await clean(day, OTHER_CLEANER);
  assert.deepEqual(await sweep(at), { reminded: 0, warned: 1, skipped: 0 });
  for (const made of [unassigned, completed, cancelled, declined, submitted, returned, accepted]) {
    const row = await item(made.workId);
    assert.equal(row.data.warning, undefined, JSON.stringify(row.data)); assert.equal(row.data.unsubmittedAt, undefined);
    assert.equal((await events(made.workId)).length, 0); assert.equal((await flagsFor(made.workId)).length, 0);
  }
  assert.equal((await item(eligible.workId)).data.warning, 'no_form');
  // Assigning the unassigned clean makes it eligible from then on.
  await as(MANAGER);
  const fresh = (await rpc('workspace_operations_read', [property])).find(w => w.workId === unassigned.workId);
  await rpc('workspace_assign_work', [unassigned.workId, fresh.version, users[CLEANER]]);
  assert.deepEqual(await sweep(at), { reminded: 0, warned: 1, skipped: 0 });
  assert.equal((await item(unassigned.workId)).data.warning, 'no_form');
});

test('a second run does nothing, and every warned clean has exactly one open flag linked to it', async () => {
  const stamp = async () => (await owner(`select (select count(*)::int from public.workspace_activity where event_type in ('cleaning.form_missing','cleaning.form_reminder')) events,
   (select count(*)::int from private.workspace_management_flags where source='clean_form') flags,
   (select coalesce(sum(w.version),0)::int from public.workspace_work_items w) versions,
   (select count(*)::int from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type in ('cleaning.form_missing','cleaning.form_reminder')) notices`))[0];
  const before = await stamp();
  assert.deepEqual(await sweep('2026-12-05T10:00:00Z'), none);
  assert.deepEqual(await sweep('2026-12-20T10:00:00Z'), none);
  assert.deepEqual(await stamp(), before);
  const warned = await owner("select d.work_id from private.workspace_domain_details d where d.data->>'warning'='no_form'");
  assert.ok(warned.length >= 5);
  assert.equal((await owner("select count(*)::int n from public.workspace_activity where event_type='cleaning.form_missing'"))[0].n, before.flags, 'one flag per warned clean, none doubled');
  for (const { work_id } of warned) {
    const flags = await flagsFor(work_id);
    assert.equal(flags.length, 1, work_id); assert.equal(flags[0].status, 'open');
    assert.equal(flags[0].source, 'clean_form'); assert.equal(flags[0].work_id, work_id); assert.equal(flags[0].hub_item_id, null);
    assert.equal(flags[0].property_id, property); assert.equal(flags[0].raised_by, null); assert.equal(flags[0].title, 'Cleaning form missing');
    assert.equal(await notified(SUPER, work_id), 1); assert.equal(await notified(ADMIN, work_id), 1);
    const cleaner = users.indexOf((await item(work_id)).assignee_id);
    assert.equal(await notified(cleaner, work_id), 1, 'the cleaner is told too');
    for (const other of [MANAGER, STAYS, CLEANER, OTHER_CLEANER, CLIENT].filter(o => o !== cleaner)) assert.equal(await notified(other, work_id), 0, names[other]);
  }
  const [flag] = await flagsFor(timed.workId);
  assert.match(flag.reason, /Form flat \(9 Form Street, Leith\)/); assert.match(flag.reason, /3 November 2026/); assert.match(flag.reason, /reminded at 18:00/);
  assert.match(flag.reason, /can still send it late/); assert.match(flag.reason, /invoice for this clean cannot be approved/);
  assert.equal((await owner('select private.workspace_flag_open_for_work($1) open', [timed.workId]))[0].open, true);
  // Management sees these flags in the flags list; nobody else on the team does, because nobody raised them.
  await as(ADMIN);
  const list = (await rpc('workspace_teams_read', ['flags', null, null, null, null])).flags.filter(f => f.source === 'clean_form');
  assert.equal(list.length, before.flags); assert.ok(list.every(f => f.raisedBy === null && f.raisedByName === null && f.status === 'open' && f.workId && f.propertyAddress === '9 Form Street, Leith'));
  for (const viewer of [STAYS, MANAGER, CLEANER]) { await as(viewer); assert.equal((await rpc('workspace_teams_read', ['flags', null, null, null, null])).flags.filter(f => f.source === 'clean_form').length, 0, names[viewer]); }
});

test('a flag a person already raised on the clean is not doubled', async () => {
  const manual = await clean('2026-12-08');
  await as(STAYS);
  const mine = await teams({ action: 'flagForManagement', source: 'work', workId: manual.workId, title: 'Cleaner not answering', reason: 'I cannot reach the cleaner for this one' });
  assert.deepEqual(await sweep('2026-12-09T09:00:00Z'), { reminded: 0, warned: 1, skipped: 1 });
  const row = await item(manual.workId);
  assert.equal(row.data.warning, 'no_form', 'the clean is still tagged and logged');
  assert.equal((await events(manual.workId)).length, 1);
  const flags = await flagsFor(manual.workId);
  assert.equal(flags.length, 1); assert.equal(flags[0].id, mine.id); assert.equal(flags[0].source, 'work'); assert.equal(flags[0].raised_by, users[STAYS]);
  assert.equal(await notified(ADMIN, manual.workId), 0, 'management already heard about it from the person who flagged it');
  assert.equal(await notified(CLEANER, manual.workId), 1, 'the cleaner is still told');
  assert.deepEqual(await sweep('2026-12-09T09:00:00Z'), none);
});

test('a form sent late keeps the warning as history and leaves the flag for management', async () => {
  const late = await clean('2026-12-12');
  assert.deepEqual(await sweep('2026-12-13T09:00:00Z'), { reminded: 0, warned: 1, skipped: 0 });
  await submit(late.workId);
  const row = await item(late.workId);
  assert.equal(row.status, 'in_review'); assert.equal(row.data.phase, 'review'); assert.equal(row.data.warning, 'no_form'); assert.ok(row.data.formWarningAt);
  const [flag] = await flagsFor(late.workId);
  assert.equal(flag.status, 'open', 'nothing resolves the flag automatically');
  assert.deepEqual(await sweep('2026-12-14T09:00:00Z'), none);
  // Management decides; the closed flag is not raised again for a clean that was already warned.
  await as(ADMIN);
  await teams({ action: 'decideFlag', flagId: flag.id, version: flag.version, decision: 'resolved', note: 'Late but fine' });
  assert.deepEqual(await sweep('2026-12-15T09:00:00Z'), none);
  assert.equal((await flagsFor(late.workId)).length, 1);
  assert.equal((await events(late.workId)).length, 1);
});

test('a cleaner invoice cannot be approved until every clean on it has its form, and each line says whether it has', async () => {
  const day = (await owner("select (current_date-3)::text d"))[0].d;
  const withForm = await clean(day), withoutForm = await clean(day);
  await submit(withForm.workId);
  await as(SUPER);
  const recorded = await payables({ action: 'recordCleanerInvoice', supplier: 'Cara Cleans', cleanerId: users[CLEANER], reference: 'CF-1', invoiceDate: day, totalMinor: 11000,
    lines: [{ workId: withForm.workId, amountMinor: 5500 }, { workId: withoutForm.workId, amountMinor: 5500 }] });
  assert.equal(recorded.status, 'to_approve', 'an invoice can still be recorded before every form is in');
  const formIn = Object.fromEntries(recorded.lines.map(l => [l.workId, l.formIn]));
  assert.deepEqual(formIn, { [withForm.workId]: true, [withoutForm.workId]: false });
  await assert.rejects(payables({ action: 'decideCleanerInvoice', invoiceId: recorded.id, version: recorded.version, decision: 'approve' }), /needs its clean form before the invoice can be approved/);
  assert.equal((await owner('select status from private.workspace_cleaner_invoices where id=$1', [recorded.id]))[0].status, 'to_approve');
  // Rejecting is still allowed, so a wrong invoice never gets stuck.
  const third = await clean(day);
  await as(SUPER);
  const second = await payables({ action: 'recordCleanerInvoice', supplier: 'Cara Cleans', cleanerId: users[CLEANER], reference: 'CF-2', invoiceDate: day, totalMinor: 5000, lines: [{ workId: third.workId, amountMinor: 5000 }] });
  assert.equal((await payables({ action: 'decideCleanerInvoice', invoiceId: second.id, decision: 'reject', note: 'Wrong amount' })).status, 'rejected');
  // Once the form is in, the invoice is approved as before.
  await submit(withoutForm.workId);
  await as(SUPER);
  const approved = await payables({ action: 'decideCleanerInvoice', invoiceId: recorded.id, decision: 'approve' });
  assert.equal(approved.status, 'approved'); assert.ok(approved.lines.every(l => l.formIn === true));
});

test('at most 200 cleans are warned per run, oldest day first, and the rest on the next run', async () => {
  await owner(`with w as (insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,assignee_id,due_on)
    select gen_random_uuid(),$1,'cleaning-schedule','Bulk clean '||g,$2,$3,case when g<=3 then date '2026-12-27' else date '2026-12-28' end from generate_series(1,205) g returning id)
   insert into private.workspace_domain_details(work_id,kind,data) select id,'cleaning',jsonb_build_object('checklist',jsonb_build_array('Kitchen'),'phase','assigned','workStatus','waiting') from w`,
  [property, users[SUPER], users[CLEANER]]);
  const open = async () => (await owner("select count(*)::int n from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.title like 'Bulk clean %' and d.data->>'warning'='no_form'"))[0].n;
  assert.deepEqual(await sweep('2026-12-29T09:00:00Z'), { reminded: 0, warned: 200, skipped: 0 });
  assert.equal(await open(), 200);
  assert.equal((await owner("select count(*)::int n from private.workspace_management_flags f join public.workspace_work_items w on w.id=f.work_id where w.title like 'Bulk clean %' and f.status='open'"))[0].n, 200);
  assert.equal((await owner("select count(*)::int n from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.title like 'Bulk clean %' and w.due_on=date '2026-12-27' and d.data->>'warning'='no_form'"))[0].n, 3, 'the oldest day goes first');
  assert.deepEqual(await sweep('2026-12-29T09:00:00Z'), { reminded: 0, warned: 5, skipped: 0 });
  assert.equal(await open(), 205);
  assert.deepEqual(await sweep('2026-12-29T09:00:00Z'), none);
});

test('a clean with no due date takes its day from its data, and a bad date is skipped without stopping the run', async () => {
  const dated = await clean('2026-12-30'), broken = await clean('2026-12-30');
  await owner('update public.workspace_work_items set due_on=null where id=any($1::uuid[])', [[dated.workId, broken.workId]]);
  await owner(`update private.workspace_domain_details set data=data||jsonb_build_object('dueOn','2026-13-45') where work_id=$1`, [broken.workId]);
  assert.deepEqual(await sweep('2026-12-31T09:00:00Z'), { reminded: 0, warned: 1, skipped: 0 });
  assert.equal((await item(dated.workId)).data.warning, 'no_form'); assert.equal((await item(broken.workId)).data.warning, undefined);
});

test('the backend entry is for the service role only, and owners and staff are refused everything', async () => {
  // Two days ago, so the run is past the next-morning escalation whatever the time of day.
  const day = (await owner("select (current_date-2)::text d"))[0].d;
  const recent = await clean(day);
  for (const who of ['anon', MANAGER, ADMIN, SUPER, STAYS, CLEANER, CLIENT]) {
    await as(who);
    await assert.rejects(db.query('select public.workspace_clean_form_sweep()'), /permission denied/, String(who));
    await assert.rejects(db.query('select private.workspace_clean_form_sweep(now())'), /permission denied/, String(who));
    await assert.rejects(db.query('select private.workspace_clean_form_due_time()'), /permission denied/, String(who));
    await assert.rejects(db.query('select private.workspace_clean_form_escalate_time()'), /permission denied/, String(who));
    await assert.rejects(db.query("select private.workspace_clean_form_in('{}'::jsonb)"), /permission denied/, String(who));
  }
  assert.equal((await item(recent.workId)).data.warning, undefined, 'refused callers changed nothing');
  await as('service');
  const result = (await db.query('select public.workspace_clean_form_sweep() result')).rows[0].result;
  assert.deepEqual(Object.keys(result).sort(), ['reminded', 'skipped', 'warned']);
  assert.ok(result.warned >= 1 && Number.isInteger(result.skipped) && Number.isInteger(result.reminded));
  assert.equal((await item(recent.workId)).data.warning, 'no_form');
  assert.match((await item(recent.workId)).data.formWarningAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('the owner never sees a clean, its reminder, its warning or its flag', async () => {
  const warned = await owner("select d.work_id from private.workspace_domain_details d where d.data->>'warning'='no_form' limit 1");
  assert.equal(warned.length, 1);
  // Even a clean the owner was allowed to see would not show these events.
  await owner('update public.workspace_work_items set client_visible=true where id=$1', [timed.workId]);
  await as(CLIENT);
  const seen = await rpc('workspace_operations_read', [property]);
  assert.equal(JSON.stringify(seen).includes('no_form'), false); assert.equal(JSON.stringify(seen).includes('formWarningAt'), false);
  assert.equal(JSON.stringify(seen).includes('unsubmittedAt'), false);
  assert.equal((await db.query("select count(*)::int n from public.workspace_activity where event_type in ('cleaning.form_missing','cleaning.form_reminder')")).rows[0].n, 0);
  await assert.rejects(rpc('workspace_teams_read', ['flags', null, null, null, null]), /Team access/);
  await assert.rejects(db.query('select count(*) from private.workspace_management_flags'), /permission denied/);
  await owner('update public.workspace_work_items set client_visible=false where id=$1', [timed.workId]);
  // Staff on the clean still read both events.
  await as(CLEANER);
  assert.ok((await db.query("select count(*)::int n from public.workspace_activity where work_id=$1 and event_type in ('cleaning.form_missing','cleaning.form_reminder')", [timed.workId])).rows[0].n >= 2);
});

test('the assumptions are single immutable functions and the sweep has no trigger', async () => {
  const one = async sql => (await owner(sql))[0].v;
  assert.equal(await one('select private.workspace_clean_form_due_time() v'), '18:00');
  assert.equal(await one('select private.workspace_clean_form_escalate_time() v'), '09:00');
  assert.equal(await one('select private.workspace_clean_form_zone() v'), 'Europe/London');
  assert.equal(await one('select private.workspace_clean_form_sweep_limit() v'), 200);
  assert.equal(await one('select private.workspace_clean_form_lookback_days() v'), 14);
  for (const fn of ['due_time()', 'escalate_time()', 'zone()', 'sweep_limit()', 'lookback_days()', 'in(jsonb)'])
    assert.equal(await one(`select provolatile v from pg_proc where oid='private.workspace_clean_form_${fn}'::regprocedure`), 'i', fn);
  for (const fn of ['private.workspace_clean_form_sweep(timestamptz)', 'public.workspace_clean_form_sweep()']) {
    const [row] = await owner(`select p.prosecdef definer,p.proconfig config,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,
      has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid=$1::regprocedure`, [fn]);
    assert.equal(row.anon, false); assert.equal(row.authenticated, false); assert.equal(row.service, true);
    assert.equal(row.definer, fn.startsWith('private.')); assert.ok(row.config.includes('search_path=""'));
  }
  assert.equal(await one(`select count(*)::int v from pg_trigger t where not t.tgisinternal and t.tgfoid in (select oid from pg_proc where proname like 'workspace_clean_form%')`), 0);
  // Over a period around the DST changes the day boundary is read in UK time, not UTC.
  assert.equal(await one(`select private.workspace_clean_form_is_due(date '2026-03-29','2026-03-29T16:59:00Z'::timestamptz) v`), false, '17:59 BST');
  assert.equal(await one(`select private.workspace_clean_form_is_due(date '2026-03-29','2026-03-29T17:01:00Z'::timestamptz) v`), true, '18:01 BST');
  assert.equal(await one(`select private.workspace_clean_form_is_due(date '2026-10-25','2026-10-25T17:59:00Z'::timestamptz) v`), false, '17:59 GMT');
  assert.equal(await one(`select private.workspace_clean_form_is_due(date '2026-10-25','2026-10-25T18:01:00Z'::timestamptz) v`), true, '18:01 GMT');
  assert.equal(await one(`select private.workspace_clean_form_is_due(date '2026-10-24','2026-10-25T00:30:00+01:00'::timestamptz) v`), true, 'the next day, any time');
  assert.equal(await one(`select private.workspace_clean_form_is_due(null,now()) v`), false);
  assert.equal(await one(`select private.workspace_clean_form_escalate_due(date '2026-03-28','2026-03-29T07:59:00Z'::timestamptz) v`), false, '08:59 BST the next day');
  assert.equal(await one(`select private.workspace_clean_form_escalate_due(date '2026-03-28','2026-03-29T08:00:00Z'::timestamptz) v`), true, '09:00 BST the next day');
  assert.equal(await one(`select private.workspace_clean_form_escalate_due(date '2026-10-24','2026-10-25T08:59:00Z'::timestamptz) v`), false, '08:59 GMT the next day');
  assert.equal(await one(`select private.workspace_clean_form_escalate_due(date '2026-10-24','2026-10-25T09:00:00Z'::timestamptz) v`), true, '09:00 GMT the next day');
  assert.equal(await one(`select private.workspace_clean_form_escalate_due(null,now()) v`), false);
  assert.equal(await one(`select private.workspace_clean_form_in('{"phase":"review"}'::jsonb) v`), true);
  assert.equal(await one(`select private.workspace_clean_form_in('{"phase":"accepted"}'::jsonb) v`), true);
  assert.equal(await one(`select private.workspace_clean_form_in('{"phase":"assigned","submittedBy":"x"}'::jsonb) v`), true);
  assert.equal(await one(`select private.workspace_clean_form_in('{"phase":"assigned"}'::jsonb) v`), false);
  assert.equal(await one(`select private.workspace_clean_form_in('{}'::jsonb) v`), false);
});

test('the migration runs twice without changing a definition or a row', async () => {
  const fns = ['private.workspace_clean_form_sweep(timestamptz)', 'public.workspace_clean_form_sweep()', 'private.workspace_clean_form_is_due(date,timestamptz)',
    'private.workspace_clean_form_day(date,jsonb)', 'private.workspace_clean_form_due_time()', 'private.workspace_clean_form_zone()',
    'private.workspace_clean_form_sweep_limit()', 'private.workspace_clean_form_lookback_days()', 'private.workspace_clean_form_escalate_time()',
    'private.workspace_clean_form_escalate_due(date,timestamptz)', 'private.workspace_clean_form_in(jsonb)', 'private.workspace_decide_cleaner_invoice(jsonb)',
    'private.workspace_cleaner_invoice_view(private.workspace_cleaner_invoices)'];
  const before = await Promise.all(fns.map(definition));
  const policy = async () => (await owner("select pg_get_expr(polqual,polrelid) q from pg_policy where polname='activity_scoped'"))[0].q;
  const rule = await policy();
  assert.match(rule, /cleaning\\\.form_\(missing\|reminder\)\$/);
  const counts = async () => (await owner(`select (select count(*)::int from private.workspace_management_flags) flags,(select count(*)::int from public.workspace_activity) activity,
    (select count(*)::int from private.workspace_notification_outbox) outbox`))[0];
  const rows = await counts();
  await db.exec('reset role'); await db.exec(migration);
  assert.deepEqual(await Promise.all(fns.map(definition)), before);
  assert.equal(await policy(), rule);
  assert.deepEqual(await counts(), rows);
  // The invoice gate is in once, not twice.
  const decide = await definition('private.workspace_decide_cleaner_invoice(jsonb)');
  assert.equal(decide.split('needs its clean form').length - 1, 1);
  // Privileges survive a second run too.
  const [row] = await owner("select has_function_privilege('authenticated','public.workspace_clean_form_sweep()','execute') a,has_function_privilege('service_role','public.workspace_clean_form_sweep()','execute') s");
  assert.equal(row.a, false); assert.equal(row.s, true);
  // And the management flag functions this depends on are untouched by it.
  assert.equal((await owner("select count(*)::int n from pg_proc where proname='workspace_flag_open_for_work'"))[0].n, 1);
});

test('sending the form stamps submittedAt on the server (20261015120000); the app sends nothing new', async () => {
  const made = await clean('2026-12-10');
  const before = Date.now();
  await submit(made.workId);
  const sent = await item(made.workId);
  assert.equal(typeof sent.data.submittedAt, 'string');
  assert.match(sent.data.submittedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(sent.data.submittedAt) - before) < 120000, 'stamped now');
  assert.equal(sent.data.submittedBy, users[CLEANER]);
  // On time by the stamp: 14:45 London on the clean's day is the line (the plan's late time, 20261031200000; the 18:00
  // reminder is unchanged).
  const onTime = async (at, day) => (await owner('select private.workspace_clean_form_on_time($1::jsonb,$2::date) v', [{ phase: 'review', submittedBy: users[CLEANER], submittedAt: at }, day]))[0].v;
  assert.equal(await onTime('2026-12-10T14:45:00.000Z', '2026-12-10'), true, 'GMT in December: 14:45 exactly is on time');
  assert.equal(await onTime('2026-12-10T14:45:01.000Z', '2026-12-10'), false);
  assert.equal(await onTime('2026-07-10T13:45:00.000Z', '2026-07-10'), true, 'BST in July: 13:45 UTC is 14:45 London');
  assert.equal(await onTime('2026-07-10T13:46:00.000Z', '2026-07-10'), false);
  // The definition keeps the first stamp when a clean is sent again after a review.
  assert.match(await definition('private.workspace_operations_action(jsonb)'), /'submittedAt',coalesce\(d\.data->'submittedAt'/);
});
