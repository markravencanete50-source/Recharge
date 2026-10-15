import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Requests for invoice (20261022000000), the app side: the document, the outcomes, the history, the money and date words,
// Accounts' to-pay groups, the cleaner's figures, the Team route schemas, the notice copy, the role home keys and where the
// screens are wired.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
after(() => vite.close());
const inv = await vite.ssrLoadModule('/lib/cleaner-invoices.ts');
const { teamsReadSchema, teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { roleHomeSchema, roleFigures } = await vite.ssrLoadModule('/lib/role-home.ts');
const { accountsNeeds } = await vite.ssrLoadModule('/lib/home-needs.ts');
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const line = (n, over = {}) => ({ workId: id(50 + n), cleanOn: `2026-10-0${6 + n}`, propertyName: `Flat ${n}`, rateMinor: 4500, amountMinor: 4500, outcome: 'completed', ...over });
const invoice = (over = {}) => ({
  id: id(1), number: 'RC-RFI-2026-0007', reference: 'RC-RFI-2026-0007', generated: true, cleanerId: id(2), cleanerName: 'Angela Morrison', supplier: 'Angela Morrison',
  status: 'to_approve', queried: false, queryNote: null, queriedAt: null, issueOn: '2026-10-13', periodKind: 'weekly', periodStart: '2026-10-06', periodEnd: '2026-10-12',
  dueOn: '2026-10-20', approvedAt: null, paidOn: null, totalMinor: 123450, currency: 'GBP', version: 1, lineCount: 2,
  lines: [line(0), line(1, { rateMinor: 118950, amountMinor: 118950 })], ...over,
});
// One clean of each outcome: £45.00 completed, £45.25 partially successful (£22.63), £40.00 unsuccessful (£0.00).
const mixed = (over = {}) => invoice({ totalMinor: 6763, lineCount: 3, lines: [line(0), line(1, { rateMinor: 4525, amountMinor: 2263, outcome: 'partial' }), line(2, { rateMinor: 4000, amountMinor: 0, outcome: 'unsuccessful' })], ...over });

test('a request for invoice: REQUEST FOR INVOICE, from Recharge Group (address and company from lib/legal-details.ts) to the cleaner', async () => {
  const { legalDetails } = await vite.ssrLoadModule('/lib/legal-details.ts');
  assert.equal(inv.payInvoiceSchema.parse(invoice()).number, 'RC-RFI-2026-0007');
  const html = inv.invoiceHtml(invoice(), { origin: 'https://app.example' });
  assert.match(html, /<img src="https:\/\/app\.example\/recharge-company-logo\.png" alt="Recharge">/, 'the brand logo');
  assert.match(html, /<div class="word">REQUEST FOR INVOICE<\/div><div class="number">RC-RFI-2026-0007<\/div>/, 'the title with the number under it');
  assert.doesNotMatch(html, />INVOICE</, 'never titled INVOICE');
  assert.match(html, /<title>Request for invoice RC-RFI-2026-0007 · Angela Morrison<\/title>/);
  assert.equal(inv.RECHARGE_PARTY.name, 'Recharge Group');
  assert.deepEqual([...inv.RECHARGE_PARTY.lines], [legalDetails.registeredAddress, `${legalDetails.legalName} · Company no. ${legalDetails.companyNumber}`]);
  assert.match(html, /<h2>From<\/h2><p class="name">Recharge Group<\/p><p class="line">25 Bothwell Street, Glasgow, G2 6NL<\/p><p class="line">Recharge Stays Ltd · Company no\. SC799955<\/p>/);
  assert.match(html, /<h2>To<\/h2><p class="name">Angela Morrison<\/p>/);
  assert.doesNotMatch(html, /Billed to/);
  assert.equal((read('lib/cleaner-invoices.ts').match(/SC799955|Bothwell/g) ?? []).length, 0, 'no second copy of the legal details');
  assert.match(html, /<div class="status"><span class="pill">Awaiting approval<\/span><\/div>/, 'an unpaid request has the chip');
  assert.match(inv.invoiceHtml(invoice({ status: 'approved' })), /<span class="pill">Due Tue 20 Oct<\/span>/);
  assert.match(inv.invoiceHtml(invoice({ queried: true })), /<span class="pill">Awaiting approval · queried<\/span>/);
  assert.match(html, /<thead><tr><th>Date<\/th><th>Property<\/th><th>Outcome<\/th><th class="num">Rate<\/th><\/tr><\/thead>/, 'Date, Property, Outcome, Rate');
  assert.doesNotMatch(html, /Times|Check-out|Next guests/, 'no times column');
  assert.match(html, /thead\{display:table-header-group\}/, 'the table head repeats on every page');
  assert.match(html, /<tr class="completed"><td class="date">Tue 6 Oct<\/td><td>Flat 0<\/td><td class="outcome"><span class="label">Completed<\/span><\/td><td class="num">£45\.00<\/td><\/tr>/);
  assert.match(html, /£1,189\.50/, 'money with thousands separators');
  assert.match(html, /<span>2 cleans at full rate<\/span><span class="num">£1,234\.50<\/span>/);
  assert.doesNotMatch(html, /Outcome adjustments/, 'no adjustment row when every clean is completed');
  assert.match(html, /<span>Amount to invoice<\/span><span class="num">£1,234\.50<\/span>/);
  assert.match(html, /<section class="terms"><h2>Terms<\/h2><p>Please send us your invoice for the amount above, quoting reference RC-RFI-2026-0007\. We pay valid invoices within 7 days\.<\/p><\/section>/);
  assert.match(inv.REQUEST_TERMS, /\{number\}/, 'one constant for Lee to replace');
  assert.equal(inv.PAY_WITHIN_DAYS, 7);
  assert.match(html, /Thank you for keeping our homes guest-ready\./);
  assert.match(html, /@page\{size:A4 portrait/);
  assert.match(html, /counter\(page\) " of " counter\(pages\)/, 'page X of Y');
  assert.match(html, /Recharge Group · RC-RFI-2026-0007/);
  for (const words of ['Tue 13 Oct 2026', '6–12 Oct 2026', 'Tue 20 Oct 2026']) assert.ok(html.includes(words), words);
  assert.match(html, /color-scheme:light/, 'the paper is always light');
  assert.doesNotMatch(html, /\b(sort code|account number|IBAN|undefined|null|NaN)\b/i, 'no bank details or placeholders');
  assert.doesNotMatch(html, /class="stamp"/, 'no stamp until paid');
});

test('outcomes: completed pays the rate, partially successful half (half a penny up), unsuccessful nothing; the totals say so', () => {
  assert.deepEqual([inv.outcomeMinor(4500, 'completed'), inv.outcomeMinor(4500, null), inv.outcomeMinor(4500, 'partial'), inv.outcomeMinor(4525, 'partial'), inv.outcomeMinor(1, 'partial'), inv.outcomeMinor(4500, 'unsuccessful')], [4500, 4500, 2250, 2263, 1, 0]);
  assert.deepEqual(Object.values(inv.OUTCOME_LABEL), ['Completed', 'Partially successful', 'Unsuccessful']);
  assert.equal(inv.lineOutcome({ outcome: null }), 'completed', 'none set counts as completed');
  const html = inv.invoiceHtml(mixed());
  assert.match(html, /<tr class="partial"><td class="date">Wed 7 Oct<\/td><td>Flat 1<\/td><td class="outcome"><span class="label">Partially successful<\/span><span class="note">Half of £45\.25<\/span><\/td><td class="num">£22\.63<\/td><\/tr>/);
  assert.match(html, /<tr class="unsuccessful"><td class="date">Thu 8 Oct<\/td><td>Flat 2<\/td><td class="outcome"><span class="label">Unsuccessful<\/span><span class="note">Rate £40\.00, not paid<\/span><\/td><td class="num">£0\.00<\/td><\/tr>/);
  assert.match(html, /<span>3 cleans at full rate<\/span><span class="num">£130\.25<\/span><\/div><div class="row sub"><span>Outcome adjustments<\/span><span class="num">−£62\.62<\/span>/);
  assert.match(html, /<span>Amount to invoice<\/span><span class="num">£67\.63<\/span>/);
  const doc = inv.invoiceDoc(mixed());
  assert.deepEqual(doc.lines.map(l => [l.outcome, l.amount]), [['completed', '£45.00'], ['partial', '£22.63'], ['unsuccessful', '£0.00']]);
  assert.equal(inv.payInvoiceSchema.safeParse(mixed({ lines: [line(0, { outcome: 'great' })] })).success, false);
});

test('a paid request keeps the PAID stamp and the Paid on box, and the amount to invoice; HTML is escaped', () => {
  const html = inv.invoiceHtml(invoice({ status: 'paid', paidOn: '2026-10-17', cleanerName: 'A <b>&', supplier: 'A <b>&' }));
  assert.doesNotMatch(html, /class="pill"|Status:/, 'no chip or status line once paid');
  assert.equal((html.match(/Sat 17 Oct 2026/g) ?? []).length, 2, 'the paid date: the stamp and the Paid on fact');
  assert.match(html, /<div class="stamp" aria-hidden="true">PAID<small>/);
  assert.match(html, /<span>Amount to invoice<\/span>/);
  assert.match(html, /A &lt;b&gt;&amp;/);
  assert.doesNotMatch(html, /A <b>&/);
  assert.match(html, /<dt>Paid on<\/dt>/, 'the due date gives way to the paid date');
  assert.equal(inv.statusLine({ status: 'approved', paidOn: null, queried: false }), 'Approved');
  assert.equal(inv.statusOf({ status: 'to_approve', paidOn: null, queried: true }).label, 'To approve · queried');
  assert.equal(inv.invoiceFileName({ number: 'RC-RFI-2026-0007' }), 'Request-for-invoice-RC-RFI-2026-0007.html');
});

test('the history reads in words', () => {
  const at = '2026-10-13T23:30:00Z'; // already the 14th in London
  assert.equal(inv.historyDay(at), 'Wed 14 Oct 2026');
  const h = (over) => inv.payHistorySchema.parse({ at, actorName: 'Mia Manager', ...over });
  assert.equal(inv.historyLine(h({ event: 'issued', actorName: null, cleans: 7, totalMinor: 33100 })), 'Issued for 7 cleans, £331.00');
  assert.equal(inv.historyLine(h({ event: 'outcome', from: 'completed', to: 'partial', propertyName: '12 Leith St', cleanOn: '2026-10-07', amountMinor: 2250, totalMinor: 30850 })),
    'Mia Manager set 12 Leith St, Wed 7 Oct to Partially successful (was Completed). Amount to invoice now £308.50');
  assert.equal(inv.historyLine(h({ event: 'queried', note: 'Which flat?' })), 'Mia Manager queried it: Which flat?');
  assert.equal(inv.historyLine(h({ event: 'approved', totalMinor: 30850 })), 'Mia Manager approved it at £308.50');
  assert.equal(inv.historyLine(h({ event: 'paid', paidOn: '2026-10-17' })), 'Mia Manager marked it paid on Sat 17 Oct 2026');
  assert.equal(inv.payInvoiceSchema.parse(invoice({ history: [{ at, event: 'issued', actorName: null, workId: null, cleans: 2, totalMinor: 9000 }] })).history.length, 1);
});

test('automatic outcomes (20261022050000): the reason under the outcome on screen, in the history, never on the document', () => {
  const auto = mixed({ lines: [line(0), line(1, { rateMinor: 4525, amountMinor: 2263, outcome: 'partial', outcomeSource: 'auto', outcomeReason: 'redo_accepted' }),
    line(2, { rateMinor: 4000, amountMinor: 0, outcome: 'unsuccessful', outcomeSource: 'manual', outcomeReason: null })] });
  const parsed = inv.payInvoiceSchema.parse(auto);
  assert.deepEqual(parsed.lines.map(l => inv.autoOutcomeNote(l)), ['', 'Auto: redo accepted after rejection', ''], 'only an automatic outcome says Auto');
  assert.equal(inv.autoOutcomeNote({ outcomeSource: 'auto', outcomeReason: 'no_form' }), 'Auto: no clean form');
  assert.deepEqual(Object.values(inv.AUTO_REASON_LABEL), ['no clean form', 'rejected and not redone', 'redo accepted after rejection', "dispute decided in the cleaner's favour", 'clean form arrived late', 'flag cleared',
    'redo accepted after the earlier request was approved', 'dispute won after the earlier request was approved']);
  assert.equal(inv.payInvoiceSchema.safeParse(mixed({ lines: [line(0, { outcomeSource: 'robot' })] })).success, false);
  assert.equal(inv.payInvoiceSchema.parse(invoice()).lines[0].outcomeSource, undefined, 'an older answer without the source still reads');
  // The printed document keeps its current notes.
  const html = inv.invoiceHtml(auto);
  assert.doesNotMatch(html, /Auto|automatically|redo accepted/);
  assert.equal(html, inv.invoiceHtml(mixed()), 'the same document as without the source');
  // The history names the reason.
  const h = over => inv.payHistorySchema.parse({ at: '2026-10-13T10:00:00Z', actorName: null, event: 'outcome', propertyName: '12 Leith St', cleanOn: '2026-10-07', ...over });
  assert.equal(inv.historyLine(h({ auto: true, reason: 'no_form', from: 'completed', to: 'unsuccessful', amountMinor: 0, totalMinor: 4500 })),
    'Set 12 Leith St, Wed 7 Oct to Unsuccessful automatically: no clean form (was Completed). Amount to invoice now £45.00');
  assert.equal(inv.historyLine(h({ auto: true, reason: 'redo_accepted', from: 'completed', to: 'partial', totalMinor: 2250 })),
    'Set 12 Leith St, Wed 7 Oct to Partially successful automatically: redo accepted after rejection (was Completed). Amount to invoice now £22.50');
  assert.equal(inv.historyLine(h({ auto: true, reason: 'dispute_won', from: 'partial', to: 'completed' })),
    "Set 12 Leith St, Wed 7 Oct to Completed automatically: dispute decided in the cleaner's favour (was Partially successful)");
  assert.equal(inv.historyLine(h({ actorName: 'Mia Manager', from: 'unsuccessful', to: 'partial' })), 'Mia Manager set 12 Leith St, Wed 7 Oct to Partially successful (was Unsuccessful)', 'a person as before');
  // On screen: under the outcome on the paper and in the outcome editor.
  const source = read('mobile/src/CleanerInvoices.tsx');
  assert.match(source, /autoOutcomeNote\(l\)/);
  assert.match(source, /auto\.get\(l\.key\)/);
});

test('a late redo or dispute (20261022050000): the follow-up line names the earlier request, on screen and on the document', () => {
  const late = invoice({ totalMinor: 6513, lineCount: 2, lines: [
    line(0, { rateMinor: 4525, amountMinor: 2263, outcome: 'partial', outcomeSource: 'auto', outcomeReason: 'late_redo_accepted', followsNumber: 'RC-RFI-2026-0003' }),
    line(1, { rateMinor: 4250, amountMinor: 4250, outcome: 'completed', outcomeSource: 'auto', outcomeReason: 'late_dispute_won', followsNumber: 'RC-RFI-2026-0004' })] });
  const parsed = inv.payInvoiceSchema.parse(late);
  assert.deepEqual(parsed.lines.map(l => inv.autoOutcomeNote(l)), ['Auto: redo accepted after RC-RFI-2026-0003 was approved', 'Auto: dispute won after RC-RFI-2026-0004 was approved']);
  assert.deepEqual(inv.invoiceDoc(late).lines.map(l => l.outcomeNote), ['Half of £45.25 · Late redo, see RC-RFI-2026-0003', 'Late dispute, see RC-RFI-2026-0004']);
  const html = inv.invoiceHtml(late);
  assert.match(html, /<td>Flat 0<\/td><td class="outcome"><span class="label">Partially successful<\/span><span class="note">Half of £45\.25 · Late redo, see RC-RFI-2026-0003<\/span><\/td><td class="num">£22\.63<\/td>/);
  assert.match(html, /<span class="label">Completed<\/span><span class="note">Late dispute, see RC-RFI-2026-0004<\/span>/);
  assert.doesNotMatch(html, /Auto|automatically/, 'the document keeps the outcome note style, not the app words');
  assert.equal(inv.lateNote({ outcomeReason: 'redo_accepted', followsNumber: null }), '');
  const h = inv.payHistorySchema.parse({ at: '2026-10-13T10:00:00Z', actorName: null, event: 'outcome', propertyName: '12 Leith St', cleanOn: '2026-10-07', auto: true, reason: 'late_redo_accepted', afterNumber: 'RC-RFI-2026-0003', from: 'unsuccessful', to: 'partial' });
  assert.equal(inv.historyLine(h), 'Set 12 Leith St, Wed 7 Oct to Partially successful automatically: redo accepted after RC-RFI-2026-0003 was approved (was Unsuccessful)');
});

test('the screen paper and the download share one document model', () => {
  const doc = inv.invoiceDoc(invoice());
  assert.equal(doc.title, 'Request for invoice');
  assert.equal(doc.from.name, 'Recharge Group');
  assert.equal(doc.to, 'Angela Morrison');
  assert.deepEqual(doc.facts.map(f => f.label), ['Issue date', 'Period', 'Cleans', 'Due date']);
  assert.deepEqual(doc.lines.map(l => l.date), ['Tue 6 Oct', 'Wed 7 Oct']);
  assert.equal(doc.total, '£1,234.50');
  assert.equal(doc.totalLabel, 'Amount to invoice');
  const source = read('mobile/src/CleanerInvoices.tsx');
  assert.match(source, /invoiceDoc\(/, 'InvoicePaper draws from invoiceDoc');
  assert.match(source, /doc\.heading/);
  assert.match(source, /doc\.terms/);
  assert.match(source, /doc\.from\.lines/);
  assert.match(source, /l\.outcomeLabel/);
  assert.doesNotMatch(source, /times|INVOICE<\/Text>|Billed to/i, 'no times and no INVOICE title on screen');
  assert.match(source, /INVOICE_PAPER/);
  assert.match(source, /invoiceHtml\(/, 'Download writes the same document');
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
  assert.match(f.waiting.detail, /2 requests/);
  assert.match(f.projected.detail, /2 accepted, not on a request yet/);
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
  const outcome = inv.outcomeAction({ requestId: id(10), invoice: i, workId: id(50), outcome: 'partial' });
  assert.deepEqual(outcome, { action: 'setPayLineOutcome', requestId: id(10), invoiceId: i.id, workId: id(50), outcome: 'partial', version: 1 });
  assert.equal(teamsActionSchema.safeParse(outcome).success, true);
  assert.equal(teamsActionSchema.safeParse({ ...outcome, outcome: 'great' }).success, false);
  assert.ok(inv.PAY_ACTIONS.includes('setPayLineOutcome'), 'sent to workspace_cleaner_pay_action');
  const server = read('lib/workspace-finance-server.ts');
  assert.match(server, /workspace_cleaner_pay_read/);
  assert.match(server, /workspace_cleaner_pay_action/);
});

test('the notices have copy and carry no money in the push words', () => {
  for (const event of ['cleaning.invoice_ready', 'cleaning.invoice_approved', 'cleaning.invoice_queried', 'cleaning.invoice_paid']) {
    const c = noticeCopy(event);
    assert.ok(c.title && c.message, event);
    assert.doesNotMatch(c.title + c.message, /£/, event);
    assert.match(c.title + c.message, /request/i, event);
    assert.doesNotMatch((c.title + ' ' + c.message).replace(/requests? for invoice/gi, '').replace(/send us your invoice/gi, ''), /\binvoices?\b/i, `${event}: says request, not invoice`);
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
  const toPay = roleFigures(home).find(f => f.key === 'cleanerPay');
  assert.equal(toPay.detail, '3 approved requests for invoice', 'Accounts sees cleaners to pay');
  const needs = accountsNeeds(home);
  assert.deepEqual(needs.map(n => [n.key, n.label, n.count]), [['cleanerInvoices', 'requests for invoice to approve', 2], ['cleanerPay', 'request for invoice to pay this week', 1]]);
  const source = read('lib/home-needs.ts') + read('lib/role-home.ts');
  for (const section of ['Requests for invoice to approve', 'Requests for invoice to pay']) assert.ok(source.includes(`section: '${section}'`), section);
  assert.doesNotMatch(source, /Cleaner invoices to/);
});

test('the screens are wired where people look for them', () => {
  const screens = read('mobile/src/CleanerInvoices.tsx');
  for (const title of ['Your pay', "Your cleaners' requests for invoice", 'Requests for invoice to approve', 'Requests for invoice to pay']) assert.ok(screens.includes(`title="${title}"`), title);
  assert.match(screens, /Download/);
  assert.match(screens, /Mark paid/);
  assert.match(screens, /Query/);
  // Outcomes: in the request's sheet while it waits, for management (admins in Accounts) and the cleaning manager.
  assert.match(screens, /canSetOutcome && invoice\.generated && invoice\.status === "to_approve" && <OutcomeEditor/);
  assert.match(screens, /outcomeAction\(/);
  assert.match(screens, /<History p=\{p\} invoice=\{invoice\} \/>/);
  assert.match(screens, /<InvoiceSheet p=\{p\} invoiceId=\{open\} canSetOutcome onClose/, 'the cleaning manager');
  const cleans = read('mobile/src/LiveCleans.tsx');
  assert.match(cleans, /<CleanerPay p=\{p\}/);
  assert.match(cleans, /account\.role === "cleaning_manager" && <CleanerRequestsForManager p=\{p\} \/>/);
  assert.match(cleans, /<PayPeriodSheet/);
  assert.match(read('mobile/src/LiveAccountsWork.tsx'), /canPayCleaners && <AccountsCleanerPay p=\{p\} canSetOutcome=\{\["admin", "super_admin"\]\.includes\(account\.role\)\} \/>/);
  // Every word a person reads in these screens says request, not invoice ("request for invoice" itself aside).
  const words = [...screens.matchAll(/(?:title|label|empty|text)="([^"]*)"|>([^<>{}]+)</g)].map(m => (m[1] ?? m[2]).trim()).filter(Boolean);
  assert.deepEqual(words.filter(w => !/[;=()]/.test(w) && /\binvoices?\b/i.test(w.replace(/requests? for invoice|amount to invoice|send us your invoice/gi, ''))), [], 'no bare "invoice" on screen');
  assert.match(read('worker/index.ts'), /securityRpc\('workspace_cleaner_invoice_run', \{\}\)/, 'the hourly worker run');
});
