import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Menu order per role (migration 20261015210000): one row per role, everyone reads only their own role's
// order, only super admins save or reset it (with a version check), and every change is in the access history.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { storedMenuLayoutSchema, parseMenuLayout } = await vite.ssrLoadModule('/lib/menu-layout.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const MIGRATION = '20261015210000_menu_layouts.sql';
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'];
const users = roles.map((_, i) => `97720000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, MANAGER, CLEANER, READY, ACCOUNTS, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9772', '9872');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `menu${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Kirsty', 'Isla', 'Ross', 'Graham', 'Owner'][i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const read = section => rpc('workspace_teams_read', [section, null, null, null, null]);
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const ORDER = { sections: ['calendar-messages', 'today', 'more'], items: { today: ['page:todo', 'page:home'], more: ['page:favorites'] } };
after(async () => { await db.close(); await vite.close(); });

test('everyone reads only their own role\'s order, and only order data', async () => {
  for (let i = 0; i < roles.length; i++) {
    await as(i);
    const mine = await read('menuLayout');
    assert.deepEqual(mine, { role: roles[i], sections: [], items: {}, version: 0 }, roles[i]);
  }
  for (const i of [ADMIN, STAYS, OWNER, ACCOUNTS]) { await as(i); await assert.rejects(read('menuLayouts'), /Only super admins/, roles[i]); }
  await as(SUPER);
  const all = (await read('menuLayouts')).map(l => storedMenuLayoutSchema.parse(l));
  assert.deepEqual(all.map(l => l.role), roles);
});

test('only super admins save or reset, with a version check', async () => {
  for (const i of [ADMIN, STAYS, MANAGER, CLEANER, READY, ACCOUNTS, OWNER]) {
    await as(i);
    await assert.rejects(act({ action: 'saveMenuLayout', role: 'stays', version: 0, ...ORDER }), /Only super admins can change the menu order/, roles[i]);
    await assert.rejects(act({ action: 'resetMenuLayout', role: roles[i], version: 0 }), /Only super admins can change the menu order/, roles[i]);
  }
  await as(SUPER);
  const saved = storedMenuLayoutSchema.parse(await act({ action: 'saveMenuLayout', role: 'stays', version: 0, ...ORDER }));
  assert.deepEqual([saved.version, saved.sections, saved.items, saved.updatedByName], [1, ORDER.sections, ORDER.items, 'Sam']);
  await assert.rejects(act({ action: 'saveMenuLayout', role: 'stays', version: 0, ...ORDER }), /Changed by someone else/, 'a stale version is refused');
  // Guest relations staff get it on their next read; the owner still has the default.
  await as(STAYS);
  const mine = await read('menuLayout');
  assert.deepEqual(mine, { role: 'stays', ...ORDER, version: 1 });
  assert.equal('updatedByName' in mine, false, 'no names for anyone but super admins');
  assert.deepEqual(parseMenuLayout(mine), ORDER);
  await as(OWNER);
  assert.deepEqual((await read('menuLayout')).sections, []);
  // Reset goes back to the default (empty) order and moves the version on.
  await as(SUPER);
  const reset = storedMenuLayoutSchema.parse(await act({ action: 'resetMenuLayout', role: 'stays', version: 1 }));
  assert.deepEqual([reset.version, reset.sections, reset.items], [2, [], {}]);
});

test('the database refuses keys that are not stable keys, and repeats', async () => {
  await as(SUPER);
  const raw = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), action: 'saveMenuLayout', role: 'ready', version: 0, ...input }]);
  await assert.rejects(raw({ sections: ['Overview'], items: {} }), /Invalid menu order/);
  await assert.rejects(raw({ sections: ['more', 'more'], items: {} }), /Invalid menu order/);
  await assert.rejects(raw({ sections: [], items: { more: ['page:home', 'page:home'] } }), /Invalid menu order/);
  await assert.rejects(raw({ sections: [], items: { 'Bad key': [] } }), /Invalid menu order/);
  await assert.rejects(raw({ sections: [], items: {}, extra: true }), /./, 'no other fields');
  await assert.rejects(rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), action: 'saveMenuLayout', role: 'nobody', version: 0, sections: [], items: {} }]), /Choose a role/);
  assert.equal((await owner("select count(*)::int n from private.workspace_menu_layouts where role='ready'"))[0].n, 0, 'nothing saved');
});

test('every change is in the access history, and a retried request is answered once', async () => {
  await as(SUPER);
  const requestId = crypto.randomUUID();
  const input = teamsActionSchema.parse({ action: 'saveMenuLayout', requestId, role: 'client', version: 0, sections: ['more', 'your-properties'], items: {} });
  const first = await rpc('workspace_teams_action', [input]);
  assert.deepEqual(await rpc('workspace_teams_action', [input]), first, 'the same answer for a retry');
  const events = await owner("select user_id,actor_id,event_type,old_access,new_access from public.workspace_access_events where event_type like 'menu_order_%' order by id");
  assert.deepEqual(events.map(e => [e.event_type, e.new_access.role]), [['menu_order_saved', 'stays'], ['menu_order_reset', 'stays'], ['menu_order_saved', 'client']]);
  for (const e of events) assert.deepEqual([e.user_id, e.actor_id], [users[SUPER], users[SUPER]]);
  assert.deepEqual(events[1].old_access, { role: 'stays', ...ORDER }, 'the old order is kept');
  // The access history read shows them, named after the super admin who changed them.
  const history = await rpc('workspace_admin_read', ['accessHistory']);
  const shown = history.filter(h => h.event.startsWith('menu_order_'));
  assert.equal(shown.length, 3);
  assert.deepEqual([shown[0].actor, shown[0].target, shown[0].detail.role], ['Sam', 'Sam', 'client']);
});

test('the migration runs twice without change', async () => {
  const patched = ['private.workspace_teams_read(text,date,date,uuid,uuid)', 'private.workspace_teams_action(jsonb)'];
  const defs = async () => Promise.all(patched.map(async f => (await owner('select pg_get_functiondef($1::regprocedure) d', [f]))[0].d));
  const before = await defs();
  await db.exec('reset role');
  await db.exec(await fs.readFile('supabase/migrations/' + MIGRATION, 'utf8'));
  assert.deepEqual(await defs(), before);
  const [read] = await defs();
  assert.equal(read.split("section='menuLayout'").length - 1, 1, 'the route is there once');
  assert.equal((await owner('select count(*)::int n from private.workspace_menu_layouts'))[0].n, 2, 'the saved orders are kept');
});
