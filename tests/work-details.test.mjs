import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// What each kind of work shows in its sheet, the repair guides, and the new forms.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { workDetails } = await vite.ssrLoadModule('/lib/work-details.ts');
const { REPAIR_GUIDES, troubleshootingNote, repairTypeLabel } = await vite.ssrLoadModule('/lib/repair-guides.ts');
const { REPAIR_TYPES } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { operationForms, createOperationForms, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());

const item = (kind, data, status = 'waiting') => ({ workId: '11111111-1111-4111-8111-111111111111', propertyId: '22222222-2222-4222-8222-222222222222', moduleId: 'x', title: 'T', kind, status, version: 1, assigneeId: null, data });
const value = (details, label) => details.find(d => d.label === label)?.value;
const stays = { userId: '33333333-3333-4333-8333-333333333333', role: 'stays', modules: ['listing-health', 'daily-pricing', 'stays-maintenance-reporting'] };

test('repairs show type, urgency and who to contact first', () => {
  const d = workDetails(item('maintenance', { issue: 'No heating', repairType: 'heating', urgent: true, contactFirst: 'Leith Heating 0131 000 0000', warrantyDetails: 'Boiler warranty to 2028' }));
  assert.equal(value(d, 'Repair type'), 'Heating');
  assert.equal(d.find(x => x.label === 'Priority').tone, 'bad');
  assert.equal(value(d, 'Contact first'), 'Leith Heating 0131 000 0000');
  assert.equal(value(d, 'Issue'), 'No heating');
});

test('direct bookings show the offer; re-listings and licences show their stage', () => {
  const offer = workDetails(item('direct_booking', { checkIn: '2027-02-01', checkOut: '2027-02-10', baseAmountMinor: 120000, quoteAmountMinor: 110000, phase: 'quoted' }));
  assert.equal(value(offer, 'Original price'), '£1,200.00');
  assert.equal(value(offer, 'Direct-booking offer'), '£1,100.00');
  assert.match(value(offer, 'Stay'), /1 Feb.*10 Feb/);
  assert.equal(value(workDetails(item('relisting', { reason: 'suspended', platform: 'Airbnb', phase: 'relisting', note: 'New photos' })), 'Why'), 'Listing suspended');
  assert.equal(value(workDetails(item('licensing', { phase: 'applied', authority: 'City of Edinburgh Council' })), 'Stage'), 'Application submitted; safety checks next');
  assert.equal(value(workDetails(item('licensing', {})), 'Stage'), 'Application to submit');
  assert.equal(value(workDetails(item('guest_review', { platform: 'Booking.com', rating: 9, outOf: 10, sentiment: 'positive', summary: 'Great' })), 'Rating'), '9 out of 10');
});

test('every repair type has a guide, and the referral note lists the checks ticked', () => {
  for (const t of REPAIR_TYPES) assert.ok(REPAIR_GUIDES[t]?.checks.length >= 2, t);
  const note = troubleshootingNote('wifi', [REPAIR_GUIDES.wifi.checks[1]], 'Lights flashing orange');
  assert.equal(note, '✓ ' + REPAIR_GUIDES.wifi.checks[1] + '\nLights flashing orange');
  assert.equal(repairTypeLabel('nonsense'), 'Repair');
});

test('the work sheet offers the next stage of each workflow', () => {
  assert.deepEqual(operationForms(stays, item('licensing', {})).map(f => f.key), ['submitApplication', 'recordGranted']);
  assert.deepEqual(operationForms(stays, item('licensing', { phase: 'applied' })).map(f => f.key), ['recordSafetyChecks']);
  assert.deepEqual(operationForms(stays, item('licensing', { phase: 'checks_done' })).map(f => f.key), ['recordGranted']);
  assert.deepEqual(operationForms(stays, item('relisting', { phase: 'to_relist' })).map(f => f.key), ['startRelisting', 'completeHandover']);
  assert.deepEqual(operationForms(stays, item('relisting', { phase: 'relisting' })).map(f => f.key), ['completeHandover']);
  assert.ok(operationForms(stays, item('direct_booking', { phase: 'quoted' })).some(f => f.key === 'recordGuestDecline'));
  const checks = operationForms(stays, item('licensing', { phase: 'applied' }))[0];
  const body = checks.build(workflowValues(checks.fields, { gasSafety: true, electrical: true, alarms: true, legionella: true, epc: true, insurance: true, evidence: 'Certificates filed in the property folder' }), 'r');
  assert.deepEqual(Object.keys(body.data.checks), ['gasSafety', 'electrical', 'alarms', 'legionella', 'epc', 'insurance']);
});

test('Stays can log a guest review from the property', () => {
  const form = createOperationForms(stays, '22222222-2222-4222-8222-222222222222').find(f => f.key === 'guest_review');
  const body = form.build(workflowValues(form.fields, { platform: 'Booking.com', reviewedOn: '2026-10-08', rating: '9', outOf: '10', sentiment: 'positive', summary: 'Spotless and warm', response: '', relist: false }), 'r');
  assert.deepEqual(body.data, { platform: 'Booking.com', reviewedOn: '2026-10-08', rating: 9, outOf: 10, sentiment: 'positive', summary: 'Spotless and warm', relist: false });
});
