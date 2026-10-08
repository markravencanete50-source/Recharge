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
    assert.equal(tools.length, modules.length, role + ': every tool is listed');
    for (const t of tools) {
      if (t.place.kind === 'work') assert.ok(workViewsFor(role).includes(t.place.view), `${role} can open ${t.place.view} for ${t.id}`);
      assert.ok(t.place.where.length > 3, t.id);
    }
  }
});

test('team roles all have All work, and admins can open the Stays screens', () => {
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'admin']) assert.ok(workViewsFor(role).includes('all'), role);
  assert.ok(workViewsFor('admin').includes('stays'));
  assert.deepEqual(toolsFor('client', ['client-furnishing']).map(t => t.place.kind), ['link']);
  assert.deepEqual(toolsFor('stays', ['aircover-reporting']).map(t => t.place.kind), ['tracker']);
});
