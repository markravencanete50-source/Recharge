import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Recharge's own invoice document (lib/recharge-invoice.ts, migration 20261022100000): the From block and the legal line read
// from lib/legal-details.ts, Billed to, the key facts, the lines and totals, the terms in one constant, no bank details until
// Lee gives them, the PAID and VOID states, and the bills it is drawn for (owner bills and Receivable) with who may open them.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
after(() => vite.close());
const doc = await vite.ssrLoadModule('/lib/recharge-invoice.ts');
const legal = await vite.ssrLoadModule('/lib/legal-details.ts');
const cleaner = await vite.ssrLoadModule('/lib/cleaner-invoices.ts');
const read = path => readFileSync(path, 'utf8');

const bill = (over = {}) => ({
  source: 'workspace', id: '00000000-0000-4000-8000-000000000001', module: 'onboarding-invoices', reference: 'ONB-2026-014', status: 'issued', issueOn: '2026-10-12', paidOn: null,
  amountMinor: 45000, currency: 'GBP', version: 1, recipientName: 'Fiona Example', propertyName: '14 Example Terrace', propertyAddress: '14 Example Terrace, Edinburgh, EH3 9ZZ',
  workTitle: null, stay: null, ...over,
});

test('From is Recharge Group in bold, the registered address and the legal line, all read from lib/legal-details.ts', () => {
  assert.equal(legal.groupTradingName, 'Recharge Group');
  assert.deepEqual(doc.FROM_BLOCK, { name: 'Recharge Group', lines: ['25 Bothwell Street, Glasgow, G2 6NL', 'Recharge Stays Ltd · Company no. SC799955'] });
  const html = doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill()), { origin: 'https://app.example' });
  assert.match(html, /<h2>From<\/h2><p class="name">Recharge Group<\/p><p>25 Bothwell Street, Glasgow, G2 6NL<\/p><p>Recharge Stays Ltd · Company no\. SC799955<\/p>/);
  assert.match(html, /\.party p\.name\{font-size:12pt;font-weight:600/, 'the name is bold');
  // Never a second copy of the company details: the document reads them.
  const source = read('lib/recharge-invoice.ts');
  for (const detail of ['Bothwell', 'SC799955', 'Recharge Stays Ltd', "'Recharge Group'"]) assert.ok(!source.includes(detail), detail);
  assert.equal((read('lib/legal-details.ts').match(/'Recharge Group'/g) ?? []).length, 1, 'the trading name lives in one place');
});

test('the page: logo band, spaced INVOICE and its number, Billed to, the facts, the striped table, totals, terms, footer', () => {
  const html = doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill()), { origin: 'https://app.example', today: '2026-10-15' });
  assert.match(html, /<img src="https:\/\/app\.example\/recharge-company-logo\.png" alt="Recharge">/);
  assert.match(html, /<div class="word">INVOICE<\/div><div class="number">ONB-2026-014<\/div>/);
  assert.match(html, /letter-spacing:\.32em/);
  assert.match(html, /<h2>Billed to<\/h2><p class="name">Fiona Example<\/p>/);
  assert.match(html, /<dt>Issue date<\/dt><dd>Mon 12 Oct 2026<\/dd>.*<dt>Due date<\/dt><dd>Mon 19 Oct 2026<\/dd>.*<dt>Property<\/dt><dd>14 Example Terrace, Edinburgh, EH3 9ZZ<\/dd>/s);
  assert.match(html, /<span class="pill">Due Mon 19 Oct 2026<\/span>/);
  assert.match(html, /<td>Property onboarding, 14 Example Terrace<\/td><td class="num">£450\.00<\/td>/);
  assert.match(html, /tbody tr:nth-child\(even\) td\{background:/, 'striped');
  assert.match(html, /<span>Subtotal<\/span><span class="num">£450\.00<\/span>.*<span>Total due<\/span><span class="num">£450\.00<\/span>/s);
  assert.match(html, /<h2>Terms<\/h2><p>Payment is due within 7 days of the invoice date\. Please quote the invoice number with your payment\.<\/p>/);
  assert.match(html, /<p class="who">Recharge Group · Recharge Stays Ltd · Company no\. SC799955 · ONB-2026-014<\/p>/);
  assert.match(html, /@bottom-right\{content:"Page " counter\(page\) " of " counter\(pages\)/);
  assert.doesNotMatch(html, /VAT/, 'no VAT: the bills carry none');
  assert.doesNotMatch(html, /\u2014/, "no em dash");
  assert.match(doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill()), { today: '2026-10-20' }), /<span class="pill">Overdue<\/span>/);
});

test('the terms are one constant with the 7-day rule; no bank details until Lee gives them', () => {
  assert.equal(doc.INVOICE_DUE_DAYS, 7);
  assert.equal(doc.DEFAULT_TERMS.invoice, 'Payment is due within 7 days of the invoice date. Please quote the invoice number with your payment.');
  assert.equal(doc.PAYMENT_DETAILS, null);
  // A request for invoice uses the cleaner requests' words exactly, with its own number; the thanks line asks nothing else.
  assert.equal(doc.DEFAULT_TERMS.request, cleaner.REQUEST_TERMS);
  assert.equal(doc.termsFor(doc.DEFAULT_TERMS.request, 'RC-RFI-2026-0007'), cleaner.requestTerms('RC-RFI-2026-0007'));
  assert.equal(doc.termsFor(doc.DEFAULT_TERMS.request, 'RC-RFI-2026-0007'), 'Please send us your invoice for the amount above, quoting reference RC-RFI-2026-0007. We pay valid invoices within 7 days.');
  assert.equal(cleaner.RECHARGE_PARTY.name, legal.groupTradingName, 'one copy of the trading name');
  const html = doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill()));
  assert.doesNotMatch(html, /Payment details|Sort code|IBAN/);
  const withBank = doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill()), { payment: [{ label: 'Sort code', value: '00-00-00' }] });
  assert.match(withBank, /<h2>Payment details<\/h2><dl class="pay"><dt>Sort code<\/dt><dd>00-00-00<\/dd><\/dl>/, 'shown once filled in');
});

test('a paid bill has the PAID stamp with its date and a Paid on fact; a void one says VOID', () => {
  const html = doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill({ status: 'paid', paidOn: '2026-10-14' })));
  assert.match(html, /<div class="stamp" aria-hidden="true">PAID<small>Wed 14 Oct 2026<\/small><\/div>/);
  assert.match(html, /<dt>Paid on<\/dt><dd>Wed 14 Oct 2026<\/dd>/);
  assert.doesNotMatch(html, /<dt>Due date<\/dt>/);
  assert.doesNotMatch(html, /class="pill"/);
  assert.match(html, /<span>Total paid<\/span>/);
  assert.match(doc.rechargeInvoiceHtml(doc.fromWorkspaceInvoice(bill({ status: 'void' }))), /<div class="stamp" aria-hidden="true">VOID<\/div>/);
});

test('each kind of owner bill says what it is for; a direct booking shows its stay as the period', () => {
  const line = over => doc.rechargeInvoiceDoc(doc.fromWorkspaceInvoice(bill(over))).rows[0].description;
  assert.equal(line({}), 'Property onboarding, 14 Example Terrace');
  assert.equal(line({ module: 'maintenance-reconciliation', workTitle: 'Replace boiler valve' }), 'Repair: Replace boiler valve, 14 Example Terrace');
  const direct = doc.rechargeInvoiceDoc(doc.fromWorkspaceInvoice(bill({ module: 'owner-statements', stay: { reference: 'DIR-2210', checkIn: '2026-10-02', checkOut: '2026-10-05' } })));
  assert.equal(direct.rows[0].description, 'Direct booking DIR-2210, 14 Example Terrace');
  assert.deepEqual(direct.facts.find(f => f.label === 'Period'), { label: 'Period', value: '2 to 5 Oct 2026' });
  assert.deepEqual(doc.OWNER_BILL_MODULES, ['onboarding-invoices', 'owner-statements', 'maintenance-reconciliation']);
  assert.equal(doc.isOwnerBill('cleans-invoices'), false);
  assert.equal(doc.isOwnerBill('purchase-order-invoices'), false);
});

test('a Receivable invoice: the client, the stay, a part payment taken off, and never the internal notes or link', () => {
  const row = { itemId: '00000000-0000-4000-8000-000000000002', version: 3, title: 'Direct stay DIR-3012, 10 to 13 Oct', reference: 'RCV-0042', details: 'Chase via WhatsApp', status: 'sent',
    propertyId: null, propertyName: '7 Sample Lane', address: '7 Sample Lane, Glasgow', amountMinor: 60000, settledMinor: 20000, outstandingMinor: 40000, createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-09T09:00:00Z', dueOn: '2026-10-20', overdue: false, ageDays: 6, sentOn: '2026-10-09', link: 'https://pay.example/x', reservationId: null, stayReference: 'DIR-3012',
    checkIn: '2026-10-10', checkOut: '2026-10-13', clientId: null, clientName: 'Sam Sample' };
  const html = doc.rechargeInvoiceHtml(doc.fromReceivable(row), { today: '2026-10-15' });
  assert.match(html, /<h2>Billed to<\/h2><p class="name">Sam Sample<\/p>/);
  assert.match(html, /<span class="pill">Part paid<\/span>/);
  assert.match(html, /<span>Paid so far<\/span><span class="num">−£200\.00<\/span>.*<span>Balance due<\/span><span class="num">£400\.00<\/span>/s);
  assert.doesNotMatch(html, /WhatsApp|pay\.example/);
  assert.match(doc.rechargeInvoiceHtml(doc.fromReceivable({ ...row, status: 'to_send', settledMinor: 0, sentOn: null })), /<span class="pill">To send<\/span>/);
});

test('where the document opens: owner bills on Reports and Accounts, Receivable, and an owner\'s Home; downloads as HTML through the share sheet', () => {
  const sheet = read('mobile/src/RechargeInvoice.tsx');
  assert.match(sheet, /exportReport\(rechargeInvoiceHtml\(invoice, \{ today \}\), rechargeInvoiceFileName\(invoice\), \{ mime: "text\/html", uti: "public\.html" \}\)/);
  assert.doesNotMatch(sheet, /expo-print/);
  assert.match(read('mobile/src/LiveWorkspace.tsx'), /isOwnerBill\(invoice\.module_id\) && <MotionPress[^\n]*setBillOpen\(invoice\.id\)/);
  assert.match(read('mobile/src/AccountsReceivable.tsx'), /<RechargeInvoiceSheet p=\{p\} invoice=\{viewing \? fromReceivable\(viewing\) : null\}/);
  assert.match(read('mobile/src/LiveHome.tsx'), /<DocumentsForYou p=\{p\} \/>/);
  assert.equal(doc.rechargeInvoiceFileName({ number: 'RC-INV-2026-0001', kind: 'invoice' }), 'RC-INV-2026-0001.html');
  // Who may open an owner bill is decided by the database, with the invoice row's own rule (tests/recharge-invoices-database.test.mjs).
  assert.match(read('supabase/migrations/20261022100000_recharge_invoices.sql'), /private\.workspace_owner_bill_module\(i\.module_id\) or not private\.workspace_invoice_visible\(i\)/);
});

test('the look is shared with the cleaner invoice; only its request terms are taken from it', () => {
  const ours = read('lib/recharge-invoice.ts'), theirs = read('lib/cleaner-invoices.ts');
  assert.match(ours, /shares its look with the cleaner invoice in lib\/cleaner-invoices\.ts/);
  assert.deepEqual(ours.match(/import .* from '\.\/cleaner-invoices';/g), ["import { REQUEST_TERMS } from './cleaner-invoices';"]);
  for (const rule of ['.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;', 'tbody tr:nth-child(even) td{background:', '.totals .grand span:last-child{font-size:18pt;font-weight:600;']) {
    assert.ok(ours.includes(rule) && theirs.includes(rule), rule);
  }
});
