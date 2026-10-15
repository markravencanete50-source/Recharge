import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Clean outcomes from the app's own flags (migration 20261022050000), on top of requests for invoice (20261022000000):
// no clean form makes a clean Unsuccessful, a rejection that stands with no redo accepted Unsuccessful, a redo accepted
// after a rejection Partially successful, and a dispute decided in the cleaner's favour Completed again. Applied when the
// request is made and whenever a flag changes while it waits; never over a person's choice; each change re-totals the
// request and is kept in its history with the reason; nothing changes once it is approved. Cleans not done properly (no
// form, or rejected with no redo) are on the request too, Unsuccessful at £0; cleans waiting for review or in a redo
// still underway wait for a later request. A redo accepted or a dispute won after approval goes on the next request as
// a follow-up line, and a clean is never paid twice. The flags come from the real flows: the clean-form sweep and the review.
const MIGRATION = 'supabase/migrations/20261022050000_clean_outcome_flags.sql';
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

const roles = ['super_admin', 'cleaning_manager', 'accounts', 'stays', 'cleans', 'cleans', 'cleans', 'cleans', 'cleans', 'cleans', 'cleans'];
const names = ['Admin', 'Manager', 'Accounts', 'Stays', 'Angela Cleaner', 'Ben Cleaner', 'Cara Cleaner', 'Dan Cleaner', 'Eve Cleaner', 'Finn Cleaner', 'Gil Cleaner'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, ACCOUNTS, STAYS, ANGELA, BEN, CARA, DAN, EVE, FINN, GIL] = roles.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `flags${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
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
const pay = input => rpc('workspace_cleaner_pay_action', [{ requestId: crypto.randomUUID(), ...input }]);
const run = async at => (await owner('select private.workspace_cleaner_invoice_run($1::timestamptz) r', [at]))[0].r.invoices;
const notices = async (user, prefix) => (await owner(`select a.event_type,d.preview from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join private.workspace_activity_details d on d.event_id=a.id where o.user_id=$1 order by a.id`, [users[user]])).filter(n => n.event_type.startsWith(prefix));

await as(ADMIN);
const leith = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '12 Leith St' }]);
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [ANGELA, 'cleaner'], [BEN, 'cleaner'], [CARA, 'cleaner'], [DAN, 'cleaner'], [EVE, 'cleaner'], [FINN, 'cleaner'], [GIL, 'cleaner']]) await rpc('workspace_assign_property', [leith, users[user], kind]);
for (const [cleaner, rate] of [[ANGELA, 4000], [BEN, 3000], [CARA, 5000], [DAN, 4525], [EVE, 3600], [FINN, 2000], [GIL, 2500]]) await teams({ action: 'setCleanerRate', cleanerId: users[cleaner], rateMinor: rate, version: 0 });
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

const inDays = async n => (await owner('select (current_date+$1::int)::text d', [n]))[0].d;
const photo = async (workId, cleaner) => (await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id",
  [leith, workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()]))[0].id;
const version = async workId => (await owner('select version from public.workspace_work_items where id=$1', [workId]))[0].version;
async function submit(workId, cleaner, report = 'Kitchen cleaned') {
  const id = await photo(workId, cleaner);
  await as(cleaner);
  return operation({ action: 'updateOperation', workId, version: await version(workId), step: 'submitCleaning', data: { checks: ['Kitchen'], report, photoIds: [id], mailAction: 'none' } });
}
async function review(workId, accepted, by = STAYS) {
  await as(by);
  return operation({ action: 'updateOperation', workId, version: await version(workId), step: 'reviewCleaning',
    data: accepted ? { accepted: true, reviewNote: 'All checks fine' } : { accepted: false, reviewNote: 'Kitchen floor not mopped', guestFeedback: 'Guest saw crumbs', redoBy: new Date(Date.now() + 3600000).toISOString() } });
}
async function clean(cleaner) {
  await as(MANAGER);
  const c = await operation({ action: 'createOperation', propertyId: leith, kind: 'cleaning', data: { dueOn: await inDays(2), checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [c.workId, c.version, users[cleaner]]);
  return c.workId;
}
// Accepted first time.
async function accepted(cleaner) { const w = await clean(cleaner); await submit(w, cleaner); await review(w, true); return w; }
// Sent, then rejected through the review (a dispute opens, the redo is due within the hour); not redone.
async function failed(cleaner) { const w = await clean(cleaner); await submit(w, cleaner); await review(w, false); return w; }
// The redo sent again and accepted.
async function redo(workId, cleaner) { await submit(workId, cleaner, 'Floor mopped again'); return review(workId, true, MANAGER); }
// Rejected (a dispute opens), redone, then the redo accepted.
async function redone(cleaner) {
  const w = await clean(cleaner); await submit(w, cleaner); await review(w, false);
  await submit(w, cleaner, 'Floor mopped again'); await review(w, true, MANAGER); return w;
}
// The test's own calendar: when the clean was done and accepted (London).
const when = (workId, cleanOn, acceptedAt) => owner("update private.workspace_clean_earnings set clean_on=$2::date,accepted_at=($3::timestamp at time zone 'Europe/London') where work_id=$1", [workId, cleanOn, acceptedAt]);
const requestOf = async user => (await owner("select * from private.workspace_cleaner_invoices where cleaner_id=$1 and generated and status<>'rejected' order by number desc limit 1", [users[user]]))[0];
const lineOf = async workId => (await owner('select outcome,outcome_source source,outcome_reason reason,amount_minor::int rate,pay_minor::int pay from private.workspace_cleaner_invoice_lines where work_id=$1 and live', [workId]))[0];
const autoHistory = async invoiceId => (await owner("select detail,actor_id,work_id from private.workspace_cleaner_invoice_history where invoice_id=$1 and event='outcome' order by id", [invoiceId]));
// The clean's day on the test's calendar (a clean not accepted has no earnings row: its day is the work's due day).
const dated = (workId, day) => owner('update public.workspace_work_items set due_on=$2::date where id=$1', [workId, day]);
// The real clean-form sweep, the morning after the clean's (real) day.
const sweepAfter = async () => (await owner("select private.workspace_clean_form_sweep(($1||' 10:00')::timestamp at time zone 'Europe/London') r", [await inDays(3)]))[0].r;
const complaintOf = async workId => (await owner("select (data->>'complaintWorkId')::uuid c from private.workspace_domain_details where work_id=$1", [workId]))[0].c;
async function overturn(workId) {
  const c = await complaintOf(workId);
  await as(ADMIN);
  return teams({ action: 'decideComplaint', workId: c, version: await version(c), outcome: 'overturned', note: 'The guest left the crumbs' });
}
const approve = async inv => { await as(ACCOUNTS); return pay({ action: 'approvePayInvoice', invoiceId: inv.id, version: (await owner('select version from private.workspace_cleaner_invoices where id=$1', [inv.id]))[0].version }); };
const linesOn = async invoiceId => (await owner('select work_id from private.workspace_cleaner_invoice_lines where invoice_id=$1 and live order by work_id', [invoiceId])).map(r => r.work_id);
const onTwo = async () => (await owner('select work_id from private.workspace_cleaner_invoice_lines where live group by work_id having count(*)>1')).length;

test('rejected, then redo accepted: Partially successful when the request is made; the cleaner is told the amount to invoice', async () => {
  const good = await accepted(ANGELA), bad = await redone(ANGELA);
  await when(good, '2027-01-05', '2027-01-05 15:00'); await when(bad, '2027-01-06', '2027-01-06 15:00');
  assert.equal(await run('2027-01-11T00:30:00Z'), 1);
  const inv = await requestOf(ANGELA);
  assert.deepEqual(await lineOf(good), { outcome: null, source: null, reason: null, rate: 4000, pay: 4000 }, 'a clean with no flag is left alone');
  assert.deepEqual(await lineOf(bad), { outcome: 'partial', source: 'auto', reason: 'redo_accepted', rate: 4000, pay: 2000 });
  assert.deepEqual([Number(inv.total_minor), Number(inv.pay_minor)], [8000, 6000], 're-totalled: full rate and amount to invoice');
  const [step] = await autoHistory(inv.id);
  assert.equal(step.actor_id, null, 'no person on an automatic change');
  assert.equal(step.work_id, bad);
  assert.deepEqual([step.detail.auto, step.detail.reason, step.detail.from, step.detail.to, step.detail.amountMinor, step.detail.totalMinor, step.detail.propertyName, step.detail.cleanOn],
    [true, 'redo_accepted', 'completed', 'partial', 2000, 6000, '12 Leith St', '2027-01-06']);
  assert.deepEqual((await notices(ANGELA, 'cleaning.invoice_ready')).map(n => n.preview), [`Request for invoice ${inv.number} ready: £60.00 for 2 cleans`]);
  // What the app reads: the source and the reason on each line, the history with the reason.
  await as(MANAGER);
  const read = await rpc('workspace_cleaner_pay_read', ['invoice', inv.id]);
  assert.deepEqual(read.lines.map(l => [l.workId, l.outcome, l.outcomeSource, l.outcomeReason]), [[good, 'completed', null, null], [bad, 'partial', 'auto', 'redo_accepted']]);
  assert.deepEqual(read.history.map(h => [h.event, h.auto ?? false, h.reason ?? null, h.actorName]), [['issued', false, null, null], ['outcome', true, 'redo_accepted', null]]);
  assert.equal(read.totalMinor, 6000);
});

test('a dispute decided in the cleaner\'s favour while the request waits: back to Completed, re-totalled, in the history', async () => {
  const inv = await requestOf(ANGELA);
  const [{ bad, complaint }] = await owner("select l.work_id bad,(d.data->>'complaintWorkId')::uuid complaint from private.workspace_cleaner_invoice_lines l join private.workspace_domain_details d on d.work_id=l.work_id where l.invoice_id=$1 and l.outcome='partial'", [inv.id]);
  await as(ADMIN);
  await teams({ action: 'decideComplaint', workId: complaint, version: await version(complaint), outcome: 'overturned', note: 'The guest left the crumbs' });
  assert.deepEqual(await lineOf(bad), { outcome: 'completed', source: 'auto', reason: 'dispute_won', rate: 4000, pay: 4000 });
  const now = await requestOf(ANGELA);
  assert.deepEqual([Number(now.pay_minor), now.version], [8000, inv.version + 1]);
  const steps = await autoHistory(inv.id);
  assert.deepEqual(steps.map(s => [s.detail.reason, s.detail.from, s.detail.to, s.detail.totalMinor]), [['redo_accepted', 'completed', 'partial', 6000], ['dispute_won', 'partial', 'completed', 8000]]);
  // Applying the rules again changes nothing.
  assert.deepEqual(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [inv.id]), [{ n: 0 }]);
  assert.equal((await requestOf(ANGELA)).version, now.version);
});

test('rejected and not redone (the review flow): on the request as Unsuccessful at £0; the redo accepted and the dispute won move it on', async () => {
  const one = await failed(BEN), two = await failed(BEN), good = await accepted(BEN);
  await dated(one, '2027-01-12'); await dated(two, '2027-01-13'); await when(good, '2027-01-14', '2027-01-14 10:00');
  assert.equal(await run('2027-01-18T00:30:00Z'), 1);
  const inv = await requestOf(BEN);
  assert.deepEqual(await linesOn(inv.id), [one, two, good].sort());
  assert.deepEqual(await lineOf(one), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 3000, pay: 0 });
  assert.deepEqual(await lineOf(two), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 3000, pay: 0 });
  assert.deepEqual(await lineOf(good), { outcome: null, source: null, reason: null, rate: 3000, pay: 3000 });
  assert.deepEqual([Number(inv.total_minor), Number(inv.pay_minor)], [9000, 3000]);
  assert.deepEqual((await notices(BEN, 'cleaning.invoice_ready')).map(n => n.preview), [`Request for invoice ${inv.number} ready: £30.00 for 3 cleans`]);
  // While it waits: the first is redone and the redo accepted; the second's dispute is decided for the cleaner.
  await redo(one, BEN);
  assert.deepEqual(await lineOf(one), { outcome: 'partial', source: 'auto', reason: 'redo_accepted', rate: 3000, pay: 1500 });
  await overturn(two);
  assert.deepEqual(await lineOf(two), { outcome: 'completed', source: 'auto', reason: 'dispute_won', rate: 3000, pay: 3000 });
  assert.equal(Number((await requestOf(BEN)).pay_minor), 7500);
  const steps = await autoHistory(inv.id);
  assert.deepEqual(steps.map(s => [s.work_id === one ? 'one' : 'two', s.detail.reason, s.detail.to, s.detail.totalMinor]),
    [['one', 'rejected', 'unsuccessful', 6000], ['two', 'rejected', 'unsuccessful', 3000], ['one', 'redo_accepted', 'partial', 4500], ['two', 'dispute_won', 'completed', 7500]]);
  // Both are accepted now (and recorded for pay), but never asked for twice.
  assert.equal((await owner('select count(*)::int n from private.workspace_clean_earnings where work_id=any($1)', [[one, two]]))[0].n, 2);
  assert.equal(await run('2027-01-25T00:30:00Z'), 0);
  assert.equal(await onTwo(), 0);
  // The cleaner hears only that the request is ready: no notice for the automatic changes.
  assert.deepEqual((await notices(BEN, 'cleaning.invoice')).map(n => n.event_type), ['cleaning.invoice_ready']);
});

test('a person\'s outcome sticks: the rules never change it again, whatever the flags do', async () => {
  const w = await failed(EVE), other = await accepted(EVE);
  await dated(w, '2027-01-26'); await when(other, '2027-01-26', '2027-01-26 12:00');
  assert.equal(await run('2027-02-01T00:30:00Z'), 1);
  const inv = await requestOf(EVE);
  assert.equal((await lineOf(w)).reason, 'rejected');
  // The cleaning manager changes the automatic Unsuccessful to Partially successful.
  await as(MANAGER);
  const set = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: w, outcome: 'partial', version: (await requestOf(EVE)).version });
  assert.deepEqual(await lineOf(w), { outcome: 'partial', source: 'manual', reason: null, rate: 3600, pay: 1800 });
  const line = set.lines.find(l => l.workId === w);
  assert.deepEqual([line.outcomeSource, line.outcomeReason], ['manual', null]);
  const before = (await autoHistory(inv.id)).length;
  // The redo is accepted, then the dispute is won: the person's choice stays.
  await redo(w, EVE);
  await overturn(w);
  assert.deepEqual(await lineOf(w), { outcome: 'partial', source: 'manual', reason: null, rate: 3600, pay: 1800 });
  assert.equal(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [inv.id]).then(r => r[0].n), 0);
  assert.equal((await autoHistory(inv.id)).length, before);
  assert.equal((await requestOf(EVE)).version, set.version, 'nothing changed');
  const history = await owner("select actor_id,detail from private.workspace_cleaner_invoice_history where invoice_id=$1 and event='outcome' and actor_id is not null", [inv.id]);
  assert.deepEqual(history.map(h => [h.actor_id, h.detail.from, h.detail.to, h.detail.auto ?? false]), [[users[MANAGER], 'unsuccessful', 'partial', false]]);
});

test('no clean form (the sweep): on the request as Unsuccessful at £0; the late form puts it back; approving is not held up by a £0 clean', async () => {
  const late = await clean(CARA), never = await clean(CARA), fine = await accepted(CARA);
  const swept = await sweepAfter();
  assert.ok(swept.warned >= 2, 'the sweep tags both');
  for (const w of [late, never]) assert.equal((await owner("select data->>'warning' w from private.workspace_domain_details where work_id=$1", [w]))[0].w, 'no_form');
  await dated(late, '2027-01-19'); await dated(never, '2027-01-20'); await when(fine, '2027-01-21', '2027-01-21 10:00');
  assert.equal(await run('2027-01-25T00:30:00Z'), 1);
  const inv = await requestOf(CARA);
  assert.deepEqual(await linesOn(inv.id), [late, never, fine].sort());
  for (const w of [late, never]) assert.deepEqual(await lineOf(w), { outcome: 'unsuccessful', source: 'auto', reason: 'no_form', rate: 5000, pay: 0 });
  assert.equal(Number((await requestOf(CARA)).pay_minor), 5000);
  // The form arrives late (the cleaner sends it): back to Completed.
  await submit(late, CARA, 'Sorry, sent late');
  assert.deepEqual(await lineOf(late), { outcome: 'completed', source: 'auto', reason: 'form_in', rate: 5000, pay: 5000 });
  assert.equal(Number((await requestOf(CARA)).pay_minor), 10000);
  // A no-form clean set to anything but Unsuccessful still holds approval up; at £0 it does not.
  await as(MANAGER);
  let current = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: never, outcome: 'completed', version: (await requestOf(CARA)).version });
  await as(ACCOUNTS);
  await assert.rejects(pay({ action: 'approvePayInvoice', invoiceId: inv.id, version: current.version }), /needs its clean form/);
  await as(MANAGER);
  current = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: never, outcome: 'unsuccessful', version: current.version });
  const approved = await approve(inv);
  assert.deepEqual([approved.status, approved.totalMinor], ['approved', 10000]);
  const steps = await autoHistory(inv.id);
  assert.deepEqual(steps.filter(s => s.actor_id === null).map(s => [s.work_id === late ? 'late' : 'never', s.detail.reason, s.detail.to]),
    [['late', 'no_form', 'unsuccessful'], ['never', 'no_form', 'unsuccessful'], ['late', 'form_in', 'completed']]);
});

test('waiting for review or a redo underway: left off; once settled, on the next request; a request all Unsuccessful is made at £0', async () => {
  const resent = await failed(FINN), underway = await failed(FINN), good = await accepted(FINN);
  await submit(resent, FINN, 'Done again, please look');
  await owner(`update private.workspace_domain_details set data=data||'{"redoBy":"2027-02-09T12:00:00Z"}' where work_id=$1`, [underway]);
  await dated(resent, '2027-02-02'); await dated(underway, '2027-02-03'); await when(good, '2027-02-04', '2027-02-04 10:00');
  // Dated before 20261022050000 was installed: never asked about.
  const old = await failed(FINN);
  await dated(old, '2026-01-05');
  assert.equal(await run('2027-02-08T00:30:00Z'), 1);
  const first = await requestOf(FINN);
  assert.deepEqual(await linesOn(first.id), [good], 'only the accepted clean');
  // The resent clean is rejected again; the redo time of the other passes.
  await review(resent, false);
  assert.equal(await run('2027-02-15T00:30:00Z'), 1);
  const second = await requestOf(FINN);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await linesOn(second.id), [resent, underway].sort(), 'on the next request');
  for (const w of [resent, underway]) assert.deepEqual(await lineOf(w), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 2000, pay: 0 });
  assert.deepEqual([Number(second.total_minor), Number(second.pay_minor)], [4000, 0]);
  assert.deepEqual((await notices(FINN, 'cleaning.invoice_ready')).map(n => n.preview).slice(-1), [`Request for invoice ${second.number} ready: £0.00 for 2 cleans`]);
  assert.equal((await owner('select count(*)::int n from private.workspace_cleaner_invoice_lines where work_id=$1', [old]))[0].n, 0);
  assert.equal(await onTwo(), 0);
});

test('nothing changes once the request is approved, nor on an invoice Accounts recorded by hand', async () => {
  // Finn's £0 request is approved (and paid); then one clean is redone and accepted, the other's dispute is won.
  const inv = await requestOf(FINN);
  const [{ underway }] = await owner("select l.work_id underway from private.workspace_cleaner_invoice_lines l join private.workspace_domain_details d on d.work_id=l.work_id where l.invoice_id=$1 and l.live and d.data->>'redoBy' like '2027-02-09%'", [inv.id]);
  const [resent] = (await linesOn(inv.id)).filter(w => w !== underway);
  const approved = await approve(inv);
  assert.deepEqual([approved.status, approved.totalMinor], ['approved', 0]);
  await owner('update private.workspace_cleaner_invoices set paid_on=current_date where id=$1', [inv.id]);
  const steps = (await autoHistory(inv.id)).length;
  await redo(resent, FINN);
  await overturn(underway);
  for (const w of [resent, underway]) assert.deepEqual(await lineOf(w), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 2000, pay: 0 });
  assert.equal(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [inv.id]).then(r => r[0].n), 0);
  const after = (await owner('select version,pay_minor::int pay from private.workspace_cleaner_invoices where id=$1', [inv.id]))[0];
  assert.deepEqual([after.version, after.pay, (await autoHistory(inv.id)).length], [approved.version, 0, steps]);
  // An invoice recorded by hand: a later rejection of that clean (written straight in) changes nothing.
  const c = await accepted(DAN);
  await as(ACCOUNTS);
  await rpc('workspace_payables_action', [{ action: 'recordCleanerInvoice', requestId: crypto.randomUUID(), supplier: 'Dan Cleaner', cleanerId: users[DAN], reference: 'DAN-HAND', invoiceDate: await inDays(0), totalMinor: 4525, lines: [{ workId: c, amountMinor: 4525 }] }]);
  await owner(`insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note,created_at) values($1,$2,$3,false,'Crumbs','Bathroom missed',now()+interval '1 minute')`, [c, users[DAN], users[STAYS]]);
  assert.deepEqual(await lineOf(c), { outcome: null, source: null, reason: null, rate: 4525, pay: null });
});

test('a redo accepted or a dispute won after approval: on the cleaner\'s next request as a follow-up, never paid twice', async () => {
  const earlier = await requestOf(FINN);
  const [{ underway }] = await owner("select l.work_id underway from private.workspace_cleaner_invoice_lines l join private.workspace_domain_details d on d.work_id=l.work_id where l.invoice_id=$1 and l.live and d.data->>'redoBy' like '2027-02-09%'", [earlier.id]);
  const [resent] = (await linesOn(earlier.id)).filter(w => w !== underway);
  const earlierLine = async w => (await owner('select id from private.workspace_cleaner_invoice_lines where invoice_id=$1 and work_id=$2', [earlier.id, w]))[0].id;
  const [lineResent, lineUnderway] = [await earlierLine(resent), await earlierLine(underway)];
  // On the test's calendar: the redo accepted on Sat 20 Feb 2027, the dispute decided on Sun 21 Feb.
  await owner("update private.workspace_cleaning_reviews set created_at='2027-02-20 10:00' where work_id=$1 and accepted", [resent]);
  await owner("update private.workspace_cleaning_reviews set overturned_at='2027-02-21 10:00' where work_id=$1 and overturned_at is not null", [underway]);
  assert.equal(await run('2027-03-01T00:30:00Z'), 1, 'the next request');
  const next = await requestOf(FINN);
  assert.notEqual(next.id, earlier.id);
  assert.deepEqual([(await owner('select period_start::text p from private.workspace_cleaner_invoices where id=$1', [next.id]))[0].p, await linesOn(next.id)], ['2027-02-15', [resent, underway].sort()]);
  assert.deepEqual(await lineOf(resent), { outcome: 'partial', source: 'auto', reason: 'late_redo_accepted', rate: 2000, pay: 1000 });
  assert.deepEqual(await lineOf(underway), { outcome: 'completed', source: 'auto', reason: 'late_dispute_won', rate: 2000, pay: 2000 });
  assert.deepEqual([Number(next.total_minor), Number(next.pay_minor)], [4000, 3000]);
  assert.deepEqual((await notices(FINN, 'cleaning.invoice_ready')).map(n => n.preview).slice(-1), [`Request for invoice ${next.number} ready: £30.00 for 2 cleans`]);
  // What the app reads: the follow-ups name the earlier request; the earlier request is as it was.
  await as(ACCOUNTS);
  const read = await rpc('workspace_cleaner_pay_read', ['invoice', next.id]);
  assert.deepEqual(read.lines.map(l => [l.outcomeReason, l.followsNumber]).sort(), [['late_dispute_won', earlier.number], ['late_redo_accepted', earlier.number]]);
  assert.deepEqual(read.history.filter(h => h.auto).map(h => [h.reason, h.afterNumber, h.from, h.to]).sort(),
    [['late_dispute_won', earlier.number, 'unsuccessful', 'completed'], ['late_redo_accepted', earlier.number, 'unsuccessful', 'partial']]);
  const old = await rpc('workspace_cleaner_pay_read', ['invoice', earlier.id]);
  assert.deepEqual([old.status, old.totalMinor, old.lineCount, old.lines.map(l => [l.outcome, l.amountMinor])], ['paid', 0, 2, [['unsuccessful', 0], ['unsuccessful', 0]]]);
  // Once on the next request it moves only between a late redo and a late dispute: nothing to change now.
  assert.equal(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [next.id]).then(r => r[0].n), 0);

  // Never paid twice.
  const paidFor = async w => (await owner(`select coalesce(sum(coalesce(l.pay_minor,l.amount_minor)),0)::int n from private.workspace_cleaner_invoice_lines l
    join private.workspace_cleaner_invoices v on v.id=l.invoice_id where l.work_id=$1 and v.status<>'rejected'`, [w]))[0].n;
  assert.deepEqual([await paidFor(resent), await paidFor(underway)], [1000, 2000]);
  const [{ property_id: prop }] = await owner('select property_id from private.workspace_cleaner_invoice_lines where id=$1', [lineResent]);
  // Another live line for the clean: the one-live-line rule.
  await assert.rejects(owner('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor) values($1,$2,$3,2000,2000)', [next.id, resent, prop]), /duplicate key/);
  // A second follow-up for the same clean: at most one, ever.
  await assert.rejects(owner('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor,live,follows_line_id) values($1,$2,$3,2000,2000,false,$4)', [next.id, resent, prop, lineResent]), /duplicate key/);
  // The earlier line can never earn or be live again.
  await assert.rejects(owner('update private.workspace_cleaner_invoice_lines set pay_minor=2000 where id=$1', [lineUnderway]), /cannot be paid twice/);
  await assert.rejects(owner("update private.workspace_cleaner_invoice_lines set outcome='completed',pay_minor=null where id=$1", [lineUnderway]), /cannot be paid twice/);
  await assert.rejects(owner('update private.workspace_cleaner_invoice_lines set live=true where id=$1', [lineResent]), /cannot be paid twice|duplicate key/);
  // A follow-up only for a clean that was Unsuccessful at £0: never for one that was paid.
  const [{ id: paidLine, work_id: paidClean }] = await owner("select l.id,l.work_id,l.invoice_id from private.workspace_cleaner_invoice_lines l join private.workspace_cleaner_invoices v on v.id=l.invoice_id where v.cleaner_id=$1 and l.live and coalesce(l.pay_minor,l.amount_minor)>0 and l.follows_line_id is null limit 1", [users[FINN]]);
  await assert.rejects(owner('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor,live,follows_line_id) values($1,$2,$3,2000,2000,false,$4)', [next.id, paidClean, prop, paidLine]), /only for a clean that was Unsuccessful/);
  // And the run never takes them again.
  assert.equal(await run('2027-03-08T00:30:00Z'), 0);
  assert.deepEqual([await paidFor(resent), await paidFor(underway)], [1000, 2000]);
  assert.equal(await onTwo(), 0);
});

test('a person\'s Unsuccessful on the earlier request means a person decided: no follow-up', async () => {
  const w = await failed(GIL);
  await dated(w, '2027-03-02');
  assert.equal(await run('2027-03-08T00:30:00Z'), 1);
  const inv = await requestOf(GIL);
  assert.equal((await lineOf(w)).reason, 'rejected');
  await as(MANAGER);
  let v = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: w, outcome: 'partial', version: (await requestOf(GIL)).version });
  v = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: w, outcome: 'unsuccessful', version: v.version });
  assert.deepEqual(await lineOf(w), { outcome: 'unsuccessful', source: 'manual', reason: null, rate: 2500, pay: 0 });
  await approve(inv);
  await redo(w, GIL);
  await owner("update private.workspace_cleaning_reviews set created_at='2027-03-10 10:00' where work_id=$1 and accepted", [w]);
  assert.equal(await run('2027-03-15T00:30:00Z'), 0);
  assert.equal((await owner('select count(*)::int n from private.workspace_cleaner_invoice_lines where work_id=$1', [w]))[0].n, 1);
});

test('the backend may re-apply the rules to every waiting request; nobody else may call them', async () => {
  await as('backend');
  assert.deepEqual(await rpc('workspace_clean_outcomes_auto_all'), { changed: 0 }, 'already applied');
  for (const who of [ADMIN, MANAGER, ACCOUNTS, BEN]) {
    await as(who);
    await assert.rejects(rpc('workspace_clean_outcomes_auto_all'), /permission denied/, roles[who]);
    await assert.rejects(db.query('select private.workspace_clean_outcome_flag($1,$2)', [users[0], users[0]]), /permission denied/, roles[who]);
    await assert.rejects(db.query('select * from private.workspace_clean_failed_open(null,null)'), /permission denied/, roles[who]);
  }
});

test('safe to run twice: each patch once, nothing dropped or deleted, CRLF and no em dash', async () => {
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  for (const [fn, sentinel] of [
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): automatic outcomes'],
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): failed cleaners'],
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): failed count'],
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): failed lines'],
    ['private.workspace_cleaner_pay_action(jsonb)', 'Clean outcome flags (20261022050000): manual'],
    ['private.workspace_cleaner_pay_action(jsonb)', 'Clean outcome flags (20261022050000): gate'],
    ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)', 'Clean outcome flags (20261022050000): source'],
    ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)', 'Clean outcome flags (20261022050000): follows'],
    ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)', 'Clean outcome flags (20261022050000): made good, counted'],
    ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)', 'Clean outcome flags (20261022050000): made good, shown'],
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): late follow-ups'],
  ]) {
    const [{ def }] = await owner('select pg_get_functiondef($1::regprocedure) def', [fn]);
    assert.equal(def.split(sentinel).length - 1, 1, sentinel);
  }
  const triggers = await owner("select tgname from pg_trigger where tgname in ('clean_outcome_form_flag','clean_outcome_review_flag','clean_follow_up_guard') order by 1");
  assert.deepEqual(triggers.map(t => t.tgname), ['clean_follow_up_guard', 'clean_outcome_form_flag', 'clean_outcome_review_flag']);
  assert.equal((await owner('select count(*)::int n from private.workspace_clean_outcome_settings'))[0].n, 1);
  const text = await fs.readFile(MIGRATION, 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF line endings');
  assert.ok(!text.includes('—'), 'no em dash');
});
