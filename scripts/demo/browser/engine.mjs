// The interactive demo's backend, running in a Web Worker in the viewer's browser.
//
// It is the devstack (scripts/demo/server.mjs) without the server: PGlite with every migration and
// the sample business (a prebuilt snapshot, scripts/demo/build-browser-demo.mjs), the repo's own
// /api/workspace route handlers with their own request schemas, and the same stand-ins for Supabase
// (devstack-core.mjs). The viewer's copy is kept in this browser (IndexedDB) until "Reset demo".
// Nothing here reaches the network except this demo's own static files: every outside service
// (Hostaway, email, phone notifications) is answered here and reported as "In demo, this would be
// sent to …" instead.
//
// Messages (main thread → worker): { id, type, ...input }; each is answered with { id, ok, value } or
// { id, ok: false, error }. Types: open, request, jobs, put. "Reset demo" stops this worker and deletes
// its two IndexedDB databases (IDB_DATA's and META_DB) from the page: mobile/src/demo/engine.ts.
import { ENV } from './env.mjs';
import { PGlite } from '@electric-sql/pglite';
import { DevDatabase, PEOPLE, ROLES, findPerson } from '../db-core.mjs';
import { createDevstack } from '../devstack-core.mjs';
import { backendRouteAllowed } from '../../../worker/backend-route-policy';
import { dispatchNotifications } from '../../../lib/integration-server';
import { ROUTES } from 'demo:routes';
import { DEMO_JOBS } from './jobs.mjs';
import { shiftDatabaseDates } from './dates.mjs';
import { fakeServiceResponse } from './services.mjs';

const IDB_DATA = 'recharge-demo';
const META_DB = 'recharge-demo-meta';
const DAY = 86_400_000;
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / DAY);

// ---------------------------------------------------------------------------------------------
// The network. Only this demo's static files may be fetched; outside services get a stand-in
// answer and a note; anything else (above all /api/…) is refused.
let base = '';
let notes = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), self.location.href);
  const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
  if (url.origin === self.location.origin && base && url.pathname.startsWith(new URL(base, self.location.href).pathname) && method === 'GET') return realFetch(url.href, { credentials: 'omit' });
  const body = init.body ?? (request ? await request.clone().text() : undefined);
  const faked = await fakeServiceResponse(url, method, body);
  if (faked) { if (faked.note && !notes.includes(faked.note)) notes.push(faked.note); return faked.response; }
  throw new TypeError(`Blocked in demo: ${method} ${url.origin}${url.pathname}`);
};
// Browsers' other ways out are closed too.
self.XMLHttpRequest = undefined;
self.WebSocket = undefined;
self.EventSource = undefined;
if (navigator.sendBeacon) navigator.sendBeacon = () => false;

// ---------------------------------------------------------------------------------------------
// Small IndexedDB helpers: the meta record and the stored files.
function idb(name, stores) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => { for (const store of stores) if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
const tx = (db, store, mode, work) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode), request = work(t.objectStore(store));
  t.oncomplete = () => resolve(request?.result);
  t.onerror = () => reject(t.error);
});
const deleteIdb = name => new Promise(resolve => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
let metaDb = null;
const meta = async () => (metaDb ??= await idb(META_DB, ['meta', 'files']));
const getMeta = async key => tx(await meta(), 'meta', 'readonly', s => s.get(key));
const setMeta = async (key, value) => tx(await meta(), 'meta', 'readwrite', s => s.put(value, key));

// Files (Supabase Storage in the live app): the viewer's own uploads in IndexedDB, and the sample
// business's photos as static files listed in the manifest, fetched the first time they are opened.
let manifest = null;
const fileKey = (bucket, path) => `${bucket}/${path}`;
const storage = {
  async get(bucket, path) {
    const own = await tx(await meta(), 'files', 'readonly', s => s.get(fileKey(bucket, path)));
    if (own === null) return null; // removed
    if (own) return own;
    const seeded = manifest?.storage?.[fileKey(bucket, path)];
    if (!seeded) return null;
    const response = await fetchBytes(seeded).catch(() => null);
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  },
  async put(bucket, path, bytes) { await tx(await meta(), 'files', 'readwrite', s => s.put(new Uint8Array(bytes), fileKey(bucket, path))); },
  async remove(bucket, path) { await tx(await meta(), 'files', 'readwrite', s => s.put(null, fileKey(bucket, path))); },
};
// What a signed link points at: an object URL for the file (kept while the demo is open).
const objectUrls = new Map();
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf' };
async function objectUrl(bucket, path) {
  const key = fileKey(bucket, path);
  if (objectUrls.has(key)) return objectUrls.get(key);
  const bytes = await storage.get(bucket, path);
  const url = URL.createObjectURL(new Blob([bytes ?? new Uint8Array()], { type: TYPES[path.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream' }));
  objectUrls.set(key, url);
  return url;
}
const UPLOAD = 'demo-upload://';

// ---------------------------------------------------------------------------------------------
// The database.
let dev = null, current = { user: null, origin: self.location.origin };
Object.assign(globalThis.__devstack, createDevstack({
  dev: { rpc: (...a) => dev.rpc(...a), select: (...a) => dev.select(...a), sql: (...a) => dev.sql(...a), get users() { return dev.users; } },
  current: () => current,
  storage,
  links: { read: (bucket, path) => objectUrl(bucket, path), upload: (bucket, path) => UPLOAD + fileKey(bucket, path) },
  env: ENV,
}));

// The demo's files carry a content hash in their names (all but manifest.json), so they are kept in
// this browser's cache once fetched; the next open needs no download. Older builds' files are dropped.
const CACHE = 'recharge-demo-files';
async function fetchBytes(file) {
  const url = new URL(base + file, self.location.href).href, keep = file !== 'manifest.json' && typeof caches === 'object';
  const cache = keep ? await caches.open(CACHE).catch(() => null) : null;
  const cached = await cache?.match(url).catch(() => null);
  if (cached) return cached;
  const response = await fetch(base + file);
  if (!response.ok) throw new Error(`The demo file ${file} did not load (${response.status}).`);
  if (cache) await cache.put(url, response.clone()).catch(() => undefined);
  return response;
}
async function dropOldFiles() {
  if (typeof caches !== 'object') return;
  const cache = await caches.open(CACHE), current = new Set([...Object.values(manifest.files), ...Object.values(manifest.storage)].map(f => new URL(base + f, self.location.href).href));
  for (const request of await cache.keys()) if (!current.has(request.url)) await cache.delete(request);
}
const progress = (...parts) => self.postMessage({ log: '[demo] ' + parts.join(' ') });
let opening = null;
async function open({ assets, fresh = false }) {
  base = assets;
  const t0 = performance.now(), timings = {};
  manifest = await (await fetchBytes('manifest.json')).json();
  // The WebAssembly and data files are stored gzipped (build-browser-demo.mjs); a host that already
  // decoded them in transit hands over the plain bytes, so look before inflating.
  const inflated = async file => {
    const bytes = new Uint8Array(await (await fetchBytes(file)).arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  };
  const compile = file => inflated(file).then(bytes => WebAssembly.compile(bytes));
  const [wasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    compile(manifest.files.wasm), compile(manifest.files.initdb),
    inflated(manifest.files.data).then(bytes => new Blob([bytes])),
  ]);
  timings.engine = Math.round(performance.now() - t0);
  progress('engine', timings.engine);
  // A copy made from another build of the schema can't be used by this build's code: start afresh.
  const saved = await getMeta('copy');
  let restarted = false;
  if (fresh || !saved || saved.snapshot !== manifest.snapshot) {
    restarted = !!saved && !fresh;
    await deleteIdb('/pglite/' + IDB_DATA);
    await tx(await meta(), 'files', 'readwrite', s => s.clear());
    await setMeta('copy', null);
  }
  const first = !(await getMeta('copy'));
  const loadDataDir = first ? await fetchBytes(manifest.files.snapshot).then(r => r.blob()) : undefined;
  timings.download = Math.round(performance.now() - t0);
  progress('download', timings.download, first);
  const db = await PGlite.create('idb://' + IDB_DATA, { pgliteWasmModule: wasmModule, initdbWasmModule, fsBundle, relaxedDurability: true, ...(loadDataDir ? { loadDataDir } : {}) });
  await db.exec(`set time zone 'Europe/London'`);
  timings.database = Math.round(performance.now() - t0);
  progress('database', timings.database);
  // The sample business's dates follow today, like the recording did: everything moves by the
  // days since the copy's dates were last set, so "today's cleans" are today's.
  const today = londonToday(), anchor = first ? manifest.seededOn : (await getMeta('copy')).anchor;
  const days = daysBetween(anchor, today);
  if (days) await shiftDatabaseDates(db, days);
  // Every sample person stays signed in; write quotas start empty.
  await db.exec(`update private.workspace_approved_sessions set expires_at = now() + interval '10 years'; delete from private.workspace_write_limits;`);
  await setMeta('copy', { snapshot: manifest.snapshot, anchor: today, createdAt: first ? new Date().toISOString() : (await getMeta('copy')).createdAt });
  dev = new DevDatabase(db);
  await dev.refreshUsers();
  timings.ready = Math.round(performance.now() - t0);
  void dropOldFiles().catch(() => undefined);
  return { first, restarted, shifted: days, timings, personas: await personas(), seededOn: manifest.seededOn, createdAt: (await getMeta('copy')).createdAt };
}
// One sample person per role: their account, as the app receives it.
async function personas() {
  const out = {};
  for (const role of ROLES) {
    const p = PEOPLE.find(x => x.role === role);
    const result = await dev.rpc(signedIn(p.id), 'workspace_account');
    if (!result.error && result.data) out[role] = { personId: p.id, account: result.data };
  }
  return out;
}
function signedIn(personId) {
  const found = findPerson(personId);
  if (!found) return null;
  const row = dev.users.get(found.id);
  return { ...found, email_confirmed_at: row?.email_confirmed_at, created_at: row?.created_at, fullName: row?.full_name ?? found.fullName, role: row?.role ?? found.role };
}

// ---------------------------------------------------------------------------------------------
// One request, through the repo's own route handler for the path, as the given sample person.
// Requests are answered one at a time (the database is one connection anyway).
let queue = Promise.resolve();
const serial = work => { const run = queue.then(work, work); queue = run.then(() => undefined, () => undefined); return run; };
const json = (body, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(body)).buffer, notes: [] });

async function request({ personId, method, path, headers = {}, body }) {
  const url = new URL(path, self.location.origin);
  // The Worker's own allowlist first (worker/backend-route-policy.ts), then the route's schemas.
  if (!url.pathname.startsWith('/api/workspace') || !backendRouteAllowed(url.pathname)) return json({ error: 'This endpoint is not available on the live backend' }, 404);
  const route = url.pathname.replace(/^\/api\/workspace\/?/, '');
  const mod = ROUTES[route];
  const handler = mod?.[method];
  if (typeof handler !== 'function') return json({ error: mod ? 'Method not allowed' : 'Not found' }, mod ? 405 : 404);
  // A Hostaway sync would read every listing and stay from the channel manager.
  if (method === 'POST' && route === 'integrations' && body?.json?.action === 'syncHostaway') return { ...json({ ok: true, mode: 'demo', imported: 0 }), notes: ['In demo, this would fetch the listings and stays from Hostaway. Nothing is fetched.'] };
  let requestBody;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('origin', self.location.origin);
  if (body?.json !== undefined) { requestBody = JSON.stringify(body.json); requestHeaders.set('content-type', 'application/json'); }
  else if (body?.form) { const form = new FormData(); for (const [k, v] of body.form) form.append(k, v); requestBody = form; requestHeaders.delete('content-type'); }
  current = { user: signedIn(personId), origin: self.location.origin };
  notes = [];
  const incoming = new Request(url.href, { method, headers: requestHeaders, body: requestBody });
  // Browsers drop a hand-set Origin header from a Request; the app's own requests carry it, so it
  // is put back the way the Worker would see it (headers kept, plus Origin).
  const seen = new Headers(incoming.headers);
  seen.set('origin', self.location.origin);
  Object.defineProperty(incoming, 'headers', { value: seen });
  const response = await handler(incoming);
  const out = { status: response.status, headers: Object.fromEntries(response.headers), body: await response.arrayBuffer(), notes };
  notes = [];
  return out;
}

// "Run today's automatic jobs": what the backend's schedule runs (worker/index.ts), on demand.
async function jobs() {
  const results = [];
  notes = [];
  for (const job of DEMO_JOBS) {
    const result = await dev.rpc('service', job.rpc, {});
    results.push({ job: job.label, ok: !result.error, error: result.error?.message ?? null });
  }
  // Notices for email and phones go out last, as the schedule's delivery batch does.
  current = { user: null, origin: self.location.origin };
  const delivered = await dispatchNotifications(ENV).catch(() => null);
  results.push({ job: 'Email and phone notices', ok: !!delivered, error: null, delivered });
  const out = { results, notes };
  notes = [];
  return out;
}

self.onmessage = async event => {
  const { id, type, ...input } = event.data ?? {};
  try {
    let value;
    if (type === 'open') value = await (opening ??= open(input).finally(() => { opening = null; }));
    else if (!dev) throw new Error('The demo is still opening.');
    else if (type === 'request') value = await serial(() => request(input));
    else if (type === 'jobs') value = await serial(() => jobs());
    // A file sent with a one-off upload link (Messages photos and videos).
    else if (type === 'put') {
      if (!String(input.url).startsWith(UPLOAD)) throw new Error('Not a demo upload link');
      const [bucket, ...rest] = input.url.slice(UPLOAD.length).split('/');
      if (await storage.get(bucket, rest.join('/'))) throw Object.assign(new Error('The resource already exists'), { status: 409 });
      await storage.put(bucket, rest.join('/'), new Uint8Array(await input.blob.arrayBuffer()));
      value = { ok: true };
    } else throw new Error('Unknown demo message ' + type);
    self.postMessage({ id, ok: true, value }, value?.body instanceof ArrayBuffer ? [value.body] : []);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { message: error?.message ?? String(error), status: error?.status ?? 500 } });
  }
};
