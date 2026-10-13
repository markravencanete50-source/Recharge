import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Accounts receivable on the screen side: the tracker adapter for an invoice (steps, status, next action,
// waiting-on text), the payment and Record invoice rules, and the wiring of the Receivable tab.
const DASH = String.fromCharCode(0x2014);
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { receivableTrackerItem, receivableTrackerItems, receivableReportSchema, receivableItemSchema, receivableForms, paymentMove, invoiceAction, invoiceFromStay, RECEIVABLE_SECTION }
  = await vite.ssrLoadModule('/lib/tracker-receivable.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const read = name => readFileSync(new URL(`../mobile/src/${name}.tsx`, import.meta.url), 'utf8');
const screen = read('AccountsReceivable'), accounts = read('LiveAccounts');

const NOW = new Date('2026-10-12T12:00:00Z');
const uuid = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (over = {}) => ({
  itemId: uuid(1), version: 3, title: 'Direct stay, 4 Leith Walk', reference: 'INV-1001', details: '', status: 'to_send',
  propertyId: uuid(2), propertyName: 'Leith flat', address: '4 Leith Walk, Edinburgh', amountMinor: 90000, settledMinor: 0, outstandingMinor: 90000,
  createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-09T09:00:00Z', dueOn: '2026-10-20', overdue: false, ageDays: 4, sentOn: null, link: null,
  reservationId: uuid(3), stayReference: 'Stay D1', checkIn: '2026-10-22', checkOut: '2026-10-25', clientId: uuid(4), clientName: 'Client Olive', ...over,
});

test('an invoice to send is at its first step, waiting on Accounts, with Mark sent as the next action', () => {
  const item = receivableTrackerItem(receivableItemSchema.parse(row()), { now: NOW });
  assert.equal(item.section, RECEIVABLE_SECTION);
  assert.equal(RECEIVABLE_SECTION, 'receivable');
  assert.equal(item.id, uuid(1));
  assert.equal(item.address, '4 Leith Walk, Edinburgh');
  assert.equal(item.title, '£900.00 · INV-1001 · Client Olive');
  assert.deepEqual(item.status, { label: 'To send', tone: 'wait' });
  assert.deepEqual(item.steps.map(s => [s.label, s.state]), [['Invoice to send', 'current'], ['Sent', 'todo'], ['Settled', 'todo']]);
  assert.deepEqual(item.progress, { done: 0, total: 3 });
  assert.equal(item.nextStep, 'Send the invoice');
  assert.deepEqual(item.nextAction, { label: 'Mark sent', actionKey: 'markSent' });
  assert.equal(item.closed, false);
  assert.equal(item.version, 3);
  assert.equal(item.lastUpdate.at, '2026-10-09T09:00:00Z');
  assert.equal(item.lastUpdate.by, 'Accounts');
  const detail = Object.fromEntries(item.details.map(d => [d.label, d.value]));
  assert.equal(detail['Invoice number'], 'INV-1001');
  assert.equal(detail.Amount, '£900.00');
  assert.match(detail.Stay, /Stay D1, .*22 Oct.* to .*25 Oct/);
  assert.equal(detail.For, 'Client Olive');
  assert.match(item.search, /INV-1001/);
  assert.match(item.search, /Client Olive/);
});

test('a sent invoice has done two steps and waits for payment from the client', () => {
  const item = receivableTrackerItem(receivableItemSchema.parse(row({ status: 'sent', sentOn: '2026-10-10', ageDays: 2, dueOn: '2026-10-30' })), { now: NOW });
  assert.deepEqual(item.steps.map(s => s.state), ['done', 'done', 'current']);
  assert.deepEqual(item.progress, { done: 2, total: 3 });
  assert.deepEqual(item.status, { label: 'Sent', tone: 'plain' });
  assert.equal(item.nextStep, 'Payment from Client Olive');
  assert.deepEqual(item.nextAction, { label: 'Record payment', actionKey: 'recordPayment' });
  assert.equal(item.steps[1].detail, 'Sent ' + 'Sat 10 Oct');
  const part = receivableTrackerItem(receivableItemSchema.parse(row({ status: 'sent', settledMinor: 30000, outstandingMinor: 60000, sentOn: '2026-10-10' })), { now: NOW });
  assert.deepEqual(part.status, { label: 'Part paid', tone: 'wait' });
  assert.match(part.title, /^£600\.00 still owed/);
  assert.equal(Object.fromEntries(part.details.map(d => [d.label, d.value]))['Paid so far'], '£300.00');
  const late = receivableTrackerItem(receivableItemSchema.parse(row({ status: 'sent', overdue: true, dueOn: '2026-10-01' })), { now: NOW });
  assert.deepEqual(late.status, { label: 'Overdue', tone: 'bad' });
  const noClient = receivableTrackerItem(receivableItemSchema.parse(row({ status: 'sent', clientId: null, clientName: null })), { now: NOW });
  assert.equal(noClient.nextStep, 'Payment from the client');
});

test('an invoice with no property or amount still reads sensibly', () => {
  const item = receivableTrackerItem(receivableItemSchema.parse(row({ propertyId: null, propertyName: null, address: null, amountMinor: null, outstandingMinor: 0, reservationId: null, stayReference: null, checkIn: null, checkOut: null })), { now: NOW });
  assert.equal(item.address, 'Client Olive');
  assert.match(item.title, /^No amount/);
  assert.equal(item.propertyId, null);
  const bare = receivableTrackerItem(receivableItemSchema.parse(row({ propertyId: null, propertyName: null, address: null, clientId: null, clientName: null })), { now: NOW });
  assert.equal(bare.address, 'No property');
  const owner = receivableTrackerItem(receivableItemSchema.parse(row()), { now: NOW, owner: true });
  assert.equal(owner.lastUpdate.by, null, 'no names for owners');
  assert.deepEqual(receivableTrackerItems([row()].map(r => receivableItemSchema.parse(r)), { now: NOW }).map(i => i.id), [uuid(1)]);
  assert.deepEqual(receivableForms({ status: 'to_send' }).map(f => f.key), ['markSent', 'editInvoice']);
  assert.deepEqual(receivableForms({ status: 'sent' }).map(f => f.key), ['recordPayment', 'editInvoice']);
});

test('owners get no money, invoice number, client, notes or link, only where the invoice has got to', () => {
  const full = row({ status: 'sent', settledMinor: 25000, outstandingMinor: 65000, sentOn: '2026-10-10', details: 'Deposit taken in cash', link: 'https://example.com/invoice/INV-1001', overdue: true, dueOn: '2026-10-11' });
  const staff = receivableTrackerItem(receivableItemSchema.parse(full), { now: NOW });
  const item = receivableTrackerItem(receivableItemSchema.parse(full), { now: NOW, owner: true });
  // The staff copy does carry them, so the absence below is the owner rule and not missing data.
  for (const shown of ['INV-1001', 'Client Olive', '£900.00', '£250.00', 'Deposit taken in cash', 'example.com']) assert.ok(JSON.stringify(staff).includes(shown), shown + ' is on the staff copy');
  const everything = JSON.stringify(item);
  for (const secret of ['INV-1001', 'Client Olive', '£900.00', '£250.00', '£650.00', '900.00', 'Deposit taken in cash', 'example.com', 'Stay D1', 'Direct stay, 4 Leith Walk']) assert.ok(!everything.includes(secret), secret + ' must not reach an owner');
  assert.equal(item.title, 'Invoice');
  assert.deepEqual([item.source.amountMinor, item.source.settledMinor, item.source.outstandingMinor, item.source.reference, item.source.clientName, item.source.link], [null, 0, 0, '', null, null]);
  assert.deepEqual(item.details.map(d => d.label).sort(), ['Payment due', 'Property', 'Sent']);
  assert.equal(item.nextStep, 'Payment from the client');
  assert.equal(item.lastUpdate.by, null);
  assert.deepEqual(item.status, { label: 'Overdue', tone: 'bad' }, 'where it has got to still shows');
});

test('the report answer parses as the database sends it', () => {
  const answer = {
    section: 'receivable', toSend: [row()], toSettle: [row({ status: 'sent', itemId: uuid(9) })],
    needsInvoice: [{ reservationId: uuid(5), propertyId: uuid(2), propertyName: 'Leith flat', address: '4 Leith Walk', stayReference: 'Stay D2', checkIn: '2026-11-01', checkOut: '2026-11-03', guests: 2, totalMinor: 64000 }],
    totals: { toSendMinor: 90000, toSettleMinor: 90000, toSendCount: 1, toSettleCount: 1, needsInvoiceCount: 1 },
    options: { clients: [{ clientId: uuid(4), name: 'Client Olive', propertyIds: [uuid(2)] }], stays: [{ reservationId: uuid(5), propertyId: uuid(2), propertyName: 'Leith flat', stayReference: 'Stay D2', channel: 'direct', checkIn: '2026-11-01', checkOut: '2026-11-03', invoiced: false }] },
  };
  const parsed = receivableReportSchema.parse(answer);
  assert.equal(parsed.toSettle[0].status, 'sent');
  assert.equal(parsed.needsInvoice[0].totalMinor, 64000);
  assert.throws(() => receivableReportSchema.parse({ ...answer, toSend: [row({ status: 'paid' })] }));
});

test('a payment adds to what was paid and settles the invoice at its amount', () => {
  const sent = { amountMinor: 80000, settledMinor: 0, outstandingMinor: 80000 };
  assert.deepEqual(paymentMove(sent, 30000), { status: 'sent', settledMinor: 30000 });
  assert.deepEqual(paymentMove({ ...sent, settledMinor: 30000, outstandingMinor: 50000 }, 50000), { status: 'paid', settledMinor: 80000 });
  assert.deepEqual(paymentMove(sent, 80000), { status: 'paid', settledMinor: 80000 });
  assert.match(paymentMove(sent, 80001).error, /more than the £800\.00 still owed/);
  assert.match(paymentMove(sent, 0).error, /Enter the amount received/);
  assert.match(paymentMove(sent, 12.5).error, /Enter the amount received/);
  assert.deepEqual(paymentMove({ amountMinor: null, settledMinor: 0, outstandingMinor: 0 }, 5000), { status: 'paid', settledMinor: 5000 });
});

test('Record invoice builds a saveHubItem the teams schema accepts, or says what is wrong', () => {
  const values = { title: 'Direct stay, 4 Leith Walk', amount: '£640.00', reference: ' INV-3001 ', dueOn: '2026-11-04', propertyId: uuid(2), reservationId: uuid(3), clientId: uuid(4) };
  const built = invoiceAction(values);
  assert.equal(built.error, undefined);
  assert.deepEqual(built.action, { action: 'saveHubItem', kind: 'invoice', title: 'Direct stay, 4 Leith Walk', amountMinor: 64000, reference: 'INV-3001', details: '', dueOn: '2026-11-04', link: null,
    propertyId: null, reservationId: uuid(3), clientId: uuid(4) }, 'with a stay chosen the property comes from the stay');
  teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...built.action });
  const noStay = invoiceAction({ ...values, reservationId: '', clientId: '', dueOn: '' });
  assert.equal(noStay.action.propertyId, uuid(2));
  assert.equal(noStay.action.reservationId, null);
  assert.equal(noStay.action.clientId, null);
  assert.equal(noStay.action.dueOn, null);
  const edit = invoiceAction({ ...values, details: ' Notes ', link: 'https://example.com/i/1' }, { id: uuid(1), version: 4 });
  assert.equal(edit.action.id, uuid(1));
  assert.equal(edit.action.version, 4);
  assert.equal(edit.action.link, 'https://example.com/i/1');
  assert.equal(edit.action.details, 'Notes');
  teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...edit.action });
  assert.match(invoiceAction({ ...values, title: ' ' }).error, /what the invoice is for/);
  assert.match(invoiceAction({ ...values, amount: '' }).error, /amount in pounds/);
  assert.match(invoiceAction({ ...values, amount: '0' }).error, /amount in pounds/);
  assert.match(invoiceAction({ ...values, amount: '1,000,000' }).error, /amount in pounds/);
  assert.match(invoiceAction({ ...values, dueOn: '4/11/2026' }).error, /year-month-day/);
  assert.match(invoiceAction({ ...values, dueOn: '2026-02-31' }).error, /year-month-day/);
});

test('a suggested direct booking starts the form with its stay and total', () => {
  const form = invoiceFromStay({ reservationId: uuid(5), propertyId: uuid(2), stayReference: 'Stay D2', checkIn: '2026-11-01', checkOut: '2026-11-03', totalMinor: 64000 });
  assert.equal(form.title, 'Direct stay Stay D2, 2026-11-01 to 2026-11-03');
  assert.equal(form.amount, '640.00');
  assert.equal(form.reservationId, uuid(5));
  assert.equal(form.propertyId, uuid(2));
  const unknown = invoiceFromStay({ reservationId: uuid(5), propertyId: uuid(2), stayReference: null, checkIn: '2026-11-01', checkOut: '2026-11-03', totalMinor: null });
  assert.equal(unknown.amount, '');
  assert.equal(invoiceAction(unknown).error, 'Enter the amount in pounds, for example 450.00.', 'a stay with no known total needs its amount typed');
});

test('the Receivable tab is wired for finance roles and uses only the existing hub actions', () => {
  assert.match(accounts, /import \{ AccountsReceivable \} from "\.\/AccountsReceivable"/);
  assert.match(accounts, /receivable: "Receivable"/);
  // The sections are one Pills row (round 6): Receivable, Performance and AirCover only for finance roles.
  assert.match(accounts, /\.filter\(v => \(v !== "receivable" && v !== "performance" && v !== "aircover"\) \|\| \(isFinanceRole\(role\)/);
  assert.match(accounts, /view === "receivable" && <AccountsReceivable p=\{p\} account=\{account\} properties=\{properties\} \/>/);
  assert.match(screen, /readFinance\(\{ section: "receivable" \}\)/);
  // Anyone outside finance gets the notice and nothing else: the guard comes before any list is drawn.
  assert.match(screen, /if \(!allowed\) return <Notice text="Receivable is for Accounts and management\." p=\{p\} \/>;/);
  assert.ok(screen.indexOf('if (!allowed) return') < screen.indexOf('<Section title="To send"'), 'the guard comes before the lists');
  assert.match(screen, /const allowed = isFinanceRole\(account\.role\);/);
  assert.match(screen, /if \(active && allowed\) void load\(\)/);
  const actions = [...screen.matchAll(/action: "(\w+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ['moveHubItem'], 'every other write goes through invoiceAction, a saveHubItem');
  assert.match(screen, /invoiceAction\(v, form\?\.edit\)/);
  assert.match(screen, /status: "sent"/);
  assert.match(screen, /settledMinor: move\.settledMinor/);
  assert.match(screen, /writeTeams/);
  assert.doesNotMatch(screen, /writeFinance/);
});

test('the screen shows To send, To settle, Needs an invoice and Record invoice, in a calm style', () => {
  assert.match(screen, /<Section title="To send" count=\{totals\?\.toSendCount \?\? 0\}/);
  assert.match(screen, /<Section title="To settle" count=\{totals\?\.toSettleCount \?\? 0\}/);
  assert.match(screen, /<Section title="Needs an invoice" count=\{report\.totals\.needsInvoiceCount\}/);
  assert.match(screen, /<Button label="Record invoice" icon="plus" primary p=\{p\} onPress=\{\(\) => setForm\(\{ values: EMPTY \}\)\}/);
  assert.match(screen, /<Sheet palette=\{p\} visible=\{!!item\} onClose=\{onClose\} title="Record payment"/);
  assert.match(screen, /tags=\{\[\["Needs an invoice", "wait"\]\]\} onPress=\{\(\) => suggest\(s\)\}/);
  assert.doesNotMatch(screen, /window\.(alert|confirm|prompt)\b|\bAlert\.alert\b|(?<![.\w$])(alert|confirm|prompt)\s*\(/, 'no dialogs');
  assert.match(screen, /<TrackerList p=\{p\} items=\{toSend\}/);
  assert.match(screen, /<TrackerList p=\{p\} items=\{toSettle\}/);
  assert.match(screen, /<TrackerDetailSheet/);
  assert.doesNotMatch(screen, /gradient|LinearGradient|shadow|Animated\.loop|withRepeat/i);
  assert.ok(!screen.includes(DASH) && !accounts.includes(DASH), 'no em dashes');
});
