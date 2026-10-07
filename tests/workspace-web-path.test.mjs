import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The browser build of the app must call a web route that exists for every route the app uses.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false } });
const { webWorkspacePath } = await vite.ssrLoadModule('/lib/workspace-web-path.ts');
after(() => vite.close());

test('every /api/mobile route the app calls maps to an existing /api/workspace route', () => {
  assert.equal(webWorkspacePath('/api/mobile/workspace?entity=properties&limit=100'), '/api/workspace?entity=properties&limit=100');
  assert.equal(webWorkspacePath('/api/mobile/workspace'), '/api/workspace');
  assert.equal(webWorkspacePath('/api/mobile/reports/export?from=2026-10-01'), '/api/workspace/reports/export?from=2026-10-01');
  assert.equal(webWorkspacePath('/api/mobile/teams?section=management'), '/api/workspace/teams?section=management');
  const dir = new URL('../mobile/src/', import.meta.url);
  const client = fs.readdirSync(dir, { recursive: true }).filter(f => /\.tsx?$/.test(f)).map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const used = new Set([...client.matchAll(/['"`]\/api\/mobile\/([a-z-]+(?:\/[a-z-]+)?)/g)].map(m => '/api/mobile/' + m[1]));
  for (const path of used) {
    if (['/api/mobile/session', '/api/mobile/recovery', '/api/mobile/devices'].includes(path)) continue; // native-only
    const web = webWorkspacePath(path);
    const route = new URL(`..${'/app' + web}/route.ts`, import.meta.url);
    assert.ok(fs.existsSync(route), `${path} -> ${web} has no web route`);
  }
});
