import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The desktop left panel: each role has its own, built from what that role can open, and View as
// shows the viewed role's panel with nothing from the super admin's.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { homeToolsFor, homeActionsFor, startActionsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { previewAccount, previewKeeps } = await vite.ssrLoadModule('/lib/view-as.ts');
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
  // Admin and super admin share the management layout; super admin adds Access control.
  assert.equal(sets.size, roles.length);
});

test('every Work area, Home tool and quick start of a role is in its panel, and only those', () => {
  for (const role of roles) {
    const modules = DEFAULT_ROLE_MODULES[role], panel = rolePanel(role, modules), all = links(panel);
    // Work → Calendar is the Calendar page, so it is a page link rather than a second area link.
    for (const view of workViewsFor(role)) assert.ok(all.some(l => view === 'calendar' ? l.key === 'page:calendar' : l.kind === 'area' && l.view === view), `${role} has ${view}`);
    for (const l of all) if (l.kind === 'area') assert.ok(workViewsFor(role).includes(l.view), `${role} can open ${l.view}`);
    // Accounts' Owner statements tool is their Owner statements page.
    for (const t of homeToolsFor(role, modules)) if (!(role === 'accounts' && t.key === 'statements')) assert.ok(all.some(l => l.key === 'tool:' + t.key || (l.kind === 'area' && t.target.kind === 'work' && l.view === t.target.view) || (l.kind === 'page' && t.target.kind === 'tab' && l.section === t.target.tab)), `${role} has ${t.key}`);
    for (const a of startActionsFor(role, modules)) assert.ok(all.some(l => l.key === 'start:' + a.key), `${role} can start ${a.key}`);
    assert.deepEqual(homeActionsFor(role, modules).map(a => a.key), role === 'client' ? startActionsFor(role, modules).map(a => a.key) : [], role + ': Home has no quick-action pills for the team');
  }
});

test('team-only, owner-only and admin-only places stay with their roles', () => {
  const has = (role, key, modules = DEFAULT_ROLE_MODULES[role]) => links(rolePanel(role, modules)).some(l => l.key === key);
  assert.ok(has('super_admin', 'tool:access'));
  for (const role of roles.filter(r => r !== 'super_admin')) assert.ok(!has(role, 'tool:access'), role + ' has no Access control');
  for (const role of roles.filter(r => !['admin', 'super_admin'].includes(r))) assert.ok(!has(role, 'area:management'), role + ' has no Management');
  assert.ok(has('client', 'page:approvals') && !has('client', 'page:favorites'));
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

test('the team panel runs Home, To-do, the Work areas, Calendar, Messages, then the rest', () => {
  for (const role of roles.filter(r => r !== 'client')) {
    const all = links(rolePanel(role, DEFAULT_ROLE_MODULES[role])), at = key => all.findIndex(l => l.key === key);
    assert.deepEqual(all.slice(0, 2).map(l => l.key), ['page:home', 'page:todo'], role);
    const firstArea = all.findIndex(l => l.kind === 'area'), lastArea = all.map(l => l.kind).lastIndexOf('area');
    assert.ok(firstArea === 2 && at('page:calendar') > lastArea && at('page:inbox') === at('page:calendar') + 1, role + ': areas, then Calendar, then Messages');
    assert.ok(all.slice(2, at('page:calendar')).every(l => l.kind === 'area'), role + ': only Work areas between To-do and Calendar');
  }
  const admin = links(rolePanel('admin', MODULE_IDS));
  assert.equal(admin.find(l => l.key === 'page:decisions').label, 'Management approvals');
  assert.equal(links(rolePanel('stays', DEFAULT_ROLE_MODULES.stays)).find(l => l.key === 'page:decisions').label, 'My requests');
  assert.equal(links(rolePanel('ready', DEFAULT_ROLE_MODULES.ready)).find(l => l.key === 'page:analytics').label, 'My performance');
  assert.equal(admin.find(l => l.key === 'page:analytics').label, 'Reports');
});
