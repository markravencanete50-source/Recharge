import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Fixes from the end-to-end check of every role: the full work list, giving a team member
// every property at once, closing invoice handovers, and the per-request sign-in check.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { adminActionSchema } = await vite.ssrLoadModule('/lib/workspace-admin-policy.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { operationViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'cleaning_manager', 'client'];
const users = roles.map((_, i) => `95000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9500', '9600');
const [SUPER, MANAGER, CLIENT] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `audit${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Audit ${i}`]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,m from unnest(array['cleaning-schedule','cleaner-performance','clean-reporting']) m", [users[MANAGER]]);
async function as(i, sessionId = session(i)) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: sessionId })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const today = (await db.query('select current_date::text d')).rows[0].d;
const plus = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('the work list returns every open item, not only the 100 most recent', async () => {
  // 130 back-to-back stays: one checkout clean each.
  const reservations = Array.from({ length: 130 }, (_, i) => ({ id: String(7000 + i), listingId: '801', checkIn: plus(2 * i), checkOut: plus(2 * i + 1), status: 'confirmed', channel: 'airbnb', channelReference: 'HM' + i, guests: 2, payoutMinor: 10000 }));
  await asBackend();
  const result = await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', listings: [{ id: '801', name: 'Audit Flat', address: '1 Audit Street', bedrooms: 2 }, { id: '802', name: 'Audit Cottage', address: '', bedrooms: 1 }], reservations }]);
  assert.equal(result.newCleans, 130);
  await as(SUPER);
  const work = (await rpc('workspace_operations_read', [null])).map(item => operationViewSchema.parse(item));
  assert.equal(work.filter(item => item.kind === 'cleaning').length, 130);
});

test('an admin gives a team member every property in one step', async () => {
  // Hostaway properties start with nobody assigned, so the manager sees none of their cleans.
  await as(MANAGER);
  assert.equal((await rpc('workspace_operations_read', [null])).length, 0);
  await as(MANAGER);
  await assert.rejects(rpc('workspace_admin_action', [adminActionSchema.parse({ action: 'assignAllProperties', userId: users[MANAGER] })]), /Admin access required/);
  await as(SUPER);
  const first = await rpc('workspace_admin_action', [adminActionSchema.parse({ action: 'assignAllProperties', userId: users[MANAGER] })]);
  assert.equal(first.added, 2);
  assert.equal((await rpc('workspace_admin_action', [{ action: 'assignAllProperties', userId: users[MANAGER] }])).added, 0, 'running it again adds nothing');
  await assert.rejects(rpc('workspace_admin_action', [{ action: 'assignAllProperties', userId: users[CLIENT] }]), /Owners are given their own properties/);
  await assert.rejects(rpc('workspace_admin_action', [{ action: 'assignAllProperties', userId: users[SUPER] }]), /Admins already see every property/);
  await as(MANAGER);
  assert.equal((await rpc('workspace_operations_read', [null])).filter(item => item.kind === 'cleaning').length, 130);
  const rows = (await db.query("select assignment from public.workspace_property_assignments where user_id=$1", [users[MANAGER]])).rows;
  assert.deepEqual([...new Set(rows.map(row => row.assignment))], ['cleaning_manager']);
});

test('invoice handovers for Accounts can be completed with evidence', async () => {
  await as(SUPER);
  const [property] = (await db.query("select id from public.workspace_properties where hostaway_listing_id='801'")).rows;
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[SUPER], session_id: session(SUPER) })]);
  const workId = (await db.query("select private.workspace_handover($1,'cleans-invoices','Invoice accepted property clean','cleaning_invoice','{}'::jsonb) id", [property.id])).rows[0].id;
  await as(SUPER);
  const item = (await rpc('workspace_operations_read', [property.id])).find(op => op.workId === workId);
  const action = operationsActionSchema.parse({ action: 'updateOperation', requestId: crypto.randomUUID(), workId, version: item.version, step: 'completeHandover', data: { evidence: 'Invoice CL-1042 issued to the cleaner and recorded.' } });
  await rpc('workspace_operations_action', [action]);
  const status = (await db.query('select status from public.workspace_work_items where id=$1', [workId])).rows[0].status;
  assert.equal(status, 'completed');
});

test('a remembered sign-in check never carries over to a forged session or another person', async () => {
  await db.exec('reset role');
  await db.exec('begin');
  try {
    await as(SUPER);
    assert.equal((await db.query('select private.workspace_actor_role() r')).rows[0].r, 'super_admin');
    await as(SUPER, '96000000-0000-4000-8000-000000000999');
    assert.equal((await db.query('select private.workspace_actor_role() r')).rows[0].r, null, 'a forged session id is refused');
    await as(MANAGER, session(SUPER));
    assert.equal((await db.query('select private.workspace_actor_role() r')).rows[0].r, null, "another person's session is refused");
    await as(MANAGER);
    assert.equal((await db.query('select private.workspace_actor_role() r')).rows[0].r, 'cleaning_manager');
  } finally { await db.exec('reset role'); await db.exec('commit'); }
  // Revoking the session takes effect on the next request.
  await db.query('delete from private.workspace_approved_sessions where session_id=$1', [session(MANAGER)]);
  await as(MANAGER);
  assert.equal((await db.query('select private.workspace_actor_role() r')).rows[0].r, null);
});
