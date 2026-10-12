import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The team calendar (client ask A9): guest names on stays, changeovers, team events, where each person is,
// the month grid with counts, week bars per property, and the screens that use them.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const cal = await vite.ssrLoadModule('/lib/calendar-live.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(90), B = id(91), C = id(92);

const work = (n, propertyId, propertyName, dueOn, extra = {}) => ({ workId: id(n), propertyId, propertyName, moduleId: 'cleaning-schedule', title: 'Clean', status: 'waiting', dueOn, dueTime: null, endTime: null, assigneeId: null, assigneeName: null, kind: 'cleaning', version: 1, ...extra });
const stay = (reservationId, propertyId, propertyName, checkIn, checkOut, extra = {}) => ({ reservationId, propertyId, propertyName, checkIn, checkOut, guests: 2, channel: 'airbnb', ...extra });
const schedule = cal.calendarScheduleSchema.parse({
  work: [
    work(1, A, 'Harbour Flat', '2026-10-12', { dueTime: '11:00', endTime: '13:00', assigneeId: id(50), assigneeName: 'Cleo' }),
    work(2, A, 'Harbour Flat', '2026-10-12', { status: 'cancelled' }),
    work(3, B, 'Castle Loft', '2026-10-13'),
    work(4, A, 'Harbour Flat', '2026-10-13', { kind: 'maintenance', moduleId: 'maintenance-reporting', title: 'Boiler' }),
  ],
  stays: [
    stay('r1', A, 'Harbour Flat', '2026-10-09', '2026-10-12', { guestName: 'Maria Lopez' }),
    stay('r2', A, 'Harbour Flat', '2026-10-12', '2026-10-15'),
    stay('r3', A, 'Harbour Flat', '2026-10-20', '2026-10-22', { guestName: null }),
    stay('r4', B, 'Castle Loft', '2026-10-10', '2026-10-12', { guestName: '  Sam Ray ' }),
    stay('r5', C, 'Dock House', '2026-10-17', '2026-10-21'),
  ],
});

test('stay labels use the guest name when there is one and a plain label when there is not', () => {
  const [named, plain, nulled, padded] = schedule.stays;
  assert.equal(cal.stayLabel(named), 'Maria Lopez');
  assert.equal(cal.stayLabel(plain), 'Guest stay', 'a schedule without guestName still parses');
  assert.equal(cal.stayLabel(nulled), 'Guest stay');
  assert.equal(cal.stayLabel(padded), 'Sam Ray');
  assert.equal(cal.guestNameOf(plain), '');
  assert.equal(cal.stayNights(named), 3);
  assert.equal(cal.stayDates(named), '9 Oct to 12 Oct');
  assert.equal(cal.stayDetail(named), '9 Oct to 12 Oct · 3 nights · 2 guests');
  assert.equal(cal.stayDetail({ checkIn: '2026-10-09', checkOut: '2026-10-10', guests: 1 }), '9 Oct to 10 Oct · 1 night · 1 guest');
  const entries = cal.calendarEntries(schedule);
  const title = (id_) => cal.entryTitle(entries.find(e => e.id === id_));
  assert.equal(title('in:r1'), 'Maria Lopez arrives');
  assert.equal(title('out:r1'), 'Maria Lopez leaves');
  assert.equal(title('in:r2'), 'Guests arrive', 'no name keeps the old wording');
  assert.equal(title('out:r2'), 'Guests leave');
  assert.equal(title('w:' + id(1)), 'Clean', 'work keeps its title');
  assert.equal(entries.find(e => e.id === 'in:r1').title, 'Guests arrive', 'calendarEntries itself is unchanged');
});

test('changeovers: each departure with the next arrival at the same property and its clean, same-day first', () => {
  const list = cal.changeoversFor('2026-10-12', schedule);
  assert.deepEqual(list.map(c => c.out.reservationId), ['r1', 'r4'], 'a same-day changeover comes before a departure with no arrival');
  const [flat, loft] = list;
  assert.equal(flat.propertyName, 'Harbour Flat');
  assert.equal(flat.next.reservationId, 'r2');
  assert.ok(flat.sameDay);
  assert.equal(flat.gapDays, 0);
  assert.equal(flat.clean.workId, id(1), 'the cancelled clean is ignored');
  assert.equal(flat.clean.assigneeName, 'Cleo');
  assert.equal(flat.cleanState, 'assigned');
  assert.equal(loft.next, null);
  assert.ok(!loft.sameDay);
  assert.equal(loft.gapDays, null);
  assert.equal(loft.clean.workId, id(3), 'with no arrival the clean of the following day counts');
  assert.equal(loft.cleanState, 'unassigned');
  // The next arrival can be days away; there the clean must fall before it.
  const gap = cal.changeoversFor('2026-10-15', schedule);
  assert.equal(gap.length, 1);
  assert.equal(gap[0].next.reservationId, 'r3');
  assert.equal(gap[0].gapDays, 5);
  assert.equal(gap[0].clean, null);
  assert.equal(gap[0].cleanState, 'none');
  assert.deepEqual(cal.changeoversFor('2026-10-16', schedule), []);
  // A run of days.
  assert.deepEqual(cal.changeoversBetween('2026-10-10', '2026-10-22', schedule).map(c => c.day + ' ' + c.out.reservationId), ['2026-10-12 r1', '2026-10-12 r4', '2026-10-15 r2', '2026-10-21 r5', '2026-10-22 r3']);
  assert.equal(cal.cleanStateOf({ status: 'completed', assigneeId: null }), 'done');
  assert.equal(cal.cleanStateOf({ status: 'in_review', assigneeId: id(1) }), 'review');
  assert.equal(cal.cleanStateOf({ status: 'in_progress', assigneeId: id(1) }), 'in_progress');
});

test('filters by property, and the property list', () => {
  assert.deepEqual(cal.calendarProperties(schedule), [[B, 'Castle Loft'], [C, 'Dock House'], [A, 'Harbour Flat']]);
  const one = cal.scheduleFor(schedule, B);
  assert.deepEqual(one.stays.map(s => s.reservationId), ['r4']);
  assert.deepEqual(one.work.map(w => w.workId), [id(3)]);
  assert.equal(cal.scheduleFor(schedule, ''), schedule);
  const entries = cal.calendarEntries(schedule);
  assert.ok(cal.filterProperty(entries, A).every(e => e.propertyId === A));
  assert.equal(cal.filterProperty(entries, null), entries);
});

const event = (n, userId, fullName, kind, title, startsOn, endsOn, extra = {}) => ({ id: id(n), userId, fullName, role: 'stays', kind, title, startsOn, endsOn, startTime: null, endTime: null, location: '', mine: false, version: 1, ...extra });
const ANN = id(61), BEN = id(62), CAT = id(63), DEE = id(64), EVE = id(65);
const rota = {
  people: [
    { userId: ANN, fullName: 'Ann', role: 'stays', department: 'guest_relations', usualShift: 'early', days: [{ day: '2026-10-12', shift: 'early', department: 'guest_relations', note: '' }] },
    { userId: BEN, fullName: 'Ben', role: 'ready', department: 'ready', usualShift: 'late', days: [{ day: '2026-10-12', shift: 'late', department: 'ready', note: '' }] },
    { userId: CAT, fullName: 'Cat', role: 'cleans', department: 'cleaning', usualShift: null, days: [{ day: '2026-10-12', shift: 'off', department: null, note: 'Holiday' }] },
    { userId: DEE, fullName: 'Dee', role: 'accounts', department: 'accounts', usualShift: null, days: [] },
  ],
};
const events = [
  event(1, ANN, 'Ann', 'absence', 'Annual leave', '2026-10-11', '2026-10-13'),
  event(2, BEN, 'Ben', 'meeting', 'Owner call', '2026-10-12', '2026-10-12', { startTime: '10:00', endTime: '11:00', location: 'Office' }),
  event(3, EVE, 'Eve', 'training', 'First aid', '2026-10-12', '2026-10-12'),
  event(4, ANN, 'Ann', 'away', 'Dentist', '2026-10-14', '2026-10-14', { startTime: '09:00', endTime: '12:00' }),
];

test('the team events read parses, tolerating missing times and places', () => {
  const read = cal.teamEventsSchema.parse({ from: '2026-10-01', to: '2026-11-11', canEditAll: true, events: [{ id: id(1), userId: ANN, fullName: 'Ann', role: 'stays', kind: 'absence', title: 'Leave', startsOn: '2026-10-11', endsOn: '2026-10-13', startTime: null, endTime: null, location: '', mine: true, version: 2 }] });
  assert.equal(read.canEditAll, true);
  assert.equal(read.events[0].startTime, null);
  assert.throws(() => cal.teamEventsSchema.parse({ from: 'a', to: 'b', events: [{ ...read.events[0], kind: 'holiday' }] }));
  assert.deepEqual(cal.teamEventsSchema.parse({ from: 'a', to: 'b' }).events, []);
});

test('events on a day: those that span it, whole-day ones first', () => {
  assert.deepEqual(cal.eventsOn('2026-10-12', events).map(e => e.title), ['Annual leave', 'First aid', 'Owner call']);
  assert.deepEqual(cal.eventsOn('2026-10-12', events, BEN).map(e => e.title), ['Owner call']);
  assert.deepEqual(cal.eventsOn('2026-10-14', events).map(e => e.title), ['Dentist']);
  assert.deepEqual(cal.eventsOn('2026-10-10', events), []);
  assert.equal(cal.eventIsAllDay(events[0], '2026-10-12'), true);
  assert.equal(cal.eventIsAllDay(events[1], '2026-10-12'), false);
  assert.equal(cal.eventClock(events[1], '2026-10-12'), '10:00 to 11:00');
  assert.equal(cal.eventClock(events[0], '2026-10-12'), null);
  assert.equal(cal.eventDates(events[0]), 'Sun 11 Oct to Tue 13 Oct');
  assert.equal(cal.eventDates(events[1]), 'Mon 12 Oct');
});

test('who is where: rota shifts, absences that fill the day, meetings, off days and people only in events', () => {
  const day = cal.whoIsWhere('2026-10-12', rota, events);
  assert.deepEqual(day.map(x => x.fullName + ':' + x.status), ['Ben:working', 'Ann:away', 'Cat:off', 'Dee:unplanned', 'Eve:unplanned']);
  const [ben, ann, cat, dee, eve] = day;
  assert.equal(ben.label, 'Late shift (3pm to 11pm)');
  assert.deepEqual(ben.events.map(e => e.title), ['Owner call'], 'a meeting does not make someone away');
  assert.equal(ann.label, 'Absence: Annual leave', 'an absence beats the rota');
  assert.equal(ann.shift, 'early', 'but the shift stays visible');
  assert.equal(cat.label, 'Off: Holiday');
  assert.equal(dee.label, 'Not on the rota');
  assert.equal(eve.role, 'stays');
  assert.deepEqual(eve.events.map(e => e.title), ['First aid']);
  // A few hours away does not take the whole day.
  assert.equal(cal.whoIsWhere('2026-10-14', { people: [{ ...rota.people[0], days: [{ day: '2026-10-14', shift: 'early', department: null, note: '' }] }] }, events)[0].status, 'working');
  // Without a rota, event people still show.
  assert.deepEqual(cal.whoIsWhere('2026-10-12', null, events).map(x => x.fullName).sort(), ['Ann', 'Ben', 'Eve']);
  assert.equal(cal.whoIsWhere('2026-10-12', null, events).find(x => x.fullName === 'Ann').status, 'away');
  const week = cal.whoIsWhereWeek(cal.weekDays('2026-10-12'), rota, events);
  assert.deepEqual(week.map(r => r.fullName), ['Ann', 'Ben', 'Cat', 'Dee', 'Eve']);
  assert.ok(week.every(r => r.days.length === 7));
  assert.equal(week[0].days[1].status, 'away', 'Ann has no shift on the 13th but her leave still marks her away');
});

test('the month grid counts entries and team events per day, across month boundaries', () => {
  const small = cal.calendarScheduleSchema.parse({
    work: [work(10, A, 'Harbour Flat', '2026-10-31')],
    stays: [stay('s1', A, 'Harbour Flat', '2026-09-30', '2026-10-03'), stay('s2', A, 'Harbour Flat', '2026-11-02', '2026-11-04')],
  });
  const entries = cal.calendarEntries(small);
  const spanning = [event(20, ANN, 'Ann', 'absence', 'Leave', '2026-10-30', '2026-11-03')];
  const grid = cal.monthCounts('2026-10', entries, spanning);
  assert.equal(grid.weeks.length, 6);
  assert.ok(grid.weeks.every(w => w.length === 7));
  assert.equal(grid.from, '2026-09-28', 'weeks start on Monday');
  assert.equal(grid.to, '2026-11-08');
  const cells = new Map(grid.weeks.flat().map(c => [c.date, c]));
  assert.equal(cells.size, 42);
  assert.deepEqual(cells.get('2026-09-30').counts, { 'check-in': 1 }, 'a day of the month before is counted');
  assert.equal(cells.get('2026-09-30').inMonth, false);
  assert.equal(cells.get('2026-10-03').counts['check-out'], 1);
  assert.equal(cells.get('2026-10-03').inMonth, true);
  assert.deepEqual(cells.get('2026-10-30').counts, { event: 1 });
  assert.deepEqual(cells.get('2026-10-31').counts, { clean: 1, event: 1 });
  assert.equal(cells.get('2026-10-31').total, 2);
  assert.deepEqual(cells.get('2026-11-02').counts, { 'check-in': 1, event: 1 }, 'an event that spans the boundary counts on the days of both months');
  assert.equal(cells.get('2026-11-03').total, 1);
  assert.equal(cells.get('2026-11-04').counts['check-out'], 1);
  assert.equal(cells.get('2026-11-04').counts.event, undefined);
  assert.equal(cells.get('2026-10-10').total, 0);
  // Payment runs count each statement.
  const pay = cal.calendarScheduleSchema.parse({ work: [], stays: [], payments: [
    { statementId: id(7), propertyId: A, propertyName: 'Harbour Flat', period: '2026-09', status: 'paid', payoutMinor: 1, date: '2026-10-05', issuedAt: null, paidAt: null, reference: null },
    { statementId: id(8), propertyId: B, propertyName: 'Castle Loft', period: '2026-09', status: 'draft', payoutMinor: 1, date: '2026-10-05', issuedAt: null, paidAt: null, reference: null }] });
  assert.equal(new Map(cal.monthCounts('2026-10', cal.calendarEntries(pay)).weeks.flat().map(c => [c.date, c])).get('2026-10-05').counts.payment, 2);
  // The week holding a day.
  assert.deepEqual(cal.weekDays('2026-10-14'), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(cal.weekStart('2026-10-18'), '2026-10-12', 'Sunday belongs to the week before');
  assert.equal(cal.shiftWeekDay('2026-10-14', -1), '2026-10-07');
  assert.equal(cal.weekRangeLabel('2026-10-14'), '12 to 18 Oct 2026');
  assert.equal(cal.weekRangeLabel('2026-11-30'), '30 Nov to 6 Dec 2026', 'a week across two months names both');
  const week = cal.weekCounts('2026-11-02', entries, spanning);
  assert.equal(week.from, '2026-11-02');
  assert.equal(week.days[0].counts['check-in'], 1);
  assert.equal(week.days[0].counts.event, 1);
  assert.equal(week.days[6].inMonth, true);
  assert.equal(cal.weekCounts('2026-10-28', entries, spanning).days.find(d => d.date === '2026-11-01').inMonth, false);
});

test('booking bars per property across a week, with cleans and repairs as marks', () => {
  const days = cal.weekDays('2026-10-14');
  const rows = cal.timelineRows(days, schedule);
  assert.deepEqual(rows.map(r => r.propertyName), ['Castle Loft', 'Dock House', 'Harbour Flat']);
  const [loft, dock, flat] = rows;
  assert.deepEqual(loft.bars, [], 'a stay that ended before the week is not drawn');
  assert.deepEqual(dock.bars.map(b => [b.reservationId, b.startCol, b.span, b.fromBefore, b.toAfter]), [['r5', 5, 2, false, true]], 'it runs past the end of the week');
  assert.deepEqual(flat.bars.map(b => [b.reservationId, b.label, b.startCol, b.span, b.fromBefore]), [['r2', 'Guest stay', 0, 3, false]], 'nights 12, 13 and 14 fill the first three columns');
  assert.deepEqual(flat.marks.map(m => [m.kind, m.col]), [['clean', 0], ['repair', 1]]);
  assert.deepEqual(loft.marks.map(m => [m.kind, m.col]), [['clean', 1]]);
  // Back to back stays sit side by side, never over each other.
  const backToBack = cal.calendarScheduleSchema.parse({ work: [], stays: [stay('x', A, 'Harbour Flat', '2026-10-12', '2026-10-14', { guestName: 'Ada' }), stay('y', A, 'Harbour Flat', '2026-10-14', '2026-10-16')] });
  const [row] = cal.timelineRows(days, backToBack);
  assert.deepEqual(row.bars.map(b => [b.label, b.startCol, b.span]), [['Ada', 0, 2], ['Guest stay', 2, 2]]);
  assert.deepEqual(cal.timelineRows([], schedule), []);
  assert.deepEqual(cal.timelineRows(days, { work: [], stays: [], payments: [] }), []);
});

const source = path => readFileSync(path, 'utf8');
test('the screens: four views for staff, a team events sheet with safe actions, no browser dialogs', () => {
  const calendar = source('mobile/src/LiveCalendar.tsx'), sheet = source('mobile/src/TeamEvents.tsx');
  for (const mode of ['month', 'week', 'changeovers', 'team']) assert.match(calendar, new RegExp('"' + mode + '"'));
  assert.match(calendar, /const staff = account\.role !== "client"/);
  assert.match(calendar, /section: "teamEvents"/);
  assert.match(calendar, /section: "rotaPlan"/);
  assert.match(calendar, /changeoversBetween/);
  assert.match(calendar, /TeamEventSheet/);
  assert.match(calendar, /WhoIsWhere/);
  assert.match(calendar, /entryTitle\(/);
  assert.match(sheet, /action: "saveTeamEvent"/);
  assert.match(sheet, /action: "cancelTeamEvent"/);
  assert.match(sheet, /useRequestId/);
  assert.match(sheet, /canEditAll/);
  assert.match(sheet, /YYYY-MM-DD/);
  for (const text of [calendar, sheet]) assert.doesNotMatch(text, /Alert\.alert|window\.confirm|window\.alert|\bconfirm\(/);
});

test('no em dashes, and the TypeScript files keep their CRLF line endings', () => {
  for (const path of ['lib/calendar-live.ts', 'mobile/src/LiveCalendar.tsx', 'mobile/src/TeamEvents.tsx', 'tests/team-calendar.test.mjs']) {
    const text = source(path);
    assert.ok(!text.includes(String.fromCharCode(8212)), path + ' has an em dash');
    if (path.endsWith('.ts') || path.endsWith('.tsx')) assert.ok(!/[^\r]\n/.test(text), path + ' has a lone LF');
    else assert.ok(!text.includes('\r'), path + ' should be LF');
  }
});
