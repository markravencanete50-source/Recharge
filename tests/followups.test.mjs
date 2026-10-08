import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The follow-ups that need no outside service: plain wording for every update, a copy of the
// signed agreement, the area map, Home shortcuts that open forms, and repair quote updates.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { agreementDocument, agreementFileName } = await vite.ssrLoadModule('/lib/agreement-copy.ts');
const { mapBubbles, MAP_WIDTH, MAP_HEIGHT, AREA_CENTRES, MAPPED_REGIONS, LAND_PATHS } = await vite.ssrLoadModule('/lib/scotland-map.ts');
const { homeActionsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
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

test('Home shortcuts open the forms each role can use', () => {
  const keys = role => homeActionsFor(role, DEFAULT_ROLE_MODULES[role]).map(a => a.key);
  assert.deepEqual(keys('admin'), ['record-stay', 'report-repair', 'new-clean', 'new-expense']);
  assert.deepEqual(keys('accounts'), ['new-expense']);
  assert.deepEqual(keys('cleans'), [], 'cleaners have no form to start');
  assert.deepEqual(keys('client'), ['report-repair']);
  assert.ok(keys('ready').includes('new-routine') && !keys('ready').includes('report-repair'));
  assert.deepEqual(homeActionsFor('client', ['client-dashboard']).map(a => a.key), [], 'owners without the repairs tool');
  assert.deepEqual(homeActionsFor('accounts', MODULE_IDS).find(a => a.key === 'new-expense').target, { kind: 'work', view: 'accounts', sub: 'expenses', open: 'new-expense' });
  // Each form is opened by the screen it lives in.
  const screens = { 'record-stay': 'LiveStays', 'report-repair': 'LiveRepairs', 'new-routine': 'LiveRepairs', 'new-clean': 'LiveCleans', 'new-expense': 'LiveAccounts' };
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
