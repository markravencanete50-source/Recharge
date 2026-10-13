// Recharge devstack: the real /api/workspace route handlers (loaded through Vite) against the real
// database functions (PGlite + supabase/migrations), signed in as any seeded person.
//
//   node scripts/demo/server.mjs --static <web export dir> [--port 4318] [--reseed]
//
// Only lib/supabase-server.ts, lib/auth-security.ts, cloudflare:workers and the service client
// from @supabase/supabase-js are replaced (at module-resolution time); every route, schema and
// database function is the repo's own. See scripts/demo/README.md.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ROOT, DEVSTACK, PEOPLE, ROLES, DevDatabase, findPerson, freshDatabase, loadDatabase, sourceHash } from './db.mjs';
import { storageGet, storagePut, storageRemove } from './media.mjs';
import { createDevstack, STUBS, VIRTUAL } from './devstack-core.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(option('--port', process.env.DEVSTACK_PORT || 4318));
const HOST = option('--host', '127.0.0.1');
const STATIC = option('--static', process.env.DEVSTACK_STATIC || '');
const CACHE = path.join(DEVSTACK, 'seed.tar.gz'), META = path.join(DEVSTACK, 'seed.meta.json');
const started = Date.now();
const log = (...parts) => console.log(`[devstack ${new Date().toISOString().slice(11, 19)}]`, ...parts);
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

// ---------------------------------------------------------------------------------------------
// Database: the cached seed when it matches the schema, seed and today's date; otherwise reseed.
async function openDatabase() {
  const hash = await sourceHash();
  const meta = JSON.parse(await fs.readFile(META, 'utf8').catch(() => '{}'));
  const reason = flag('--reseed') ? '--reseed' : !existsSync(CACHE) ? 'no cached seed' : meta.hash !== hash ? 'migrations or seed changed'
    : meta.seededOn !== londonToday() && !flag('--keep-dates') ? `seed dates are from ${meta.seededOn}` : null;
  if (!reason) {
    const db = await loadDatabase(new Blob([await fs.readFile(CACHE)]));
    log(`loaded cached seed (${meta.seededOn}, ${meta.summary ?? ''})`);
    return new DevDatabase(db);
  }
  log(`seeding a fresh database: ${reason}`);
  const { seed } = await import('./seed.mjs');
  const dev = new DevDatabase(await freshDatabase());
  const summary = await seed(dev, { log: (...m) => log('seed:', ...m) });
  await dev.serialize(async () => {
    const blob = await dev.db.dumpDataDir('gzip');
    await fs.writeFile(CACHE, Buffer.from(await blob.arrayBuffer()));
  });
  await fs.writeFile(META, JSON.stringify({ hash, seededOn: londonToday(), seededAt: new Date().toISOString(), summary: summary?.line ?? '' }, null, 2));
  log(`seeded and cached in ${((Date.now() - started) / 1000).toFixed(1)}s: ${summary?.line ?? ''}`);
  return dev;
}
const dev = await openDatabase();
// Sessions approved in the snapshot stay approved; write quotas start empty.
await dev.exec(`update private.workspace_approved_sessions set expires_at = now() + interval '10 years'; delete from private.workspace_write_limits;`);
await dev.refreshUsers();

// ---------------------------------------------------------------------------------------------
// What the replaced modules call (globalThis.__devstack): devstack-core.mjs, with photos on disk.
const als = new AsyncLocalStorage();
const current = () => als.getStore() ?? { user: null, origin: `http://localhost:${PORT}` };
const fileUrl = (prefix, bucket, file) => `${current().origin}/${prefix}/${bucket}/${file.split('/').map(encodeURIComponent).join('/')}`;
globalThis.__devstack = createDevstack({
  dev, current,
  storage: { get: storageGet, put: (bucket, file, bytes) => storagePut(bucket, file, Buffer.from(bytes)), remove: storageRemove },
  links: {
    read: (bucket, file, options = {}) => fileUrl('devstack-storage', bucket, file) + (options.download ? `?download=${encodeURIComponent(options.download)}` : ''),
    upload: (bucket, file) => fileUrl('devstack-storage-upload', bucket, file) + '?token=devstack',
  },
  // Photos use the project's storage (here on disk); email, push and the channel manager stay unconfigured.
  env: { APP_ORIGIN: `http://localhost:${PORT}`, SUPABASE_URL: 'https://devstack.localhost', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_devstack', SUPABASE_SECRET_KEY: 'sb_secret_devstack' },
});

// ---------------------------------------------------------------------------------------------
// Vite loads the real route modules; this plugin swaps the server-only modules at resolution time.
const stubPlugin = {
  name: 'recharge-devstack-stubs', enforce: 'pre',
  resolveId(source) {
    if (source === 'cloudflare:workers') return '\0devstack:cloudflare:workers';
    if (source === 'devstack:@supabase/supabase-js') return '\0devstack:@supabase/supabase-js';
    return null;
  },
  load(id) {
    if (id.startsWith('\0devstack:')) return VIRTUAL[id.slice('\0devstack:'.length)];
    const file = id.split('?')[0];
    for (const [suffix, code] of Object.entries(STUBS)) if (file === path.join(ROOT, suffix)) return code;
    return null;
  },
  // The service client, for the repo's own server modules only. (Vite resolves package imports
  // for SSR without asking plugins, so the import itself is renamed.)
  transform(code, id) {
    const file = id.split('?')[0];
    if (!file.startsWith(ROOT) || file.includes('/node_modules/') || !/\.(ts|tsx|js|mjs)$/.test(file) || !code.includes('@supabase/supabase-js')) return null;
    return { code: code.replace(/from\s*(['"])@supabase\/supabase-js\1/g, "from 'devstack:@supabase/supabase-js'"), map: null };
  },
};
const { createServer: createVite } = await import('vite');
const vite = await createVite({
  root: ROOT, configFile: false, appType: 'custom', logLevel: 'warn', clearScreen: false,
  server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/mobile/**', '**/scripts/demo/**', '**/.devstack/**', '**/dist/**', '**/node_modules/**'] } },
  resolve: { alias: { '@': ROOT } },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [stubPlugin],
});
const routeFile = segments => path.join(ROOT, 'app/api/workspace', ...segments, 'route.ts');
async function routeModule(segments) {
  const file = routeFile(segments);
  if (!existsSync(file)) return null;
  return vite.ssrLoadModule(file);
}
// Warm the modules the app needs on load.
const warm = Date.now();
for (const segments of [[], ['account'], ['operations'], ['teams'], ['portfolio'], ['chat'], ['finance'], ['reports'], ['guest-inbox']]) await routeModule(segments).catch(error => log('warm-up failed', segments.join('/'), error.message));
log(`route modules ready in ${((Date.now() - warm) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------------------------
// HTTP.
const COOKIE = 'devstack-user';
const cookies = req => Object.fromEntries((req.headers.cookie ?? '').split(';').map(part => part.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function signedIn(req) {
  const value = cookies(req)[COOKIE];
  if (value === 'signed-out') return null;
  const found = findPerson(value || 'super_admin');
  if (!found) return null;
  const row = dev.users.get(found.id);
  return { ...found, email_confirmed_at: row?.email_confirmed_at, created_at: row?.created_at, fullName: row?.full_name ?? found.fullName, role: row?.role ?? found.role };
}
const setCookie = value => `${COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=31536000`;
const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(text);
};
const readBody = req => new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });

async function api(req, res, url, origin) {
  const segments = url.pathname.split('/').slice(3).filter(Boolean);
  if (segments.some(s => !/^[a-z][a-z-]*$/.test(s)) || segments.length > 2) return send(res, 404, { error: 'Not found' });
  const mod = await routeModule(segments);
  if (!mod) return send(res, 404, { error: 'Not found' });
  const handler = mod[req.method];
  if (typeof handler !== 'function') return send(res, 405, { error: 'Method not allowed' });
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !key.startsWith(':')) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  if (!headers.has('origin') && req.method !== 'GET') headers.set('origin', origin);
  const request = new Request(origin + req.url, { method: req.method, headers, body, duplex: 'half' });
  const user = signedIn(req);
  const response = await als.run({ user, origin }, () => handler(request));
  const out = Buffer.from(await response.arrayBuffer());
  const responseHeaders = {};
  response.headers.forEach((value, key) => { if (key !== 'content-length' && key !== 'content-encoding' && key !== 'strict-transport-security') responseHeaders[key] = value; });
  res.writeHead(response.status, responseHeaders);
  res.end(out);
  return response.status;
}

// The enquiry form page here is a client-rendered copy of app/enquiry (README.md: "The enquiry form").
const HARNESS = process.env.ENQUIRY_HARNESS ?? path.join(DEVSTACK, 'harness');
async function publicApi(req, res, url, origin, file) {
  const mod = await vite.ssrLoadModule(path.join(ROOT, file));
  const handler = mod[req.method];
  if (typeof handler !== 'function') return send(res, 405, { error: 'Method not allowed' });
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !key.startsWith(':')) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  if (!headers.has('origin') && req.method !== 'GET') headers.set('origin', origin);
  const request = new Request(origin + req.url, { method: req.method, headers, body, duplex: 'half' });
  const response = await als.run({ user: null, origin }, () => handler(request));
  const out = Buffer.from(await response.arrayBuffer());
  const responseHeaders = {};
  response.headers.forEach((value, key) => { if (key !== 'content-length' && key !== 'content-encoding' && key !== 'strict-transport-security') responseHeaders[key] = value; });
  res.writeHead(response.status, responseHeaders);
  res.end(out);
  return response.status;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.webp': 'image/webp', '.gif': 'image/gif', '.wasm': 'application/wasm' };
function serveStatic(req, res, url) {
  if (!STATIC) return send(res, 404, `<p>No web build: start with <code>--static &lt;dir&gt;</code> (an <code>expo export --platform web</code> output built with EXPO_PUBLIC_WORKSPACE_WEB=same-origin).</p>`);
  const relative = decodeURIComponent(url.pathname.replace(/^\/workspace\/?/, ''));
  if (relative.includes('..')) return send(res, 400, { error: 'Bad path' });
  // The build first, then the install files the production build copies in (mobile/web-static).
  for (const base of [STATIC, path.join(ROOT, 'mobile/web-static')]) {
    const file = path.join(base, relative);
    if (relative && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': /\/_expo\/|\/assets\//.test(url.pathname) ? 'public, max-age=3600' : 'no-cache' });
      createReadStream(file).pipe(res);
      return 200;
    }
  }
  // Not a file: the single-page app answers it.
  if (path.extname(relative) && !relative.endsWith('.html')) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
  createReadStream(path.join(STATIC, 'index.html')).pipe(res);
  return 200;
}

function usersPage(user) {
  const rows = [...dev.users.values()].map(r => `<tr${user?.id === r.id ? ' style="background:#e7f4f3"' : ''}><td><a href="/dev/as/${r.id}">${r.full_name}</a></td><td>${r.role}</td><td>${r.email}</td><td>${r.status}</td></tr>`).join('');
  const roles = ROLES.map(role => `<a href="/dev/as/${role}">${role}</a>`).join(' · ');
  return `<!doctype html><meta charset="utf-8"><title>Devstack people</title><style>body{font:15px system-ui;margin:32px;color:#1d4038}td,th{padding:6px 12px;text-align:left;border-bottom:1px solid #ddd}a{color:#2f6e73}</style>
<h1>Recharge devstack</h1><p>Signed in as <b>${user ? `${user.fullName} (${user.role})` : 'nobody'}</b>. Open <a href="/workspace">/workspace</a>.</p>
<p>Sign in as a role: ${roles} · <a href="/dev/signout">sign out</a></p><table><tr><th>Person</th><th>Role</th><th>Email</th><th>Status</th></tr>${rows}</table>`;
}

const server = http.createServer(async (req, res) => {
  const begun = Date.now();
  const origin = `http://${req.headers.host ?? `localhost:${PORT}`}`;
  let url;
  try { url = new URL(req.url, origin); } catch { return send(res, 400, { error: 'Bad URL' }); }
  let status = 0;
  try {
    const p = url.pathname;
    if (p === '/' || p === '/sign-in') { res.writeHead(302, { location: '/workspace' }); res.end(); status = 302; }
    else if (p.startsWith('/dev/as/')) {
      const found = findPerson(p.slice('/dev/as/'.length));
      if (!found) status = send(res, 404, { error: 'No such person or role', people: PEOPLE.map(x => `${x.role}: ${x.fullName}`) }) ?? 404;
      else { res.writeHead(302, { location: url.searchParams.get('next') || '/workspace', 'set-cookie': setCookie(found.id), 'cache-control': 'no-store' }); res.end(); status = 302; }
    }
    else if (p === '/dev/signout') { res.writeHead(302, { location: '/dev/users', 'set-cookie': setCookie('signed-out') }); res.end(); status = 302; }
    else if (p === '/dev/users' || p === '/dev' || p === '/dev/') {
      if (url.searchParams.get('format') === 'json' || (req.headers.accept ?? '').includes('application/json') && !(req.headers.accept ?? '').includes('text/html')) send(res, 200, { signedIn: signedIn(req)?.id ?? null, people: [...dev.users.values()] });
      else send(res, 200, usersPage(signedIn(req)));
      status = 200;
    }
    else if (p === '/api/session' && req.method === 'POST') {
      // The app's own sign-in form: any password, matched by email.
      let input = {}; try { input = JSON.parse((await readBody(req)).toString() || '{}'); } catch { /* empty */ }
      const found = findPerson(String(input.email ?? input.phone ?? ''));
      if (!found) { send(res, 401, { error: 'Sign-in failed. Use one of the seeded emails (see /dev/users); any password works.' }); status = 401; }
      else { send(res, 200, { ok: true }, { 'set-cookie': setCookie(found.id) }); status = 200; }
    }
    else if (p === '/api/session/logout' && req.method === 'POST') { res.writeHead(303, { location: '/workspace', 'set-cookie': setCookie('signed-out') }); res.end(); status = 303; }
    else if (p === '/api/workspace' || p.startsWith('/api/workspace/')) status = await api(req, res, url, origin);
    // Client Enquiries' public side (no account): the form page (a client-rendered harness of
    // app/enquiry) and its two routes.
    else if (p === '/api/enquiry' || p === '/api/enquiry/upload') status = await publicApi(req, res, url, origin, p === '/api/enquiry' ? 'app/api/enquiry/route.ts' : 'app/api/enquiry/upload/route.ts');
    else if (p === '/enquiry') {
      const mod = await vite.ssrLoadModule(path.join(ROOT, 'lib/client-enquiry-server.ts'));
      const token = url.searchParams.get('t') ?? undefined;
      const form = await als.run({ user: null, origin }, () => mod.openEnquiryForm(token));
      send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New property enquiry · Recharge</title><link rel="stylesheet" href="/harness/enquiry.css"></head><body><div id="root"></div><script>window.__ENQUIRY__=${JSON.stringify({ token, form }).replace(/</g, '\\u003c')}</script><script type="module" src="/harness/enquiry.js"></script></body></html>`);
      status = 200;
    }
    else if (p.startsWith('/harness/') || p.startsWith('/recharge-') || p.startsWith('/fonts/')) {
      const file = p.startsWith('/harness/') ? path.join(HARNESS, path.basename(p)) : path.join(ROOT, 'public', p.startsWith('/fonts/') ? 'fonts' : '', path.basename(p));
      if (!existsSync(file)) status = send(res, 404, { error: 'Not found' }) ?? 404;
      else { res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); createReadStream(file).pipe(res); status = 200; }
    }
    else if (p.startsWith('/devstack-storage-upload/') && req.method === 'PUT') {
      // A file sent with a one-off upload link (at most 50 MB, like the real bucket).
      const [bucket, ...rest] = p.slice('/devstack-storage-upload/'.length).split('/').map(decodeURIComponent);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 52428800) break; chunks.push(chunk); }
      if (size > 52428800) status = send(res, 413, { error: 'Payload too large' }) ?? 413;
      else if (await storageGet(bucket, rest.join('/')).catch(() => null)) status = send(res, 409, { error: 'The resource already exists' }) ?? 409;
      else { await storagePut(bucket, rest.join('/'), Buffer.concat(chunks)); status = send(res, 200, { Key: `${bucket}/${rest.join('/')}` }) ?? 200; }
    }
    else if (p.startsWith('/devstack-storage/')) {
      // What a signed storage URL points at (course files).
      const [bucket, ...rest] = p.slice('/devstack-storage/'.length).split('/').map(decodeURIComponent);
      const bytes = await storageGet(bucket, rest.join('/')).catch(() => null);
      if (!bytes) status = send(res, 404, { error: 'Not found' }) ?? 404;
      else { res.writeHead(200, { 'content-type': TYPES[path.extname(rest.at(-1)).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, no-store', ...(url.searchParams.get('download') ? { 'content-disposition': `attachment; filename="${url.searchParams.get('download').replace(/"/g, '')}"` } : {}) }); res.end(bytes); status = 200; }
    }
    else if (p === '/workspace' || p.startsWith('/workspace/')) status = serveStatic(req, res, url);
    else if (p === '/favicon.ico') { res.writeHead(302, { location: '/workspace/favicon.ico' }); res.end(); status = 302; }
    else status = send(res, 404, { error: 'Not found' }) ?? 404;
  } catch (error) {
    log('ERROR', req.method, req.url, error?.stack ?? error);
    if (!res.headersSent) send(res, 500, { error: 'Devstack error: ' + (error?.message ?? error) });
    status = 500;
  }
  if (url.pathname.startsWith('/api/') || status >= 400 && !url.pathname.startsWith('/workspace/_expo')) log(`${req.method} ${url.pathname}${url.search} -> ${status || res.statusCode} ${Date.now() - begun}ms ${signedIn(req)?.role ?? '-'}`);
});
// Localhost only, on IPv4 and (where there is one) IPv6, so http://localhost works either way.
const servers = [server];
server.listen(PORT, HOST, () => {
  log(`ready on http://localhost:${PORT} in ${((Date.now() - started) / 1000).toFixed(1)}s${STATIC ? ` (app: ${STATIC})` : ' (no --static build: API only)'}`);
  log(`sign in as a role: http://localhost:${PORT}/dev/as/<${ROLES.join('|')}>  people: http://localhost:${PORT}/dev/users`);
});
if (HOST === '127.0.0.1') {
  const v6 = http.createServer((req, res) => server.emit('request', req, res));
  v6.on('error', () => undefined);
  v6.listen(PORT, '::1');
  servers.push(v6);
}
const stop = async () => { for (const s of servers) s.close(); await vite.close().catch(() => undefined); await dev.db.close().catch(() => undefined); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
