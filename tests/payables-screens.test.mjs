import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The Payable screens: cleans to review, the cleaner invoice form and the approve or reject step. The rules live in
// lib/accounts-work.ts; the screens are checked against the policy schemas the server uses and, for wiring, by reading the source.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const work = await vite.ssrLoadModule('/lib/accounts-work.ts');
const { financeActionSchema, financeReadSchema, PAYABLES_ACTIONS } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const payables = await vite.ssrLoadModule('/lib/tracker-payables.ts');
// A dialog call: window.alert, Alert.alert, or a bare alert(, confirm( or prompt( (a method call such as .confirm( or onConfirm( is not one).
const DIALOG = /window\.(alert|confirm|prompt)\b|\bAlert\.alert\b|(?<![.\w$])(alert|confirm|prompt)\s*\(/;
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const task = (n, over = {}, status = 'waiting') => ({ workId: id(n), propertyId: 'p' + (n % 2), moduleId: 'cleans-invoices', title: 'Invoice', kind: 'cleaning_invoice', status, version: 2, assigneeId: null, data: { cleanerId: 'a', cleanerName: 'Cara', cleanedOn: '2026-10-0' + n, sourceWorkId: id(40 + n), ...over } });

test('cleans awaiting an invoice are open invoice tasks whose clean is on no live invoice', () => {
  const rows = work.awaitingCleans(
    [task(3), task(1), task(2, { cleanerId: 'b', cleanerName: '' }), task(4, {}, 'completed'), task(5, { sourceWorkId: undefined }), task(6, {}, 'cancelled')],
    pid => 'Property ' + pid, new Map([['a', 3500]]), new Set([id(42).toUpperCase()]));
  assert.deepEqual(rows.map(r => r.cleanWorkId), [id(41), id(43)], 'a clean on a live invoice, a closed task and a task with no clean are left out');
  assert.equal(rows[0].rateMinor, 3500);
  assert.equal(rows[0].taskWorkId, id(1));
  assert.equal(rows[0].taskVersion, 2);
  assert.equal(rows[0].propertyName, 'Property p1');
  assert.deepEqual(rows.map(r => r.cleanedOn), ['2026-10-01', '2026-10-03'], 'oldest clean first');
  assert.equal(work.awaitingCleans([task(2, { cleanerId: 'b', cleanerName: '' })], () => 'x')[0].cleanerName, 'Cleaner');
});

test('groups keep working and now also carry the clean each task is about', () => {
  const groups = work.cleanerInvoiceGroups([task(1), task(2, { sourceWorkId: undefined })], () => 'Flat');
  assert.deepEqual(groups[0].tasks.map(t => [t.cleanWorkId, t.propertyId]), [[id(41), 'p1'], [null, 'p0']]);
});

test('a rejected invoice frees its cleans; waiting and approved ones hold them', () => {
  const held = work.cleansOnLiveInvoices([
    { status: 'to_approve', lines: [{ workId: id(41) }] }, { status: 'approved', lines: [{ workId: id(42).toUpperCase() }] }, { status: 'rejected', lines: [{ workId: id(43) }] }, { status: 'approved' },
  ]);
  assert.deepEqual([...held].sort(), [id(41), id(42)]);
  // A line the database marks not live holds nothing, whatever its invoice says.
  assert.deepEqual([...work.cleansOnLiveInvoices([{ status: 'approved', lines: [{ workId: id(41), live: false }, { workId: id(42), live: true }, { workId: id(44) }] }])].sort(), [id(42), id(44)]);
});

test('the cleans of a rejected invoice go back on the list, even once their invoice task was closed', () => {
  const invoices = [
    { status: 'rejected', lines: [{ workId: id(41), live: false }, { workId: id(42), live: false }] },
    { status: 'to_approve', lines: [{ workId: id(42), live: true }] },
    { status: 'approved', lines: [{ workId: id(43), live: true }] },
  ];
  const onInvoice = work.cleansOnLiveInvoices(invoices), freed = work.cleansFreedByRejection(invoices);
  assert.deepEqual([...freed].sort(), [id(41), id(42)]);
  const tasks = [task(1, {}, 'completed'), task(2, {}, 'completed'), task(3, {}, 'completed'), task(4, {}, 'completed'), task(5)];
  const rows = work.awaitingCleans(tasks, pid => 'Property ' + pid, new Map(), onInvoice, freed);
  // 41: completed task, freed, on no live invoice: offered. 42: freed but now on a live corrected invoice: held. 43: on an approved invoice: held.
  // 44: completed long ago with no rejected invoice behind it (invoiced before invoices were recorded here): not offered. 45: task still open: offered.
  assert.deepEqual(rows.map(r => r.cleanWorkId), [id(41), id(45)]);
  // Without the freed set a completed task is never offered, which is what the older single-invoice flow relied on.
  assert.deepEqual(work.awaitingCleans(tasks, () => 'x', new Map(), onInvoice).map(r => r.cleanWorkId), [id(45)]);
  // A cancelled task is never offered.
  assert.deepEqual(work.awaitingCleans([task(1, {}, 'cancelled')], () => 'x', new Map(), new Set(), freed), []);
});

test('approving an invoice closes the open invoice task of each clean on it, and only those', () => {
  const tasks = [task(1), task(2), task(3, {}, 'completed'), task(4, { sourceWorkId: undefined }), task(5), task(6, {}, 'cancelled')];
  const invoice = { lines: [{ workId: id(41) }, { workId: id(43) }, { workId: id(44).toUpperCase() }, { workId: id(46) }] };
  assert.deepEqual(work.invoiceTasksToClose(tasks, invoice), [{ workId: id(1), version: 2 }], 'a closed task, a cancelled one and a clean not on the invoice are left alone');
  assert.deepEqual(work.invoiceTasksToClose(tasks, { lines: [] }), []);
  assert.deepEqual(work.invoiceTasksToClose(tasks, {}), []);
});

test('the running total says plainly when the cleans do not add up', () => {
  assert.equal(work.invoiceMismatch(21000, [7000, 7000, 7000]), null);
  assert.equal(work.invoiceMismatch(null, [7000]), null, 'no total typed yet');
  assert.equal(work.invoiceMismatch(21000, []), null, 'nothing picked yet');
  assert.equal(work.invoiceMismatch(22500, [7000, 7000, 7000]), 'The cleans add up to £210.00, which is £15.00 less than the invoice total of £225.00.');
  assert.equal(work.invoiceMismatch(20000, [7000, 7000, 7000]), 'The cleans add up to £210.00, which is £10.00 more than the invoice total of £200.00.');
  assert.equal(work.sumMinor([1, 2, 3]), 6);
});

const form = (over = {}) => ({ requestId: id(90), supplier: ' Cara Cleaning ', reference: ' CARA-10 ', invoiceDate: '2026-10-09', today: '2026-10-12', totalMinor: 14000, lines: [{ workId: id(41), amountMinor: 7000 }, { workId: id(42), amountMinor: 7000 }], ...over });
test('recording an invoice checks the form, then sends exactly what the server accepts', () => {
  const ok = work.recordInvoiceAction(form());
  assert.ok(ok.action, ok.error);
  assert.equal(ok.action.supplier, 'Cara Cleaning');
  assert.equal(ok.action.reference, 'CARA-10');
  const parsed = financeActionSchema.safeParse(ok.action);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.ok(PAYABLES_ACTIONS.includes(ok.action.action), 'routed to workspace_payables_action');
  const errors = {
    supplier: [form({ supplier: 'C' }), /name of the cleaner/],
    reference: [form({ reference: '  ' }), /reference/],
    badDate: [form({ invoiceDate: '2026-02-30' }), /invoice date/],
    futureDate: [form({ invoiceDate: '2026-10-13' }), /future/],
    none: [form({ lines: [] }), /Pick the cleans/],
    noAmount: [form({ lines: [{ workId: id(41), amountMinor: null }] }), /amount/],
    noTotal: [form({ totalMinor: null }), /invoice total/],
    mismatch: [form({ totalMinor: 15000 }), /add up to £140\.00, which is £10\.00 less/],
    tooMany: [form({ lines: Array.from({ length: 201 }, (_, n) => ({ workId: id(n), amountMinor: 1 })), totalMinor: 201 }), /up to 200/],
  };
  for (const [name, [input, pattern]] of Object.entries(errors)) { const r = work.recordInvoiceAction(input); assert.match(r.error ?? '', pattern, name); assert.equal(r.action, undefined, name); }
});

test('approving needs no reason; rejecting needs five characters', () => {
  const approve = work.decideInvoiceAction({ requestId: id(91), invoiceId: id(60), decision: 'approve', note: '  ' });
  assert.deepEqual(approve.action, { action: 'decideCleanerInvoice', requestId: id(91), invoiceId: id(60), decision: 'approve' });
  assert.ok(financeActionSchema.safeParse(approve.action).success);
  assert.match(work.decideInvoiceAction({ requestId: id(91), invoiceId: id(60), decision: 'reject', note: 'No' }).error, /at least 5 characters/);
  const reject = work.decideInvoiceAction({ requestId: id(92), invoiceId: id(60), decision: 'reject', note: ' Dates do not match ' });
  assert.equal(reject.action.note, 'Dates do not match');
  assert.ok(financeActionSchema.safeParse(reject.action).success);
});

test('a review needs a choice and a reason of 5 to 2,000 characters', () => {
  assert.match(work.reviewCleanAction({ requestId: id(93), workId: id(41), decision: null, note: 'Extra linen change' }).error, /Choose what the owner is charged/);
  assert.match(work.reviewCleanAction({ requestId: id(93), workId: id(41), decision: 'agreed_fee', note: ' abc ' }).error, /5 to 2,000 characters/);
  assert.match(work.reviewCleanAction({ requestId: id(93), workId: id(41), decision: 'agreed_fee', note: 'x'.repeat(2001) }).error, /5 to 2,000 characters/);
  for (const decision of ['agreed_fee', 'actual_cost']) {
    const r = work.reviewCleanAction({ requestId: id(93), workId: id(41), decision, note: ' Late check-out, extra linen ' });
    assert.equal(r.action.note, 'Late check-out, extra linen');
    assert.ok(financeActionSchema.safeParse(r.action).success, decision);
  }
  assert.ok(financeActionSchema.safeParse(work.reviewCleanAction({ requestId: id(93), workId: id(41), decision: 'actual_cost', note: 'x'.repeat(2000) }).action).success);
});

test('cleans to review: to review and stale first, reviewed after, with the overrun and tag', () => {
  const clean = (n, state, over = {}) => ({ workId: id(n), propertyName: 'Flat ' + n, cleanDate: '2026-10-0' + n, agreedMinor: 6000, actualMinor: 7500, state, decision: state === 'reviewed' ? 'actual_cost' : null, ...over });
  const { toReview, reviewed } = work.splitCleansToReview([clean(4, 'reviewed'), clean(3, 'flagged'), clean(1, 'stale', { decision: 'agreed_fee' }), clean(2, 'reviewed', { decision: 'agreed_fee' })]);
  assert.deepEqual(toReview.map(c => c.workId), [id(1), id(3)]);
  assert.deepEqual(reviewed.map(c => c.workId), [id(2), id(4)]);
  assert.equal(work.overrunMinor(clean(1, 'flagged')), 1500);
  assert.equal(work.overrunMinor(clean(1, 'flagged', { actualMinor: null })), null);
  assert.deepEqual(work.reviewTag({ state: 'flagged', decision: null }), ['To review', 'wait']);
  assert.deepEqual(work.reviewTag({ state: 'stale', decision: 'agreed_fee' }), ['Cost changed since reviewed', 'bad']);
  assert.equal(work.STALE_REVIEW_LABEL, 'Cost changed since reviewed');
  assert.deepEqual(work.reviewTag({ state: 'reviewed', decision: 'actual_cost' }), ['Reviewed: actual cost', 'good']);
  assert.deepEqual(work.reviewTag({ state: 'reviewed', decision: 'agreed_fee' }), ['Reviewed: agreed fee', 'good']);
  assert.deepEqual(work.DECISION_LABEL, { agreed_fee: 'Charge the owner the agreed fee', actual_cost: 'Charge the owner the actual cost' });
});

test('the reads the screens make are ones the server accepts, and the reports parse', () => {
  assert.ok(financeReadSchema.safeParse({ section: 'cleansToReview', state: 'all' }).success);
  assert.ok(financeReadSchema.safeParse({ section: 'cleanerInvoices' }).success);
  const cleans = live.cleansToReviewReportSchema.safeParse({ count: 2, toReviewCount: 1, more: false, cleans: [
    { workId: id(41), propertyId: id(7), propertyName: 'Leith flat', cleanDate: '2026-10-05', agreedMinor: 6000, actualMinor: 7500, state: 'flagged', decision: null, cleanerName: 'Cara Reid', note: null, reviewedAt: null, costSource: 'invoice' },
    { workId: id(42), propertyId: id(7), propertyName: 'Leith flat', cleanDate: '2026-10-06', agreedMinor: 6000, actualMinor: 7000, state: 'stale', decision: 'agreed_fee', cleanerName: null, note: 'Late check-out', reviewedAt: '2026-10-07T09:00:00Z' },
  ] });
  assert.ok(cleans.success, JSON.stringify(cleans.error?.issues));
  const invoices = live.cleanerInvoicesReportSchema.safeParse({ count: 1, more: false, invoices: [
    { id: id(60), supplier: 'Cara Cleaning', cleanerId: id(9), cleanerName: 'Cara Reid', reference: 'CARA-10', invoiceDate: '2026-10-09', totalMinor: 14000, currency: 'GBP', note: null, status: 'to_approve', decisionNote: null, decidedAt: null, version: 1, createdAt: '2026-10-10T09:00:00Z', lineCount: 1,
      lines: [{ lineId: id(70), workId: id(41), propertyId: id(7), propertyName: 'Leith flat', cleanDate: '2026-10-05', amountMinor: 14000, live: true, agreedMinor: 6000, overAgreed: true }] },
  ] });
  assert.ok(invoices.success, JSON.stringify(invoices.error?.issues));
});

// zod drops fields a schema does not list, so a screen reading them would silently get nothing: the parsed result must keep every one.
const review = { workId: id(41), propertyId: id(7), propertyName: 'Leith flat', cleanDate: '2026-10-05', workStatus: 'completed', cleanerId: id(9), cleanerName: 'Cara Reid',
  agreedMinor: 6000, actualMinor: 7500, costSource: 'invoice', chargeMode: 'agreed_fee', flagged: true, reviewed: false, state: 'flagged', decision: null, note: null, reviewedAt: null,
  reviewedActualMinor: 7000, reviewVersion: 3 };
const invoiceRow = { id: id(60), supplier: 'Cara Cleaning', cleanerId: id(9), cleanerName: 'Cara Reid', reference: 'CARA-10', invoiceDate: '2026-10-09', totalMinor: 14000, currency: 'GBP', note: null,
  status: 'to_approve', decisionNote: null, decidedAt: null, version: 1, createdAt: '2026-10-10T09:00:00Z', lineCount: 1,
  lines: [{ lineId: id(70), workId: id(41), propertyId: id(7), propertyName: 'Leith flat', cleanDate: '2026-10-05', amountMinor: 14000, live: true, agreedMinor: 6000, overAgreed: true }] };

test('the cleans to review keep every field the database returns', () => {
  const parsed = live.cleansToReviewReportSchema.parse({ count: 1, more: false, cleans: [review] });
  assert.deepEqual(parsed.cleans[0], review);
  // An older answer without the new fields still parses.
  const old = { workId: id(41), propertyName: 'Leith flat', cleanDate: '2026-10-05', agreedMinor: 6000, actualMinor: 7500, state: 'flagged', decision: null };
  assert.deepEqual(live.cleansToReviewReportSchema.parse({ cleans: [old] }).cleans[0], old);
});

test('the cleaner invoices keep every field the database returns, so the tracker can use them', () => {
  const parsed = live.cleanerInvoicesReportSchema.parse({ count: 1, more: false, invoices: [invoiceRow] });
  assert.deepEqual(parsed.invoices[0], invoiceRow);
  const line = parsed.invoices[0].lines[0];
  assert.deepEqual([line.lineId, line.propertyId, line.live, line.agreedMinor, line.overAgreed], [id(70), id(7), true, 6000, true]);
  assert.deepEqual([parsed.invoices[0].cleanerId, parsed.invoices[0].cleanerName, parsed.invoices[0].currency], [id(9), 'Cara Reid', 'GBP']);
  // Read through the screen's own schema, the tracker still shows the staff-only details it works out from those fields.
  const item = payables.cleanerInvoiceTrackerItem(parsed.invoices[0], { property: () => undefined, now: new Date('2026-10-12T12:00:00Z'), owner: false, canDecide: true });
  assert.ok(item.details.some(d => d.label === 'Cleaner' || d.label === 'Cost flag'), 'cleaner name or cost flag reaches the tracker');
  assert.ok(item.details.some(d => d.label === 'Cost flag' && d.tone === 'bad'), 'the over-agreed flag survives parsing');
  assert.match(item.details.find(d => d.label === 'Cleans').value, /above the agreed fee/);
  // An older answer without the new fields still parses.
  const old = { id: id(60), supplier: 'Cara Cleaning', reference: 'CARA-10', invoiceDate: '2026-10-09', totalMinor: 14000, status: 'to_approve', lines: [{ workId: id(41), amountMinor: 14000 }] };
  assert.deepEqual(live.cleanerInvoicesReportSchema.parse({ invoices: [old] }).invoices[0], old);
});

test('the screens are wired to the actions, with no browser dialogs and calm style', () => {
  const payable = read('mobile/src/AccountsPayable.tsx'), review = read('mobile/src/CleanCostReview.tsx'), workScreen = read('mobile/src/LiveAccountsWork.tsx');
  // The existing Expenses behaviour stays.
  assert.match(payable, /canStart\(account, "new-expense"\) && <Button/);
  assert.match(payable, /title="Matched to work"/);
  assert.match(payable, /setStatus/);
  // Cleans to review and the cleaner invoices, for finance roles only.
  assert.match(payable, /readFinance\(\{ section, \.\.\.query \}\)/);
  assert.match(payable, /"cleansToReview"/);
  assert.match(payable, /"cleanerInvoices"/);
  assert.match(payable, /\{finance && <CleansToReview/);
  assert.match(payable, /\{finance && <CleanerInvoices/);
  assert.match(payable, /<TrackerList /);
  assert.match(payable, /<TrackerDetailSheet /);
  assert.match(payable, /decideInvoiceAction/);
  assert.match(payable, /recordInvoiceAction/);
  assert.match(payable, /export function RecordCleanerInvoiceSheet/);
  // A request id is kept until the write succeeds (done() comes right after the awaited write), for each of the three writes.
  const part = (from, to) => { const a = payable.indexOf(from), b = payable.indexOf(to, a + 1); assert.ok(a > 0 && b > a, from); return payable.slice(a, b); };
  const recordForm = part('function RecordInvoiceForm', 'export function RecordCleanerInvoiceSheet'), decision = part('function InvoiceDecision', '// Record an invoice a cleaner sent');
  assert.match(recordForm, /const request = useRequestId\("record:"/);
  assert.match(recordForm, /try \{ await writeFinance\(built\.action\); request\.done\(\); \}/);
  assert.match(decision, /const approveId = useRequestId\("decide:" \+ invoice\.id \+ ":approve"\)/);
  assert.match(decision, /const rejectId = useRequestId\("decide:" \+ invoice\.id \+ ":reject:" \+ note\.trim\(\)\)/);
  assert.match(decision, /await writeFinance\(built\.action\); id\.done\(\);/);
  assert.match(review, /useRequestId\(\["review", clean\.workId, clean\.actualMinor \?\? "", decision \?\? "", note\.trim\(\)\]/);
  assert.match(review, /try \{ await writeFinance\(built\.action\); request\.done\(\); await onDone\(\); \}/);
  assert.match(review, /reviewCleanAction/);
  // Recording an invoice leaves the cleans' invoice tasks open; approving it closes them (so a rejected invoice frees its cleans).
  assert.doesNotMatch(recordForm, /completeHandover|writeOperation|updateOperation/);
  assert.match(decision, /step: "completeHandover"/);
  assert.match(decision, /invoiceTasksToClose\(ops\.data, invoice\)/);
  assert.ok(decision.indexOf('await writeFinance(built.action)') < decision.indexOf('closeTasks()', decision.indexOf('async function decide')), 'tasks are closed after the approval is saved');
  assert.match(decision, /if \(decision === "approve" && approved\)|!\(decision === "approve" && approved\)/, 'a retry does not approve twice');
  assert.match(recordForm, /awaitingCleans\(source\.work, nameOf, source\.rates, source\.onInvoice, source\.freed\)/);
  assert.match(recordForm, /freed: cleansFreedByRejection\(invoices\?\.invoices \?\? \[\]\)/);
  // Every field of a payload is in the key of its request id, so an edit after a lost reply is a new request, not a reused identifier.
  const keyOf = (source, call) => { const at = source.indexOf(call); assert.ok(at > 0, call); return source.slice(at, source.indexOf(';', at)); };
  const expenseKey = keyOf(payable, 'const request = useRequestId(visible ? "expense:"');
  for (const field of ['propertyId', 'supplier', 'reference', 'category', 'description', 'amount', 'receivedOn', 'job?.workId']) assert.ok(expenseKey.includes(field), 'new expense key has ' + field);
  assert.match(payable, /const linkKey = \(job: Job \| null\) => "link:" \+ \(expense\?\.id \?\? ""\) \+ ":" \+ \(expense\?\.version \?\? ""\) \+ ":" \+ \(job\?\.workId \?\? "none"\);/);
  assert.match(payable, /requestId: linkIds\.current\.get\(key\)!, expenseId: expense\.id, version: expense\.version, workId: job \? job\.workId : null/);
  assert.match(keyOf(payable, 'const evidenceRequest = useRequestId('), /expense\.id.*kind.*label.*checked.*linkJob.*photos\.join/);
  assert.match(keyOf(payable, 'const submitRequest = useRequestId('), /JSON\.stringify\(draft\)/);
  // Adding evidence or linking a job reloads the expense without throwing away what was typed in the draft invoice form.
  assert.equal([...payable.matchAll(/await load\(\{ keepDraft: true \}\)/g)].length, 2);
  assert.match(payable, /if \(options\?\.keepDraft\) return;/);
  assert.match(review, /STALE_REVIEW_LABEL/);
  // The older Work list now opens the same record form.
  assert.match(workScreen, /RecordCleanerInvoiceSheet/);
  assert.doesNotMatch(workScreen, /function CleanerInvoiceSheet/);
  for (const [name, source] of [['AccountsPayable', payable], ['CleanCostReview', review], ['LiveAccountsWork', workScreen], ['accounts-work', read('lib/accounts-work.ts')], ['tracker-payables', read('lib/tracker-payables.ts')]]) {
    assert.doesNotMatch(source, DIALOG, name + ' has a dialog');
    assert.doesNotMatch(source, /(Linear|Radial)Gradient|(linear|radial|conic)-gradient|Animated\.loop/, name + ' has a gradient or loop');
    assert.ok(!source.includes(String.fromCharCode(0x2014)), name + ' has an em dash');
    assert.ok(!source.includes('\n') || source.includes('\r\n'), name + ' keeps CRLF line endings');
    assert.ok(!/[^\r]\n/.test(source), name + ' has a lone LF');
  }
  // Section titles stay distinct from the Work list's "Cleaner invoices" so a Home tool still lands there.
  assert.doesNotMatch(payable, /<Section title="Cleaner invoices"/);
  assert.match(workScreen, /<Section title="Cleaner invoices"/);
});
