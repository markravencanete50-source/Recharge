import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Clean outcomes from the app's own flags (migration 20261022050000), on top of requests for invoice (20261022000000):
// no clean form makes a clean Unsuccessful, a rejection that stands with no redo accepted Unsuccessful, a redo accepted
// after a rejection Partially successful, and a dispute decided in the cleaner's favour Completed again. Applied when the
// request is made and whenever a flag changes while it waits; never over a person's choice; each change re-totals the
// request and is kept in its history with the reason; nothing changes once it is approved.
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

const roles = ['super_admin', 'cleaning_manager', 'accounts', 'stays', 'cleans', 'cleans', 'cleans', 'cleans'];
const names = ['Admin', 'Manager', 'Accounts', 'Stays', 'Angela Cleaner', 'Ben Cleaner', 'Cara Cleaner', 'Dan Cleaner'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, ACCOUNTS, STAYS, ANGELA, BEN, CARA, DAN] = roles.map((_, i) => i);
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
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [ANGELA, 'cleaner'], [BEN, 'cleaner'], [CARA, 'cleaner'], [DAN, 'cleaner']]) await rpc('workspace_assign_property', [leith, users[user], kind]);
for (const [cleaner, rate] of [[ANGELA, 4000], [BEN, 3000], [CARA, 5000], [DAN, 4525]]) await teams({ action: 'setCleanerRate', cleanerId: users[cleaner], rateMinor: rate, version: 0 });
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
// A rejection the request sees while it waits. In the app a clean only reaches a request once accepted, so a rejection
// that stands is written straight in, as the review flow would, a moment after the last review.
const reject = (workId, cleaner) => owner(`insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note,created_at)
  select $1,$2,$3,false,'Guest saw crumbs','Bathroom missed',greatest(now(),(select max(created_at) from private.workspace_cleaning_reviews where work_id=$1))+interval '1 second'`, [workId, users[cleaner], users[STAYS]]);
const acceptAgain = (workId, cleaner) => owner(`insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note,created_at)
  select $1,$2,$3,true,'','Redo fine',(select max(created_at) from private.workspace_cleaning_reviews where work_id=$1)+interval '1 second'`, [workId, users[cleaner], users[MANAGER]]);
// The sweep's no-form tag on a clean whose form is not in, and the form arriving late.
const noForm = workId => owner(`update private.workspace_domain_details set data=(data-'submittedBy'-'submittedAt')||jsonb_build_object('phase','assigned','warning','no_form','formWarningAt','2027-01-01T09:00:00.000Z') where work_id=$1`, [workId]);
const formIn = workId => owner(`update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','submittedBy',$2::text) where work_id=$1`, [workId, users[CARA]]);

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

test('rejected and not redone: Unsuccessful, when the request is made and when a rejection comes while it waits; then redo and dispute', async () => {
  const early = await accepted(BEN), late = await accepted(BEN);
  await when(early, '2027-01-12', '2027-01-12 10:00'); await when(late, '2027-01-13', '2027-01-13 10:00');
  await reject(early, BEN);
  assert.equal(await run('2027-01-18T00:30:00Z'), 1);
  const inv = await requestOf(BEN);
  assert.deepEqual(await lineOf(early), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 3000, pay: 0 });
  assert.deepEqual(await lineOf(late), { outcome: null, source: null, reason: null, rate: 3000, pay: 3000 });
  assert.equal(Number(inv.pay_minor), 3000);
  // While it waits: a rejection that stands, the redo accepted, then the dispute won.
  await reject(late, BEN);
  assert.deepEqual(await lineOf(late), { outcome: 'unsuccessful', source: 'auto', reason: 'rejected', rate: 3000, pay: 0 });
  assert.equal(Number((await requestOf(BEN)).pay_minor), 0, 'every clean unsuccessful: nothing to invoice');
  await acceptAgain(late, BEN);
  assert.deepEqual(await lineOf(late), { outcome: 'partial', source: 'auto', reason: 'redo_accepted', rate: 3000, pay: 1500 });
  await owner('update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=$2 where work_id=$1 and not accepted', [late, users[ADMIN]]);
  assert.deepEqual(await lineOf(late), { outcome: 'completed', source: 'auto', reason: 'dispute_won', rate: 3000, pay: 3000 });
  const steps = await autoHistory(inv.id);
  assert.deepEqual(steps.map(s => [s.work_id === early ? 'early' : 'late', s.detail.reason, s.detail.to, s.detail.totalMinor]),
    [['early', 'rejected', 'unsuccessful', 3000], ['late', 'rejected', 'unsuccessful', 0], ['late', 'redo_accepted', 'partial', 1500], ['late', 'dispute_won', 'completed', 3000]]);
  // The cleaner hears only that the request is ready: no notice for the automatic changes.
  assert.deepEqual((await notices(BEN, 'cleaning.invoice')).map(n => n.event_type), ['cleaning.invoice_ready']);
});

test('a person\'s outcome sticks: the rules never change it again, whatever the flags do', async () => {
  const inv = await requestOf(BEN);
  const [{ early }] = await owner("select work_id early from private.workspace_cleaner_invoice_lines where invoice_id=$1 and outcome_reason='rejected'", [inv.id]);
  // The cleaning manager changes the automatic Unsuccessful to Partially successful.
  await as(MANAGER);
  const set = await pay({ action: 'setPayLineOutcome', invoiceId: inv.id, workId: early, outcome: 'partial', version: inv.version });
  assert.deepEqual(await lineOf(early), { outcome: 'partial', source: 'manual', reason: null, rate: 3000, pay: 1500 });
  const line = set.lines.find(l => l.workId === early);
  assert.deepEqual([line.outcomeSource, line.outcomeReason], ['manual', null]);
  const before = (await autoHistory(inv.id)).length;
  // The dispute is then won, a redo accepted and another rejection: the person's choice stays.
  await owner('update private.workspace_cleaning_reviews set overturned_at=now() where work_id=$1 and not accepted', [early]);
  await acceptAgain(early, BEN);
  await reject(early, BEN);
  assert.deepEqual(await lineOf(early), { outcome: 'partial', source: 'manual', reason: null, rate: 3000, pay: 1500 });
  assert.equal(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [inv.id]).then(r => r[0].n), 0);
  assert.equal((await autoHistory(inv.id)).length, before);
  assert.equal((await requestOf(BEN)).version, set.version, 'nothing changed');
  const history = await owner("select actor_id,detail from private.workspace_cleaner_invoice_history where invoice_id=$1 and event='outcome' and actor_id is not null", [inv.id]);
  assert.deepEqual(history.map(h => [h.actor_id, h.detail.from, h.detail.to, h.detail.auto ?? false]), [[users[MANAGER], 'unsuccessful', 'partial', false]]);
});

test('no clean form: Unsuccessful when the request is made and when the sweep tags it while it waits; the late form puts it back', async () => {
  const tagged = await accepted(CARA), fine = await accepted(CARA);
  await when(tagged, '2027-01-19', '2027-01-19 10:00'); await when(fine, '2027-01-20', '2027-01-20 10:00');
  await noForm(tagged);
  assert.equal(await run('2027-01-25T00:30:00Z'), 1);
  const inv = await requestOf(CARA);
  assert.deepEqual(await lineOf(tagged), { outcome: 'unsuccessful', source: 'auto', reason: 'no_form', rate: 5000, pay: 0 });
  assert.equal(Number(inv.pay_minor), 5000);
  // The form arrives late: back to Completed.
  await formIn(tagged);
  assert.deepEqual(await lineOf(tagged), { outcome: 'completed', source: 'auto', reason: 'form_in', rate: 5000, pay: 5000 });
  // Tagged while the request waits.
  await noForm(fine);
  assert.deepEqual(await lineOf(fine), { outcome: 'unsuccessful', source: 'auto', reason: 'no_form', rate: 5000, pay: 0 });
  assert.equal(Number((await requestOf(CARA)).pay_minor), 5000);
  // No form outranks a redo accepted after a rejection.
  await reject(fine, CARA); await acceptAgain(fine, CARA);
  assert.equal((await lineOf(fine)).reason, 'no_form');
  await formIn(fine);
  assert.deepEqual(await lineOf(fine), { outcome: 'partial', source: 'auto', reason: 'redo_accepted', rate: 5000, pay: 2500 });
  const steps = await autoHistory(inv.id);
  assert.deepEqual(steps.map(s => [s.detail.reason, s.detail.from, s.detail.to, s.detail.totalMinor]),
    [['no_form', 'completed', 'unsuccessful', 5000], ['form_in', 'unsuccessful', 'completed', 10000], ['no_form', 'completed', 'unsuccessful', 5000], ['redo_accepted', 'unsuccessful', 'partial', 7500]]);
  // An edit to the clean that leaves the flag as it was changes nothing.
  const v = (await requestOf(CARA)).version;
  await owner("update private.workspace_domain_details set data=data||'{\"note\":\"x\"}' where work_id=$1", [fine]);
  assert.equal((await requestOf(CARA)).version, v);
});

test('nothing changes once the request is approved, nor on an invoice Accounts recorded by hand', async () => {
  const inv = await requestOf(ANGELA);
  await as(ACCOUNTS);
  const approved = await pay({ action: 'approvePayInvoice', invoiceId: inv.id, version: inv.version });
  assert.equal(approved.status, 'approved');
  const [{ good }] = await owner('select work_id good from private.workspace_cleaner_invoice_lines where invoice_id=$1 and outcome_source is null', [inv.id]);
  const steps = (await autoHistory(inv.id)).length;
  await reject(good, ANGELA);
  assert.deepEqual(await lineOf(good), { outcome: null, source: null, reason: null, rate: 4000, pay: 4000 });
  assert.equal(await owner('select private.workspace_clean_outcomes_auto_invoice($1) n', [inv.id]).then(r => r[0].n), 0);
  const after = await requestOf(ANGELA);
  assert.deepEqual([after.version, Number(after.pay_minor), (await autoHistory(inv.id)).length], [approved.version, 8000, steps]);
  // An invoice recorded by hand.
  const c = await accepted(DAN);
  await as(ACCOUNTS);
  await rpc('workspace_payables_action', [{ action: 'recordCleanerInvoice', requestId: crypto.randomUUID(), supplier: 'Dan Cleaner', cleanerId: users[DAN], reference: 'DAN-HAND', invoiceDate: await inDays(0), totalMinor: 4525, lines: [{ workId: c, amountMinor: 4525 }] }]);
  await reject(c, DAN);
  assert.deepEqual(await lineOf(c), { outcome: null, source: null, reason: null, rate: 4525, pay: null });
});

test('the backend may re-apply the rules to every waiting request; nobody else may call them', async () => {
  await as('backend');
  assert.deepEqual(await rpc('workspace_clean_outcomes_auto_all'), { changed: 0 }, 'already applied');
  for (const who of [ADMIN, MANAGER, ACCOUNTS, BEN]) {
    await as(who);
    await assert.rejects(rpc('workspace_clean_outcomes_auto_all'), /permission denied/, roles[who]);
    await assert.rejects(db.query('select private.workspace_clean_outcome_flag($1,$2)', [users[0], users[0]]), /permission denied/, roles[who]);
  }
});

test('safe to run twice: each patch once, nothing dropped or deleted, CRLF and no em dash', async () => {
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  for (const [fn, sentinel] of [
    ['private.workspace_cleaner_invoice_run(timestamptz)', 'Clean outcome flags (20261022050000): automatic outcomes'],
    ['private.workspace_cleaner_pay_action(jsonb)', 'Clean outcome flags (20261022050000): manual'],
    ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)', 'Clean outcome flags (20261022050000): source'],
  ]) {
    const [{ def }] = await owner('select pg_get_functiondef($1::regprocedure) def', [fn]);
    assert.equal(def.split(sentinel).length - 1, 1, fn);
  }
  const triggers = await owner("select tgname from pg_trigger where tgname in ('clean_outcome_form_flag','clean_outcome_review_flag') order by 1");
  assert.deepEqual(triggers.map(t => t.tgname), ['clean_outcome_form_flag', 'clean_outcome_review_flag']);
  const text = await fs.readFile(MIGRATION, 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF line endings');
  assert.ok(!text.includes('—'), 'no em dash');
});
