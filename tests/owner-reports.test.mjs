import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Owners' Home, Approvals and Reports: what is waiting for an owner, the month's figures from live
// bookings, the repair stages after a cost is declined, and the read-only owner route.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { ownerApprovals, propertyProgress } = await vite.ssrLoadModule('/lib/owner-approvals.ts');
const { monthStats, monthlyEarnings, propertyMonth, monthEnd, addMonths, nightsBetween } = await vite.ssrLoadModule('/lib/owner-reports.ts');
const { ownerReadSchema, ownerBookingsSchema } = await vite.ssrLoadModule('/lib/owner-policy.ts');
const { repairStep, canReviseQuote, canCloseRepair, declineNote, repairClosed } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { operationForms } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { backendRouteAllowed } = await vite.ssrLoadModule('/worker/backend-route-policy.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { userId: id(1), role: 'client', status: 'active', fullName: 'Owner', email: 'o@example.com', modules: ['client-dashboard', 'property-onboarding', 'client-property-maintenance'] };
const properties = [{ id: id(10), name: 'Harbour flat', status: 'active' }, { id: id(11), name: 'Glen cottage', status: 'onboarding' }];
const journey = (propertyId, stage, extra = {}) => ({ propertyId, clientId: owner.userId, workId: id(90), stage, version: 3, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ...extra });
const repair = (phase, extra = {}) => ({ workId: id(50), propertyId: id(10), moduleId: 'stays-maintenance-reporting', title: 'Property repair request', kind: 'maintenance', status: 'waiting', version: 2, assigneeId: null, data: { phase, issue: 'Boiler not firing', estimatedCostMinor: 45000, ...extra } });

test('everything waiting for an owner is in one list, and only that', () => {
  const journeys = [journey(id(10), 'live', { form: { repairLimitMinor: 10000, fullRepairPermission: false } }), journey(id(11), 'agreement', { agreementRevision: 2, agreement: 'The agreed terms' })];
  const items = ownerApprovals(owner, [repair('owner_approval'), repair('triage', { issue: 'Already approved' }), repair('owner_declined')], journeys, properties);
  assert.deepEqual(items.map(i => i.kind + ':' + (i.kind === 'repair' ? i.issue : i.step)), ['repair:Boiler not firing', 'onboarding:signAgreement']);
  const [r, a] = items;
  assert.equal(r.limitMinor, 10000); assert.equal(r.propertyName, 'Harbour flat'); assert.equal(r.estimateMinor, 45000);
  assert.match(a.form.description, /The agreed terms/, 'the agreement is shown before signing');
  assert.deepEqual(ownerApprovals({ ...owner, role: 'stays' }, [repair('owner_approval')], journeys, properties), [], 'only owners have approvals');
  assert.deepEqual(ownerApprovals({ ...owner, userId: id(2) }, [], journeys, properties), [], 'another owner\'s onboarding is not theirs');
  const progress = propertyProgress(properties, journeys, items);
  assert.equal(progress[0].live, true);
  assert.equal(progress[1].waitingForYou, true); assert.equal(progress[1].next, 'Read and sign your management agreement.');
});

test('a month\'s earnings, occupancy and nightly rate come from stays checking out', () => {
  const stay = (propertyId, checkIn, checkOut, payoutMinor) => ({ reservationId: id(Math.floor(Math.random() * 1e6)), propertyId, propertyName: 'P', reference: 'R', checkIn, checkOut, nights: nightsBetween({ checkIn, checkOut }, checkIn, checkOut), guests: 2, channel: 'airbnb', channelReference: null, payoutMinor });
  const stays = [stay(id(10), '2026-09-28', '2026-10-03', 50000), stay(id(10), '2026-10-10', '2026-10-14', 40000), stay(id(11), '2026-10-30', '2026-11-02', 30000), stay(id(11), '2026-10-05', '2026-10-07', null)];
  const october = monthStats(stays, '2026-10', 2);
  assert.equal(october.earningsMinor, 90000, 'stays checking out in October');
  assert.equal(october.nights, 2 + 4 + 2 + 2, 'nights inside October only');
  assert.equal(october.available, 62);
  assert.equal(october.averageNightlyMinor, Math.round(90000 / 9), 'payout per night for priced stays');
  assert.equal(monthEnd('2026-02'), '2026-02-28'); assert.equal(addMonths('2026-01', -1), '2025-12');
  const year = monthlyEarnings(stays, '2026-11', 12);
  assert.equal(year.length, 12); assert.equal(year.at(-1).earningsMinor, 30000); assert.equal(year.at(-2).earningsMinor, 90000);
  const byProperty = propertyMonth(stays, [{ propertyId: id(10), propertyName: 'Harbour flat' }, { propertyId: id(11), propertyName: 'Glen cottage' }], '2026-10');
  assert.equal(byProperty[0].earningsMinor, 90000); assert.equal(byProperty[1].bookings, 2);
});

test('owner reports are read only, for dates up to 400 days', () => {
  assert.ok(ownerReadSchema.safeParse({ section: 'bookings', from: '2026-01-01', to: '2026-12-31' }).success);
  assert.ok(!ownerReadSchema.safeParse({ section: 'bookings', from: '2026-01-01', to: '2027-03-01' }).success);
  assert.ok(!ownerReadSchema.safeParse({ section: 'bookings' }).success);
  assert.ok(!ownerReadSchema.safeParse({ section: 'bookings', from: '2026-01-01', to: '2026-01-31', propertyId: id(1) }).success);
  assert.ok(ownerBookingsSchema.safeParse({ from: '2026-10-01', to: '2026-10-31', properties: [], stays: [] }).success);
  for (const path of ['/api/mobile/owner', '/api/workspace/owner']) assert.equal(backendRouteAllowed(path), true, path);
});

test('a declined repair cost is re-quoted or closed by Stays, and management approves above its limit', () => {
  assert.equal(repairStep('admin', 'management_approval'), 'approveManagement');
  assert.equal(repairStep('stays', 'management_approval'), null);
  assert.equal(repairStep('client', 'owner_approval'), 'approveBudget');
  assert.ok(canReviseQuote('stays', 'owner_declined') && canCloseRepair('stays', 'owner_declined') && canCloseRepair('admin', 'management_declined'));
  assert.ok(!canReviseQuote('ready', 'owner_declined') && !canCloseRepair('ready', 'owner_declined') && !canCloseRepair('client', 'owner_declined'));
  assert.equal(declineNote({ phase: 'owner_declined', ownerDeclinedReason: 'Get a second quote' }), 'Owner declined: Get a second quote');
  assert.equal(declineNote({ phase: 'management_declined', managementDeclinedReason: 'Use the spare part' }), 'Management declined: Use the spare part');
  assert.equal(declineNote({ phase: 'triage' }), null);
  assert.ok(repairClosed('closed') && repairClosed('completed') && !repairClosed('owner_declined'));
  const keys = (account, phase) => operationForms(account, repair(phase)).map(f => f.key);
  assert.deepEqual(keys(owner, 'owner_approval'), ['approveBudget', 'declineBudget']);
  assert.deepEqual(keys({ ...owner, role: 'admin' }, 'management_approval'), ['approveManagement', 'declineManagement']);
  assert.deepEqual(keys({ ...owner, role: 'stays' }, 'owner_declined'), ['closeRepair']);
  const approve = operationForms({ ...owner, role: 'admin' }, repair('management_approval'))[0];
  assert.deepEqual(approve.build({ note: '' }, id(3)).data, {}, 'an empty note is left out');
  for (const step of ['declineBudget', 'approveManagement', 'declineManagement', 'closeRepair']) assert.notEqual(noticeCopy('operations.updateOperation.' + step).title, 'Task updated', step);
});
