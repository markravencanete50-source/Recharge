// The part of the devstack database layer that runs anywhere (Node and the browser demo): the
// bootstrap Supabase gives every project, the dev people, and the per-call "act as" helpers that do
// what Supabase's Data API (PostgREST) does for each request: one transaction, the caller's JWT
// claims and request headers as transaction-local settings, `set local role`, the pre-request hook
// (public.workspace_request_check), then the call. scripts/demo/db.mjs adds the Node file handling.

// Same bootstrap as tests/live-cleans-contract.test.mjs, plus the auth.users columns Supabase has
// that some functions read through to_jsonb (phone, last sign-in, sign-in block).
export const BOOTSTRAP = `set time zone 'Europe/London';
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz,
  phone text, phone_confirmed_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz, created_at timestamptz default now());
create table auth.sessions(id uuid primary key, user_id uuid references auth.users, not_after timestamptz, created_at timestamptz default now());
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`;

// ---------------------------------------------------------------------------------------------
// People. Fixed ids so links (/dev/as/<role>) and the cached seed agree.
const id = n => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const PEOPLE = [
  { n: 1, key: 'sam', role: 'super_admin', fullName: 'Sam Taylor', email: 'sam.taylor@recharge.example', responsibilities: 'Founder and director' },
  { n: 2, key: 'morag', role: 'admin', fullName: 'Morag Campbell', email: 'morag.campbell@recharge.example', responsibilities: 'Operations manager' },
  { n: 3, key: 'fiona', role: 'stays', fullName: 'Fiona MacLeod', email: 'fiona.macleod@recharge.example', responsibilities: 'Guest experience and pricing, Edinburgh and Fife' },
  { n: 4, key: 'callum', role: 'stays', fullName: 'Callum Fraser', email: 'callum.fraser@recharge.example', responsibilities: 'Listings and direct bookings, Glasgow and the north' },
  { n: 5, key: 'isla', role: 'cleaning_manager', fullName: 'Isla Robertson', email: 'isla.robertson@recharge.example', responsibilities: 'Cleaning team lead' },
  { n: 6, key: 'ewan', role: 'cleans', fullName: 'Ewan Stewart', email: 'ewan.stewart@recharge.example', responsibilities: 'Cleaner, Edinburgh' },
  { n: 7, key: 'kirsty', role: 'cleans', fullName: 'Kirsty Murray', email: 'kirsty.murray@recharge.example', responsibilities: 'Cleaner, Glasgow' },
  { n: 8, key: 'jamie', role: 'cleans', fullName: 'Jamie Paterson', email: 'jamie.paterson@recharge.example', responsibilities: 'Cleaner, Fife and St Andrews' },
  { n: 9, key: 'rory', role: 'ready', fullName: 'Rory MacDonald', email: 'rory.macdonald@recharge.example', responsibilities: 'Maintenance and property readiness, central belt' },
  { n: 10, key: 'eilidh', role: 'ready', fullName: 'Eilidh Grant', email: 'eilidh.grant@recharge.example', responsibilities: 'Maintenance and inspections, Highlands and north east' },
  { n: 11, key: 'graham', role: 'accounts', fullName: 'Graham Henderson', email: 'graham.henderson@recharge.example', responsibilities: 'Accounts and owner statements' },
  { n: 12, key: 'alasdair', role: 'client', fullName: 'Alasdair Duncan', email: 'alasdair.duncan@example.com', responsibilities: '' },
  { n: 13, key: 'catriona', role: 'client', fullName: 'Catriona Ross', email: 'catriona.ross@example.com', responsibilities: '' },
  { n: 14, key: 'moira', role: 'client', fullName: 'Moira Wallace', email: 'moira.wallace@example.com', responsibilities: '' },
].map(p => ({ ...p, id: id(p.n), sessionId: sid(p.n) }));
export const ROLES = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'];
export const person = key => PEOPLE.find(p => p.key === key) ?? (() => { throw new Error('No dev person ' + key); })();
// "cleans" -> the first cleaner, "cleans/2" -> the second, a uuid, an email or a first name.
export function findPerson(spec) {
  if (!spec) return null;
  const value = decodeURIComponent(String(spec)).trim().toLowerCase();
  const [role, index] = value.split(/[/:]/);
  const ofRole = PEOPLE.filter(p => p.role === role);
  if (ofRole.length) return ofRole[Math.max(0, Math.min(ofRole.length - 1, (Number(index) || 1) - 1))];
  return PEOPLE.find(p => p.id === value || p.email === value || p.key === value) ?? null;
}

// ---------------------------------------------------------------------------------------------
// One connection, so every call goes through one queue.
export class DevDatabase {
  constructor(db) { this.db = db; this.queue = Promise.resolve(); this.functions = null; this.users = new Map(); }
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
  // Superuser SQL (seed fix-ups, dev pages). Not used for anything a request does.
  sql(text, params) { return this.serialize(async () => (await this.db.query(text, params)).rows); }
  exec(text) { return this.serialize(() => this.db.exec(text)); }

  async catalog() {
    if (this.functions) return this.functions;
    const rows = (await this.db.query(`select p.proname name, p.pronargs nargs, coalesce(p.proargnames, '{}') argnames,
        array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality u(t, i) order by i) types,
        format_type(p.prorettype, null) returns
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`)).rows;
    this.functions = new Map();
    for (const row of rows) {
      const list = this.functions.get(row.name) ?? [];
      list.push({ ...row, argnames: row.argnames.slice(0, row.nargs) });
      this.functions.set(row.name, list);
    }
    return this.functions;
  }
  async refreshUsers() {
    const rows = (await this.db.query(`select u.id, u.email, u.email_confirmed_at, u.created_at, p.full_name, p.role, p.status,
      (select s.session_id from private.workspace_approved_sessions s where s.user_id = u.id order by s.expires_at desc limit 1) session_id
      from auth.users u left join public.workspace_profiles p on p.user_id = u.id order by p.role, p.full_name`)).rows;
    this.users = new Map(rows.map(r => [r.id, r]));
    return rows;
  }

  // PostgREST-style RPC with named arguments, run as `user` (null = anon, 'service' = service_role).
  rpc(user, name, args = {}, headers = {}) {
    return this.serialize(async () => {
      const catalog = await this.catalog();
      const candidates = catalog.get(name);
      const keys = Object.keys(args ?? {}).filter(k => args[k] !== undefined);
      const fn = candidates?.find(c => keys.every(k => c.argnames.includes(k)));
      if (!/^[a-z_][a-z0-9_]*$/.test(name) || !fn) {
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`, details: null, hint: null }, status: 404 };
      }
      const parts = keys.map(k => {
        const type = fn.types[fn.argnames.indexOf(k)];
        const ref = `($1::jsonb -> '${k}')`;
        let expr;
        if (type === 'jsonb' || type === 'json') expr = `nullif(${ref}, 'null'::jsonb)::${type}`;
        else if (type.endsWith('[]')) expr = `(case when jsonb_typeof(${ref}) = 'array' then array(select jsonb_array_elements_text(${ref})) end)::${type}`;
        else expr = `(($1::jsonb) ->> '${k}')::${type}`;
        return `"${k}" => ${expr}`;
      });
      const sql = `select public."${name}"(${parts.join(', ')}) as result`;
      try {
        const data = await this.#asCaller(user, headers, async tx => (await tx.query(sql, parts.length ? [JSON.stringify(args)] : [])).rows[0]?.result);
        return { data: fn.returns === 'void' ? null : data ?? null, error: null, status: 200 };
      } catch (error) { return failure(error); }
    });
  }
  // The small PostgREST table read lib/business-server.ts builds (select/eq/gt/order/limit).
  select(user, query, headers = {}) {
    return this.serialize(async () => {
      const ident = value => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Object.assign(new Error(`Invalid identifier ${value}`), { code: 'PGRST100' }); return `"${value}"`; };
      try {
        const columns = query.columns === '*' ? '*' : query.columns.split(',').map(c => ident(c.trim())).join(', ');
        const params = [], where = [];
        for (const [column, op, value] of query.filters) {
          if (op === 'is') { where.push(`${ident(column)} is ${value === null ? 'null' : value ? 'true' : 'false'}`); continue; }
          if (op === 'in') { params.push(JSON.stringify(value)); where.push(`${ident(column)}::text in (select jsonb_array_elements_text($${params.length}::jsonb))`); continue; }
          params.push(value); where.push(`${ident(column)} ${op} $${params.length}`);
        }
        const order = query.orders.map(([c, asc]) => `${ident(c)} ${asc ? 'asc' : 'desc'}`).join(', ');
        const sql = `select coalesce(json_agg(t), '[]'::json) as rows from (select ${columns} from public.${ident(query.table)}`
          + (where.length ? ` where ${where.join(' and ')}` : '') + (order ? ` order by ${order}` : '')
          + (Number.isInteger(query.rowLimit) ? ` limit ${query.rowLimit}` : '') + `) t`;
        let rows = await this.#asCaller(user, headers, async tx => (await tx.query(sql, params)).rows[0].rows);
        if (query.one) {
          if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
          if (!rows.length && query.one === 'single') return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
          rows = rows[0] ?? null;
        }
        return { data: rows, error: null, status: 200 };
      } catch (error) { return failure(error); }
    });
  }
  async #asCaller(user, headers, work) {
    return this.db.transaction(async tx => {
      const service = user === 'service';
      const claims = service ? { role: 'service_role' } : user ? { sub: user.id, session_id: user.sessionId, role: 'authenticated', aud: 'authenticated', email: user.email } : { role: 'anon' };
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true), set_config('request.jwt.claim.sub', $3, true)`,
        [JSON.stringify(claims), JSON.stringify(headers ?? {}), service || !user ? '' : user.id]);
      await tx.exec(`set local role ${service ? 'service_role' : user ? 'authenticated' : 'anon'}`);
      // The Data API's pre-request hook (supabase/migrations/20261010270000_view_as_person.sql).
      await tx.query('select public.workspace_request_check()');
      return work(tx);
    });
  }
}
const failure = error => ({ data: null, error: { code: error.code ?? 'XX000', message: error.message, details: error.detail ?? null, hint: error.hint ?? null }, status: 400 });

// Creates a confirmed, signed-in, approved person (what sign-up + approval leave behind).
export async function createPerson(db, p, modules) {
  await db.query(`insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at, last_sign_in_at)
    values($1, $2, now() - interval '200 days', $3, now() - interval '200 days', now() - ($4 || ' hours')::interval)`, [p.id, p.email, JSON.stringify({ full_name: p.fullName }), String(1 + (p.n * 7) % 30)]);
  await db.query('insert into auth.sessions(id, user_id) values($1, $2)', [p.sessionId, p.id]);
  await db.query(`insert into private.workspace_approved_sessions(session_id, user_id, expires_at) values($1, $2, now() + interval '10 years')`, [p.sessionId, p.id]);
  await db.query(`update public.workspace_profiles set status = 'active', role = $2, full_name = $3, responsibilities = $4, created_at = now() - interval '200 days' where user_id = $1`, [p.id, p.role, p.fullName, p.responsibilities ?? '']);
  await db.query('delete from public.workspace_module_grants where user_id = $1', [p.id]);
  await db.query(`insert into public.workspace_module_grants(user_id, module_id) select $1, module_id from public.workspace_features where module_id = any($2::text[])`, [p.id, modules]);
}
