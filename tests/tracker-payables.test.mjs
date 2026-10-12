import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Cleaner invoices drawn as tracker items (lib/tracker-payables.ts): steps, status, next action, and what owners never see.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { cleanerInvoiceTrackerItem, cleanerInvoiceTrackerItems, PAYABLES_SECTION, DECIDE_KEY } = await vite.ssrLoadModule('/lib/tracker-payables.ts');
const { updateStamp } = await vite.ssrLoadModule('/lib/tracker.ts');

const NOW = new Date('2026-10-12T12:00:00Z');
const PROPERTIES = { p1: { name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA' }, p2: { name: 'Harbour cottage', address: '' } };
const ctx = (over = {}) => ({ property: id => PROPERTIES[id], now: NOW, owner: false, canDecide: true, ...over });
const line = (n, over = {}) => ({ workId: `00000000-0000-4000-8000-00000000000${n}`, amountMinor: 7000, propertyName: 'Leith flat', propertyId: 'p1', cleanDate: '2026-10-0' + n, ...over });
const invoice = (over = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa', supplier: 'Cara Cleaning', cleanerName: 'Cara Reid', reference: 'CARA-2026-10', invoiceDate: '2026-10-09', totalMinor: 14000, status: 'to_approve',
  lines: [line(1), line(2)], lineCount: 2, note: 'Two October cleans', decisionNote: null, decidedAt: null, createdAt: '2026-10-10T09:00:00Z', version: 1, ...over,
});
const states = item => item.steps.map(s => s.state);

test('a waiting invoice is matched, waits for approval, and Accounts can approve or reject it', () => {
  const item = cleanerInvoiceTrackerItem(invoice(), ctx());
  assert.equal(item.section, 'payables');
  assert.equal(PAYABLES_SECTION, 'payables');
  assert.deepEqual(item.steps.map(s => s.label), ['Invoice received', 'Matched to cleans', 'Approved', 'Paid or settled']);
  assert.deepEqual(states(item), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(item.status, { label: 'To approve', tone: 'wait' });
  assert.equal(item.closed, false);
  assert.equal(item.nextStep, 'Approve or reject the invoice');
  assert.deepEqual(item.nextAction, { label: 'Approve or reject', actionKey: DECIDE_KEY });
  assert.equal(item.steps[2].actionKey, DECIDE_KEY);
  assert.deepEqual(item.progress, { done: 2, total: 4 });
  assert.equal(item.address, '12 Leith Walk, Edinburgh EH6 5AA', 'a property id gives the full address');
  assert.equal(item.propertyId, 'p1');
  assert.equal(item.title, 'Cara Cleaning · CARA-2026-10');
  assert.equal(item.id, '00000000-0000-4000-8000-0000000000aa');
  assert.equal(item.steps[1].detail, '2 cleans, £140.00');
  assert.match(item.search, /Cara Cleaning/);
  assert.match(item.search, /CARA-2026-10/);
});

test('someone who cannot decide sees the invoice waiting on Accounts', () => {
  const item = cleanerInvoiceTrackerItem(invoice(), ctx({ canDecide: false }));
  assert.deepEqual(item.nextAction, { label: 'Waiting for Accounts' });
  assert.equal(item.steps[2].actionKey, undefined);
});

test('an approved invoice is closed, nothing more to do, and says payment is not recorded here', () => {
  const item = cleanerInvoiceTrackerItem(invoice({ status: 'approved', decidedAt: '2026-10-11T10:30:00Z' }), ctx());
  assert.deepEqual(states(item), ['done', 'done', 'done', 'skipped']);
  assert.deepEqual(item.status, { label: 'Approved', tone: 'good' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  assert.equal(item.nextStep, 'Nothing more to do here');
  assert.deepEqual(item.progress, { done: 3, total: 3 }, 'a skipped step does not count');
  assert.match(item.steps[3].detail, /not recorded here/);
  assert.match(item.steps[2].detail, /^Approved /);
});

test('a rejected invoice is closed with the bad tone and its reason', () => {
  const item = cleanerInvoiceTrackerItem(invoice({ status: 'rejected', decisionNote: 'Dates do not match the cleans', decidedAt: '2026-10-11T10:30:00Z' }), ctx());
  assert.deepEqual(item.status, { label: 'Rejected', tone: 'bad' });
  assert.equal(item.closed, true);
  assert.deepEqual(states(item), ['done', 'done', 'skipped', 'skipped']);
  assert.equal(item.nextAction, null);
  const why = item.details.find(d => d.label === 'Why it was rejected');
  assert.equal(why.value, 'Dates do not match the cleans');
  assert.equal(why.tone, 'bad');
});

test('the properties on the invoice make its address', () => {
  const two = cleanerInvoiceTrackerItem(invoice({ lines: [line(1), line(2, { propertyId: 'p2', propertyName: 'Harbour cottage' })] }), ctx());
  assert.equal(two.address, '12 Leith Walk, Edinburgh EH6 5AA and 1 other');
  assert.equal(two.propertyId, null, 'more than one property has no single id');
  // No property id on the line (the screen schema may not carry it): the line's own name is used.
  const named = cleanerInvoiceTrackerItem(invoice({ lines: [line(1, { propertyId: undefined, propertyName: 'Leith flat' })] }), ctx());
  assert.equal(named.address, 'Leith flat');
  // A property with no address held reads as its name.
  assert.equal(cleanerInvoiceTrackerItem(invoice({ lines: [line(1, { propertyId: 'p2', propertyName: 'Harbour cottage' })] }), ctx()).address, 'Harbour cottage');
  const none = cleanerInvoiceTrackerItem(invoice({ lines: [], lineCount: 0 }), ctx());
  assert.equal(none.address, 'No property yet');
  assert.deepEqual(states(none).slice(0, 3), ['done', 'current', 'todo']);
  assert.equal(none.nextStep, 'Match the invoice to the cleans it covers');
});

test('cleans that cost more than the owner is charged are flagged on the invoice', () => {
  const item = cleanerInvoiceTrackerItem(invoice({ lines: [line(1, { overAgreed: true }), line(2)] }), ctx());
  const flag = item.details.find(d => d.label === 'Cost flag');
  assert.match(flag.value, /^1 clean on this invoice cost more than the owner is charged/);
  assert.equal(flag.tone, 'bad');
  assert.match(item.details.find(d => d.label === 'Cleans').value, /above the agreed fee/);
  assert.equal(cleanerInvoiceTrackerItem(invoice(), ctx()).details.find(d => d.label === 'Cost flag'), undefined);
});

test('the update stamp names Accounts for staff and never a person', () => {
  const item = cleanerInvoiceTrackerItem(invoice({ status: 'approved', decidedAt: '2026-10-12T09:15:00Z' }), ctx());
  assert.equal(updateStamp(item.lastUpdate, NOW), 'Today 10:15 · Accounts');
  // Without a decision it is the day the invoice was recorded.
  assert.equal(updateStamp(cleanerInvoiceTrackerItem(invoice(), ctx()).lastUpdate, NOW), '10 Oct, 10:00 · Accounts');
});

test('owners never get the invoice reference, any amount or a cost flag', () => {
  const over = invoice({ lines: [line(1, { overAgreed: true, agreedMinor: 6000 }), line(2)] });
  const staff = cleanerInvoiceTrackerItem(over, ctx());
  // The staff copy carries them, so the absence below is the owner rule and not missing data.
  for (const shown of ['CARA-2026-10', '£140.00', '£70.00', 'above the agreed fee', 'Cost flag']) assert.ok(JSON.stringify(staff).includes(shown), shown + ' is on the staff copy');
  const item = cleanerInvoiceTrackerItem(over, ctx({ owner: true, canDecide: true }));
  const everything = JSON.stringify(item);
  for (const secret of ['CARA-2026-10', '£140.00', '£70.00', '14000', '7000', '6000', 'above the agreed fee', 'Cost flag', 'more than the owner is charged', 'Cara Cleaning', 'Cara Reid']) assert.ok(!everything.includes(secret), secret + ' must not reach an owner');
  assert.equal(item.title, 'Cleaner invoice');
  assert.equal(item.steps[1].detail, '2 cleans', 'the matched step counts the cleans and shows no money');
  assert.deepEqual(item.details.map(d => d.label), ['Invoice date']);
  assert.equal(item.source.totalMinor, 0);
  assert.deepEqual(item.source.lines.map(l => l.amountMinor), [0, 0]);
  assert.ok(item.source.lines.every(l => l.overAgreed === undefined && l.agreedMinor === undefined));
  assert.doesNotMatch(item.search, /CARA|Cara/);
  assert.deepEqual(item.status, { label: 'To approve', tone: 'wait' }, 'where it has got to still shows');
});

test('owners never get a staff name, the cleaner, the notes or the supplier', () => {
  const item = cleanerInvoiceTrackerItem(invoice({ status: 'rejected', decisionNote: 'Not our cleaner', decidedAt: '2026-10-11T10:30:00Z' }), ctx({ owner: true, canDecide: true }));
  const everything = JSON.stringify(item);
  for (const secret of ['Cara Cleaning', 'Cara Reid', 'Two October cleans', 'Not our cleaner']) assert.ok(!everything.includes(secret), secret + ' must not reach an owner');
  assert.equal(item.title, 'Cleaner invoice');
  assert.equal(item.lastUpdate.by, null);
  assert.equal(updateStamp(item.lastUpdate, NOW, true).split(' · ')[1], 'Recharge');
  assert.equal(item.nextAction, null);
  const waiting = cleanerInvoiceTrackerItem(invoice(), ctx({ owner: true, canDecide: true }));
  assert.deepEqual(waiting.nextAction, { label: 'Waiting for Accounts' }, 'an owner can never decide');
  assert.equal(waiting.steps[2].actionKey, undefined);
});

test('waiting invoices are listed before decided ones', () => {
  const list = cleanerInvoiceTrackerItems([
    invoice({ id: '00000000-0000-4000-8000-0000000000b1', status: 'approved', decidedAt: '2026-10-11T10:30:00Z' }),
    invoice({ id: '00000000-0000-4000-8000-0000000000b2' }),
    invoice({ id: '00000000-0000-4000-8000-0000000000b3', status: 'rejected', decisionNote: 'Wrong month', decidedAt: '2026-10-11T10:30:00Z' }),
  ], ctx());
  assert.equal(list[0].id.slice(-2), 'b2');
  assert.deepEqual(list.map(i => i.closed), [false, true, true]);
});
