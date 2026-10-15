import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// VA pay (20261022200000), the app side: the Request for Invoice document, dollars and hours, the lines, management's
// groups, the Team route schemas, the in-app notices and where the screens and the monthly run are wired.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
after(() => vite.close());
const va = await vite.ssrLoadModule('/lib/va-pay.ts');
const { legalDetails } = await vite.ssrLoadModule('/lib/legal-details.ts');
const { teamsReadSchema, teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { noticeRow } = await vite.ssrLoadModule('/lib/notice-details.ts');
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const request = (over = {}) => ({
  id: id(1), number: 'RC-VA-2026-0007', vaId: id(2), vaName: 'Gina Santos', area: 'guest_relations', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  status: 'to_approve', queried: false, queryNote: null, queriedAt: null, issueOn: '2026-10-01', dueOn: '2026-10-08', approvedAt: null, paidOn: null, rejectNote: null, currency: 'USD',
  hourlyRateMinor: 1250, workedMinutes: 795, hoursAdjustMinutes: 0, hoursAdjustReason: null, minutes: 795, hoursMinor: 16563,
  kpiName: 'Replies within 5 minutes', kpiValue: 95, kpiTier: 'tier2', bonusAutoMinor: 10000, bonusAdjusted: false, bonusAdjustReason: null, bonusMinor: 10000, totalMinor: 26563,
  version: 1, own: true, days: [{ day: '2026-09-07', minutes: 480 }, { day: '2026-09-08', minutes: 255 }, { day: '2026-09-09', minutes: 60 }], ...over,
});

test('dollars with two decimals, hours as 13h 15m, and the hours amount rounded to the cent', () => {
  assert.deepEqual([va.usd(0), va.usd(5), va.usd(123450), va.usd(-1200), va.usd(null)], ['$0.00', '$0.05', '$1,234.50', '-$12.00', '–']);
  assert.equal(va.rateLabel(1250), '$12.50/h');
  assert.deepEqual([va.hoursLabel(795), va.hoursLabel(65), va.signedHours(30), va.signedHours(-75)], ['13h 15m', '1h 05m', '+0h 30m', '-1h 15m']);
  // 795 x 1250 / 60 = 16562.5: half a cent rounds up, as the database does.
  assert.deepEqual([va.hoursAmount(795, 1250), va.hoursAmount(825, 1250), va.hoursAmount(60, 1999)], [16563, 17188, 1999]);
  assert.deepEqual([va.parseUsd('12.50'), va.parseUsd('$1,000'), va.parseUsd('0'), va.parseUsd('12.505'), va.parseUsd('abc')], [1250, 100000, 0, null, null]);
  assert.equal(va.monthLabel('2026-09-01'), 'September 2026');
});

test('the lines: hours at the rate, then the bonus for the tier reached; no bonus line without a bonus', () => {
  assert.deepEqual(va.vaLines(va.vaRequestSchema.parse(request())), [
    { key: 'hours', label: 'Hours worked September 2026: 13h 15m at $12.50/h', amountMinor: 16563 },
    { key: 'bonus', label: 'Bonus: Replies within 5 minutes, Tier 2 (95%)', amountMinor: 10000 }]);
  assert.equal(va.vaLines(request({ kpiTier: 'target', kpiValue: 90 }))[1].label, 'Bonus: Replies within 5 minutes, Target (90%)');
  assert.equal(va.vaLines(request({ kpiTier: 'tier3', kpiValue: 100 }))[1].label, 'Bonus: Replies within 5 minutes, Tier 3 (100%)');
  assert.deepEqual(va.vaLines(request({ kpiTier: null, kpiValue: 85, bonusAutoMinor: 0, bonusMinor: 0, totalMinor: 16563 })).map(l => l.key), ['hours'], 'no tier, no bonus line');
  assert.equal(va.vaLines(request({ bonusAdjusted: true, bonusMinor: 2500 }))[1].label, 'Bonus: Replies within 5 minutes, Tier 2 (95%), adjusted');
});

test('the document: REQUEST FOR INVOICE with the number, From Recharge Group with the legal details, To the VA, facts, lines, days, total, terms', () => {
  const html = va.vaRequestHtml(va.vaRequestSchema.parse(request()), { origin: 'https://app.example' });
  assert.match(html, /<img src="https:\/\/app\.example\/recharge-company-logo\.png" alt="Recharge">/, 'the logo');
  assert.match(html, /<div class="word">REQUEST FOR INVOICE<\/div><div class="number">RC-VA-2026-0007<\/div>/);
  assert.match(html, /background:#[0-9a-fA-F]{6}/, 'the cream band colour comes from the brand');
  assert.match(html, /<span class="pill">Awaiting approval<\/span>/);
  assert.match(html, /<h2>From<\/h2><p>Recharge Group<\/p><p class="line">25 Bothwell Street, Glasgow, G2 6NL<\/p><p class="line">Recharge Stays Ltd · Company no\. SC799955<\/p>/);
  assert.ok(html.includes(legalDetails.registeredAddress) && html.includes(legalDetails.companyNumber), 'read from lib/legal-details.ts');
  assert.match(html, /<h2>To<\/h2><p>Gina Santos<\/p>/);
  assert.match(html, /<dt>Issue date<\/dt><dd>Thu 1 Oct 2026<\/dd>.*<dt>Period<\/dt><dd>September 2026<\/dd>.*<dt>Hours<\/dt><dd>13h 15m<\/dd>.*<dt>Due date<\/dt><dd>Thu 8 Oct 2026<\/dd>/s);
  assert.match(html, /<thead><tr><th>Description<\/th><th class="num">Amount<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><td>Hours worked September 2026: 13h 15m at \$12\.50\/h<\/td><td class="num">\$165\.63<\/td><\/tr><tr><td>Bonus: Replies within 5 minutes, Tier 2 \(95%\)<\/td><td class="num">\$100\.00<\/td><\/tr>/);
  assert.match(html, /tbody tr:nth-child\(even\) td\{background:/, 'striped');
  assert.match(html, /<h2>Hours by day<\/h2><ul><li><span>Mon 7 Sep<\/span><span class="num">8h 00m<\/span><\/li>/);
  assert.match(html, /<span>Amount to invoice<\/span><span class="num">\$265\.63<\/span>/);
  assert.match(html, /<h2>Terms<\/h2><p>Please send us your invoice for the amount above, quoting reference RC-VA-2026-0007\. We pay valid invoices within 7 days\.<\/p>/);
  assert.match(html, /<footer class="foot"><p>Recharge Group · RC-VA-2026-0007<\/p>/);
  assert.match(html, /Print or save as PDF/);
  assert.doesNotMatch(html, /PAID<small>/, 'no stamp before it is paid');
  assert.doesNotMatch(html, /\u2014/, "no em dash");
  assert.equal(va.VA_TERMS, 'Please send us your invoice for the amount above, quoting reference <number>. We pay valid invoices within 7 days.');
  assert.equal(va.vaFileName({ number: 'RC-VA-2026-0007' }), 'RC-VA-2026-0007.html');
});

test('paid: the PAID stamp with the date and a Paid on fact; approved: due date chip; a correction is shown under the days', () => {
  const paid = va.vaRequestHtml(request({ status: 'paid', paidOn: '2026-10-07' }));
  assert.match(paid, /<div class="stamp" aria-hidden="true">PAID<small>Wed 7 Oct 2026<\/small><\/div>/);
  assert.match(paid, /<dt>Paid on<\/dt><dd>Wed 7 Oct 2026<\/dd>/);
  assert.doesNotMatch(paid, /class="pill"/, 'no chip once paid');
  assert.doesNotMatch(paid, /Due date/);
  assert.match(va.vaRequestHtml(request({ status: 'approved' })), /<span class="pill">Approved · due Thu 8 Oct<\/span>/);
  assert.match(va.vaRequestHtml(request({ queried: true })), /Awaiting approval · queried/);
  const corrected = va.vaRequestHtml(request({ hoursAdjustMinutes: 30, minutes: 825, hoursMinor: 17188, totalMinor: 27188 }));
  assert.match(corrected, /<p class="correction">Hours corrected by management: \+0h 30m<\/p>/);
  assert.match(corrected, /13h 45m at \$12\.50\/h/);
  assert.deepEqual(va.vaStatus(request({ status: 'paid', paidOn: '2026-10-07' })), { label: 'Paid on Wed 7 Oct 2026', tone: 'paid' });
});

test('management groups: To approve, To pay and Paid, with totals; rejected in none', () => {
  const list = [
    request({ id: id(10), vaName: 'Ben', status: 'to_approve', totalMinor: 100 }), request({ id: id(11), vaName: 'Ann', status: 'approved', dueOn: '2026-10-09', totalMinor: 200 }),
    request({ id: id(12), vaName: 'Cat', status: 'approved', dueOn: '2026-10-08', totalMinor: 300 }), request({ id: id(13), status: 'paid', paidOn: '2026-10-05', totalMinor: 400 }),
    request({ id: id(14), status: 'rejected', totalMinor: 999 }),
  ];
  const g = va.vaGroups(list);
  assert.deepEqual([g.toApprove.map(r => r.vaName), g.toPay.map(r => r.vaName), g.paid.length, g.rejected.length], [['Ben'], ['Cat', 'Ann'], 1, 1]);
  assert.deepEqual([g.toApproveMinor, g.toPayMinor, g.paidMinor], [100, 500, 400]);
});

test('the Team route takes the VA pay reads and actions; the database answers each', () => {
  for (const section of ['vaPayAccess', 'vaPayRequests', 'vaPaySetup']) assert.ok(teamsReadSchema.safeParse({ section }).success, section);
  assert.ok(teamsReadSchema.safeParse(va.vaRequestQuery(id(1))).success);
  assert.equal(teamsReadSchema.safeParse({ section: 'vaPayRequest' }).success, false, 'one request needs its id');
  assert.ok(teamsReadSchema.safeParse(va.vaRequestsQuery(id(2))).success);
  const r = { id: id(1), version: 3 }, requestId = id(9);
  for (const action of [
    va.saveVaPayAction({ requestId, vaId: id(2), version: 0, hourlyRateMinor: 1250, bonusTargetMinor: 5000, bonusTier2Minor: 10000, bonusTier3Minor: 20000 }),
    va.saveVaPayAction({ requestId, vaId: id(2), version: 1, hourlyRateMinor: null, bonusTargetMinor: 0, bonusTier2Minor: 0, bonusTier3Minor: 0 }),
    va.issueVaAction({ requestId, vaId: id(2), month: '2026-08', version: 0 }), va.issueVaAction({ requestId, vaId: id(2), month: '2025-12', version: 4 }),
    va.approveVaAction({ requestId, request: r }), va.queryVaAction({ requestId, request: r, note: 'Was the 9th a full hour?' }),
    va.rejectVaAction({ requestId, request: r, note: 'Hours belong to another month' }), va.markVaPaidAction({ requestId, request: r, paidOn: '2026-10-07' }),
    va.adjustVaAction({ requestId, request: r, reason: 'Forgot to clock out', hoursAdjustMinutes: -45 }), va.adjustVaAction({ requestId, request: r, reason: 'Back to the KPI bonus', bonusMinor: null }),
  ]) assert.ok(teamsActionSchema.safeParse(action).success, JSON.stringify(action));
  for (const month of ['2026-13', '2026-8', '2026-08-01', '']) assert.equal(teamsActionSchema.safeParse(va.issueVaAction({ requestId, vaId: id(2), month, version: 0 })).success, false, month);
  assert.equal(teamsActionSchema.safeParse(va.issueVaAction({ requestId, vaId: 'nobody', month: '2026-08', version: 0 })).success, false, 'a VA id');
  assert.equal(teamsActionSchema.safeParse({ ...va.saveVaPayAction({ requestId, vaId: id(2), version: 0, hourlyRateMinor: 1250, bonusTargetMinor: 0, bonusTier2Minor: 0, bonusTier3Minor: 0 }), currency: 'GBP' }).success, false, 'USD only');
  assert.deepEqual(Object.keys(va.adjustVaAction({ requestId, request: r, reason: 'Only the hours', hoursAdjustMinutes: 30 })).sort(), ['action', 'hoursAdjustMinutes', 'id', 'reason', 'requestId', 'version']);
  const server = read('lib/workspace-finance-server.ts');
  assert.match(server, /client\.rpc\('workspace_va_pay_read'/);
  assert.match(server, /VA_PAY_ACTIONS as readonly string\[\]\)\.includes\(input\.action\) \? 'workspace_va_pay_action'/);
  assert.deepEqual([...va.VA_PAY_ACTIONS].sort(), ['adjustVaRequest', 'approveVaRequest', 'issueVaRequest', 'markVaRequestPaid', 'queryVaRequest', 'rejectVaRequest', 'saveVaPay']);
});

test('issue now offers the months that have ended, newest first, two years back', () => {
  const months = va.issueMonths('2026-10-15');
  assert.equal(months.length, 24);
  assert.deepEqual(months.slice(0, 3), ['2026-09', '2026-08', '2026-07']);
  assert.equal(months.at(-1), '2024-10');
  assert.deepEqual(va.issueMonths('2027-01-01', 2), ['2026-12', '2026-11'], 'across the new year');
});

test('the VA is told in the app when a request is approved, paid, queried or rejected, with no money in the wording', () => {
  for (const event of ['vapay.request_approved', 'vapay.request_paid', 'vapay.request_queried', 'vapay.request_rejected']) {
    const c = noticeCopy(event);
    assert.notEqual(c.title, 'Update in Recharge', event);
    assert.doesNotMatch(c.title + c.message, /[$£]/, event);
    assert.equal(noticeRow({ id: 1, event_type: event, created_at: '2026-10-07T10:00:00Z' }).title, c.title);
  }
  assert.equal(noticeCopy('vapay.something_new').title, 'Request for invoice update');
  assert.match(noticeCopy('vapay.request_queried').message, /note/);
  assert.match(noticeCopy('vapay.request_rejected').message, /reason/);
});

test('the screens and the monthly run are wired where people look for them', () => {
  const screens = read('mobile/src/VaPay.tsx');
  for (const title of ['To approve', 'To pay', 'Paid']) assert.ok(screens.includes(`section("${title}"`), title);
  for (const title of ['Your requests for invoice', 'VA pay setup']) assert.ok(screens.includes(`title="${title}"`), title);
  for (const word of ['Download', 'Mark paid', 'Query', 'Adjust', 'Reject', 'Approve', 'Issue now']) assert.ok(screens.includes(`"${word}`), word);
  assert.match(screens, /<Button label="Issue now"[^>]*onPress=\{\(\) => setIssuing\(v\)\}/, 'on the VA\'s row');
  assert.match(screens, /writeTeams\(issueVaAction\(\{ requestId: ids\.get\(month\), vaId: row\.userId, month, version: row\.version \}\)\)/);
  assert.doesNotMatch(screens, /expo-print/, 'phones share the HTML page');
  assert.match(screens, /exportReport\(vaRequestHtml\(request\), vaFileName\(request\), \{ mime: "text\/html"/);
  assert.match(read('mobile/src/LiveManagement.tsx'), /view === "vapay" && <VaPayPanel p=\{p\} account=\{account\} place="management" \/>/);
  assert.match(read('mobile/src/Reports.tsx'), /<VaPayPanel p=\{p\} account=\{account\} place="mine"\/>/);
  assert.match(read('worker/index.ts'), /if \(hourly\) \{[^]*securityRpc\('workspace_va_pay_run', \{\}\)\)\.catch\(\(\) => \{\s+console\.error\('VA requests for invoice failed; the next run retries\.'\);/);
  // Built beside the cleaner invoice, not on it.
  assert.doesNotMatch(read('lib/va-pay.ts'), /from '\.\/cleaner-invoices'/);
  assert.doesNotMatch(screens, /CleanerInvoices|cleaner-invoices/);
});
