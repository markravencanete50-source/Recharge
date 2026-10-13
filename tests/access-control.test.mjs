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

test('only super admins get the Access control tool on Home', () => {
  assert.ok(homeToolsFor('super_admin', MODULE_IDS).some(t => t.key === 'access'));
  assert.ok(!homeToolsFor('admin', MODULE_IDS).some(t => t.key === 'access'));
  assert.deepEqual(homeToolsFor('super_admin', MODULE_IDS).find(t => t.key === 'access').target, { kind: 'work', view: 'management', sub: 'access', anchor: 'access-control' });
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
