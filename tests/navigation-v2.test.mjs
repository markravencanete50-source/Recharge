import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Navigation after the client feedback: Hub, Updates and Stays are gone from every menu; Guest relations,
// Client relations, To-do, Calendar, Messages and Management approvals are in; the phone bar has at most
// five items; search finds every new area; deep links resolve.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { workViewsFor, toolsFor, WORK_VIEW_LABEL } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { homeToolsFor, panelToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const search = await vite.ssrLoadModule('/lib/workspace-search.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
after(() => vite.close());

const ROLES = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'];
const TEAM = ROLES.filter(r => r !== 'client');
const modulesOf = role => role === 'admin' || role === 'super_admin' ? [...MODULE_IDS] : DEFAULT_ROLE_MODULES[role];
const links = role => rolePanel(role, modulesOf(role)).groups.flatMap(g => g.links);
const indexOf = role => search.buildSearchIndex({ role, modules: modulesOf(role), properties: [], work: [], invoices: [] });
const hits = (entries, q) => search.searchWorkspace(entries, q, 200).groups.flatMap(g => g.entries);
const opens = (entries, q, view, sub) => hits(entries, q).some(e => e.target.kind === 'tool' && e.target.target.kind === 'work' && e.target.target.view === view && e.target.target.sub === sub);
const read = file => readFileSync(file, 'utf8');

test('no panel, phone bar, Home tool or search entry shows Hub, Stays or Updates, for any role', () => {
  const banned = /^(hub|stays|updates|activity)$/i;
  for (const role of ROLES) {
    const panel = rolePanel(role, modulesOf(role));
    for (const g of panel.groups) {
      assert.doesNotMatch(g.title, banned, role + ' group ' + g.title);
      for (const l of g.links) {
        assert.doesNotMatch(l.label, banned, `${role}: ${l.label}`);
        assert.notEqual(l.kind === 'area' ? l.view : null, 'hub', role + ' has no Hub area');
        assert.notEqual(l.kind === 'page' ? l.section : null, 'activity', role + ' has no Updates page');
      }
    }
    for (const item of map.phoneBarFor(role)) {
      assert.doesNotMatch(item.label, banned, `${role} bar: ${item.label}`);
      assert.ok(!['hub', 'activity'].includes(item.value), `${role} bar: ${item.value}`);
    }
    for (const t of [...homeToolsFor(role, modulesOf(role)), ...panelToolsFor(role, modulesOf(role))]) {
      assert.doesNotMatch(t.label, banned, `${role} tool ${t.label}`);
      assert.notEqual(t.key, 'updates', role);
    }
    for (const e of indexOf(role)) {
      assert.doesNotMatch(e.label, banned, `${role} search: ${e.label}`);
      assert.ok(!['section:activity', 'view:hub', 'tool:updates'].includes(e.key), `${role}: ${e.key}`);
    }
    assert.ok(!workViewsFor(role).includes('hub'), role);
    for (const view of workViewsFor(role)) assert.doesNotMatch(WORK_VIEW_LABEL[view], banned, role);
    // Tools say where they live in the new names.
    for (const t of toolsFor(role, modulesOf(role))) assert.doesNotMatch(t.place.where, /\bStays\b|\bHub\b|Updates/, `${role}: ${t.id} "${t.place.where}"`);
  }
  assert.equal(WORK_VIEW_LABEL.stays, 'Guest relations');
  assert.equal(WORK_VIEW_LABEL.clients, 'Client relations');
});

test('Work views by role', () => {
  const admin = ['management', 'stays', 'clients', 'calendar', 'cleans', 'repairs', 'accounts', 'all'];
  assert.deepEqual(workViewsFor('admin'), admin);
  assert.deepEqual(workViewsFor('super_admin'), admin);
  assert.deepEqual(workViewsFor('stays'), ['stays', 'clients', 'calendar', 'cleans', 'repairs', 'all']);
  assert.deepEqual(workViewsFor('cleans'), ['cleans', 'calendar', 'all']);
  assert.deepEqual(workViewsFor('cleaning_manager'), ['cleans', 'calendar', 'all']);
  assert.deepEqual(workViewsFor('ready'), ['repairs', 'calendar', 'all']);
  assert.deepEqual(workViewsFor('accounts'), ['accounts', 'calendar', 'all']);
  assert.deepEqual(workViewsFor('client'), ['repairs', 'all']);
});

test('the new pages and areas exist for the right roles and nobody else', () => {
  const has = (role, key) => links(role).some(l => l.key === key);
  for (const role of TEAM) {
    for (const key of ['page:home', 'page:todo', 'page:inbox', 'page:decisions', 'page:analytics']) assert.ok(has(role, key), `${role} has ${key}`);
    // The Calendar opens from the team calendars in Alex's menu (Maintenance, Booking, Housekeeping).
    assert.ok(links(role).some(l => l.key.startsWith('tool:calendar-')), role + ' has a calendar');
  }
  // Owners never see the team's pages or areas.
  // Favorites is for every role since round 6, owners included.
  for (const key of ['page:todo', 'page:calendar', 'page:decisions', 'area:stays', 'area:clients', 'area:management', 'area:accounts', 'area:cleans', 'area:calendar']) assert.ok(!has('client', key), 'owner has ' + key);
  assert.ok(has('client', 'page:approvals') && has('client', 'page:inbox'));
  // Guest relations and Client relations: admin and Guest relations staff only.
  for (const role of TEAM) {
    const both = role === 'admin' || role === 'super_admin' || role === 'stays';
    assert.equal(has(role, 'area:stays'), both, role + ' Guest relations');
    assert.equal(has(role, 'area:clients'), both, role + ' Client relations');
    assert.equal(has(role, 'area:management'), role === 'admin' || role === 'super_admin', role + ' Management');
  }
  // Labels.
  const label = (role, key) => links(role).find(l => l.key === key).label;
  assert.equal(label('admin', 'area:stays'), 'Guest relations');
  assert.equal(label('admin', 'area:clients'), 'Client relations');
  assert.equal(label('admin', 'page:decisions'), 'Approval Requests');
  assert.equal(label('stays', 'page:decisions'), 'Approval Requests');
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.equal(label(role, 'page:analytics'), 'My Performance', role);
  assert.equal(label('admin', 'page:analytics'), 'Reports');
});

test('cleaners never see Management, Accounts or Client relations', () => {
  for (const role of ['cleans', 'cleaning_manager']) {
    const all = links(role);
    for (const key of ['area:management', 'area:accounts', 'area:clients', 'area:stays', 'page:statements', 'tool:access', 'page:moderation']) assert.ok(!all.some(l => l.key === key), `${role} has ${key}`);
    for (const view of ['management', 'accounts', 'clients', 'stays']) assert.ok(!workViewsFor(role).includes(view), `${role} can open ${view}`);
    const entries = indexOf(role);
    assert.ok(!entries.some(e => e.key.startsWith('sub:clients:') || e.key === 'view:clients' || e.key === 'view:management' || e.key === 'view:accounts' || e.key === 'section:statements'), role + ' search');
    assert.ok(entries.some(e => e.key === 'section:decisions' && e.label === 'My requests'), role + ' can still ask management');
  }
});

test('the Guest relations and Client relations sub-pages are named exactly, for admin and Guest relations staff only', () => {
  assert.deepEqual([...map.GUEST_RELATIONS_SUBS], ['cleans', 'bookings', 'aircover', 'reactive', 'preventative']);
  assert.deepEqual([...map.CLIENT_RELATIONS_SUBS], ['onboarding', 'enquiries', 'licensing', 'listings', 'pricing', 'reviews', 'relisting', 'purchases', 'furnishing']);
  for (const x of map.WORK_SUBS) {
    assert.ok(map.isWorkSub(x.view, x.sub), x.sub);
    assert.ok((x.view === 'stays' ? map.GUEST_RELATIONS_SUBS : map.CLIENT_RELATIONS_SUBS).includes(x.sub), x.sub);
  }
  assert.equal(map.WORK_SUBS.length, 14);
  for (const role of ['admin', 'super_admin', 'stays']) {
    const entries = indexOf(role);
    for (const x of map.WORK_SUBS) assert.ok(hits(entries, x.label).some(e => e.target.kind === 'tool' && e.target.target.view === x.view && e.target.target.sub === x.sub), `${role} finds ${x.view}/${x.sub}`);
  }
  for (const role of ['ready', 'accounts', 'cleans', 'cleaning_manager', 'client']) assert.ok(!indexOf(role).some(e => e.key.startsWith('sub:') || (e.target.kind === 'tool' && e.target.target.kind === 'work' && ['stays', 'clients'].includes(e.target.target.view))), role + ' finds no relations sub-page');
  // Home tools of Guest relations point at the new sub-pages, not the old Stays sections.
  const tools = homeToolsFor('stays', DEFAULT_ROLE_MODULES.stays);
  const target = key => tools.find(t => t.key === key)?.target;
  assert.deepEqual(target('checks'), { kind: 'work', view: 'clients', sub: 'listings' });
  assert.deepEqual(target('pricing'), { kind: 'work', view: 'clients', sub: 'pricing' });
  assert.deepEqual(target('bookings'), { kind: 'work', view: 'stays', sub: 'bookings' });
  assert.deepEqual(target('licensing'), { kind: 'work', view: 'clients', sub: 'licensing' });
  assert.ok(!tools.some(t => t.key === 'signoff' || t.key === 'inbox'), 'the sign-off is the reflection and guests reply in Messages');
});

test('the phone bar has at most five items for every role', () => {
  const bar = role => map.phoneBarFor(role).map(i => i.value + ':' + i.label);
  for (const role of ROLES) {
    const items = map.phoneBarFor(role);
    assert.ok(items.length >= 4 && items.length <= map.PHONE_BAR_MAX && map.PHONE_BAR_MAX === 5, `${role}: ${items.length} items`);
    assert.equal(new Set(items.map(i => i.value)).size, items.length, role + ' lists nothing twice');
    assert.equal(items[0].value, 'home', role);
  }
  const labels = role => map.phoneBarFor(role).map(i => i.label);
  assert.deepEqual(labels('admin'), ['Home', 'To-do', 'Work', 'Calendar', 'Messages']);
  assert.deepEqual(labels('super_admin'), ['Home', 'To-do', 'Work', 'Calendar', 'Messages']);
  assert.deepEqual(labels('stays'), ['Home', 'To-do', 'Work', 'Calendar', 'Messages']);
  assert.deepEqual(labels('ready'), ['Home', 'Maintenance', 'Calendar', 'To-do', 'Messages']);
  assert.deepEqual(bar('accounts'), ['home:Home', 'todo:To-do', 'work:Invoices', 'statements:Statements', 'inbox:Messages']);
  // Cleaner flow: cleaners have Calendar on the bar; Properties moves to their Menu. Cleaning managers keep Properties.
  assert.deepEqual(bar('cleans'), ['home:Home', 'todo:To-do', 'work:Cleans', 'calendar:Calendar', 'inbox:Messages']);
  assert.deepEqual(bar('cleaning_manager'), ['home:Home', 'todo:To-do', 'work:Cleans', 'properties:Properties', 'inbox:Messages']);
  assert.deepEqual(labels('client'), ['Home', 'Properties', 'Inbox', 'Approvals', 'Reports'], 'owners are unchanged');
  for (const role of TEAM.filter(r => r !== 'cleans' && r !== 'cleaning_manager')) assert.ok(map.phoneBarFor(role).some(i => i.value === 'todo'), role + ' has To-do');
  // The older navigation bar (NavigationBar, DesktopNavigation) keeps its five.
  for (const role of ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'client']) assert.equal(map.navigationFor(role).length, 5, role);
});

test('search finds each new area by the words people use', () => {
  const admin = indexOf('admin'), stays = indexOf('stays'), ready = indexOf('ready');
  const page = (entries, q, section) => assert.ok(hits(entries, q).some(e => e.key === 'section:' + section), `"${q}" finds ${section}`);
  for (const q of ['todo', 'to-do', 'tasks']) page(admin, q, 'todo');
  for (const q of ['approvals', 'flags', 'requests']) page(admin, q, 'decisions');
  for (const q of ['rota', 'team calendar', 'changeovers', 'calendar']) page(admin, q, 'calendar');
  page(stays, 'my performance', 'analytics');
  page(ready, 'my performance', 'analytics');
  page(stays, 'my requests', 'decisions');
  assert.ok(hits(admin, 'reflection').length > 0, 'reflection');
  assert.ok(hits(admin, 'management approvals').some(e => e.key === 'section:decisions'));
  for (const role of ['admin', 'stays']) {
    const entries = indexOf(role);
    assert.ok(opens(entries, 'preventative', 'stays', 'preventative'), role + ' preventative');
    assert.ok(opens(entries, 'onboarding', 'clients', 'onboarding'), role + ' onboarding');
    assert.ok(opens(entries, 'licensing', 'clients', 'licensing'), role + ' licensing');
    assert.ok(opens(entries, 'listing health', 'clients', 'listings'), role + ' listing health');
    assert.ok(opens(entries, 'pricing', 'clients', 'pricing'), role + ' pricing');
    assert.ok(opens(entries, 'reviews', 'clients', 'reviews'), role + ' reviews');
    assert.ok(opens(entries, 'relisting', 'clients', 'relisting'), role + ' relisting');
    assert.ok(opens(entries, 'purchase orders', 'clients', 'purchases'), role + ' purchase orders');
    assert.ok(opens(entries, 'aircover', 'stays', 'aircover'), role + ' aircover');
    assert.ok(opens(entries, 'direct bookings', 'stays', 'bookings'), role + ' direct bookings');
    assert.ok(opens(entries, 'changeovers', 'stays', 'cleans'), role + ' changeovers');
    assert.ok(opens(entries, 'enquiries', 'clients', 'enquiries'), role + ' enquiries');
  }
  // WhatsApp is not a word for any place.
  for (const role of ROLES) assert.equal(hits(indexOf(role), 'whatsapp').length, 0, role + ' whatsapp');
  // A sub-page a tool already opens is one entry, not two.
  const keys = admin.map(e => e.key);
  assert.equal(new Set(keys).size, keys.length);
  // Owners never find team pages.
  const owner = indexOf('client');
  for (const key of ['section:todo', 'section:calendar', 'section:decisions', 'view:stays', 'view:clients']) assert.ok(!owner.some(e => e.key === key), key);
  // Quick actions are still searchable for the team, even though Home has no pills.
  assert.ok(admin.some(e => e.key === 'action:record-stay'));
});

test('deep links resolve for every page, sub-page and old link', () => {
  for (const x of map.WORK_SUBS) {
    const link = map.deepLinkFor({ kind: 'work', view: x.view, sub: x.sub });
    assert.deepEqual([link?.section, link?.view, link?.sub], ['work', x.view, x.sub], `${x.view}/${x.sub}`);
  }
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'clients', sub: 'nope' }), null, 'a made-up sub-page does not resolve');
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'stays', sub: 'record' }), null);
  assert.deepEqual(map.deepLinkFor({ kind: 'work', view: 'stays', open: 'record-stay' }), { section: 'work', view: 'stays', open: 'record-stay' }, 'the record-stay focus');
  for (const sub of map.MANAGEMENT_SUBS) assert.ok(map.deepLinkFor({ kind: 'work', view: 'management', sub }), 'management ' + sub);
  for (const sub of map.ACCOUNTS_SUBS) assert.ok(map.deepLinkFor({ kind: 'work', view: 'accounts', sub }), 'accounts ' + sub);
  for (const section of ['home', 'todo', 'calendar', 'inbox', 'decisions', 'analytics', 'favorites', 'properties', 'approvals', 'statements', 'feedback', 'moderation', 'help']) assert.deepEqual(map.pageLink(section), { section }, section);
  // Client enquiries has one home, the Enquiries chip in Client relations: its page link opens there.
  assert.deepEqual(map.pageLink('enquiries'), { section: 'work', view: 'clients', sub: 'enquiries', redirected: true });
  assert.equal(map.pageLink('nowhere'), null);
  // Old links keep working: Updates opens Messages, the Hub opens To-do, Work → Calendar is the Calendar.
  assert.deepEqual(map.pageLink('activity'), { section: 'inbox', messagesTab: 'updates', redirected: true });
  assert.deepEqual(map.deepLinkFor({ kind: 'tab', tab: 'activity' }), { section: 'inbox', messagesTab: 'updates', redirected: true });
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'hub' }).section, 'todo');
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'hub', sub: 'approvals' }).section, 'decisions');
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'calendar' }).section, 'calendar');
  assert.equal(map.deepLinkFor({ kind: 'work', view: 'stays', sub: 'inbox' }).section, 'inbox', 'the old Guest inbox is Messages');
  // Everything a role can click resolves: panel links, Home tools and search results.
  for (const role of ROLES) {
    for (const l of links(role)) {
      if (l.kind === 'page') assert.ok(map.pageLink(l.section), `${role} panel page ${l.section}`);
      if (l.kind === 'area') assert.ok(map.deepLinkFor({ kind: 'work', view: l.view }), `${role} panel area ${l.view}`);
      if (l.kind === 'tool' || l.kind === 'start') { const t = l.target; if (t.kind === 'work' || t.kind === 'tab') assert.ok(map.deepLinkFor(t), `${role} ${l.key}`); }
    }
    for (const e of indexOf(role)) {
      if (e.target.kind === 'section') assert.ok(map.pageLink(e.target.section), `${role} search ${e.key}`);
      if (e.target.kind === 'tool' && (e.target.target.kind === 'work' || e.target.target.kind === 'tab')) assert.ok(map.deepLinkFor(e.target.target), `${role} search ${e.key}`);
    }
  }
});

test('Hub tabs are not used by any navigation file', () => {
  const lib = read('lib/hub.ts');
  assert.match(lib, /@deprecated[\s\S]*export function hubTabsFor/, 'kept only until the unrouted Hub screen goes');
  for (const file of ['lib/role-panel.ts', 'lib/home-tools.ts', 'lib/workspace-search.ts', 'lib/workspace-map.ts', 'lib/tool-directory.ts', 'mobile/src/NavigationBar.tsx', 'mobile/src/RoleNavigation.tsx', 'mobile/src/DesktopNavigation.tsx'])
    assert.doesNotMatch(read(file), /hubTabsFor/, file);
});

test('the navigation files and this test have no em dashes', () => {
  for (const file of ['lib/tool-directory.ts', 'lib/role-panel.ts', 'lib/home-tools.ts', 'lib/workspace-map.ts', 'lib/workspace-search.ts', 'lib/hub.ts', 'tests/navigation-v2.test.mjs'])
    assert.ok(!read(file).includes(String.fromCharCode(0x2014)), file);
});
