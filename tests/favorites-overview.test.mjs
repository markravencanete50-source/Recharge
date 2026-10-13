import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Round 6, Lee: "the favorites feature should always be in the overview for easy access regardless of which
// role we have." Favorites is in every role's first section straight after Home, the menu order cannot move
// it out, and owners keep Favorites too: their own list, of things they can open.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { MENU_ROLES, applyMenuLayout, layoutOfPanel, moveItem, moveItemTo, phoneMoreGroups, orderPhoneBar, isLocked, LOCKED_LINKS } = await vite.ssrLoadModule('/lib/menu-layout.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const { phoneBarFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { buildSearchIndex, resolveFavorites, toggleFavorite } = await vite.ssrLoadModule('/lib/workspace-search.ts');
const panelOf = (role, layout, keepEmpty = false) => rolePanel(role, DEFAULT_ROLE_MODULES[role], layout, keepEmpty);
const first = panel => panel.groups[0];
const sectionOf = (panel, key) => panel.groups.find(g => g.links.some(l => l.key === key))?.key;
const source = path => readFileSync(path, 'utf8');

test('Favorites is in the first section, straight after Home, for all eight roles', () => {
  assert.equal(MENU_ROLES.length, 8);
  for (const role of MENU_ROLES) {
    const panel = panelOf(role);
    assert.deepEqual(first(panel).links.slice(0, 2).map(l => l.key), ['page:home', 'page:favorites'], role);
    assert.equal(panel.groups.flatMap(g => g.links).filter(l => l.key === 'page:favorites').length, 1, role + ': once');
    assert.ok(!(panel.groups.find(g => g.key === 'more')?.links ?? []).some(l => l.key === 'page:favorites'), role + ': not in More');
  }
  assert.deepEqual(MENU_ROLES.map(r => first(panelOf(r)).key), ['overview', 'overview', 'today', 'today', 'my-day', 'today', 'overview', 'your-properties']);
});

test('a saved layout cannot move Favorites out of its section', () => {
  assert.deepEqual(LOCKED_LINKS, ['page:favorites']);
  assert.ok(isLocked('page:favorites') && !isLocked('page:inbox'));
  for (const role of MENU_ROLES) {
    const own = first(panelOf(role)).key, elsewhere = panelOf(role).groups.find(g => g.key !== own).key;
    // Listed only under another section: back in its own one.
    const moved = panelOf(role, { sections: [], items: { [elsewhere]: ['page:favorites'] } });
    assert.equal(sectionOf(moved, 'page:favorites'), own, role);
    // Listed under both: its own section wins, whatever the order.
    const both = panelOf(role, { sections: [elsewhere, own], items: { [elsewhere]: ['page:favorites'], [own]: ['page:favorites', 'page:home'] } });
    assert.equal(sectionOf(both, 'page:favorites'), own, role);
    assert.equal(both.groups.find(g => g.key === own).links[0].key, 'page:favorites', role + ': it can move up within its section');
    // The editor's "Move to section" does nothing for it.
    const draft = panelOf(role, null, true);
    assert.deepEqual(moveItemTo(draft, 'page:favorites', elsewhere), draft, role);
    // Moving its section moves it too: the section keeps it wherever the section goes.
    const sectionLast = panelOf(role, { sections: [...panelOf(role).groups.map(g => g.key).filter(k => k !== own), own], items: {} });
    assert.equal(sectionOf(sectionLast, 'page:favorites'), own, role);
  }
  // Up and down within the section still works, and saving keeps it.
  const draft = moveItem(panelOf('stays', null, true), 'today', 'page:favorites', -1);
  assert.deepEqual(first(draft).links.map(l => l.key).slice(0, 2), ['page:favorites', 'page:home']);
  assert.deepEqual(applyMenuLayout(panelOf('stays'), layoutOfPanel(draft)), panelOf('stays', layoutOfPanel(draft)));
  assert.deepEqual(first(panelOf('stays', layoutOfPanel(draft))).links.map(l => l.key).slice(0, 2), ['page:favorites', 'page:home']);
});

test('the phone: Favorites is on the bar or at the top of the Menu', () => {
  for (const role of MENU_ROLES) {
    const panel = panelOf(role), bar = orderPhoneBar(phoneBarFor(role).slice(0, 5), panel);
    const onBar = bar.some(b => b.value === 'favorites');
    const menu = phoneMoreGroups(panel, bar);
    if (!onBar) assert.equal(menu[0].links[0].key, 'page:favorites', role + ': first in the Menu');
  }
});

test('owners have a Favorites page, and only what they can open resolves', () => {
  const owner = buildSearchIndex({ role: 'client', modules: DEFAULT_ROLE_MODULES.client, properties: [], work: [] });
  assert.ok(owner.some(e => e.key === 'section:favorites'));
  // An owner's saved list resolves against the owner's own index: a team page someone saved is not openable.
  const items = toggleFavorite(toggleFavorite([], { key: 'section:approvals', label: 'Approvals' }), { key: 'section:todo', label: 'To-do' });
  const resolved = resolveFavorites(items, owner);
  assert.equal(resolved.find(r => r.item.key === 'section:approvals').entry?.label, 'Approvals');
  assert.equal(resolved.find(r => r.item.key === 'section:todo').entry, null, 'kept with its label so it can be removed, but never opened');
  // And the app no longer holds Favorites back from owners.
  const ws = source('mobile/src/LiveWorkspace.tsx');
  assert.match(ws, /const favorites = useFavoritesStore\(!\(viewAs && !viewAs\.person\),/);
  assert.match(ws, /<FavoritesContext\.Provider value=\{favorites\}>/);
  // Round 6 (E's review): no floating Favorites star on phones any more; it is in the bar or first in the Menu.
  assert.doesNotMatch(ws, /FavoritesShortcut|showFavorites/);
  assert.doesNotMatch(ws, /favorites: \["super_admin"/, 'the Favorites page is for every role');
});

test('the menu order editor locks Favorites with a note', () => {
  const editor = source('mobile/src/MenuOrderEditor.tsx');
  assert.match(editor, /\{isLocked\(link\.key\) \? <Feather name="lock"/, 'no "Move to…" for it');
  assert.match(editor, /Favorites stays in \{group\.title\} for every role/);
  assert.match(editor, /moveItem\(d, group\.key, link\.key, -1\)/, 'up and down still offered');
});

// The database: owners keep their own list, like everyone else (no change was needed).
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['client', 'client', 'stays'];
const users = roles.map((_, i) => `77100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('7710', '7810');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `favo${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]); await db.exec('set role authenticated'); }
const read = async () => (await db.query('select public.workspace_favorites() r')).rows[0].r;
const save = async items => (await db.query('select public.workspace_save_favorites($1::jsonb) r', [JSON.stringify({ items })])).rows[0].r;
after(async () => { await db.close(); await vite.close(); });

test('owners pin and unpin their own favorites; nobody else sees them', async () => {
  await as(0);
  assert.deepEqual(await read(), []);
  const pinned = [{ key: 'section:approvals', label: 'Approvals' }, { key: 'property:7d0f3c2e-0000-4000-8000-000000000001', label: '2 Holmhead Place' }];
  assert.deepEqual(await save(pinned), pinned);
  assert.deepEqual(await read(), pinned);
  assert.deepEqual(await save(pinned.slice(1)), pinned.slice(1), 'unpinned');
  assert.deepEqual((await read()).map(i => i.key), [pinned[1].key]);
  await as(1);
  assert.deepEqual(await read(), [], 'another owner sees only their own');
  await as(2);
  assert.deepEqual(await read(), [], 'and so does the team');
  await db.exec('reset role'); await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from private.workspace_favorites'), /permission denied/);
  await db.exec('reset role');
});
