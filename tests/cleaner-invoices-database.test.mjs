import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Requests for invoice (migration 20261022000000): accepted cleans recorded with the rate at the time, one request per
// cleaner per pay period (weekly or monthly) at the period's end, numbered RC-RFI-YYYY-NNNN, never empty and never twice;
// a clean accepted late goes on the next one; each clean's outcome (completed, partially successful, unsuccessful) set by
// management or the cleaning manager, re-totalling the request and kept in its history; Accounts approve, query and mark
// paid; who sees what; the cleaner's notices (phone only); earnings and projected pay; and the figures on each role's Home.
const MIGRATION = 'supabase/migrations/20261022000000_cleaner_invoices.sql';
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
const phoneOnly = files.includes('20261021900000_cleaner_notices_phone_only.sql');

const roles = ['super_admin', 'cleaning_manager', 'accounts', 'stays', 'cleans', 'cleans', 'cleans', 'cleans', 'client', 'ready', 'cleaning_manager'];
const names = ['Admin', 'Manager', 'Accounts', 'Stays', 'Angela Cleaner', 'Ben Cleaner', 'Cara Cleaner', 'Dan Cleaner', 'Owner', 'Ready', 'Other Manager'];
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, MANAGER, ACCOUNTS, STAYS, ANGELA, BEN, CARA, DAN, OWNER, READY, OTHER] = roles.map((_, i) => i);
const session = i => users[i].replace('9760', '9860');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `pay${i}@example.com`]);
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
const read = (section, target = null) => rpc('workspace_cleaner_pay_read', [section, target]);
const run = async at => (await owner('select private.workspace_cleaner_invoice_run($1::timestamptz) r', [at]))[0].r.invoices;
const notices = async (user, prefix = 'cleaning.invoice') => (await owner(`select a.event_type,o.work_id,a.property_id,d.preview from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join private.workspace_activity_details d on d.event_id=a.id where o.user_id=$1 order by a.id`, [users[user]])).filter(n => n.event_type.startsWith(prefix));
const invoicesOf = user => owner(`select i.*,i.invoice_date::text issued,i.period_start::text ps,i.period_end::text pe,i.due_on::text due,
  (select coalesce(json_agg(json_build_object('workId',l.work_id,'amount',l.amount_minor) order by l.amount_minor,l.work_id),'[]') from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and l.live) lines
  from private.workspace_cleaner_invoices i where i.cleaner_id=$1 and i.generated order by i.number`, [users[user]]);

await as(ADMIN);
const hawk = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '110 Hawk' }]);
const leith = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '12 Leith St' }]);
for (const prop of [hawk, leith]) for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [ANGELA, 'cleaner'], [BEN, 'cleaner'], [CARA, 'cleaner'], [DAN, 'cleaner'], [OWNER, 'client']]) await rpc('workspace_assign_property', [prop, users[user], kind]);
await teams({ action: 'setCleanerRate', cleanerId: users[ANGELA], rateMinor: 4000, version: 0 });
await teams({ action: 'setCleanerRate', cleanerId: users[BEN], rateMinor: 3550, version: 0 });
await teams({ action: 'setCleanerRate', cleanerId: users[DAN], rateMinor: 3000, version: 0 });
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

const inDays = async n => (await owner('select (current_date+$1::int)::text d', [n]))[0].d;
// A clean at a property, assigned to the cleaner and submitted with one verified photo.
async function submitted(cleaner, prop = leith, dueOn = null) {
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: prop, kind: 'cleaning', data: { dueOn: dueOn ?? await inDays(2), checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[cleaner]]);
  const [{ id: photo }] = await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id", [prop, clean.workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()]);
  await as(cleaner);
  const work = (await rpc('workspace_operations_read', [prop])).find(w => w.workId === clean.workId);
  const done = await operation({ action: 'updateOperation', workId: clean.workId, version: work.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [photo], mailAction: 'none' } });
  return { workId: clean.workId, version: done.version, prop };
}
async function review(clean, accepted, by = STAYS) {
  await as(by);
  return operation({ action: 'updateOperation', workId: clean.workId, version: clean.version, step: 'reviewCleaning',
    data: accepted ? { accepted: true, reviewNote: 'All checks fine' } : { accepted: false, reviewNote: 'Kitchen floor not mopped', guestFeedback: 'Guest saw crumbs', redoBy: new Date(Date.now() + 3600000).toISOString() } });
}
async function accepted(cleaner, prop = leith) { const c = await submitted(cleaner, prop); await review(c, true); return c.workId; }
// The test's own calendar: when the clean was done and accepted (London).
const when = (workId, cleanOn, acceptedAt) => owner("update private.workspace_clean_earnings set clean_on=$2::date,accepted_at=($3::timestamp at time zone 'Europe/London') where work_id=$1", [workId, cleanOn, acceptedAt]);
const earning = async workId => (await owner('select cleaner_id,property_id,rate_minor,clean_on::text from private.workspace_clean_earnings where work_id=$1', [workId]))[0];

test('an accepted clean is recorded for pay with the cleaner\'s rate at the time; a rejected one only once its redo is accepted', async () => {
  const good = await accepted(ANGELA);
  assert.deepEqual(await earning(good), { cleaner_id: users[ANGELA], property_id: leith, rate_minor: 4000, clean_on: await inDays(2) });
  // A later rate change does not touch the snapshot.
  await as(ACCOUNTS);
  await teams({ action: 'setCleanerRate', cleanerId: users[ANGELA], rateMinor: 4500, version: 1 });
  assert.equal((await earning(good)).rate_minor, 4000);

  const bad = await submitted(ANGELA, hawk);
  const rejected = await review(bad, false);
  assert.equal(await earning(bad.workId), undefined, 'a rejected clean is not paid');
  // The cleaner redoes it and it is accepted: now it counts, at the rate of that moment.
  await as(ANGELA);
  const again = (await rpc('workspace_operations_read', [hawk])).find(w => w.workId === bad.workId);
  const [{ id: photo }] = await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id", [hawk, bad.workId, users[ANGELA], 'TEST-ONLY-' + crypto.randomUUID()]);
  await as(ANGELA);
  const resent = await operation({ action: 'updateOperation', workId: bad.workId, version: again.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Floor mopped again', photoIds: [photo], mailAction: 'none' } });
  assert.ok(rejected.version < resent.version);
  await review({ workId: bad.workId, version: resent.version }, true, MANAGER);
  assert.equal((await earning(bad.workId)).rate_minor, 4500);
  // A clean accepted before the cleaner has a rate waits for one, then takes it.
  const unpriced = await accepted(CARA);
  assert.equal((await earning(unpriced)).rate_minor, null);
  await as(ADMIN);
  await teams({ action: 'setCleanerRate', cleanerId: users[CARA], rateMinor: 2800, version: 0 });
  assert.equal((await earning(unpriced)).rate_minor, 2800);
  // Put these three somewhere quiet in the calendar so the next tests start clean.
  for (const w of [good, bad.workId, unpriced]) await when(w, '2027-01-06', '2027-01-06 15:00');
});

test('weekly (Monday to Sunday): one invoice at the end of the week, numbered, with a line per clean; nothing twice and nothing empty', async () => {
  // The cleans from the first test were accepted in the week of Mon 4 Jan 2027.
  assert.equal(await run('2027-01-10T12:00:00Z'), 0, 'Sunday: the week has not ended');
  assert.equal(await run('2027-01-11T00:30:00Z'), 2, 'Monday 00:30 London: Angela and Cara');
  const [inv] = await invoicesOf(ANGELA);
  assert.match(inv.number, /^RC-RFI-2027-000[12]$/);
  assert.deepEqual([inv.status, inv.period_kind, inv.ps, inv.pe, inv.issued, inv.due, Number(inv.total_minor), inv.lines.map(l => l.amount)], ['to_approve', 'weekly', '2027-01-04', '2027-01-10', '2027-01-11', '2027-01-18', 8500, [4000, 4500]]);
  assert.equal(inv.reference, inv.number); assert.equal(inv.supplier, 'Angela Cleaner'); assert.equal(inv.currency, 'GBP');
  assert.equal((await invoicesOf(CARA))[0].lines.length, 1);
  // Run again, at any time: nothing new.
  assert.equal(await run('2027-01-11T00:45:00Z'), 0);
  assert.equal(await run('2027-01-20T10:00:00Z'), 0);
  assert.equal((await invoicesOf(ANGELA)).length, 1, 'never invoiced twice');
  assert.equal((await invoicesOf(BEN)).length, 0, 'no invoice for a period with nothing accepted');
  assert.equal((await owner('select count(*)::int n from private.workspace_cleaner_invoice_lines l join private.workspace_clean_earnings e on e.work_id=l.work_id where l.live group by l.work_id having count(*)>1')).length, 0);
  // The cleaner is told: "Invoice RC-RFI-… ready: £85.00 for 2 cleans".
  const ready = await notices(ANGELA, 'cleaning.invoice_ready');
  assert.deepEqual(ready.map(n => n.preview), [`Request for invoice ${inv.number} ready: £85.00 for 2 cleans`]);
  assert.equal(ready[0].work_id, null); assert.equal(ready[0].property_id, null, 'never on an owner\'s feed');
  assert.deepEqual((await notices(CARA, 'cleaning.invoice_ready')).map(n => n.preview), [`Request for invoice ${(await invoicesOf(CARA))[0].number} ready: £28.00 for 1 clean`]);
});

test('invoice numbers are sequential per year and never reused', async () => {
  const before = (await owner('select number from private.workspace_cleaner_invoices where generated order by number')).map(r => r.number);
  assert.deepEqual(before, ['RC-RFI-2027-0001', 'RC-RFI-2027-0002']);
  const c = await accepted(DAN);
  await when(c, '2027-01-13', '2027-01-13 18:00');
  assert.equal(await run('2027-01-18T01:00:00Z'), 1);
  assert.equal((await invoicesOf(DAN))[0].number, 'RC-RFI-2027-0003');
  // Rejecting an invoice (the older Accounts decision) frees its cleans, but its number is never given out again.
  await as(ACCOUNTS);
  const dan = (await invoicesOf(DAN))[0];
  await rpc('workspace_payables_action', [{ action: 'decideCleanerInvoice', requestId: crypto.randomUUID(), invoiceId: dan.id, decision: 'reject', note: 'Wrong property on the clean' }]);
  assert.equal(await run('2027-01-18T02:00:00Z'), 1, 'the freed clean goes on a new invoice');
  assert.deepEqual((await invoicesOf(DAN)).map(i => [i.number, i.status]), [['RC-RFI-2027-0003', 'rejected'], ['RC-RFI-2027-0004', 'to_approve']]);
  assert.deepEqual((await owner('select year,last_number from private.workspace_cleaner_invoice_numbers')), [{ year: 2027, last_number: 4 }]);
});

test('monthly (calendar month): set by Accounts or admins and logged; one invoice when the month ends', async () => {
  const set = (period, version) => pay({ action: 'setCleanerPayPeriod', cleanerId: users[BEN], period, version });
  for (const who of [MANAGER, STAYS, BEN, OWNER, READY]) { await as(who); await assert.rejects(set('monthly', 0), /Only Accounts and admins/, roles[who]); }
  await as(ACCOUNTS);
  await assert.rejects(pay({ action: 'setCleanerPayPeriod', cleanerId: users[STAYS], period: 'monthly', version: 0 }), /Only cleaners have a pay period/);
  await assert.rejects(set('fortnightly', 0), /weekly or monthly/);
  assert.deepEqual(await set('monthly', 0), { cleanerId: users[BEN], period: 'monthly', version: 1 });
  await assert.rejects(set('weekly', 0), /changed by someone else/);
  await as(ADMIN);
  assert.equal((await set('weekly', 1)).version, 2);
  assert.equal((await set('monthly', 2)).version, 3);
  const history = await owner('select old_period,new_period,changed_by from private.workspace_cleaner_pay_period_history where cleaner_id=$1 order by id', [users[BEN]]);
  assert.deepEqual(history.map(h => [h.old_period, h.new_period, h.changed_by]), [['weekly', 'monthly', users[ACCOUNTS]], ['monthly', 'weekly', users[ADMIN]], ['weekly', 'monthly', users[ADMIN]]]);

  const one = await accepted(BEN), two = await accepted(BEN, hawk);
  await when(one, '2027-02-03', '2027-02-03 16:00'); await when(two, '2027-02-24', '2027-02-25 09:00');
  assert.equal(await run('2027-02-08T03:00:00Z'), 0, 'a week has ended, the month has not');
  assert.equal(await run('2027-02-28T23:30:00Z'), 0, '28 Feb, 23:30 London');
  assert.equal(await run('2027-03-01T00:15:00Z'), 1);
  const [inv] = await invoicesOf(BEN);
  assert.deepEqual([inv.period_kind, inv.ps, inv.pe, Number(inv.total_minor), inv.lines.length], ['monthly', '2027-02-01', '2027-02-28', 7100, 2]);
});

test('a clean accepted after its period closed goes on the next invoice', async () => {
  const onTime = await accepted(DAN), late = await accepted(DAN, hawk);
  await when(onTime, '2027-03-02', '2027-03-02 12:00');
  // Done on Sunday 7 March, accepted on Monday 8 March just after midnight: after its week closed.
  await when(late, '2027-03-07', '2027-03-08 00:05');
  assert.equal(await run('2027-03-08T09:00:00Z'), 1);
  let invs = (await invoicesOf(DAN)).filter(i => i.status !== 'rejected');
  const march1 = invs.find(i => i.ps === '2027-03-01');
  assert.deepEqual(march1.lines.map(l => l.workId), [onTime]);
  assert.equal(await run('2027-03-15T00:10:00Z'), 1);
  invs = (await invoicesOf(DAN)).filter(i => i.status !== 'rejected');
  const march8 = invs.find(i => i.ps === '2027-03-08');
  assert.deepEqual(march8.lines.map(l => l.workId), [late], 'on the next week\'s invoice');
  // A missed week catches up: two weeks' cleans become two invoices, each in its own week.
  const a = await accepted(DAN), b = await accepted(DAN);
  await when(a, '2027-03-16', '2027-03-16 10:00'); await when(b, '2027-03-24', '2027-03-24 10:00');
  assert.equal(await run('2027-03-30T10:00:00Z'), 2);
  invs = (await invoicesOf(DAN)).filter(i => i.status !== 'rejected');
  assert.deepEqual(invs.filter(i => i.ps >= '2027-03-15').map(i => [i.ps, i.lines.map(l => l.workId)]), [['2027-03-15', [a]], ['2027-03-22', [b]]]);
});

test('a clean already on an invoice Accounts recorded by hand is never invoiced again', async () => {
  const c = await accepted(DAN);
  await when(c, '2027-04-06', '2027-04-06 10:00');
  await as(ACCOUNTS);
  await rpc('workspace_payables_action', [{ action: 'recordCleanerInvoice', requestId: crypto.randomUUID(), supplier: 'Dan Cleaner', cleanerId: users[DAN], reference: 'DAN-APRIL', invoiceDate: await inDays(0), totalMinor: 3000, lines: [{ workId: c, amountMinor: 3000 }] }]);
  assert.equal(await run('2027-04-12T01:00:00Z'), 0);
  assert.equal((await owner('select count(*)::int n from private.workspace_cleaner_invoice_lines where work_id=$1', [c]))[0].n, 1);
});

test('Accounts approve, query with a note to the cleaner, and mark paid with the date; the cleaner hears each', async () => {
  const [inv] = await invoicesOf(ANGELA);
  const act = (who, input) => as(who).then(() => pay({ invoiceId: inv.id, ...input }));
  for (const who of [STAYS, MANAGER, ANGELA, OWNER, READY]) await assert.rejects(act(who, { action: 'approvePayInvoice', version: inv.version }), /Only Accounts and admins/, roles[who]);
  await assert.rejects(act(ACCOUNTS, { action: 'queryPayInvoice', version: inv.version, note: 'Hi' }), /note/);
  await assert.rejects(act(ACCOUNTS, { action: 'markPayInvoicePaid', version: inv.version, paidOn: '2027-01-12' }), /Only an approved request/);
  const queried = await act(ACCOUNTS, { action: 'queryPayInvoice', version: inv.version, note: 'Was the Hawk clean a deep clean?' });
  assert.deepEqual([queried.status, queried.queried, queried.queryNote], ['to_approve', true, 'Was the Hawk clean a deep clean?']);
  assert.deepEqual((await notices(ANGELA, 'cleaning.invoice_queried')).map(n => n.preview), [`Request ${inv.number} queried: Was the Hawk clean a deep clean?`]);
  await assert.rejects(act(ACCOUNTS, { action: 'approvePayInvoice', version: inv.version }), /changed by someone else/);
  const approved = await act(ACCOUNTS, { action: 'approvePayInvoice', version: queried.version });
  assert.equal(approved.status, 'approved');
  assert.deepEqual((await notices(ANGELA, 'cleaning.invoice_approved')).map(n => n.preview), [`Request approved: ${inv.number}, £85.00`]);
  // The cleans' invoice tasks are done.
  const tasks = await owner(`select w.status from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_invoice'
    and d.data->>'sourceWorkId' in (select l.work_id::text from private.workspace_cleaner_invoice_lines l where l.invoice_id=$1)`, [inv.id]);
  assert.ok(tasks.length >= 2 && tasks.every(t => t.status === 'completed'));
  await assert.rejects(act(ACCOUNTS, { action: 'queryPayInvoice', version: approved.version, note: 'One more question' }), /waiting for approval/);
  const today = await inDays(0);
  await assert.rejects(act(ACCOUNTS, { action: 'markPayInvoicePaid', version: approved.version, paidOn: await inDays(1) }), /between the request date and today/);
  await assert.rejects(act(ACCOUNTS, { action: 'markPayInvoicePaid', version: approved.version, paidOn: '2027-02-30' }), /date it was paid/);
  // The made invoices are dated in 2027 by the test calendar; date this one today so it can be paid today.
  await owner("update private.workspace_cleaner_invoices set invoice_date=current_date where id=$1", [inv.id]);
  const paid = await act(ADMIN, { action: 'markPayInvoicePaid', version: approved.version, paidOn: today });
  assert.deepEqual([paid.status, paid.paidOn], ['paid', today]);
  assert.deepEqual((await notices(ANGELA, 'cleaning.invoice_paid')).map(n => n.preview), [`Paid: £85.00 (${inv.number})`]);
  await assert.rejects(act(ACCOUNTS, { action: 'markPayInvoicePaid', version: paid.version, paidOn: today }), /not paid yet/);
  // The same request again returns the same answer and changes nothing.
  await as(ACCOUNTS);
  const requestId = crypto.randomUUID();
  const [cara] = await invoicesOf(CARA);
  const first = await rpc('workspace_cleaner_pay_action', [{ action: 'approvePayInvoice', requestId, invoiceId: cara.id, version: cara.version }]);
  assert.deepEqual(await rpc('workspace_cleaner_pay_action', [{ action: 'approvePayInvoice', requestId, invoiceId: cara.id, version: cara.version }]), first);
  assert.equal((await notices(CARA, 'cleaning.invoice_approved')).length, 1);
});

test('who sees what: a cleaner their own, Accounts and admins all, a cleaning manager their cleaners read only, owners and Ready nothing', async () => {
  const [angela] = await invoicesOf(ANGELA), [ben] = await invoicesOf(BEN);
  await as(ANGELA);
  const mine = await read('invoices');
  assert.ok(mine.length >= 1 && mine.every(i => i.cleanerId === users[ANGELA]));
  const full = await read('invoice', angela.id);
  assert.deepEqual([full.number, full.cleanerName, full.status, full.totalMinor, full.lines.length, full.periodStart, full.periodEnd], [angela.number, 'Angela Cleaner', 'paid', 8500, 2, '2027-01-04', '2027-01-10']);
  assert.deepEqual(full.lines.map(l => l.propertyName).sort(), ['110 Hawk', '12 Leith St']);
  assert.ok(full.lines.every(l => l.outcome === 'completed' && l.rateMinor === l.amountMinor && typeof l.cleanOn === 'string' && !('checkoutTime' in l)));
  assert.deepEqual(full.history.map(h => h.event), ['issued', 'queried', 'approved', 'paid']);
  assert.deepEqual([full.history[1].note, full.history[1].actorName, full.history[3].paidOn], ['Was the Hawk clean a deep clean?', 'Accounts', full.paidOn]);
  await assert.rejects(read('invoice', ben.id), /Request not found/, 'not someone else\'s');
  assert.ok(!(await read('invoices', users[BEN])).length);
  await assert.rejects(read('earnings', users[BEN]), /Cleaner not found/);
  await assert.rejects(read('settings'), /access required/);
  for (const who of [ACCOUNTS, ADMIN]) {
    await as(who);
    const all = await read('invoices');
    assert.ok([users[ANGELA], users[BEN], users[CARA], users[DAN]].every(u => all.some(i => i.cleanerId === u)), roles[who]);
    assert.equal((await read('invoice', ben.id)).lines.length, 2);
    assert.equal((await read('settings')).canEdit, true);
  }
  await as(MANAGER);
  assert.equal((await read('invoice', ben.id)).number, ben.number, 'their own cleaners');
  assert.ok((await read('invoices')).some(i => i.cleanerId === users[BEN]));
  const settings = await read('settings');
  assert.equal(settings.canEdit, false);
  assert.deepEqual(settings.cleaners.find(c => c.cleanerId === users[BEN]).period, 'monthly');
  await assert.rejects(pay({ action: 'approvePayInvoice', invoiceId: ben.id, version: ben.version }), /Only Accounts and admins/, 'read only');
  await as(OTHER);
  assert.deepEqual(await read('invoices'), [], 'a cleaning manager with none of these cleaners');
  await assert.rejects(read('invoice', ben.id), /Request not found/);
  for (const who of [OWNER, READY, STAYS]) {
    await as(who);
    for (const [section, target] of [['invoices', null], ['invoice', ben.id], ['earnings', users[BEN]], ['settings', null]]) await assert.rejects(read(section, target), /Cleaner pay access required/, `${roles[who]} ${section}`);
  }
  // The tables are not open to anyone directly.
  await as(ANGELA);
  for (const table of ['workspace_clean_earnings', 'workspace_cleaner_pay_periods', 'workspace_cleaner_pay_period_history', 'workspace_cleaner_invoice_numbers']) await assert.rejects(db.query(`select * from private.${table}`), /permission denied/, table);
  // Only the backend runs the period end.
  await assert.rejects(rpc('workspace_cleaner_invoice_run'), /permission denied/);
  await as('backend');
  assert.equal(typeof (await rpc('workspace_cleaner_invoice_run')).invoices, 'number');
  // Owners never see the invoice notices in their feed.
  await as(OWNER);
  const feed = await rpc('workspace_controls_read', ['notifications', null, null]);
  assert.ok(!JSON.stringify(feed).includes('cleaning.invoice'));
});

test('earnings: paid this month and this year, waiting to be paid, and projected if all the cleans are accepted', async () => {
  // Angela, weekly at £45 now: one clean accepted and not invoiced yet, one waiting in review and one assigned this week.
  const waiting = await accepted(ANGELA);
  await owner("update private.workspace_clean_earnings set clean_on=current_date,accepted_at=now() where work_id=$1", [waiting]);
  const inReview = await submitted(ANGELA, hawk, await inDays(0));
  await as(MANAGER);
  const upcoming = await operation({ action: 'createOperation', propertyId: leith, kind: 'cleaning', data: { dueOn: await inDays(0), checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [upcoming.workId, upcoming.version, users[ANGELA]]);
  // A second invoice for Angela, approved and not paid.
  const [{ id: extra }] = await owner(`insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,created_by,request_id,status,number,generated,due_on)
    values('Angela Cleaner',$1,'RC-RFI-2027-0900',current_date,6000,$1,gen_random_uuid(),'approved','RC-RFI-2027-0900',true,current_date) returning id`, [users[ANGELA]]);
  await as(ANGELA);
  const e = await read('earnings');
  assert.deepEqual([e.paidThisMonthMinor, e.paidThisYearMinor, e.waitingMinor, e.waitingApprovedMinor, e.periodKind], [8500, 8500, 6000, 6000, 'weekly']);
  assert.equal(e.acceptedNotInvoicedMinor, 4500);
  assert.equal(e.upcomingCount, 2, 'the clean in review and the one assigned');
  assert.equal(e.projectedMinor, 4500 + 2 * 4500);
  assert.ok(inReview.workId);
  // The cleaner's Home: pay this month, waiting and projected.
  const home = await rpc('workspace_role_home', [null]);
  assert.deepEqual([home.payPaidThisMonthMinor, home.payWaitingMinor, home.payProjectedMinor], [8500, 6000, 13500]);
  assert.ok('doneThisMonth' in home && 'toRespond' in home && 'cleansToday' in home, 'the existing keys stay');
  // Accounts' Home: what waits for approval and payment.
  await as(ACCOUNTS);
  const accounts = await rpc('workspace_role_home', [null]);
  const [{ n, minor }] = await owner("select count(*)::int n,coalesce(sum(coalesce(pay_minor,total_minor)),0)::int minor from private.workspace_cleaner_invoices where status='to_approve'");
  assert.deepEqual([accounts.cleanerInvoicesToApprove, accounts.cleanerInvoicesToApproveMinor], [n, minor]);
  const [{ pn, pm }] = await owner("select count(*)::int pn,coalesce(sum(coalesce(pay_minor,total_minor)),0)::int pm from private.workspace_cleaner_invoices where status='approved' and paid_on is null");
  assert.deepEqual([accounts.cleanerInvoicesToPay, accounts.cleanerInvoicesToPayMinor], [pn, pm]);
  assert.ok(accounts.cleanerInvoicesDueThisWeek >= 1);
  assert.ok('expensesToApprove' in accounts && 'payoutsReceivedMinor' in accounts);
  await owner('update private.workspace_cleaner_invoices set status=$2 where id=$1', [extra, 'rejected']);
});

test('the cleaner\'s invoice notices go to the phone only, never by email', { skip: phoneOnly ? false : 'needs 20261021900000_cleaner_notices_phone_only.sql (on the lead branch)' }, async () => {
  await owner("insert into private.workspace_device_tokens(user_id,device_id,push_token,platform) values($1,gen_random_uuid(),'ExponentPushToken[pay-test]','ios') on conflict do nothing", [users[ANGELA]]);
  for (let i = 0; i < 60; i++) { const jobs = await owner('select private.integration_claim_notifications(true,true) j'); if (!jobs[0].j.length) break; }
  const deliveries = await owner(`select d.channel from private.workspace_notification_deliveries d join private.workspace_notification_outbox o on o.id=d.outbox_id join public.workspace_activity a on a.id=o.event_id
    where o.user_id=$1 and a.event_type like 'cleaning.invoice%'`, [users[ANGELA]]);
  assert.ok(deliveries.some(d => d.channel === 'push'), 'a push');
  assert.ok(!deliveries.some(d => d.channel === 'email'), 'no email');
});

test('outcomes: management and the cleaner\'s cleaning manager set them while the request waits; each re-totals it and is kept in its history', async () => {
  // The rule: completed (or none set) the full rate, partially successful half rounded half a penny up, unsuccessful nothing.
  const rule = await owner("select private.workspace_clean_outcome_minor(4500,null) a,private.workspace_clean_outcome_minor(4500,'completed') b,private.workspace_clean_outcome_minor(4500,'partial') c,private.workspace_clean_outcome_minor(4525,'partial') d,private.workspace_clean_outcome_minor(1,'partial') e,private.workspace_clean_outcome_minor(4500,'unsuccessful') f");
  assert.deepEqual(Object.values(rule[0]).map(Number), [4500, 4500, 2250, 2263, 1, 0]);
  const [ben] = await invoicesOf(BEN);
  assert.equal(ben.status, 'to_approve');
  const [{ one: first, two: second }] = await owner("select (array_agg(l.work_id order by e.clean_on))[1] one,(array_agg(l.work_id order by e.clean_on))[2] two from private.workspace_cleaner_invoice_lines l join private.workspace_clean_earnings e on e.work_id=l.work_id where l.invoice_id=$1", [ben.id]);
  const set = (who, workId, outcome, version, invoiceId = ben.id) => as(who).then(() => pay({ action: 'setPayLineOutcome', invoiceId, workId, outcome, version }));
  for (const who of [ACCOUNTS, STAYS, BEN, OWNER, READY]) await assert.rejects(set(who, first, 'partial', ben.version), /Only management and cleaning managers/, roles[who]);
  await assert.rejects(set(OTHER, first, 'partial', ben.version), /Request not found/, 'a cleaning manager without this cleaner');
  await assert.rejects(set(MANAGER, first, 'excellent', ben.version), /Choose Completed, Partially successful or Unsuccessful/);
  await assert.rejects(set(MANAGER, crypto.randomUUID(), 'partial', ben.version), /not on this request/);
  const line = (r, w) => r.lines.find(l => l.workId === w);
  const partial = await set(MANAGER, first, 'partial', ben.version);
  assert.equal(partial.version, ben.version + 1);
  assert.deepEqual([line(partial, first).outcome, line(partial, first).rateMinor, line(partial, first).amountMinor, line(partial, second).outcome, partial.totalMinor], ['partial', 3550, 1775, 'completed', 1775 + 3550]);
  await assert.rejects(set(ADMIN, second, 'unsuccessful', ben.version), /changed by someone else/);
  const none = await set(ADMIN, second, 'unsuccessful', partial.version);
  assert.deepEqual([line(none, second).amountMinor, none.totalMinor], [0, 1775]);
  assert.equal((await set(ADMIN, second, 'unsuccessful', none.version)).version, none.version, 'the same outcome again changes nothing');
  // Every clean unsuccessful: nothing to invoice, and that is allowed.
  const zero = await set(ADMIN, first, 'unsuccessful', none.version);
  assert.equal(zero.totalMinor, 0);
  const back = await set(MANAGER, first, 'completed', zero.version);
  assert.equal(back.totalMinor, 3550);
  // The cleaner reads the outcomes and the history; a line never set reads as completed.
  await as(BEN);
  const mine = await read('invoice', ben.id);
  assert.deepEqual(mine.lines.map(l => l.outcome), ['completed', 'unsuccessful']);
  const steps = mine.history.filter(h => h.event === 'outcome');
  assert.deepEqual(steps.map(h => [h.actorName, h.from, h.to, h.amountMinor, h.totalMinor]), [
    ['Manager', 'completed', 'partial', 1775, 5325], ['Admin', 'completed', 'unsuccessful', 0, 1775], ['Admin', 'partial', 'unsuccessful', 0, 0], ['Manager', 'unsuccessful', 'completed', 3550, 3550]]);
  assert.deepEqual([steps[0].propertyName, steps[0].cleanOn, steps[0].workId], ['12 Leith St', '2027-02-03', first]);
  assert.equal(mine.history[0].event, 'issued');
  // Accounts' older view and the clean's cost use what the clean earns.
  const [{ view }] = await owner('select private.workspace_cleaner_invoice_view(i) view from private.workspace_cleaner_invoices i where i.id=$1', [ben.id]);
  assert.equal(view.totalMinor, 3550);
  assert.deepEqual(view.lines.map(l => [l.outcome, l.amountMinor, l.rateMinor]).sort(), [['completed', 3550, 3550], ['unsuccessful', 0, 3550]]);
  assert.equal(Number((await owner('select private.workspace_clean_cost($1) c', [second]))[0].c), 0);
  // Approved at the amount to invoice; then the outcomes are fixed.
  await as(ACCOUNTS);
  const approved = await pay({ action: 'approvePayInvoice', invoiceId: ben.id, version: back.version });
  assert.equal(approved.totalMinor, 3550);
  assert.deepEqual((await notices(BEN, 'cleaning.invoice_approved')).map(n => n.preview), [`Request approved: ${ben.number}, £35.50`]);
  await assert.rejects(set(ADMIN, first, 'partial', approved.version), /waits for approval/);
  // An invoice Accounts recorded by hand has no outcomes.
  const [{ id: manual, version: manualVersion }] = await owner("select id,version from private.workspace_cleaner_invoices where reference='DAN-APRIL'");
  const [{ work_id: manualClean }] = await owner('select work_id from private.workspace_cleaner_invoice_lines where invoice_id=$1', [manual]);
  await assert.rejects(set(ADMIN, manualClean, 'partial', manualVersion, manual), /only for requests for invoice/);
});

test('safe to run twice, and nothing in the migration drops or deletes', async () => {
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  const [{ def }] = await owner("select pg_get_functiondef('private.workspace_role_home(text)'::regprocedure) def");
  for (const sentinel of ['Requests for invoice (20261022000000): the cleaner\'s own pay', 'Requests for invoice (20261022000000): what waits for approval and payment']) assert.equal(def.split(sentinel).length - 1, 1, sentinel);
  const [{ view }] = await owner("select pg_get_functiondef('private.workspace_cleaner_invoice_view(private.workspace_cleaner_invoices)'::regprocedure) view");
  for (const sentinel of ['Requests for invoice (20261022000000): amount to invoice', 'Requests for invoice (20261022000000): outcome']) assert.equal(view.split(sentinel).length - 1, 1, sentinel);
  const text = await fs.readFile(MIGRATION, 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF line endings');
});
