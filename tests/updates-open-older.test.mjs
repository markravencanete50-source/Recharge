import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The Updates feed, round 7: an update whose work item is not loaded opens it through a single-item read, and "Show older
// updates" pages back 50 at a time. The database side is tests/updates-open-older-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const d = await vite.ssrLoadModule('/lib/notice-details.ts');
const { portfolioReadSchema } = await vite.ssrLoadModule('/lib/portfolio-policy.ts');
const { operationsReadSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const source = file => readFileSync(file, 'utf8');
const W = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222';
const item = (workId = W) => ({ workId, propertyId: P, moduleId: 'daily-pricing', title: 'Price night', kind: 'daily_pricing', status: 'waiting', version: 1, assigneeId: null, data: {} });
const n = (id, at) => ({ id, event_type: 'handover.created', created_at: at });

test('pages of updates join newest first, each once, and the next page starts from the oldest shown', () => {
  const first = [n(5, '2026-10-13T10:00:00Z'), n(4, '2026-10-13T09:00:00Z'), n(3, '2026-10-13T09:00:00Z')];
  const older = [n(3, '2026-10-13T09:00:00Z'), n(2, '2026-10-12T09:00:00Z'), n(1, '2026-10-11T09:00:00Z')];
  assert.deepEqual(d.mergeNotices(first, older).map(x => x.id), [5, 4, 3, 2, 1]);
  assert.equal(d.oldestNoticeId(first), 3, 'same time: the lower id is older');
  assert.equal(d.oldestNoticeId([]), null);
  assert.equal(d.NOTICE_PAGE, 50);
  assert.deepEqual([d.mayHaveOlder(50), d.mayHaveOlder(49), d.mayHaveOlder(0)], [true, false, false]);
});

test('the single-item read: the item, or nothing (a list without it, another item, or junk)', () => {
  assert.equal(d.workItemFrom(item(), W).workId, W);
  assert.equal(d.workItemFrom([item('33333333-3333-4333-8333-333333333333'), item()], W).workId, W, 'picked out of a list');
  assert.equal(d.workItemFrom([item('33333333-3333-4333-8333-333333333333')], W), null);
  assert.equal(d.workItemFrom(item('33333333-3333-4333-8333-333333333333'), W), null, 'never a different item');
  assert.equal(d.workItemFrom({ error: 'Record not found' }, W), null);
  assert.equal(d.workItemFrom(undefined, W), null);
});

test('the routes: a work item by id, and older updates by a numeric cursor on the notifications read only', () => {
  assert.deepEqual(operationsReadSchema.parse({ workId: W }), { workId: W });
  assert.deepEqual(operationsReadSchema.parse({ propertyId: P }), { propertyId: P });
  assert.equal(operationsReadSchema.safeParse({ workId: W, propertyId: P }).success, false);
  assert.equal(operationsReadSchema.safeParse({ workId: 'not-an-id' }).success, false);
  assert.equal(portfolioReadSchema.parse({ section: 'notifications', before: '123' }).before, '123');
  for (const bad of [{ section: 'notifications', before: '0' }, { section: 'notifications', before: '-1' }, { section: 'notifications', before: '1e5' }, { section: 'portfolio', before: '12' }])
    assert.equal(portfolioReadSchema.safeParse(bad).success, false, JSON.stringify(bad));
  const journey = source('lib/journey-server.ts'), portfolio = source('lib/portfolio-server.ts');
  assert.match(journey, /workId\?await session\.client\.rpc\('workspace_operation_read',\{target:workId\}\)/);
  assert.match(portfolio, /q\.before\?await session\.client\.rpc\('workspace_notifications_read',\{before_id:Number\(q\.before\)\}\)/);
});

test('the feed: an item not loaded is read and opened, a refusal says "no longer available", and older updates page back', () => {
  const pages = source('mobile/src/LivePages.tsx'), client = source('mobile/src/backend/client.ts');
  assert.match(client, /export const readWorkItem = async \(workId: string\) => \(await workspaceRequest\('\/api\/mobile\/operations\?workId=' \+ encodeURIComponent\(workId\)\)\)\.json\(\);/);
  assert.match(client, /export const readOlderNotices = async \(before: number\) => \(await workspaceRequest\('\/api\/mobile\/portfolio\?section=notifications&before=' \+ encodeURIComponent\(String\(before\)\)\)\)\.json\(\);/);
  assert.match(pages, /return item \? \(\) => onOpenWork\(item\) : \(\) => void openWork\(t\.workId\);/);
  assert.match(pages, /error instanceof WorkspaceApiError && error\.status === 404 \? "That item is no longer available to you\."/);
  assert.match(pages, /accessibilityLabel="Show older updates"/);
  assert.match(pages, /const before = oldestNoticeId\(all\);/);
  assert.match(pages, /setMore\(mayHaveOlder\(page\.length\) && page\.some\(n => !known\.has\(n\.id\)\)\)/);
  assert.match(pages, /const ids = unreadNotices\(all\)/, 'older pages are marked read too');
  // Theme colours only in the feed.
  const feed = pages.slice(pages.indexOf('export function LiveActivity'), pages.indexOf('export function LiveHelp'));
  assert.doesNotMatch(feed, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});
