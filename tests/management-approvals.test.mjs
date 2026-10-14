import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The one Management approvals list (lib/tracker-approvals.ts): open flags, free-standing requests,
// pending hub approval tickets and the management queue merged into tracker rows; who sees what; and
// what the Resolve, Decline, Withdraw and Ask management buttons send.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const mod = await vite.ssrLoadModule('/lib/tracker-approvals.ts');
const { approvalItems, approvalEntries, parseApprovalFlags, decideFlagAction, withdrawFlagAction, requestAction, canWithdraw, openApprovalCount, APPROVALS_SECTION, APPROVAL_DECIDE, APPROVAL_REMIND, APPROVAL_SEEN } = mod;
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const NOW = new Date('2026-10-13T12:00:00Z');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uuid(900), OTHER = uuid(901);
const HOURS = h => new Date(NOW.getTime() - h * 3600_000).toISOString();
const flag = (n, over = {}) => ({ id: uuid(n), source: 'work', workId: uuid(100 + n), hubItemId: null, propertyId: uuid(200), propertyName: 'Leith flat', propertyAddress: '12 Leith Walk, Edinburgh EH6 5AA', title: 'Kettle over budget', reason: 'Only a 45 pound kettle is in stock',
  amountMinor: 4500, status: 'open', outcomeNote: '', raisedBy: ME, raisedByName: 'Sam Stays', decidedBy: null, decidedByName: null, decidedAt: null, createdAt: HOURS(30), updatedAt: HOURS(30), version: 1, mine: true, ...over });
const ticket = (n, over = {}) => ({ id: uuid(n), kind: 'approval', title: 'New vacuum cleaner', details: 'Ours broke', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null, department: null, dueOn: null, amountMinor: 18000, settledMinor: null,
  link: null, reference: '', status: 'pending', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: ME, createdByName: 'Sam Stays', createdAt: HOURS(10), updatedAt: HOURS(10), version: 1, ...over });
const queue = (over = {}) => ({
  cleaningDecisions: [{ workId: uuid(310), version: 2, kind: 'cleaning_complaint', title: 'Complaint', propertyId: uuid(200), propertyName: 'Leith flat', cleanerId: uuid(320), cleanerName: 'Cara Reid', cleanerStatement: null, sourceWorkId: null, createdAt: HOURS(50) }],
  expensesOverLimit: [{ id: uuid(330), propertyId: uuid(200), propertyName: 'Leith flat', supplier: 'Boiler Co', reference: 'INV-9', description: 'Boiler part', amountMinor: 90000, receivedOn: '2026-10-09', version: 1, hasInvoice: true, hasProof: false }],
  repairApprovals: [{ workId: uuid(340), version: 3, title: 'Boiler', propertyId: uuid(200), propertyName: 'Leith flat', issue: 'No heating', repairType: 'heating', urgent: true, hazard: false, estimatedCostMinor: 120000, previousEstimateMinor: null, quoteReason: null, ownerApprovedAt: null, limitMinor: 50000, waitingSince: HOURS(80) }],
  stalledOwnerApprovals: [{ workId: uuid(350), kind: 'repair', title: 'Leaking tap', propertyId: uuid(201), propertyName: 'Harbour cottage', estimatedCostMinor: 8000, waitingSince: HOURS(60), remindedAt: null, escalatedAt: null, canRemindAt: null }],
  unusualPayouts: [{ id: uuid(360), propertyId: uuid(201), propertyName: 'Harbour cottage', period: 'Sep 2026', status: 'draft', payoutMinor: -2000, issuedAt: null, version: 1, averageMinor: 50000, previousStatements: 3, reason: 'negative' }],
  ownerBalancesDue: [{ id: uuid(370), propertyId: uuid(201), propertyName: 'Harbour cottage', period: 'Aug 2026', status: 'issued', payoutMinor: -15000, issuedAt: HOURS(120), version: 1 }],
  cleanerWarnings: [{ cleanerId: uuid(320), fullName: 'Cara Reid', accepted: 10, rejected: 3, overturned: 0, warning: true, openComplaints: [] }],
  missedYesterday: [{ userId: uuid(380), fullName: 'Olive Other', day: '2026-10-12', signedOff: false, listingsDue: 2, missedListings: [{ propertyId: uuid(200), propertyName: 'Leith flat' }], createdAt: HOURS(20) }],
  ...over });
const admin = (over = {}) => ({ now: NOW, owner: false, canDecide: true, userId: OTHER, ...over });
const staff = (over = {}) => admin({ canDecide: false, userId: ME, ...over });
const keys = items => items.map(i => i.id);

test('flags, tickets and the management queue merge into one list, open first and the longest-waiting at the top', () => {
  const items = approvalItems({ flags: [flag(1), flag(2, { source: 'request', workId: null, title: 'Deposit for new cleaner', amountMinor: null, createdAt: HOURS(5) }), flag(3, { status: 'resolved', decidedAt: HOURS(2), decidedByName: 'Mia Manager', createdAt: HOURS(100) })], hub: [ticket(4)], queue: queue() }, admin());
  assert.equal(items.length, 3 + 1 + 8);
  assert.ok(items.every(i => i.section === 'approvals'));
  assert.equal(APPROVALS_SECTION, 'approvals');
  const open = items.filter(i => !i.closed);
  assert.equal(open.length, 11);
  assert.equal(openApprovalCount(items), 11);
  // Open items come before every closed one; the owner balance (120 hours) has waited longest, then the cost received on 9 October (84 hours).
  assert.deepEqual(items.map(i => i.closed), [...Array(11).fill(false), true]);
  assert.deepEqual(keys(items).slice(0, 2), ['balance:' + uuid(370), 'expense:' + uuid(330)]);
  const dated = open.filter(i => !i.id.startsWith('warning:') && !i.id.startsWith('payout:'));
  const times = dated.map(i => Date.parse(i.lastUpdate.at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the longest-waiting comes first');
  assert.equal(items.at(-1).id, 'flag:' + uuid(3));
});

test('each source has a badge, an address, an amount in the title and the steps Raised and Decided', () => {
  const items = approvalItems({ flags: [flag(1), flag(2, { source: 'request', workId: null, propertyId: null, propertyName: null, propertyAddress: null, title: 'Deposit', amountMinor: null })], hub: [ticket(4)], queue: queue() }, admin());
  const byKey = Object.fromEntries(items.map(i => [i.id, i]));
  const badge = id => byKey[id].status.label;
  assert.equal(badge('flag:' + uuid(1)), 'Flag');
  assert.equal(badge('flag:' + uuid(2)), 'Request');
  assert.equal(badge('hub:' + uuid(4)), 'Approval');
  assert.equal(badge('repair:' + uuid(340)), 'Repair quote');
  assert.equal(badge('decision:' + uuid(310)), 'Clean decision');
  assert.equal(badge('expense:' + uuid(330)), 'Cost over limit');
  assert.equal(badge('stalled:' + uuid(350)), 'Owner reply');
  assert.equal(badge('payout:' + uuid(360)), 'Unusual payout');
  assert.equal(badge('balance:' + uuid(370)), 'Owner balance');
  assert.equal(badge('warning:' + uuid(320)), 'Cleaner warning');
  assert.equal(badge('missed:' + uuid(380) + ':2026-10-12'), 'Missed checks');
  const f = byKey['flag:' + uuid(1)];
  assert.equal(f.address, '12 Leith Walk, Edinburgh EH6 5AA', 'the full address, from the read');
  assert.equal(f.title, 'Kettle over budget · £45.00', 'the amount rides in the title');
  assert.deepEqual(f.steps.map(s => [s.label, s.state]), [['Raised', 'done'], ['Decided', 'current']]);
  assert.deepEqual(f.progress, { done: 1, total: 2 });
  assert.deepEqual(f.nextAction, { label: 'Decide', actionKey: APPROVAL_DECIDE });
  assert.equal(f.steps[1].actionKey, APPROVAL_DECIDE);
  assert.match(f.nextStep, /waiting 30 hours$/);
  assert.equal(f.lastUpdate.by, 'Sam Stays');
  assert.equal(f.workId, uuid(101));
  assert.equal(byKey['flag:' + uuid(2)].address, 'Not about a property');
  assert.equal(byKey['repair:' + uuid(340)].status.tone, 'bad', 'an urgent repair reads as urgent');
  assert.equal(byKey['repair:' + uuid(340)].title, 'No heating · £1,200.00');
  assert.equal(byKey['hub:' + uuid(4)].address, 'No property');
  assert.equal(byKey['warning:' + uuid(320)].address, 'Cleaning team');
  assert.deepEqual(byKey['stalled:' + uuid(350)].nextAction, { label: 'Remind the owner', actionKey: APPROVAL_REMIND });
  assert.equal(byKey['missed:' + uuid(380) + ':2026-10-12'].nextAction.actionKey, APPROVAL_SEEN);
  assert.equal(byKey['balance:' + uuid(370)].title, 'Aug 2026 statement, owner owes · £150.00');
  assert.doesNotMatch(byKey['warning:' + uuid(320)].nextStep, /waiting/, 'an undated warning has no age');
});

test('the property list gives a flag its full address when the read has none', () => {
  const [item] = approvalItems({ flags: [flag(1, { propertyAddress: null })] }, admin({ property: id => id === uuid(200) ? { name: 'Leith flat', address: '12 Leith Walk' } : null }));
  assert.equal(item.address, '12 Leith Walk');
  const [bare] = approvalItems({ flags: [flag(1, { propertyAddress: null })] }, admin());
  assert.equal(bare.address, 'Leith flat');
});

test('decided flags close with their outcome and the person who decided', () => {
  const items = approvalItems({ flags: [
    flag(1, { status: 'resolved', outcomeNote: 'Bought one', decidedAt: HOURS(3), decidedByName: 'Mia Manager' }),
    flag(2, { status: 'declined', outcomeNote: 'Use the old one', decidedAt: HOURS(3), decidedByName: 'Mia Manager' }),
    flag(3, { status: 'withdrawn', decidedAt: HOURS(3) }),
  ] }, admin());
  const [resolved, declined, withdrawn] = [...items].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual([resolved.status, declined.status, withdrawn.status], [{ label: 'Resolved', tone: 'good' }, { label: 'Declined', tone: 'bad' }, { label: 'Withdrawn', tone: 'plain' }]);
  assert.ok(items.every(i => i.closed && i.nextAction === null));
  assert.deepEqual(resolved.progress, { done: 2, total: 2 });
  assert.match(resolved.steps[1].detail, /^Resolved .* by Mia Manager$/);
  assert.ok(resolved.details.some(d => d.label === 'Outcome' && d.value === 'Bought one'));
  assert.equal(resolved.lastUpdate.by, 'Mia Manager');
});

test('other staff see only their own flags and tickets, waiting for management, and none of the queue', () => {
  const input = { flags: [flag(1), flag(2, { raisedBy: OTHER, raisedByName: 'Olive Other', mine: false })], hub: [ticket(4), ticket(5, { createdBy: OTHER })], queue: queue() };
  const items = approvalItems(input, staff());
  assert.deepEqual(keys(items).sort(), ['flag:' + uuid(1), 'hub:' + uuid(4)].sort());
  for (const i of items) {
    assert.equal(i.nextAction.label, 'Waiting for management');
    assert.equal(i.nextAction.actionKey, undefined, 'they cannot decide');
    assert.match(i.nextStep, /^Management to decide/);
    assert.equal(i.steps[1].actionKey, undefined);
    assert.match(i.steps[1].detail, /^Waiting for management/);
  }
  // Without the read's `mine` the raiser is matched by id.
  const noMine = approvalItems({ flags: [flag(1, { mine: undefined }), flag(2, { raisedBy: OTHER, mine: undefined })] }, staff());
  assert.deepEqual(keys(noMine), ['flag:' + uuid(1)]);
  assert.equal(approvalItems({ queue: queue() }, staff()).length, 0, 'management data never reaches a non-decider');
  // The same flags for management are all there.
  assert.equal(approvalItems(input, admin({ userId: OTHER })).length, 2 + 2 + 8);
});

test('owners never get a row', () => {
  assert.deepEqual(approvalItems({ flags: [flag(1)], hub: [ticket(4)], queue: queue() }, admin({ owner: true })), []);
  assert.deepEqual(approvalEntries({ flags: [flag(1)] }, staff({ owner: true })), []);
});

test('only pending approval tickets join the list, never other hub rows', () => {
  const items = approvalItems({ hub: [ticket(4), ticket(5, { status: 'approved' }), ticket(6, { kind: 'todo' }), ticket(7, { status: 'declined' })] }, admin());
  assert.deepEqual(keys(items), ['hub:' + uuid(4)]);
});

test('the flags read keeps the extra fields and drops rows it cannot read', () => {
  const read = parseApprovalFlags({ canDecide: true, flags: [flag(1), { id: 'nope' }, flag(2, { workKind: 'purchase', hubTitle: null })] });
  assert.equal(read.canDecide, true);
  assert.equal(read.flags.length, 2);
  assert.equal(read.flags[0].propertyAddress, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(read.flags[1].workKind, 'purchase');
  assert.deepEqual(parseApprovalFlags(null), { canDecide: null, flags: [] });
  assert.equal(parseApprovalFlags([flag(1)]).flags.length, 1);
});

test('declining needs a reason of five characters; resolving does not; the action matches the schema', () => {
  const f = flag(1);
  assert.match(decideFlagAction(f, 'declined', '', uuid(500)).error, /at least 5/);
  assert.match(decideFlagAction(f, 'declined', '  no ', uuid(500)).error, /at least 5/);
  assert.match(decideFlagAction(f, 'declined', 'x'.repeat(2001), uuid(500)).error, /2,000/);
  const declined = decideFlagAction(f, 'declined', ' Use the old one ', uuid(500));
  assert.deepEqual(declined.action, { action: 'decideFlag', requestId: uuid(500), flagId: f.id, version: 1, decision: 'declined', note: 'Use the old one' });
  const resolved = decideFlagAction(f, 'resolved', '', uuid(501));
  assert.equal(resolved.action.decision, 'resolved');
  assert.equal(resolved.action.note, '');
  for (const built of [declined, resolved]) assert.ok(teamsActionSchema.safeParse(built.action).success);
  assert.ok(teamsActionSchema.safeParse(withdrawFlagAction(f, uuid(502))).success);
  assert.equal(teamsActionSchema.safeParse({ ...declined.action, note: 'no' }).success, false, 'the schema refuses a short decline note too');
});

test('only whoever raised an open flag can withdraw it', () => {
  assert.equal(canWithdraw(flag(1), ME), true);
  assert.equal(canWithdraw(flag(1, { mine: undefined }), ME), true);
  assert.equal(canWithdraw(flag(1, { mine: undefined }), OTHER), false);
  assert.equal(canWithdraw(flag(1, { mine: false }), ME), false);
  assert.equal(canWithdraw(flag(1, { status: 'resolved' }), ME), false);
});

test('Ask management sends a free-standing request: a title, a reason of five characters and an optional amount', () => {
  assert.match(requestAction('', 'A real reason here', '', uuid(600)).error, /title/);
  assert.match(requestAction('Deposit', 'no', '', uuid(600)).error, /Say why/);
  assert.match(requestAction('Deposit', 'A real reason here', 'lots', uuid(600)).error, /pounds/);
  const plain = requestAction('  Deposit for the new cleaner ', 'She starts on Monday', '', uuid(601));
  assert.deepEqual(plain.action, { action: 'flagForManagement', requestId: uuid(601), title: 'Deposit for the new cleaner', reason: 'She starts on Monday', source: 'request' });
  const priced = requestAction('Deposit', 'She starts on Monday', '120.50', uuid(602));
  assert.equal(priced.action.amountMinor, 12050);
  assert.equal(priced.action.workId, undefined);
  assert.equal(priced.action.hubItemId, undefined);
  for (const built of [plain, priced]) assert.ok(teamsActionSchema.safeParse(built.action).success);
});

test('no em dashes in the approvals adapter, screens or this test', () => {
  for (const file of ['lib/tracker-approvals.ts', 'mobile/src/ManagementApprovals.tsx', 'mobile/src/LiveManagement.tsx', 'mobile/src/LiveOversight.tsx', 'tests/management-approvals.test.mjs'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(String.fromCharCode(0x2014)), file);
});

test('the screens are wired: Management shows the one list, flags decide with a request id, and the Daily checks card points at Client relations', () => {
  const read = file => readFileSync(file, 'utf8');
  const management = read('mobile/src/LiveManagement.tsx'), approvals = read('mobile/src/ManagementApprovals.tsx'), oversight = read('mobile/src/LiveOversight.tsx');
  assert.match(management, /<ManagementApprovals /);
  assert.doesNotMatch(management, /QueueExtras|<DecisionSheet|<ExpenseSheet/, 'the old queue sections are gone from Management');
  assert.match(approvals, /useRequestId/);
  assert.match(approvals, /decideFlagAction\(flag, decision, note, request\.get\(\)\)/);
  assert.match(approvals, /disabled=\{busy\}/);
  assert.match(approvals, /Ask management/);
  assert.match(approvals, /<HubItemSheet/);
  assert.match(approvals, /<DisputeSheet/);
  assert.match(approvals, /<CostDecisionSheet/);
  assert.match(approvals, /<ExpenseSheet/);
  assert.match(approvals, /<TrackerList /);
  // Home's lines (lib/home-needs.ts, shown by LiveOversight's AdminHome) send listing checks to Client relations.
  const needs = read('lib/home-needs.ts');
  assert.match(oversight, /adminNeeds\(/);
  assert.match(needs, /work\('clients', \{ sub: 'listings' \}\)/);
  assert.doesNotMatch(oversight + needs, /section: ["']Daily checks["']/);
});
