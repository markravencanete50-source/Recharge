import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Owner Home's periods and statement maths, the owner's navigation (each destination once), and
// the inbox filter chips.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { periodRange, readRange, summarisePeriod, changeOf, changeLabel, OWNER_PERIODS } = await vite.ssrLoadModule('/lib/owner-periods.ts');
const { ownerReadSchema } = await vite.ssrLoadModule('/lib/owner-policy.ts');
const { ownerNavigation, navigationFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { toolsFor, workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { homeToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const inbox = await vite.ssrLoadModule('/lib/inbox-filters.ts');
after(() => vite.close());

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const cell = (month, propertyId, extra = {}) => ({
  month, propertyId, source: 'statement', status: 'issued', preparing: false, revenueMinor: 0, bookings: 0, stayNights: 0, bookedNights: 0,
  cleaningCount: 0, cleaningMinor: 0, expensesMinor: 0, feeBps: 2000, feeMinor: 0, payoutMinor: 0, missingAmounts: 0, ...extra,
});

test('each period covers the months so far and is compared like for like', () => {
  assert.deepEqual(OWNER_PERIODS, ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear']);
  assert.deepEqual(periodRange('thisMonth', '2026-10-09'), { months: ['2026-10'], previous: ['2026-09'], versus: 'vs last month' });
  assert.deepEqual(periodRange('lastMonth', '2026-01-15'), { months: ['2025-12'], previous: ['2025-11'], versus: 'vs the month before' });
  assert.deepEqual(periodRange('thisQuarter', '2026-11-30'), { months: ['2026-10', '2026-11'], previous: ['2026-07', '2026-08'], versus: 'vs the same months last quarter' });
  assert.deepEqual(periodRange('thisQuarter', '2026-01-02').previous, ['2025-10'], 'the first month of a quarter against the first month of the last');
  assert.equal(periodRange('thisQuarter', '2026-01-02').versus, 'vs the first month of last quarter');
  const year = periodRange('thisYear', '2026-03-20');
  assert.deepEqual(year.months, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(year.previous, ['2025-01', '2025-02', '2025-03']);
  // One read covers the period and its comparison, and the owner route accepts it.
  for (const period of OWNER_PERIODS) {
    const range = readRange(periodRange(period, '2026-12-31'));
    assert.ok(ownerReadSchema.safeParse({ section: 'periods', ...range }).success, period);
  }
  assert.deepEqual(readRange(year), { from: '2025-01-01', to: '2026-03-01' });
  assert.ok(!ownerReadSchema.safeParse({ section: 'periods', from: '2024-01-01', to: '2026-03-01' }).success, 'up to 25 months');
});

test('a period adds up like a statement, and says honestly what is estimated', () => {
  const cells = [
    cell('2026-09', A, { revenueMinor: 50000, bookings: 2, stayNights: 6, bookedNights: 5, cleaningCount: 2, cleaningMinor: 10000, expensesMinor: 2000, feeMinor: 10000, payoutMinor: 28000 }),
    cell('2026-09', B, { revenueMinor: 30000, bookings: 1, stayNights: 3, bookedNights: 3, cleaningCount: 1, cleaningMinor: 5000, feeMinor: 6000, payoutMinor: 19000 }),
    cell('2026-10', A, { source: 'estimate', status: null, revenueMinor: 90000, bookings: 3, stayNights: 10, bookedNights: 10, missingAmounts: 1, cleaningCount: 1, cleaningMinor: 5000, expensesMinor: 12000, feeMinor: 18000, payoutMinor: 55000 }),
    cell('2026-10', B, { source: 'estimate', status: null, preparing: true, cleaningMinor: null, feeBps: null, feeMinor: null, payoutMinor: null }),
  ];
  const sep = summarisePeriod(cells, ['2026-09'], 2);
  assert.equal(sep.basis, 'issued');
  assert.equal(sep.bookingIncomeMinor - sep.cleaningMinor - sep.expensesMinor - sep.feeMinor, sep.payoutMinor, 'the lines reconcile to the payout');
  assert.equal(sep.payoutMinor, 47000);
  assert.equal(sep.availableNights, 60); assert.equal(sep.occupancy, 8 / 60);
  assert.equal(sep.averageNightlyMinor, Math.round(80000 / 9));
  const oct = summarisePeriod(cells, ['2026-10'], 2);
  assert.equal(oct.basis, 'estimated'); assert.deepEqual(oct.preparingMonths, ['2026-10']); assert.equal(oct.missingAmounts, 1);
  assert.equal(oct.payoutMinor, null, 'a property without agreed terms has no payout to estimate');
  assert.equal(summarisePeriod(cells, ['2026-10'], 2, A).payoutMinor, 55000, 'one property on its own');
  const both = summarisePeriod(cells, ['2026-09', '2026-10'], 2);
  assert.equal(both.basis, 'mixed'); assert.deepEqual(both.issuedMonths, ['2026-09']); assert.deepEqual(both.estimatedMonths, ['2026-10']);
  const empty = summarisePeriod([], ['2026-11'], 2);
  assert.equal(empty.basis, 'empty'); assert.equal(empty.averageNightlyMinor, null); assert.equal(empty.occupancy, 0);
  assert.equal(summarisePeriod([cell('2026-02', A, { bookedNights: 40 })], ['2026-02'], 1).occupancy, 1, 'never above 100%');
});

test('changes against the period before read as ↑ or ↓ a whole percentage', () => {
  assert.deepEqual(changeOf(120, 100), { direction: 'up', percent: 20 });
  assert.deepEqual(changeOf(75, 100), { direction: 'down', percent: 25 });
  assert.equal(changeLabel(changeOf(120, 100)), '↑ 20%');
  assert.equal(changeLabel(changeOf(75, 100)), '↓ 25%');
  assert.equal(changeLabel(changeOf(100, 100)), 'No change');
  assert.equal(changeOf(100, 0), null, 'nothing to compare with');
  assert.equal(changeOf(null, 100), null); assert.equal(changeOf(100, null), null);
  assert.equal(changeLabel(null), null);
  assert.deepEqual(changeOf(-50, -100), { direction: 'up', percent: 50 }, 'owing less is better');
});

test('owners reach every destination once: no separate stays and statements view in Work', async () => {
  for (const wide of [false, true]) {
    const values = ownerNavigation(wide).map(x => x.value);
    assert.equal(new Set(values).size, values.length, 'no duplicates');
    assert.ok(!values.includes('work'));
  }
  assert.deepEqual(ownerNavigation().map(x => x.label), ['Home', 'Properties', 'Inbox', 'Approvals', 'Reports']);
  assert.deepEqual(ownerNavigation(true).map(x => x.value), [...navigationFor('client').map(x => x.value), 'help']);
  assert.deepEqual(workViewsFor('client'), ['repairs', 'all']);
  const places = Object.fromEntries(toolsFor('client', DEFAULT_ROLE_MODULES.client.concat('client-mailbox')).map(t => [t.id, t.place]));
  assert.equal(places['client-dashboard'].tab, 'analytics');
  assert.equal(places['client-mailbox'].tab, 'analytics');
  const mailbox = homeToolsFor('client', ['client-mailbox']).find(t => t.key === 'mailbox');
  assert.deepEqual(mailbox.target, { kind: 'tab', tab: 'analytics', anchor: 'section-mailbox' });
  // Reports holds the mailbox and statements; the owner's old Work view is gone.
  const reports = await fs.readFile('mobile/src/LiveClientReports.tsx', 'utf8');
  assert.match(reports, /<MailboxSection /); assert.match(reports, /<StatementCard /);
  const workspace = await fs.readFile('mobile/src/LiveWorkspace.tsx', 'utf8');
  assert.doesNotMatch(workspace, /currentView === "owner"/);
});

test('inbox chips combine with the tab and the property, with counts and an empty state each', () => {
  const t = (id, extra) => ({ id, status: 'open', waitingSince: null, lastFrom: 'team', lastMessageAt: '2026-10-09T08:00:00Z', propertyId: A, mine: false, ...extra });
  const threads = [
    t('waiting', { waitingSince: '2026-10-09T08:00:00Z', lastFrom: 'guest', mine: true }),
    t('answered', { propertyId: B }),
    t('done', { status: 'done', propertyId: B, mine: true }),
    t('nowhere', { propertyId: null, lastFrom: 'guest', waitingSince: '2026-10-09T07:00:00Z' }),
  ];
  const facts = x => inbox.guestFacts(x);
  const ids = (chip, property) => inbox.filterInbox(threads, facts, chip, property).map(x => x.id);
  assert.deepEqual(ids('reply'), ['waiting', 'nowhere']);
  assert.deepEqual(ids('unread'), ['waiting', 'nowhere']);
  assert.deepEqual(ids('mine'), ['waiting', 'done']);
  assert.deepEqual(ids('open'), ['waiting', 'answered', 'nowhere']);
  assert.deepEqual(ids('done'), ['done']);
  assert.deepEqual(ids('mine', B), ['done']);
  assert.deepEqual(ids('all', B), ['answered', 'done']);
  assert.deepEqual(inbox.chipCounts(threads, facts, inbox.GUEST_CHIPS), { reply: 2, unread: 2, mine: 2, open: 3, done: 1, all: 4 });
  assert.deepEqual(inbox.chipCounts(threads, facts, inbox.GUEST_CHIPS, A), { reply: 1, unread: 1, mine: 1, open: 1, done: 0, all: 1 });
  // Unread is per person and device: opened after the guest wrote, it is read.
  assert.equal(inbox.guestFacts(threads[0], '2026-10-09T09:00:00Z').unread, false);
  assert.equal(inbox.guestFacts(threads[0], '2026-10-09T07:00:00Z').unread, true);
  const names = new Map([[A, 'Harbour Flat'], [B, 'Loch Cottage']]);
  assert.deepEqual(inbox.propertyChips(threads, facts, names, 'reply'), [{ id: A, name: 'Harbour Flat', count: 1 }, { id: B, name: 'Loch Cottage', count: 0 }]);
  assert.deepEqual(inbox.propertyChips(threads.slice(0, 1), facts, names), [], 'one property: no property chips');
  for (const chip of inbox.GUEST_CHIPS) {
    assert.ok(inbox.emptyMessage(chip, 'guests').length > 10, chip);
    assert.match(inbox.emptyMessage(chip, 'team', 'Loch Cottage'), /Loch Cottage/);
  }
  assert.deepEqual([...inbox.CHAT_CHIPS], ['all', 'unread', 'reply', 'mine']);
});

test('a conversation needs a reply when someone else wrote last; owner chats when the owner did', () => {
  const c = (kind, last, extra = {}) => ({ kind, unread: 0, propertyId: null, last, ...extra });
  const facts = inbox.conversationFacts;
  assert.equal(facts(c('direct', { authorName: 'Anna' })).needsReply, true);
  assert.equal(facts(c('direct', { authorName: 'You' })).needsReply, false);
  assert.equal(facts(c('direct', null)).needsReply, false);
  assert.equal(facts(c('owner', { authorName: 'Olive', fromOwner: true })).needsReply, true);
  assert.equal(facts(c('owner', { authorName: 'Anna', fromOwner: false })).needsReply, false, 'a colleague answered');
  assert.equal(facts(c('owner', { authorName: 'Anna', fromOwner: false }), true).needsReply, true, 'for the owner, Recharge wrote last');
  assert.equal(facts(c('owner', null)).mine, false); assert.equal(facts(c('group', null)).mine, true);
  assert.deepEqual(facts(c('owner', null, { propertyIds: [A, B], mine: true })).propertyIds, [A, B]);
  assert.deepEqual(facts(c('group', null, { propertyId: A })).propertyIds, [A]);
  assert.equal(facts(c('group', null, { unread: 2 })).unread, true);
});
