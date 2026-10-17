import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Furnishing Studio in the app: the quantity rules, the money, the two documents, the request shapes, and who is offered
// it (the Stays team and management only, on the web and the phone). The database side is in
// furnishing-studio-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const s = await vite.ssrLoadModule('/lib/furnishing-studio.ts');
const docs = await vite.ssrLoadModule('/lib/furnishing-documents.ts');
const subs = await vite.ssrLoadModule('/lib/relations-subs.ts');
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const tools = await vite.ssrLoadModule('/lib/home-tools.ts');
const panel = await vite.ssrLoadModule('/lib/role-panel.ts');
const policy = await vite.ssrLoadModule('/worker/backend-route-policy.ts');
after(() => vite.close());
const read = file => fs.readFile(file, 'utf8');

let n = 0;
const item = (over) => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, code: null, name: 'Thing ' + n, category: 'bedroom', unit: 'each', packSize: 1, costCapPence: 1000,
  retailPricePence: null, supplier: 'IKEA', productUrl: null, rule: { basis: 'fixed', per: 1, when: null }, stepPence: 0, active: true, sortOrder: n, version: 1, updatedAt: '2026-10-17T10:00:00Z', updatedBy: null, ...over });
const inputs = over => s.normaliseInputs({ ...s.DEFAULT_INPUTS, ...over });

test('the quantity rules: beds, zip & link primary setups, linen rotations, pillows, conditions and rounding up', () => {
  const i = inputs({ bedrooms: 3, guests: 6, singleBeds: 1, doubleBeds: 1, sofaBeds: 1, zipLinkBeds: 2, zipLinkSetups: ['double', 'twin'] });
  assert.equal(s.basisValue(i, 'bed'), 5);
  // Linen: three rotations for each bed's primary setup, one for the secondary (Twin is two single sets a rotation).
  assert.equal(s.basisValue(i, 'kingSets'), 3 + 1, 'double primary: 3 king sets; twin primary: 1 king set');
  assert.equal(s.basisValue(i, 'singleSets'), 3 * 1 + 2 * (1 + 3), 'the single bed, then 2 singles per rotation for each zip & link');
  assert.equal(s.basisValue(i, 'doubleSets'), 3 * 2);
  assert.equal(s.basisValue(i, 'pillow'), 2 * 2 + 4 * 3);
  assert.equal(s.ruleQuantity({ basis: 'guest', per: 0.5, when: null }, inputs({ guests: 5 })), 3, 'rounded up');
  assert.equal(s.ruleQuantity({ basis: 'bedroom', per: 1.1, when: null }, inputs({ bedrooms: 10 })), 11, 'no floating point drift');
  assert.equal(s.ruleQuantity({ basis: 'fixed', per: 1, when: 'garden' }, inputs({ garden: false })), 0);
  assert.equal(s.ruleQuantity({ basis: 'fixed', per: 1, when: 'cookerNotInduction' }, inputs({ cooker: 'gas' })), 1);
  assert.equal(s.ruleQuantity({ basis: 'fixed', per: 1, when: 'noDishwasher' }, inputs({ dishwasher: true })), 0);
  assert.equal(s.ruleLine({ basis: 'window', per: 2, when: 'curtains' }), '2 per window, with curtains');
  // Inputs are cleaned: counts in range, one setup per zip & link bed.
  const clean = s.normaliseInputs({ ...s.DEFAULT_INPUTS, bedrooms: 99, zipLinkBeds: 2, zipLinkSetups: ['twin'] });
  assert.equal(clean.bedrooms, 12);
  assert.deepEqual(clean.zipLinkSetups, ['twin', 'double']);
  assert.deepEqual(s.COUNT_INPUTS.map(c => c.key), [...s.COUNT_KEYS]);
});

test('the estimate: rules, fine-tuning, stock deducted in whole packs, labour per bedroom, markup, fee and VAT', () => {
  const towels = item({ name: 'Towels', category: 'linen', unit: 'pack of 4', packSize: 4, costCapPence: 2000, retailPricePence: 2500, rule: { basis: 'guest', per: 2, when: null }, productUrl: 'https://example.com/t' });
  const labour = item({ name: 'Labour', category: 'labour', costCapPence: 45000, stepPence: 25000, rule: { basis: 'fixed', per: 1, when: null } });
  const unused = item({ name: 'Hammock', rule: { basis: 'fixed', per: 1, when: 'garden' } });
  const retired = item({ name: 'Old lamp', active: false });
  const i = inputs({ bedrooms: 3, guests: 6 });
  const lines = s.estimateLines([towels, labour, unused, retired], i, { [towels.id]: { units: 13, existing: 2 } }, { markupPercent: 12.5 });
  assert.deepEqual(lines.map(l => l.name), ['Towels', 'Labour'], 'nothing needed and not in use are left out');
  const t = lines[0];
  assert.deepEqual([t.suggestedUnits, t.units, t.existingUnits, t.packs], [12, 13, 2, 3], '11 towels to buy is 3 packs of 4');
  assert.deepEqual([t.costPence, t.pricePence], [3 * 2000, 3 * s.markedUp(2500, 12.5)]);
  assert.equal(s.markedUp(2500, 12.5), 2813, 'halves up to the penny');
  assert.equal(lines[1].unitCostPence, 45000 + 2 * 25000, 'labour: the one-bedroom cap plus GBP 250 for each extra bedroom');
  assert.equal(s.estimateLines([labour], inputs({ bedrooms: 0 }), {}, { markupPercent: 0 })[0].unitCostPence, 45000, 'a studio counts as one bedroom');
  const totals = s.estimateTotals(lines, { markupPercent: 12.5, feePence: 15000, vat: true });
  assert.equal(totals.estimatePence, 6000 + 95000);
  assert.equal(totals.netPence, totals.subtotalPence + 15000);
  assert.equal(totals.vatPence, Math.floor((totals.netPence * 20 + 50) / 100));
  assert.equal(totals.quotePence, totals.netPence + totals.vatPence);
  assert.deepEqual([totals.toPurchase, totals.shoppingLines, totals.linkedLines], [4, 2, 1]);
  assert.deepEqual(s.headerStats(totals).map(x => x.label), ['Maximum estimate', 'To purchase', 'Shopping links']);
  // Stock can never be more than what is needed; quantities are capped.
  const capped = s.estimateLines([towels], i, { [towels.id]: { units: 3, existing: 9 } }, { markupPercent: 0 })[0];
  assert.deepEqual([capped.existingUnits, capped.packs], [3, 0]);
  assert.equal(s.clampUnits(1e9), s.MAX_UNITS);
  // A saved project brings its fine-tuning back.
  assert.deepEqual(s.overridesFrom([{ itemId: 'a', units: 5, suggestedUnits: 4, existingUnits: 0 }, { itemId: 'b', units: 2, suggestedUnits: 2, existingUnits: 1 }, { itemId: 'c', units: 1, suggestedUnits: 1, existingUnits: 0 }]),
    { a: { units: 5 }, b: { existing: 1 } });
  assert.equal(s.poundsToPence('12.5'), 1250);
  assert.equal(s.poundsToPence('12.555'), null);
  assert.equal(s.penceToPounds(1250), '12.50');
});

test('statuses move only the way the database allows, and only a draft is edited', () => {
  assert.deepEqual(s.NEXT_STATUS, { draft: ['sent'], sent: ['accepted', 'declined', 'draft'], declined: ['draft'], accepted: ['purchasing'], purchasing: ['complete'], complete: [] });
  assert.deepEqual(s.PROJECT_STATUSES.filter(s.editable), ['draft']);
  assert.deepEqual(s.PROJECT_STATUSES.filter(s.buying), ['accepted', 'purchasing', 'complete']);
});

test('the request shapes: reads by section, analytics up to two years, strict actions', () => {
  assert.equal(s.furnishingReadSchema.safeParse({ section: 'catalogue' }).success, true);
  assert.equal(s.furnishingReadSchema.safeParse({ section: 'project' }).success, false, 'a project needs its id');
  assert.equal(s.furnishingReadSchema.safeParse(s.analyticsQuery('2026-01-01', '2026-12-31')).success, true);
  assert.equal(s.furnishingReadSchema.safeParse(s.analyticsQuery('2023-01-01', '2026-12-31')).success, false);
  assert.equal(s.furnishingReadSchema.safeParse({ section: 'catalogue', from: '2026-01-01' }).success, false);
  const form = { ...s.emptyProjectForm('2026-10-17'), clientName: 'Morag', address: '1 Quay Street' };
  const lines = s.estimateLines([item({})], form.inputs, {}, form);
  const save = s.saveProjectAction(form, lines, crypto.randomUUID());
  assert.equal(s.furnishingActionSchema.safeParse(save).success, true);
  assert.equal(s.furnishingActionSchema.safeParse({ ...save, extra: 1 }).success, false, 'strict');
  assert.equal(s.furnishingActionSchema.safeParse({ ...save, feePence: 1.5 }).success, false, 'whole pence');
  assert.equal(s.projectFormError({ ...form, clientName: '' }), 'Enter the client name.');
  assert.equal(s.projectFormError({ ...form, address: '' }), 'Choose a property or type the address or project name.');
  assert.equal(s.projectFormError(form), null);
  assert.equal(s.furnishingActionSchema.safeParse({ action: 'saveItem', requestId: crypto.randomUUID(), ...s.emptyItemForm(), name: 'Lamp', productUrl: 'http://x.example' }).success, false, 'https links only');
});

test('the client quote shows the client prices only; the shopping list shows caps, links and ticks', () => {
  const lamp = item({ name: 'Bedside lamp <deluxe>', category: 'bedroom', costCapPence: 2000, retailPricePence: 3000, rule: { basis: 'bedroom', per: 2, when: null }, supplier: 'Dunelm', productUrl: 'https://example.com/lamp' });
  const kettle = item({ name: 'Kettle', category: 'appliances', costCapPence: 3000, supplier: '' });
  const i = inputs({ bedrooms: 2 });
  const lines = s.estimateLines([lamp, kettle], i, {}, { markupPercent: 10 });
  const totals = s.estimateTotals(lines, { markupPercent: 10, feePence: 5000, vat: true });
  const q = { number: 'RC-FQ-2026-0001', status: 'sent', clientName: 'Morag Client', clientEmail: 'morag@example.com', where: '1 Quay Street, Leith', estimateOn: '2026-10-17', inputs: i,
    markupPercent: 10, vat: true, notes: 'Line one\nLine two', lines, totals };
  const html = docs.quoteHtml(q, { origin: 'https://app.example' });
  assert.match(html, /RC-FQ-2026-0001/);
  assert.match(html, /Morag Client/);
  assert.match(html, /Bedside lamp &lt;deluxe&gt;/, 'escaped');
  assert.match(html, /Valid until/);
  assert.match(html, /VAT at 20%/);
  assert.match(html, /Design and project fee/);
  assert.match(html, /Line one<br>Line two/);
  assert.doesNotMatch(html, /Maximum estimate|Cap each|example\.com\/lamp/, 'no cost caps or supplier links on the client quote');
  assert.doesNotMatch(html, /—/);
  const doc = docs.quoteDoc(q);
  assert.equal(doc.chip, null, 'a sent quote has no chip');
  assert.equal(docs.quoteDoc({ ...q, status: 'draft' }).chip, 'Draft, not sent');
  const list = docs.shoppingListHtml({ ...q, lines: s.savedLines(lines.map((l, k) => ({ ...l, id: `10000000-0000-4000-8000-00000000000${k}`, position: k + 1, purchased: k === 0, actualPence: k === 0 ? 3900 : null, purchasedAt: null, purchasedBy: null }))) }, { by: 'supplier' });
  assert.match(list, /Shopping list/);
  assert.match(list, /Cap each/);
  assert.match(list, /href="https:\/\/example\.com\/lamp"/);
  assert.match(list, /No supplier yet/);
  assert.match(list, /&#10003;/, 'the ticked line');
  assert.ok(list.indexOf('Dunelm') < list.indexOf('No supplier yet'), 'suppliers A to Z, none last');
  assert.equal(docs.quoteFileName('RC-FQ-2026-0001', 'shopping-list'), 'RC-FQ-2026-0001-shopping-list.html');
  const groups = s.shoppingGroups(lines, 'room');
  assert.deepEqual(groups.map(g => g.key), ['bedroom', 'appliances']);
  assert.equal(s.varianceLine(-500, 2), '£5.00 under the estimate across 2 lines.');
});

test('only the Stays team and management are offered Furnishing Studio, on the web and the phone', () => {
  assert.deepEqual([...s.FURNISHING_ROLES], ['stays', 'admin', 'super_admin']);
  assert.ok(map.CLIENT_RELATIONS_SUBS.includes('furnishing'));
  assert.equal(subs.CLIENT_SUB_LABEL.furnishing, 'Furnishing Studio');
  for (const role of ['stays', 'admin', 'super_admin']) {
    assert.ok(subs.clientSubsFor(role, []).includes('furnishing'), role);
    assert.ok(tools.panelToolsFor(role, []).some(t => t.key === 'studio'), role + ' panel tool');
    assert.ok(panel.rolePanel(role, []).groups.some(g => g.links.some(l => l.key === 'tool:studio')), role + ' menu');
  }
  for (const role of ['client', 'cleans', 'cleaning_manager', 'ready', 'accounts']) {
    assert.equal(subs.clientSubsFor(role, ['licensing', 'listing-health', 'purchase-order']).includes('furnishing'), false, role);
    assert.equal(subs.clientSubsFor(role, []).includes('furnishing'), false, role + ' not even in the whole-area fallback');
    assert.equal(tools.panelToolsFor(role, []).some(t => t.key === 'studio'), false, role);
    assert.equal(panel.rolePanel(role, []).groups.some(g => g.links.some(l => l.key === 'tool:studio')), false, role + ' menu');
    assert.equal(s.canUseFurnishingStudio(role), false, role);
  }
  const studio = tools.panelToolsFor('stays', []).find(t => t.key === 'studio');
  assert.deepEqual(studio.target, { kind: 'work', view: 'clients', sub: 'furnishing' });
  assert.ok(map.WORK_SUBS.some(x => x.view === 'clients' && x.sub === 'furnishing' && /shopping list/.test(x.words)), 'found by search');
});

test('the routes, the phone client and the screen are wired', async () => {
  for (const path of ['/api/workspace/furnishing', '/api/mobile/furnishing']) assert.equal(policy.backendRouteAllowed(path), true, path);
  for (const file of ['app/api/workspace/furnishing/route.ts', 'app/api/mobile/furnishing/route.ts']) {
    const text = await read(file);
    assert.match(text, /export const GET/); assert.match(text, /export const POST/);
    assert.match(text, /workspaceFurnishing/);
  }
  const server = await read('lib/furnishing-studio-server.ts');
  for (const rpc of ['workspace_furnishing_read', 'workspace_furnishing_analytics', 'workspace_furnishing_action']) assert.match(server, new RegExp(`'${rpc}'`));
  const client = await read('mobile/src/backend/client.ts');
  assert.match(client, /\|furnishing\)\(\?:\[\/\?\]\|\$\)/, 'the phone may call the endpoint');
  assert.match(client, /export const readFurnishing = .*\/api\/mobile\/furnishing\?/);
  assert.match(client, /export const writeFurnishing = .*\/api\/mobile\/furnishing'/);
  const relations = await read('mobile/src/ClientRelations.tsx');
  assert.match(relations, /sub === "furnishing" && <FurnishingStudio p=\{p\} account=\{account\} \/>/);
  const screen = await read('mobile/src/FurnishingStudio.tsx');
  for (const text of ['01 Property details', '02 Catalogue', '03 Estimate', '04 Shopping list', 'Download client quote', 'Download shopping list', 'New project', 'Saved projects',
    'Save draft', 'Add product', 'Quotes by status', 'Top items by quantity', 'Top items by spend', 'Estimated against actual spend', 'Quotes per month'])
    assert.ok(screen.includes(text), text);
  assert.match(screen, /if \(!canUseFurnishingStudio\(account\.role\)\) return/, 'the screen checks the role too');
  assert.doesNotMatch(screen, /localStorage|AsyncStorage/, 'nothing kept on the device');
  for (const file of ['mobile/src/FurnishingStudio.tsx', 'lib/furnishing-studio.ts', 'lib/furnishing-documents.ts', 'lib/furnishing-studio-server.ts', 'app/api/workspace/furnishing/route.ts', 'app/api/mobile/furnishing/route.ts']) {
    const text = await read(file);
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, file + ' is CRLF');
    assert.doesNotMatch(text, /—/, file + ' has no em dash');
  }
});
