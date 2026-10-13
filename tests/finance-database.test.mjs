import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'cleans', 'client', 'cleaning_manager', 'accounts', 'admin', 'client'];
const users = roles.map((_, i) => `81000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, STAYS, CLEANER, OWNER, MANAGER, ACCOUNTS, ADMIN, OTHER_OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `finance${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('8100', '8200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('8100', '8200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Finance ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('8100', '8200') })]);
  await db.exec('set role authenticated');
}
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, { propertyId = null, period = null, id = null, status = null } = {}) => rpc('workspace_finance_read', [section, propertyId, period, id, status]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const month = (await db.query("select to_char(current_date,'YYYY-MM') m, (date_trunc('month',current_date)+interval '2 days')::date::text d")).rows[0];

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Finance test property' }]);
const otherProperty = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Other owner property' }]);
for (const [user, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [OWNER, 'client'], [MANAGER, 'cleaning_manager']]) await rpc('workspace_assign_property', [property, users[user], kind]);
await rpc('workspace_assign_property', [otherProperty, users[OTHER_OWNER], 'client']);
await rpc('workspace_save_property_details', [property, 1, 'access', { accessInstructions: 'Door code for assigned staff only' }]);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

async function reservation(reference, offsetDays, nights) {
  await as(STAYS);
  const checkIn = (await db.query(`select ($1::date+$2::int)::text d`, [month.d, offsetDays])).rows[0].d;
  const checkOut = (await db.query(`select ($1::date+$2::int)::text d`, [checkIn, nights])).rows[0].d;
  await operation({ action: 'recordReservation', propertyId: property, reference, checkIn, checkOut, status: 'confirmed' });
  return (await rpc('workspace_controls_read', ['reservations', property, null])).find(r => r.reference === reference);
}

test('accounts is a valid role with portfolio-wide finance access but no entry details', async () => {
  await as(ACCOUNTS);
  const visible = (await db.query('select id from public.workspace_properties')).rows.map(r => r.id);
  assert.ok(visible.includes(property) && visible.includes(otherProperty));
  await assert.rejects(rpc('workspace_property_details', [property, 'access']), /Property access denied/);
  await assert.rejects(rpc('workspace_property_details', [property, 'ota']), /OTA access denied/);
  assert.deepEqual(await rpc('workspace_property_details', [property, 'finance']), {});
  await as(STAYS); await assert.rejects(read('expenses'), /Accounts access required/);
  await as(OWNER); await assert.rejects(read('expenses'), /Accounts access required/);
  await db.exec('reset role');
  await assert.rejects(db.query("update public.workspace_profiles set role='bookkeeper' where user_id=$1", [users[ACCOUNTS]]), /role_check/);
});

test('statement terms are set by management only and are never assumed', async () => {
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: property, managementFeeBps: 1500, cleaningCostMinor: 6500 }), /Management access required/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: property, period: month.m }), /management fee and cleaning cost/);
  await as(ADMIN);
  await assert.rejects(finance({ action: 'setStatementTerms', propertyId: property, managementFeeBps: 10001, cleaningCostMinor: 6500 }), /Invalid management fee/);
  const terms = await finance({ action: 'setStatementTerms', propertyId: property, managementFeeBps: 1500, cleaningCostMinor: 6500 });
  assert.deepEqual(terms, { propertyId: property, managementFeeBps: 1500, cleaningCostMinor: 6500 });
});

test('expenses need an invoice and proof, respect the approval limit and queue for Xero', async () => {
  await as(OWNER);
  await assert.rejects(finance({ action: 'createExpense', propertyId: property, supplier: 'Example Plumbing', reference: 'INV-1', category: 'maintenance', description: 'Kitchen tap replaced', amountMinor: 18500, receivedOn: month.d, source: 'email' }), /Expense access denied/);
  await as(ACCOUNTS);
  const input = { action: 'createExpense', requestId: crypto.randomUUID(), propertyId: property, supplier: 'Example Plumbing', reference: 'INV-1', category: 'maintenance', description: 'Kitchen tap replaced', amountMinor: 18500, receivedOn: month.d, source: 'email', sender: 'accounts@plumbing.example' };
  let expense = await rpc('workspace_finance_action', [input]);
  assert.deepEqual(await rpc('workspace_finance_action', [input]), expense);
  await assert.rejects(rpc('workspace_finance_action', [{ ...input, amountMinor: 1 }]), /identifier reused/);
  await assert.rejects(finance({ ...input, requestId: crypto.randomUUID() }), /duplicate key|unique/);
  await assert.rejects(finance({ action: 'approveExpense', expenseId: expense.id, version: expense.version }), /invoice and proof/);
  expense = await finance({ action: 'addExpenseEvidence', expenseId: expense.id, kind: 'invoice', label: 'Invoice INV-1.pdf', note: 'Invoice PDF received by email and checked' });
  await assert.rejects(finance({ action: 'addExpenseEvidence', expenseId: expense.id, kind: 'photo', label: 'Photo' }), /Describe the evidence/);
  await assert.rejects(finance({ action: 'approveExpense', expenseId: expense.id, version: expense.version }), /invoice and proof/);
  expense = await finance({ action: 'addExpenseEvidence', expenseId: expense.id, kind: 'report', label: 'Ready team sign-off', note: 'Ready team confirmed the tap works on site' });
  assert.equal(expense.hasInvoice && expense.hasProof, true);

  await as(SUPER);
  const policy = await read('policy');
  await finance({ action: 'setFinancePolicy', version: policy.version, expenseApprovalLimitMinor: 10000 });
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'approveExpense', expenseId: expense.id, version: expense.version }), /Management approval required/);
  await as(ADMIN);
  assert.equal((await rpc('workspace_teams_read', ['management'])).expensesOverLimit.length, 1);
  await assert.rejects(finance({ action: 'approveExpense', expenseId: expense.id, version: expense.version - 1 }), /Expense changed/);
  expense = await finance({ action: 'approveExpense', expenseId: expense.id, version: expense.version, note: 'Within the agreed repair' });
  assert.equal(expense.status, 'approved'); assert.equal(expense.xeroStatus, 'queued');
  await assert.rejects(finance({ action: 'addExpenseEvidence', expenseId: expense.id, kind: 'photo', label: 'Late photo', note: 'Added after the decision was made' }), /before a decision/);

  await as(SUPER);
  await finance({ action: 'setFinancePolicy', version: policy.version + 1, expenseApprovalLimitMinor: null });
  await as(ACCOUNTS);
  let second = await finance({ action: 'createExpense', propertyId: property, supplier: 'Example Electrical', reference: 'E-1', category: 'maintenance', description: 'Fuse board call-out', amountMinor: 9500, receivedOn: month.d, source: 'manual' });
  second = await finance({ action: 'queryExpense', expenseId: second.id, version: second.version, note: 'Please send proof of the call-out' });
  assert.equal(second.status, 'queried');
  second = await finance({ action: 'resolveExpenseQuery', expenseId: second.id, version: second.version, note: 'Supplier sent the job sheet' });
  second = await finance({ action: 'rejectExpense', expenseId: second.id, version: second.version, note: 'Duplicate of an earlier invoice' });
  assert.equal(second.status, 'rejected');
  const list = await read('expenses', { status: 'approved' });
  assert.deepEqual(list.map(e => e.reference), ['INV-1']);
  assert.equal((await read('expense', { id: expense.id })).evidence.length, 2);

  // Only the backend service can record a Xero posting.
  await assert.rejects(rpc('workspace_finance_xero_result', [expense.id, true, 'BILL-1']), /permission denied/);
  await db.exec('reset role'); await db.exec('set role service_role');
  await db.query('select public.workspace_finance_xero_result($1,true,$2)', [expense.id, 'BILL-1']);
  await db.exec('reset role');
  assert.equal((await db.query('select xero_status from private.workspace_expenses where id=$1', [expense.id])).rows[0].xero_status, 'posted');
});

test('payout reports reconcile by reservation code and owner statements follow agreed amounts', async () => {
  const airbnb = await reservation('Airbnb stay', 0, 3);
  const booking = await reservation('Booking.com stay', 5, 2);
  const direct = await reservation('Direct stay', 9, 2);
  await as(ACCOUNTS);
  await finance({ action: 'setReservationFinancials', propertyId: property, reservationId: airbnb.id, version: airbnb.version, channel: 'airbnb', channelReference: 'HMTESTCODE1', guests: 2, payoutMinor: 46000 });
  await assert.rejects(finance({ action: 'setReservationFinancials', propertyId: property, reservationId: booking.id, version: booking.version, channel: 'booking_com', guests: 2, payoutMinor: 52000 }), /Platform reservation code/);
  await finance({ action: 'setReservationFinancials', propertyId: property, reservationId: booking.id, version: booking.version, channel: 'booking_com', channelReference: '4172839560', guests: 3, payoutMinor: 52000 });
  await finance({ action: 'setReservationFinancials', propertyId: property, reservationId: direct.id, version: direct.version, channel: 'direct', guests: 2, payoutMinor: 61000 });
  await as(OWNER);
  await assert.rejects(finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'x.csv', lines: [{ reference: 'HMTESTCODE1', amountMinor: 1 }] }), /Accounts access required/);

  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'bad.csv', lines: [{ reference: 'A', amountMinor: 1.5 }] }), /Invalid payout line/);
  await assert.rejects(finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'bad.csv', lines: [{ reference: 'A', amountMinor: 1 }, { reference: 'a', amountMinor: 2 }] }), /Combine repeated/);
  const lines = [{ reference: 'HMTESTCODE1', amountMinor: 44500 }, { reference: 'HMUNKNOWN99', amountMinor: 7000 }];
  const report = await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-payouts.csv', lines });
  assert.equal(report.lineCount, 2); assert.equal(report.matchedReservations, 1); assert.equal(report.unexpectedLines, 1);
  await assert.rejects(finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'copy.csv', lines: [...lines].reverse() }), /already been uploaded/);

  let rec = await read('reconciliation', { period: month.m });
  const state = id => rec.rows.find(r => r.reservationId === id).state;
  assert.equal(state(airbnb.id), 'different'); assert.equal(state(booking.id), 'missing');
  assert.equal(rec.unexpected.length, 1);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: property, period: month.m }), /Reconcile every stay/);

  const airbnbRow = rec.rows.find(r => r.reservationId === airbnb.id);
  await finance({ action: 'agreePayout', reservationId: airbnb.id, version: airbnbRow.version, agreedMinor: 44500, note: 'Airbnb resolution adjustment of £15 accepted' });
  const bookingRow = rec.rows.find(r => r.reservationId === booking.id);
  await finance({ action: 'agreePayout', reservationId: booking.id, version: bookingRow.version, agreedMinor: 52000, note: 'Paid in next Booking.com run, confirmed on extranet' });
  await finance({ action: 'setAsidePayoutLine', lineId: rec.unexpected[0].lineId, note: 'Belongs to a property we no longer manage' });
  rec = await read('reconciliation', { period: month.m });
  assert.equal(state(airbnb.id), 'agreed'); assert.equal(rec.unexpected.length, 0);

  // A new line for the same code makes the earlier agreement stale.
  await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'adjustment.csv', lines: [{ reference: 'HMTESTCODE1', amountMinor: 1500 }] });
  rec = await read('reconciliation', { period: month.m });
  assert.equal(state(airbnb.id), 'matched');

  // One accepted clean and one approved expense in the month.
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn: month.d, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[CLEANER]]);
  await db.exec('reset role');
  const photo = (await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning','TEST-ONLY-finance-clean',now()) returning id", [property, clean.workId, users[CLEANER]])).rows[0].id;
  await as(CLEANER);
  let current = (await rpc('workspace_operations_read', [property])).find(w => w.workId === clean.workId);
  current = await operation({ action: 'updateOperation', workId: clean.workId, version: current.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [photo] } });
  await as(MANAGER);
  await operation({ action: 'updateOperation', workId: clean.workId, version: current.version, step: 'reviewCleaning', data: { accepted: true, guestFeedback: 'No guest comments', reviewNote: 'Photos checked' } });

  await as(ACCOUNTS);
  let statement = await finance({ action: 'prepareStatement', propertyId: property, period: month.m });
  assert.equal(statement.revenueMinor, 46000 + 52000 + 61000);
  assert.equal(statement.cleaningCount, 1); assert.equal(statement.cleaningMinor, 6500);
  assert.equal(statement.expensesMinor, 18500);
  // The fee is charged after platform fees and changeovers (client answer 1): (159000 - 6500) x 15%.
  assert.equal(statement.feeMinor, Math.round((159000 - 6500) * 0.15));
  assert.equal(statement.payoutMinor, 159000 - 6500 - 18500 - Math.round((159000 - 6500) * 0.15));
  assert.equal(statement.detail.stays.length, 3);
  statement = await finance({ action: 'prepareStatement', propertyId: property, period: month.m });
  assert.equal(statement.version, 2);

  await as(OWNER); assert.deepEqual(await read('statements'), []);
  await as(ACCOUNTS);
  statement = await finance({ action: 'issueStatement', statementId: statement.id, version: statement.version });
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: property, period: month.m }), /has been issued/);
  await assert.rejects(finance({ action: 'agreePayout', reservationId: booking.id, version: bookingRow.version, agreedMinor: 1, note: 'Late change attempt' }), /Void the issued statement/);
  await as(OWNER);
  assert.equal((await read('statements')).length, 1);
  await as(OTHER_OWNER); assert.deepEqual(await read('statements'), []);
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'recordOwnerPayout', statementId: statement.id, version: statement.version, method: 'stripe', reference: 'tr_1' }), /Stripe payouts are not connected/);
  await assert.rejects(finance({ action: 'voidStatement', statementId: statement.id, version: statement.version, reason: 'Accounts cannot void issued' }), /Management must void/);
  statement = await finance({ action: 'recordOwnerPayout', statementId: statement.id, version: statement.version, method: 'bank_transfer', reference: 'BACS 0001' });
  assert.equal(statement.status, 'paid');
  await as(ADMIN);
  await assert.rejects(finance({ action: 'voidStatement', statementId: statement.id, version: statement.version, reason: 'Trying to void paid' }), /cannot be voided/);
  const overview = await (async () => { await as(ACCOUNTS); return read('overview', { period: month.m }); })();
  assert.equal(overview.statements.paid, 1); assert.equal(overview.unsettledPayouts, 0);
});
