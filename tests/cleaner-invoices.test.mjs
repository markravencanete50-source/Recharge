import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Cleaner invoices (20261022000000), the app side: the invoice template, the money and date words, Accounts' to-pay groups,
// the cleaner's figures, the Team route schemas, the notice copy, the role home keys and where the screens are wired.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
after(() => vite.close());
const inv = await vite.ssrLoadModule('/lib/cleaner-invoices.ts');
const { teamsReadSchema, teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { roleHomeSchema, roleFigures } = await vite.ssrLoadModule('/lib/role-home.ts');
const { accountsNeeds } = await vite.ssrLoadModule('/lib/home-needs.ts');
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const line = (n, over = {}) => ({ workId: id(50 + n), cleanOn: `2026-10-0${6 + n}`, propertyName: `Flat ${n}`, amountMinor: 4500, checkoutTime: '10:00', nextArrivalOn: null, nextArrivalTime: null, ...over });
const invoice = (over = {}) => ({
  id: id(1), number: 'RC-CLN-2026-0007', reference: 'RC-CLN-2026-0007', generated: true, cleanerId: id(2), cleanerName: 'Angela Morrison', supplier: 'Angela Morrison',
  status: 'to_approve', queried: false, queryNote: null, queriedAt: null, issueOn: '2026-10-13', periodKind: 'weekly', periodStart: '2026-10-06', periodEnd: '2026-10-12',
  dueOn: '2026-10-20', approvedAt: null, paidOn: null, totalMinor: 123450, currency: 'GBP', version: 1, lineCount: 2,
  lines: [line(0), line(1, { amountMinor: 118950, checkoutTime: null, nextArrivalOn: '2026-10-07', nextArrivalTime: '15:00' })], ...over,
});

test('the invoice template carries the logo, number, status pill, From and Billed to, the table, the total and the footer', () => {
  assert.equal(inv.payInvoiceSchema.parse(invoice()).number, 'RC-CLN-2026-0007');
  const html = inv.invoiceHtml(invoice(), { origin: 'https://app.example' });
  assert.match(html, /<img src="https:\/\/app\.example\/recharge-company-logo\.png" alt="Recharge">/, 'the brand logo');
  assert.match(html, /<div class="word">INVOICE<\/div><div class="number">RC-CLN-2026-0007<\/div>/, 'INVOICE with the number under it');
  assert.match(html, /<div class="status"><span class="pill">Awaiting approval<\/span><\/div>/, 'an unpaid invoice has the chip');
  assert.doesNotMatch(html, /Status:/, 'no separate status line');
  assert.match(inv.invoiceHtml(invoice({ status: 'approved' })), /<span class="pill">Due Tue 20 Oct<\/span>/);
  assert.match(inv.invoiceHtml(invoice({ queried: true })), /<span class="pill">Awaiting approval · queried<\/span>/);
  assert.match(html, /<h2>From<\/h2><p>Angela Morrison<\/p>/);
  assert.match(html, /<h2>Billed to<\/h2><p>Recharge Stays<\/p>/);
  assert.match(html, /<thead><tr><th>Date<\/th><th>Property<\/th><th>Times<\/th><th class="num">Rate<\/th><\/tr><\/thead>/);
  assert.match(html, /thead\{display:table-header-group\}/, 'the table head repeats on every page');
  assert.match(html, /<td class="date">Tue 6 Oct<\/td><td>Flat 0<\/td><td class="times">Check-out 10:00<\/td><td class="num">£45\.00<\/td>/);
  assert.match(html, /Next guests 15:00/);
  const gap = inv.invoiceHtml(invoice({ lines: [line(0), line(2, { checkoutTime: null })] }));
  assert.match(gap, /<td class="times none" aria-label="No times">–<\/td>/, 'a line with no times shows a muted dash');
  assert.equal(inv.invoiceDoc(invoice({ lines: [line(2, { checkoutTime: null })] })).showTimes, false, 'no times column when no line has times');
  assert.match(html, /£1,189\.50/, 'money with thousands separators');
  assert.match(html, /<span>Total due<\/span><span class="num">£1,234\.50<\/span>/);
  assert.match(html, /Thank you for keeping our homes guest-ready\./);
  assert.match(html, /@page\{size:A4 portrait/);
  assert.match(html, /counter\(page\) " of " counter\(pages\)/, 'page X of Y');
  assert.match(html, /Recharge Stays · RC-CLN-2026-0007/);
  assert.match(html, /Tue 13 Oct 2026/);
  assert.match(html, /6–12 Oct 2026/);
  assert.match(html, /Tue 20 Oct 2026/);
  assert.match(html, /color-scheme:light/, 'the paper is always light');
  assert.doesNotMatch(html, /\b(sort code|account number|IBAN|undefined|null|NaN)\b/i, 'no bank details or placeholders');
  assert.doesNotMatch(html, /class="stamp"/, 'no stamp until paid');
});

test('a paid invoice shows the paid pill, the forest stamp and Total paid; HTML is escaped', () => {
  const html = inv.invoiceHtml(invoice({ status: 'paid', paidOn: '2026-10-17', cleanerName: 'A <b>&', supplier: 'A <b>&' }));
  assert.doesNotMatch(html, /class="pill"|Status:/, 'paid says so once with the stamp and once in the facts, no chip or status line');
  assert.equal((html.match(/Sat 17 Oct 2026/g) ?? []).length, 2, 'the paid date: the stamp and the Paid on fact');
  assert.match(html, /<div class="stamp" aria-hidden="true">PAID<small>/);
  assert.match(html, /<span>Total paid<\/span>/);
  assert.match(html, /A &lt;b&gt;&amp;/);
  assert.doesNotMatch(html, /A <b>&/);
  assert.match(html, /<dt>Paid on<\/dt>/, 'the due date gives way to the paid date');
  assert.equal(inv.statusLine({ status: 'approved', paidOn: null, queried: false }), 'Approved');
  assert.equal(inv.statusOf({ status: 'to_approve', paidOn: null, queried: true }).label, 'To approve · queried');
  assert.equal(inv.invoiceFileName({ number: 'RC-CLN-2026-0007' }), 'RC-CLN-2026-0007.html');
});

test('the screen paper and the download share one document model', () => {
  const doc = inv.invoiceDoc(invoice());
  assert.equal(doc.from, 'Angela Morrison');
  assert.equal(doc.billedTo, 'Recharge Stays');
  assert.deepEqual(doc.facts.map(f => f.label), ['Issue date', 'Period', 'Cleans', 'Due date']);
  assert.deepEqual(doc.lines.map(l => l.date), ['Tue 6 Oct', 'Wed 7 Oct']);
  assert.equal(doc.total, '£1,234.50');
  assert.equal(doc.totalLabel, 'Total due');
  const source = read('mobile/src/CleanerInvoices.tsx');
  assert.match(source, /invoiceDoc\(/, 'InvoicePaper draws from invoiceDoc');
  assert.match(source, /INVOICE_PAPER/);
  assert.match(source, /invoiceHtml\(/, 'Download writes the same template');
  assert.match(source, /CompanyLogo/);
});

test('dates, periods and money read the British way', () => {
  assert.equal(inv.longDay('2026-10-06'), 'Tue 6 Oct 2026');
  assert.equal(inv.shortDay('2026-10-06'), 'Tue 6 Oct');
  assert.equal(inv.periodLabel('2026-10-06', '2026-10-12', 'weekly'), '6–12 Oct 2026');
  assert.equal(inv.periodLabel('2026-09-28', '2026-10-04', 'weekly'), '28 Sep – 4 Oct 2026');
  assert.equal(inv.periodLabel('2026-10-01', '2026-10-31', 'monthly'), 'October 2026');
  assert.equal(inv.money(123450), '£1,234.50');
});

test('to pay is grouped by when it falls due, with a total per cleaner and an overall total', () => {
  const today = '2026-10-15'; // Thursday
  const list = [
    invoice({ id: id(3), number: 'A', status: 'approved', dueOn: '2026-10-14', totalMinor: 1000 }),
    invoice({ id: id(4), number: 'B', status: 'approved', dueOn: '2026-10-18', totalMinor: 2000 }),
    invoice({ id: id(5), number: 'C', status: 'approved', dueOn: '2026-10-18', totalMinor: 500, cleanerId: id(9), cleanerName: 'Ben' }),
    invoice({ id: id(6), number: 'D', status: 'approved', dueOn: '2026-10-28', totalMinor: 3000 }),
    invoice({ id: id(7), number: 'E', status: 'to_approve', dueOn: '2026-10-18', totalMinor: 9999 }),
    invoice({ id: id(8), number: 'F', status: 'paid', paidOn: '2026-10-14', dueOn: '2026-10-18', totalMinor: 9999 }),
  ];
  const out = inv.toPayGroups(list, today);
  assert.deepEqual(out.groups.map(g => g.label), ['Overdue', 'To pay this week', 'To pay this month']);
  assert.equal(out.totalMinor, 6500);
  assert.equal(out.count, 4);
  const week = out.groups[1];
  assert.deepEqual(week.byCleaner.map(c => [c.name, c.totalMinor]), [['Angela Morrison', 2000], ['Ben', 500]]);
  assert.equal(week.totalMinor, 2500);
  assert.deepEqual(inv.toApprove(list).map(i => i.number), ['E']);
  assert.equal(inv.dueBucket('2026-11-02', today), 'later');
});

test('the cleaner sees earnings, waiting and projected with the agreed words', () => {
  const e = inv.earningsSchema.parse({ cleanerId: id(2), paidThisMonthMinor: 33100, paidThisYearMinor: 120000, waitingMinor: 9000, waitingApprovedMinor: 4500, waitingToApproveMinor: 4500, waitingCount: 2,
    periodKind: 'weekly', periodStart: '2026-10-12', periodEnd: '2026-10-18', rateMinor: 4500, acceptedNotInvoicedMinor: 9000, acceptedNotInvoicedCount: 2, unpricedCount: 0, upcomingCount: 3, upcomingMinor: 13500, projectedMinor: 22500 });
  const f = inv.earningsFigures(e);
  assert.equal(inv.PROJECTED_LABEL, 'Projected, if all your cleans are accepted');
  assert.equal(f.projected.label, inv.PROJECTED_LABEL);
  assert.equal(f.projected.value, '£225.00');
  assert.equal(f.earnings.value, '£331.00');
  assert.match(f.earnings.detail, /£1,200\.00 this year/);
  assert.equal(f.waiting.label, 'Waiting to be paid');
  assert.match(f.waiting.detail, /2 invoices/);
});

test('the Team route accepts the pay reads and actions, and only well formed ones', () => {
  for (const section of ['payInvoices', 'payEarnings', 'paySettings']) assert.equal(teamsReadSchema.safeParse({ section }).success, true, section);
  assert.equal(teamsReadSchema.safeParse(inv.payInvoiceQuery(id(1))).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: 'payInvoice' }).success, false, 'an invoice read names the invoice');
  assert.equal(teamsReadSchema.safeParse({ section: 'payInvoices', invoiceId: id(1) }).success, false);
  const i = invoice();
  assert.equal(teamsActionSchema.safeParse(inv.approveInvoiceAction({ requestId: id(10), invoice: i })).success, true);
  assert.equal(teamsActionSchema.safeParse(inv.queryInvoiceAction({ requestId: id(10), invoice: i, note: ' Which flat on the 7th? ' })).success, true);
  assert.equal(teamsActionSchema.safeParse(inv.markPaidAction({ requestId: id(10), invoice: i, paidOn: '2026-10-15' })).success, true);
  assert.equal(teamsActionSchema.safeParse(inv.payPeriodAction({ requestId: id(10), cleanerId: id(2), period: 'monthly', version: 0 })).success, true);
  assert.equal(teamsActionSchema.safeParse({ ...inv.payPeriodAction({ requestId: id(10), cleanerId: id(2), period: 'monthly', version: 0 }), period: 'daily' }).success, false);
  const server = read('lib/workspace-finance-server.ts');
  assert.match(server, /workspace_cleaner_pay_read/);
  assert.match(server, /workspace_cleaner_pay_action/);
});

test('the notices have copy and carry no money in the push words', () => {
  for (const event of ['cleaning.invoice_ready', 'cleaning.invoice_approved', 'cleaning.invoice_queried', 'cleaning.invoice_paid']) {
    const c = noticeCopy(event);
    assert.ok(c.title && c.message, event);
    assert.doesNotMatch(c.title + c.message, /£/, event);
  }
  assert.match(read('lib/notice-details.ts'), /cleaning\.invoice_ready/);
});

test('role home keeps its old keys and adds the pay figures', () => {
  const base = role => ({ role, today: '2026-10-15', weekStart: '2026-10-12', month: '2026-10' });
  const cleaner = roleHomeSchema.parse({ ...base('cleans'), payPaidThisMonthMinor: 33100, payWaitingMinor: 9000, payProjectedMinor: 22500 });
  const pay = roleFigures(cleaner).find(f => f.key === 'pay');
  assert.ok(pay, 'the cleaner pay tile');
  assert.match(String(pay.detail), /waiting/);
  assert.ok(roleFigures(roleHomeSchema.parse(base('cleans'))).find(f => f.key === 'pay'), 'an older home with no pay keys still shows the tile');
  const home = roleHomeSchema.parse({ ...base('accounts'), cleanerInvoicesToApprove: 2, cleanerInvoicesToApproveMinor: 50000, cleanerInvoicesToPay: 3, cleanerInvoicesToPayMinor: 70000, cleanerInvoicesDueThisWeek: 1 });
  assert.ok(roleFigures(home).find(f => f.key === 'cleanerPay'), 'Accounts sees cleaners to pay');
  const needs = accountsNeeds(home);
  assert.deepEqual(needs.map(n => [n.key, n.label, n.count]), [['cleanerInvoices', 'cleaner invoices to approve', 2], ['cleanerPay', 'cleaner invoice to pay this week', 1]]);
  assert.match(read('lib/home-needs.ts'), /section: 'Cleaner invoices to pay'/);
});

test('the screens are wired where people look for them', () => {
  const screens = read('mobile/src/CleanerInvoices.tsx');
  for (const title of ['Your pay', "Your cleaners' invoices", 'Cleaner invoices to approve', 'Cleaner invoices to pay']) assert.ok(screens.includes(`title="${title}"`), title);
  assert.match(screens, /Download/);
  assert.match(screens, /Mark paid/);
  assert.match(screens, /Query/);
  const cleans = read('mobile/src/LiveCleans.tsx');
  assert.match(cleans, /<CleanerPay p=\{p\}/);
  assert.match(cleans, /<CleanerInvoicesReadOnly/);
  assert.match(cleans, /<PayPeriodSheet/);
  assert.match(read('mobile/src/LiveAccountsWork.tsx'), /canPayCleaners && <AccountsCleanerPay p=\{p\} \/>/);
  assert.match(read('worker/index.ts'), /securityRpc\('workspace_cleaner_invoice_run', \{\}\)/, 'the hourly worker run');
});
