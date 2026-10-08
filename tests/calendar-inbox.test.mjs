import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The live calendar's days, teams and filters; saved reply placeholders; and the strict shape of the
// new Messages requests.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const cal = await vite.ssrLoadModule('/lib/calendar-live.ts');
const chat = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('every team role has the Calendar second; owners do not', () => {
  for (const role of ['admin', 'super_admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.equal(workViewsFor(role)[1], 'calendar', role);
  assert.ok(!workViewsFor('client').includes('calendar'));
});

test('the month grid is six weeks from a Monday, inside the schedule limit', () => {
  const grid = cal.monthGrid('2026-10');
  assert.equal(grid.from, '2026-09-28'); assert.equal(grid.to, '2026-11-08');
  assert.equal(grid.weeks.flat().length, 42);
  assert.ok((Date.parse(grid.to) - Date.parse(grid.from)) / 86400000 <= 62);
  assert.equal(new Date(grid.from + 'T12:00:00Z').getUTCDay(), 1, 'weeks start on Monday');
  assert.equal(cal.monthGrid('2026-06').from, '2026-06-01', 'a month starting on Monday starts there');
  assert.equal(cal.shiftMonth('2026-12', 1), '2027-01'); assert.equal(cal.shiftMonth('2026-01', -1), '2025-12');
});

test('work belongs to a team by its kind, then its tool', () => {
  assert.equal(cal.teamOf('cleaning-schedule', 'cleaning'), 'cleans');
  assert.equal(cal.teamOf('maintenance-reporting', 'maintenance'), 'ready');
  assert.equal(cal.teamOf('routine-bin-garden-board', 'routine_visit'), 'ready');
  assert.equal(cal.teamOf('new-property-inspection-board', 'inspection'), 'ready');
  assert.equal(cal.teamOf('cleans-invoices', 'cleaning_invoice'), 'accounts');
  assert.equal(cal.teamOf('daily-pricing', 'daily_pricing'), 'stays');
  assert.equal(cal.teamOf('licensing', 'licensing'), 'stays');
  assert.deepEqual(cal.calendarTeamsFor('cleans'), ['cleans']);
  assert.deepEqual(cal.calendarTeamsFor('client'), []);
  assert.ok(cal.calendarTeamsFor('admin').includes('accounts') && !cal.calendarTeamsFor('stays').includes('accounts'));
  assert.ok(cal.canPickPerson('cleaning_manager') && cal.canPickPerson('admin') && !cal.canPickPerson('cleans') && !cal.canPickPerson('stays'));
});

test('each day lists departures, cleans, arrivals, repairs and payment runs, and filters by team and person', () => {
  const day = '2026-10-12';
  const work = (n, kind, moduleId, assigneeId = null) => ({ workId: id(n), propertyId: id(90), propertyName: 'Harbour Flat', moduleId, title: kind, status: 'waiting', dueOn: day, assigneeId, assigneeName: assigneeId ? 'Cleo' : null, kind, version: 1 });
  const schedule = cal.calendarScheduleSchema.parse({
    work: [work(1, 'maintenance', 'maintenance-reporting'), work(2, 'cleaning', 'cleaning-schedule', id(50)), { ...work(3, 'daily_pricing', 'daily-pricing'), dueOn: null }],
    stays: [{ reservationId: 'r1', propertyId: id(90), propertyName: 'Harbour Flat', checkIn: '2026-10-09', checkOut: day, guests: 2, channel: 'airbnb' },
      { reservationId: 'r2', propertyId: id(90), propertyName: 'Harbour Flat', checkIn: day, checkOut: '2026-10-15', guests: 3, channel: 'direct' }],
    payments: [
      { statementId: id(7), propertyId: id(90), propertyName: 'Harbour Flat', period: '2026-09', status: 'paid', payoutMinor: 50000, date: day, issuedAt: null, paidAt: day + 'T10:00:00Z', reference: 'BACS 1' },
      { statementId: id(8), propertyId: id(91), propertyName: 'Castle Loft', period: '2026-09', status: 'draft', payoutMinor: 20000, date: day, issuedAt: null, paidAt: null, reference: null },
    ],
  });
  const entries = cal.calendarEntries(schedule);
  const today = entries.filter(e => e.date === day);
  assert.deepEqual(today.map(e => e.kind), ['check-out', 'clean', 'check-in', 'repair', 'payment']);
  assert.equal(entries.filter(e => e.kind === 'work').length, 0, 'work without a date is not on the calendar');
  const run = today.find(e => e.kind === 'payment');
  assert.equal(run.payments.length, 2); assert.equal(run.propertyName, '2 properties');
  assert.equal(cal.paymentSummary(run.payments), '1 paid · 1 to issue');
  assert.deepEqual(cal.filterEntries(entries, 'cleans', null).map(e => e.kind), ['clean']);
  assert.deepEqual(cal.filterEntries(entries, 'stays', null).map(e => e.date + ' ' + e.kind), ['2026-10-09 check-in', day + ' check-out', day + ' check-in', '2026-10-15 check-out']);
  assert.deepEqual(cal.filterEntries(entries, 'accounts', null).map(e => e.kind), ['payment']);
  assert.deepEqual(cal.filterEntries(entries, 'all', id(50)).map(e => e.work?.workId), [id(2)], 'one person’s day is their own work');
  assert.deepEqual(cal.calendarPeople(entries), [[id(50), 'Cleo']]);
  assert.equal(cal.kindCount('clean', 1), '1 clean'); assert.equal(cal.kindCount('check-in', 3), '3 arrivals');
  assert.deepEqual(cal.calendarScheduleSchema.parse({ work: [], stays: [] }).payments, [], 'owners and cleaners get no payment runs');
});

test('saved replies fill in the guest and the property', () => {
  assert.equal(chat.fillReply('Hi {guest}, welcome to {property}!', { name: 'Anna Smith', property: 'Harbour Flat' }), 'Hi Anna, welcome to Harbour Flat!');
  assert.equal(chat.fillReply('Hi {Guest}, see you at { property }.', { name: null, property: '' }), 'Hi there, see you at the property.');
  assert.equal(chat.fillReply('Dear {owner}', { name: 'Recharge · Ben Jones' }), 'Dear Ben');
  const replies = [{ audience: 'guest' }, { audience: 'owner' }, { audience: 'all' }];
  assert.equal(chat.repliesFor(replies, 'guest').length, 2); assert.equal(chat.repliesFor(replies, 'owner').length, 2);
  assert.ok(chat.hasGuestInbox({ role: 'stays', modules: ['guest-communication'] }));
  assert.ok(!chat.hasGuestInbox({ role: 'cleans', modules: ['guest-communication'] }));
  assert.ok(!chat.hasGuestInbox({ role: 'ready', modules: [] }));
});

test('the new Messages requests are strict', () => {
  assert.ok(chat.chatReadSchema.safeParse({ section: 'savedReplies' }).success);
  assert.ok(chat.chatActionSchema.safeParse({ action: 'startProperty', propertyId: id(1) }).success);
  assert.ok(chat.chatActionSchema.safeParse({ action: 'startProperty', propertyId: id(1), workId: id(2) }).success);
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'startProperty' }).success, 'a property is required');
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'startProperty', propertyId: id(1), userIds: [id(3)] }).success, 'members are not chosen by the caller');
  assert.ok(chat.chatActionSchema.safeParse({ action: 'saveReply', title: 'Wi-Fi', body: 'The code is on the fridge.', audience: 'guest' }).success);
  assert.ok(chat.chatActionSchema.safeParse({ action: 'saveReply', replyId: id(4), version: 2, title: 'Wi-Fi', body: 'The code is on the fridge.', audience: 'all' }).success);
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'saveReply', title: 'W', body: 'Too short a title', audience: 'guest' }).success);
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'saveReply', title: 'Long', body: 'x'.repeat(2001), audience: 'guest' }).success);
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'saveReply', title: 'Who', body: 'For the cleaners', audience: 'cleaners' }).success);
  assert.ok(chat.chatActionSchema.safeParse({ action: 'deleteReply', replyId: id(4), version: 2 }).success);
  assert.ok(!chat.chatActionSchema.safeParse({ action: 'deleteReply', replyId: id(4) }).success, 'deleting needs the version read');
});
