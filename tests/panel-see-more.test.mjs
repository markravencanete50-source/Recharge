import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The desktop left panel (Lee, 15 October 2026): no Messages link (the Messages button is at the top of
// every page), and each section shows its first three links with "See more" for the rest.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { rolePanel, desktopPanel, shownLinks, PANEL_SHOWN } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
after(() => vite.close());

const roles = Object.keys(DEFAULT_ROLE_MODULES);

test('the desktop panel drops Messages for every role, and the phone menu keeps it', () => {
  for (const role of roles) {
    const full = rolePanel(role, DEFAULT_ROLE_MODULES[role]);
    const desk = desktopPanel(full);
    assert.ok(!desk.groups.some(g => g.links.some(l => l.key === 'page:inbox')), role + ': no Messages on desktop');
    assert.ok(desk.groups.every(g => g.links.length), role + ': no empty section left behind');
    assert.ok(full.groups.some(g => g.links.some(l => l.key === 'page:inbox')), role + ': the full panel (phone menu) still has Messages');
  }
});

test('the Messages button is in the top bar on desktop, for everyone', () => {
  const src = readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8');
  assert.match(src, /icon="message-circle" palette=\{header\} onPress=\{\(\) => \{ setChatTarget\(null\); navigate\("inbox"\); \}\}/);
});

test('each section shows three links and the rest behind See more', () => {
  const links = ['a', 'b', 'c', 'd', 'e'].map(k => ({ key: k }));
  assert.equal(PANEL_SHOWN, 3);
  assert.deepEqual(shownLinks(links, 'x', false), { links: links.slice(0, 3), hidden: 2, forced: false });
  assert.deepEqual(shownLinks(links, 'x', true).links, links);
  // The page open now is never hidden: its section opens by itself.
  const deep = shownLinks(links, 'e', false);
  assert.equal(deep.links.length, 5); assert.ok(deep.forced);
  // Three or fewer: no toggle.
  assert.deepEqual(shownLinks(links.slice(0, 3), 'x', false), { links: links.slice(0, 3), hidden: 0, forced: false });
});

test('the admin panel: Departments, Calendar and the other long sections fold', () => {
  const desk = desktopPanel(rolePanel('admin', DEFAULT_ROLE_MODULES.admin));
  const dept = desk.groups.find(g => g.key === 'departments');
  assert.ok(dept.links.length > PANEL_SHOWN && shownLinks(dept.links, 'page:home', false).hidden > 0);
  const cal = desk.groups.find(g => g.key === 'calendar-messages');
  assert.equal(cal.links[0].key, 'page:calendar');
});

test('the panel renders the folded list with a labelled toggle', () => {
  const src = readFileSync('mobile/src/RoleNavigation.tsx', 'utf8');
  assert.match(src, /desktopPanel\(panel\)\.groups\.map/);
  assert.match(src, /list\.links\.map/);
  assert.match(src, /See more \(\$\{list\.hidden\}\)/);
  assert.match(src, /accessibilityState=\{\{expanded:open\}\}/);
});
