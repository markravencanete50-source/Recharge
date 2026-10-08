import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// A work item's sheet offers the steps that actually move it on, including steps that live on the
// onboarding journey or on the purchase the ticket was created for.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { workItemForms } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());

const property = '11111111-1111-4111-8111-111111111111';
const ready = { userId: '22222222-2222-4222-8222-222222222222', role: 'ready', modules: ['new-property-inspection-board', 'purchase-order'] };
const accounts = { userId: '33333333-3333-4333-8333-333333333333', role: 'accounts', modules: ['onboarding-invoices'] };
const journey = (stage) => ({ propertyId: property, clientId: '44444444-4444-4444-8444-444444444444', workId: '55555555-5555-4555-8555-555555555555', stage, version: 3, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null });
const item = (kind, data = {}, status = 'waiting', workId = '66666666-6666-4666-8666-666666666666') => ({ workId, propertyId: property, moduleId: 'new-property-inspection-board', title: 'Ticket', kind, status, version: 1, assigneeId: null, data });

test('a Ready inspection ticket offers booking, then the report', () => {
  assert.deepEqual(workItemForms(ready, item('inspection'), [journey('inspection_to_book')]).map(f => f.key), ['bookInspection']);
  assert.deepEqual(workItemForms(ready, item('inspection'), [journey('inspection_booked')]).map(f => f.key), ['completeInspection']);
});

test('an inspection ticket never offers the rest of the journey', () => {
  const admin = { userId: ready.userId, role: 'admin', modules: [] };
  assert.deepEqual(workItemForms(admin, item('inspection'), [journey('inspection_complete')]).map(f => f.key), []);
});

test('a closed ticket offers nothing extra', () => {
  assert.deepEqual(workItemForms(ready, item('inspection', {}, 'completed'), [journey('inspection_booked')]), []);
});

test('the onboarding root item carries the journey steps', () => {
  const admin = { userId: ready.userId, role: 'admin', modules: [] };
  const root = item('onboarding', {}, 'in_progress', journey('enquiry').workId);
  assert.ok(workItemForms(admin, root, [journey('enquiry')]).some(f => f.key === 'publishEstimate'));
});

test('a purchase delivery ticket offers the purchase delivery step', () => {
  const purchaseId = '77777777-7777-4777-8777-777777777777';
  const purchase = { ...item('purchase', { phase: 'ordered' }, 'approved', purchaseId), moduleId: 'purchase-order' };
  const delivery = { ...item('purchase_delivery', { sourceWorkId: purchaseId }), moduleId: 'purchase-order' };
  const forms = workItemForms(ready, delivery, [], [purchase, delivery]);
  assert.deepEqual(forms.map(f => f.key), ['recordDelivery']);
  assert.equal(forms[0].build({ receivedOn: '2026-10-08', evidence: 'Delivered' }, 'r').workId, purchaseId);
  assert.deepEqual(workItemForms(ready, delivery, [], [delivery]), [], 'no purchase visible, no step');
});

test('people without the onboarding tools get no journey steps', () => {
  assert.deepEqual(workItemForms(accounts, item('inspection'), [journey('inspection_to_book')]), []);
});
