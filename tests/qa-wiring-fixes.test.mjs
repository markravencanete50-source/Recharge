import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Small wiring fixes from the QA sweep: counts that match their lists, buttons that follow the
// same grants as the database, and screens that say what the database will refuse.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { READY_STAGES, REPAIR_STAGES } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { unreadNotices, noticeViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const { canStart } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { canEditStay, stayLines } = await vite.ssrLoadModule('/lib/property-profile.ts');
const { queueCount, managementSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const { hostawayStatusSchema } = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { faqsForAccess } = await vite.ssrLoadModule('/lib/access-faq.ts');
after(() => vite.close());
const source = file => readFileSync('mobile/src/' + file, 'utf8');
const account = (role, modules) => ({ userId: '11111111-1111-4111-8111-111111111111', role, modules });

test('Ready Home counts only the stages Ready can open', () => {
  assert.deepEqual(READY_STAGES.map(s => s.phase), ['referred', 'booked', 'completed', 'paid']);
  assert.ok(READY_STAGES.every(s => REPAIR_STAGES.includes(s)));
  assert.match(source('ReadyHome.tsx'), /READY_STAGES\.map/);
  assert.doesNotMatch(source('ReadyHome.tsx'), /REPAIR_STAGES/);
});

test('Home counts unread updates only, and Activity marks them read', () => {
  const notices = [{ id: 3, event_type: 'a', created_at: 'x', read_at: null }, { id: 2, event_type: 'b', created_at: 'x', read_at: '2026-10-09T10:00:00Z' }, { id: 1, event_type: 'c', created_at: 'x' }];
  assert.deepEqual(unreadNotices(notices).map(n => n.id), [3, 1]);
  assert.equal(noticeViewSchema.parse(notices[1]).read_at, '2026-10-09T10:00:00Z', 'the read time survives parsing');
  assert.match(source('LiveHome.tsx'), /unreadNotices\(notices\)\.length/);
  assert.match(source('LivePages.tsx'), /writeControls\(\{ action: "markAllNotificationsRead"/, 'one request, however long the backlog');
});

test('Work-view buttons follow the same tool grants as Home', () => {
  assert.equal(canStart(account('stays', ['stays-maintenance-reporting']), 'record-stay'), false, 'recording a stay needs Direct bookings');
  assert.equal(canStart(account('stays', ['direct-bookings']), 'record-stay'), true);
  assert.equal(canStart(account('stays', ['maintenance-reporting']), 'report-repair'), false, 'the database checks Stays repairs');
  assert.equal(canStart(account('cleaning_manager', []), 'new-clean'), false);
  assert.equal(canStart(account('accounts', ['owner-statements']), 'new-expense'), false);
  assert.equal(canStart(account('accounts', DEFAULT_ROLE_MODULES.accounts), 'new-expense'), true);
  assert.equal(canStart(account('ready', MODULE_IDS), 'report-repair'), false);
  for (const form of ['record-stay', 'report-repair', 'new-clean', 'new-expense']) assert.equal(canStart(account('admin', MODULE_IDS), form), true, form);
  for (const [file, form] of [['LiveStays.tsx', 'record-stay'], ['LiveRepairs.tsx', 'report-repair'], ['LiveCleans.tsx', 'new-clean'], ['AccountsPayable.tsx', 'new-expense']])
    assert.match(source(file), new RegExp(`canStart\\(account, "${form}"\\) && <Button`), file);
});

test("admins' Home decides repairs above the management limit, with Management's total", () => {
  const empty = managementSchema.parse({ cleaningDecisions: [], expensesOverLimit: [], stalledOwnerApprovals: [], cleanerWarnings: [], ownerBalancesDue: [] });
  const repair = { workId: '22222222-2222-4222-8222-222222222222', version: 1, title: 'Boiler', propertyId: '33333333-3333-4333-8333-333333333333', propertyName: 'Flat', issue: 'No heat', repairType: 'heating', urgent: false, hazard: false, estimatedCostMinor: 90000, previousEstimateMinor: null, quoteReason: null, ownerApprovedAt: null, limitMinor: 50000, waitingSince: '2026-10-08T10:00:00Z' };
  assert.equal(queueCount({ ...empty, repairApprovals: [repair] }), 1);
  const home = source('LiveOversight.tsx');
  assert.match(home, /queue\.repairApprovals\.length/);
  assert.match(home, /queueCount\(queue\)/);
  assert.match(home, /<CostDecisionSheet/);
});

test('Stays edit or cancel only the stays recorded in the app', () => {
  const [manual, synced] = stayLines([
    { id: 'm', reference: 'Guest', check_in: '2026-10-20', check_out: '2026-10-22', status: 'confirmed', source: 'manual', version: 2 },
    { id: 'h', reference: 'HA-1', check_in: '2026-10-25', check_out: '2026-10-27', status: 'confirmed', source: 'hostaway', version: 1 },
  ], '2026-10-09');
  assert.deepEqual([manual.checkIn, manual.checkOut, manual.version, manual.manual], ['2026-10-20', '2026-10-22', 2, true]);
  assert.equal(canEditStay(account('stays', ['direct-bookings']), manual), true);
  assert.equal(canEditStay(account('stays', ['direct-bookings']), synced), false, 'channel manager stays change there');
  assert.equal(canEditStay(account('stays', ['daily-pricing']), manual), false, 'the database needs Direct bookings');
  assert.equal(canEditStay(account('accounts', MODULE_IDS), manual), false);
});

test('the Hostaway card says the sync is paused instead of offering it', () => {
  assert.equal(hostawayStatusSchema.parse({ lastRunAt: null, lastSuccessAt: null, lastTrigger: null, lastError: null, problems: [], lastSummary: {}, canSync: true, linkedProperties: 0, upcomingStays: 0, unassignedCleans: 0 }).paused, false);
  const card = source('HostawaySyncCard.tsx');
  assert.match(card, /Channel manager not connected\. Sync is paused\./);
  assert.match(card, /status\.configured && !status\.paused && <Button/);
  const answers = faqsForAccess('super_admin', MODULE_IDS).map(f => f.question + ' ' + f.answer).join('\n');
  assert.doesNotMatch(answers, /Hostaway guest conversations|Communication Centre|Alex’s recordings|Alex's recordings/);
});
