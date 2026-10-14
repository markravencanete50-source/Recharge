// What the devstack puts in place of Supabase, for the Node review server (server.mjs): a client that runs PostgREST-style calls on the local
// database as the signed-in person, the service-role client, and the source of the few server-only
// modules that are swapped at build or load time. Everything else (routes, schemas, database
// functions) is the repo's own.
//
// createDevstack({ dev, current, storage, links, env }) returns the object the swapped modules read
// as globalThis.__devstack:
//   dev      a DevDatabase (db-core.mjs);
//   current  () => ({ user, origin }) for the request being answered;
//   storage  { get(bucket, path), put(bucket, path, bytes), remove(bucket, path) } with Uint8Array bytes;
//   links    { read(bucket, path, { download }), upload(bucket, path) }: what a signed link points at;
//   env      the Worker variables the routes read (cloudflare:workers).

export const userObject = p => ({
  id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, phone: '', email_confirmed_at: p.email_confirmed_at ?? new Date(0).toISOString(),
  confirmed_at: p.email_confirmed_at ?? new Date(0).toISOString(), last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: p.fullName }, identities: [], created_at: p.created_at ?? new Date(0).toISOString(), updated_at: new Date().toISOString(), is_anonymous: false,
});

const toBytes = async body => body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());

export function createDevstack({ dev, current, storage, links, env }) {
  class Query {
    constructor(user, headers, table) { Object.assign(this, { user, headers, table, columns: '*', filters: [], orders: [], rowLimit: undefined, one: null, mutation: null }); }
    select(columns = '*') { if (!this.mutation) this.columns = String(columns).replace(/\s+/g, ''); return this; }
    order(column, options = {}) { this.orders.push([column, options.ascending !== false]); return this; }
    limit(n) { this.rowLimit = n; return this; }
    eq(c, v) { this.filters.push([c, '=', v]); return this; }
    neq(c, v) { this.filters.push([c, '<>', v]); return this; }
    gt(c, v) { this.filters.push([c, '>', v]); return this; }
    gte(c, v) { this.filters.push([c, '>=', v]); return this; }
    lt(c, v) { this.filters.push([c, '<', v]); return this; }
    lte(c, v) { this.filters.push([c, '<=', v]); return this; }
    is(c, v) { this.filters.push([c, 'is', v]); return this; }
    in(c, v) { this.filters.push([c, 'in', v]); return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    insert(row) { this.mutation = { kind: 'insert', row }; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      if (this.mutation) {
        // Only the service client inserts (account invites record an access event).
        if (this.user !== 'service') return { data: null, error: { code: '42501', message: 'permission denied' } };
        const rows = [].concat(this.mutation.row), keys = Object.keys(rows[0] ?? {});
        if (!keys.every(k => /^[a-z_][a-z0-9_]*$/.test(k)) || !/^[a-z_][a-z0-9_]*$/.test(this.table)) return { data: null, error: { code: 'PGRST100', message: 'Invalid insert' } };
        try {
          const columns = keys.map(k => `"${k}"`).join(', ');
          for (const row of rows) await dev.sql(`insert into public."${this.table}"(${columns}) select ${columns} from jsonb_populate_record(null::public."${this.table}", $1::jsonb)`, [JSON.stringify(row)]);
          return { data: null, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      }
      return dev.select(this.user, this, this.headers);
    }
  }
  const thenable = promise => Object.assign(promise, { throwOnError() { return promise; } });

  // The signed-in person's client (what lib/supabase-server.ts makes from the session cookies).
  function client(extraHeaders = {}) {
    const person = current().user;
    const headers = { ...extraHeaders };
    return {
      devstack: true,
      rpc: (name, rpcArgs = {}) => thenable(dev.rpc(person, name, rpcArgs, headers)),
      from: table => new Query(person, headers, table),
      auth: {
        getUser: async () => person ? { data: { user: userObject(person) }, error: null } : { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400, code: 'session_not_found' } },
        getClaims: async () => person ? { data: { claims: { sub: person.id, session_id: person.sessionId, role: 'authenticated', aud: 'authenticated', email: person.email } }, error: null } : { data: null, error: { message: 'Auth session missing!' } },
        getSession: async () => ({ data: { session: person ? { user: userObject(person), access_token: 'devstack' } : null }, error: null }),
        signOut: async () => ({ error: null }),
        signInWithPassword: async () => ({ data: null, error: { code: 'invalid_credentials', message: 'Use /dev/as/<role> on the devstack' } }),
        updateUser: async () => ({ data: { user: person ? userObject(person) : null }, error: null }),
      },
    };
  }

  // The service-role client (createClient with the secret key): RPCs as service_role, a few admin
  // calls, and Supabase Storage (kept by `storage`).
  function serviceClient() {
    const admin = {
      inviteUserByEmail: async email => ({ data: null, error: { message: `Invites are not sent on the devstack (${email})` } }),
      generateLink: async () => ({ data: null, error: { message: 'Links are not sent on the devstack' } }),
      createUser: async () => ({ data: null, error: { message: 'Accounts are seeded on the devstack' } }),
      deleteUser: async () => ({ data: null, error: { message: 'Accounts are not deleted on the devstack' } }),
      getUserById: async target => { const row = dev.users.get(target); return row ? { data: { user: userObject({ ...row, fullName: row.full_name }) }, error: null } : { data: { user: null }, error: { message: 'User not found' } }; },
      signOut: async () => ({ error: null }),
    };
    return {
      devstack: true,
      rpc: (name, rpcArgs = {}) => thenable(dev.rpc('service', name, rpcArgs)),
      from: table => new Query('service', {}, table),
      auth: { admin, getUser: async () => ({ data: { user: null }, error: { message: 'Service client' } }) },
      storage: { from: bucket => ({
        upload: async (file, body, options = {}) => {
          if (!options.upsert && await storage.get(bucket, file)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          await storage.put(bucket, file, await toBytes(body));
          return { data: { path: file, fullPath: `${bucket}/${file}` }, error: null };
        },
        download: async file => { const bytes = await storage.get(bucket, file).catch(() => null); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }; },
        createSignedUrl: async (file, _expires, options = {}) => ({ data: { signedUrl: await links.read(bucket, file, options) }, error: null }),
        createSignedUrls: async files => ({ data: await Promise.all(files.map(async file => ({ path: file, error: null, signedUrl: await links.read(bucket, file, {}) }))), error: null }),
        // One-off upload links (Messages photos and videos): the app sends the file to this address.
        createSignedUploadUrl: async file => ({ data: { path: file, token: 'devstack', signedUrl: await links.upload(bucket, file) }, error: null }),
        remove: async files => { for (const file of files) await storage.remove(bucket, file).catch(() => undefined); return { data: [], error: null }; },
      }) },
    };
  }

  return {
    env, current, client, serviceClient,
    serviceRpc: (name, rpcArgs) => dev.rpc('service', name, rpcArgs),
    supabaseConfiguration: () => ({ url: `${current().origin}/devstack-supabase`, key: 'sb_publishable_devstack' }),
    securityConfiguration: () => ({ url: `${current().origin}/devstack-supabase`, key: 'sb_secret_devstack', salt: 'devstack-rate-limit-salt-0123456789abcdef', origin: current().origin }),
  };
}

// ---------------------------------------------------------------------------------------------
// The server-only modules, swapped at module-resolution time (Vite in server.mjs). Keys are paths
// from the repo root.
export const STUBS = {
  'lib/supabase-server.ts': `import { confirmedContact } from './registration-policy';
const ds = () => globalThis.__devstack;
export function supabaseConfiguration() { return ds().supabaseConfiguration(); }
export const workspaceSupabase = async () => ds().client();
export const workspaceSupabaseViewing = async target => ds().client({ 'x-recharge-view-as': target });
export const verifiedWorkspaceUser = async () => {
  const client = ds().client();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !confirmedContact(data.user)) return null;
  const allowed = await client.rpc('workspace_session_allowed');
  return allowed.error || allowed.data !== true ? null : data.user;
};`,
  'lib/auth-security.ts': `const ds = () => globalThis.__devstack;
export function authSecurityConfiguration() { return ds().securityConfiguration(); }
export async function securityHash(scope, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(ds().securityConfiguration().salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(scope + '\\0' + value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function securityRpc(name, args) { const result = await ds().serviceRpc(name, args); if (result.error) throw new Error('Security database unavailable: ' + result.error.message); return result.data; }
export async function passwordDecision() { return { allowed: true, retryAfter: 0 }; }
// No rate limits on the devstack.
export async function requestQuota() { return { allowed: true, retryAfter: 0 }; }
export async function providerIdentity() { const user = ds().current().user; return user ? { user: { id: user.id, email: user.email, email_confirmed_at: new Date(0).toISOString() }, sessionId: user.sessionId } : null; }
export async function recoveryPhase() { return true; }`,
};
// Bare module names replaced everywhere they are imported from the repo's own code.
export const VIRTUAL = {
  'cloudflare:workers': 'export const env = globalThis.__devstack.env; export default { env };',
  '@supabase/supabase-js': `export const createClient = () => globalThis.__devstack.serviceClient();
export class SupabaseClient {}`,
};
// The browser has no Next.js server; the routes only use NextResponse.json.
export const BROWSER_VIRTUAL = {
  ...VIRTUAL,
  'next/server': `export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}
export class NextRequest extends Request {}`,
  'next/headers': `export async function cookies() { return { getAll: () => [], get: () => undefined, set: () => undefined }; }
export async function headers() { return new Headers(); }`,
};
