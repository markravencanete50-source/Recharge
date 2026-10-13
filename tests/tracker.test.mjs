import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The shared tracker's pure helpers: the update stamp in UK time, who last touched an item (and
// what owners see instead), the next action, progress, and the order items are listed in.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { lastUpdateOf, updateStamp, updateLine, nextActionOf, progressOf, sortTracker, addressOf } = await vite.ssrLoadModule('/lib/tracker.ts');

const NOW = new Date('2026-10-12T12:00:00Z');
const step = (key, state) => ({ key, label: key, state });
const item = (id, over = {}) => ({ id, section: 'purchases', source: null, propertyId: null, address: 'B street', propertyName: 'B', title: 'T', status: { label: 'Open', tone: 'wait' }, closed: false, nextStep: '', nextAction: null, lastUpdate: null, progress: null, steps: [], details: [], search: '', ...over });
const at = iso => ({ at: iso, by: null, what: null });

test('the stamp is in UK time on both sides of the clocks changing', () => {
  const stamp = iso => updateStamp({ at: iso, by: 'Morag Reid', what: null }, new Date('2026-12-01T12:00:00Z'));
  assert.equal(stamp('2026-03-28T14:05:00Z'), '28 Mar, 14:05 · Morag Reid'); // GMT
  assert.equal(stamp('2026-03-29T14:05:00Z'), '29 Mar, 15:05 · Morag Reid'); // BST began that morning
  assert.equal(stamp('2026-10-24T14:05:00Z'), '24 Oct, 15:05 · Morag Reid'); // still BST
  assert.equal(stamp('2026-10-25T14:05:00Z'), '25 Oct, 14:05 · Morag Reid'); // GMT again
});

test('Today and Yesterday follow the UK day, not the UTC day', () => {
  assert.equal(updateStamp({ at: '2026-10-12T13:05:00Z', by: 'Morag Reid', what: null }, NOW), 'Today 14:05 · Morag Reid');
  // 23:30 UTC on the 11th is 00:30 on the 12th in Britain in October.
  assert.equal(updateStamp(at('2026-10-11T23:30:00Z'), NOW), 'Today 00:30 · Automatic');
  assert.equal(updateStamp(at('2026-10-11T08:00:00Z'), NOW), 'Yesterday 09:00 · Automatic');
  // 23:30 UTC on the 12th is already the 13th in Britain, so the 12th is Yesterday.
  assert.equal(updateStamp(at('2026-10-12T10:00:00Z'), new Date('2026-10-12T23:30:00Z')), 'Yesterday 11:00 · Automatic');
  assert.equal(updateStamp(at('2026-10-05T13:05:00Z'), NOW), '5 Oct, 14:05 · Automatic');
  assert.equal(updateStamp(at('2025-12-03T10:00:00Z'), NOW), '3 Dec 2025, 10:00 · Automatic');
});

test('a missing person or time still reads sensibly', () => {
  assert.equal(updateStamp(at('2026-10-12T13:05:00Z'), NOW), 'Today 14:05 · Automatic');
  assert.equal(updateStamp({ at: '2026-10-12T13:05:00Z', by: '  ', what: null }, NOW), 'Today 14:05 · Automatic');
  assert.equal(updateStamp(null, NOW), 'No update yet');
  assert.equal(updateStamp(undefined, NOW), 'No update yet');
  assert.equal(updateStamp({ at: 'not a date', by: 'Morag Reid', what: null }, NOW), 'Morag Reid');
});

test('owners read Recharge, never a staff name', () => {
  const named = { at: '2026-10-12T13:05:00Z', by: 'Morag Reid', what: null };
  assert.equal(updateStamp(named, NOW, true), 'Today 14:05 · Recharge');
  assert.equal(updateStamp(at('2026-10-12T13:05:00Z'), NOW, true), 'Today 14:05 · Recharge');
  assert.ok(!updateStamp(named, NOW, true).includes('Morag'));
});

test('a row reads the stamp and then what changed; owners get the stamp with no name and no step', () => {
  const u = { at: '2026-10-12T13:05:00Z', by: 'Morag Reid', what: 'Invoice recorded' };
  assert.equal(updateLine(u, NOW), 'Today 14:05 · Morag Reid · Invoice recorded');
  assert.equal(updateLine({ ...u, what: null }, NOW), 'Today 14:05 · Morag Reid');
  assert.equal(updateLine({ ...u, what: '  ' }, NOW), 'Today 14:05 · Morag Reid');
  assert.equal(updateLine(u, NOW, true), 'Today 14:05 · Recharge');
  assert.ok(!updateLine(u, NOW, true).includes('Morag'));
  assert.equal(updateLine(null, NOW), 'No update yet');
});

test('the last update is any change, falling back to when the item was created', () => {
  assert.deepEqual(lastUpdateOf({ updatedAt: '2026-10-12T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', updatedBy: 'Morag Reid', updatedEvent: 'operations.updateOperation.approvePurchase' }),
    { at: '2026-10-12T09:00:00Z', by: 'Morag Reid', what: 'Purchase approved' });
  assert.deepEqual(lastUpdateOf({ createdAt: '2026-10-01T09:00:00Z' }), { at: '2026-10-01T09:00:00Z', by: null, what: null });
  assert.deepEqual(lastUpdateOf({ updatedAt: '2026-10-12T09:00:00Z', updatedBy: null, updatedEvent: null }), { at: '2026-10-12T09:00:00Z', by: null, what: null });
  assert.equal(lastUpdateOf({}), null);
  assert.equal(lastUpdateOf({ updatedAt: '2026-10-12T09:00:00Z', updatedEvent: 'workspace_work_items.update' }).what, 'Updated');
});

test('the last update time is the later of the item and its latest activity', () => {
  const base = { updatedAt: '2026-10-12T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', updatedBy: 'Aileen Accounts', updatedEvent: 'finance.purchase_invoice_recorded' };
  // Accounts record an invoice at 15:00 after Ready's delivery at 09:00: the person and time go together.
  assert.equal(lastUpdateOf({ ...base, lastActivityAt: '2026-10-12T14:00:00Z' }).at, '2026-10-12T14:00:00Z');
  assert.equal(lastUpdateOf({ ...base, lastActivityAt: '2026-10-12T14:00:00Z' }).by, 'Aileen Accounts');
  // Compared as moments, so different offsets still order correctly.
  assert.equal(lastUpdateOf({ ...base, lastActivityAt: '2026-10-12T09:30:00+00:00' }).at, '2026-10-12T09:30:00+00:00');
  assert.equal(lastUpdateOf({ ...base, updatedAt: '2026-10-12T11:00:00+01:00', lastActivityAt: '2026-10-12T09:30:00Z' }).at, '2026-10-12T11:00:00+01:00');
  assert.equal(lastUpdateOf({ ...base, lastActivityAt: '2026-10-12T08:00:00Z' }).at, '2026-10-12T09:00:00Z');
  // Missing or unreadable activity times change nothing.
  for (const lastActivityAt of [undefined, null, '', 'not a date']) assert.equal(lastUpdateOf({ ...base, lastActivityAt }).at, '2026-10-12T09:00:00Z', String(lastActivityAt));
  // An unreadable item time loses to a readable activity time, and with neither the old fallbacks apply.
  assert.equal(lastUpdateOf({ ...base, updatedAt: 'not a date', lastActivityAt: '2026-10-12T14:00:00Z' }).at, '2026-10-12T14:00:00Z');
  assert.equal(lastUpdateOf({ createdAt: '2026-10-01T09:00:00Z', lastActivityAt: null }).at, '2026-10-01T09:00:00Z');
  assert.equal(lastUpdateOf({ createdAt: '2026-10-01T09:00:00Z', lastActivityAt: '2026-10-02T09:00:00Z' }).at, '2026-10-02T09:00:00Z');
  assert.equal(lastUpdateOf({ lastActivityAt: null }), null);
  assert.equal(lastUpdateOf({ updatedAt: 'not a date', createdAt: '2026-10-01T09:00:00Z' }).at, '2026-10-01T09:00:00Z');
  assert.equal(lastUpdateOf({ updatedAt: 'not a date', createdAt: 'also bad' }).at, 'not a date');
  // The trigger rows still read as a plain "Updated", whichever time wins.
  assert.equal(lastUpdateOf({ ...base, updatedEvent: 'workspace_work_items.update', lastActivityAt: '2026-10-12T14:00:00Z' }).what, 'Updated');
  assert.notEqual(lastUpdateOf({ ...base, lastActivityAt: '2026-10-12T14:00:00Z' }).what, 'Updated', 'a named event keeps its own label');
});

test('the next action is the first form this person may use, else who is being waited on', () => {
  const forms = [{ key: 'approvePurchase', title: 'Approve the budget', unavailable: 'Only Accounts can approve.' }, { key: 'recordOrder', title: 'Record the order' }, { key: 'x', title: 'Other' }];
  assert.deepEqual(nextActionOf(forms, 'Accounts'), { label: 'Record the order', actionKey: 'recordOrder' });
  assert.deepEqual(nextActionOf([forms[0]], 'Accounts'), { label: 'Waiting for Accounts' });
  assert.deepEqual(nextActionOf([], 'Ready'), { label: 'Waiting for Ready' });
  assert.equal(nextActionOf([], null), null);
  assert.equal(nextActionOf([], undefined), null);
  assert.equal(nextActionOf([forms[0]]), null);
});

test('progress counts finished steps and leaves skipped ones out', () => {
  assert.deepEqual(progressOf([step('a', 'done'), step('b', 'done'), step('c', 'current'), step('d', 'todo'), step('e', 'todo')]), { done: 2, total: 5 });
  assert.deepEqual(progressOf([step('a', 'done'), step('b', 'skipped'), step('c', 'done')]), { done: 2, total: 2 });
  assert.deepEqual(progressOf([step('a', 'todo')]), { done: 0, total: 1 });
  assert.equal(progressOf([]), null);
  assert.equal(progressOf([step('a', 'skipped')]), null);
});

test('open items come first, earliest step first, longest without an update first', () => {
  const steps = (n, total = 4) => Array.from({ length: total }, (_, i) => step('s' + i, i < n ? 'done' : i === n ? 'current' : 'todo'));
  const items = [
    item('closed-old', { closed: true, steps: steps(4).map(s => ({ ...s, state: 'done' })), lastUpdate: at('2026-09-01T10:00:00Z') }),
    item('late-new', { steps: steps(2), lastUpdate: at('2026-10-10T10:00:00Z') }),
    item('early-new', { steps: steps(0), lastUpdate: at('2026-10-11T10:00:00Z') }),
    item('early-old', { steps: steps(0), lastUpdate: at('2026-10-01T10:00:00Z') }),
    item('early-none', { steps: steps(0), lastUpdate: null }),
    item('late-old', { steps: steps(2), lastUpdate: at('2026-10-02T10:00:00Z') }),
    item('closed-new', { closed: true, lastUpdate: at('2026-10-09T10:00:00Z') }),
  ];
  const before = items.map(i => i.id);
  assert.deepEqual(sortTracker(items).map(i => i.id), ['early-none', 'early-old', 'early-new', 'late-old', 'late-new', 'closed-old', 'closed-new']);
  assert.deepEqual(items.map(i => i.id), before, 'the list passed in is not reordered');
});

test('ties fall back to the address, then the id, so the order is stable', () => {
  const a = item('2', { address: 'A road' }), b = item('1', { address: 'B road' }), c = item('3', { address: 'A road' });
  assert.deepEqual(sortTracker([b, c, a]).map(i => i.id), ['2', '3', '1']);
});

test('the address is the full address, or the property name when there is none', () => {
  assert.equal(addressOf({ address: ' 12 High Street, Perth PH1 5AB ', name: 'High Street' }), '12 High Street, Perth PH1 5AB');
  assert.equal(addressOf({ address: '   ', name: 'High Street' }), 'High Street');
  assert.equal(addressOf({ name: 'High Street' }), 'High Street');
  assert.equal(addressOf({ address: null, name: null }), '');
  assert.equal(addressOf(null), '');
  assert.equal(addressOf(undefined), '');
});
