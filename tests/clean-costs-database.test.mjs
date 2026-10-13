import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Clean costs and statement terms (20261012090000): the VAT and clean-charge switches on a property's
// terms, cleaner invoices (the total must equal the lines, a clean on at most one live invoice, decisions
// that can be repeated safely), the review of a clean that cost more than agreed (stale once its cost
// changes), and owners and cleaners seeing none of it.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['super_admin', 'admin', 'accounts', 'client', 'cleans', 'cleans', 'stays'];
const users = roles.map((_, i) => `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, OWNER, CLEANER_A, CLEANER_B, STAYS] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `cleancost${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('c100', 'c200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('c100', 'c200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('c100', 'c200') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const payables = input => rpc('workspace_payables_action', [{ requestId: crypto.randomUUID(), ...input }]);
const report = (section, { propertyId = null, id = null, from = null, to = null, filters = null } = {}) => rpc('workspace_finance_report', [section, propertyId, id, from, to, filters]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Clean cost flat' }]);
const OTHER = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Second cottage' }]);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);
await rpc('workspace_assign_property', [HOME, users[CLEANER_A], 'cleaner']);
await rpc('workspace_assign_property', [HOME, users[CLEANER_B], 'cleaner']);

// Billable cleans (accepted, completed), as the database itself.
async function clean(prop, dueOn, cleaner, { status = 'completed', phase = 'accepted' } = {}) {
  const [w] = await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,assignee_id,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Clean',$2,$3,$4,$5) returning id", [prop, status, dueOn, users[cleaner], users[ADMIN]]);
  await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning',$2::jsonb)", [w.id, JSON.stringify({ phase })]);
  return w.id;
}
await sql('insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values($1,5500,$3),($2,5800,$3)', [users[CLEANER_A], users[CLEANER_B], users[ADMIN]]);
const C1 = await clean(HOME, '2026-09-08', CLEANER_A);
const C2 = await clean(HOME, '2026-09-15', CLEANER_B);
const C3 = await clean(HOME, '2026-09-22', CLEANER_A);
const C_OTHER = await clean(OTHER, '2026-09-10', CLEANER_A);
const NOT_A_CLEAN = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,created_by) values(gen_random_uuid(),$1,'stays-maintenance-reporting','Fix the tap','waiting',$2) returning id", [HOME, users[ADMIN]]))[0].id;
const expenseCount = async () => Number((await sql('select count(*) n from private.workspace_expenses'))[0].n);

test('statement terms gain the VAT and clean-charge switches; older callers keep their reply', async () => {
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true }), /Management access required/);
  await as(ADMIN);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: 'yes' }), /VAT is charged/);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, cleanChargeMode: 'cheapest' }), /how cleans are charged/);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, surprise: 1 }), /Unknown or oversized/);
  const set = await finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee' });
  assert.deepEqual(set, { propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee', vatRateBps: 2000 });
  // The old shape changes the fee and cleaning cost only, and replies as before.
  const old = await finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1200, cleaningCostMinor: 6000 });
  assert.deepEqual(old, { propertyId: HOME, managementFeeBps: 1200, cleaningCostMinor: 6000 });
  assert.deepEqual(await sql('select management_fee_bps,vat_on_fee,clean_charge_mode from private.workspace_property_financials where property_id=$1', [HOME]), [{ management_fee_bps: 1200, vat_on_fee: true, clean_charge_mode: 'agreed_fee' }]);
  await as(ADMIN);
  await finance({ action: 'setStatementTerms', propertyId: HOME, managementFeeBps: 1500, cleaningCostMinor: 6000 });
  await finance({ action: 'setStatementTerms', propertyId: OTHER, managementFeeBps: 1500, cleaningCostMinor: 6000 });
  assert.equal((await sql('select private.workspace_vat_bps() v'))[0].v, 2000);
  await as(ACCOUNTS);
  const list = await rpc('workspace_finance_read', ['statements', null, '2026-09', null, null]);
  assert.deepEqual(list.find(p => p.propertyId === HOME).terms, { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee', vatRateBps: 2000, visitorLevy: { enabled: false, rateBps: 500, nightCap: null, from: null, feeAfterLevy: true } });
  assert.deepEqual(list.find(p => p.propertyId === OTHER).terms, { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: false, cleanChargeMode: 'agreed_fee', vatRateBps: 2000, visitorLevy: { enabled: false, rateBps: 500, nightCap: null, from: null, feeAfterLevy: true } });
});

test('a cleaner invoice must add up, and each line must be a real clean of this cleaner the reader can finance', async () => {
  const before = await expenseCount();
  await as(ACCOUNTS);
  const base = { action: 'recordCleanerInvoice', supplier: 'Bea Cleans Ltd', cleanerId: users[CLEANER_B], reference: 'B-101', invoiceDate: '2026-09-30' };
  await assert.rejects(payables({ ...base, totalMinor: 7000, lines: [{ workId: C2, amountMinor: 7500 }] }), /total must equal its lines/);
  for (const bad of [0, -1, 1.5, '7500', 20000000]) await assert.rejects(payables({ ...base, totalMinor: 7500, lines: [{ workId: C2, amountMinor: bad }] }), /Invalid invoice line 1/);
  await assert.rejects(payables({ ...base, totalMinor: 0, lines: [{ workId: C2, amountMinor: 1 }] }), /invoice total/);
  await assert.rejects(payables({ ...base, totalMinor: 7500, lines: [] }), /between 1 and 200/);
  await assert.rejects(payables({ ...base, totalMinor: 7500, lines: [{ workId: NOT_A_CLEAN, amountMinor: 7500 }] }), /clean on the schedule/);
  await assert.rejects(payables({ ...base, totalMinor: 7500, lines: [{ workId: crypto.randomUUID(), amountMinor: 7500 }] }), /clean on the schedule/);
  await assert.rejects(payables({ ...base, totalMinor: 5500, lines: [{ workId: C1, amountMinor: 5500 }] }), /not done by this cleaner/);
  await assert.rejects(payables({ ...base, totalMinor: 15000, lines: [{ workId: C2, amountMinor: 7500 }, { workId: C2, amountMinor: 7500 }] }), /on the invoice twice/);
  await assert.rejects(payables({ ...base, cleanerId: users[STAYS], totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] }), /Choose a cleaner/);
  await assert.rejects(payables({ ...base, invoiceDate: '2026-02-30', totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] }), /Enter the invoice date/);
  await assert.rejects(payables({ ...base, supplier: 'B', totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] }), /Invalid field supplier/);

  const input = { ...base, requestId: crypto.randomUUID(), totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] };
  const invoice = await rpc('workspace_payables_action', [input]);
  assert.equal(invoice.status, 'to_approve'); assert.equal(invoice.totalMinor, 7500); assert.equal(invoice.cleanerName, 'Person 5');
  assert.deepEqual([invoice.supplier, invoice.invoiceDate, invoice.lineCount, invoice.lines[0].cleanDate], ['Bea Cleans Ltd', '2026-09-30', 1, '2026-09-15']);
  assert.deepEqual(invoice.lines.map(l => [l.workId, l.amountMinor, l.live, l.agreedMinor, l.overAgreed]), [[C2, 7500, true, 6000, true]]);
  assert.deepEqual(await rpc('workspace_payables_action', [input]), invoice, 'the same request replays its reply');
  await assert.rejects(rpc('workspace_payables_action', [{ ...input, totalMinor: 7600 }]), /identifier reused/);
  // A clean is on at most one live invoice.
  await assert.rejects(payables({ ...base, reference: 'B-102', totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] }), /already on another invoice/);
  const later = await clean(HOME, '2026-09-28', CLEANER_B);
  await as(ACCOUNTS);
  await assert.rejects(payables({ ...base, totalMinor: 100, lines: [{ workId: later, amountMinor: 100 }] }), /already been recorded/);
  await asDb();
  await assert.rejects(db.query('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor) values($1,$2,$3,1)', [invoice.id, C2, HOME]), /duplicate key|unique/);
  assert.equal(await expenseCount(), before, 'cleaner invoices never become expenses');
});

test('deciding an invoice can be repeated safely; a rejected invoice frees its cleans', async () => {
  await as(ACCOUNTS);
  // The screen's shape: the supplier as written on the invoice, no cleaner profile.
  const first = await payables({ action: 'recordCleanerInvoice', supplier: 'Ann Cleaning', reference: 'A-1', invoiceDate: '2026-09-30', totalMinor: 11000, lines: [{ workId: C1, amountMinor: 5500 }, { workId: C3, amountMinor: 5500 }] });
  await assert.rejects(payables({ action: 'decideCleanerInvoice', invoiceId: first.id, version: first.version, decision: 'pay' }), /approve or reject/);
  await assert.rejects(payables({ action: 'decideCleanerInvoice', invoiceId: first.id, version: first.version + 1, decision: 'approve' }), /Invoice changed/);
  assert.equal(first.cleanerId, null);
  const approved = await payables({ action: 'decideCleanerInvoice', invoiceId: first.id, decision: 'approve' });
  assert.equal(approved.status, 'approved'); assert.equal(approved.version, first.version + 1);
  // The same decision again, even from an old screen, changes nothing.
  const again = await payables({ action: 'decideCleanerInvoice', invoiceId: first.id, version: first.version, decision: 'approve' });
  assert.deepEqual(again, approved);
  await assert.rejects(payables({ action: 'decideCleanerInvoice', invoiceId: first.id, version: approved.version, decision: 'reject', note: 'Changed my mind' }), /already been decided/);

  const other = await payables({ action: 'recordCleanerInvoice', supplier: 'Ann Cleaning', cleanerId: users[CLEANER_A], reference: 'A-2', invoiceDate: '2026-09-30', totalMinor: 9000, lines: [{ workId: C_OTHER, amountMinor: 9000 }] });
  await assert.rejects(payables({ action: 'decideCleanerInvoice', invoiceId: other.id, version: other.version, decision: 'reject' }), /Invalid field note/);
  const rejected = await payables({ action: 'decideCleanerInvoice', invoiceId: other.id, version: other.version, decision: 'reject', note: 'Wrong amount, asked for a new invoice' });
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.lines[0].live, false);
  assert.deepEqual(await payables({ action: 'decideCleanerInvoice', invoiceId: other.id, version: other.version, decision: 'reject', note: 'Wrong amount, asked for a new invoice' }), rejected);
  // The clean is free again: a corrected invoice, even with the same reference.
  const corrected = await payables({ action: 'recordCleanerInvoice', supplier: 'Ann Cleaning', cleanerId: users[CLEANER_A], reference: 'A-2', invoiceDate: '2026-09-30', totalMinor: 5500, lines: [{ workId: C_OTHER, amountMinor: 5500 }] });
  assert.equal(corrected.status, 'to_approve');
  const listed = await report('cleanerInvoices', { filters: { cleanerId: users[CLEANER_A] } });
  assert.deepEqual(listed.invoices.map(i => [i.reference, i.status]).sort(), [['A-2', 'rejected'], ['A-2', 'to_approve']]);
  assert.equal(listed.toApproveMinor, 5500);
  assert.equal((await report('cleanerInvoices', { filters: { status: 'approved' } })).invoices[0].reference, 'A-1');
  assert.deepEqual((await report('cleanerInvoices', { propertyId: OTHER })).invoices.map(i => i.status).sort(), ['rejected', 'to_approve']);
  await assert.rejects(report('cleanerInvoices', { filters: { status: 'paid' } }), /Invalid report filters/);
});

test('a clean that cost more than agreed is reviewed with a note; the review goes stale when the cost changes', async () => {
  await as(ACCOUNTS);
  // C2 has a live invoice line of 7500 against the agreed 6000; C1 and C3 cost 5500.
  let toReview = await report('cleansToReview', { propertyId: HOME, from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(toReview.cleans.map(c => [c.workId, c.agreedMinor, c.actualMinor, c.costSource, c.state, c.cleanDate, c.propertyName, c.cleanerName]), [[C2, 6000, 7500, 'invoice', 'flagged', '2026-09-15', 'Clean cost flat', 'Person 5']]);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: C1, decision: 'agreed_fee', note: 'Nothing to review here' }), /cost more than agreed/);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: C2, decision: 'free', note: 'Not a real choice' }), /agreed fee or the actual cost/);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'no' }), /Invalid field note/);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: NOT_A_CLEAN, decision: 'agreed_fee', note: 'Not a clean at all' }), /Clean not found/);
  const reviewed = await payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Deep clean after a party; our cost' });
  assert.deepEqual([reviewed.reviewed, reviewed.state, reviewed.decision, reviewed.note, reviewed.reviewVersion], [true, 'reviewed', 'agreed_fee', 'Deep clean after a party; our cost', 1]);
  // The same review again changes nothing.
  assert.deepEqual(await payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Deep clean after a party; our cost' }), reviewed);
  assert.equal((await report('cleansToReview', { propertyId: HOME, filters: { state: 'toReview' } })).count, 0);
  assert.equal((await report('cleansToReview', { propertyId: HOME, filters: { state: 'reviewed' } })).count, 1);
  let statements = await rpc('workspace_finance_read', ['statements', HOME, '2026-09', null, null]);
  assert.equal(statements[0].cleansToReview, 0);

  // The cost changes: the invoice is rejected and a dearer one arrives. The review is stale.
  const [invoice] = await sql("select i.id,i.version from private.workspace_cleaner_invoices i where i.reference='B-101'");
  await as(ACCOUNTS);
  await payables({ action: 'decideCleanerInvoice', invoiceId: invoice.id, version: invoice.version, decision: 'reject', note: 'Superseded by B-101a' });
  // Back to the cleaner's rate (5800): not over the agreed value, so nothing to review.
  assert.equal((await report('cleansToReview', { propertyId: HOME, filters: { state: 'all' } })).count, 0);
  await payables({ action: 'recordCleanerInvoice', supplier: 'Bea Cleans Ltd', cleanerId: users[CLEANER_B], reference: 'B-101a', invoiceDate: '2026-09-30', totalMinor: 8000, lines: [{ workId: C2, amountMinor: 8000 }] });
  toReview = await report('cleansToReview', { propertyId: HOME, filters: { state: 'toReview' } });
  assert.deepEqual(toReview.cleans.map(c => [c.workId, c.actualMinor, c.reviewed, c.state, c.reviewedActualMinor, c.decision]), [[C2, 8000, false, 'stale', 7500, 'agreed_fee']]);
  assert.equal(toReview.toReviewCount, 1);
  await assert.rejects(report('cleansToReview', { filters: { state: 'later' } }), /Invalid report filters/);
  assert.equal((await report('cleansToReview', { filters: { region: 'Nowhere at all' } })).count, 0);
  statements = await rpc('workspace_finance_read', ['statements', HOME, '2026-09', null, null]);
  assert.equal(statements[0].cleansToReview, 1);
  const again = await payables({ action: 'reviewCleanCost', workId: C2, decision: 'actual_cost', note: 'Owner agreed to pay the deep clean' });
  assert.deepEqual([again.reviewed, again.state, again.decision, again.reviewVersion], [true, 'reviewed', 'actual_cost', 2]);

  // Locked once an issued statement covers the clean's day.
  await sql(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,'2026-09-01','issued',0,0,0,0,1500,0,0,'{"stays":[],"expenses":[]}'::jsonb,$2,now())`, [HOME, users[ADMIN]]);
  await as(ACCOUNTS);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Too late to change this' }), /Void the issued statement/);
  await sql("update private.workspace_owner_statements set status='void',void_reason='Test only' where property_id=$1", [HOME]);
});

test('owners, cleaners and Stays see no cleaner costs, invoices or reviews', async () => {
  for (const who of [OWNER, CLEANER_A, STAYS]) {
    await as(who);
    await assert.rejects(payables({ action: 'recordCleanerInvoice', supplier: 'Someone', reference: 'X', invoiceDate: '2026-09-30', totalMinor: 1, lines: [{ workId: C1, amountMinor: 1 }] }), /Accounts access required/);
    await assert.rejects(payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Trying to review it' }), /Accounts access required/);
    for (const section of ['cleanerInvoices', 'cleansToReview']) await assert.rejects(report(section), /Accounts access required/);
    for (const table of ['workspace_cleaner_invoices', 'workspace_cleaner_invoice_lines', 'workspace_clean_cost_reviews']) await assert.rejects(db.query(`select * from private.${table}`), /permission denied/);
    await assert.rejects(db.query('select private.workspace_clean_cost($1)', [C2]), /permission denied/);
  }
  await asDb();
  const callable = await db.query(`select p.proname,has_function_privilege('authenticated',p.oid,'execute') ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('workspace_clean_cost','workspace_clean_review_state','workspace_record_cleaner_invoice','workspace_decide_cleaner_invoice','workspace_review_clean_cost',
     'workspace_set_statement_terms','workspace_report_cleaner_invoices','workspace_report_cleans_to_review','workspace_cleaner_invoice_view','workspace_payables_action','workspace_vat_bps') order by 1`);
  assert.deepEqual(callable.rows.filter(r => r.ok).map(r => r.proname), ['workspace_payables_action'], 'only the router is callable, through the public wrapper');
  assert.equal((await db.query("select has_function_privilege('anon','public.workspace_payables_action(jsonb)','execute') ok")).rows[0].ok, false);
  for (const table of ['workspace_cleaner_invoices', 'workspace_cleaner_invoice_lines', 'workspace_clean_cost_reviews']) {
    assert.equal((await db.query(`select relrowsecurity r from pg_class where oid='private.${table}'::regclass`)).rows[0].r, true, `${table} has RLS on`);
  }
  // Activity about cleaner invoices and reviews names no property, so it never reaches an owner's feed.
  assert.equal(Number((await db.query("select count(*) n from public.workspace_activity where event_type like 'finance.clean%' and property_id is not null")).rows[0].n), 0);
});

test('payables actions are counted against the per-person change limit and refuse unknown actions', async () => {
  await as(ACCOUNTS);
  await assert.rejects(payables({ action: 'payCleaner' }), /Unknown payables action/);
  await assert.rejects(rpc('workspace_payables_action', [{ action: 'reviewCleanCost', workId: C2 }]), /Request identifier required/);
  await asDb();
  await db.query("insert into private.workspace_write_limits(user_id,writes) values($1,60) on conflict(user_id) do update set writes=60,window_started_at=now()", [users[ACCOUNTS]]);
  await as(ACCOUNTS);
  await assert.rejects(payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'One change too many' }), /Too many changes/);
});
