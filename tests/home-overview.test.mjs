import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The admins' Home is the business at a glance (Lee: "Alex knows numbers and what are the things that needs his
// attention"): "This month" (eight figures from reads the app already makes, each opening its detail), then "Needs
// your attention" (six lines and See all), then the departments. A figure that can't load shows a quiet "–".
// The phone menu lists Management centre with the other departments.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const ov = await vite.ssrLoadModule('/lib/home-overview.ts');
const { adminNeeds } = await vite.ssrLoadModule('/lib/home-needs.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { performanceQuery, periodRange } = await vite.ssrLoadModule('/lib/performance.ts');
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { orderPhoneBar, phoneMoreGroups } = await vite.ssrLoadModule('/lib/menu-layout.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const { phoneBarFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const read = file => readFileSync(file, 'utf8');
const TODAY = '2026-10-14';

const figures = (o = {}) => ({
  managementFeeMinor: 0, vatMinor: 0, cleaningChargedMinor: 0, cleaningCostMinor: 0, cleaningMarginMinor: 0, cleanCount: 0, cleansWithoutCost: 0, statementCount: 0,
  grossRevenueMinor: 0, nightsBooked: 0, nightsAvailable: 0, occupancyBps: null, nightsSold: 0, averageNightlyRateMinor: null, ...o,
});
const enquiries = received => ({ from: '', to: '', received, priority: 0, bySource: { form: 0, app: 0 }, byStart: [], funnel: { received, estimate: 0, agreement: 0, live: 0, declined: 0 },
  reply: { replied: 0, waiting: 0, medianMinutes: null, slowestMinutes: null, estimateSent: 0, estimateMedianMinutes: null, estimateSlowestMinutes: null }, rows: [] });
const full = {
  month: figures({ grossRevenueMinor: 1_254_000, occupancyBps: 6420, nightsBooked: 321, nightsAvailable: 500, averageNightlyRateMinor: 10277 }),
  lastMonth: figures({ grossRevenueMinor: 1_120_000, occupancyBps: 6000, nightsBooked: 300, nightsAvailable: 510, averageNightlyRateMinor: 10277, managementFeeMinor: 375_000, statementCount: 12 }),
  enquiries: enquiries(6), enquiriesBefore: enquiries(4), payoutsOverdue: 3,
  portfolio: { live: 14, onboarding: 3 },
};
const byKey = list => Object.fromEntries(list.map(f => [f.key, f]));

test('admins and super admins see the business figures; nobody else does', () => {
  for (const role of ['super_admin', 'admin']) assert.ok(ov.showsBusiness(role), role);
  for (const role of ['stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client']) assert.ok(!ov.showsBusiness(role), role);
  // AdminHome is only drawn for admins, and it is where the figures are.
  const home = read('mobile/src/LiveHome.tsx');
  assert.match(home, /const admin = account\.role === "admin" \|\| account\.role === "super_admin";/);
  assert.match(home, /\{admin \? <AdminHome /);
  assert.ok(!home.includes('<BusinessFigures'), 'the team and owners keep their Home');
});

test('eight figures with their values and changes against last month', () => {
  const list = ov.businessFigures(full, TODAY);
  assert.deepEqual(list.map(f => f.key), ['bookings', 'occupancy', 'rate', 'nights', 'fees', 'properties', 'enquiries', 'payouts']);
  const f = byKey(list);
  assert.deepEqual([f.bookings.value, f.occupancy.value, f.rate.value, f.nights.value, f.fees.value, f.properties.value, f.enquiries.value, f.payouts.value],
    ['£12.5k', '64.2%', '£102.77', '321', '£3,750', '14', '6', '3']);
  assert.equal(f.bookings.change, null, 'a month in progress only counts settled payouts, so no arrow against a finished month');
  assert.equal(f.bookings.detail, 'Settled so far');
  assert.equal(f.occupancy.change.text, '▲ 4.2 pts vs Sept');
  assert.equal(f.rate.change.text, 'Same as Sept');
  assert.equal(f.nights.change.text, '▲ 7% vs Sept');
  assert.equal(f.enquiries.change.text, '▲ 50% vs Sept');
  assert.equal(f.payouts.change, null, 'an overdue count has nothing to compare with');
  assert.equal(f.payouts.label, 'Payouts overdue');
  assert.equal(f.payouts.detail, 'Past their pay date');
  assert.match(f.enquiries.change.spoken, /the same days of Sept/);
  assert.equal(f.fees.change, null, 'fees are last month\'s, with nothing to compare');
  assert.equal(f.fees.detail, 'Issued for September');
  for (const x of list) assert.ok(x.detail.length <= 22, x.key + ': the detail fits a phone tile');
  assert.equal(f.properties.detail, '3 onboarding');
  assert.equal(f.occupancy.detail, '321 of 500 nights');
  assert.equal(ov.figureText(f.occupancy), 'Occupancy: 64.2%, up 4.2 points on Sept');
  // Changes are words and arrows only: no colours in the data, so the screen shows them in the muted colour.
  for (const x of list) if (x.change) assert.deepEqual(Object.keys(x.change).sort(), ['direction', 'spoken', 'text']);
});

test('a figure that cannot load shows a quiet "–", never an error; zeros are marked to show quietly', () => {
  const none = ov.businessFigures(ov.EMPTY_OVERVIEW, TODAY);
  assert.equal(none.length, 8);
  for (const f of none) { assert.equal(f.value, '–', f.key); assert.ok(f.missing, f.key); assert.equal(f.change, null, f.key); }
  assert.equal(ov.MISSING, '–');
  assert.equal(ov.figureText(none[0]), 'Bookings value: not available');
  // One read failing leaves the others alone.
  const some = byKey(ov.businessFigures({ ...full, enquiries: null, month: null }, TODAY));
  assert.equal(some.enquiries.value, '–');
  assert.equal(some.bookings.value, '–');
  assert.equal(some.fees.value, '£3,750', 'last month still loaded');
  assert.equal(some.payouts.value, '3');
  assert.equal(byKey(ov.businessFigures({ ...full, payoutsOverdue: null }, TODAY)).payouts.value, '–', 'the overview failed: payouts overdue reads "–"');
  // Nothing to compare with (last month empty or missing): no change line, and a zero is flagged as a zero.
  const quiet = byKey(ov.businessFigures({ ...full, lastMonth: figures(), payoutsOverdue: 0 }, TODAY));
  assert.equal(quiet.nights.change, null);
  assert.equal(quiet.payouts.value, '0');
  assert.ok(quiet.payouts.zero && !quiet.payouts.missing);
  assert.equal(quiet.payouts.detail, 'All in on time');
  // No occupancy (no nights available) reads "–" too.
  assert.equal(byKey(ov.businessFigures({ ...full, month: figures() }, TODAY)).occupancy.value, '–');
});

test('each figure opens the page where its detail lives', () => {
  const f = byKey(ov.businessFigures(full, TODAY));
  for (const key of ['bookings', 'occupancy', 'rate', 'nights', 'fees']) assert.deepEqual(f[key].open, { kind: 'work', view: 'accounts', sub: 'performance' }, key);
  assert.deepEqual(f.properties.open, { kind: 'page', section: 'properties' });
  assert.deepEqual(f.enquiries.open, { kind: 'tab', tab: 'enquiries' });
  assert.deepEqual(f.payouts.open, { kind: 'work', view: 'accounts', sub: 'payouts' }, 'Accounts → Reconciliation, as the Needs line');
  for (const x of Object.values(f)) if (x.open.kind !== 'page') assert.ok(deepLinkFor(x.open), x.key + ' opens somewhere');
});

test('the dates: this month and last month as Performance asks, and the same days of last month', () => {
  const r = ov.overviewRanges(TODAY);
  assert.deepEqual(r.month, periodRange('this_month', TODAY), 'the same dates Accounts → Performance opens on');
  assert.deepEqual(r.lastMonth, { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(r.soFar, { from: '2026-10-01', to: '2026-10-14' });
  assert.deepEqual(r.sameDaysBefore, { from: '2026-09-01', to: '2026-09-14' });
  assert.deepEqual(ov.overviewRanges('2026-03-31').sameDaysBefore, { from: '2026-02-01', to: '2026-02-28' }, 'stops at the end of a short month');
  assert.deepEqual(ov.overviewRanges('2026-01-05').lastMonth, { from: '2025-12-01', to: '2026-01-01' });
  assert.deepEqual(ov.performanceRangeQuery(r.month), performanceQuery(r.month), 'the same query as the Performance page');
});

test('Needs your attention: six lines, then See all (n) opens the rest in place, most urgent first', () => {
  const overview = { today: TODAY, stays: { listingsToCheck: 1, relistingsOpen: 2, emptyNights: 4, guestsWaiting: 10 }, cleans: { today: 6, doneToday: 0, unassignedToday: 8, toReview: 1, disputes: 0 },
    ready: { ownerApproval: 0, toRefer: 5, referred: 0, booked: 0, visitsDue: 0 }, accounts: { expensesToApprove: 4, overLimit: 0, payoutsToReconcile: 30, statementsToIssue: 2 } };
  const lines = adminNeeds(overview, 7, 1);
  assert.equal(lines.length, 12);
  assert.equal(ov.ATTENTION_SHOWN, 6);
  const first = ov.shownNeeds(lines, false);
  assert.deepEqual(first.map(l => l.key), ['decisions', 'guests', 'unassigned', 'review', 'refer', 'expenses']);
  assert.equal(ov.seeAllLabel(lines.length), 'See all (12)');
  assert.deepEqual(ov.shownNeeds(lines, true), lines, 'expanded: every line, in the same order');
  assert.equal(ov.seeAllLabel(6), null, 'six or fewer: no See all');
  assert.equal(ov.seeAllLabel(0), null);
  const focus = read('mobile/src/HomeFocus.tsx');
  assert.match(focus, /const \[expanded, setExpanded\] = useState\(false\);/);
  assert.match(focus, /testID="home-needs-all"[^\n]*onPress=\{\(\) => setExpanded\(true\)\}/);
});

test('Home order for admins: greeting and search, This month, Needs your attention, departments, favorites', () => {
  const home = read('mobile/src/LiveHome.tsx'), oversight = read('mobile/src/LiveOversight.tsx'), focus = read('mobile/src/HomeFocus.tsx');
  const team = home.slice(home.indexOf('function TeamHome('), home.indexOf('function OwnerLiveHome('));
  const order = ['<HomeGreeting ', '<AskBox ', '<AdminHome ', '<HomeFavorites '].map(x => team.indexOf(x));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'greeting, search, the admin part, favorites');
  const admin = oversight.slice(oversight.indexOf('export function AdminHome('));
  const parts = ['<BusinessFigures ', '<NeedsList ', '<DepartmentTiles '].map(x => admin.indexOf(x));
  assert.ok(parts.every((x, i) => x >= 0 && (i === 0 || x > parts[i - 1])), 'This month, then Needs your attention, then the departments');
  assert.match(admin, /limit=\{ATTENTION_SHOWN\}/);
  // Four to a row on a computer, two on a phone; changes and zeros in the muted colour, never red or green.
  const grid = focus.slice(focus.indexOf('export function BusinessFigures('), focus.indexOf('export function DepartmentTiles('));
  assert.match(grid, /flexBasis: desktop \? "22%" : "46%"/);
  assert.match(grid, /color: f\.missing \|\| f\.zero \? p\.muted : p\.text/);
  assert.doesNotMatch(grid, /p\.(danger|success|badge|cautionWash)/);
  assert.match(grid, /This month/);
  // Only reads that already exist: the Performance report, the enquiries Business report and management's overview.
  assert.match(oversight, /readFinance\(performanceRangeQuery\(range\)\)/);
  assert.match(oversight, /"reportEnquiries"/);
  assert.doesNotMatch(oversight, /"reportRepairs"/, 'repair spend left Home for payouts overdue');
  assert.match(oversight, /payoutsOverdue: overview\?\.accounts\.payoutsToReconcile \?\? null/);
});

test('the phone menu lists Management centre for admins, first in Departments as on desktop', () => {
  for (const role of ['super_admin', 'admin']) {
    const panel = rolePanel(role, DEFAULT_ROLE_MODULES[role], null, false);
    const desktop = panel.groups.find(g => g.key === 'departments').links.map(l => l.label);
    const phone = phoneMoreGroups(panel, orderPhoneBar(phoneBarFor(role).slice(0, 5), panel)).find(g => g.key === 'departments').links.map(l => l.label);
    assert.equal(phone[0], 'Management centre', role);
    assert.deepEqual(phone, desktop, role + ': the same departments, in the same order');
  }
});

test('no em dashes in the overview', () => {
  for (const file of ['lib/home-overview.ts', 'tests/home-overview.test.mjs']) assert.doesNotMatch(read(file), new RegExp(String.fromCharCode(0x2014)), file);
});
