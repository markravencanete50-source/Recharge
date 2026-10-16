import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

// Source-level wiring for the remaining client feedback (INT-B): every page and sub-page is mounted by a
// component, nothing mounts the unrouted Hub or Stays screens, Messages gets the Updates tab, the flag
// role is provided, the three new cron lines are present, and owners keep their own path.
const read = file => readFileSync(file, 'utf8');
const mobile = name => read('mobile/src/' + name);
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const subs = await vite.ssrLoadModule('/lib/relations-subs.ts');
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const sections = await vite.ssrLoadModule('/lib/tracker-sections.ts');

const workspace = mobile('LiveWorkspace.tsx'), guest = mobile('GuestRelations.tsx'), client = mobile('ClientRelations.tsx');

test('Guest relations mounts each of its five sub-pages and the record-a-stay sheet', () => {
  for (const [sub, tag] of [['cleans', 'LiveCleans'], ['bookings', 'DirectBookings'], ['aircover', 'AirCoverList'], ['reactive', 'LiveRepairs'], ['preventative', 'PreventativeList']])
    assert.match(guest, new RegExp(`sub === "${sub}" && <${tag} `), sub);
  assert.deepEqual([...map.GUEST_RELATIONS_SUBS], ['cleans', 'bookings', 'aircover', 'reactive', 'preventative']);
  assert.match(guest, /<StaySheet p=\{p\} visible=\{recording\}/);
  assert.match(guest, /label="Record a stay"/);
  assert.match(guest, /focus\?\.open === "record-stay"/, 'a link can open the stay form');
  assert.match(guest, /pickSub\(subs, focus\?\.sub,/, 'a deep link sub selects the chip');
  assert.match(guest, /<Pills /);
});

test('Client relations mounts each of its eight sub-pages', () => {
  for (const [sub, tag] of [['onboarding', 'OnboardingTracker'], ['enquiries', 'LiveEnquiries'], ['licensing', 'LicensingList'], ['listings', 'ListingHealthList'], ['pricing', 'PricingList'], ['reviews', 'ReviewsList'], ['relisting', 'RelistingList'], ['purchases', 'PurchaseOrdersList']])
    assert.match(client, new RegExp(`sub === "${sub}" && <${tag} `), sub);
  assert.deepEqual([...map.CLIENT_RELATIONS_SUBS], ['onboarding', 'enquiries', 'licensing', 'listings', 'pricing', 'reviews', 'relisting', 'purchases']);
  assert.match(client, /pickSub\(subs, focus\?\.sub,/);
});

test('the sub-pages a role gets, and which opens first', () => {
  const all = ['cleans', 'bookings', 'aircover', 'reactive', 'preventative'];
  assert.deepEqual(subs.guestSubsFor('admin', []), all);
  assert.deepEqual(subs.guestSubsFor('super_admin', []), all);
  assert.deepEqual(subs.guestSubsFor('stays', ['direct-bookings', 'aircover-reporting']), ['bookings', 'aircover']);
  assert.deepEqual(subs.guestSubsFor('stays', []), all, 'never an empty area');
  assert.equal(subs.defaultGuestSub('stays', all), 'cleans');
  assert.equal(subs.defaultGuestSub('admin', all), 'bookings');
  assert.equal(subs.defaultGuestSub('stays', ['aircover']), 'aircover');
  assert.deepEqual(subs.clientSubsFor('admin', []), [...map.CLIENT_RELATIONS_SUBS]);
  assert.deepEqual(subs.clientSubsFor('stays', ['licensing']), ['onboarding', 'enquiries', 'licensing']);
  assert.equal(subs.defaultClientSub(subs.clientSubsFor('stays', [])), 'onboarding');
  assert.equal(subs.pickSub(['a', 'b'], 'b', 'a'), 'b');
  assert.equal(subs.pickSub(['a', 'b'], 'zzz', 'a'), 'a');
  for (const sub of map.GUEST_RELATIONS_SUBS) assert.ok(subs.GUEST_SUB_LABEL[sub], sub);
  for (const sub of map.CLIENT_RELATIONS_SUBS) assert.ok(subs.CLIENT_SUB_LABEL[sub], sub);
});

test('the workspace mounts every page and builds the section props once', () => {
  assert.match(workspace, /const sectionProps: SectionProps = \{ palette: p, account, properties, journeys, work,/);
  assert.match(workspace, /currentView === "stays" && <GuestRelations key=\{"stays:" \+ \(focus\?\.nonce \?\? ""\) \+ ":" \+ visit\} \{\.\.\.sectionProps\}/);
  assert.match(workspace, /currentView === "clients" && <ClientRelations key=\{"clients:" \+ \(focus\?\.nonce \?\? ""\) \+ ":" \+ visit\} \{\.\.\.sectionProps\}/);
  assert.match(workspace, /currentView === "cleans" && <LiveCleans /);
  assert.match(workspace, /currentView === "repairs" && <LiveRepairs /);
  assert.match(workspace, /currentView === "accounts" && <><LiveAccounts /);
  assert.match(workspace, /currentView === "management" && <LiveManagement [^>]*properties=\{properties\} work=\{work\} onOpenWork=\{setOpenWork\}/);
  assert.match(workspace, /tab === "todo" \? <TodoList \{\.\.\.sectionProps\} \/>/);
  assert.match(workspace, /tab === "decisions" \? <ManagementApprovals palette=\{p\} account=\{account\} properties=\{properties\} work=\{work\} onOpenWork=\{setOpenWork\} \/>/);
  assert.match(workspace, /tab === "calendar" \? <LiveCalendar [^>]*properties=\{properties\}/);
  assert.match(workspace, /<Reports [^>]*account=\{account\} work=\{work\}/);
  assert.match(workspace, /<LiveHome [^]*?favoriteEntries=\{entries\} onOpenEntry=\{openEntry\} \/>/);
  assert.doesNotMatch(workspace, /<TodoSummary/, 'the to-do list is its own tab, not a card on Home');
});

test('Messages gets the Updates tab and the old Updates page opens it', () => {
  // Round 6: the feed also gets the work list and where a row opens (the work item, or Messages).
  assert.match(workspace, /<LiveChat [^]*?updates=\{team \? <LiveActivity palette=\{p\} notices=\{notices\} loading=\{loading\} onRead=\{markRead\} work=\{work\} onOpenWork=\{setOpenWork\} onOpenMessages=\{\(\) => openMessages\(""\)\} onOpenProperty=\{openProperty\} onOpenEnquiries=\{\(\) => openLink\(CLIENT_ENQUIRIES_LINK\)\} \/> : undefined\}/);
  assert.match(workspace, /initialTab=\{team && \(chatUpdates !== null \|\| updatesLink\) \? "updates" : undefined\}/);
  assert.match(workspace, /const updatesLink = requested === "activity" && team;/);
  assert.match(workspace, /const tab: WorkspaceSection = updatesLink \? "inbox"/);
  assert.match(workspace, /if \(value === "activity" && team\) \{ openLink\(\{ section: "inbox", messagesTab: "updates" \}\)/);
  assert.match(workspace, /section === "messages" \? "inbox" : section/, 'a messages link is the inbox page');
  const chat = mobile('LiveChat.tsx');
  assert.match(chat, /initialTab\?: "updates"/);
  // Round 5: no Updates tab; the link opens the feed in place inside Messages.
  assert.match(chat, /const openUpdates = initialTab === "updates"/);
  assert.match(chat, /if \(showUpdates && updates && !owner\) return/);
  // Owners have no Updates tab in Messages; their Updates page stays.
  assert.match(workspace, /tab === "activity" \? <LiveActivity /);
  // The map resolves it the same way.
  assert.deepEqual(map.pageLink('activity'), { section: 'inbox', messagesTab: 'updates', redirected: true });
});

test('Hub and Stays are unrouted: nothing mounts them, and both files are still there', () => {
  for (const file of readdirSync('mobile/src').filter(f => f.endsWith('.tsx'))) {
    const text = mobile(file);
    assert.doesNotMatch(text, /<LiveHub[\s/>]/, file);
    assert.doesNotMatch(text, /<LiveStays[\s/>]/, file);
  }
  assert.doesNotMatch(workspace, /from "\.\/LiveHub"/);
  assert.doesNotMatch(workspace, /from "\.\/LiveStays"/);
  assert.doesNotMatch(workspace, /currentView === "hub"/);
  assert.match(mobile('LiveHub.tsx'), /export function LiveHub/);
  assert.match(mobile('LiveStays.tsx'), /export function LiveStays/);
});

test('the flag role is provided and the shared work sheet offers Flag for management', () => {
  assert.match(workspace, /<FlagRoleContext\.Provider value=\{account\.role\}>/);
  assert.match(workspace, /<\/CelebrateProvider><\/FlagRoleContext\.Provider>/);
  assert.equal(workspace.split('<FlagButton p={p} role={account.role} target={flagTarget(openWork)}').length - 1, 2, 'the tracker detail and the plain sheet');
  assert.match(workspace, /role: account\.role \}\) : null;/, 'the tracker context carries the role');
  // The shared sheet keeps the direct-booking policy gate.
  assert.match(workspace, /f\.key === "prepareQuote" && !policyConfirmed/);
});

test('every section list is reachable from the tracker registry or documented as built directly', () => {
  const ctx = { property: () => ({ name: 'Flat', address: '1 High St' }), forms: () => [], now: new Date('2026-10-13T12:00:00Z'), owner: false };
  const work = (kind, data = {}) => ({ workId: kind, propertyId: 'p', moduleId: 'm', title: kind, kind, status: 'waiting', version: 1, assigneeId: null, createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z', data });
  for (const [kind, section] of [['purchase', 'purchases'], ['licensing', 'licensing'], ['direct_booking', 'direct_bookings'], ['relisting', 'relisting']])
    assert.equal(sections.trackerItemFor(work(kind), ctx)?.section, section, kind);
  const source = read('lib/tracker-sections.ts');
  for (const word of ['onboarding', 'aircover', 'listing_health', 'pricing', 'reviews']) assert.match(source, new RegExp(word), word + ' is named in the registry notes');
});

test('the three new cron sweeps run next to the mid-stay one, with the same logging', () => {
  const worker = read('worker/index.ts');
  const at = name => worker.indexOf(`securityRpc('${name}', {})`);
  for (const name of ['workspace_ensure_daily_todos', 'workspace_clean_form_sweep', 'workspace_direct_booking_sweep']) {
    assert.ok(at(name) > at('workspace_mid_stay_cleans'), name + ' comes after the mid-stay sweep');
    assert.ok(at(name) < at('workspace_chase_owner_approvals'), name + ' sits beside it');
    assert.match(worker, new RegExp(`securityRpc\\('${name}', \\{\\}\\)\\)\\.catch\\(\\(\\) => \\{\\s+console\\.error\\('[^']+; the next run retries\\.'\\);`), name);
  }
  assert.match(worker, /hourly = tick\.getUTCMinutes\(\) < 15/);
  assert.match(worker, /everySixHours = hourly && tick\.getUTCHours\(\) % 6 === 0/);
  assert.match(worker, /if \(hourly\) \{[^]*workspace_ensure_daily_todos[^]*workspace_clean_form_sweep[^]*\n    \}/);
  assert.match(worker, /if \(everySixHours\) \{[^]*workspace_direct_booking_sweep/);
  // One trigger, every minute; the 15-minute jobs run on its :00, :15, :30 and :45 ticks.
  assert.match(read('scripts/build-backend-config.mjs'), /crons:\['\* \* \* \* \*'\]/);
});

test('the phone bar, management and the routine card use the new names', () => {
  const bar = mobile('NavigationBar.tsx');
  assert.match(bar, /export function liveNavigationFor/);
  assert.match(bar, /phoneBarFor\(role\)\.slice\(0, PHONE_BAR_MAX\)/);
  assert.match(workspace, /liveNavigationFor\(account\.role\)/);
  assert.doesNotMatch(workspace, /function liveNavigation\(/);
  const labels = role => map.phoneBarFor(role).map(i => i.label);
  assert.deepEqual(labels('admin'), ['Home', 'To-do', 'Work', 'Calendar', 'Messages']);
  assert.deepEqual(labels('stays'), ['Home', 'To-do', 'Work', 'Calendar', 'Messages']);
  assert.deepEqual(labels('ready'), ['Home', 'Maintenance', 'Calendar', 'To-do', 'Messages']);
  assert.deepEqual(labels('accounts'), ['Home', 'To-do', 'Invoices', 'Statements', 'Messages']);
  for (const role of ['admin', 'super_admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'])
    for (const item of map.phoneBarFor(role)) assert.ok(!/^(hub|activity)$/.test(item.value) && !/^(Hub|Stays|Updates|Activity)$/.test(item.label), role + ' ' + item.label);
  const management = mobile('LiveManagement.tsx');
  assert.match(management, /"reflections", "dailytasks"/);
  assert.match(management, /view === "reflections" && <ReflectionReview palette=\{p\} \/>/);
  assert.match(management, /view === "dailytasks" && <DailyTaskSettings p=\{p\} account=\{account\}.*?\/>/);
  assert.match(management, /<ManagementApprovals palette=\{p\} account=\{account\} properties=\{properties\} work=\{work\} onOpenWork=\{onOpenWork\} \/>/, 'the approvals list is intact');
  assert.match(management, /view === "productivity" && <LiveProductivity /, 'rota and timesheets stay reachable');
  assert.match(management, /view === "performance" && <LiveTeamPerformance /);
  const routine = mobile('StaysRoutine.tsx');
  assert.doesNotMatch(routine, /Daily checks/);
  assert.doesNotMatch(routine, /sectionAnchor/);
  assert.match(routine, /view: "clients", sub: "listings"/);
  assert.match(routine, /view: "stays", sub: "aircover"/);
});

test('owners keep their own path: no team pages, no Updates tab, their own bar', () => {
  assert.match(workspace, /const TEAM_ROLES: Role\[\] = \["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "accounts"\];/);
  assert.match(workspace, /todo: TEAM_ROLES, decisions: TEAM_ROLES, calendar: TEAM_ROLES/);
  assert.ok(!/TEAM_ROLES: Role\[\] = [^;]*"client"/.test(workspace));
  assert.match(workspace, /updates=\{team \?/);
  assert.match(workspace, /<LiveClientReports palette=\{p\} mailbox=/, 'owners still get their own reports');
  assert.match(workspace, /tab === "approvals" \? <LiveApprovals /);
  assert.deepEqual(map.phoneBarFor('client'), map.ownerNavigation());
  assert.doesNotMatch(workspace, /currentView === "owner"/);
});

test('the files this change touched have no em dashes and keep their line endings', () => {
  const dash = String.fromCharCode(0x2014);
  for (const file of ['lib/relations-subs.ts', 'lib/tracker-sections.ts', 'mobile/src/GuestRelations.tsx', 'mobile/src/ClientRelations.tsx', 'mobile/src/LiveWorkspace.tsx', 'mobile/src/NavigationBar.tsx', 'mobile/src/StaysRoutine.tsx', 'mobile/src/LiveManagement.tsx', 'worker/index.ts', 'tests/wiring-v2.test.mjs'])
    assert.ok(!read(file).includes(dash), file);
  assert.ok(!read('tests/wiring-v2.test.mjs').includes('\r\n'), 'tests use LF');
  for (const file of ['lib/relations-subs.ts', 'mobile/src/GuestRelations.tsx', 'mobile/src/ClientRelations.tsx'])
    assert.ok(/\r\n/.test(read(file)) && !/[^\r]\n/.test(read(file)), file + ' uses CRLF');
});
