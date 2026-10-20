import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The desktop left panel: each role has its own, built from what that role can open, and View as
// shows the viewed role's panel with nothing from the super admin's.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { homeToolsFor, homeActionsFor, startActionsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { previewAccount, previewKeeps } = await vite.ssrLoadModule('/lib/view-as.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { calendarTeamsFor } = await vite.ssrLoadModule('/lib/calendar-live.ts');
after(() => vite.close());

const roles = Object.keys(DEFAULT_ROLE_MODULES);
const links = panel => panel.groups.flatMap(g => g.links);
const keys = panel => links(panel).map(l => l.key).sort().join();
if (process.env.SHOW_PANELS) for (const role of roles) {
  const p = rolePanel(role, DEFAULT_ROLE_MODULES[role]);
  console.log(`\n== ${role}: ${p.title} — ${p.tagline}`);
  for (const g of p.groups) console.log(`  [${g.title}] ` + g.links.map(l => `${l.label}(${l.kind})`).join(', '));
}

test('every role has its own panel: its own heading and its own set of links', () => {
  const titles = new Set(), sets = new Set();
  for (const role of roles) {
    const panel = rolePanel(role, DEFAULT_ROLE_MODULES[role]);
    assert.ok(panel.groups.length >= 2, role);
    titles.add(panel.title); sets.add(keys(panel));
    assert.equal(links(panel)[0].key, 'page:home', role + ' starts at Home');
    assert.equal(new Set(links(panel).map(l => l.key)).size, links(panel).length, role + ' lists nothing twice');
    for (const g of panel.groups) assert.ok(g.links.length, role + ': no empty groups');
  }
  assert.equal(titles.size, roles.length, 'each role is named for itself');
  // Admin and super admin share the management layout, Access control included (20261022700000); every other role
  // has a set of its own.
  assert.equal(sets.size, roles.length - 1);
  assert.equal(keys(rolePanel('admin', DEFAULT_ROLE_MODULES.admin)), keys(rolePanel('super_admin', DEFAULT_ROLE_MODULES.super_admin)));
});

test('every Work area, Home tool and quick start of a role is in its panel, and only those', () => {
  for (const role of roles) {
    const modules = DEFAULT_ROLE_MODULES[role], panel = rolePanel(role, modules), all = links(panel);
    // Work → Calendar is the Calendar page, opened on a team by the menu's calendars (Alex's menu), so it is not a
    // second area link.
    for (const view of workViewsFor(role)) assert.ok(all.some(l => view === 'calendar' ? l.key === 'page:calendar' || l.key.startsWith('tool:calendar-') : l.kind === 'area' && l.view === view), `${role} has ${view}`);
    for (const l of all) if (l.kind === 'area') assert.ok(workViewsFor(role).includes(l.view), `${role} can open ${l.view}`);
    // Accounts' Owner statements tool is their Owner statements page.
    for (const t of homeToolsFor(role, modules)) if (!(role === 'accounts' && t.key === 'statements')) assert.ok(all.some(l => l.key === 'tool:' + t.key || (l.kind === 'area' && t.target.kind === 'work' && l.view === t.target.view) || (l.kind === 'page' && t.target.kind === 'tab' && l.section === t.target.tab)), `${role} has ${t.key}`);
    for (const a of startActionsFor(role, modules)) assert.ok(all.some(l => l.key === 'start:' + a.key), `${role} can start ${a.key}`);
    assert.deepEqual(homeActionsFor(role, modules).map(a => a.key), role === 'client' ? startActionsFor(role, modules).map(a => a.key) : [], role + ': Home has no quick-action pills for the team');
  }
});

test('team-only, owner-only and admin-only places stay with their roles', () => {
  const has = (role, key, modules = DEFAULT_ROLE_MODULES[role]) => links(rolePanel(role, modules)).some(l => l.key === key);
  // Admins have Access control too (20261022700000), limited to accounts below admin.
  assert.ok(has('super_admin', 'tool:access') && has('admin', 'tool:access'));
  for (const role of roles.filter(r => !['admin', 'super_admin'].includes(r))) assert.ok(!has(role, 'tool:access'), role + ' has no Access control');
  for (const role of roles.filter(r => !['admin', 'super_admin'].includes(r))) assert.ok(!has(role, 'area:management'), role + ' has no Management');
  // Round 6: owners have Favorites too (Lee: "regardless of which role").
  assert.ok(has('client', 'page:approvals') && has('client', 'page:favorites'));
  assert.ok(!has('cleans', 'page:approvals') && !has('cleans', 'page:statements') && !has('cleans', 'area:accounts'));
  // A tool the person doesn't hold isn't offered.
  assert.ok(!has('stays', 'tool:aircover', []) && has('stays', 'tool:aircover', ['aircover-reporting']));
  assert.deepEqual(rolePanel('nobody', MODULE_IDS).groups, []);
});

test('View as a role shows that role\'s panel, with nothing from the super admin\'s', () => {
  const me = { userId: '00000000-0000-4000-8000-000000000001', role: 'super_admin', status: 'active', fullName: 'Sam', email: 's@example.com', modules: [...MODULE_IDS] };
  for (const role of roles.filter(r => r !== 'super_admin')) {
    const shown = previewAccount(me, role);
    assert.equal(keys(rolePanel(shown.role, shown.modules)), keys(rolePanel(role, DEFAULT_ROLE_MODULES[role] ?? MODULE_IDS)), role);
    assert.notEqual(rolePanel(shown.role, shown.modules).title, 'Super admin');
  }
});

test('a role preview keeps only the records that role could be shown', () => {
  const cleaner = previewKeeps('cleans', DEFAULT_ROLE_MODULES.cleans);
  assert.ok(cleaner.work('cleaning-schedule') && !cleaner.work('owner-statements') && !cleaner.work('maintenance-reporting'));
  assert.deepEqual([cleaner.invoices, cleaner.journeys, cleaner.notices], [false, false, false]);
  const accounts = previewKeeps('accounts', DEFAULT_ROLE_MODULES.accounts);
  assert.ok(accounts.invoices && accounts.journeys && accounts.work('owner-statements') && !accounts.work('cleaning-schedule'));
  const ready = previewKeeps('ready', DEFAULT_ROLE_MODULES.ready);
  assert.ok(ready.journeys && !ready.invoices);
  const admin = previewKeeps('admin', []);
  assert.ok(admin.work('anything') && admin.invoices && admin.journeys && admin.notices);
});

// Alex's menu (20 October 2026): the team's sections in this order, each role seeing only what it can open.
const TEAM_SECTIONS = ['My Recharge', 'Maintenance', 'Management', 'Safety & Compliance', 'Property Onboarding', 'Listing Management', 'Property Database', 'Stock', 'Housekeeping', 'Finance', 'Start something'];
const linkOf = (role, key) => links(rolePanel(role, DEFAULT_ROLE_MODULES[role])).find(l => l.key === key);
const sectionOf = (role, key) => rolePanel(role, DEFAULT_ROLE_MODULES[role]).groups.find(g => g.links.some(l => l.key === key))?.title;

test('the team menu runs My Recharge to Finance in Alex\'s order, Home, Favourites, Inbox and To-do first', () => {
  for (const role of roles.filter(r => r !== 'client')) {
    const panel = rolePanel(role, DEFAULT_ROLE_MODULES[role]), titles = panel.groups.map(g => g.title);
    assert.deepEqual(titles, TEAM_SECTIONS.filter(t => titles.includes(t)), role + ': the sections in order, nothing else');
    assert.ok(!panel.groups.some(g => g.title === 'More'), role + ': every link has a place, none in an extra More');
    assert.deepEqual(panel.groups[0].links.slice(0, 4).map(l => l.key), ['page:home', 'page:favorites', 'page:inbox', 'page:todo'], role);
    assert.deepEqual(panel.groups[0].links.slice(0, 4).map(l => l.label), ['Home', 'Favourites', 'Inbox', 'To-do'], role);
    assert.equal(linkOf(role, 'page:decisions').label, 'Approval Requests', role);
    assert.equal(sectionOf(role, 'page:decisions'), 'Management', role);
  }
  // Admins and super admins see everything, the same menu.
  const admin = rolePanel('admin', MODULE_IDS), superAdmin = rolePanel('super_admin', MODULE_IDS);
  assert.deepEqual(admin.groups, superAdmin.groups);
  assert.deepEqual(admin.groups.map(g => g.title), TEAM_SECTIONS);
  const at = (title, panel = admin) => panel.groups.find(g => g.title === title).links.map(l => l.label);
  assert.deepEqual(at('My Recharge'), ['Home', 'Favourites', 'Inbox', 'To-do', 'Schedule', 'Reports']);
  assert.deepEqual(at('Maintenance'), ['Reactive Jobs', 'AirCover Claims', 'Maintenance Calendar']);
  assert.deepEqual(at('Management').slice(0, 2), ['Approval Requests', 'Daily Checklist']);
  for (const key of ['tool:people', 'tool:productivity', 'tool:performance', 'tool:access', 'tool:limits', 'page:moderation', 'tool:training', 'page:feedback', 'area:management', 'area:all'])
    assert.equal(sectionOf('admin', key), 'Management', key);
  assert.deepEqual(at('Safety & Compliance'), ['Licensing']);
  assert.deepEqual(at('Property Onboarding'), ['New Property Inspections', 'Leads', 'Property Status', 'Client relations']);
  assert.deepEqual(at('Listing Management'), ['Direct Bookings', 'Booking Calendar', 'Pricing', 'Booking Performance', 'Reviews', 'Listing Maintenance', 'Guest relations']);
  assert.deepEqual(at('Property Database'), ['Property Database']);
  assert.deepEqual(at('Stock'), ['Place Order', 'Item Catalogue']);
  assert.deepEqual(at('Housekeeping'), ['Cleans', 'Calendar', 'Form Submissions']);
  assert.deepEqual(at('Finance'), ['Order Fulfilment', 'Payable Invoices', 'Receivable Invoices', 'Client Funds & Expenses', 'Owner Statements', 'Profit/Loss Reporting', 'Accounts desk']);
  // The team's own numbers are My Performance; admins' Reports is the business, last in My Recharge.
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.equal(linkOf(role, 'page:analytics').label, 'My Performance', role);
  // Schedule: the cleaning manager's schedule, a cleaner's own cleans, admins' rota.
  assert.equal(linkOf('cleaning_manager', 'tool:schedule').label, 'Schedule');
  assert.equal(linkOf('cleans', 'tool:today').label, 'Schedule');
  assert.equal(linkOf('admin', 'tool:rota').label, 'Schedule');
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:rota').target), { section: 'work', view: 'management', sub: 'rota' });
  // Each team's own places.
  assert.equal(linkOf('ready', 'tool:pipeline').label, 'Reactive Jobs');
  assert.equal(linkOf('cleaning_manager', 'area:cleans').label, 'My Jobs');
  assert.equal(linkOf('cleaning_manager', 'tool:review').label, 'Form Submissions');
  assert.equal(linkOf('accounts', 'tool:purchases').label, 'Order Fulfilment');
  assert.equal(sectionOf('accounts', 'tool:purchases'), 'Finance');
  assert.equal(linkOf('ready', 'tool:purchases').label, 'Place Order');
  assert.equal(sectionOf('ready', 'tool:purchases'), 'Stock');
  assert.equal(linkOf('accounts', 'tool:cleaner-invoices').label, 'Payable Invoices');
  assert.equal(linkOf('stays', 'tool:studio').label, 'Item Catalogue');
  assert.equal(sectionOf('stays', 'area:stays'), 'Listing Management');
  assert.equal(sectionOf('stays', 'area:clients'), 'Property Onboarding');
  assert.equal(sectionOf('stays', 'area:cleans'), 'Housekeeping');
  assert.equal(sectionOf('accounts', 'area:accounts'), 'Finance');
  // Booking Performance is the Guests and stays report; Profit/Loss is Accounts' Performance tab.
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:booking-performance').target), { section: 'analytics', anchor: 'section-guests-and-stays' });
  assert.deepEqual(deepLinkFor(linkOf('accounts', 'tool:profit-loss').target), { section: 'work', view: 'accounts', sub: 'performance' });
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:receivable').target), { section: 'work', view: 'accounts', sub: 'receivable' });
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:dailytasks').target), { section: 'work', view: 'management', sub: 'dailytasks' });
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:onboarding').target), { section: 'work', view: 'clients', sub: 'onboarding' });
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:reviews').target), { section: 'work', view: 'clients', sub: 'reviews' });
});

test('the menu\'s calendars open the Calendar on one team, for the teams the role can filter by', () => {
  const TEAM_OF = { 'tool:calendar-ready': 'ready', 'tool:calendar-stays': 'stays', 'tool:calendar-cleans': 'cleans' };
  for (const role of roles.filter(r => r !== 'client')) {
    const calendars = links(rolePanel(role, DEFAULT_ROLE_MODULES[role])).filter(l => l.key.startsWith('tool:calendar-'));
    assert.deepEqual(calendars.map(l => TEAM_OF[l.key]).sort(), calendarTeamsFor(role).filter(t => t !== 'accounts').sort(), role);
    for (const l of calendars) assert.deepEqual(deepLinkFor(l.target), { section: 'calendar', team: TEAM_OF[l.key] }, role + ' ' + l.key);
  }
  assert.equal(linkOf('ready', 'tool:calendar-ready').label, 'Maintenance Calendar');
  assert.equal(sectionOf('ready', 'tool:calendar-ready'), 'Maintenance');
  assert.equal(linkOf('stays', 'tool:calendar-stays').label, 'Booking Calendar');
  assert.equal(sectionOf('stays', 'tool:calendar-stays'), 'Listing Management');
  assert.equal(linkOf('cleans', 'tool:calendar-cleans').label, 'Calendar');
  assert.equal(sectionOf('cleans', 'tool:calendar-cleans'), 'Housekeeping');
  // The workspace hands the team to the Calendar, whose Team filter starts on it (and can be changed).
  const workspace = readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8'), calendar = readFileSync('mobile/src/LiveCalendar.tsx', 'utf8');
  assert.match(workspace, /setCalendarTeam\(link\.team \? \{ team: link\.team, nonce: freshNonce\(\) \} : null\);/);
  assert.match(workspace, /<LiveCalendar key=\{"calendar:" \+ \(calendarTeam\?\.nonce \?\? ""\)\}[^>]*focusTeam=\{calendarTeam\?\.team\}/);
  assert.match(calendar, /useState<Team \| "all">\(\(\) => focusTeam && calendarTeamsFor\(account\.role\)\.includes\(focusTeam\) \? focusTeam : "all"\)/);
  // A team that is not a calendar team is no link at all; the plain Calendar link has no team.
  assert.equal(deepLinkFor({ kind: 'work', view: 'calendar', sub: 'nobody' }), null);
  assert.deepEqual(deepLinkFor({ kind: 'work', view: 'calendar' }), { section: 'calendar' });
});

test('the owner menu: Home, Favourites, Inbox, My Portfolio, My Statements, Property Performance, Approvals, Mailbox', () => {
  const panel = rolePanel('client', DEFAULT_ROLE_MODULES.client);
  assert.deepEqual(panel.groups[0].links.map(l => l.label), ['Home', 'Favourites', 'Inbox', 'My Portfolio', 'My Statements', 'Property Performance', 'Approvals', 'Mailbox']);
  // My Statements opens the Statements part of the Portfolio page.
  assert.deepEqual(deepLinkFor(panel.groups[0].links[4].target), { section: 'analytics', anchor: 'section-statements' });
  // Their repairs, requests and furnishing stay one section down, then Start something.
  assert.deepEqual(panel.groups.map(g => g.key), ['your-properties', 'requests', 'start']);
  assert.deepEqual(panel.groups[1].links.map(l => l.key), ['area:repairs', 'area:all', 'tool:furnishing', 'page:help']);
  assert.ok(!links(panel).some(l => l.key === 'page:calendar' || l.key.startsWith('tool:calendar-')), 'owners have no calendar yet');
});
