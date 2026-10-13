// Lead developer's tool: proves supabase/install-pending.sql is the same as applying the migration files one by one.
// Builds two in-memory databases (PGlite): every migration before <prefix>, then (a) the bundle, (b) the files.
// Compares every function body and policy, checks each migration is recorded, and that a second run stops at the guard.
// Usage: node scripts/lead/check-install.mjs <version prefix> [bundle path]   e.g. 20261016
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const repo = process.cwd();
const [prefix, bundle = 'supabase/install-pending.sql'] = process.argv.slice(2);
if (!prefix) { console.error('usage: check-install.mjs <prefix> [bundle]'); process.exit(1); }
const require = createRequire(repo + '/package.json');
const {PGlite} = await import(require.resolve('@electric-sql/pglite'));
const boot = `set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text,idempotency_key text,rollback text[]);`;
const files = (await fs.readdir(repo + '/supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
const read = f => fs.readFile(repo + '/supabase/migrations/' + f, 'utf8');
async function build(useBundle) {
  const db = new PGlite(); await db.exec(boot);
  for (const f of files.filter(f => f < prefix)) await db.exec(await read(f));
  if (useBundle) await db.exec(await fs.readFile(path.resolve(repo, bundle), 'utf8'));
  else for (const f of files.filter(f => f.startsWith(prefix))) await db.exec(await read(f));
  return db;
}
const fp = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' f, md5(replace(p.prosrc,chr(13),'')) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') order by 1`;
const pol = `select tablename||'.'||policyname f, md5(replace(coalesce(qual,'')||'|'||coalesce(with_check,''),chr(13),'')) h from pg_policies order by 1`;
const a = await build(true), b = await build(false);
const rows = (await a.query(`select version from supabase_migrations.schema_migrations where version like '${prefix}%' order by 1`)).rows;
console.log('recorded', rows.length, rows.map(r => r.version).join(','));
let again = 'no error'; try { await a.exec(await fs.readFile(path.resolve(repo, bundle), 'utf8')); } catch (e) { again = e.message; await a.exec('rollback'); }
console.log('second run:', again);
for (const q of [fp, pol]) {
  const x = (await a.query(q)).rows, y = (await b.query(q)).rows, m = new Map(y.map(r => [r.f, r.h]));
  const diff = x.filter(r => m.get(r.f) !== r.h).map(r => r.f);
  console.log(q === fp ? 'functions' : 'policies', x.length, 'vs', y.length, 'differences:', diff.length, diff.slice(0, 5).join(' '));
}
