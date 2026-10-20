import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The owner's estimate explorer uses the same sums as the team's estimate model.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { readEstimate, startingChoices, project, directBookingGain, hasFees, snap, OCCUPANCY_RANGE } = await vite.ssrLoadModule('/lib/estimate-projection.ts');
const { workflowValues, journeyForms } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());

const published = { lowRateMinor: 10000, mediumRateMinor: 12000, highRateMinor: 15000, occupancyBps: 7000, directBookingBps: 1000, otaFeeBps: 1500, managementFeeBps: 1800, comments: 'x', comparables: [] };

test('projection matches the database estimate model', () => {
  const e = readEstimate(published);
  const p = project(e, { scenario: 'medium', occupancyBps: 7000, directBookingBps: 1000 });
  // Database: gross = rate × nights × occupancy; platform fee on the non-direct share; management fee on gross.
  assert.equal(p.grossMinor, Math.round(12000 * 365 * 7000 / 10000));
  assert.equal(p.grossMinor, 3066000);
  assert.equal(p.platformFeesMinor, Math.round(3066000 * 9000 * 1500 / 100000000));
  assert.equal(p.managementFeesMinor, Math.round(3066000 * 1800 / 10000));
  assert.equal(p.ownerMinor, 3066000 - 413910 - 551880);
  assert.equal(p.monthlyOwnerMinor, Math.round(p.ownerMinor / 12));
  assert.equal(p.occupiedNights, 256);
});

test('scenario, occupancy and booking mix all move the result the right way', () => {
  const e = readEstimate(published), c = startingChoices(e);
  assert.deepEqual(c, { scenario: 'medium', occupancyBps: 7000, directBookingBps: 1000 });
  const base = project(e, c).ownerMinor;
  assert.ok(project(e, { ...c, scenario: 'low' }).ownerMinor < base);
  assert.ok(project(e, { ...c, scenario: 'high' }).ownerMinor > base);
  assert.ok(project(e, { ...c, occupancyBps: 8000 }).ownerMinor > base);
  assert.ok(project(e, { ...c, directBookingBps: 3000 }).ownerMinor > base, 'more direct bookings, fewer platform fees');
  assert.equal(directBookingGain(e, { ...c, directBookingBps: 0 }), 0);
  assert.ok(directBookingGain(e, c) > 0);
});

test('without published fees, only booking income is shown', () => {
  const e = readEstimate({ lowRateMinor: 10000, mediumRateMinor: 12000, highRateMinor: 15000 });
  assert.equal(hasFees(e), false);
  const p = project(e, startingChoices(e));
  assert.equal(p.grossMinor, 3285000, 'starts at 75% occupancy (Alex, was 70%)');
  assert.equal(p.ownerMinor, null);
  assert.equal(p.platformFeesMinor, null);
  assert.equal(directBookingGain(e, startingChoices(e)), null);
});

test('unusable estimates are ignored rather than shown wrong', () => {
  assert.equal(readEstimate(null), null);
  assert.equal(readEstimate({ lowRateMinor: 'x' }), null);
  assert.equal(readEstimate({ lowRateMinor: 0, mediumRateMinor: 0, highRateMinor: 0 }), null);
  assert.equal(readEstimate({ ...published, otaFeeBps: 20000 }), null);
});

test('starting choices snap to the slider steps and range', () => {
  assert.equal(snap(7230, OCCUPANCY_RANGE), 7000);
  assert.equal(snap(9900, OCCUPANCY_RANGE), 9500);
  assert.equal(snap(100, OCCUPANCY_RANGE), 3000);
  assert.deepEqual(startingChoices(readEstimate({ ...published, occupancyBps: 6800, directBookingBps: 7000 })), { scenario: 'medium', occupancyBps: 7000, directBookingBps: 5000 });
});

test('percent fields are kept as basis points', () => {
  const fields = [{ name: 'fee', label: 'Fee', type: 'percent', required: false }];
  assert.deepEqual(workflowValues(fields, { fee: '18.5' }), { fee: 1850 });
  assert.deepEqual(workflowValues(fields, { fee: '15%' }), { fee: 1500 });
  assert.deepEqual(workflowValues(fields, { fee: '' }), { fee: undefined });
  assert.throws(() => workflowValues(fields, { fee: '101' }), /100% or less/);
  assert.throws(() => workflowValues(fields, { fee: 'abc' }), /valid percentage/);
});

test('the team publishes the assumptions with the estimate', () => {
  const admin = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin', modules: [] };
  const j = { propertyId: '22222222-2222-4222-8222-222222222222', clientId: '33333333-3333-4333-8333-333333333333', workId: '44444444-4444-4444-8444-444444444444', stage: 'enquiry', version: 2, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null };
  const form = journeyForms(admin, j).find(f => f.key === 'publishEstimate');
  const values = workflowValues(form.fields, { lowRateMinor: '100', mediumRateMinor: '120', highRateMinor: '150', occupancyBps: '70', otaFeeBps: '15', managementFeeBps: '18', directBookingBps: '' });
  const body = form.build(values, 'r');
  assert.equal(body.occupancyBps, 7000);
  assert.equal(body.managementFeeBps, 1800);
  assert.equal('directBookingBps' in body, false, 'blank assumptions are left out');
});
