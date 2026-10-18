import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

// Home's "Your tools": every role gets tools it can open, each lands somewhere that exists,
// and every tool and module has an illustrated icon.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { homeToolsFor, sectionAnchor, MODULE_ART } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { hashedWorkspaceFile } = await vite.ssrLoadModule('/worker/backend-route-policy.ts');
after(() => vite.close());

const sources = readdirSync('mobile/src').filter(f => f.endsWith('.tsx')).map(f => readFileSync('mobile/src/' + f, 'utf8')).join('\n');
const anchors = new Set([
  ...[...sources.matchAll(/<Section title="([^"]+)"/g)].map(m => sectionAnchor(m[1])),
  ...[...sources.matchAll(/(?:nativeID|<Anchor id)="([^"]+)"/g)].map(m => m[1]),
]);
const icon = readFileSync('mobile/src/DimensionalIcon.tsx', 'utf8');
const drawn = new Set([...icon.matchAll(/case "([a-z]+)":/g)].map(m => m[1]));

test('every role has tools on Home, each opening a place that role can reach', () => {
  for (const [role, modules] of Object.entries(DEFAULT_ROLE_MODULES)) {
    const tools = homeToolsFor(role, modules);
    assert.ok(tools.length >= 4, role);
    // Home shows the person's favourites; this list feeds the panel, search and the fallback tiles.
    assert.ok(tools.length <= 10, role + ' keeps the tool list short');
    assert.equal(new Set(tools.map(t => t.key)).size, tools.length, role + ' has no duplicate tools');
    for (const t of tools) {
      assert.ok(t.label.length <= 22, `${role}: "${t.label}" fits a tile`);
      assert.ok(drawn.has(t.art), `${role}: ${t.art} is drawn`);
      if (t.target.kind === 'work') assert.ok(workViewsFor(role).includes(t.target.view), `${role} can open ${t.target.view}`);
      if (t.target.anchor) assert.ok(anchors.has(t.target.anchor), `${role}: ${t.target.anchor} exists in the app`);
      if (t.target.kind === 'tracker') assert.ok(modules.includes(t.target.module), `${role} holds ${t.target.module}`);
    }
  }
});

test('tools that need a module only show to people who hold it', () => {
  assert.ok(!homeToolsFor('stays', []).some(t => t.key === 'aircover'));
  assert.ok(homeToolsFor('stays', ['aircover-reporting']).some(t => t.key === 'aircover'));
  // Every owner has the Mailbox page: what Recharge sent them; the post is shown only with the mailbox service.
  assert.ok(homeToolsFor('client', ['client-dashboard']).some(t => t.key === 'mailbox'));
  assert.deepEqual(homeToolsFor('unknown-role', MODULE_IDS), []);
  // Management and Accounts tools open a named tab inside the view.
  assert.deepEqual(homeToolsFor('admin', MODULE_IDS).find(t => t.key === 'people').target, { kind: 'work', view: 'management', sub: 'people' });
  assert.deepEqual(homeToolsFor('accounts', DEFAULT_ROLE_MODULES.accounts).find(t => t.key === 'payouts').target, { kind: 'work', view: 'accounts', sub: 'payouts' });
  // Accounts' invoices open inside their own Work view (their bar has no Reports tab), and
  // Guest relations' pricing opens Client relations → Pricing.
  assert.deepEqual(homeToolsFor('accounts', DEFAULT_ROLE_MODULES.accounts).find(t => t.key === 'invoices').target, { kind: 'work', view: 'accounts', anchor: 'section-invoices' });
  assert.deepEqual(homeToolsFor('stays', DEFAULT_ROLE_MODULES.stays).find(t => t.key === 'pricing').target, { kind: 'work', view: 'clients', sub: 'pricing' });
});

test('every team role can open training from Home; admins land where courses are added', () => {
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'])
    assert.deepEqual(homeToolsFor(role, DEFAULT_ROLE_MODULES[role]).find(t => t.key === 'training')?.target, { kind: 'tab', tab: 'help', anchor: 'section-training' }, role);
  for (const role of ['admin', 'super_admin'])
    assert.deepEqual(homeToolsFor(role, MODULE_IDS).find(t => t.key === 'training')?.target, { kind: 'work', view: 'management', sub: 'training' }, role);
  assert.ok(!homeToolsFor('client', DEFAULT_ROLE_MODULES.client).some(t => t.key === 'training'), 'owners have Help instead');
});

test('every tool in the full list has an illustrated icon', () => {
  for (const id of MODULE_IDS) assert.ok(drawn.has(MODULE_ART[id]), id);
  assert.equal(sectionAnchor("Today's sign-off & more"), 'section-today-s-sign-off-and-more');
});

test('the app files the phone keeps for good are only the content-hashed ones', () => {
  for (const path of ['/workspace/_expo/static/js/web/entry-bff2fceacf322b46b9c208cccd914d47.js', '/workspace/assets/assets/fonts/Montserrat_700Bold.2973a37ffb89bb30351e8e840b1b4ce1.ttf', '/workspace/assets/assets/brand/recharge-logo-dark.e66ac92218980b7d0529a8a3d29ee2ad.png'])
    assert.equal(hashedWorkspaceFile(path), true, path);
  for (const path of ['/workspace/', '/workspace/live', '/workspace/index.html', '/workspace/favicon.ico', '/workspace/metadata.json', '/assets/entry-bff2fceacf322b46b9c208cccd914d47.js'])
    assert.equal(hashedWorkspaceFile(path), false, path);
});
