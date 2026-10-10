import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const state = {}; globalThis.__financeHttp = state;
const mocks = {
  'business-server': `const s=globalThis.__financeHttp; export const businessContext=async()=>s.session;
  export const businessResponse=(body,status=200)=>Response.json(body,{status});
  export const databaseFailure=e=>Response.json({error:'Denied by database'},{status:e.code==='42501'?403:400}); export const viewAsFailure=()=>null;`,
  'auth-security': `const s=globalThis.__financeHttp; export const authSecurityConfiguration=()=>({origin:'https://recharge.example'}); export const requestQuota=async()=>s.quota;`,
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-finance-http', enforce: 'pre',
  transform(code, id) {
    if (!/\/workspace-rpc-route\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from './${name}'`, `from 'finance-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('finance-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0finance-test:') ? mocks[id.slice(14)] : null,
}] });
after(async () => { delete globalThis.__financeHttp; await vite.close(); });
const { workspaceFinance, workspaceTeams } = await vite.ssrLoadModule('/lib/workspace-finance-server.ts');
const { financeActionSchema, financeReadSchema } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const routes = [workspaceFinance, workspaceTeams];
const uuid = '11111111-1111-4111-8111-111111111111';

function reset(status = 'active') {
  Object.assign(state, { calls: [], quota: { allowed: true, retryAfter: 0 }, session: { account: { userId: uuid, status }, client: { rpc: async (name, args) => { state.calls.push({ name, args }); return { data: { ok: 1 }, error: null }; } } } });
}
function post(body, origin = 'https://recharge.example', path = '/api/workspace/finance') {
  return new Request('https://recharge.example' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('finance and team routes refuse forged origins, browser-shaped native calls and inactive sessions before any RPC', async () => {
  for (const route of routes) {
    reset(); assert.equal((await route(post({}, 'https://attacker.example'))).status, 403);
    assert.equal((await route(post({}), true)).status, 403); assert.equal(state.calls.length, 0);
    reset(); state.session = null; assert.equal((await route(new Request('https://recharge.example/api/workspace/finance?section=policy'))).status, 401);
    for (const status of ['pending', 'revoked']) { reset(status); assert.equal((await route(new Request('https://recharge.example/api/workspace/finance?section=policy'))).status, 403); assert.equal(state.calls.length, 0); }
    reset(); state.quota = { allowed: false, retryAfter: 30 };
    const limited = await route(post({ action: 'completeCourse', requestId: uuid, courseId: uuid }));
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '30'); assert.equal(state.calls.length, 0);
  }
});

test('finance input rejects invented roles, fractional money and unconfirmed platform reservations', () => {
  const expense = { action: 'createExpense', requestId: uuid, propertyId: uuid, supplier: 'Example Plumbing', reference: 'INV-1', category: 'maintenance', description: 'Tap replaced', amountMinor: 18500, receivedOn: '2026-10-03', source: 'email' };
  assert.ok(financeActionSchema.safeParse(expense).success);
  for (const patch of [{ amountMinor: 185.5 }, { amountMinor: 0 }, { category: 'bribe' }, { receivedOn: '2026-02-30' }, { role: 'super_admin' }, { createdBy: uuid }]) assert.equal(financeActionSchema.safeParse({ ...expense, ...patch }).success, false, JSON.stringify(patch));
  assert.equal(financeActionSchema.safeParse({ action: 'setReservationFinancials', requestId: uuid, propertyId: uuid, reservationId: uuid, version: 1, channel: 'airbnb', payoutMinor: 100 }).success, false);
  assert.equal(financeActionSchema.safeParse({ action: 'addExpenseEvidence', requestId: uuid, expenseId: uuid, kind: 'photo', label: 'Photo' }).success, false);
  assert.equal(financeReadSchema.safeParse({ section: 'reconciliation' }).success, false);
  assert.equal(financeReadSchema.safeParse({ section: 'statements', status: 'approved' }).success, false);
  assert.ok(financeReadSchema.safeParse({ section: 'statements' }).success);
});

test('payout CSV uploads are parsed on the server and only code totals reach the database', async () => {
  reset();
  const csv = 'Date,Type,Confirmation Code,Guest,Amount,Paid Out\n10/01/2026,Payout,,,,"1,000.00"\n10/01/2026,Reservation,HMQ4K2T8XW,Guest A,460.00,\n10/02/2026,Adjustment,hmq4k2t8xw,Guest A,-10.00,';
  const response = await workspaceFinance(post({ action: 'importPayoutReport', requestId: uuid, channel: 'airbnb', fileName: 'airbnb.csv', csv }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_finance_action', args: { input: { action: 'importPayoutReport', requestId: uuid, channel: 'airbnb', fileName: 'airbnb.csv', lines: [{ reference: 'HMQ4K2T8XW', amountMinor: 45000 }] } } });
  reset();
  const wrong = await workspaceFinance(post({ action: 'importPayoutReport', requestId: uuid, channel: 'airbnb', fileName: 'booking.csv', csv: 'Reservation number,Payout amount\n4172839560,520.00' }));
  assert.equal(wrong.status, 400); assert.match((await wrong.json()).error, /Booking\.com/); assert.equal(state.calls.length, 0);
  reset();
  const empty = await workspaceFinance(post({ action: 'importPayoutReport', requestId: uuid, channel: 'airbnb', fileName: 'x.csv', csv: 'Foo,Bar\n1,2' }));
  assert.equal(empty.status, 400); assert.equal(state.calls.length, 0);
});

test('reads pass only validated filters to the database', async () => {
  reset();
  assert.equal((await workspaceFinance(new Request(`https://recharge.example/api/workspace/finance?section=expenses&status=approved&propertyId=${uuid}`))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_finance_read', args: { section: 'expenses', target_property: uuid, period: null, target_id: null, status_filter: 'approved' } });
  reset();
  assert.equal((await workspaceFinance(new Request('https://recharge.example/api/workspace/finance?section=expenses&sql=select'))).status, 400);
  assert.equal((await workspaceTeams(new Request('https://recharge.example/api/workspace/teams?section=schedule&from=2026-10-01&to=2027-01-01'))).status, 400);
  assert.equal(state.calls.length, 0);
  assert.equal((await workspaceTeams(new Request('https://recharge.example/api/workspace/teams?section=schedule&from=2026-10-01&to=2026-10-31'))).status, 200);
  assert.deepEqual(state.calls[0].args, { section: 'schedule', start_on: '2026-10-01', end_on: '2026-10-31', target_property: null, target_user: null });
});

test('team input requires versions for edits, HTTPS course links and known outcomes', () => {
  const plan = { action: 'saveRoutinePlan', requestId: uuid, propertyId: uuid, moduleId: 'routine-bin-garden-board', title: 'Bins', checklist: ['Bins out'], frequency: 'monthly', dayOfMonth: 5, active: true };
  assert.ok(teamsActionSchema.safeParse(plan).success);
  assert.equal(teamsActionSchema.safeParse({ ...plan, planId: uuid }).success, false);
  assert.equal(teamsActionSchema.safeParse({ ...plan, dayOfMonth: 31 }).success, false);
  assert.equal(teamsActionSchema.safeParse({ ...plan, moduleId: 'owner-statements' }).success, false);
  const course = { action: 'saveCourse', requestId: uuid, title: 'Turnover', audience: ['cleans'], body: 'Long enough body', minutes: 10, published: true };
  assert.ok(teamsActionSchema.safeParse(course).success);
  for (const videoUrl of ['http://example.com/v', 'https://user:pw@example.com/v', 'javascript:alert(1)']) assert.equal(teamsActionSchema.safeParse({ ...course, videoUrl }).success, false);
  assert.equal(teamsActionSchema.safeParse({ action: 'decideComplaint', requestId: uuid, workId: uuid, version: 1, outcome: 'ignore', note: 'Valid note' }).success, false);
  assert.equal(teamsReadSchema.safeParse({ section: 'schedule', from: '2026-10-05', to: '2026-10-01' }).success, false);
});

test('expense paperwork, purchase invoices and Ready Home go to their own database functions', async () => {
  reset();
  assert.equal((await workspaceFinance(post({ action: 'recordPurchaseInvoice', requestId: uuid, purchaseId: uuid, reference: 'LAMPS-1', amountMinor: 6800, paid: true }))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_accounts_action', args: { input: { action: 'recordPurchaseInvoice', requestId: uuid, purchaseId: uuid, reference: 'LAMPS-1', amountMinor: 6800, paid: true } } });
  reset();
  assert.equal((await workspaceFinance(post({ action: 'attachExpensePhotos', requestId: uuid, expenseId: uuid, kind: 'invoice', label: 'Invoice', mediaIds: [] }))).status, 400, 'at least one photo');
  assert.equal((await workspaceFinance(post({ action: 'approveExpense', requestId: uuid, expenseId: uuid, version: 1 }))).status, 200);
  assert.equal(state.calls[0].name, 'workspace_finance_action');
  reset();
  assert.equal((await workspaceFinance(new Request(`https://recharge.example/api/workspace/finance?section=jobs&propertyId=${uuid}`))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_accounts_read', args: { section: 'jobs', target_property: uuid, target_id: null } });
  assert.equal((await workspaceFinance(new Request('https://recharge.example/api/workspace/finance?section=jobs'))).status, 400, 'jobs need a property');
  assert.equal((await workspaceFinance(new Request('https://recharge.example/api/workspace/finance?section=expenses&status=draft'))).status, 200);
  reset();
  assert.equal((await workspaceTeams(new Request('https://recharge.example/api/workspace/teams?section=readyHome'))).status, 200);
  assert.deepEqual(state.calls[0], { name: 'workspace_ready_home', args: undefined });
});
