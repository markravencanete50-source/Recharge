import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The follow-ups that need no outside service: plain wording for every update, a copy of the
// signed agreement, the area map, Home shortcuts that open forms, and repair quote updates.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { agreementDocument, agreementFileName } = await vite.ssrLoadModule('/lib/agreement-copy.ts');
const { mapBubbles, MAP_WIDTH, MAP_HEIGHT, AREA_CENTRES, MAPPED_REGIONS, LAND_PATHS, viewFor, FULL_VIEW, project, scaleBar } = await vite.ssrLoadModule('/lib/scotland-map.ts');
const { COUNCIL_AREAS, REGION_VIEW, TOWNS } = await vite.ssrLoadModule('/lib/scotland-geo.ts');
const { propertyPoints, postcodeDistrict } = await vite.ssrLoadModule('/lib/property-points.ts');
const { POSTCODE_DISTRICTS } = await vite.ssrLoadModule('/lib/postcode-districts.ts');
const { homeActionsFor, startActionsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { canReviseQuote } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { deliverNotification } = await vite.ssrLoadModule('/lib/integration-providers.ts');
after(() => vite.close());

test('every update has plain wording, with no private details', () => {
  assert.equal(noticeCopy('journey.publishEstimate').title, 'Your estimate is ready');
  assert.equal(noticeCopy('reports.weekly_ready').title, 'Your weekly report is ready');
  assert.equal(noticeCopy('operations.updateOperation.reviseQuote').title, 'Repair quote updated');
  assert.equal(noticeCopy('journey.somethingNew').title, 'Onboarding update', 'unknown steps fall back by area');
  assert.equal(noticeCopy(null).title, 'Update in Recharge');
  // Every journey and repair step the database records has its own title.
  const steps = [...readFileSync('supabase/migrations/20261008270000_followups_garden_quotes_weekly.sql', 'utf8').matchAll(/step='(\w+)'/g)].map(m => m[1]);
  for (const step of new Set(steps)) assert.notEqual(noticeCopy('operations.updateOperation.' + step).title, 'Task updated', step);
  for (const a of ['createEnquiry', 'publishEstimate', 'decideEstimate', 'publishAgreement', 'signAgreement', 'submitForm', 'linkInvoice', 'bookInspection', 'completeInspection', 'makeLive', 'askQuestion', 'answerQuestion'])
    assert.notEqual(noticeCopy('journey.' + a).title, 'Onboarding update', a);
  for (const c of [noticeCopy('journey.makeLive'), noticeCopy('operations.updateOperation.completeRepair')]) assert.match(c.message, /Sign in to Recharge/);
});

test('emails and phone notifications use the wording for their update', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify(String(url).includes('resend') ? { id: 'email-1' } : { data: { status: 'ok', id: 'push-1' } }), { status: 200 }); };
  try {
    const job = { id: 'job-1', lease: 'l', state: 'queued', providerId: null, createdAt: new Date().toISOString(), eventType: 'journey.publishEstimate' };
    await deliverNotification({ RESEND_API_KEY: 'k', NOTIFICATION_FROM_EMAIL: 'hello@example.com' }, { ...job, channel: 'email', destination: 'owner@example.com' });
    await deliverNotification({ EXPO_ACCESS_TOKEN: 't' }, { ...job, channel: 'push', destination: 'ExponentPushToken[x]' });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent[0].body.subject, 'Your estimate is ready');
  assert.match(sent[0].body.text, /estimate for your property/);
  assert.equal(sent[1].body.body, 'Your estimate is ready');
});

test('the signed agreement copy keeps the exact wording, who signed and when, safely escaped', () => {
  const html = agreementDocument({ propertyName: 'Old Mill <Cottage>', agreement: 'Clause 1.\n\nClause 2 & more.', revision: 3, signedName: 'Fiona "Fi" MacLeod', signedAt: '2026-10-08T09:30:00Z' });
  assert.match(html, /<p>Clause 1\.<\/p>/);
  assert.match(html, /Clause 2 &amp; more\./);
  assert.match(html, /Old Mill &lt;Cottage&gt; · Revision 3/);
  assert.match(html, /Accepted electronically by Fiona &quot;Fi&quot; MacLeod/);
  assert.match(html, /8 October 2026/);
  assert.ok(!html.includes('<Cottage>'));
  assert.equal(agreementFileName('Old Mill Cottage, Leith'), 'Recharge-management-agreement-Old-Mill-Cottage-Leith.html');
});

test('the map has every area, and circles never overlap or leave the map', () => {
  for (const r of MAPPED_REGIONS) assert.ok(AREA_CENTRES[r], r);
  assert.ok(LAND_PATHS.length >= 5);
  const regions = MAPPED_REGIONS.map((region, i) => ({ region, count: 1 + (i % 5) * 3 }));
  const bubbles = mapBubbles([...regions, { region: 'Outside Scotland', count: 4 }, { region: 'Region not set', count: 2 }]);
  assert.equal(bubbles.length, MAPPED_REGIONS.length, 'outside Scotland is not drawn');
  for (const b of bubbles) assert.ok(b.x - b.r >= 0 && b.y - b.r >= 0 && b.x + b.r <= MAP_WIDTH && b.y + b.r <= MAP_HEIGHT, b.region);
  for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
    const a = bubbles[i], b = bubbles[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.5, `${a.region} and ${b.region} overlap`);
  }
  assert.deepEqual(mapBubbles([]), []);
});

// Points of a compact path ("M x y l dx dy …" with relative steps), enough to test a pin is inside an area.
function ringPoints(d) {
  const rings = [];
  for (const part of d.split('M').filter(Boolean)) {
    const [start, rest = ''] = part.split(/[lL]/), nums = (t) => t.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const [x0, y0] = nums(start); const pts = [[x0, y0]]; let x = x0, y = y0;
    const steps = nums(rest.replace(/z/gi, ''));
    for (let i = 0; i + 1 < steps.length; i += 2) { x += steps[i]; y += steps[i + 1]; pts.push([x, y]); }
    rings.push(pts);
  }
  return rings;
}
const inRing = (pts, [px, py]) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };

test('the real map: every area has a pin on its own land, and the views and towns fit the sheet', () => {
  assert.equal(COUNCIL_AREAS.length, 32);
  assert.ok(LAND_PATHS.length >= 5);
  for (const r of MAPPED_REGIONS) {
    assert.ok(REGION_VIEW[r], r + ' has a view');
    const [x, y] = project(AREA_CENTRES[r]);
    const rings = COUNCIL_AREAS.filter(a => a.region === r).flatMap(a => ringPoints(a.d));
    assert.ok(rings.length > 0, r + ' has land');
    assert.ok(rings.some(ring => inRing(ring, [x, y])), `${r}'s pin sits on its own land`);
    const v = viewFor(r);
    assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= MAP_WIDTH + 0.01 && v.y + v.h <= MAP_HEIGHT + 0.01 && Math.abs(v.h / v.w - MAP_HEIGHT / MAP_WIDTH) < 0.001, r + ' view fits the sheet');
  }
  assert.deepEqual(viewFor(null), FULL_VIEW); assert.deepEqual(viewFor('Scottish islands'), FULL_VIEW);
  for (const t of TOWNS) { const [x, y] = project([t.lat, t.lon]); assert.ok(x > 0 && x < MAP_WIDTH && y > 0 && y < MAP_HEIGHT, t.name); }
  const bar = scaleBar(0.5); assert.ok(bar.miles > 0 && bar.pixels > 0 && bar.pixels <= 120);
});

test('properties are placed by postcode district, on land, fanned out and never by exact address', () => {
  assert.equal(postcodeDistrict('12 Leith Walk, Edinburgh, EH6 5AB'), 'EH6');
  assert.equal(postcodeDistrict('Flat 2, 4 Union St, Aberdeen AB10 1BB'), 'AB10');
  assert.equal(postcodeDistrict('3 High St, Glasgow g12 8qq'), 'G12');
  assert.equal(postcodeDistrict('No postcode here'), null);
  const land = COUNCIL_AREAS.flatMap(a => ringPoints(a.d));
  const districts = ['TD9', 'EH54', 'EH6', 'G33', 'EH7', 'AB10', 'G83', 'PA2', 'DD10', 'IV51', 'KA22', 'KY11', 'FK2', 'ML2', 'G21', 'EH12'];
  for (const d of districts) {
    assert.ok(POSTCODE_DISTRICTS[d], d + ' is in the table');
    const [x, y] = project(POSTCODE_DISTRICTS[d]);
    assert.ok(land.some(r => inRing(r, [x, y])), d + ' sits on land');
  }
  const base = { status: 'active', region: 'Edinburgh' };
  const list = [
    { ...base, id: 'b', name: 'B', address: '2 Leith Walk, Edinburgh, EH6 5AB' }, { ...base, id: 'a', name: 'A', address: '1 Leith Walk, Edinburgh, EH6 5AA' },
    { ...base, id: 'c', name: 'C', address: '9 Ferry Rd, Edinburgh, EH6 4AA' }, { ...base, id: 'd', name: 'Exact', address: '1 X St, EH6 1AA', latitude: 55.97, longitude: -3.18 },
    { ...base, id: 'e', name: 'Old', status: 'archived', address: '1 Y St, EH6 1AA' }, { ...base, id: 'f', name: 'No code', address: 'Somewhere' }, { ...base, id: 'g', name: 'Far', address: '1 Z St, EH6 1AA', latitude: 10, longitude: 10 },
  ];
  const pts = propertyPoints(list);
  assert.deepEqual(pts.map(p => p.id).sort(), ['a', 'b', 'c', 'd', 'g'], 'archived and unplaceable properties are left out; an off-map saved spot falls back to the postcode');
  assert.deepEqual(pts.find(p => p.id === 'd'), { id: 'd', name: 'Exact', region: 'Edinburgh', district: 'EH6', lat: 55.97, lon: -3.18, exact: true, precision: 'exact' });
  assert.ok(pts.filter(p => p.id !== 'd').every(p => p.precision === 'district'), 'without postcode positions, the district places them');
  // With the postcodes' own positions, each goes to its street; two at one postcode sit about 40m apart, not on top of each other.
  const spots = { 'EH6 5AB': [55.9705, -3.1735], 'EH6 5AA': [55.9705, -3.1735], 'EH6 4AA': [55.9768, -3.1932], 'EH6 1AA': [10, 10] };
  const byPostcode = propertyPoints(list, spots);
  assert.deepEqual(byPostcode.map(p => [p.id, p.precision]).sort(), [['a', 'postcode'], ['b', 'postcode'], ['c', 'postcode'], ['d', 'exact'], ['g', 'district']], 'an off-map postcode position falls back to the district');
  assert.deepEqual([byPostcode.find(p => p.id === 'c').lat, byPostcode.find(p => p.id === 'c').lon], [55.9768, -3.1932]);
  const [pa, pb] = ['a', 'b'].map(id => byPostcode.find(p => p.id === id));
  const apart = Math.hypot((pa.lat - pb.lat) * 111000, (pa.lon - pb.lon) * 62000);
  assert.ok(apart > 10 && apart < 100, `two properties at one postcode are ${Math.round(apart)}m apart`);
  const eh6 = pts.filter(p => p.district === 'EH6' && !p.exact);
  assert.equal(new Set(eh6.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)).size, eh6.length, 'properties in one district do not stack');
  for (const p of eh6) assert.ok(Math.hypot((p.lat - POSTCODE_DISTRICTS.EH6[0]) * 111, (p.lon - POSTCODE_DISTRICTS.EH6[1]) * 62) < 2, 'stays within about 2 km of the district');
  assert.deepEqual(propertyPoints(list.slice().reverse()), pts, 'the same places whatever the order');
  const [first, second] = [viewFor('Edinburgh', pts.map(p => project([p.lat, p.lon]))), viewFor('Edinburgh')];
  assert.ok(first.w < second.w && first.w >= 60, 'zoom fits the properties, tighter than the whole area');
});

test('the forms each role can start open from the panel, search and Work views; Home has no pills for the team', () => {
  const keys = role => startActionsFor(role, DEFAULT_ROLE_MODULES[role]).map(a => a.key);
  for (const role of ['admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.deepEqual(homeActionsFor(role, DEFAULT_ROLE_MODULES[role]), [], role + ' has no quick-action pills on Home');
  assert.deepEqual(keys('admin'), ['record-stay', 'report-repair', 'new-clean', 'new-expense']);
  assert.deepEqual(keys('accounts'), ['new-expense']);
  assert.deepEqual(keys('cleans'), [], 'cleaners have no form to start');
  assert.deepEqual(keys('client'), ['report-repair']);
  assert.ok(keys('ready').includes('new-routine') && !keys('ready').includes('report-repair'));
  assert.deepEqual(homeActionsFor('client', ['client-dashboard']).map(a => a.key), [], 'owners without the repairs tool');
  assert.deepEqual(homeActionsFor('client', DEFAULT_ROLE_MODULES.client).map(a => a.key), ['report-repair'], 'owners keep their one pill');
  assert.deepEqual(startActionsFor('accounts', MODULE_IDS).find(a => a.key === 'new-expense').target, { kind: 'work', view: 'accounts', sub: 'expenses', open: 'new-expense' });
  // Each form is opened by the screen it lives in.
  const screens = { 'record-stay': 'GuestRelations', 'report-repair': 'LiveRepairs', 'new-routine': 'LiveRepairs', 'new-clean': 'LiveCleans', 'new-expense': 'LiveAccounts' };
  for (const [form, screen] of Object.entries(screens)) assert.match(readFileSync(`mobile/src/${screen}.tsx`, 'utf8'), new RegExp(`focus\\?\\.open === "${form}"`), form);
});

test('repair quotes can be updated while a repair is open, by Ready or Stays', () => {
  assert.equal(canReviseQuote('ready', 'booked'), true);
  assert.equal(canReviseQuote('stays', 'triage'), true);
  assert.equal(canReviseQuote('client', 'booked'), false);
  assert.equal(canReviseQuote('ready', 'owner_approval'), false);
  assert.equal(canReviseQuote('ready', 'completed'), false);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(operationsActionSchema.safeParse({ action: 'updateOperation', requestId: id, workId: id, version: 1, step: 'reviseQuote', data: { quoteMinor: 15000, reason: 'Part needs replacing' } }).success);
  assert.ok(!operationsActionSchema.safeParse({ action: 'updateOperation', requestId: id, workId: id, version: 1, step: 'reviseQuote', data: { quoteMinor: 15000, reason: 'x' } }).success);
});
