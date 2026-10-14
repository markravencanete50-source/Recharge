import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Menu order per role (Access control → Menu order): the merge only reorders, never adds or removes; unknown
// keys are ignored; tools added later fall in at their default place; the desktop panel, the phone bar and the
// phone menu agree; the editor's preview is what the role gets.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const ml = await vite.ssrLoadModule('/lib/menu-layout.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const { phoneBarFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { MENU_ROLES, applyMenuLayout, layoutOfPanel, moveSection, moveItem, moveItemTo, orderPhoneBar, orderWorkViews, phoneMoreGroups, parseMenuLayout, barLinkKey } = ml;
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');

const panelOf = (role, layout, modules = DEFAULT_ROLE_MODULES[role], keepEmpty = false) => rolePanel(role, modules ?? DEFAULT_ROLE_MODULES[role], layout, keepEmpty);
const linkKeys = panel => panel.groups.flatMap(g => g.links.map(l => l.key));
const sectionKeys = panel => panel.groups.map(g => g.key);
const reversed = panel => ({ sections: [...sectionKeys(panel)].reverse(), items: Object.fromEntries(panel.groups.map(g => [g.key, g.links.map(l => l.key).reverse()])) });
const bar = role => phoneBarFor(role).slice(0, 5);

test('every role has stable, unique section keys', () => {
  for (const role of MENU_ROLES) {
    const keys = sectionKeys(panelOf(role));
    assert.ok(keys.length >= 2, role);
    assert.equal(new Set(keys).size, keys.length, role + ': unique');
    for (const k of keys) assert.match(k, /^[a-z0-9-]+$/, role);
  }
  assert.deepEqual(sectionKeys(panelOf('admin')), ['overview', 'departments', 'calendar-messages', 'management', 'more', 'start']);
});

test('the merge only arranges: never a tool the role lacks, never one lost, each link once', () => {
  // Every link any role could have, plus made-up ones, listed under several sections.
  const everything = [...new Set(MENU_ROLES.flatMap(r => linkKeys(panelOf(r))))];
  const greedy = { sections: ['made-up', ...MENU_ROLES.flatMap(r => sectionKeys(panelOf(r)))].reverse(), items: Object.fromEntries(['more', 'overview', 'today', 'work', 'made-up'].map(k => [k, [...everything, 'tool:made-up'].reverse()])) };
  for (const role of MENU_ROLES) {
    const plain = panelOf(role), merged = panelOf(role, greedy);
    assert.deepEqual([...linkKeys(merged)].sort(), [...linkKeys(plain)].sort(), role + ': the same links, each once');
    for (const k of sectionKeys(merged)) assert.ok(sectionKeys(plain).includes(k), role + ': no made-up section');
  }
  // A cleaner never gets a management link, whatever the layout lists.
  assert.ok(!linkKeys(panelOf('cleans', greedy)).includes('tool:access'));
});

test('a link moved to another section is there on desktop and on the phone', () => {
  // Messages moved from "Calendar & messages" to the top of "Overview", for admins.
  const moved = panelOf('admin', { sections: [], items: { overview: ['page:inbox', 'page:home', 'page:todo'] } });
  // Favorites (locked to Overview, round 6) is not listed, so it follows the listed ones.
  assert.deepEqual(moved.groups.find(g => g.key === 'overview').links.map(l => l.key), ['page:inbox', 'page:home', 'page:todo', 'page:favorites']);
  assert.ok(!moved.groups.find(g => g.key === 'calendar-messages').links.some(l => l.key === 'page:inbox'));
  const phone = orderPhoneBar(bar('admin'), moved);
  assert.equal(phone[0].value, 'inbox', 'first on the phone bar too');
  // A link the bar does not show, moved: the phone menu lists it under its new section.
  const reports = panelOf('admin', { sections: [], items: { overview: ['page:home', 'page:todo', 'page:analytics'] } });
  const more = phoneMoreGroups(reports, orderPhoneBar(bar('admin'), reports));
  assert.ok(more.find(g => g.key === 'overview').links.some(l => l.key === 'page:analytics'));
  assert.ok(!more.find(g => g.key === 'more').links.some(l => l.key === 'page:analytics'));
  // The editor's "Move to section" puts it at the end of the chosen section, and saving keeps it there.
  const draft = moveItemTo(panelOf('admin', null, undefined, true), 'page:analytics', 'overview');
  assert.deepEqual(draft.groups.find(g => g.key === 'overview').links.map(l => l.key).slice(-1), ['page:analytics']);
  assert.deepEqual(panelOf('admin', layoutOfPanel(draft)), draft);
  assert.deepEqual(moveItemTo(draft, 'page:analytics', 'nope'), draft, 'an unknown section changes nothing');
});

test('a link listed under two sections stays in the first', () => {
  const twice = panelOf('stays', { sections: ['more', 'today'], items: { more: ['page:todo'], today: ['page:todo', 'page:home'] } });
  assert.ok(twice.groups.find(g => g.key === 'more').links.some(l => l.key === 'page:todo'), 'more comes first in the saved order');
  assert.ok(!twice.groups.find(g => g.key === 'today').links.some(l => l.key === 'page:todo'));
  assert.equal(linkKeys(twice).filter(k => k === 'page:todo').length, 1);
  // Sections not in the saved order count after those that are.
  const later = panelOf('stays', { sections: ['today'], items: { more: ['page:home'], today: ['page:home'] } });
  assert.deepEqual(later.groups.find(g => g.key === 'today').links.map(l => l.key)[0], 'page:home');
});

test('a section emptied by moves is hidden in the app and kept in the editor', () => {
  // (Today keeps Favorites, which is locked there since round 6, so Calendar & messages is emptied here.)
  const layout = { sections: [], items: { more: ['page:calendar', 'page:inbox'] } };
  const app = panelOf('stays', layout), editor = panelOf('stays', layout, undefined, true);
  assert.ok(!sectionKeys(app).includes('calendar-messages'), 'hidden');
  assert.deepEqual(editor.groups.find(g => g.key === 'calendar-messages').links, [], 'kept, empty, in the editor');
  assert.ok(!phoneMoreGroups(app, orderPhoneBar(bar('stays'), app)).some(g => g.key === 'calendar-messages'));
  // Saving the editor's draft and reading it back gives the same arrangement.
  assert.deepEqual(panelOf('stays', layoutOfPanel(editor), undefined, true), editor);
});

test('a moved link the role later loses disappears; a new tool appears in its default section', () => {
  // Saved when Guest relations staff held direct bookings, with it moved to Today.
  const saved = layoutOfPanel(moveItemTo(panelOf('stays', null, undefined, true), 'tool:bookings', 'today'));
  assert.ok(panelOf('stays', saved).groups.find(g => g.key === 'today').links.some(l => l.key === 'tool:bookings'));
  const without = DEFAULT_ROLE_MODULES.stays.filter(m => m !== 'direct-bookings');
  assert.ok(!linkKeys(panelOf('stays', saved, without)).includes('tool:bookings'), 'gone with the tool');
  // Saved without AirCover; when the tool arrives it sits in its default section.
  const before = layoutOfPanel(panelOf('stays', null, DEFAULT_ROLE_MODULES.stays.filter(m => m !== 'aircover-reporting'), true));
  const now = panelOf('stays', before);
  const home = panelOf('stays').groups.find(g => g.links.some(l => l.key === 'tool:aircover')).key;
  assert.ok(now.groups.find(g => g.key === home).links.some(l => l.key === 'tool:aircover'));
});

test('a saved order is applied to sections and to the links inside each section', () => {
  for (const role of MENU_ROLES) {
    const plain = panelOf(role), layout = reversed(plain), merged = panelOf(role, layout);
    assert.deepEqual(sectionKeys(merged), layout.sections, role);
    for (const g of merged.groups) assert.deepEqual(g.links.map(l => l.key), layout.items[g.key], role + ' ' + g.key);
  }
});

test('unknown and duplicate keys are ignored; an empty layout is the default order', () => {
  const plain = panelOf('stays');
  const merged = panelOf('stays', { sections: ['nope', 'more', 'more', 'today'], items: { today: ['page:todo', 'page:todo', 'page:nope'], ghost: ['page:home'] } });
  assert.deepEqual(sectionKeys(merged).slice(0, 2), ['more', 'today']);
  assert.deepEqual(sectionKeys(merged).slice(2), sectionKeys(plain).filter(k => k !== 'more' && k !== 'today'), 'the rest in default order');
  assert.deepEqual(merged.groups.find(g => g.key === 'today').links.map(l => l.key), ['page:todo', 'page:home', 'page:favorites']);
  assert.deepEqual(panelOf('stays', { sections: [], items: {} }), plain);
  assert.deepEqual(panelOf('stays', null), plain);
});

test('tools added later fall in at their default place, after the ordered ones', () => {
  // Saved when Guest relations staff had no direct-bookings or AirCover tool.
  const fewer = DEFAULT_ROLE_MODULES.stays.filter(m => m !== 'direct-bookings' && m !== 'aircover-reporting');
  const saved = reversed(panelOf('stays', null, fewer));
  const now = panelOf('stays', saved);
  const listings = now.groups.find(g => g.key === 'guests-listings').links.map(l => l.key);
  const known = saved.items['guests-listings'];
  assert.deepEqual(listings.slice(0, known.length), known, 'the saved ones first, in the saved order');
  assert.deepEqual(listings.slice(known.length), panelOf('stays').groups.find(g => g.key === 'guests-listings').links.map(l => l.key).filter(k => !known.includes(k)), 'the new ones after, in default order');
  assert.ok(listings.includes('tool:bookings') && listings.includes('tool:aircover'));
});

test('desktop and phone follow the same order', () => {
  for (const role of MENU_ROLES) {
    for (const layout of [null, reversed(panelOf(role))]) {
      const panel = panelOf(role, layout), order = linkKeys(panel);
      const phone = orderPhoneBar(bar(role), panel);
      assert.deepEqual([...phone].map(b => b.value).sort(), bar(role).map(b => b.value).sort(), role + ': the same bar destinations');
      const positions = phone.map(b => order.indexOf(barLinkKey(b.value, panel))).filter(i => i >= 0);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), role + ': bar in panel order');
      // The phone menu lists every other link, in the panel's order, and nothing the bar shows, except Management
      // centre, which stays with the other departments when the bar's Work button opens it.
      const more = phoneMoreGroups(panel, phone);
      const onBar = new Set(phone.map(b => barLinkKey(b.value, panel)).filter(k => k !== 'area:management'));
      assert.deepEqual(more.flatMap(g => g.links.map(l => l.key)), order.filter(k => !onBar.has(k)), role);
      assert.deepEqual(more.map(g => g.key), sectionKeys(panel).filter(k => more.some(g => g.key === k)), role);
    }
  }
  // Moving Messages above Home moves it first on the phone bar too.
  const admin = panelOf('admin');
  const messagesFirst = panelOf('admin', { sections: ['calendar-messages', 'overview'], items: { 'calendar-messages': ['page:inbox'] } });
  assert.equal(orderPhoneBar(bar('admin'), messagesFirst)[0].value, 'inbox');
  assert.equal(orderPhoneBar(bar('admin'), admin)[0].value, 'home');
  // The phone's Work tabs follow the order of the areas in the panel, keeping every area.
  const views = workViewsFor('admin');
  const areasLast = panelOf('admin', { sections: [], items: { departments: ['area:all', 'area:accounts'] } });
  const tabs = orderWorkViews(views, areasLast);
  assert.deepEqual(tabs.slice(0, 2), ['all', 'accounts']);
  assert.deepEqual([...tabs].sort(), [...views].sort());
  assert.deepEqual(orderWorkViews(views, admin).filter(v => v !== 'calendar'), linkKeys(admin).filter(k => k.startsWith('area:')).map(k => k.slice(5)).filter(v => views.includes(v)));
});

test('the editor moves one step at a time, and its preview is exactly what the role gets', () => {
  let draft = panelOf('accounts');
  draft = moveSection(draft, 'money', -1);
  draft = moveItem(draft, 'overview', 'page:todo', -1);
  assert.equal(sectionKeys(draft).indexOf('money'), sectionKeys(panelOf('accounts')).indexOf('money') - 1);
  assert.deepEqual(draft.groups.find(g => g.key === 'overview').links.map(l => l.key), ['page:home', 'page:todo', 'page:favorites']);
  assert.deepEqual(moveSection(draft, sectionKeys(draft)[0], -1), draft, 'the first cannot go higher');
  assert.deepEqual(moveItem(draft, 'overview', 'page:favorites', 1), draft, 'the last cannot go lower');
  assert.deepEqual(moveSection(draft, 'nope', 1), draft);
  // What is saved, applied by the app to the role, gives back the draft.
  const saved = layoutOfPanel(draft);
  assert.deepEqual(panelOf('accounts', saved), draft);
  assert.deepEqual(applyMenuLayout(panelOf('accounts'), saved), draft);
});

test('layouts are checked: stable keys only, size-limited, and the requests match', () => {
  assert.equal(parseMenuLayout({ sections: ['Overview'], items: {} }), null, 'labels are not keys');
  assert.equal(parseMenuLayout('nope'), null);
  assert.deepEqual(parseMenuLayout({ sections: ['more'], items: { more: ['tool:cleaner-invoices'] } }), { sections: ['more'], items: { more: ['tool:cleaner-invoices'] } });
  assert.deepEqual(parseMenuLayout({ role: 'stays', sections: [], items: {}, version: 0 }), { sections: [], items: {} }, 'a read parses');
  const id = crypto.randomUUID();
  assert.ok(teamsActionSchema.safeParse({ action: 'saveMenuLayout', requestId: id, role: 'stays', version: 0, sections: ['more'], items: { more: ['page:home'] } }).success);
  assert.ok(teamsActionSchema.safeParse({ action: 'resetMenuLayout', requestId: id, role: 'client', version: 3 }).success);
  assert.ok(!teamsActionSchema.safeParse({ action: 'saveMenuLayout', requestId: id, role: 'nobody', version: 0, sections: [], items: {} }).success);
  assert.ok(!teamsActionSchema.safeParse({ action: 'saveMenuLayout', requestId: id, role: 'stays', version: 0, sections: ['Bad Key'], items: {} }).success);
  for (const section of ['menuLayout', 'menuLayouts']) assert.ok(teamsReadSchema.safeParse({ section }).success);
});

test('the screens are wired: the workspace uses the merged menu, Access control has the Menu order tab', () => {
  const workspace = readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8');
  assert.match(workspace, /rolePanel\(account\.role, account\.modules, menuLayout\)/);
  assert.match(workspace, /orderPhoneBar\(liveNavigationFor\(account\.role\), panel\)/);
  assert.match(workspace, /section: "menuLayout"/);
  assert.match(workspace, /phoneMoreGroups\(panel, nav\)/);
  const access = readFileSync('mobile/src/LiveAccessControl.tsx', 'utf8');
  assert.match(access, /"Menu order"/);
  assert.match(access, /<MenuOrderEditor palette=\{p\} \/>/);
  const editor = readFileSync('mobile/src/MenuOrderEditor.tsx', 'utf8');
  for (const words of ['Save and publish', 'Reset this role to default', 'Last changed by', 'Move section', 'Move to…', 'to another section']) assert.ok(editor.includes(words), words);
  assert.match(editor, /rolePanel\(role, DEFAULT_ROLE_MODULES\[role\], layoutOfPanel\(draft\)\)/, 'the preview uses the same merge');
  for (const file of ['lib/menu-layout.ts', 'mobile/src/MenuOrderEditor.tsx', 'mobile/src/MenuLayoutStore.ts', 'supabase/migrations/20261015210000_menu_layouts.sql'])
    assert.ok(!readFileSync(file, 'utf8').includes(String.fromCharCode(0x2014)), file + ' has an em dash');
  assert.doesNotMatch(editor, /gradient/i);
});

test('the phone menu lists Management centre for the roles that have it on desktop, in the sidebar\'s order', () => {
  for (const role of MENU_ROLES) {
    const panel = panelOf(role), desktop = linkKeys(panel);
    const menu = phoneMoreGroups(panel, orderPhoneBar(bar(role), panel)).flatMap(g => g.links.map(l => l.key));
    assert.equal(menu.includes('area:management'), desktop.includes('area:management'), role);
    // Other roles' menus are unchanged: their first Work area is still the bar's Work button only.
    if (!desktop.includes('area:management') && bar(role).some(b => b.value === 'work')) assert.ok(!menu.includes(barLinkKey('work', panel)), role);
  }
  for (const role of ['super_admin', 'admin']) {
    const panel = panelOf(role);
    const departments = phoneMoreGroups(panel, orderPhoneBar(bar(role), panel)).find(g => g.key === 'departments').links;
    assert.equal(departments[0].key, 'area:management', role + ': first, as on desktop');
    assert.equal(departments[0].label, 'Management centre', role);
  }
});
