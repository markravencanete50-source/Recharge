import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The hub's trackers, worked out from the work the app already holds: which trackers each role sees,
// purchase orders and onboarding as rows.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { purchaseRows, onboardingRows } = await vite.ssrLoadModule('/lib/hub.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const op = (n, kind, data, extra = {}) => ({ workId: id(n), propertyId: id(900), moduleId: 'x', title: kind, kind, status: 'waiting', version: 1, assigneeId: null, data, ...extra });

test('the Hub is no Work view for any role; its trackers live in To-do, Management approvals and the two relations areas', () => {
  for (const role of ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client']) assert.equal(workViewsFor(role).includes('hub'), false, role);
  assert.deepEqual(workViewsFor('admin'), ['management', 'stays', 'clients', 'calendar', 'cleans', 'repairs', 'accounts', 'all']);
  assert.ok(teamsReadSchema.safeParse({ section: 'hub' }).success, 'the hub read still serves its rows to the new screens');
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
