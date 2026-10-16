import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Access control on the screen: what each request may carry, labels, grouping and search.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { adminActionSchema, adminReadSchema } = await vite.ssrLoadModule('/lib/workspace-admin-policy.ts');
const { accessState, accessSummary, eventLabel, lastSeen, matchesSearch, toolGroups } = await vite.ssrLoadModule('/lib/access-control.ts');
const { MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { homeToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
after(() => vite.close());
const id = '11111111-1111-4111-8111-111111111111';

test('access requests are strict', () => {
  assert.ok(adminReadSchema.safeParse({ section: 'accessControl' }).success);
  assert.ok(adminActionSchema.safeParse({ action: 'setAccess', userId: id, role: 'stays', modules: ['listing-health'] }).success);
  for (const action of ['block', 'unblock', 'signOut', 'revokePassword']) assert.ok(adminActionSchema.safeParse({ action, userId: id }).success, action);
  assert.ok(adminActionSchema.safeParse({ action: 'deleteAccount', userId: id, confirm: true }).success);
  assert.ok(!adminActionSchema.safeParse({ action: 'deleteAccount', userId: id }).success, 'deleting needs a confirmation');
  assert.ok(!adminActionSchema.safeParse({ action: 'block', userId: id, reason: 'extra' }).success, 'no unexpected fields');
  assert.ok(!adminActionSchema.safeParse({ action: 'setAccess', userId: id, role: 'owner', modules: [] }).success, 'only real roles');
});

test('states, labels, search and grouping', () => {
  assert.equal(accessState({ status: 'revoked', closed: false }), 'blocked');
  assert.equal(accessState({ status: 'revoked', closed: true }), 'deleted');
  assert.equal(eventLabel('password_revoked'), 'Password revoked');
  assert.equal(eventLabel('something_new'), 'Something new');
  const now = new Date('2026-10-08T12:00:00Z');
  assert.equal(lastSeen(null, now), 'Never signed in');
  assert.equal(lastSeen('2026-10-08T11:30:00Z', now), 'Signed in 30 minutes ago');
  assert.equal(lastSeen('2026-10-06T12:00:00Z', now), 'Signed in 2 days ago');
  const person = { fullName: 'Fiona MacLeod', email: 'fiona@example.com', phone: null, role: 'client', status: 'active', closed: false, activeSessions: 1 };
  assert.ok(matchesSearch(person, 'macleod') && matchesSearch(person, 'CLIENT') && !matchesSearch(person, 'glasgow'));
  assert.deepEqual(accessSummary([person, { ...person, status: 'revoked', activeSessions: 0 }, { ...person, closed: true }]), { people: 2, active: 1, waiting: 0, blocked: 1, signedIn: 1, online: 0 });
  const grouped = toolGroups().flatMap(g => g.tools.map(t => t.id)).sort();
  assert.deepEqual(grouped, [...MODULE_IDS].sort(), 'every tool appears once in a group');
});

test('admins and super admins get the Access control tool on Home, nobody else', () => {
  for (const role of ['super_admin', 'admin']) {
    assert.ok(homeToolsFor(role, MODULE_IDS).some(t => t.key === 'access'), role);
    assert.deepEqual(homeToolsFor(role, MODULE_IDS).find(t => t.key === 'access').target, { kind: 'work', view: 'management', sub: 'access', anchor: 'access-control' });
  }
  assert.deepEqual(homeToolsFor('super_admin', MODULE_IDS).map(t => t.key), homeToolsFor('admin', MODULE_IDS).map(t => t.key), 'the same tiles, in the same order');
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client']) assert.ok(!homeToolsFor(role, MODULE_IDS).some(t => t.key === 'access'), role);
});

test('what an admin may do in Access control, in plain words', async () => {
  const { accessRefusal, rolesFor } = await vite.ssrLoadModule('/lib/admin-live.ts');
  const { ROLE_SUMMARY } = await vite.ssrLoadModule('/lib/access-control.ts');
  const below = ['stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'];
  // Super admins: everything, as before.
  for (const role of [...below, 'admin', 'super_admin']) for (const act of ['change', 'add', 'delete']) assert.equal(accessRefusal('super_admin', role, act), null, `super admin ${act} ${role}`);
  // Admins: accounts below admin, never admin accounts, never deleting.
  for (const role of below) { assert.equal(accessRefusal('admin', role), null, role); assert.equal(accessRefusal('admin', role, 'add'), null, role); }
  for (const role of ['admin', 'super_admin']) {
    assert.equal(accessRefusal('admin', role), 'Only a super admin can change admin accounts');
    assert.equal(accessRefusal('admin', role, 'add'), 'Only a super admin can add admin accounts');
  }
  assert.equal(accessRefusal('admin', 'stays', 'delete'), 'Only a super admin can delete accounts');
  for (const role of below) assert.ok(accessRefusal(role, 'client'), role + ' is refused');
  // The role pickers offer an admin only the roles below admin.
  assert.deepEqual(rolesFor('admin'), below);
  assert.match(ROLE_SUMMARY.admin, /Access control for everyone below admin/);
  assert.match(ROLE_SUMMARY.super_admin, /admin accounts, deleting accounts and the menu order/);
});

test('changing a role shows what the person will see', async () => {
  const { roleChange, ROLE_SUMMARY } = await vite.ssrLoadModule('/lib/access-control.ts');
  const { ROLE_LABEL, toolsOnRoleChange, rolesFor } = await vite.ssrLoadModule('/lib/admin-live.ts');
  const label = r => ROLE_LABEL[r];
  for (const r of rolesFor('super_admin')) assert.ok(ROLE_SUMMARY[r], r + ' has a summary');
  const up = roleChange({ role: 'cleaning_manager', properties: 3 }, 'admin', [], label);
  assert.equal(up.promote, true); assert.equal(up.action, 'Promote to Admin');
  assert.deepEqual(up.views, ['Management', 'Guest relations', 'Client relations', 'Calendar', 'Cleans', 'Maintenance', 'Accounts', 'All work'], 'the same Work views as every admin');
  assert.deepEqual(up.homeTools, homeToolsFor('admin', MODULE_IDS).map(t => t.label), 'the same Home tools as every admin');
  assert.equal(up.properties, 'They see every property.');
  const side = roleChange({ role: 'cleans', properties: 1 }, 'stays', toolsOnRoleChange('stays'), label);
  assert.equal(side.promote, false); assert.equal(side.action, 'Change to Stays'); assert.equal(side.properties, 'Their 1 property stays assigned to them.');
  assert.match(roleChange({ role: 'client', properties: 2 }, 'stays', [], label).properties, /2 properties will be unassigned/);
  assert.match(roleChange({ role: 'admin', properties: 0 }, 'client', [], label).properties, /no properties yet/);
  assert.equal(roleChange({ role: 'stays', properties: 0 }, 'stays', [], label).same, true);
  assert.equal(eventLabel('role_changed'), 'Role changed');
});

test('the screens show admins Access control, hide the Menu order and what they cannot do', async () => {
  const { readFileSync } = await import('node:fs');
  const management = readFileSync('mobile/src/LiveManagement.tsx', 'utf8');
  assert.match(management, /\(v !== "access" \|\| isWorkspaceAdmin\(account\.role\)\)/, 'the Access control card is for admins and super admins');
  assert.doesNotMatch(management, /v !== "access" \|\| account\.role === "super_admin"/);
  const screen = readFileSync('mobile/src/LiveAccessControl.tsx', 'utf8');
  assert.match(screen, /if \(!isWorkspaceAdmin\(account\.role\)\) return <Notice text="Access control is for admins\." p=\{p\} \/>;/);
  assert.doesNotMatch(screen, /Access control is for super admins/);
  // The Menu order tab and page are the super admin's alone.
  assert.match(screen, /const tabs = superAdmin \? <Pills/);
  assert.match(screen, /if \(tab === "menu" && superAdmin\) return/);
  // Role pickers offer only the roles the person may give; nothing hard-codes the super admin's list.
  assert.doesNotMatch(screen, /rolesFor\("super_admin"\)/);
  assert.match(screen, /rolesFor\(actor\.role\)/);
  assert.match(screen, /rolesFor\(actorRole\)/);
  // An admin opening an admin or super admin sees why, not the controls; delete is hidden from admins.
  assert.match(screen, /const refusal = self \? null : accessRefusal\(actor\.role, person\.role\)/);
  assert.match(screen, /!!refusal && <Notice text=\{`\$\{refusal\}\.`\}/);
  assert.match(screen, /!self && state !== "deleted" && !refusal && <>/);
  assert.match(screen, /\.filter\(d => d !== "deleteAccount" \|\| canDelete\)/);
  assert.match(screen, /Only a super admin can add an admin or super admin\./);
});
