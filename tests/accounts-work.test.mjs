import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Accepted cleans grouped by cleaner for one invoice; purchases approved against the budget chart.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { cleanerInvoiceGroups } = await vite.ssrLoadModule('/lib/accounts-work.ts');
const { operationForms, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());

const task = (n, cleanerId, cleanerName, cleanedOn, status = 'waiting') => ({ workId: `00000000-0000-4000-8000-00000000000${n}`, propertyId: 'p' + n, moduleId: 'cleans-invoices', title: 'Invoice', kind: 'cleaning_invoice', status, version: 1, assigneeId: null, data: { cleanerId, cleanerName, cleanedOn } });

test('cleans waiting to be invoiced are grouped by cleaner, busiest first, oldest clean first', () => {
  const groups = cleanerInvoiceGroups([task(1, 'a', 'Cara', '2026-10-05'), task(2, 'b', 'Ben', '2026-10-01'), task(3, 'a', 'Cara', '2026-10-02'), task(4, 'a', 'Cara', '2026-10-03', 'completed'), { ...task(5, 'c', '', null) }], id => 'Property ' + id);
  assert.deepEqual(groups.map(g => [g.cleanerName, g.tasks.length]), [['Cara', 2], ['Ben', 1], ['Cleaner', 1]]);
  assert.deepEqual(groups[0].tasks.map(t => t.cleanedOn), ['2026-10-02', '2026-10-05']);
  assert.equal(groups[0].tasks[0].propertyName, 'Property p3');
});

test('Accounts approve purchases, optionally against the budget chart', () => {
  const accounts = { userId: '11111111-1111-4111-8111-111111111111', role: 'accounts', modules: ['purchase-order-accounts'] };
  const purchase = { workId: '22222222-2222-4222-8222-222222222222', propertyId: 'p', moduleId: 'purchase-order-requests', title: 'P', kind: 'purchase', status: 'waiting', version: 3, assigneeId: null, data: { phase: 'requested' } };
  const form = operationForms(accounts, purchase).find(f => f.key === 'approvePurchase');
  assert.ok(form, 'Accounts can approve');
  const chart = form.build(workflowValues(form.fields, { budgetItemId: '33333333-3333-4333-8333-333333333333', quantity: '2', approvedAmountMinor: '110', approvalNote: 'Two chairs' }), 'r');
  assert.deepEqual(chart.data, { approvedAmountMinor: 11000, approvalNote: 'Two chairs', budgetItemId: '33333333-3333-4333-8333-333333333333', quantity: 2 });
  const plain = form.build(workflowValues(form.fields.map(f => f.name === 'budgetItemId' ? { ...f, options: [{ value: '', label: 'Not from the chart' }] } : f), { budgetItemId: '', quantity: '1', approvedAmountMinor: '40', approvalNote: 'Small item' }), 'r');
  assert.deepEqual(plain.data, { approvedAmountMinor: 4000, approvalNote: 'Small item' });
  assert.deepEqual(operationForms({ ...accounts, modules: [] }, purchase).map(f => f.key), [], 'without the tool, nothing');
});
