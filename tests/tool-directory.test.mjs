import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Every tool a person holds opens somewhere real in the live app, for every role.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { toolsFor, workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const { MODULE_IDS, defaultModulesForRole } = await vite.ssrLoadModule('/lib/modules.ts');
after(() => vite.close());
const ROLES = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'];

test('every default tool of every role has a place the role can open', () => {
  for (const role of ROLES) {
    const modules = role.endsWith('admin') ? [...MODULE_IDS] : defaultModulesForRole(role);
    const tools = toolsFor(role, modules);
    // Accounts have no Properties tab, so the property database is not listed for them.
    const listed = role === 'accounts' ? modules.filter(m => m !== 'property-database') : modules;
    assert.equal(tools.length, listed.length, role + ': every tool is listed');
    for (const t of tools) {
      if (t.place.kind === 'work') assert.ok(workViewsFor(role).includes(t.place.view), `${role} can open ${t.place.view} for ${t.id}`);
      assert.ok(t.place.where.length > 3, t.id);
    }
  }
});

test('team roles all have All work, and admins can open the Guest relations and Client relations screens', () => {
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'admin']) assert.ok(workViewsFor(role).includes('all'), role);
  assert.ok(workViewsFor('admin').includes('stays') && workViewsFor('admin').includes('clients'));
  assert.deepEqual(toolsFor('client', ['client-furnishing']).map(t => t.place.kind), ['calculator'], 'the calculator runs inside the app');
  assert.deepEqual(toolsFor('stays', ['aircover-reporting']).map(t => [t.place.kind, t.place.view, t.place.sub]), [['work', 'stays', 'aircover']], 'AirCover is its own Guest relations section');
  assert.deepEqual(toolsFor('accounts', ['aircover-reporting']).map(t => t.place.kind), ['tracker'], 'a role without Guest relations keeps the simple tracker');
});

test('Accounts are not sent to a Properties tab they cannot open', () => {
  const tools = toolsFor('accounts', ['property-database', 'ota-logins', 'owner-statements']);
  assert.deepEqual(tools.map(t => t.id), ['owner-statements']);
  assert.ok(toolsFor('stays', ['property-database']).some(t => t.place.kind === 'tab' && t.place.tab === 'properties'));
});
