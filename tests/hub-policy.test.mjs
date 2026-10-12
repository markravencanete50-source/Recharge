import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The hub's trackers, worked out from the work the app already holds: which trackers each role sees,
// to-do lists, purchase orders, preventative maintenance dates, and each day's reviews and pricing.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { hubTabsFor, todoRows, purchaseRows, preventativeRows, nextDue, dailyRows, onboardingRows } = await vite.ssrLoadModule('/lib/hub.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const op = (n, kind, data, extra = {}) => ({ workId: id(n), propertyId: id(900), moduleId: 'x', title: kind, kind, status: 'waiting', version: 1, assigneeId: null, data, ...extra });
const todo = (n, extra) => ({ id: id(n), kind: 'todo', title: 'T' + n, details: '', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null, department: null, dueOn: null, amountMinor: null, settledMinor: null, link: null, reference: '', status: 'open', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: id(1), createdByName: 'A', createdAt: '2026-10-0' + (n % 9 + 1) + 'T09:00:00Z', updatedAt: '', version: 1, ...extra });

test('every team role has the Hub; each sees the trackers for their work', () => {
  for (const role of ['admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.ok(workViewsFor(role).includes('hub'), role);
  assert.equal(workViewsFor('client').includes('hub'), false);
  assert.deepEqual(hubTabsFor('admin', ['todo', 'approval', 'aircover', 'invoice']), ['todos', 'approvals', 'purchases', 'preventative', 'daily', 'aircover', 'invoices', 'onboarding', 'licensing', 'responsibilities', 'rota', 'timesheets']);
  assert.deepEqual(hubTabsFor('super_admin', ['todo']), ['todos', 'approvals', 'purchases', 'preventative', 'daily', 'onboarding', 'licensing', 'responsibilities', 'rota', 'timesheets']);
  assert.deepEqual(hubTabsFor('cleans', ['todo', 'approval']), ['todos', 'approvals', 'responsibilities', 'rota', 'timesheets']);
  assert.deepEqual(hubTabsFor('accounts', ['todo', 'approval', 'aircover', 'invoice']), ['todos', 'approvals', 'purchases', 'aircover', 'invoices', 'responsibilities', 'rota', 'timesheets']);
  // A super admin previewing Ready gets the database's answer for themselves (all four kinds), but only Ready's trackers show.
  assert.deepEqual(hubTabsFor('ready', ['todo', 'approval', 'aircover', 'invoice']), ['todos', 'approvals', 'purchases', 'preventative', 'responsibilities', 'rota', 'timesheets']);
  assert.deepEqual(hubTabsFor('stays', ['todo', 'approval', 'aircover', 'invoice']), ['todos', 'approvals', 'purchases', 'preventative', 'daily', 'aircover', 'onboarding', 'licensing', 'responsibilities', 'rota', 'timesheets']);
  // Only the roles the database lets record licensing steps (stays, admin, super admin) get the tab.
  for (const role of ['accounts', 'ready', 'cleans', 'cleaning_manager', 'client']) assert.equal(hubTabsFor(role, ['todo', 'approval', 'aircover', 'invoice']).includes('licensing'), false, role);
  assert.ok(teamsReadSchema.safeParse({ section: 'hub' }).success);
});

test('to-do lists: mine, my department\'s, one person\'s; open first, soonest due first', () => {
  const me = id(5), items = [
    todo(1, { assigneeId: me, status: 'done' }), todo(2, { assigneeId: me, dueOn: '2026-10-20' }), todo(3, { assigneeId: me, dueOn: '2026-10-12' }),
    todo(4, { department: 'client_relations' }), todo(6, { assigneeId: id(6) }),
  ];
  assert.deepEqual(todoRows(items, { userId: me, department: 'client_relations', who: 'mine' }).map(t => t.title), ['T3', 'T2', 'T1']);
  assert.deepEqual(todoRows(items, { userId: me, department: 'client_relations', who: 'department' }).map(t => t.title), ['T4']);
  assert.deepEqual(todoRows(items, { userId: me, department: null, who: id(6) }).map(t => t.title), ['T6']);
  assert.equal(todoRows(items, { userId: me, department: null, who: 'everyone' }).length, 5);
});

test('purchase orders and onboarding as rows', () => {
  const rows = purchaseRows([op(1, 'purchase', { requirements: 'From the clean report:\n6 × Toilet roll', budgetMinor: 3000, phase: 'ordered', supplier: 'Costco', approvedAmountMinor: 2800 }, { createdAt: '2026-10-08T10:00:00Z' })]);
  assert.equal(rows[0].items, '6 × Toilet roll'); assert.equal(rows[0].stage, 'Ordered'); assert.equal(rows[0].raisedOn, '2026-10-08');
  // Every purchase phase has its own label; a reconciled purchase is Done, not Requested.
  const stage = (phase, extra) => purchaseRows([op(2, 'purchase', { requirements: 'Mop', phase }, extra)])[0].stage;
  assert.deepEqual(['requested', 'approved', 'ordered', 'delivered', 'reconciled'].map(p => stage(p)), ['Requested', 'Approved', 'Ordered', 'Delivered', 'Done']);
  assert.equal(stage('reconciled', { status: 'completed' }), 'Done');
  assert.equal(stage('ordered', { status: 'cancelled' }), 'Cancelled');
  const j = onboardingRows([{ propertyId: id(2), clientId: null, workId: id(3), stage: 'form', enquiry: { contactName: 'Morag', phone: '07700 900123' } }, { propertyId: id(4), clientId: id(9), workId: id(5), stage: 'live' }]);
  assert.equal(j[0].next, 'Set-up form to complete'); assert.equal(j[0].contact, 'Morag'); assert.equal(j[1].contact, 'Owner account');
});

test('preventative maintenance: last visit, whether it was done, and the next date', () => {
  const plan = { id: id(1), propertyId: id(2), propertyName: 'Flat', title: 'Garden', frequency: 'monthly', dayOfMonth: 5, active: true, lastVisit: { period: '2026-09', workId: id(3) } };
  assert.equal(nextDue(plan, '2026-10-09'), '2026-10-05');
  assert.equal(nextDue({ ...plan, frequency: 'quarterly' }, '2026-10-09'), '2026-12-05');
  assert.equal(nextDue({ ...plan, lastVisit: null }, '2026-10-09'), '2026-10-05');
  const done = preventativeRows([plan], [op(3, 'routine_visit', { photoIds: [id(7), id(8)] }, { status: 'completed', dueOn: '2026-09-05' })], '2026-10-09')[0];
  assert.equal(done.done, true); assert.equal(done.photos, 2); assert.equal(done.nextOn, '2026-10-05');
  const late = preventativeRows([plan], [op(3, 'routine_visit', {}, { dueOn: '2026-09-05' })], '2026-10-09')[0];
  assert.equal(late.overdue, true); assert.equal(late.nextOn, '2026-09-05', 'the open visit is what is next');
});

test('each day\'s reviews and pricing decisions', () => {
  const rows = dailyRows([
    op(1, 'guest_review', { reviewedOn: '2026-10-09', rating: 5, outOf: 5 }), op(2, 'guest_review', { reviewedOn: '2026-10-09', rating: 1, outOf: 5 }),
    op(3, 'guest_review', { reviewedOn: '2026-10-08', rating: 10, outOf: 10 }), op(4, 'guest_review', { reviewedOn: '2026-09-01', rating: 5, outOf: 5 }),
    op(5, 'daily_pricing', { decision: 'change', reason: 'Event in town' }, { createdAt: '2026-10-09T08:00:00Z' }),
    op(6, 'daily_pricing', { decision: 'hold', reason: 'Already competitive' }, { createdAt: '2026-10-09T08:10:00Z' }),
    op(7, 'relisting', {}, { createdAt: '2026-10-09T12:00:00Z' }),
  ], 14, '2026-10-09');
  assert.deepEqual(rows.map(r => r.day), ['2026-10-09', '2026-10-08'], 'older days are left out');
  assert.deepEqual({ ...rows[0] }, { day: '2026-10-09', reviews: 2, top: 1, bottom: 1, relisted: 1, changes: 1, held: 1, reasons: ['Event in town'] });
  assert.equal(rows[1].top, 1, 'a 10 out of 10 counts as top');
});
