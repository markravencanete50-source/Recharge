import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Each role's Home (Lee: what we applied for the super admin, applied to every role, with what each role needs to see).
// The same layout as management's: the person's figures at a glance, then "Needs you now" (only lines with something
// waiting, most urgent first, never a zero, each opening where the work is done, six and "See all"). The counts come
// from workspace_role_home (tests/role-home-database.test.mjs checks who may read what); owners' from their own reads.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const needs = await vite.ssrLoadModule('/lib/home-needs.ts');
const rh = await vite.ssrLoadModule('/lib/role-home.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { needText } = needs;
const read = file => readFileSync(file, 'utf8');
const base = (role, o = {}) => rh.roleHomeSchema.parse({ role, today: '2026-10-15', weekStart: '2026-10-12', month: '2026-10', ...o });
const texts = lines => lines.map(needText);
const opensSomewhere = line => line.open.kind === 'page' || line.open.kind === 'tracker' || !!deepLinkFor(line.open);

test('Guest relations: guests and repairs first, then enquiries, reviews, check-ins and the daily checks', () => {
  const h = base('stays', { guestsWaiting: 3, repairsToRefer: 1, enquiriesToValue: 2, cleansToReview: 4, listingsToCheck: 5, relistingsOpen: 0, emptyNights: 6 });
  const lines = needs.staysNeeds(h, 1);
  assert.deepEqual(texts(lines), ['3 guests waiting for a reply', '1 repair to troubleshoot and refer', '2 client enquiries to value', '4 cleans waiting for your review',
    '1 client check-in due', '5 listings to check today', '6 empty nights to price this week']);
  assert.deepEqual(lines.filter(l => l.urgent).map(l => l.key), ['guests', 'triage']);
  assert.ok(lines.every(opensSomewhere));
  assert.deepEqual(lines.find(l => l.key === 'enquiries').open, { kind: 'tab', tab: 'enquiries' });
  // Without the guest inbox or enquiries (null), those lines are left out; nothing waiting: All clear.
  assert.deepEqual(texts(needs.staysNeeds(base('stays', { guestsWaiting: null, enquiriesToValue: null, cleansToReview: 1 }))), ['1 clean waiting for your review']);
  assert.deepEqual(needs.staysNeeds(base('stays')), []);
});

test('cleaning managers, cleaners, Ready and Accounts: their own lines, most urgent first, never a zero', () => {
  assert.deepEqual(texts(needs.cleaningManagerNeeds(base('cleaning_manager', { unassignedToday: 2, toReview: 1, disputes: 1, unassignedTomorrow: 3, restockOpen: 1 }))),
    ['2 cleans not assigned today', '1 clean waiting for your review', '1 rejected clean to decide', '3 cleans not assigned tomorrow', '1 restock request open']);
  assert.deepEqual(texts(needs.cleanerNeeds(base('cleans', { overdue: 1, redo: 2, cleansToday: 3, toRespond: 1 }))),
    ['1 clean overdue', '2 cleans sent back to redo', '3 cleans to do today', '1 rejected clean to give your side on']);
  assert.deepEqual(texts(needs.readyNeeds(base('ready', { toMarkDone: 1, approvedToBook: 2, visitsOverdue: 0, newJobs: 1, repairsToday: 1, visitsToday: 2 }))),
    ['1 repair visit passed: mark it done', '2 repairs approved: book the visits', '1 new repair for you: estimate or book it', '1 repair visit today', '2 routine visits today']);
  assert.deepEqual(texts(needs.accountsNeeds(base('accounts', { payoutsOverdue: 7, expensesToApprove: 2, purchasesToApprove: 1, purchaseInvoicesToRecord: 1, cleanerInvoicesToApprove: 3, statementsToIssue: 4 }))),
    ['7 payouts overdue to reconcile', '2 expenses to approve', '1 purchase to approve', '1 purchase invoice to record', '3 cleaner invoices to approve', '4 statements to issue']);
  for (const [build, role] of [[needs.cleaningManagerNeeds, 'cleaning_manager'], [needs.cleanerNeeds, 'cleans'], [needs.readyNeeds, 'ready'], [needs.accountsNeeds, 'accounts']]) {
    assert.deepEqual(build(base(role)), [], role + ': nothing waiting, All clear');
    const all = build(base(role, Object.fromEntries(Object.keys(rh.roleHomeSchema.shape).filter(k => !['role', 'today', 'weekStart', 'month'].includes(k)).map(k => [k, 1]))));
    assert.ok(all.length && all.every(opensSomewhere), role + ': every line opens where the work is done');
    assert.ok(all.every(l => l.count > 0));
  }
  // The restock line opens the restock tracker; Ready's lines open Maintenance on the stage.
  assert.deepEqual(needs.cleaningManagerNeeds(base('cleaning_manager', { restockOpen: 1 }))[0].open, { kind: 'tracker', module: 'replenishment-requests' });
  assert.equal(needs.readyNeeds(base('ready', { approvedToBook: 1 }))[0].open.sub, 'referred');
});

test('owners: their decisions first, then messages, a statement and repairs under way; nothing waiting says so calmly', () => {
  const lines = needs.ownerNeeds({ repairApprovals: 1, onboardingSteps: 1, unread: 3, statements: 2, statementMonth: 'September', repairsInProgress: 1 });
  assert.deepEqual(texts(lines), ['1 repair cost waiting for your approval', '1 onboarding step waiting for you', '3 new messages', '2 statements for September ready to read', '1 repair in progress at your properties']);
  assert.deepEqual(lines.map(l => l.open), [{ kind: 'tab', tab: 'approvals' }, { kind: 'tab', tab: 'approvals' }, { kind: 'page', section: 'inbox' }, { kind: 'tab', tab: 'analytics' }, { kind: 'work', view: 'repairs' }]);
  assert.deepEqual(needs.ownerNeeds({ repairApprovals: 0, onboardingSteps: 0, unread: 0, statements: 0, statementMonth: 'September', repairsInProgress: 0 }), [], 'no zeros: Home says Nothing needs you right now');
  assert.match(read('mobile/src/HomeFocus.tsx'), /Nothing needs you right now\./);
});

test('figures: each role\'s own, money only for Accounts and owners, a figure that cannot load shows a dash', () => {
  const keys = (role, o) => rh.roleFigures(base(role, o)).map(f => f.key);
  assert.deepEqual(keys('stays'), ['checkIns', 'checkOuts', 'cleans', 'repairs']);
  assert.deepEqual(keys('cleaning_manager'), ['today', 'week', 'firstTime', 'complaints']);
  assert.deepEqual(keys('cleans'), ['done', 'pay', 'firstTime', 'week']);
  assert.deepEqual(keys('ready'), ['open', 'week', 'done']);
  assert.deepEqual(keys('accounts'), ['payouts', 'expenses', 'issued', 'ownerPayouts']);
  for (const role of ['stays', 'cleaning_manager', 'ready'])
    assert.ok(rh.roleFigures(base(role, { checkInsToday: 9, cleansToday: 9, openJobs: 9 })).every(f => !f.value.includes('£')), role + ' sees no money');
  const stays = rh.roleFigures(base('stays', { checkInsToday: 2, checkInsTomorrow: 3, cleansToday: 5, cleansDoneToday: 4, openRepairs: 0 }));
  assert.deepEqual(stays.map(f => [f.value, f.detail]), [['2', '3 tomorrow'], ['–', 'At your properties'], ['4', 'of 5 today'], ['0', 'At your properties']]);
  assert.ok(stays[1].missing && stays[3].zero);
  // Accepted first time: the share of first reviews passed this month; none yet shows a dash.
  const first = f => f.find(x => x.key === 'firstTime');
  assert.deepEqual([first(rh.roleFigures(base('cleans', { reviewedFirst: 8, acceptedFirst: 6 }))).value, first(rh.roleFigures(base('cleans', { reviewedFirst: 8, acceptedFirst: 6 }))).detail], ['75%', '6 of 8 this month']);
  assert.equal(first(rh.roleFigures(base('cleans', { reviewedFirst: 0, acceptedFirst: 0 }))).value, '–');
  // The cleaner's pay is their month's amount, from the same read as Work, Cleans, Your month.
  assert.equal(rh.roleFigures(base('cleans'), { payLabel: '£240.00', payDetail: '8 cleans at £30.00' }).find(f => f.key === 'pay').value, '£240.00');
  // Ready: repairs and routine visits together.
  assert.equal(rh.roleFigures(base('ready', { repairsThisWeek: 2, visitsThisWeek: 3 })).find(f => f.key === 'week').value, '5');
  const accounts = rh.roleFigures(base('accounts', { payoutsReceivedMinor: 1234500, expensesMinor: 50000, expensesCount: 2, statementsIssued: 3, ownerPayoutsMinor: 0 }));
  assert.deepEqual(accounts.map(f => f.value), ['£12.3k', '£500', '3', '£0']);
});

test('owners: their own month, next check-in and nights booked in the next 30 days', () => {
  const summary = { bookingIncomeMinor: 240000, payoutMinor: 180000, occupancy: 0.642, bookedNights: 20, availableNights: 31, basis: 'estimated' };
  const upcoming = rh.ownerUpcoming([
    { checkIn: '2026-10-20', checkOut: '2026-10-23', propertyName: 'Ash Cottage' },
    { checkIn: '2026-10-10', checkOut: '2026-10-17', propertyName: 'Ash Cottage' }, // two nights left from the 15th
    { checkIn: '2026-11-12', checkOut: '2026-11-18', propertyName: 'Birch House' }, // two nights inside the 30 days (to 14 Nov)
  ], '2026-10-15');
  assert.deepEqual(upcoming, { nights: 3 + 2 + 2, next: { checkIn: '2026-10-20', propertyName: 'Ash Cottage' } });
  const f = rh.ownerFigures(summary, upcoming);
  assert.deepEqual(f.map(x => [x.key, x.value]), [['earnings', '£2,400'], ['payout', '£1,800'], ['occupancy', '64.2%'], ['next', 'Tue 20 Oct'], ['nights', '7']]);
  assert.equal(f[0].detail, 'Estimated so far');
  assert.equal(f[2].detail, '20 of 31 nights');
  assert.equal(rh.ownerFigures({ ...summary, basis: 'issued' }, upcoming)[0].detail, 'From your statement');
  assert.ok(rh.ownerFigures(null, null).every(x => x.missing), 'reads that fail show dashes');
  assert.equal(rh.ownerFigures(null, { nights: 0, next: null }).find(x => x.key === 'next').value, 'None booked');
});

test('wiring: each role reads its own Home; View as previews exactly that role', () => {
  const home = read('mobile/src/LiveHome.tsx'), role = read('mobile/src/RoleHome.tsx'), server = read('lib/workspace-finance-server.ts');
  const team = home.slice(home.indexOf('function TeamHome('), home.indexOf('function OwnerLiveHome('));
  assert.match(team, /hasRoleHome\(account\.role\) \? <RoleHome [^\n]*role=\{account\.role\}/, 'the role comes from the account View as shows');
  assert.match(role, /readTeams\(roleHomeQuery\(role\)\)/);
  assert.match(role, /home\.role === role/, 'a read for another role is never shown');
  assert.match(role, /<BusinessFigures [^\n]*title="At a glance"/);
  assert.match(role, /<NeedsList [^\n]*limit=\{ATTENTION_SHOWN\}/);
  assert.ok(role.indexOf('<BusinessFigures ') < role.indexOf('<NeedsList '), 'figures, then Needs you now, as on management\'s Home');
  assert.match(server, /input\.section === 'roleHome' \? client\.rpc\('workspace_role_home', \{ view_role: input\.role \|\| null \}\)/);
  assert.deepEqual(rh.roleHomeQuery('ready'), { section: 'roleHome', role: 'ready' });
  for (const r of ['stays', 'cleaning_manager', 'cleans', 'ready', 'accounts']) assert.ok(rh.hasRoleHome(r), r);
  for (const r of ['admin', 'super_admin', 'client']) assert.ok(!rh.hasRoleHome(r), r);
  // The owner Home: figures first, then Needs you now, their properties, and tools after (with All tools).
  const owner = home.slice(home.indexOf('function OwnerLiveHome('));
  const order = ['<HomeGreeting ', '<BusinessFigures ', '<NeedsList ', '<OwnerHome ', '<HomeTools '].map(x => owner.indexOf(x));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'greeting, figures, needs, properties, tools');
  assert.doesNotMatch(read('mobile/src/LiveOwnerHome.tsx'), /Waiting for you|New messages/, 'no tiles showing 0');
});
