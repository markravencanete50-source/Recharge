import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// UK times either side of the clock change, the week and the timesheet flags, the spreadsheet, and
// the request rules for the rota, timesheets and times on work.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { londonInstant, londonClock, mondayOf, weekOf, shiftWeek, minutesLabel, validClock, timesheetRows, timesheetSummary, timesheetCsv } = await vite.ssrLoadModule('/lib/team-time.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { timeRange, calendarEntries } = await vite.ssrLoadModule('/lib/calendar-live.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('UK times: summer time and winter time, on and around the clock change', () => {
  assert.equal(londonInstant('2026-07-01', '09:00'), '2026-07-01T08:00:00.000Z');
  assert.equal(londonInstant('2026-12-01', '09:00'), '2026-12-01T09:00:00.000Z');
  assert.equal(londonInstant('2026-03-29', '09:00'), '2026-03-29T08:00:00.000Z', 'clocks went forward that night');
  assert.equal(londonInstant('2026-10-25', '09:00'), '2026-10-25T09:00:00.000Z', 'clocks went back that night');
  assert.equal(londonInstant('2026-10-24', '23:30'), '2026-10-24T22:30:00.000Z');
  for (const [day, clock] of [['2026-07-01', '08:15'], ['2026-12-31', '23:59'], ['2026-01-01', '00:00']]) assert.equal(londonClock(londonInstant(day, clock)), clock);
  assert.ok(validClock('07:05') && !validClock('7:05') && !validClock('24:00'));
  assert.equal(minutesLabel(485), '8h 05m');
});

test('weeks start on Monday', () => {
  assert.equal(mondayOf('2026-10-09'), '2026-10-05');
  assert.equal(mondayOf('2026-10-05'), '2026-10-05');
  assert.equal(mondayOf('2026-10-11'), '2026-10-05');
  assert.deepEqual(weekOf('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(shiftWeek('2026-10-05', -1), '2026-09-28');
});

test('timesheet days: missed, not on the rota, still on shift, corrected', () => {
  const shift = (n, extra = {}) => ({ id: id(n), department: 'cleaning', clockedInAt: '2026-10-06T07:00:00Z', clockedOutAt: '2026-10-06T15:00:00Z', minutes: 480, edited: false, editNote: '', ...extra });
  const person = { userId: id(1), fullName: 'Angela, "AJ"', role: 'cleans', active: true, department: 'cleaning', totalMinutes: 600, days: [
    { day: '2026-10-05', planned: { shift: 'early', department: 'cleaning', note: '' }, shifts: [], minutes: 0 },
    { day: '2026-10-06', planned: { shift: 'early', department: 'cleaning', note: '' }, shifts: [shift(2, { edited: true, editNote: 'Forgot to clock out' })], minutes: 480 },
    { day: '2026-10-07', planned: null, shifts: [shift(3, { clockedInAt: '2026-10-07T07:00:00Z', clockedOutAt: null, minutes: 120 })], minutes: 120 },
    { day: '2026-10-08', planned: { shift: 'off', department: null, note: 'Holiday' }, shifts: [], minutes: 0 },
    { day: '2026-10-09', planned: { shift: 'late', department: 'cleaning', note: '' }, shifts: [], minutes: 0 },
  ] };
  const rows = timesheetRows(person, '2026-10-09');
  assert.deepEqual(rows.map(r => [r.day, r.missed, r.unplanned, r.open, r.edited]), [
    ['2026-10-05', true, false, false, false],
    ['2026-10-06', false, false, false, true],
    ['2026-10-07', false, true, true, false],
    ['2026-10-08', false, false, false, false],
    ['2026-10-09', false, false, false, false],
  ], 'today is not missed yet, and a day off is never missed');
  assert.deepEqual(timesheetSummary(person, '2026-10-09'), { minutes: 600, daysWorked: 2, plannedDays: 3, missed: 1 });

  const csv = timesheetCsv({ from: '2026-10-05', to: '2026-10-11', canEdit: true, people: [person] });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '\ufeff"Name","Department","Date","Planned","Clocked in","Clocked out","Hours","Changed by an admin"');
  assert.equal(lines[1], '"Angela, ""AJ""","Cleaning","2026-10-05","Early","","","0",""', 'a planned day with nothing clocked');
  assert.equal(lines[2], '"Angela, ""AJ""","Cleaning","2026-10-06","Early","08:00","16:00","8.00","Forgot to clock out"');
  assert.equal(lines[3], '"Angela, ""AJ""","Cleaning","2026-10-07","","08:00","Still on shift","2.00",""');
  assert.equal(lines[4], '"Angela, ""AJ""","","2026-10-08","Off","","","0",""', 'a day off has no department');
  assert.equal(lines.at(-2), '"Angela, ""AJ""","Total","2026-10-05 to 2026-10-11","","","","10.00",""');
});

test('request rules for the register, the rota, timesheets and times on work', () => {
  const ok = input => teamsActionSchema.parse({ requestId: id(99), ...input });
  assert.throws(() => ok({ action: 'saveResponsibility', id: id(1), department: 'management', title: 'Payroll', ownerId: null, backupId: null, frequency: 'monthly' }), /version/i);
  assert.throws(() => ok({ action: 'planRota', userId: id(1), days: [] }));
  assert.throws(() => ok({ action: 'planRota', userId: id(1), days: [{ day: '2026-10-10', shift: 'night' }] }));
  assert.throws(() => ok({ action: 'addShift', userId: id(1), clockedInAt: '2026-10-08T16:00:00Z', clockedOutAt: '2026-10-08T08:00:00Z', department: 'cleaning', note: 'Backwards' }));
  assert.throws(() => ok({ action: 'setWorkTime', workId: id(1), version: 1, dueOn: '2026-10-10', startTime: null, endTime: '10:00' }));
  assert.throws(() => ok({ action: 'setWorkTime', workId: id(1), version: 1, dueOn: '2026-10-10', startTime: '9:00', endTime: null }));
  ok({ action: 'setWorkTime', workId: id(1), version: 1, dueOn: '2026-10-10', startTime: '09:00', endTime: '09:30' });
  ok({ action: 'planRota', userId: id(1), days: [{ day: '2026-10-10', shift: null }, { day: '2026-10-11', shift: 'off', note: 'Holiday' }] });
  assert.throws(() => teamsReadSchema.parse({ section: 'timesheet', from: '2026-10-01', to: '2026-11-05' }), /31 days/);
  assert.throws(() => teamsReadSchema.parse({ section: 'rotaPlan' }), /dates/);
  teamsReadSchema.parse({ section: 'timesheet', from: '2026-10-01', to: '2026-10-31' });
});

test('calendar entries show their time and sort by it within a day', () => {
  assert.equal(timeRange('10:00', '14:00'), '10:00–14:00');
  assert.equal(timeRange('10:00', null), '10:00');
  assert.equal(timeRange(null, null), null);
  const work = (n, dueTime, endTime = null) => ({ workId: id(n), propertyId: id(900), propertyName: 'Flat', moduleId: null, title: 'W' + n, status: 'waiting', dueOn: '2026-10-10', dueTime, endTime, assigneeId: null, assigneeName: null, kind: null, version: 1 });
  const entries = calendarEntries({ from: '2026-10-01', to: '2026-10-31', work: [work(1, '14:00'), work(2, null), work(3, '09:00', '10:00')], stays: [], payments: [] });
  assert.deepEqual(entries.map(e => [e.title, e.time, e.endTime]), [['W2', null, null], ['W3', '09:00', '10:00'], ['W1', '14:00', null]]);
});
