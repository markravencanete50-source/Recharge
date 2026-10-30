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

// Alex's menu (20 October 2026): the team's sections in this order, each role seeing only what it can open. Business Plan
// v2 (30 October 2026) adds Databases (the old Property Database), Approvals, Receivable Invoices and Tasks after My Recharge.
const TEAM_SECTIONS = ['My Recharge', 'Databases', 'Approvals', 'Receivable Invoices', 'Tasks', 'Maintenance', 'Management', 'Safety & Compliance', 'Property Onboarding', 'Listing Management', 'Stock', 'Housekeeping', 'Finance', 'Start something'];
const linkOf = (role, key) => links(rolePanel(role, DEFAULT_ROLE_MODULES[role])).find(l => l.key === key);
const has = (role, key, modules = DEFAULT_ROLE_MODULES[role]) => links(rolePanel(role, modules)).some(l => l.key === key);
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
  assert.deepEqual(at('Maintenance'), ['Reactive Jobs', 'Garden Maintenance', 'Waste Collection', 'AirCover Claims', 'Maintenance Calendar']);
  assert.deepEqual(at('Management').slice(0, 2), ['Approval Requests', 'Daily Checklist']);
  for (const key of ['tool:people', 'tool:productivity', 'tool:performance', 'tool:access', 'tool:limits', 'page:moderation', 'tool:training', 'page:feedback', 'area:management', 'area:all'])
    assert.equal(sectionOf('admin', key), 'Management', key);
  assert.deepEqual(at('Safety & Compliance'), ['Licensing', 'Compliance Certs', 'Safety & Compliance Calendar']);
  assert.deepEqual(at('Property Onboarding'), ['New Property Inspections', 'Leads', 'Property Status', 'Calendar', 'Client relations']);
  assert.deepEqual(at('Listing Management'), ['Direct Bookings', 'Booking Calendar', 'Pricing', 'Booking Performance', 'Reviews', 'Listing Maintenance', 'Guest relations']);
  assert.deepEqual(at('Databases'), ['Properties', 'Clients', 'Contractors', 'Staff', 'Applicants', 'Contract Templates']);
  assert.deepEqual(at('Approvals'), ['Property Performance Manager', 'Property Operations Manager', 'Accounts']);
  assert.deepEqual(at('Receivable Invoices'), ['Receivable Invoices']);
  assert.deepEqual(at('Tasks'), ['Property Set-Up', 'Property Maintenance', 'Broadband', 'Safety Compliance', 'Licensing', 'Garden Maintenance', 'Waste Collection',
    'Recruitment', 'Photography', 'Social media', 'Guidebook', 'Changeovers', 'Reviews']);
  assert.deepEqual(at('Stock'), ['Place Order', 'Item Catalogue', 'Reimbursement Request']);
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

test('the calendar-only rule is judged after a saved menu order', () => {
  const cal = l => l.key.startsWith('tool:calendar-'), M = DEFAULT_ROLE_MODULES.super_admin;
  // Licensing and Compliance Certs moved to Management: Safety & Compliance is left with only its calendar, so it goes.
  const moved = { sections: [], items: { management: ['tool:licensing', 'tool:compliance'] } };
  const panel = rolePanel('super_admin', M, moved);
  assert.ok(!panel.groups.some(g => g.key === 'safety'), 'no section for the safety calendar alone');
  assert.ok(!links(panel).some(l => l.key === 'tool:calendar-safety'));
  assert.deepEqual(panel.groups.find(g => g.key === 'management').links.slice(0, 2).map(l => l.key), ['tool:licensing', 'tool:compliance']);
  for (const g of panel.groups) assert.ok(!g.links.every(cal), g.title + ' is only a calendar');
  assert.equal(links(panel).filter(cal).length, 4, 'the other calendars stay');
  assert.ok(!links(panel).some(l => l.key === 'page:calendar'), 'calendars remain, so no plain Calendar');
  // The Menu order editor keeps the emptied section, so the links can move back; the lone calendar is not offered.
  const editor = rolePanel('super_admin', M, moved, true);
  assert.deepEqual(editor.groups.find(g => g.key === 'safety').links, []);
  assert.ok(!links(editor).some(l => l.key === 'tool:calendar-safety'));
  // The calendar moved in with them is kept: its section is not only a calendar.
  const withCalendar = rolePanel('super_admin', M, { sections: [], items: { management: ['tool:licensing', 'tool:compliance', 'tool:calendar-safety'] } });
  assert.equal(withCalendar.groups.find(g => g.key === 'management').links[2].key, 'tool:calendar-safety');
  // Every calendar left alone by the saved order: the plain Calendar comes back in the first section.
  const R = DEFAULT_ROLE_MODULES.ready, plain = rolePanel('ready', R);
  const others = plain.groups.slice(1).flatMap(g => g.links).filter(l => !cal(l)).map(l => l.key);
  const stripped = rolePanel('ready', R, { sections: [], items: { [plain.groups[0].key]: [...plain.groups[0].links.map(l => l.key), ...others] } });
  assert.ok(!links(stripped).some(cal));
  assert.ok(stripped.groups[0].links.some(l => l.key === 'page:calendar'), 'Ready can still open the Calendar');
  // With no saved order nothing changes.
  assert.deepEqual(rolePanel('super_admin', M, null), rolePanel('super_admin', M));
});

test('the menu\'s calendars open the Calendar on one team, for the teams the role can filter by', () => {
  // The safety and onboarding calendars hold Ready's work (safety visits, inspections), so they go to the roles that see it.
  const TEAM_OF = { 'tool:calendar-ready': 'ready', 'tool:calendar-stays': 'stays', 'tool:calendar-cleans': 'cleans', 'tool:calendar-safety': 'ready', 'tool:calendar-onboarding': 'ready' };
  const PRESET_OF = { 'tool:calendar-safety': 'safety', 'tool:calendar-onboarding': 'onboarding' };
  for (const role of roles.filter(r => r !== 'client')) {
    const panel = rolePanel(role, DEFAULT_ROLE_MODULES[role]), calendars = links(panel).filter(l => l.key.startsWith('tool:calendar-'));
    for (const l of calendars) assert.ok(calendarTeamsFor(role).includes(TEAM_OF[l.key]), role + ' ' + l.key);
    // A section is never only a calendar; a role whose calendars would each stand alone keeps the plain Calendar.
    for (const g of panel.groups) assert.ok(!g.links.every(l => l.key.startsWith('tool:calendar-')), role + ': ' + g.title + ' is only a calendar');
    assert.ok(calendars.length || panel.groups[0].links.some(l => l.key === 'page:calendar'), role + ' can open the Calendar');
    for (const l of calendars) assert.deepEqual(deepLinkFor(l.target), PRESET_OF[l.key] ? { section: 'calendar', preset: PRESET_OF[l.key] } : { section: 'calendar', team: TEAM_OF[l.key] }, role + ' ' + l.key);
  }
  // Admins and Guest relations keep all five; accounts' would each stand alone, so they get the plain Calendar.
  for (const role of ['admin', 'super_admin', 'stays']) assert.equal(links(rolePanel(role, DEFAULT_ROLE_MODULES[role])).filter(l => l.key.startsWith('tool:calendar-')).length, 5, role);
  const accounts = rolePanel('accounts', DEFAULT_ROLE_MODULES.accounts);
  assert.ok(!links(accounts).some(l => l.key.startsWith('tool:calendar-')));
  assert.deepEqual(accounts.groups.map(g => g.title), ['My Recharge', 'Databases', 'Approvals', 'Receivable Invoices', 'Tasks', 'Management', 'Stock', 'Finance', 'Start something']);
  // Ready cannot open Licensing, so no Safety & Compliance for its calendar alone; its Onboarding keeps the calendar.
  assert.ok(!linkOf('ready', 'tool:calendar-safety'));
  assert.equal(linkOf('ready', 'tool:calendar-onboarding').label, 'Calendar');
  assert.equal(sectionOf('ready', 'tool:calendar-onboarding'), 'Property Onboarding');
  assert.equal(sectionOf('stays', 'tool:calendar-safety'), 'Safety & Compliance');
  assert.ok(!has('stays', 'tool:calendar-safety', []), 'without Licensing the safety calendar would stand alone');
  assert.equal(linkOf('accounts', 'page:calendar').label, 'Calendar');
  assert.ok(!linkOf('ready', 'tool:calendar-stays') && !linkOf('cleaning_manager', 'tool:calendar-stays'), 'no Listing Management for a Booking calendar alone');
  assert.equal(linkOf('ready', 'tool:calendar-ready').label, 'Maintenance Calendar');
  assert.equal(sectionOf('ready', 'tool:calendar-ready'), 'Maintenance');
  assert.equal(linkOf('stays', 'tool:calendar-stays').label, 'Booking Calendar');
  assert.equal(sectionOf('stays', 'tool:calendar-stays'), 'Listing Management');
  assert.equal(linkOf('cleans', 'tool:calendar-cleans').label, 'Calendar');
  assert.equal(sectionOf('cleans', 'tool:calendar-cleans'), 'Housekeeping');
  // The workspace hands the team or preset to the Calendar, which is then that type's calendar alone (Lee, 20 October 2026:
  // no team switcher, no All teams, nothing to clear; tests/tool-focus-pages.test.mjs).
  const workspace = readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8'), calendar = readFileSync('mobile/src/LiveCalendar.tsx', 'utf8');
  assert.match(workspace, /setCalendarTeam\(link\.team \? \{ team: link\.team, nonce: freshNonce\(\) \} : link\.preset \? \{ preset: link\.preset, nonce: freshNonce\(\) \} : null\);/);
  assert.match(workspace, /<LiveCalendar key=\{"calendar:" \+ \(calendarTeam\?\.nonce \?\? ""\)\}[^>]*locked=\{calendarTeam\?\.team \?\? calendarTeam\?\.preset \?\? null\}/);
  assert.match(calendar, /const teams = locked \? \[\] : calendarTeamsFor\(account\.role\);/);
  // A team that is not a calendar team is no link at all; the plain Calendar link has no team.
  assert.equal(deepLinkFor({ kind: 'work', view: 'calendar', sub: 'nobody' }), null);
  assert.deepEqual(deepLinkFor({ kind: 'work', view: 'calendar' }), { section: 'calendar' });
  // The preset keeps the Calendar on that kind of work, with nothing to clear.
  assert.match(calendar, /filterLock\(calendarEntries\(schedule\), locked\)/);
  assert.doesNotMatch(calendar, /setPreset\(null\)/);
});

test('the safety calendar keeps routine safety visits and licensing, never garden or bins; onboarding keeps inspections', async () => {
  const cal = await vite.ssrLoadModule('/lib/calendar-live.ts');
  const day = '2026-10-20', id = n => '00000000-0000-4000-8000-00000000000' + n;
  const w = (n, kind, title, moduleId = null) => ({ workId: id(n), propertyId: id(9), propertyName: 'Flat', moduleId, title, status: 'open', dueOn: day, dueTime: null, endTime: null, assigneeId: null, assigneeName: null, kind, version: 1 });
  const entries = cal.calendarEntries({ work: [w(1, 'routine_visit', 'Safety check'), w(2, 'routine_visit', 'Garden visit'), w(3, 'routine_visit', 'Bin collection'), w(4, 'inspection', 'New property inspection'),
    w(5, 'licensing', 'Licence application'), w(6, 'cleaning', 'Clean'), w(7, 'garden_setup', 'Garden set-up'), w(8, 'maintenance', 'Leak')], stays: [], payments: [] });
  const titles = focus => cal.filterFocus(entries, focus).map(e => e.title).sort();
  assert.deepEqual(titles('safety'), ['Licence application', 'Safety check']);
  assert.deepEqual(titles('onboarding'), ['Garden set-up', 'New property inspection']);
  assert.equal(cal.filterFocus(entries, null).length, entries.length);
  assert.deepEqual([...cal.CALENDAR_FOCUSES], ['safety', 'onboarding']);
});

test('Garden Maintenance and Waste Collection open preventative visits on that visit type, which can be cleared', async () => {
  const { visitKindOfSub } = await vite.ssrLoadModule('/lib/repairs-live.ts');
  for (const role of ['admin', 'super_admin', 'stays', 'ready']) {
    assert.deepEqual(deepLinkFor(linkOf(role, 'tool:garden').target), { section: 'work', view: 'repairs', sub: 'visits-garden', anchor: 'section-preventative-maintenance' }, role);
    assert.deepEqual(deepLinkFor(linkOf(role, 'tool:bins').target), { section: 'work', view: 'repairs', sub: 'visits-bins', anchor: 'section-preventative-maintenance' }, role);
    assert.equal(sectionOf(role, 'tool:garden'), 'Maintenance', role);
  }
  assert.ok(!has('stays', 'tool:garden', []), 'Guest relations need a routine tool');
  for (const role of ['cleans', 'cleaning_manager', 'accounts', 'client']) assert.ok(!linkOf(role, 'tool:garden') && !linkOf(role, 'tool:bins'), role);
  const ready = rolePanel('ready', DEFAULT_ROLE_MODULES.ready).groups.find(g => g.title === 'Maintenance').links.map(l => l.label);
  assert.deepEqual(ready.slice(0, 3), ['Reactive Jobs', 'Garden Maintenance', 'Waste Collection']);
  assert.equal(visitKindOfSub('visits-garden'), 'garden');
  assert.equal(visitKindOfSub('visits-bins'), 'bins');
  assert.equal(visitKindOfSub('action'), null);
  const repairs = readFileSync('mobile/src/LiveRepairs.tsx', 'utf8');
  assert.match(repairs, /useState<VisitKind \| "all">\(\(\) => visitKindOfSub\(focus\?\.sub\) \?\? "all"\)/);
  assert.match(repairs, /<Dropdown p=\{p\} label="Visit type" value=\{visitKind\} onChange=\{setVisitKind\}/);
});

test('Compliance Certs opens the licensing tracker; Reimbursement Request starts the New expense form', () => {
  for (const role of ['admin', 'stays']) {
    assert.deepEqual(deepLinkFor(linkOf(role, 'tool:compliance').target), deepLinkFor(linkOf(role, 'tool:licensing').target), role);
    assert.equal(sectionOf(role, 'tool:compliance'), 'Safety & Compliance', role);
  }
  assert.ok(!has('stays', 'tool:compliance', []));
  for (const role of ['admin', 'super_admin', 'accounts']) {
    const link = linkOf(role, 'form:new-expense');
    assert.equal(link.label, 'Reimbursement Request', role);
    assert.equal(link.kind, 'start', role);
    assert.deepEqual(link.target, { kind: 'work', view: 'accounts', sub: 'expenses', open: 'new-expense' }, role);
    assert.equal(sectionOf(role, 'form:new-expense'), 'Stock', role);
    assert.ok(linkOf(role, 'start:new-expense'), role + ' keeps New expense in Start something');
  }
  for (const role of ['stays', 'ready', 'cleans', 'cleaning_manager', 'client']) assert.ok(!linkOf(role, 'form:new-expense'), role);
});

test('the owner menu: Home, Favourites, Inbox, My Portfolio, My Statements, Calendar, Property Performance, Approvals, Mailbox', () => {
  const panel = rolePanel('client', DEFAULT_ROLE_MODULES.client);
  assert.deepEqual(panel.groups[0].links.map(l => l.label), ['Home', 'Favourites', 'Inbox', 'My Portfolio', 'My Statements', 'Calendar', 'Property Performance', 'Approvals', 'Mailbox']);
  // My Statements and Calendar open the Statements and Booking calendar parts of the Portfolio page.
  assert.deepEqual(deepLinkFor(panel.groups[0].links[4].target), { section: 'analytics', anchor: 'section-statements' });
  assert.deepEqual(deepLinkFor(panel.groups[0].links[5].target), { section: 'analytics', anchor: 'section-booking-calendar' });
  assert.match(readFileSync('mobile/src/LiveClientReports.tsx', 'utf8'), /<Anchor id=\{sectionAnchor\("Booking calendar"\)\}><View style=\{\[card, \{ gap: 14 \}\]\}>\s*\{all && heading\("Booking calendar"/);
  // Their repairs, requests and furnishing stay one section down, then Start something.
  assert.deepEqual(panel.groups.map(g => g.key), ['your-properties', 'requests', 'start']);
  assert.deepEqual(panel.groups[1].links.map(l => l.key), ['area:repairs', 'area:all', 'tool:furnishing', 'page:help']);
  assert.ok(!links(panel).some(l => l.key === 'page:calendar' || l.key.startsWith('tool:calendar-')), 'owners have no team Calendar page');
});

// Business Plan v2's sections (30 October 2026).
test('Plan v2: My Recharge has Inbox, Earnings and Performance; Databases, Approvals and Tasks open the right places', () => {
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) {
    const mine = rolePanel(role, DEFAULT_ROLE_MODULES[role]).groups[0].links.map(l => l.label);
    assert.ok(mine.indexOf('Inbox') < mine.indexOf('Earnings') && mine.indexOf('Earnings') < mine.indexOf('My Performance'), role + ': ' + mine);
  }
  // A cleaner's earnings are My month; the rest of the team's are the Earnings part of My performance.
  assert.equal(linkOf('cleans', 'tool:month').label, 'Earnings');
  assert.deepEqual(deepLinkFor(linkOf('stays', 'tool:earnings').target), { section: 'analytics', anchor: 'section-earnings' });
  assert.ok(!has('admin', 'tool:earnings') && !has('cleans', 'tool:earnings'));
  // Databases: people records in the Management centre, applicants and contract templates in Recruitment.
  for (const [key, sub] of [['tool:clients-db', 'clients'], ['tool:contractors', 'contractors'], ['tool:staff', 'staff']]) {
    assert.deepEqual(deepLinkFor(linkOf('admin', key).target), { section: 'work', view: 'management', sub }, key);
    assert.ok(!has('stays', key), 'the people records are management\'s: ' + key);
  }
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:applicants').target), { section: 'recruitment', anchor: 'recruitment-applicants' });
  assert.deepEqual(deepLinkFor(linkOf('ready', 'tool:contract-templates').target), { section: 'recruitment', anchor: 'recruitment-templates' });
  assert.ok(!has('cleans', 'tool:applicants'), 'housekeepers have no Recruitment page');
  // Approvals by who decides.
  assert.deepEqual(deepLinkFor(linkOf('admin', 'tool:approvals-ppm').target), { section: 'work', view: 'clients', sub: 'enquiries', anchor: 'section-ppm-approvals' });
  assert.deepEqual(deepLinkFor(linkOf('cleaning_manager', 'tool:approvals-pom').target), { section: 'work', view: 'cleans', anchor: 'section-waiting-for-your-review' });
  assert.deepEqual(deepLinkFor(linkOf('accounts', 'tool:approvals-accounts').target), { section: 'work', view: 'accounts', sub: 'expenses' });
  assert.ok(!has('accounts', 'tool:approvals-ppm') && !has('stays', 'tool:approvals-accounts'));
  // Tasks list places that keep their department section too, each under a key of the Tasks section's own.
  assert.equal(sectionOf('admin', 'tool:licensing'), 'Safety & Compliance');
  assert.equal(sectionOf('admin', 'tasks:tool:licensing'), 'Tasks');
  assert.equal(sectionOf('admin', 'tool:receivable'), 'Finance');
  assert.equal(sectionOf('admin', 'receivable:tool:receivable'), 'Receivable Invoices');
  assert.deepEqual(linkOf('admin', 'tasks:tool:licensing').target, linkOf('admin', 'tool:licensing').target);
  assert.equal(linkOf('ready', 'tasks:tool:pipeline').label, 'Property Maintenance');
  assert.equal(linkOf('cleaning_manager', 'tasks:tool:setups').label, 'Property Set-Up');
  for (const part of ['broadband', 'photography', 'social', 'guidebook'])
    assert.deepEqual(deepLinkFor(linkOf('stays', 'tool:task-' + part).target), { section: 'work', view: 'all', sub: 'task-' + part }, part);
  // Every key stays within what a saved menu order may hold.
  for (const role of roles) for (const l of links(rolePanel(role, MODULE_IDS))) assert.match(l.key, /^[a-z0-9:_=-]{1,80}$/, role + ' ' + l.key);
});
