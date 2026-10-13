// Builds the interactive demo's files: the backend that runs in the viewer's browser (browser/engine.mjs,
// bundled with the repo's own routes, schemas and lib code), PGlite's WebAssembly Postgres, a snapshot
// of the database with every migration and the sample business, and the sample photos.
//
//   node scripts/demo/build-browser-demo.mjs --out <dir>
//
// scripts/build-workspace-web.mjs runs it into dist/client/workspace/demo, so the app finds the files at
// /workspace/demo/. Only manifest.json keeps its name; every other file carries a content hash.
// Nothing here is loaded by the app until a super admin switches Demo on.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ROOT, DEVSTACK, DevDatabase, freshDatabase, loadDatabase, sourceHash } from './db.mjs';
import { BROWSER_VIRTUAL, STUBS } from './devstack-core.mjs';
import { STORAGE } from './media.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const OUT = path.resolve(option('--out', path.join(ROOT, 'dist/client/workspace/demo')));
const started = Date.now();
const log = (...parts) => console.log(`[demo build ${((Date.now() - started) / 1000).toFixed(1)}s]`, ...parts);
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 20);
const PGLITE = path.join(ROOT, 'node_modules/@electric-sql/pglite/dist');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const files = {};
async function emit(name, bytes) {
  const ext = path.extname(name), file = `${path.basename(name, ext)}.${hash(bytes)}${ext}`;
  await fs.writeFile(path.join(OUT, file), bytes);
  return file;
}

// ---------------------------------------------------------------------------------------------
// 1. The database: the cached devstack seed when it matches the migrations and the seed, otherwise a
//    fresh one. The browser moves its dates to today when it opens it, so the seed's day doesn't matter.
const CACHE = path.join(DEVSTACK, 'seed.tar.gz'), META = path.join(DEVSTACK, 'seed.meta.json');
const schema = await sourceHash();
let seedMeta = JSON.parse(await fs.readFile(META, 'utf8').catch(() => '{}'));
let db;
if (existsSync(CACHE) && seedMeta.hash === schema && existsSync(STORAGE)) {
  db = await loadDatabase(new Blob([await fs.readFile(CACHE)]));
  log(`using the cached seed from ${seedMeta.seededOn}`);
} else {
  log('seeding a fresh sample business (about 20 seconds)…');
  const { seed, TODAY } = await import('./seed.mjs');
  const dev = new DevDatabase(await freshDatabase());
  const summary = await seed(dev, { log: () => undefined });
  db = dev.db;
  await fs.writeFile(CACHE, Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer()));
  seedMeta = { hash: schema, seededOn: TODAY, seededAt: new Date().toISOString(), summary: summary?.line ?? '' };
  await fs.writeFile(META, JSON.stringify(seedMeta, null, 2));
  log(`seeded: ${seedMeta.summary}`);
}
// Smaller to download: no template databases (nothing creates a database), tables rewritten
// without dead rows, and only the write-ahead log the last checkpoint needs, its unused tail zeroed.
for (const sql of [`update pg_database set datistemplate = false where datname in ('template0', 'template1')`, 'drop database template1', 'drop database template0',
  'vacuum full', 'checkpoint', 'select pg_switch_wal()', 'checkpoint']) await db.query(sql);
const { redo_wal_file: walFile } = (await db.query('select redo_wal_file from pg_control_checkpoint()')).rows[0];
const { lsn } = (await db.query('select pg_current_wal_insert_lsn()::text lsn')).rows[0];
const walEnd = Math.ceil((parseInt(lsn.split('/')[1], 16) % (16 * 1024 * 1024)) / 8192) * 8192;
const tar = Buffer.from(await (await db.dumpDataDir('none')).arrayBuffer());
await db.close();
const kept = [];
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(b => b === 0)) break;
  const field = (from, to) => header.subarray(from, to).toString('latin1').replace(/\0.*$/s, '');
  const name = (field(345, 500) ? field(345, 500) + '/' : '') + field(0, 100);
  const size = parseInt(field(124, 136).trim() || '0', 8), blocks = Math.ceil(size / 512) * 512;
  const entry = Buffer.from(tar.subarray(offset, offset + 512 + blocks));
  offset += 512 + blocks;
  const wal = name.match(/pg_wal\/([0-9A-F]{24})$/);
  if (wal && wal[1] !== walFile) continue;
  if (wal) entry.fill(0, 512 + walEnd);
  kept.push(entry);
}
kept.push(Buffer.alloc(1024));
files.snapshot = await emit('database.tgz', gzipSync(Buffer.concat(kept), { level: 9 }));
log(`database snapshot ${files.snapshot}`);

// ---------------------------------------------------------------------------------------------
// 2. The sample photos: one file per picture (the seed links many paths to a small pool).
const storage = {};
const pooled = new Map();
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    const relative = path.relative(STORAGE, full).split(path.sep).join('/');
    if (relative.split('/')[1] === 'pool') continue;
    const real = await fs.realpath(full);
    if (!pooled.has(real)) pooled.set(real, await emit('photo' + path.extname(real), await fs.readFile(real)));
    storage[relative] = pooled.get(real);
  }
}
await walk(STORAGE);
log(`${Object.keys(storage).length} sample files (${pooled.size} pictures)`);

// ---------------------------------------------------------------------------------------------
// 3. PGlite's Postgres (WebAssembly) and its support files.
// Kept gzipped (the worker inflates them), so they download small whether or not the host compresses
// them: a host leaves application/octet-stream as it is.
const gzipped = async file => gzipSync(await fs.readFile(path.join(PGLITE, file)), { level: 9 });
files.wasm = await emit('pglite.wasm.gz', await gzipped('pglite.wasm'));
files.data = await emit('pglite.data.gz', await gzipped('pglite.data'));
files.initdb = await emit('initdb.wasm.gz', await gzipped('initdb.wasm'));

// ---------------------------------------------------------------------------------------------
// 4. The backend: browser/engine.mjs with every /api/workspace route, bundled for a Web Worker.
//    The same few server-only modules the devstack swaps are swapped here (devstack-core.mjs).
const routeFiles = [];
async function routes(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await routes(path.join(dir, entry.name));
    else if (entry.name === 'route.ts') routeFiles.push(path.join(dir, entry.name));
  }
}
await routes(path.join(ROOT, 'app/api/workspace'));
routeFiles.sort();
const routeModule = routeFiles.map((file, i) => `import * as r${i} from ${JSON.stringify(file)};`).join('\n')
  + `\nexport const ROUTES = {${routeFiles.map((file, i) => `${JSON.stringify(path.relative(path.join(ROOT, 'app/api/workspace'), path.dirname(file)).split(path.sep).join('/'))}: r${i}`).join(', ')}};`;
const { build } = await import('esbuild');
const stubbed = new Map(Object.entries(STUBS).map(([file, code]) => [path.join(ROOT, file), code]));
const result = await build({
  entryPoints: [path.join(DEVSTACK, 'browser/engine.mjs')],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false, legalComments: 'none',
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
  alias: { '@': ROOT },
  logLevel: 'warning',
  plugins: [{
    name: 'recharge-demo',
    setup(b) {
      b.onResolve({ filter: /^demo:routes$/ }, () => ({ path: 'routes', namespace: 'demo' }));
      b.onLoad({ filter: /.*/, namespace: 'demo' }, () => ({ contents: routeModule, resolveDir: ROOT, loader: 'js' }));
      b.onResolve({ filter: /^(cloudflare:workers|@supabase\/supabase-js|next\/server|next\/headers)$/ }, a => ({ path: a.path, namespace: 'demo-virtual' }));
      b.onLoad({ filter: /.*/, namespace: 'demo-virtual' }, a => ({ contents: BROWSER_VIRTUAL[a.path], loader: 'js' }));
      b.onLoad({ filter: /\.ts$/ }, a => stubbed.has(a.path) ? { contents: stubbed.get(a.path), loader: 'js', resolveDir: path.dirname(a.path) } : undefined);
    },
  }],
});
files.engine = await emit('engine.js', Buffer.from(result.outputFiles[0].contents));
log(`backend bundle ${files.engine} (${routeFiles.length} routes)`);

// ---------------------------------------------------------------------------------------------
// What each file costs to download: as stored for the gzipped ones, compressed in transit for the rest.
const sizes = {};
for (const file of [...Object.values(files), ...new Set(Object.values(storage))]) {
  const bytes = await fs.readFile(path.join(OUT, file));
  sizes[file] = { bytes: bytes.length, gzip: /\.(gz|tgz|png)$/.test(file) ? bytes.length : gzipSync(bytes, { level: 6 }).length };
}
// A viewer's copy is kept across builds while the migrations and the seed stay the same (sourceHash).
const manifest = { version: 1, snapshot: schema, seededOn: seedMeta.seededOn, files, storage, sizes };
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
const total = ['wasm', 'data', 'initdb', 'snapshot', 'engine'].reduce((sum, key) => sum + sizes[files[key]].gzip, 0);
log(`done: ${OUT} (first open downloads about ${(total / 1048576).toFixed(1)} MB compressed)`);
process.exit(0);
