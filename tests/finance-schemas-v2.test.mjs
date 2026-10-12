import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Payables, statement terms and periods, new report sections, hub links and owner expenses: what the schemas accept and refuse,
// and which database function each request goes to.
const state = {}; globalThis.__financeV2 = state;
const mocks = {
  'business-server': `const s=globalThis.__financeV2; export const businessContext=async()=>s.session;
  export const businessResponse=(body,status=200)=>Response.json(body,{status});
  export const databaseFailure=e=>Response.json({error:'Denied by database'},{status:e.code==='42501'?403:400}); export const viewAsFailure=()=>null;`,
  'auth-security': `const s=globalThis.__financeV2; export const authSecurityConfiguration=()=>({origin:'https://recharge.example'}); export const requestQuota=async()=>s.quota;`,
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-finance-v2', enforce: 'pre',
  transform(code, id) {
    if (!/\/workspace-rpc-route\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from './${name}'`, `from 'finance-v2-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('finance-v2-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0finance-v2-test:') ? mocks[id.slice(17)] : null,
}] });
after(async () => { delete globalThis.__financeV2; await vite.close(); });
const { workspaceFinance, workspaceTeams } = await vite.ssrLoadModule('/lib/workspace-finance-server.ts');
const { workspaceOwner } = await vite.ssrLoadModule('/lib/owner-server.ts');
const { financeActionSchema, financeReadSchema, REPORT_SECTIONS, PAYABLES_ACTIONS } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const { teamsActionSchema, hubItemSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { ownerActionSchema, ownerReadSchema, OWNER_EXPENSE_CATEGORIES } = await vite.ssrLoadModule('/lib/owner-policy.ts');
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');

const uuid = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const uuid3 = '33333333-3333-4333-8333-333333333333';
const base = 'https://recharge.example';

function reset() {
  Object.assign(state, { calls: [], quota: { allowed: true, retryAfter: 0 }, session: { account: { userId: uuid, status: 'active' }, client: { rpc: async (name, args) => { state.calls.push({ name, args }); return { data: { ok: 1 }, error: null }; } } } });
}
const post = (body, path = '/api/workspace/finance') => new Request(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = query => new Request(`${base}/api/workspace/finance?${query}`);
const accepts = (schema, value) => schema.safeParse(value).success;
const message = (schema, value) => schema.safeParse(value).error?.issues[0]?.message;

const invoice = { action: 'recordCleanerInvoice', requestId: uuid, supplier: 'Sparkle Cleaning', reference: 'INV-204', invoiceDate: '2026-11-30', totalMinor: 13500,
  lines: [{ workId: uuid2, amountMinor: 6000 }, { workId: uuid3, amountMinor: 7500 }], note: 'November cleans' };

test('a cleaner invoice needs lines that add up to its total', () => {
  assert.ok(accepts(financeActionSchema, invoice));
  assert.ok(accepts(financeActionSchema, { ...invoice, note: undefined }), 'the note is optional');
  assert.match(message(financeActionSchema, { ...invoice, totalMinor: 13501 }), /add up/);
  assert.match(message(financeActionSchema, { ...invoice, totalMinor: 13499 }), /add up/);
  for (const patch of [
    { totalMinor: 0 }, { totalMinor: -13500 }, { totalMinor: 135.5 }, { totalMinor: 100000001 },
    { lines: [] }, { lines: [{ workId: uuid2, amountMinor: 0 }, { workId: uuid3, amountMinor: 13500 }] }, { lines: [{ workId: uuid2, amountMinor: -6000 }, { workId: uuid3, amountMinor: 19500 }] },
    { lines: [{ workId: uuid2, amountMinor: 60.5 }, { workId: uuid3, amountMinor: 7439.5 }] }, { lines: [{ workId: 'clean-1', amountMinor: 13500 }] },
    { invoiceDate: '2026-02-30' }, { invoiceDate: '30/11/2026' }, { supplier: '' }, { reference: '' }, { note: 'x'.repeat(2001) }, { requestId: 'abc' }, { createdBy: uuid },
  ]) assert.equal(accepts(financeActionSchema, { ...invoice, ...patch }), false, JSON.stringify(patch));
  assert.equal(accepts(financeActionSchema, { ...invoice, totalMinor: 12000, lines: [{ workId: uuid2, amountMinor: 6000 }, { workId: uuid2, amountMinor: 6000 }] }), false, 'one clean once per invoice');
  const many = n => Array.from({ length: n }, (_, i) => ({ workId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, amountMinor: 100 }));
  assert.ok(accepts(financeActionSchema, { ...invoice, totalMinor: 20000, lines: many(200) }));
  assert.equal(accepts(financeActionSchema, { ...invoice, totalMinor: 20100, lines: many(201) }), false, 'at most 200 lines');
});

test('deciding an invoice and reviewing a clean cost', () => {
  const decide = { action: 'decideCleanerInvoice', requestId: uuid, invoiceId: uuid2, decision: 'approve' };
  assert.ok(accepts(financeActionSchema, decide));
  assert.ok(accepts(financeActionSchema, { ...decide, note: 'Matches the rota' }));
  assert.equal(accepts(financeActionSchema, { ...decide, decision: 'reject' }), false, 'a rejection says why');
  assert.ok(accepts(financeActionSchema, { ...decide, decision: 'reject', note: 'Wrong property on line 2' }));
  for (const patch of [{ decision: 'hold' }, { invoiceId: 'x' }, { note: 'x'.repeat(2001) }, { extra: 1 }]) assert.equal(accepts(financeActionSchema, { ...decide, ...patch }), false, JSON.stringify(patch));
  const review = { action: 'reviewCleanCost', requestId: uuid, workId: uuid2, decision: 'agreed_fee', note: 'Extra hour was our delay' };
  assert.ok(accepts(financeActionSchema, review));
  assert.ok(accepts(financeActionSchema, { ...review, decision: 'actual_cost' }));
  assert.ok(accepts(financeActionSchema, { ...review, note: undefined }));
  for (const patch of [{ decision: 'cheaper' }, { workId: 'x' }, { note: 'x'.repeat(2001) }, { amountMinor: 100 }]) assert.equal(accepts(financeActionSchema, { ...review, ...patch }), false, JSON.stringify(patch));
});

test('statement terms carry the VAT switch and the clean charge mode', () => {
  const terms = { action: 'setStatementTerms', requestId: uuid, propertyId: uuid2, managementFeeBps: 1500, cleaningCostMinor: 6000 };
  assert.ok(accepts(financeActionSchema, terms), 'the old shape still works');
  assert.ok(accepts(financeActionSchema, { ...terms, vatOnFee: true, cleanChargeMode: 'actual_cost' }));
  assert.ok(accepts(financeActionSchema, { ...terms, vatOnFee: false, cleanChargeMode: 'agreed_fee' }));
  for (const patch of [{ vatOnFee: 'yes' }, { vatOnFee: 1 }, { cleanChargeMode: 'cheapest' }, { managementFeeBps: 10001 }, { cleaningCostMinor: -1 }, { vatRateBps: 2000 }]) assert.equal(accepts(financeActionSchema, { ...terms, ...patch }), false, JSON.stringify(patch));
});

test('a statement is for a month or for dates, never both', () => {
  const prepare = { action: 'prepareStatement', requestId: uuid, propertyId: uuid2 };
  assert.ok(accepts(financeActionSchema, { ...prepare, period: '2026-11' }), 'the month shape is unchanged');
  assert.ok(accepts(financeActionSchema, { ...prepare, from: '2026-11-01', to: '2026-12-01' }));
  assert.ok(accepts(financeActionSchema, { ...prepare, from: '2026-11-01', to: '2026-12-01', method: 'nights' }));
  assert.ok(accepts(financeActionSchema, { ...prepare, from: '2026-11-01', to: '2026-12-01', method: 'check_in_month' }));
  assert.ok(accepts(financeActionSchema, { ...prepare, from: '2026-01-01', to: '2027-01-02' }), '366 days');
  assert.match(message(financeActionSchema, { ...prepare, period: '2026-11', from: '2026-11-01', to: '2026-12-01' }), /not both/);
  assert.match(message(financeActionSchema, { ...prepare, period: '2026-11', from: '2026-11-01' }), /not both/);
  assert.match(message(financeActionSchema, { ...prepare, period: '2026-11', to: '2026-12-01' }), /not both/);
  assert.match(message(financeActionSchema, prepare), /month or a date range/);
  assert.match(message(financeActionSchema, { ...prepare, from: '2026-11-01' }), /both/);
  assert.match(message(financeActionSchema, { ...prepare, to: '2026-12-01' }), /both/);
  assert.match(message(financeActionSchema, { ...prepare, from: '2026-11-01', to: '2026-11-01' }), /end after/, 'to is not included, so the dates cannot match');
  assert.match(message(financeActionSchema, { ...prepare, from: '2026-12-01', to: '2026-11-01' }), /end after/);
  assert.match(message(financeActionSchema, { ...prepare, from: '2026-01-01', to: '2027-01-03' }), /366/);
  for (const patch of [{ from: '2026-02-30', to: '2026-03-30' }, { from: '2026-11-01', to: '1 December' }, { from: '2026-11-01', to: '2026-12-01', method: 'average' }, { period: '2026-13' }, { period: '2026-11', method: 'daily' }, { period: '2026-11-01' }]) {
    assert.equal(accepts(financeActionSchema, { ...prepare, ...patch }), false, JSON.stringify(patch));
  }
});

test('report sections: statements and payables reads take dates and the filters they accept', () => {
  for (const section of ['cleansToReview', 'cleanerInvoices', 'receivable', 'performance']) assert.ok(REPORT_SECTIONS.includes(section), section);
  assert.ok(accepts(financeReadSchema, { section: 'cleansToReview' }));
  assert.ok(accepts(financeReadSchema, { section: 'cleansToReview', from: '2026-11-01', to: '2026-11-30', propertyId: uuid, region: 'Edinburgh' }));
  assert.ok(accepts(financeReadSchema, { section: 'cleanerInvoices', from: '2026-11-01', to: '2026-11-30', propertyId: uuid }));
  assert.ok(accepts(financeReadSchema, { section: 'receivable', from: '2026-11-01', to: '2026-11-30', region: 'Glasgow', channel: 'direct' }));
  assert.ok(accepts(financeReadSchema, { section: 'performance', from: '2026-01-01', to: '2026-12-31', propertyId: uuid, region: 'Edinburgh', channel: 'vrbo' }));
  assert.ok(accepts(financeReadSchema, { section: 'payoutLines', channel: 'vrbo', state: 'active', reportId: uuid }), 'payout lines keep their filters');
  for (const query of [
    { section: 'cleansToReview', channel: 'airbnb' }, { section: 'cleanerInvoices', channel: 'airbnb' }, { section: 'cleansToReview', state: 'active' }, { section: 'performance', reportId: uuid },
    { section: 'performance', state: 'active' }, { section: 'receivable', reportId: uuid }, { section: 'payoutLines', region: 'Edinburgh' }, { section: 'payoutLines', channel: 'direct' },
    { section: 'performance', period: '2026-11' }, { section: 'performance', from: '2026-02-30' }, { section: 'performance', from: '2026-12-01', to: '2026-11-01' },
    { section: 'performance', channel: 'phone' }, { section: 'performance', region: '' }, { section: 'performance', region: 'x'.repeat(81) }, { section: 'performance', propertyId: 'x' },
    { section: 'statements', region: 'Edinburgh' }, { section: 'statements', from: '2026-11-01' }, { section: 'expenses', channel: 'airbnb' }, { section: 'policy', region: 'Edinburgh' },
  ]) assert.equal(accepts(financeReadSchema, query), false, JSON.stringify(query));
});

test('payables actions go to workspace_payables_action with their own keys', async () => {
  assert.deepEqual([...PAYABLES_ACTIONS].sort(), ['decideCleanerInvoice', 'recordCleanerInvoice', 'reviewCleanCost']);
  const sent = [
    invoice,
    { action: 'decideCleanerInvoice', requestId: uuid, invoiceId: uuid2, decision: 'reject', note: 'Wrong property on line 2' },
    { action: 'reviewCleanCost', requestId: uuid, workId: uuid2, decision: 'actual_cost', note: 'The guests left it very dirty' },
  ];
  for (const body of sent) {
    reset();
    const response = await workspaceFinance(post(body));
    assert.equal(response.status, 200, body.action);
    assert.deepEqual(state.calls, [{ name: 'workspace_payables_action', args: { input: body } }], body.action);
  }
  // Existing routing is untouched: other finance actions and the expense paperwork keep their own functions.
  reset(); await workspaceFinance(post({ action: 'prepareStatement', requestId: uuid, propertyId: uuid2, from: '2026-11-01', to: '2026-12-01', method: 'nights' }));
  assert.deepEqual(state.calls, [{ name: 'workspace_finance_action', args: { input: { action: 'prepareStatement', requestId: uuid, propertyId: uuid2, from: '2026-11-01', to: '2026-12-01', method: 'nights' } } }]);
  reset(); await workspaceFinance(post({ action: 'setStatementTerms', requestId: uuid, propertyId: uuid2, managementFeeBps: 1200, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee' }));
  assert.deepEqual(state.calls[0], { name: 'workspace_finance_action', args: { input: { action: 'setStatementTerms', requestId: uuid, propertyId: uuid2, managementFeeBps: 1200, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee' } } });
  reset(); await workspaceFinance(post({ action: 'recordPurchaseInvoice', requestId: uuid, purchaseId: uuid2, reference: 'P-1', amountMinor: 500, paid: false }));
  assert.equal(state.calls[0].name, 'workspace_accounts_action');
  // A mismatched total never reaches the database.
  reset(); const refused = await workspaceFinance(post({ ...invoice, totalMinor: 1 }));
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /add up/); assert.equal(state.calls.length, 0);
  reset(); const both = await workspaceFinance(post({ action: 'prepareStatement', requestId: uuid, propertyId: uuid2, period: '2026-11', from: '2026-11-01', to: '2026-12-01' }));
  assert.equal(both.status, 400); assert.match((await both.json()).error, /not both/); assert.equal(state.calls.length, 0);
});

test('report reads go to workspace_finance_report with only the filters asked for', async () => {
  reset();
  assert.equal((await workspaceFinance(get(`section=performance&from=2026-01-01&to=2026-12-31&propertyId=${uuid}&region=Edinburgh&channel=vrbo`))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_finance_report', args: { section: 'performance', target_property: uuid, target_id: null, from_on: '2026-01-01', to_on: '2026-12-31', filters: { channel: 'vrbo', region: 'Edinburgh' } } });
  reset();
  assert.equal((await workspaceFinance(get('section=cleansToReview'))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_finance_report', args: { section: 'cleansToReview', target_property: null, target_id: null, from_on: null, to_on: null, filters: {} } });
  reset();
  assert.equal((await workspaceFinance(get(`section=cleanerInvoices&id=${uuid2}`))).status, 200);
  assert.equal(state.calls[0].name, 'workspace_finance_report'); assert.equal(state.calls[0].args.target_id, uuid2);
  reset();
  assert.equal((await workspaceFinance(get('section=receivable&channel=airbnb&region=Glasgow'))).status, 200);
  assert.deepEqual(state.calls[0].args.filters, { channel: 'airbnb', region: 'Glasgow' });
  // A filter the section does not take is refused before the database is asked.
  reset();
  assert.equal((await workspaceFinance(get('section=cleansToReview&channel=airbnb'))).status, 400);
  assert.equal((await workspaceFinance(get('section=statements&region=Edinburgh'))).status, 400);
  assert.equal(state.calls.length, 0);
  // Statements stay on workspace_finance_read.
  reset(); await workspaceFinance(get('section=statements'));
  assert.equal(state.calls[0].name, 'workspace_finance_read');
});

test('hub items can link a stay and a client', async () => {
  const item = { action: 'saveHubItem', requestId: uuid, kind: 'invoice', title: 'November statement fee', amountMinor: 24300, reference: 'INV-88' };
  assert.ok(accepts(teamsActionSchema, item), 'older saves still work');
  assert.ok(accepts(teamsActionSchema, { ...item, reservationId: uuid2, clientId: uuid3 }));
  assert.ok(accepts(teamsActionSchema, { ...item, reservationId: null, clientId: null }), 'a link can be cleared');
  for (const patch of [{ reservationId: 'abc' }, { clientId: 'abc' }, { reference: 'x'.repeat(121) }, { invoiceId: uuid2 }]) assert.equal(accepts(teamsActionSchema, { ...item, ...patch }), false, JSON.stringify(patch));
  reset();
  assert.equal((await workspaceTeams(post({ ...item, reservationId: uuid2, clientId: uuid3 }, '/api/workspace/teams'))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_teams_action', args: { input: { ...item, reservationId: uuid2, clientId: uuid3 } } });
  const row = { id: uuid, kind: 'invoice', title: 'T', details: '', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null, department: null, dueOn: null, amountMinor: null, settledMinor: null,
    link: null, reference: '', status: 'to_send', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: uuid, createdByName: 'A', createdAt: '', updatedAt: '', version: 1 };
  assert.ok(accepts(hubItemSchema, row), 'older rows still parse');
  assert.ok(accepts(hubItemSchema, { ...row, reservationId: uuid2, clientId: null }));
});

test('an owner saves and removes their own monthly expenses', async () => {
  const save = { action: 'saveOwnerExpense', requestId: uuid, propertyId: uuid2, month: '2026-11', amountMinor: 55000, category: 'maintenance', note: 'Boiler service' };
  assert.deepEqual([...OWNER_EXPENSE_CATEGORIES], ['maintenance', 'utilities', 'insurance', 'supplies', 'other']);
  assert.ok(accepts(ownerActionSchema, save));
  assert.ok(accepts(ownerActionSchema, { ...save, note: undefined }));
  for (const category of OWNER_EXPENSE_CATEGORIES) assert.ok(accepts(ownerActionSchema, { ...save, category }), category);
  for (const patch of [
    { category: 'holiday' }, { category: undefined }, { amountMinor: 0 }, { amountMinor: -500 }, { amountMinor: 5.5 }, { amountMinor: 10000001 }, { month: '2026-13' }, { month: '2026-11-05' }, { month: 'November' },
    { note: 'x'.repeat(301) }, { propertyId: 'x' }, { requestId: 'x' }, { payoutMinor: 1 },
  ]) assert.equal(accepts(ownerActionSchema, { ...save, ...patch }), false, JSON.stringify(patch));
  assert.ok(accepts(ownerActionSchema, { ...save, note: 'x'.repeat(300) }));
  assert.ok(accepts(ownerActionSchema, { action: 'removeOwnerExpense', expenseId: uuid3 }));
  assert.equal(accepts(ownerActionSchema, { action: 'removeOwnerExpense', expenseId: 'x' }), false);
  assert.equal(accepts(ownerActionSchema, { action: 'removeOwnerExpense' }), false);
  assert.equal(accepts(ownerActionSchema, { action: 'deleteEverything' }), false);
  // Reads are as before.
  assert.ok(accepts(ownerReadSchema, { section: 'bookings', from: '2026-01-01', to: '2026-12-31' }));

  reset();
  assert.equal((await workspaceOwner(post(save, '/api/workspace/owner'))).status, 200);
  assert.deepEqual(state.calls, [{ name: 'workspace_owner_save_expense', args: { input: save } }]);
  reset();
  assert.equal((await workspaceOwner(post({ action: 'removeOwnerExpense', expenseId: uuid3 }, '/api/workspace/owner'))).status, 200);
  assert.deepEqual(state.calls, [{ name: 'workspace_owner_remove_expense', args: { input: { action: 'removeOwnerExpense', expenseId: uuid3 } } }]);
  reset();
  assert.equal((await workspaceOwner(post({ ...save, amountMinor: -1 }, '/api/workspace/owner'))).status, 400);
  assert.equal((await workspaceOwner(post({ action: 'saveOwnerExpense' }, '/api/workspace/owner'))).status, 400);
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal((await workspaceOwner(new Request(`${base}/api/workspace/owner?section=periods&from=2026-01-01&to=2026-12-31`))).status, 200);
  assert.equal(state.calls[0].name, 'workspace_owner_periods');
});

test('the view schemas read new statement fields and older payloads alike', () => {
  const statement = { id: uuid, propertyId: uuid2, propertyName: 'Harbour flat', period: '2026-11', status: 'draft', revenueMinor: 162002, cleaningCount: 3, cleaningMinor: 18000, expensesMinor: 8500,
    feeBps: 1500, feeMinor: 24300, payoutMinor: 106342, payoutMethod: null, payoutReference: null, paidAt: null, issuedAt: null, version: 1,
    detail: { stays: [], expenses: [], cleaningCostMinor: 6000 } };
  const old = live.statementSchema.parse(statement);
  assert.equal(old.vatMinor, undefined); assert.equal(old.detail.lines, undefined);
  const next = live.statementSchema.parse({ ...statement, periodEnd: '2026-12-01', method: 'nights', grossMinor: 175374, otaFeesMinor: 13372, vatRateBps: 2000, vatMinor: 4860,
    nightsBooked: 15, nightsAvailable: 30, cleanChargeMode: 'agreed_fee',
    detail: { ...statement.detail, internal: ['clean_over_agreed:abc'], lines: [
      { kind: 'ota_fee', label: 'Airbnb fee', date: '2026-11-08', amountMinor: 1546, refId: uuid },
      { kind: 'changeover', label: 'Clean', date: '2026-11-15', amountMinor: 6000 },
      { kind: 'management_fee', label: 'Management fee 15%', date: '2026-11-30', amountMinor: 24300, refId: null },
      { kind: 'vat', label: 'VAT', date: null, amountMinor: 4860 },
      { kind: 'payable', label: 'Boiler', date: '2026-11-20', amountMinor: 8500 }] } });
  assert.equal(next.grossMinor, 175374); assert.equal(next.detail.lines.length, 5); assert.deepEqual(next.detail.internal, ['clean_over_agreed:abc']);
  assert.equal(live.statementSchema.safeParse({ ...statement, detail: { ...statement.detail, lines: [{ kind: 'tax', label: 'x', amountMinor: 1 }] } }).success, false, 'unknown line kind');
  assert.equal(live.statementSchema.safeParse({ ...statement, method: 'daily' }).success, false);
  assert.equal(live.statementSchema.safeParse({ ...statement, vatMinor: 48.6 }).success, false);
  const row = { propertyId: uuid2, propertyName: 'Harbour flat', statement: null, unsettledPayouts: 0, missingDetails: 0 };
  assert.ok(accepts(live.statementsSchema, [{ ...row, terms: { managementFeeBps: 1500, cleaningCostMinor: 6000 } }]), 'older terms');
  assert.ok(accepts(live.statementsSchema, [{ ...row, terms: { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'actual_cost' } }]));
  assert.equal(accepts(live.statementsSchema, [{ ...row, terms: { managementFeeBps: 1500, cleaningCostMinor: 6000, cleanChargeMode: 'cheapest' } }]), false);

  const review = { workId: uuid, propertyName: 'Harbour flat', cleanDate: '2026-11-15', agreedMinor: 6000, actualMinor: 7500, state: 'flagged', decision: null };
  assert.ok(accepts(live.cleanCostReviewSchema, review));
  for (const state of ['flagged', 'reviewed', 'stale']) assert.ok(accepts(live.cleanCostReviewSchema, { ...review, state, decision: state === 'reviewed' ? 'agreed_fee' : null }), state);
  assert.ok(accepts(live.cleanCostReviewSchema, { ...review, actualMinor: null }));
  for (const patch of [{ state: 'done' }, { decision: 'free' }, { actualMinor: 75.5 }, { workId: 'x' }]) assert.equal(accepts(live.cleanCostReviewSchema, { ...review, ...patch }), false, JSON.stringify(patch));
  assert.ok(accepts(live.cleansToReviewReportSchema, { cleans: [review] }));
  const bill = { id: uuid, supplier: 'Sparkle Cleaning', reference: 'INV-204', invoiceDate: '2026-11-30', totalMinor: 13500, status: 'to_approve' };
  assert.ok(accepts(live.cleanerInvoiceSchema, bill));
  assert.ok(accepts(live.cleanerInvoiceSchema, { ...bill, lines: [{ workId: uuid2, amountMinor: 6000, propertyName: 'Harbour flat', cleanDate: '2026-11-15' }], note: null }));
  assert.equal(accepts(live.cleanerInvoiceSchema, { ...bill, totalMinor: 135.5 }), false);
  assert.ok(accepts(live.cleanerInvoicesReportSchema, { invoices: [bill] }));
});
