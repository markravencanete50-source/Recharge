import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// "Your own costs" on the estimate (migration 20261020890000): the team's publish form has one optional monthly amount
// per category, the estimate keeps the ones filled in, and the owner's app and estimate page show the income after
// fees minus those costs as the estimated net profit per month and per year. Old estimates read exactly as before.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const projection = await vite.ssrLoadModule('/lib/estimate-projection.ts');
const forms = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const policy = await vite.ssrLoadModule('/lib/journey-policy.ts');
const costs = await vite.ssrLoadModule('/lib/own-costs.ts');

const PROPERTY = '33333333-3333-4333-8333-333333333333';
const admin = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin', status: 'active', modules: [] };
const journey = extra => ({ propertyId: PROPERTY, clientId: null, ownerAccount: false, workId: PROPERTY, stage: 'estimate', version: 4, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ...extra });
const publishForm = j => forms.journeyForms(admin, j).find(f => f.key === 'publishEstimate');
const base = { lowRateMinor: '90', mediumRateMinor: '110', highRateMinor: '140', otaFeeBps: '15', managementFeeBps: '20' };

test('the publish form lists the categories in use, each optional, under one heading', () => {
  const form = publishForm(journey({ ownCostCategories: ['Mortgage', 'Service charge'] }));
  const own = form.fields.filter(f => f.name.startsWith('ownCost'));
  assert.deepEqual(own.map(f => [f.name, f.label, f.type, f.required]), [['ownCost0', 'Mortgage, per month, GBP', 'money', false], ['ownCost1', 'Service charge, per month, GBP', 'money', false]]);
  assert.equal(own[0].section, 'Owner’s own costs (optional)');
  assert.deepEqual(publishForm(journey({})).fields.filter(f => f.name.startsWith('ownCost')).map(f => f.label.split(',')[0]), ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Other'], 'the defaults when the journey carries none');
});

test('filled amounts go with the estimate; none leaves the estimate as before', () => {
  const j = journey({ ownCostCategories: ['Mortgage', 'Insurance', 'Other'] });
  const form = publishForm(j);
  const with_ = form.build(forms.workflowValues(form.fields, { ...base, ownCost0: '850', ownCost1: '0', ownCost2: '45.50' }), 'r');
  assert.deepEqual(with_.ownCosts, [{ category: 'Mortgage', monthlyMinor: 85000 }, { category: 'Other', monthlyMinor: 4550 }]);
  assert.equal(policy.journeyActionSchema.safeParse({ ...with_, requestId: crypto.randomUUID() }).success, true);
  const without = form.build(forms.workflowValues(form.fields, base), 'r');
  assert.equal('ownCosts' in without, false);
  assert.equal(Object.keys(without).some(k => k.startsWith('ownCost')), false);
});

test('the server refuses repeated or impossible costs', () => {
  const publish = ownCosts => policy.journeyActionSchema.safeParse({ action: 'publishEstimate', requestId: crypto.randomUUID(), propertyId: PROPERTY, version: 1, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], ownCosts }).success;
  assert.equal(publish([{ category: 'Mortgage', monthlyMinor: 1 }]), true);
  assert.equal(publish([{ category: 'Mortgage', monthlyMinor: 1 }, { category: 'mortgage', monthlyMinor: 2 }]), false);
  assert.equal(publish([{ category: 'Mortgage', monthlyMinor: -1 }]), false);
  assert.equal(publish([{ category: 'Mortgage', monthlyMinor: 10_000_001 }]), false);
  assert.equal(publish(Array.from({ length: 13 }, (_, i) => ({ category: 'Cost ' + i, monthlyMinor: 1 }))), false);
});

test('net profit: income after fees minus the monthly costs, per month and per year', () => {
  const estimate = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, occupancyBps: 7000, directBookingBps: 1000, otaFeeBps: 1500, managementFeeBps: 2000,
    ownCosts: [{ category: 'Mortgage', monthlyMinor: 85000 }, { category: 'Insurance', monthlyMinor: 4000 }, { category: 'Other', monthlyMinor: 0 }] };
  const e = projection.readEstimate(estimate), result = projection.project(e, projection.startingChoices(e));
  const net = projection.netProfit(estimate, result);
  assert.deepEqual(net.costs.map(c => c.category), ['Mortgage', 'Insurance'], 'a zero amount is not shown');
  assert.equal(net.monthlyCostsMinor, 89000);
  assert.equal(net.yearlyNetMinor, result.ownerMinor - 89000 * 12);
  assert.equal(net.monthlyNetMinor, Math.round(net.yearlyNetMinor / 12));
  // Old estimates, and estimates without the fees (no earnings to take the costs from), show no net profit.
  const { ownCosts, ...old } = estimate;
  assert.equal(projection.netProfit(old, result), null);
  const noFees = { ...estimate }; delete noFees.otaFeeBps; delete noFees.managementFeeBps;
  const r2 = projection.project(projection.readEstimate(noFees), projection.startingChoices(projection.readEstimate(noFees)));
  assert.equal(projection.netProfit(noFees, r2), null);
  assert.equal(projection.netProfit({ ...estimate, ownCosts: 'nonsense' }, result), null, 'unreadable costs are ignored');
  assert.equal(ownCosts.length, 3);
});

test('both screens show it, in plain words', async () => {
  for (const file of ['mobile/src/LiveEstimate.tsx', 'app/estimate/estimate-view.tsx']) {
    const source = await fs.readFile(file, 'utf8');
    assert.match(source, /netProfit\(estimate, result\)/, file);
    assert.match(source, /Estimated net profit per month/, file);
    assert.match(source, /Estimated net profit per year/, file);
    assert.doesNotMatch(source, /—/, file);
  }
  assert.deepEqual(costs.ownCostCategories({ ownCostCategories: [] }), ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Other']);
});
