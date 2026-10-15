import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The cleaner flow (migration 20261021500000), app side: Calendar on the cleaner's phone bar, checkout and arrival
// times on cleans and the calendar, start and finish times on the form, reviews with a redo deadline, the notices'
// wording, and the requests the screens send passing the server's checks.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const live = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { calendarScheduleSchema } = await vite.ssrLoadModule('/lib/calendar-live.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { reviewBlockers } = await vite.ssrLoadModule('/lib/clean-forms.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { noticeRow, CLEANER_NOTICES } = await vite.ssrLoadModule('/lib/notice-details.ts');
const { syncReservation, syncClock } = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const { DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const id = () => crypto.randomUUID();
const read = file => readFileSync(file, 'utf8');

test('cleaners have Calendar on the phone bar, within its five; Properties moves to their Menu', () => {
  const bar = map.phoneBarFor('cleans');
  assert.ok(bar.length <= map.PHONE_BAR_MAX);
  assert.deepEqual(bar.map(i => i.value), ['home', 'todo', 'work', 'calendar', 'inbox']);
  assert.ok(!bar.some(i => i.value === 'properties'));
  assert.ok(map.phoneBarFor('cleaning_manager').some(i => i.value === 'properties'), 'cleaning managers keep Properties');
});

test('a clean shows the checkout time and the next guests, with times and days only', () => {
  const today = new Date('2026-10-15T09:00:00Z');
  assert.equal(live.cleanTimesLine({ checkoutTime: '10:00', nextArrivalOn: '2026-10-18', nextArrivalTime: '15:00' }, '2026-10-18', today), 'Checkout 10:00 · next guests 15:00');
  assert.equal(live.cleanTimesLine({ checkoutTime: null, nextArrivalOn: '2026-10-18', nextArrivalTime: null }, '2026-10-18', today), 'Next guests today');
  assert.equal(live.cleanTimesLine({ checkoutTime: '11:00', nextArrivalOn: '2026-10-20', nextArrivalTime: '16:00' }, '2026-10-18', today), 'Checkout 11:00 · next guests Tue 20 Oct');
  assert.equal(live.cleanTimesLine({ checkoutTime: null, nextArrivalOn: null }, '2026-10-18', today), null);
  assert.equal(live.cleanTimesLine(undefined, '2026-10-18', today), null);
  // The calendar takes the same times from the schedule read; older replies without them still parse.
  const work = { workId: id(), propertyId: id(), propertyName: '110 Hawk', title: 'Checkout clean', status: 'waiting', dueOn: '2026-10-18', assigneeId: null, assigneeName: null, kind: 'cleaning', version: 1 };
  const parsed = calendarScheduleSchema.parse({ work: [work], stays: [], cleanGuests: [{ workId: work.workId, guestsLeaving: 2, nextArrivalOn: '2026-10-18', nextArrivalGuests: 3, checkoutTime: '10:00', nextArrivalTime: '15:00' }] });
  assert.equal(parsed.cleanGuests[0].checkoutTime, '10:00');
  assert.equal(calendarScheduleSchema.parse({ work: [work], stays: [] }).cleanGuests, undefined);
  assert.equal(live.scheduleSchema.parse({ work: [work], stays: [], cleanGuests: [{ workId: work.workId, guestsLeaving: null, nextArrivalOn: null, nextArrivalGuests: null }] }).cleanGuests.length, 1);
});

test('the calendar and Cleans screens show the times, the form takes start and finish, the reviewer sets a redo time', () => {
  const calendar = read('mobile/src/LiveCalendar.tsx'), cleans = read('mobile/src/LiveCleans.tsx');
  assert.match(calendar, /cleanTimesLine\(cleanTimes\.get\(e\.work\.workId\), e\.date\)/);
  assert.match(calendar, /timesOf\(e\), who\(e\)/, 'on each clean in the agenda');
  assert.match(calendar, /label="Guests" value=\{timesOf\(open\)/, 'and when a clean is opened');
  assert.match(cleans, /times: cleanTimesLine\(guests\.get\(w\.workId\), w\.dueOn\)/);
  assert.match(cleans, /label="Started \(optional\)"/); assert.match(cleans, /label="Finished \(optional\)"/);
  assert.match(cleans, /hoursProblem\(startedAt, finishedAt\)/);
  assert.match(cleans, /startedAt: startedAt\.trim\(\)/);
  assert.match(cleans, /redoByFrom\(redoDay, redoTime, now\)/);
  assert.match(cleans, /redoParts\(defaultRedoBy\(new Date\(\)\)\)/, 'the usual redo time is filled in');
  assert.match(cleans, /reviewBlockers\(\{ accepted, formChecked, guestFeedback, reviewNote, redoBy \}\)/);
  assert.match(cleans, /\.\.\.\(accepted === false && redoBy \? \{ redoBy \} : \{\}\)/);
  assert.match(cleans, /label=\{redoLabel\}/, 'the cleaner sees the redo deadline');
  assert.match(cleans, /canSetRate && <MotionPress/, 'only admins and Accounts see the rate button');
  assert.match(cleans, /const canSetRate = \["admin", "super_admin", "accounts"\]/);
});

test('start and finish times: HH:MM, the finish after the start, the same day or overnight, at most 12 hours', () => {
  assert.equal(live.hoursProblem('', ''), null);
  assert.equal(live.hoursProblem('10:30', ''), null);
  assert.equal(live.hoursProblem('10:30', '13:15'), null);
  assert.equal(live.hoursProblem('22:30', '01:15'), null, 'overnight');
  assert.match(live.hoursProblem('9:00', ''), /start time/);
  assert.match(live.hoursProblem('', '24:00'), /finish time/);
  assert.match(live.hoursProblem('10:00', '10:00'), /after the start/);
  assert.match(live.hoursProblem('08:00', '21:00'), /12 hours/);
  assert.equal(live.hoursLine({ startedAt: '10:15', finishedAt: '13:40' }), 'Cleaned 10:15–13:40');
  assert.equal(live.hoursLine({}), null);
  const submit = { action: 'updateOperation', requestId: id(), workId: id(), version: 2, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [id()], mailAction: 'none' } };
  assert.ok(operationsActionSchema.safeParse(submit).success, 'times are optional');
  assert.ok(operationsActionSchema.safeParse({ ...submit, data: { ...submit.data, startedAt: '10:15', finishedAt: '13:40' } }).success);
  assert.equal(operationsActionSchema.safeParse({ ...submit, data: { ...submit.data, startedAt: '10.15' } }).success, false);
});

test('the redo deadline: 18:00 today before then, else 12:00 tomorrow, in London time (BST and GMT)', () => {
  assert.equal(live.defaultRedoBy(new Date('2026-07-01T09:00:00Z')), '2026-07-01T17:00:00.000Z', '10:00 BST: 18:00 BST');
  assert.equal(live.defaultRedoBy(new Date('2026-07-01T17:30:00Z')), '2026-07-02T11:00:00.000Z', '18:30 BST: 12:00 tomorrow');
  assert.equal(live.defaultRedoBy(new Date('2026-12-01T09:00:00Z')), '2026-12-01T18:00:00.000Z', 'GMT');
  assert.equal(live.defaultRedoBy(new Date('2026-12-01T23:30:00Z')), '2026-12-02T12:00:00.000Z', 'late night: noon the next day');
  assert.equal(live.defaultRedoBy(new Date('2026-10-24T19:00:00Z')), '2026-10-25T12:00:00.000Z', 'over the change from BST to GMT');
  const now = new Date('2026-10-15T09:00:00Z');
  assert.deepEqual(live.redoParts('2026-10-15T17:00:00.000Z'), { day: '2026-10-15', time: '18:00' });
  assert.equal(live.redoByLabel('2026-10-15T17:00:00.000Z', now), 'Redo by 18:00 today');
  assert.equal(live.redoByLabel('2026-10-16T11:00:00.000Z', now), 'Redo by Fri 16 Oct, 12:00');
  assert.equal(live.redoByLabel(null, now), null);
  assert.equal(live.redoByFrom('2026-10-15', '18:00', now), '2026-10-15T17:00:00.000Z');
  assert.equal(live.redoByFrom('2026-10-15', '09:00', now), null, 'in the past');
  assert.equal(live.redoByFrom('2026-10-30', '09:00', now), null, 'more than a week away');
  assert.equal(live.redoByFrom('2026-10-15', '6pm', now), null);
});

test('reviews: guest feedback only to reject; a rejection needs a redo time; the requests pass the server check', () => {
  const base = { accepted: true, formChecked: true, guestFeedback: '', reviewNote: 'Checked the photos' };
  assert.deepEqual(reviewBlockers(base), []);
  assert.deepEqual(reviewBlockers({ ...base, accepted: false, formChecked: false }), ['Add what the guest said (a few words).', 'Choose when the clean must be redone by, in the next seven days.']);
  assert.deepEqual(reviewBlockers({ ...base, accepted: false, guestFeedback: 'Guest saw crumbs', redoBy: '2026-10-15T17:00:00.000Z' }), []);
  const review = data => operationsActionSchema.safeParse({ action: 'updateOperation', requestId: id(), workId: id(), version: 3, step: 'reviewCleaning', data });
  assert.ok(review({ accepted: true, reviewNote: 'All checks fine' }).success, 'accept without guest feedback');
  assert.ok(review({ accepted: true, guestFeedback: 'Guests were happy', reviewNote: 'All checks fine' }).success);
  assert.ok(review({ accepted: false, guestFeedback: 'Guest saw crumbs', reviewNote: 'Floor not mopped', redoBy: '2026-10-15T17:00:00.000Z' }).success);
  assert.equal(review({ accepted: false, guestFeedback: 'Guest saw crumbs', reviewNote: 'Floor not mopped' }).success, false, 'reject needs redoBy');
  assert.equal(review({ accepted: false, reviewNote: 'Floor not mopped', redoBy: '2026-10-15T17:00:00.000Z' }).success, false, 'reject needs guest feedback');
  assert.equal(review({ accepted: true, reviewNote: 'All checks fine', redoBy: '2026-10-15T17:00:00.000Z' }).success, false, 'no redo time to accept');
  assert.equal(review({ accepted: false, guestFeedback: 'Guest saw crumbs', reviewNote: 'Floor not mopped', redoBy: '2026-10-15 18:00' }).success, false, 'an ISO time');
});

test('the generic review form adds the usual redo time to a rejection and leaves blank feedback out', () => {
  const src = read('lib/workflow-forms.ts');
  assert.match(src, /\.\.\.\(v\.accepted\?\{\}:\{redoBy:defaultRedoBy\(\)\}\)/);
  assert.match(src, /field\('guestFeedback','Guest feedback \(needed to reject\)','textarea',false\)/);
});

test('notices to the cleaner say what happened in plain words', () => {
  const expected = { 'cleaning.assigned': 'New clean for you', 'cleaning.unassigned': 'Clean taken off your list', 'cleaning.moved': 'Clean moved', 'cleaning.cancelled': 'Clean cancelled', 'cleaning.redo': 'Please redo a clean', 'cleaning.morning': 'Your cleans today' };
  for (const [event, title] of Object.entries(expected)) {
    assert.equal(noticeCopy(event).title, title, event);
    assert.match(noticeCopy(event).message, /Sign in to Recharge/);
    assert.ok(CLEANER_NOTICES.has(event), event);
  }
  // In Updates the row says what happened; the property is on the second line.
  const row = noticeRow({ id: 1, event_type: 'cleaning.moved', created_at: '2026-10-15T09:00:00Z', work_id: id(), work_title: 'Checkout clean', work_kind: 'cleaning', property_name: '110 Hawk', automatic: true });
  assert.equal(row.title, 'Clean moved'); assert.match(row.detail, /110 Hawk · Automatic/);
  assert.equal(noticeRow({ id: 2, event_type: 'cleaning.morning', created_at: '2026-10-15T06:00:00Z', automatic: true }).title, 'Your cleans today');
  // Other work keeps its "<kind>: <title>" row.
  assert.equal(noticeRow({ id: 3, event_type: 'cleaning.accepted', created_at: '2026-10-15T09:00:00Z', work_id: id(), work_title: 'Checkout clean', work_kind: 'cleaning' }).title, 'Clean: Checkout clean');
});

test('Hostaway check-in and checkout times come through the sync as HH:MM', () => {
  assert.equal(syncClock(15), '15:00'); assert.equal(syncClock('10'), '10:00'); assert.equal(syncClock('9:30'), '09:30');
  assert.equal(syncClock(24), null); assert.equal(syncClock(''), null); assert.equal(syncClock(undefined), null); assert.equal(syncClock('noon'), null);
  const raw = { id: 7001, listingMapId: 501, channelName: 'airbnbOfficial', status: 'new', arrivalDate: '2026-11-02', departureDate: '2026-11-05', currency: 'GBP', totalPrice: 480 };
  const withTimes = syncReservation({ ...raw, checkInTime: 16, checkOutTime: 10 });
  assert.equal(withTimes.checkInTime, '16:00'); assert.equal(withTimes.checkOutTime, '10:00');
  assert.ok(!('checkInTime' in syncReservation(raw)), 'left out when Hostaway has none');
});

test('the worker sends the morning notices every 15 minutes; new cleaners have no Clean invoices tool', () => {
  const worker = read('worker/index.ts');
  const morning = worker.indexOf("securityRpc('workspace_clean_morning_notices', {})"), quarter = worker.indexOf("if (controller.cron && controller.cron !== '*/15 * * * *') return;"), hourly = worker.indexOf('if (hourly) {');
  assert.ok(morning > quarter, 'in the 15-minute job');
  assert.ok(!(morning > hourly && morning < worker.indexOf('}', hourly + 200)), 'not only hourly');
  assert.deepEqual([...DEFAULT_ROLE_MODULES.cleans], ['cleaning-schedule', 'cleaner-performance']);
  assert.ok(DEFAULT_ROLE_MODULES.accounts.includes('cleans-invoices'));
});
