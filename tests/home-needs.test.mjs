import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The calm Home (Alex's feedback, approved by Lee): a short greeting, "What do you need?", "Needs you now"
// (at most five lines for the team, most urgent first, never a zero; admins see every line, six at first, see
// tests/home-overview.test.mjs) and one number per department. Everything that moved off Home is still one tap away.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { adminNeeds, teamNeeds, departmentTiles, needText, NEEDS_SHOWN, MANAGEMENT_QUEUE } = await vite.ssrLoadModule('/lib/home-needs.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const read = file => readFileSync(file, 'utf8');

const overview = (o = {}) => ({
  today: '2026-10-14',
  stays: { listingsToCheck: 0, relistingsOpen: 2, emptyNights: 4, guestsWaiting: 10, ...o.stays },
  cleans: { today: 6, doneToday: 0, unassignedToday: 8, toReview: 1, disputes: 2, ...o.cleans },
  ready: { ownerApproval: 0, toRefer: 5, referred: 2, booked: 0, visitsDue: 10, ...o.ready },
  accounts: { expensesToApprove: 4, overLimit: 1, payoutsToReconcile: 307, statementsToIssue: 0, ...o.accounts },
});

test('admins: decisions first, then guests and today\'s cleans; every waiting line in order, never a zero', () => {
  const lines = adminNeeds(overview(), 3);
  assert.ok(lines.length > NEEDS_SHOWN, 'admins get every line; Home shows six and See all');
  assert.deepEqual(lines.map(needText), [
    '3 decisions waiting for management', '10 guests waiting for a reply', '8 cleans not assigned today', '1 clean waiting for review', '5 repairs to refer to Ready',
    '4 expenses to approve', '307 payouts to reconcile', '2 re-listings open', '4 empty nights to price this week',
  ]);
  assert.deepEqual(lines[0].open, MANAGEMENT_QUEUE);
  assert.ok(lines.slice(0, 3).every(l => l.urgent));
  const quiet = adminNeeds(overview({ stays: { guestsWaiting: 0, relistingsOpen: 0, emptyNights: 0 }, cleans: { unassignedToday: 0, toReview: 0 }, ready: { toRefer: 0 }, accounts: { expensesToApprove: 0 } }), 0);
  assert.deepEqual(quiet.map(needText), ['307 payouts to reconcile'], 'zeros never show');
  assert.deepEqual(adminNeeds(overview({ stays: { guestsWaiting: 0, relistingsOpen: 0, emptyNights: 0 }, cleans: { unassignedToday: 0, toReview: 0 }, ready: { toRefer: 0 }, accounts: { expensesToApprove: 0, payoutsToReconcile: 0 } }), 0), [], 'nothing waiting: Home says All clear');
  assert.deepEqual(adminNeeds(null, 1).map(needText), ['1 decision waiting for management'], 'the overview may fail; the queue still shows');
  assert.equal(adminNeeds(overview({ stays: { guestsWaiting: null } }), 0)[0].key, 'unassigned', 'no guest inbox: that line is left out');
});

test('every admin line opens a place that is mounted', () => {
  const zero = { stays: { listingsToCheck: 0, relistingsOpen: 0, emptyNights: 0, guestsWaiting: 0 }, cleans: { unassignedToday: 0, toReview: 0 }, ready: { toRefer: 0 }, accounts: { expensesToApprove: 0, payoutsToReconcile: 0, statementsToIssue: 0 } };
  const only = (area, key) => overview({ ...zero, [area]: { ...zero[area], [key]: 1 } });
  const cases = [['stays', 'guestsWaiting'], ['stays', 'listingsToCheck'], ['stays', 'relistingsOpen'], ['stays', 'emptyNights'], ['cleans', 'unassignedToday'], ['cleans', 'toReview'],
    ['ready', 'toRefer'], ['accounts', 'expensesToApprove'], ['accounts', 'payoutsToReconcile'], ['accounts', 'statementsToIssue']];
  for (const [area, key] of cases) {
    const lines = adminNeeds(only(area, key), 0);
    assert.equal(lines.length, 1, key);
    assert.ok(lines[0].open.kind !== 'page' && deepLinkFor(lines[0].open), key + ' opens somewhere');
  }
  assert.ok(deepLinkFor(MANAGEMENT_QUEUE));
  assert.deepEqual(adminNeeds(overview(zero), 0, 2)[0].open, { kind: 'page', section: 'properties' }, 'client check-ins open Properties');
});

test('the team: overdue first, then due today, check-ins, then the rest', () => {
  assert.deepEqual(teamNeeds({ overdue: 2, dueToday: 1, otherOpen: 4, followUps: 1 }).map(needText), ['2 tasks overdue', '1 task due today', '1 client check-in due', '4 other open tasks']);
  assert.deepEqual(teamNeeds({ overdue: 0, dueToday: 0, otherOpen: 0, followUps: 0 }), [], 'All clear');
  assert.deepEqual(teamNeeds({ overdue: 1, dueToday: 0, otherOpen: 0, followUps: 0 })[0].open, { kind: 'page', section: 'work' });
});

test('one number per department, each opening it', () => {
  const tiles = departmentTiles(overview());
  assert.deepEqual(tiles.map(t => [t.title, t.value, t.label]), [['Stays', '10', 'guests waiting'], ['Cleans', '0/6', 'done today'], ['Ready', '7', 'repairs open'], ['Accounts', '4', 'expenses to approve']]);
  assert.deepEqual(tiles.map(t => t.target.kind === 'work' && t.target.view), ['stays', 'cleans', 'repairs', 'accounts']);
  assert.deepEqual(departmentTiles(overview({ stays: { guestsWaiting: null, listingsToCheck: 1 } }))[0].label, 'listing to check');
});

test('Home: greeting, search, Needs you now; what moved off Home is still one tap away', () => {
  const home = read('mobile/src/LiveHome.tsx'), focus = read('mobile/src/HomeFocus.tsx'), oversight = read('mobile/src/LiveOversight.tsx'), workspace = read('mobile/src/LiveWorkspace.tsx');
  const team = home.slice(home.indexOf('function TeamHome('), home.indexOf('function OwnerLiveHome('));
  const owner = home.slice(home.indexOf('function OwnerLiveHome('));
  assert.match(home, /role === "client" \? <OwnerLiveHome \{\.\.\.props\} \/> : <TeamHome \{\.\.\.props\} \/>/);
  for (const part of ['<HomeGreeting ', '<ShiftButton ', '<AskBox ', '<EndOfDayCard palette={p} account={account} />', '<AdminHome ', '<TodayBoard ', '<NeedsList ', '<SearchPanel ']) assert.ok(team.includes(part), part);
  for (const gone of ['WelcomeHeader', 'Recent activity', 'Help for your role', 'QuickOverview', '<ShiftCard', 'Needs attention']) assert.ok(!team.includes(gone), gone + ' is off the team Home');
  for (const kept of ['<WelcomeHeader ', '<HomeTools ', '<OwnerHome ', '<QuickOverview ', 'Needs attention', 'Recent activity', 'Help for your role']) assert.ok(owner.includes(kept), 'owners keep ' + kept);
  assert.match(focus, /All clear\. Nothing needs you right now\./);
  assert.match(focus, /What do you need\?/);
  assert.match(oversight, /<NeedsList [^\n]*title="Needs your attention"[^\n]*onOpen=\{onOpen\}/);
  assert.match(oversight, /<DepartmentTiles /);
  assert.doesNotMatch(oversight, /Across the business|Needs a management decision/);
  // Recent activity is under the bell, To-do on its tab, My performance, Favorites and Help in the menu.
  assert.match(workspace, /const bell = updatesBell\(notices\)/);
  assert.match(workspace, /tab === "todo" \? <TodoList /);
  assert.match(workspace, /tab === "favorites" \? <FavoritesPage /);
  assert.match(read('lib/role-panel.ts'), /'My performance'/);
});

test('no em dashes in the new Home', () => {
  for (const file of ['lib/home-needs.ts', 'mobile/src/HomeFocus.tsx', 'mobile/src/LiveHome.tsx', 'mobile/src/LiveOversight.tsx', 'tests/home-needs.test.mjs'])
    assert.doesNotMatch(read(file), new RegExp(String.fromCharCode(0x2014)), file);
});
