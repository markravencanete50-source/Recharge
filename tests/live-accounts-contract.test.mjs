import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The live Accounts screens send these exact actions and parse these exact
// responses. Run them through the HTTP schemas and the real database functions,
// and check the screen's rules match what the database allows.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { financeActionSchema, financeReadSchema, prepareFinanceAction } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });
const roles = ['super_admin', 'admin', 'accounts', 'stays'];
const users = roles.map((_, i) => `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `accounts${i}@example.com`]);
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
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
// Each request passes the HTTP schema (and server-side preparation) first, exactly as the endpoint does.
const write = input => {
  const prepared = prepareFinanceAction(financeActionSchema.parse({ requestId: crypto.randomUUID(), ...input }));
  if ('error' in prepared) throw new Error(prepared.error);
  return rpc('workspace_finance_action', [prepared.input]);
};
const read = query => { const q = financeReadSchema.parse(query); return rpc('workspace_finance_read', [q.section, q.propertyId ?? null, q.period ?? null, q.id ?? null, q.status ?? null]); };
const day = (await db.query("select current_date::text d,to_char(current_date,'YYYY-MM') m,(date_trunc('month',current_date)+interval '1 day')::date::text first")).rows[0];

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Accounts property' }]);
// Expenses go on a second property so the statement below has a positive payout.
const expenseProperty = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Expenses property' }]);
await rpc('workspace_assign_property', [property, users[STAYS], 'staff']);

test('month helpers and money formatting', () => {
  assert.equal(live.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(live.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(live.pounds(124050), '£1,240.50');
  assert.equal(live.pounds(-2500), '−£25.00');
  assert.equal(live.pounds(null), '–');
});

test('expenses: create, attach evidence, approve within the limit, escalate above it', async () => {
  await as(SUPER);
  const policy = live.policySchema.parse(await read({ section: 'policy' }));
  await write({ action: 'setFinancePolicy', version: policy.version, expenseApprovalLimitMinor: 50000 });

  await as(ACCOUNTS);
  const limit = live.policySchema.parse(await read({ section: 'policy' })).expenseApprovalLimitMinor;
  assert.equal(limit, 50000);
  const create = (supplier, amountMinor) => write({ action: 'createExpense', propertyId: expenseProperty, supplier, reference: 'INV-' + amountMinor, category: 'maintenance', description: 'Replaced the kitchen tap', amountMinor, receivedOn: day.d, source: 'manual' });
  let small = live.expenseSchema.parse(await create('Example Plumbing', 12000));
  let rule = live.expenseMoves('accounts', small, limit);
  assert.ok(!rule.moves.includes('approve') && /invoice and proof/.test(rule.blocked));
  await assert.rejects(write({ action: 'approveExpense', expenseId: small.id, version: small.version }), /Attach the invoice and proof/);

  // Evidence without an upload: the screen asks what was checked (at least 10 characters).
  assert.equal(financeActionSchema.safeParse({ action: 'addExpenseEvidence', requestId: crypto.randomUUID(), expenseId: small.id, kind: 'photo', label: 'Photo', note: 'short' }).success, false);
  await write({ action: 'addExpenseEvidence', expenseId: small.id, kind: 'invoice', label: 'Supplier invoice', note: 'Invoice PDF checked against the quote' });
  small = live.expenseSchema.parse(await write({ action: 'addExpenseEvidence', expenseId: small.id, kind: 'photo', label: 'After photo', note: 'Ready sent photos of the new tap working' }));
  const detail = live.expenseSchema.parse(await read({ section: 'expense', id: small.id }));
  assert.equal(detail.evidence.length, 2);
  rule = live.expenseMoves('accounts', detail, limit);
  assert.equal(rule.moves[0], 'approve');
  const approved = live.expenseSchema.parse(await write({ action: 'approveExpense', expenseId: small.id, version: detail.version }));
  assert.equal(approved.status, 'approved'); assert.equal(approved.xeroStatus, 'queued');

  // Above the limit: Accounts cannot approve; management can.
  let big = live.expenseSchema.parse(await create('Example Roofing', 80000));
  await write({ action: 'addExpenseEvidence', expenseId: big.id, kind: 'invoice', label: 'Invoice', note: 'Roofing invoice matches the quote' });
  big = live.expenseSchema.parse(await write({ action: 'addExpenseEvidence', expenseId: big.id, kind: 'report', label: 'Sign-off', note: 'Stays confirmed the leak has stopped' }));
  rule = live.expenseMoves('accounts', big, limit);
  assert.ok(!rule.moves.includes('approve') && /approval limit/.test(rule.blocked));
  await assert.rejects(write({ action: 'approveExpense', expenseId: big.id, version: big.version }), /Management approval required/);
  assert.equal(live.expenseMoves('admin', big, limit).moves[0], 'approve');
  await as(ADMIN);
  await write({ action: 'approveExpense', expenseId: big.id, version: big.version, note: 'Agreed with the owner' });

  // Query, then resolve, then reject.
  await as(ACCOUNTS);
  let queried = live.expenseSchema.parse(await create('Example Supplies', 4500));
  queried = live.expenseSchema.parse(await write({ action: 'queryExpense', expenseId: queried.id, version: queried.version, note: 'Which property was this for?' }));
  assert.deepEqual(live.expenseMoves('accounts', queried, limit).moves, ['resolve', 'reject', 'evidence']);
  queried = live.expenseSchema.parse(await write({ action: 'resolveExpenseQuery', expenseId: queried.id, version: queried.version, note: 'Supplier confirmed the property' }));
  assert.equal(queried.status, 'to_approve');
  await write({ action: 'rejectExpense', expenseId: queried.id, version: queried.version, note: 'Duplicate of an earlier invoice' });

  const list = live.expensesSchema.parse(await read({ section: 'expenses', status: 'approved' }));
  assert.equal(list.length, 2);
  const overview = live.overviewSchema.parse(await read({ section: 'overview', period: day.m }));
  assert.equal(overview.queuedForXero, 2);
});

test('payouts and statements: reconcile, prepare, issue and record the payout', async () => {
  await as(STAYS);
  await rpc('workspace_operations_action', [operationsActionSchema.parse({ action: 'recordReservation', requestId: crypto.randomUUID(), propertyId: property, reference: 'Live stay', checkIn: day.first, checkOut: (await db.query("select ($1::date+2)::text d", [day.first])).rows[0].d, status: 'confirmed' })]);

  await as(ACCOUNTS);
  // A new stay has no platform yet: it is listed under stays needing details and blocks the statement.
  let rec = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: day.m }));
  assert.equal(rec.rows.length, 0);
  const pending = rec.needsDetails.find(r => r.reference === 'Live stay');
  assert.equal(pending.propertyName, 'Accounts property');
  const before = live.statementsSchema.parse(await read({ section: 'statements', period: day.m })).find(s => s.propertyId === property);
  assert.equal(before.missingDetails, 1);
  assert.equal(live.overviewSchema.parse(await read({ section: 'overview', period: day.m })).missingDetails, 1);
  let row = live.payoutRowSchema.parse(await write({ action: 'setReservationFinancials', propertyId: pending.propertyId, reservationId: pending.reservationId, version: pending.version, channel: 'airbnb', channelReference: 'HMLIVE0001', guests: 2, payoutMinor: 46000 }));
  assert.equal(live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: day.m })).needsDetails.length, 0);
  assert.equal(row.state, 'missing');

  // Statement terms are management's; without them the screen offers nothing.
  let statements = live.statementsSchema.parse(await read({ section: 'statements', period: day.m }));
  let mine = statements.find(s => s.propertyId === property);
  assert.match(live.statementMoves('accounts', mine).blocked, /Management sets the fee/);
  await assert.rejects(write({ action: 'setStatementTerms', propertyId: property, managementFeeBps: 2000, cleaningCostMinor: 4500 }), /Management access required/);
  await as(ADMIN);
  await write({ action: 'setStatementTerms', propertyId: property, managementFeeBps: 2000, cleaningCostMinor: 4500 });

  // Upload the Airbnb report: received differs from expected, Accounts agrees the amount.
  await as(ACCOUNTS);
  const csv = 'Date,Type,Confirmation Code,Guest,Amount,Paid Out\n10/01/2026,Reservation,HMLIVE0001,Guest A,450.00,\n10/01/2026,Reservation,HMUNKNOWN9,Guest B,99.00,';
  const imported = await write({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb.csv', csv });
  assert.equal(imported.matchedReservations, 1); assert.equal(imported.unexpectedLines, 1);
  rec = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: day.m }));
  row = rec.rows.find(r => r.reference === 'Live stay');
  assert.equal(row.state, 'different'); assert.equal(row.receivedMinor, 45000);
  statements = live.statementsSchema.parse(await read({ section: 'statements', period: day.m }));
  mine = statements.find(s => s.propertyId === property);
  assert.match(live.statementMoves('accounts', mine).blocked, /Reconcile 1 stay/);
  await write({ action: 'agreePayout', reservationId: row.reservationId, version: row.version, agreedMinor: 45000, note: 'Airbnb host fee confirmed on the statement' });
  const unexpected = rec.unexpected.find(u => u.reference === 'HMUNKNOWN9');
  await write({ action: 'setAsidePayoutLine', lineId: unexpected.lineId, note: 'Belongs to a property we no longer manage' });
  rec = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: day.m }));
  assert.equal(rec.rows.find(r => r.reference === 'Live stay').state, 'agreed');
  assert.equal(rec.unexpected.length, 0);

  // Prepare, issue, then record the bank transfer.
  statements = live.statementsSchema.parse(await read({ section: 'statements', period: day.m }));
  mine = statements.find(s => s.propertyId === property);
  assert.deepEqual(live.statementMoves('accounts', mine).moves, ['prepare']);
  let statement = live.statementSchema.parse(await write({ action: 'prepareStatement', propertyId: property, period: day.m }));
  assert.equal(statement.revenueMinor, 45000); assert.equal(statement.feeMinor, 9000);
  assert.equal(statement.payoutMinor, 45000 - 9000 - statement.expensesMinor - statement.cleaningMinor);
  mine = live.statementsSchema.parse(await read({ section: 'statements', period: day.m })).find(s => s.propertyId === property);
  assert.deepEqual(live.statementMoves('accounts', mine).moves, ['prepare', 'issue', 'void']);
  statement = live.statementSchema.parse(await write({ action: 'issueStatement', statementId: statement.id, version: mine.statement.version }));
  mine = live.statementsSchema.parse(await read({ section: 'statements', period: day.m })).find(s => s.propertyId === property);
  const accountsMoves = live.statementMoves('accounts', mine).moves;
  assert.equal(accountsMoves.includes('void'), false, 'only management voids an issued statement');
  assert.equal(live.statementMoves('admin', mine).moves.includes('void'), true);
  assert.equal(statement.payoutMinor, 36000);
  assert.deepEqual(accountsMoves, ['pay']);
  statement = live.statementSchema.parse(await write({ action: 'recordOwnerPayout', statementId: statement.id, version: statement.version, method: 'bank_transfer', reference: 'BACS-REF-001' }));
  assert.equal(statement.status, 'paid');
  assert.deepEqual(live.statementMoves('accounts', { ...mine, statement }).moves, []);
  // An owner balance cannot be paid out.
  assert.deepEqual(live.statementMoves('accounts', { ...mine, statement: { status: 'issued', payoutMinor: -100 } }).moves, []);
});
