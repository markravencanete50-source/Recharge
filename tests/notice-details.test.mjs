import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The Updates feed, round 6: every row says what it is ("<type of work>: <title>"), then the property, who did it and when; chat and
// guest notices name who wrote or where; a burst of the same automatic kind in one minute is one row; a row opens its work item.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const d = await vite.ssrLoadModule('/lib/notice-details.ts');
const { noticeViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const source = file => readFileSync(file, 'utf8');
const AT = '2026-10-13T12:39:20Z'; // 13:39 in London (BST)
const W = '11111111-1111-4111-8111-111111111111';
const notice = (extra = {}) => noticeViewSchema.parse({ id: 1, event_type: 'handover.created', created_at: AT, read_at: null, ...extra });

test('a title and a second line for each kind of work', () => {
  const cases = [
    ['daily_pricing', '3 empty nights to price', 'Pricing: 3 empty nights to price'],
    ['direct_booking', 'Smith, 8 nights', 'Direct booking follow-up: Smith, 8 nights'],
    ['maintenance', 'Boiler not working', 'Repair: Boiler not working'],
    ['licensing', 'Short-term let licence', 'Licensing: Short-term let licence'],
    ['cleaning', 'Changeover clean', 'Clean: Changeover clean'],
    ['listing_health', 'Airbnb listing check', 'Listing check: Airbnb listing check'],
    ['routine_visit', 'Gutters', 'Preventative visit: Gutters'],
    ['purchase', 'New kettle', 'Purchase: New kettle'],
  ];
  for (const [kind, title, expected] of cases) {
    const row = d.noticeRow(notice({ work_id: W, work_kind: kind, work_title: title, property_name: '40 Pitt Street', property_address: '40 Pitt Street, Edinburgh EH6 4BX', automatic: true }));
    assert.equal(row.title, expected, kind);
    assert.equal(row.line, '40 Pitt Street, Edinburgh EH6 4BX · Automatic · 13 Oct, 13:39', 'an address starting with the name shows once');
    assert.deepEqual(row.target, { kind: 'work', workId: W });
  }
  // A person did it; the property's name and address both show when they differ.
  const byPerson = d.noticeRow(notice({ event_type: 'operations.updateOperation.bookRepair', work_id: W, work_kind: 'maintenance', work_title: 'Boiler not working',
    property_name: 'Harbour Flat', property_address: '10 Barnet Crescent', automatic: false, actor_name: 'Sam Reid' }));
  assert.equal(byPerson.title, 'Repair: Boiler not working');
  assert.equal(byPerson.line, 'Harbour Flat, 10 Barnet Crescent · Sam Reid · 13 Oct, 13:39');
  // An unknown kind falls back to the tool's name, then to the kind made readable.
  assert.equal(d.workKindLabel(null, 'daily-pricing'), 'Daily pricing report');
  assert.equal(d.workKindLabel('garden_tidy'), 'Garden tidy');
  assert.equal(d.noticeRow(notice({ work_id: W, work_title: 'Something', work_kind: null })).title, 'Task: Something');
});

test('the fallback: no work item keeps today\'s wording; chat and guest notices say who or where', () => {
  assert.equal(d.noticeRow(notice()).title, 'New task for your team');
  assert.equal(d.noticeRow(notice()).target, null);
  assert.equal(d.noticeRow(notice({ event_type: 'team.event_set', actor_name: 'Ann Lee' })).title, 'Your calendar was changed');
  assert.equal(d.noticeRow(notice({ event_type: 'team.event_set', actor_name: 'Ann Lee' })).line, 'Ann Lee · 13 Oct, 13:39');
  const chat = d.noticeRow(notice({ event_type: 'chat.message', actor_name: 'Holly Holder' }));
  assert.deepEqual([chat.title, chat.target], ['Message from Holly Holder', { kind: 'messages' }]);
  assert.equal(chat.line, '13 Oct, 13:39', 'the writer is in the title, not repeated');
  assert.equal(d.noticeRow(notice({ event_type: 'chat.owner_message', actor_name: 'Olive Owner' })).title, 'Message from Olive Owner');
  assert.equal(d.noticeRow(notice({ event_type: 'chat.message' })).title, 'New message', 'no name known: the usual wording');
  const guest = d.noticeRow(notice({ event_type: 'guest.message', property_name: '10 Barnet Cres', automatic: true }));
  assert.deepEqual([guest.title, guest.line, guest.target], ['Guest message · 10 Barnet Cres', 'Guest · 13 Oct, 13:39', { kind: 'messages' }]);
  assert.equal(d.noticeRow(notice({ event_type: 'guest.message' })).title, 'Guest message');
  // An older database without the new fields still reads.
  assert.equal(d.noticeRow(noticeViewSchema.parse({ id: 9, event_type: 'handover.created', created_at: AT })).title, 'New task for your team');
});

test('owners see "Recharge", never a staff name, and never "Automatic"', () => {
  // The read sends owners actor_name 'Recharge' and automatic false (migration 20261016300000); the row shows exactly that.
  const owner = d.noticeRow(notice({ event_type: 'operations.updateOperation.completeRepair', work_id: W, work_kind: 'maintenance', work_title: 'Boiler not working',
    property_name: 'Harbour Flat', automatic: false, actor_name: 'Recharge' }));
  assert.equal(owner.line, 'Harbour Flat · Recharge · 13 Oct, 13:39');
  assert.doesNotMatch(owner.line, /Automatic/);
  assert.equal(d.noticeRow(notice({ event_type: 'chat.message', actor_name: 'Recharge' })).title, 'Message from Recharge');
  const migration = source('supabase/migrations/20261016300000_notice_details.sql');
  assert.match(migration, /case when a\.actor_id=auth\.uid\(\) then 'You' when actor='client' then 'Recharge' when a\.actor_id is null then null else ap\.full_name end as actor_name/);
  assert.match(migration, /\(a\.actor_id is null and actor<>'client'\) as automatic/);
});

test('a burst of the same automatic kind in one minute is one row that opens a list', () => {
  const pricing = Array.from({ length: 12 }, (_, i) => notice({ id: 100 + i, created_at: `2026-10-13T12:39:${String(10 + i).padStart(2, '0')}Z`, work_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, work_kind: 'daily_pricing', work_title: `Price night ${i}`, automatic: true }));
  const repair = notice({ id: 200, created_at: '2026-10-13T12:39:40Z', work_id: W, work_kind: 'maintenance', work_title: 'Leak', automatic: false, actor_name: 'Sam Reid' });
  const later = notice({ id: 300, created_at: '2026-10-13T12:41:00Z', work_id: W, work_kind: 'daily_pricing', work_title: 'Price night 99', automatic: true });
  const rows = d.noticeRows([...pricing, repair, later]);
  assert.deepEqual(rows.map(r => r.title), ['Pricing: Price night 99', 'Repair: Leak', 'Pricing: 12 new tasks']);
  const burst = rows[2];
  assert.equal(burst.line, 'Automatic · 13 Oct, 13:39');
  assert.equal(burst.notices.length, 12);
  assert.equal(burst.target, null, 'the burst opens its list, not one item');
  assert.equal(burst.unread, true);
  // A burst that crosses a minute boundary stays one row (within a minute of its newest notice).
  const across = [0, 20, 50].map((sec, i) => notice({ id: 400 + i, created_at: new Date(Date.parse('2026-10-13T12:40:10Z') - sec * 1000).toISOString(), work_id: W, work_kind: 'daily_pricing', work_title: 'P' + i, automatic: true }));
  assert.deepEqual(d.noticeRows(across).map(r => r.title), ['Pricing: 3 new tasks']);
  assert.equal(d.noticeRows(across)[0].clock, '13:40');
  // Two of a kind is a burst; one is a normal row; a person's actions never fold; another minute is another row.
  assert.equal(d.noticeRows(pricing.slice(0, 2)).length, 1);
  assert.equal(d.noticeRows(pricing.slice(0, 1))[0].title, 'Pricing: Price night 0');
  assert.equal(d.noticeRows(pricing.slice(0, 3).map(n => ({ ...n, automatic: false, actor_name: 'Sam' }))).length, 3);
  const updates = d.noticeRows(pricing.slice(0, 3).map(n => ({ ...n, event_type: 'operations.updateOperation.approveBudget' })));
  assert.equal(updates[0].title, 'Pricing: 3 updates');
});

test('a row opens its work item, a chat or guest notice opens Messages, and a burst opens its list', () => {
  const pages = source('mobile/src/LivePages.tsx'), workspace = source('mobile/src/LiveWorkspace.tsx');
  assert.match(pages, /if \(row\.notices\.length > 1\) return \(\) => setOpened\(opened === row\.key \? null : row\.key\);/);
  // Round 7: an item not in the loaded work list is read on its own (tests/updates-open-older*.test.mjs).
  assert.match(pages, /if \(t\?\.kind === "work" && onOpenWork\) \{ const item = byId\.get\(t\.workId\); return item \? \(\) => onOpenWork\(item\) : \(\) => void openWork\(t\.workId\); \}/);
  assert.match(pages, /if \(t\?\.kind === "messages" && onOpenMessages\) return onOpenMessages;/);
  assert.equal((workspace.match(/<LiveActivity palette=\{p\} notices=\{notices\} loading=\{loading\} onRead=\{markRead\} work=\{work\} onOpenWork=\{setOpenWork\} onOpenMessages=\{\(\) => openMessages\(""\)\} \/>/g) ?? []).length, 2);
  // Thin rows: one line for what it is, one for where, who and when.
  const rows = source('mobile/src/LiveRows.tsx');
  assert.match(rows, /fontWeight: row\.unread \? "600" : "500", flex: 1, minWidth: 0 \}\}>\{row\.title\}<\/Text>/);
  // The time sits beside the title, so a narrow screen cuts the place short but never the time.
  assert.match(rows, /flexShrink: 0, fontVariant: \["tabular-nums"\] \}\]\}>\{clock \? row\.clock : row\.when\}<\/Text>/);
  assert.match(pages, /onPress=\{press\(row\)\} open=\{group \? open : undefined\} clock \/>/, 'the day heading carries the date, the row the time');
  assert.match(rows, /<Text numberOfLines=\{1\} style=\{\[ui\.small, \{ color: p\.muted \}\]\}>\{row\.detail\}<\/Text>/);
  const split = d.noticeRow(notice({ work_id: W, work_kind: 'maintenance', work_title: 'Leak', property_name: 'Harbour Flat', automatic: false, actor_name: 'Sam Reid' }));
  assert.deepEqual([split.detail, split.when], ['Harbour Flat · Sam Reid', '13 Oct, 13:39']);
});

test('email names the type of work and still carries no property, title or names; pop-ups are direct (Lee, 14 October)', () => {
  assert.deepEqual(d.noticeCopyFor('handover.created', 'daily_pricing').title, 'Pricing: New task for your team');
  assert.deepEqual(d.noticeCopyFor('handover.created', null).title, 'New task for your team');
  assert.equal(d.noticeCopyFor('operations.updateOperation.completeRepair', 'maintenance').title, 'Repair: Repair completed');
  assert.match(source('lib/integration-providers.ts'), /noticeCopyFor\(job\.eventType, job\.workKind\)/);
  // Pop-ups are encrypted for one device, so they name who and what (lib/push-copy.ts, tested in push-copy.test.mjs).
  assert.match(source('lib/web-push.ts'), /const details = job\.details \?\? \{\};\s*const \{ title, message \} = copy \?\? pushCopy\(job\.eventType, job\.workKind, details\);/);
});
