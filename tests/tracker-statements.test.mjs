import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The Statements adapter: periods (last day shown, first day after sent), plain-language reasons a period cannot be prepared,
// the checked figures in the order they come off (and refusing figures that do not add up), the five steps, and what owners never see.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const S = await vite.ssrLoadModule('/lib/tracker-statements.ts');
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { updateStamp } = await vite.ssrLoadModule('/lib/tracker.ts');

const NOW = new Date('2026-12-02T12:00:00Z');
const PROPERTY = '22222222-2222-4222-8222-222222222222';
const ID = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

// The brief's worked example (November, 15% plus VAT), as the preview returns it.
const lines = [
  { kind: 'ota_fee', date: '2026-11-03', label: 'Airbnb fees', amountMinor: 1546, refId: ID(1) },
  { kind: 'ota_fee', date: '2026-11-12', label: 'Vrbo fees', amountMinor: 3392, refId: ID(2) },
  { kind: 'ota_fee', date: '2026-11-26', label: 'Booking.com fees', amountMinor: 8434, refId: ID(3) },
  { kind: 'changeover', date: '2026-11-08', label: 'Changeover clean', amountMinor: 6000, refId: ID(4) },
  { kind: 'changeover', date: '2026-11-15', label: 'Changeover clean', amountMinor: 6000, refId: ID(5) },
  { kind: 'changeover', date: '2026-11-22', label: 'Changeover clean', amountMinor: 6000, refId: ID(6) },
  { kind: 'management_fee', date: '2026-11-01', label: 'Management fee (15%)', amountMinor: 24300, refId: null },
  { kind: 'vat', date: '2026-11-01', label: 'VAT on the management fee (20%)', amountMinor: 4860, refId: null },
  { kind: 'payable', date: '2026-11-10', label: 'Boiler service', amountMinor: 6000, refId: ID(7) },
  { kind: 'payable', date: '2026-11-25', label: 'Light bulbs', amountMinor: 2500, refId: ID(8) },
];
const preview = (over = {}) => ({
  section: 'statementPreview', propertyId: PROPERTY, periodStart: '2026-11-01', periodEnd: '2026-12-01', method: 'nights',
  terms: { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, vatRateBps: 2000, cleanChargeMode: 'agreed_fee', feeBase: 'payout_after_ota_fees' },
  lines, grossMinor: 175374, otaFeesMinor: 13372, revenueMinor: 162002, changeoversMinor: 18000, cleaningCount: 3, feeBaseMinor: 162002, feeMinor: 24300, vatMinor: 4860,
  payablesMinor: 8500, payoutMinor: 106342, nightsBooked: 15, nightsAvailable: 30, flags: [], blocked: false, blockedReasons: [], ...over,
});
const row = (over = {}) => ({ propertyId: PROPERTY, propertyName: 'Leith Harbour Flat', unsettledPayouts: 0, missingDetails: 0, cleansToReview: 0,
  terms: { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, vatRateBps: 2000, cleanChargeMode: 'agreed_fee' }, ...over });
const statement = (over = {}) => ({
  id: ID(90), propertyId: PROPERTY, propertyName: 'Leith Harbour Flat', period: '2026-11', status: 'draft', revenueMinor: 162002, cleaningCount: 3, cleaningMinor: 18000, expensesMinor: 8500,
  feeBps: 1500, feeMinor: 24300, payoutMinor: 106342, payoutMethod: null, payoutReference: null, paidAt: null, issuedAt: null, version: 1,
  periodStart: '2026-11-01', periodEnd: '2026-12-01', periodLastDay: '2026-11-30', method: 'nights', grossMinor: 175374, otaFeesMinor: 13372, vatRateBps: 2000, vatMinor: 4860,
  nightsBooked: 15, nightsAvailable: 30, occupancyBps: 5000, cleanChargeMode: 'agreed_fee', updatedAt: '2026-12-01T10:05:00Z',
  detail: { stays: [], expenses: [], cleaningCostMinor: 6000, lines, internal: ['clean_over_agreed:' + ID(5)], cleanCosts: [{ workId: ID(5), actualMinor: 7500, agreedMinor: 6000 }] }, ...over,
});
const ctx = (over = {}) => ({ now: NOW, month: '2026-11', role: 'accounts', ...over });
const states = item => item.steps.map(s => `${s.key}:${s.state}`).join(' ');

test('a custom period shows the last day but is sent with the day after, as the first day not included', () => {
  const r = S.customRange('2026-11-01', '2026-11-30', '2026-12-02');
  assert.deepEqual([r.from, r.to, r.lastDay, r.days, r.month], ['2026-11-01', '2026-12-01', '2026-11-30', 30, '2026-11']);
  const part = S.customRange('2026-11-10', '2026-11-10', '2026-12-02');
  assert.deepEqual([part.from, part.to, part.days, part.month], ['2026-11-10', '2026-11-11', 1, null]);
  assert.equal(S.customRange('2026-12-15', '2027-01-03', '2027-02-01').to, '2027-01-04');
  assert.equal(S.customRange('2026-02-28', '2026-02-28', '2026-12-02').to, '2026-03-01');
  assert.equal(S.customRange('2028-02-28', '2028-02-29', '2028-12-02').to, '2028-03-01', 'leap day');
});

test('the request and the action carry exactly the dates that were checked', () => {
  const nov = S.monthRange('2026-11');
  // The check leaves the method to the database: the held statement's own, else nights (as Prepare below).
  assert.deepEqual(S.previewQuery(PROPERTY, nov), { section: 'statementPreview', propertyId: PROPERTY, from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(S.prepareAction(PROPERTY, nov), { action: 'prepareStatement', propertyId: PROPERTY, period: '2026-11', method: 'nights' });
  const mid = S.customRange('2026-11-10', '2026-11-20', '2026-12-02');
  assert.deepEqual(S.prepareAction(PROPERTY, mid), { action: 'prepareStatement', propertyId: PROPERTY, from: '2026-11-10', to: '2026-11-21', method: 'nights' });
  // Preparing a held draft again never names a method, so an old monthly draft keeps counting by check-in.
  const held = { id: crypto.randomUUID() };
  assert.deepEqual(S.prepareAction(PROPERTY, nov, held), { action: 'prepareStatement', propertyId: PROPERTY, period: '2026-11' });
  assert.deepEqual(S.prepareAction(PROPERTY, mid, held), { action: 'prepareStatement', propertyId: PROPERTY, from: '2026-11-10', to: '2026-11-21' });
  assert.deepEqual(S.prepareAction(PROPERTY, nov, null), S.prepareAction(PROPERTY, nov));
  assert.notEqual(S.previewKey(PROPERTY, nov), S.previewKey(PROPERTY, mid));
  assert.equal(S.previewKey(PROPERTY, nov), S.previewKey(PROPERTY, S.customRange('2026-11-01', '2026-11-30', '2026-12-02')), 'the same dates are the same check');
});

test('the actions pass the same schemas the server applies', async () => {
  const { financeActionSchema, financeReadSchema } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
  const nov = S.monthRange('2026-11'), mid = S.customRange('2026-11-10', '2026-11-20', '2026-12-02');
  for (const r of [nov, mid]) {
    assert.ok(financeActionSchema.safeParse({ requestId: crypto.randomUUID(), ...S.prepareAction(PROPERTY, r) }).success);
    assert.ok(financeActionSchema.safeParse({ requestId: crypto.randomUUID(), ...S.prepareAction(PROPERTY, r, { id: crypto.randomUUID() }) }).success);
    assert.ok(financeReadSchema.safeParse(S.previewQuery(PROPERTY, r)).success);
  }
});

test('bad custom dates get a plain reason', () => {
  const err = (a, b, today = '2026-12-02') => S.customRange(a, b, today).error;
  assert.match(err('', '2026-11-30'), /first day/);
  assert.match(err('2026-11-01', ''), /last day/);
  assert.match(err('2026-02-30', '2026-03-05'), /first day/);
  assert.match(err('01/11/2026', '30/11/2026'), /year-month-day/);
  assert.match(err('2026-11-30', '2026-11-01'), /on or after/);
  assert.match(err('2026-12-20', '2026-12-31'), /started/);
  assert.match(err('2026-01-01', '2027-01-02', '2027-06-01'), /366/);
  assert.equal(S.customRange('2026-01-01', '2027-01-01', '2027-06-01').days, 366);
  assert.equal(S.customRange('2026-01-01', '2026-12-31', '2027-06-01').days, 365);
  assert.equal(S.monthRange('2026-13'), null);
  assert.equal(S.rangeFromDates('2026-11-05', '2026-11-05'), null);
});

test('periods read as a month or as first day to last day', () => {
  assert.equal(S.periodTitle({ periodStart: '2026-11-01', periodEnd: '2026-12-01' }, NOW), 'November 2026');
  assert.equal(S.periodTitle({ periodStart: '2026-11-01', periodEnd: '2026-12-01', period: '2026-11' }, NOW), 'November 2026');
  assert.equal(S.periodTitle({ periodStart: '2026-11-01', periodEnd: '2026-11-30' }, NOW), '1 Nov to 29 Nov');
  assert.equal(S.periodTitle({ periodStart: '2026-11-10', periodEnd: '2026-11-21' }, NOW), '10 Nov to 20 Nov');
  assert.equal(S.periodTitle({ periodStart: '2026-12-20', periodEnd: '2027-01-04' }, NOW), '20 Dec 2026 to 3 Jan 2027');
  assert.equal(S.periodTitle({ periodStart: '2025-11-01', periodEnd: '2025-11-16' }, NOW), '1 Nov 2025 to 15 Nov 2025');
  assert.equal(S.periodTitle({ period: '2026-09' }, NOW), 'September 2026', 'an older statement has only its month');
  assert.equal(S.periodTitle({}, NOW), 'Statement');
});

test('reasons a period cannot be prepared are plain and counted', () => {
  const r = S.blockReasons(['stay_unsettled:a', 'stay_unsettled:b', 'clean_unreviewed:c']);
  assert.deepEqual(r.map(x => [x.kind, x.count, x.text]), [
    ['stays', 2, '2 stays are waiting for their payout'],
    ['cleans', 1, '1 clean cost more than the owner is charged: review it'],
  ]);
  assert.match(r[0].pointer, /Reconciliation/);
  assert.match(r[1].pointer, /Cleans to review/);
  assert.deepEqual(r.map(x => x.link), ['payouts', 'cleans']);
  assert.equal(S.blockReasons(['stay_unsettled:a'])[0].text, '1 stay is waiting for its payout');
  assert.equal(S.blockReasons(['clean_unreviewed:a', 'clean_unreviewed:b'])[0].text, '2 cleans cost more than the owner is charged: review them');
  assert.equal(S.blockReasons(['something_new:a'])[0].kind, 'other');
  assert.deepEqual(S.blockReasons([]), []);
});

test('notes for flags never repeat what a block already says', () => {
  assert.deepEqual(S.flagNotes([]), []);
  assert.equal(S.flagNotes(['ota_fee_unknown:a', 'ota_fee_unknown:b']).length, 1);
  assert.match(S.flagNotes(['ota_fee_unknown:a'])[0], /no fee on its payout/);
  assert.deepEqual(S.flagNotes(['clean_over_agreed:a'], ['clean_unreviewed:a']), [], 'an unreviewed dear clean is in the blocks');
  assert.match(S.flagNotes(['clean_over_agreed:a', 'clean_over_agreed:b'], ['clean_unreviewed:a'])[0], /^1 clean cost more than the agreed fee/);
  assert.match(S.flagNotes(['nights_exceed_period'])[0], /overlapping/);
});

test('the checked figures come off in order and the payout is the worked example', () => {
  const sum = S.previewSummary(preview());
  assert.deepEqual(sum.problems, []);
  assert.deepEqual(sum.rows.map(r => [r.key, r.label, r.value]), [
    ['gross', 'Gross revenue', '£1,753.74'],
    ['ota_fee', 'Platform fees', '−£133.72'],
    ['changeover', 'Changeovers (3)', '−£180.00'],
    ['management_fee', 'Management fee (15%)', '−£243.00'],
    ['vat', 'VAT on the management fee (20%)', '−£48.60'],
    ['payable', 'Other payables', '−£85.00'],
  ]);
  assert.deepEqual([sum.payout.label, sum.payout.value], ['Payout to the owner', '£1,063.42']);
  assert.equal(sum.occupancy, '50% occupancy, 15 of 30 nights booked');
  assert.match(sum.rows[3].note, /£1,620\.02, the payout after platform fees, at 15%/);
  const noVat = S.previewSummary(preview({ terms: { ...preview().terms, vatOnFee: false }, vatMinor: 0, payoutMinor: 111202, lines: lines.filter(l => l.kind !== 'vat') }));
  assert.equal(noVat.rows.some(r => r.key === 'vat'), false);
  assert.deepEqual(noVat.problems, []);
  const owes = S.previewSummary(preview({ payoutMinor: -2500, payablesMinor: 117342, lines: [...lines.filter(l => l.kind !== 'payable'), { kind: 'payable', date: '2026-11-10', label: 'Roof', amountMinor: 117342, refId: ID(9) }] }));
  assert.deepEqual([owes.payout.label, owes.payout.value, owes.problems], ['The owner owes', '£25.00', []]);
});

test('figures that do not add up are returned as problems, never smoothed over', () => {
  assert.match(S.previewSummary(preview({ payoutMinor: 106343 })).problems[0], /do not add up to the payout/);
  assert.match(S.previewSummary(preview({ lines: lines.slice(1) })).problems.join(' '), /itemised lines/);
  const sums = Object.fromEntries(['ota_fee', 'changeover', 'management_fee', 'vat', 'payable'].map(k => [k, lines.filter(l => l.kind === k).reduce((n, l) => n + l.amountMinor, 0)]));
  assert.deepEqual(sums, { ota_fee: 13372, changeover: 18000, management_fee: 24300, vat: 4860, payable: 8500 });
});

test('lines are grouped in the order they come off, each in date order', () => {
  const groups = S.lineGroups(lines, NOW);
  assert.deepEqual(groups.map(g => [g.kind, g.title, g.totalMinor, g.lines.length]), [
    ['ota_fee', 'Platform fees', 13372, 3], ['changeover', 'Changeovers', 18000, 3], ['management_fee', 'Management fee', 24300, 1], ['vat', 'VAT', 4860, 1], ['payable', 'Other payables', 8500, 2],
  ]);
  assert.deepEqual(groups[1].lines.map(l => l.when), ['8 Nov', '15 Nov', '22 Nov']);
  assert.equal(groups[2].lines[0].when, null, 'the fee has no date of its own');
  assert.deepEqual(S.lineGroups([]), []);
});

test('occupancy is nights booked of the nights in the period', () => {
  assert.equal(S.occupancyBps(15, 30), 5000);
  assert.equal(S.occupancyBps(10, 30), 3333);
  assert.equal(S.occupancyBps(0, 30), 0);
  assert.equal(S.occupancyBps(5, 0), null);
  assert.equal(S.occupancyText(10, 30), '33.3% occupancy, 10 of 30 nights booked');
  assert.equal(S.occupancyText(1, 1), '100% occupancy, 1 of 1 night booked');
  assert.equal(S.occupancyText(null, 30), 'Not known');
});

test('a property with no statement yet shows what is left: reconcile, then review cleans, then prepare', () => {
  const none = (over, c = {}) => S.statementTrackerItem(row(over), null, ctx(c));
  // Client answer 4: a clean costing more than agreed is flagged but never holds a statement, so only stays wait.
  const stuck = none({ unsettledPayouts: 1, missingDetails: 1, cleansToReview: 1 });
  assert.equal(states(stuck), 'reconciled:current cleans:done prepared:todo issued:todo paid:todo');
  assert.deepEqual([stuck.status.label, stuck.status.tone, stuck.nextStep], ['Not ready', 'wait', 'Reconcile 2 stays']);
  assert.deepEqual(stuck.nextAction, { label: 'Check figures', actionKey: 'checkFigures' });
  const cleans = none({ cleansToReview: 1 });
  assert.equal(states(cleans), 'reconciled:done cleans:done prepared:current issued:todo paid:todo');
  // A loaded check from an older server can still name one, and then it is shown.
  const older = none({ cleansToReview: 1 }, { preview: { blockedReasons: ['clean_unreviewed:abc'] } });
  assert.equal(states(older), 'reconciled:done cleans:current prepared:todo issued:todo paid:todo');
  assert.equal(older.nextStep, 'Review 1 clean');
  const ready = none({});
  assert.equal(states(ready), 'reconciled:done cleans:done prepared:current issued:todo paid:todo');
  assert.deepEqual([ready.status.label, ready.nextStep, ready.title, ready.closed], ['Ready to prepare', 'Check the figures and prepare the statement', 'November 2026', false]);
  assert.deepEqual(ready.progress, { done: 2, total: 5 });
  assert.equal(ready.id, `${PROPERTY}:2026-11`);
  assert.equal(ready.lastUpdate, null);
  // A property still marked actual cost behaves the same.
  const actual = none({ cleansToReview: 3, terms: { ...row().terms, cleanChargeMode: 'actual_cost' } });
  assert.equal(states(actual), 'reconciled:done cleans:done prepared:current issued:todo paid:todo');
});

test('a loaded check gives the exact reasons instead of the list counts', () => {
  const blocked = preview({ blocked: true, blockedReasons: ['stay_unsettled:a', 'stay_unsettled:b', 'stay_unsettled:c'] });
  const item = S.statementTrackerItem(row(), null, ctx({ preview: blocked }));
  assert.equal(states(item), 'reconciled:current cleans:done prepared:todo issued:todo paid:todo', 'the check found no dear clean waiting');
  assert.equal(item.nextStep, 'Reconcile 3 stays');
  const fine = S.statementTrackerItem(row({ unsettledPayouts: 2 }), null, ctx({ preview: preview() }));
  assert.equal(fine.steps[0].state, 'done', 'the check says nothing is unsettled');
  // The list only uses a check for the same property and month.
  const items = S.statementTrackerItems([{ ...row({ unsettledPayouts: 2 }), statement: null }], ctx({ preview: preview({ periodStart: '2026-10-01', periodEnd: '2026-11-01' }) }));
  assert.equal(items[0].steps[0].state, 'current');
  const other = S.statementTrackerItems([{ ...row({ unsettledPayouts: 2 }), statement: null }], ctx({ preview: preview({ propertyId: ID(55) }) }));
  assert.equal(other[0].steps[0].state, 'current');
});

test('terms not set yet wait for management', () => {
  const r = row({ terms: { managementFeeBps: null, cleaningCostMinor: null } });
  const accounts = S.statementTrackerItem(r, null, ctx());
  assert.deepEqual([accounts.status.label, accounts.nextStep, accounts.nextAction], ['Terms needed', 'Set the fee and cleaning cost from the agreement', { label: 'Waiting for Management' }]);
  const admin = S.statementTrackerItem(r, null, ctx({ role: 'admin' }));
  assert.deepEqual(admin.nextAction, { label: 'Set the fee and cleaning cost', actionKey: 'setStatementTerms' });
});

test('a statement walks through prepared, issued and paid', () => {
  const draft = S.statementTrackerItem(row(), statement(), ctx());
  assert.equal(states(draft), 'reconciled:done cleans:done prepared:done issued:current paid:todo');
  assert.deepEqual([draft.status.label, draft.status.tone, draft.nextStep, draft.nextAction], ['Draft', 'wait', 'Check the figures, then issue to the owner', { label: 'Issue to owner', actionKey: 'issueStatement' }]);
  assert.deepEqual(draft.lastUpdate, { at: '2026-12-01T10:05:00Z', by: 'Accounts', what: 'Prepared' });
  assert.equal(updateStamp(draft.lastUpdate, NOW), 'Yesterday 10:05 · Accounts');
  const issued = S.statementTrackerItem(row(), statement({ status: 'issued', issuedAt: '2026-12-01T11:00:00Z', version: 2 }), ctx());
  assert.equal(states(issued), 'reconciled:done cleans:done prepared:done issued:done paid:current');
  assert.deepEqual([issued.status.label, issued.status.tone, issued.nextAction], ['Issued', 'plain', { label: 'Record bank transfer', actionKey: 'recordOwnerPayout' }]);
  const paid = S.statementTrackerItem(row(), statement({ status: 'paid', issuedAt: '2026-12-01T11:00:00Z', paidAt: '2026-12-02T09:00:00Z', payoutReference: 'BACS-1' }), ctx());
  assert.equal(states(paid), 'reconciled:done cleans:done prepared:done issued:done paid:done');
  assert.deepEqual([paid.status.label, paid.status.tone, paid.closed, paid.nextAction, paid.progress], ['Paid', 'good', true, null, { done: 5, total: 5 }]);
  assert.match(paid.steps[4].detail, /ref BACS-1/);
});

test('an owner balance waits for the owner, not for Accounts', () => {
  const owes = S.statementTrackerItem(row(), statement({ status: 'issued', payoutMinor: -2500 }), ctx());
  assert.deepEqual([owes.status.label, owes.status.tone, owes.nextStep, owes.nextAction], ['Owner owes', 'bad', 'The owner settles the balance', { label: 'Waiting for the owner' }]);
  assert.equal(owes.steps[4].detail, 'The owner owes this balance');
});

test('the sheet shows period, occupancy, nights, gross, VAT and payout', () => {
  const item = S.statementTrackerItem(row(), statement(), ctx());
  const d = Object.fromEntries(item.details.map(x => [x.label, x.value]));
  assert.equal(d['Period'], 'November 2026');
  assert.equal(d['Occupancy'], '50% occupancy, 15 of 30 nights booked');
  assert.equal(d['Gross revenue'], '£1,753.74');
  assert.equal(d['VAT on the management fee (20%)'], '£48.60');
  assert.equal(d['Payout to the owner'], '£1,063.42');
  assert.match(d['How stays are counted'], /nights/);
  assert.match(d['Terms'], /Management fee 15%, plus VAT, cleans at agreed fee/);
  assert.match(d['Worth a look'], /1 clean cost more than the agreed fee/);
  const custom = S.statementTrackerItem(row(), statement({ periodStart: '2026-11-10', periodEnd: '2026-11-21' }), ctx());
  assert.equal(custom.title, '10 Nov to 20 Nov');
  assert.equal(S.statementTrackerItem(row(), statement({ periodStart: undefined, periodEnd: undefined, grossMinor: undefined, nightsBooked: undefined, nightsAvailable: undefined, vatMinor: 0 }), ctx()).title, 'November 2026');
});

test('owners never see staff names, flags, clean costs or the pre-statement checks', () => {
  const draft = statement({ status: 'issued', issuedAt: '2026-12-01T11:00:00Z' });
  const mine = S.statementTrackerItem(row(), draft, ctx({ owner: true, role: undefined }));
  assert.deepEqual(mine.steps.map(s => s.key), ['prepared', 'issued', 'paid']);
  assert.equal(mine.lastUpdate.by, null);
  assert.ok(updateStamp(mine.lastUpdate, NOW, true).endsWith('Recharge'));
  assert.deepEqual(mine.nextAction, { label: 'Waiting for Recharge' });
  const text = JSON.stringify({ details: mine.details, steps: mine.steps, search: mine.search, next: mine.nextStep, update: mine.lastUpdate });
  for (const word of ['Accounts', 'clean_over_agreed', 'Worth a look', 'Terms', '7500', 'Reconciled', 'Cleans reviewed']) assert.ok(!text.includes(word), word);
  assert.equal(S.statementTrackerItem(row({ unsettledPayouts: 3 }), null, ctx({ owner: true, role: undefined })).details.some(x => /reconcile|review/i.test(x.label)), false);
});

test('forms follow the role and the stage', () => {
  const keys = (role, r, st) => S.statementForms(role, r, st).map(f => f.key);
  assert.deepEqual(keys('accounts', row(), null), ['checkFigures']);
  assert.deepEqual(keys('admin', row(), null), ['checkFigures', 'setStatementTerms']);
  assert.deepEqual(keys('accounts', row(), statement()), ['issueStatement', 'checkFigures', 'voidStatement'], 'a draft can be voided by Accounts');
  assert.deepEqual(keys('admin', row(), statement()), ['issueStatement', 'checkFigures', 'voidStatement', 'setStatementTerms']);
  assert.deepEqual(keys('accounts', row(), statement({ status: 'issued' })), ['recordOwnerPayout']);
  assert.deepEqual(keys('admin', row(), statement({ status: 'issued' })), ['recordOwnerPayout', 'voidStatement', 'setStatementTerms']);
  assert.deepEqual(keys('accounts', row(), statement({ status: 'issued', payoutMinor: -1 })), []);
  assert.deepEqual(keys('accounts', row(), statement({ status: 'paid' })), []);
  assert.deepEqual(keys('stays', row(), null), []);
  assert.deepEqual(keys(undefined, row(), null), []);
  assert.deepEqual(keys('accounts', row({ terms: null }), null), []);
});

test('the list has a row for every statement overlapping the month and one for each property without', () => {
  const second = { ...row({ propertyId: ID(70), propertyName: 'Abbey Mews' }), statement: null };
  const early = statement({ id: ID(91), periodStart: '2026-10-20', periodEnd: '2026-11-05', period: '2026-10' });
  const rows = [{ ...row(), statement: statement(), periodStatements: [early, statement()] }, second];
  const items = S.statementTrackerItems(rows, ctx());
  assert.deepEqual(items.map(i => [i.address, i.title]), [['Leith Harbour Flat', '20 Oct to 4 Nov'], ['Leith Harbour Flat', 'November 2026'], ['Abbey Mews', 'November 2026']]);
  assert.deepEqual(new Set(items.map(i => i.id)).size, 3);
  // An older answer has only the statement starting in the month.
  assert.equal(S.statementTrackerItems([{ ...row(), statement: statement() }], ctx()).length, 1);
  assert.ok(items.every(i => i.section === 'statements'));
  const address = S.statementTrackerItem(row(), null, ctx({ property: id => id === PROPERTY ? { name: 'Harbour Flat', address: '4 Leith Walk, Edinburgh' } : null }));
  assert.deepEqual([address.address, address.propertyName], ['4 Leith Walk, Edinburgh', 'Harbour Flat']);
});

test('what the database really sends parses with the live schemas', () => {
  assert.ok(live.statementPreviewSchema.safeParse(preview()).success);
  assert.ok(live.statementSchema.safeParse(statement()).success);
  const bad = { ...preview() }; delete bad.payoutMinor;
  assert.equal(live.statementPreviewSchema.safeParse(bad).success, false, 'a missing money figure is an error, not a zero');
});
