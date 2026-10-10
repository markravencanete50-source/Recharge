import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const admin = '10000000-0000-4000-8000-000000000002';
const staff = '10000000-0000-4000-8000-000000000003';
const ownerSession = '20000000-0000-4000-8000-000000000001';
const adminSession = '20000000-0000-4000-8000-000000000002';
const staffSession = '20000000-0000-4000-8000-000000000003';
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; grant usage on schema auth to authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
  create table auth.sessions (id uuid primary key, user_id uuid references auth.users, not_after timestamptz);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb); $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;
`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,'owner@example.com',now(),'{}'),($2,'admin@example.com',now(),'{}'),($3,'staff@example.com',now(),'{"role":"super_admin"}')`, [owner, admin, staff]);
await db.query(`insert into auth.sessions(id,user_id) values($1,$2),($3,$4),($5,$6)`, [ownerSession, owner, adminSession, admin, staffSession, staff]);
// Fixtures represent logins already approved by the password guard.
await db.query(`insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2),($3,$4),($5,$6)`, [ownerSession, owner, adminSession, admin, staffSession, staff]);
await db.query(`update public.workspace_profiles set role=case user_id when $1 then 'super_admin' when $2 then 'admin' else 'stays' end, status='active'`, [owner, admin]);
async function asUser(id, session) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({sub:id,session_id:session})]);
  await db.exec('set role authenticated');
}
const save = (email, role, status = 'active', modules = ['property-database']) => db.query('select public.workspace_save_access($1,$2,$3,$4,$5,$6)', [email, 'Test person', role, status, modules, 'Test responsibility']);

test('access hierarchy, RLS and session revocation execute in PostgreSQL', async t => {
  await t.test('editable metadata cannot assign a privileged role', async () => {
    await asUser(staff, staffSession);
    const result = await db.query('select public.workspace_account() account');
    assert.equal(result.rows[0].account.role, 'stays');
    assert.equal((await db.query('select count(*)::int n from public.workspace_profiles')).rows[0].n, 1);
    await assert.rejects(save('staff@example.com','super_admin'), /Admin access required/);
    await assert.rejects(db.query(`update public.workspace_profiles set role='super_admin'`), /permission denied/);
  });
  await t.test('regular admin cannot grant, edit or revoke another admin', async () => {
    await asUser(admin, adminSession);
    await assert.rejects(save('staff@example.com','admin'), /Only a super admin/);
    await assert.rejects(save('owner@example.com','client','revoked'), /Only a super admin/);
    await save('staff@example.com','stays');
  });
  await t.test('super admin grants custom tools, revokes immediately and restores access', async () => {
    await asUser(owner, ownerSession);
    await save('admin@example.com','admin','revoked');
    await asUser(admin, adminSession);
    await assert.rejects(db.query('select public.workspace_accounts()'), /Admin access required/);
    assert.equal((await db.query(`select private.has_workspace_module('property-database') allowed`)).rows[0].allowed, false);
    await asUser(owner, ownerSession); await save('admin@example.com','admin');
    await save('staff@example.com','stays','active',['property-database','guest-communication']);
    await asUser(staff, staffSession);
    const modules = (await db.query('select public.workspace_account() account')).rows[0].account.modules;
    assert.deepEqual(modules, ['guest-communication','property-database']);
    assert.equal((await db.query(`select private.has_workspace_module('licensing') allowed`)).rows[0].allowed,false);
  });
  await t.test('invalid grants roll back both the account and audit writes', async () => {
    await asUser(owner, ownerSession);
    // Same role, so the tools sent are checked (a new role brings that role's usual tools instead).
    await assert.rejects(save('staff@example.com','stays','active',['invented-module']), /check constraint/);
    await asUser(staff, staffSession);
    assert.equal((await db.query('select public.workspace_account() account')).rows[0].account.role, 'stays');
  });
  await t.test('last super admin cannot disable or demote their own account', async () => {
    await asUser(owner, ownerSession);
    await assert.rejects(save('owner@example.com','admin'), /Another super admin/);
    await assert.rejects(save('owner@example.com','super_admin','revoked'), /Another super admin/);
    await assert.rejects(db.query(`select public.workspace_request_access('Owner name','super_admin')`), /Invalid account request/);
  });
  await t.test('cleaning managers require an admin assignment and cleaners cannot receive team tools', async () => {
    await asUser(owner, ownerSession);
    await assert.rejects(save('staff@example.com','cleans','active',['cleaner-database']), /Cleaner access is limited/);
    await save('staff@example.com','cleaning_manager','active',['cleaner-database','cleaning-schedule']);
    await asUser(staff, staffSession);
    await assert.rejects(db.query("select public.workspace_request_access('Staff person','cleaning_manager')"), /Invalid account request/);
    await assert.rejects(db.query('select public.workspace_accounts()'), /Admin access required/);
    await asUser(owner, ownerSession);
    await save('staff@example.com','cleans','active',['cleaning-schedule','cleans-invoices']);
    await asUser(staff, staffSession);
    assert.equal((await db.query("select private.has_workspace_module('cleaner-database') allowed")).rows[0].allowed, false);
  });
  await t.test('a logged-out JWT cannot access privileged RPCs or module grants', async () => {
    await db.exec('reset role'); await db.query('delete from auth.sessions where id=$1', [ownerSession]);
    await asUser(owner, ownerSession);
    await assert.rejects(db.query('select public.workspace_accounts()'), /Admin access required/);
    await assert.rejects(save('staff@example.com','admin'), /Verified sign-in required/);
    assert.equal((await db.query(`select private.has_workspace_module('licensing') allowed`)).rows[0].allowed, false);
  });
  await t.test('anonymous callers cannot invoke access endpoints', async () => {
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select public.workspace_accounts()'), /permission denied/);
  });
  await t.test('all exposed functions are invokers and all tables use RLS', async () => {
    await db.exec('reset role');
    assert.equal((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`)).rows[0].n,0);
    assert.equal((await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows[0].n,0);
    assert.ok((await db.query(`select count(*)::int n from public.workspace_access_events where event_type='tool_access_changed'`)).rows[0].n >= 4);
  });
  await db.close();
});
