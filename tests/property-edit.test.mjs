import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// "Edit name and address" on a property in Properties (Alex): who sees it, the form it opens, the checks before anything is
// sent and the request the server accepts. The database side is in property-edit-database.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { canEditPropertyDetails, propertyEditForm, propertyEditIssues } = await vite.ssrLoadModule('/lib/property-edit.ts');
const { portfolioActionSchema, PROPERTY_NAME_MAX, PROPERTY_ADDRESS_MAX } = await vite.ssrLoadModule('/lib/portfolio-policy.ts');
const pages = readFileSync('mobile/src/LivePages.tsx', 'utf8');
const P = '00000000-0000-4000-8000-000000000001', R = '00000000-0000-4000-8000-000000000002';
const property = { id: P, name: 'Leith flat', address: '1 Shore, Leith EH6', version: 4 };

test('admins and super admins see the button; Stays with the property tool; nobody else', () => {
  const all = ['property-database'];
  assert.equal(canEditPropertyDetails({ role: 'admin', modules: [] }), true);
  assert.equal(canEditPropertyDetails({ role: 'super_admin', modules: [] }), true);
  assert.equal(canEditPropertyDetails({ role: 'stays', modules: all }), true);
  assert.equal(canEditPropertyDetails({ role: 'stays', modules: [] }), false);
  for (const role of ['client', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.equal(canEditPropertyDetails({ role, modules: all }), false, role);
});

test('the form opens with the property\'s name and address and sends the version it was opened at', () => {
  const form = propertyEditForm(property);
  assert.equal(form.endpoint, 'portfolio');
  assert.equal(form.title, 'Edit name and address');
  assert.deepEqual(form.fields.map(f => [f.name, f.required, f.defaultValue]), [['name', true, 'Leith flat'], ['address', true, '1 Shore, Leith EH6']]);
  const body = form.build({ name: '  Leith shore flat ', address: ' 1 Shore, Leith EH6 6QW ' }, R);
  assert.deepEqual(body, { action: 'saveNameAddress', requestId: R, propertyId: P, version: 4, name: 'Leith shore flat', address: '1 Shore, Leith EH6 6QW' });
  assert.equal(portfolioActionSchema.safeParse(body).success, true);
  assert.doesNotMatch(JSON.stringify(form), /—/, 'no em dashes');
});

test('a name of 2 to 200 characters and an address are needed, here and on the server', () => {
  assert.deepEqual(propertyEditIssues({ name: 'Leith flat', address: '1 Shore' }), []);
  assert.deepEqual(propertyEditIssues({ name: ' A ', address: '  ' }).map(i => i.field), ['name', 'address']);
  assert.deepEqual(propertyEditIssues({ name: 'x'.repeat(PROPERTY_NAME_MAX + 1), address: 'x'.repeat(PROPERTY_ADDRESS_MAX + 1) }).map(i => i.field), ['name', 'address']);
  assert.equal(PROPERTY_NAME_MAX, 200);
  assert.equal(PROPERTY_ADDRESS_MAX, 1000);
  const send = over => portfolioActionSchema.safeParse({ action: 'saveNameAddress', requestId: R, propertyId: P, version: 4, name: 'Leith flat', address: '1 Shore', ...over });
  assert.equal(send({ name: ' A ' }).success, false);
  assert.equal(send({ address: '   ' }).success, false);
  assert.equal(send({ name: 'x'.repeat(201) }).success, false);
  assert.equal(send({ version: undefined }).success, false);
  assert.equal(send({ region: 'Fife' }).success, false, 'only the name and address');
});

test('the button sits on each property in Properties, for the table and the sheet, and closes the sheet first', () => {
  assert.match(pages, /import \{ canEditPropertyDetails, propertyEditForm \} from "\.\.\/\.\.\/lib\/property-edit";/);
  const more = pages.slice(pages.indexOf('const moreFor = (property: PropertyView) =>'), pages.indexOf('title={account.role === "client" ? "Your properties"'));
  assert.match(more, /\{canEditPropertyDetails\(account\) && <SoftButton label="Edit name and address" icon="edit-3" palette=\{p\} onPress=\{\(\) => openForm\(propertyEditForm\(property\)\)\} \/>\}/);
  // moreFor is the shared detail for the staff table and the card sheet.
  assert.match(pages, /extra=\{property => <>\{journeyBlock\(property\)\}\{moreFor\(property\)\}<\/>\}/);
  assert.match(pages, /\{moreFor\(selected\)\}/);
});
