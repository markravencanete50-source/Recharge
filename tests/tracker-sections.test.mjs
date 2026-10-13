import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The pilot adapters: purchase orders and licensing drawn as tracker items. Phases and check names
// are the ones the database sets (supabase/migrations/20261010180000_team_beta_owner_steps.sql).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { trackerItemFor, trackerItemsFor, trackerStamp } = await vite.ssrLoadModule('/lib/tracker-sections.ts');
const { purchaseTrackerItem } = await vite.ssrLoadModule('/lib/tracker-purchases.ts');
const { licensingTrackerItem } = await vite.ssrLoadModule('/lib/tracker-licensing.ts');

const NOW = new Date('2026-10-12T12:00:00Z');
const PROPERTIES = {
  p1: { name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA' },
  p2: { name: 'Harbour cottage', address: '' },
};
const form = (key, title, unavailable) => ({ key, title, ...(unavailable ? { unavailable } : {}) });
const ctx = (over = {}) => ({ property: id => PROPERTIES[id], forms: () => [], now: NOW, owner: false, ...over });
const work = (kind, data, over = {}) => ({ workId: 'w1', propertyId: 'p1', moduleId: 'm', title: 'T', kind, status: 'waiting', version: 3, assigneeId: null, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-11T09:30:00Z', updatedBy: 'Morag Reid', updatedEvent: null, data, ...over });
const purchase = (phase, over = {}, data = {}) => work('purchase', { requirements: 'From the clean report:\n6 × Toilet roll\n2 × Bin bags', budgetMinor: 3000, ...(phase ? { phase } : {}), ...data }, over);
const licence = (phase, data = {}, over = {}) => work('licensing', { ...(phase ? { phase } : {}), ...data }, over);
const states = item => item.steps.map(s => s.state);

test('a purchase moves through its five steps by phase', () => {
  const cases = [
    ['requested', {}, ['done', 'current', 'todo', 'todo', 'todo'], 'Requested', 'Budget approval', 'Accounts', 1],
    ['approved', { approvedAmountMinor: 2800 }, ['done', 'done', 'current', 'todo', 'todo'], 'Approved', 'Place the order', 'Accounts', 2],
    ['ordered', { approvedAmountMinor: 2800, supplier: 'Costco', orderReference: 'PO-77' }, ['done', 'done', 'done', 'current', 'todo'], 'Ordered', 'Delivery', 'Ready', 3],
    ['delivered', { approvedAmountMinor: 2800, supplier: 'Costco', orderReference: 'PO-77', receivedOn: '2026-10-10' }, ['done', 'done', 'done', 'done', 'current'], 'Delivered', 'Check against the supplier invoice', 'Accounts', 4],
  ];
  for (const [phase, data, expected, status, next, waiting, done] of cases) {
    const item = purchaseTrackerItem(purchase(phase, {}, data), ctx());
    assert.deepEqual(states(item), expected, phase);
    assert.equal(item.status.label, status, phase);
    assert.equal(item.status.tone, 'wait', phase);
    assert.equal(item.nextStep, next, phase);
    assert.deepEqual(item.nextAction, { label: 'Waiting for ' + waiting }, phase);
    assert.deepEqual(item.progress, { done, total: 5 }, phase);
    assert.equal(item.closed, false, phase);
    assert.equal(item.section, 'purchases');
  }
});

test('a reconciled purchase is complete at 100 percent', () => {
  const item = purchaseTrackerItem(purchase('reconciled', { status: 'completed' }, { approvedAmountMinor: 2800 }), ctx());
  assert.deepEqual(states(item), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(item.progress, { done: 5, total: 5 });
  assert.deepEqual(item.status, { label: 'Done', tone: 'good' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  // An old completed purchase with no phase reads the same.
  const old = purchaseTrackerItem(purchase(null, { status: 'completed' }), ctx());
  assert.deepEqual(old.progress, { done: 5, total: 5 });
  assert.equal(old.status.label, 'Done');
});

test('a cancelled purchase is closed with the bad tone and no current step', () => {
  const item = purchaseTrackerItem(purchase('approved', { status: 'cancelled' }, { approvedAmountMinor: 2800 }), ctx({ forms: () => [form('recordOrder', 'Record the order')] }));
  assert.deepEqual(item.status, { label: 'Cancelled', tone: 'bad' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  assert.equal(item.nextStep, 'Cancelled');
  assert.deepEqual(states(item), ['done', 'done', 'todo', 'todo', 'todo']);
});

test('the purchase title is the first line of the items, with the full items in the details', () => {
  const item = purchaseTrackerItem(purchase('ordered', {}, { approvedAmountMinor: 2800, supplier: 'Costco', orderReference: 'PO-77' }), ctx());
  assert.equal(item.title, '6 × Toilet roll');
  const labels = item.details.map(d => d.label);
  assert.deepEqual(labels, ['Items', 'Budget', 'Approved amount', 'Supplier', 'Order reference']);
  const get = l => item.details.find(d => d.label === l).value;
  assert.match(get('Items'), /Toilet roll[\s\S]*Bin bags/);
  assert.equal(get('Budget'), '£30.00');
  assert.equal(get('Approved amount'), '£28.00');
  assert.equal(get('Supplier'), 'Costco');
  const delivered = purchaseTrackerItem(purchase('delivered', {}, { receivedOn: '2026-10-10' }), ctx());
  assert.ok(delivered.details.some(d => d.label === 'Received on'));
  assert.equal(delivered.steps[3].detail, 'Received Sat 10 Oct');
  assert.equal(purchaseTrackerItem(purchase('requested', {}, { requirements: '' }), ctx()).title, 'T');
});

test('the invoice step offers the supplier invoice first, then the reconcile', () => {
  const both = [form('recordPurchaseInvoice', 'Record the supplier invoice'), form('reconcilePurchase', 'Reconcile the delivered purchase')];
  const first = purchaseTrackerItem(purchase('delivered'), ctx({ forms: () => both }));
  assert.equal(first.steps[4].actionKey, 'recordPurchaseInvoice');
  const onlyReconcile = purchaseTrackerItem(purchase('delivered'), ctx({ forms: () => [form('recordPurchaseInvoice', 'x', 'No'), form('reconcilePurchase', 'Reconcile the delivered purchase')] }));
  assert.equal(onlyReconcile.steps[4].actionKey, 'reconcilePurchase');
  assert.deepEqual(onlyReconcile.nextAction, { label: 'Reconcile the delivered purchase', actionKey: 'reconcilePurchase' });
  assert.deepEqual(purchaseTrackerItem(purchase('requested'), ctx()).steps.map(s => s.actionKey), [undefined, 'approvePurchase', 'recordOrder', 'recordDelivery', 'recordPurchaseInvoice']);
});

test('licensing moves through three steps by phase', () => {
  const cases = [
    [null, ['current', 'todo', 'todo'], 'To apply', 'Submit the application', 0],
    ['to_apply', ['current', 'todo', 'todo'], 'To apply', 'Submit the application', 0],
    ['applied', ['done', 'current', 'todo'], 'Applied', 'Record the safety checks', 1],
    ['checks_done', ['done', 'done', 'current'], 'Checks done', 'Record the licence grant', 2],
  ];
  for (const [phase, expected, status, next, done] of cases) {
    const data = phase === 'checks_done' ? { checks: { gasSafety: true, electrical: true, alarms: true, legionella: true, epc: true, insurance: true } } : {};
    const item = licensingTrackerItem(licence(phase, data), ctx());
    assert.deepEqual(states(item), expected, String(phase));
    assert.deepEqual(item.status, { label: status, tone: 'wait' }, String(phase));
    assert.equal(item.nextStep, next, String(phase));
    assert.deepEqual(item.nextAction, { label: 'Waiting for Guest relations' }, String(phase));
    assert.deepEqual(item.progress, { done, total: 3 }, String(phase));
    assert.equal(item.section, 'licensing');
  }
});

test('a granted licence with all six checks is complete and lists them', () => {
  const checks = { gasSafety: true, electrical: true, alarms: true, legionella: true, epc: true, insurance: true };
  const item = licensingTrackerItem(licence('granted', { checks, authority: 'City of Edinburgh Council', applicationReference: 'APP-9', submittedOn: '2026-09-01', reference: 'LIC-1', grantedOn: '2026-10-05' }, { status: 'completed' }), ctx());
  assert.deepEqual(states(item), ['done', 'done', 'done']);
  assert.deepEqual(item.progress, { done: 3, total: 3 });
  assert.deepEqual(item.status, { label: 'Granted', tone: 'good' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  const list = item.steps[1].checks;
  assert.deepEqual(list.map(c => c.key), ['gasSafety', 'electrical', 'alarms', 'legionella', 'epc', 'insurance']);
  assert.ok(list.every(c => c.done));
  assert.equal(item.title, 'Licence application, City of Edinburgh Council');
  assert.deepEqual(item.details.map(d => d.label), ['Authority', 'Application reference', 'Submitted on', 'Licence reference', 'Granted on']);
});

test('the six checks always show as a list, ticked from data.checks', () => {
  const item = licensingTrackerItem(licence('applied', { checks: { gasSafety: true, epc: true } }), ctx());
  const list = item.steps[1].checks;
  assert.equal(list.length, 6);
  assert.deepEqual(list.filter(c => c.done).map(c => c.key), ['gasSafety', 'epc']);
  assert.equal(item.steps[0].checks, undefined);
  assert.equal(licensingTrackerItem(licence(null), ctx()).steps[1].checks.length, 6);
});

test('a grant recorded with no checks marks the checks step skipped and still reads complete', () => {
  const item = licensingTrackerItem(licence('granted', { submittedOn: '2026-09-01', reference: 'LIC-1', grantedOn: '2026-10-05' }, { status: 'completed' }), ctx());
  assert.deepEqual(states(item), ['done', 'skipped', 'done']);
  assert.deepEqual(item.progress, { done: 2, total: 2 });
  assert.ok(item.steps[1].checks.every(c => !c.done));
  assert.equal(item.steps[2].detail, 'Ref LIC-1, granted Mon 5 Oct');
  assert.equal(item.closed, true);
});

test('a grant with no application recorded marks the application step skipped, with or without checks', () => {
  const checks = { gasSafety: true, electrical: true, alarms: true, legionella: true, epc: true, insurance: true };
  const bare = licensingTrackerItem(licence('granted', { reference: 'LIC-1', grantedOn: '2026-10-05' }, { status: 'completed' }), ctx());
  assert.deepEqual(states(bare), ['skipped', 'skipped', 'done']);
  assert.deepEqual(bare.progress, { done: 1, total: 1 });
  const checked = licensingTrackerItem(licence('granted', { checks, reference: 'LIC-1', grantedOn: '2026-10-05' }, { status: 'completed' }), ctx());
  assert.deepEqual(states(checked), ['skipped', 'done', 'done']);
  assert.deepEqual(checked.progress, { done: 2, total: 2 });
  const applied = licensingTrackerItem(licence('granted', { checks, authority: 'Council', applicationReference: 'A1', submittedOn: '2026-09-01' }, { status: 'completed' }), ctx());
  assert.deepEqual(states(applied), ['done', 'done', 'done']);
});

test('a cancelled licence is closed with the bad tone', () => {
  const item = licensingTrackerItem(licence('applied', {}, { status: 'cancelled' }), ctx());
  assert.deepEqual(item.status, { label: 'Cancelled', tone: 'bad' });
  assert.equal(item.closed, true);
  assert.deepEqual(states(item), ['done', 'todo', 'todo']);
  assert.equal(item.nextAction, null);
});

test('a kind with no adapter returns null', () => {
  for (const kind of ['maintenance', 'cleaning', 'routine_visit', 'purchase_delivery', 'inspection', 'nonsense'])
    assert.equal(trackerItemFor(work(kind, {}), ctx()), null, kind);
  assert.equal(trackerItemFor(purchase('requested'), ctx()).section, 'purchases');
  assert.equal(trackerItemFor(licence('applied'), ctx()).section, 'licensing');
});

test('direct bookings and re-listings are reachable from the registry', () => {
  assert.equal(trackerItemFor(work('direct_booking', { phase: 'follow_up' }), ctx()).section, 'direct_bookings');
  assert.equal(trackerItemFor(work('relisting', { phase: 'relisting' }), ctx()).section, 'relisting');
  const list = [work('direct_booking', { phase: 'follow_up' }, { workId: 'd1' }), work('relisting', {}, { workId: 'r1' }), purchase('requested', { workId: 'p1' })];
  assert.deepEqual(trackerItemsFor(list, ctx(), 'direct_bookings').map(i => i.id), ['d1']);
  assert.deepEqual(trackerItemsFor(list, ctx(), 'relisting').map(i => i.id), ['r1']);
});

test('the preventative section is built from a role and hidden from owners', () => {
  const visit = work('routine_visit', { visitType: 'garden', checklist: ['Mow the lawn'] }, { workId: 'v1', dueOn: '2026-10-20', title: 'Garden visit' });
  const rows = trackerItemsFor([visit], ctx({ role: 'ready' }), 'preventative');
  assert.deepEqual(rows.map(i => i.section), ['preventative']);
  assert.deepEqual(trackerItemsFor([visit], ctx({ role: 'ready', owner: true }), 'preventative'), []);
  // A single routine visit is not drawn on its own: its row belongs to the plan.
  assert.equal(trackerItemFor(visit, ctx({ role: 'ready' })), null);
});

test('the address falls back to the property name, then to a placeholder', () => {
  const full = trackerItemFor(purchase('requested'), ctx());
  assert.equal(full.address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(full.propertyName, 'Leith flat');
  const noAddress = trackerItemFor(purchase('requested', { propertyId: 'p2' }), ctx());
  assert.equal(noAddress.address, 'Harbour cottage');
  assert.equal(noAddress.propertyName, 'Harbour cottage');
  const unknown = trackerItemFor(licence('applied', {}, { propertyId: 'gone' }), ctx());
  assert.equal(unknown.address, 'Unknown property');
  assert.equal(unknown.propertyId, 'gone');
});

test('the next action reflects the forms this person may use', () => {
  const approve = form('approvePurchase', 'Approve the purchase budget');
  const mine = purchaseTrackerItem(purchase('requested'), ctx({ forms: () => [approve] }));
  assert.deepEqual(mine.nextAction, { label: 'Approve the purchase budget', actionKey: 'approvePurchase' });
  const blocked = purchaseTrackerItem(purchase('requested'), ctx({ forms: () => [form('approvePurchase', 'Approve the purchase budget', 'Not yours')] }));
  assert.deepEqual(blocked.nextAction, { label: 'Waiting for Accounts' });
  const stays = licensingTrackerItem(licence('applied'), ctx({ forms: () => [form('recordSafetyChecks', 'Record the safety checks')] }));
  assert.deepEqual(stays.nextAction, { label: 'Record the safety checks', actionKey: 'recordSafetyChecks' });
  // The forms are asked for this very item.
  const seen = [];
  purchaseTrackerItem(purchase('requested'), ctx({ forms: w => { seen.push(w.workId); return []; } }));
  assert.deepEqual(seen, ['w1']);
});

test('the last update comes from the work item, and owners never get a staff name', () => {
  const staff = purchaseTrackerItem(purchase('requested', { updatedEvent: 'operations.updateOperation.approvePurchase' }), ctx());
  assert.equal(staff.lastUpdate.at, '2026-10-11T09:30:00Z');
  assert.equal(staff.lastUpdate.by, 'Morag Reid');
  assert.equal(trackerStamp(staff, { now: NOW, owner: false }), 'Yesterday 10:30 · Morag Reid');
  const owner = purchaseTrackerItem(purchase('requested'), ctx({ owner: true }));
  assert.equal(owner.lastUpdate.by, null);
  assert.equal(trackerStamp(owner, { now: NOW, owner: true }), 'Yesterday 10:30 · Recharge');
  assert.equal(purchaseTrackerItem(purchase('requested', { updatedAt: undefined, createdAt: undefined }), ctx()).lastUpdate, null);
  // Older servers send no person or event at all.
  const bare = purchase('requested');
  delete bare.updatedBy; delete bare.updatedEvent;
  assert.equal(purchaseTrackerItem(bare, ctx()).lastUpdate.by, null);
});

test('the item carries what the row and sheet need', () => {
  const w = purchase('ordered', {}, { supplier: 'Costco', orderReference: 'PO-77' });
  const item = trackerItemFor(w, ctx());
  assert.equal(item.id, 'w1');
  assert.equal(item.workId, 'w1');
  assert.equal(item.version, 3);
  assert.equal(item.source, w);
  assert.equal(item.propertyId, 'p1');
  for (const word of ['Leith Walk', 'Toilet roll', 'Costco', 'PO-77', 'Ordered']) assert.ok(item.search.includes(word), word);
  assert.ok(!item.search.includes('Morag'));
});

test('trackerItemsFor keeps only adapted kinds, can filter by section and sorts open items first', () => {
  const list = [
    work('maintenance', {}, { workId: 'm1' }),
    purchase('reconciled', { workId: 'done', status: 'completed' }),
    purchase('delivered', { workId: 'late' }),
    purchase('requested', { workId: 'early' }),
    licence('applied', {}, { workId: 'lic' }),
  ];
  const all = trackerItemsFor(list, ctx());
  // Open first by earliest current step (early and lic both at step 2, same update time, so by id), then late (step 5), then the closed one.
  assert.deepEqual(all.map(i => i.id), ['early', 'lic', 'late', 'done']);
  assert.ok(!all.some(i => i.id === 'm1'));
  assert.deepEqual(trackerItemsFor(list, ctx(), 'licensing').map(i => i.id), ['lic']);
  assert.deepEqual(trackerItemsFor(list, ctx(), 'onboarding'), []);
});
