import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The Productivity Tool's sums and wording (lib/productivity.ts) and where the tool lives.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { weeksOfMonth, monthsOf, describeChange, hoursShort, minutesDelta, productivityCsv, teamWeek, teamMonth, averageWeek, calendarWeeks, dayTotals, dayPeople, ukHours } = await vite.ssrLoadModule('/lib/productivity.ts');
const { homeToolsFor, panelToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { productivitySchema, timesheetSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
after(() => vite.close());

const person = (name, weeks, months, extra = {}) => ({ userId: crypto.randomUUID(), fullName: name, role: 'stays', department: 'guest_relations', active: true, onShift: false,
  minutes: months.reduce((s, m) => s + m.minutes, 0), shifts: 0, days: 0, weeks, months, ...extra });

test('weeks of a month start on the Monday before (or on) the 1st', () => {
  assert.deepEqual(weeksOfMonth('2026-10'), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(weeksOfMonth('2026-06'), ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
  assert.equal(monthsOf(2026).length, 12);
  assert.equal(monthsOf(2026)[11], '2026-12');
});

test('team totals, averages and the spreadsheet', () => {
  const data = productivitySchema.parse({ from: '2026-01-01', to: '2026-12-31', canEdit: true, canApprove: false, pending: 0, people: [
    person('Fiona', [{ start: '2026-10-05', minutes: 2400, shifts: 5, days: 5 }], [{ month: '2026-10', minutes: 2400, shifts: 5, days: 5 }]),
    person('=Callum', [{ start: '2026-10-05', minutes: 600, shifts: 2, days: 2 }], [{ month: '2026-10', minutes: 600, shifts: 2, days: 2 }]),
  ] });
  assert.equal(teamWeek(data, '2026-10-05'), 3000);
  assert.equal(teamMonth(data, '2026-10'), 3000);
  assert.equal(teamMonth(data, '2026-09'), 0);
  assert.equal(averageWeek(data.people[0], '2026-10-05', '2026-12-31', '2026-10-11'), 2400, 'weeks still to come are not counted');
  const csv = productivityCsv(data, 'week', weeksOfMonth('2026-10'));
  const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(rows[0], 'Name,Department,w/c 28 Sept,w/c 5 Oct,w/c 12 Oct,w/c 19 Oct,w/c 26 Oct,Total hours,Shifts,Days worked');
  assert.equal(rows[1], 'Fiona,Guest relations,0.00,40.00,0.00,0.00,0.00,40.00,0,0');
  assert.ok(rows[2].startsWith(`"'=Callum"`), 'a name that looks like a formula stays text');
});

test('a change reads as before → after with its difference', () => {
  const change = { id: crypto.randomUUID(), kind: 'edit', status: 'pending', shiftId: crypto.randomUUID(), userId: crypto.randomUUID(), fullName: 'Fiona', department: 'guest_relations',
    clockedInAt: '2026-10-08T07:00:00.000Z', clockedOutAt: '2026-10-08T16:30:00.000Z', before: { clockedInAt: '2026-10-08T07:45:00.000Z', clockedOutAt: '2026-10-08T15:30:00.000Z', department: 'guest_relations' },
    note: 'Covered the late check-in', requestedBy: crypto.randomUUID(), requestedByName: 'Morag', requestedAt: '2026-10-09T09:00:00Z', decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: '' };
  const d = describeChange(change);
  assert.match(d.day, /^Thu,? 8 Oct 2026$/);
  assert.deepEqual([d.before, d.after, d.delta, d.moved], ['08:45–16:30', '08:00–17:30', 105, null]);
  assert.equal(minutesDelta(d.delta), '+1h 45m');
  assert.equal(minutesDelta(-30), '−30m');
  assert.equal(hoursShort(480), '8h');
  const added = describeChange({ ...change, kind: 'add', before: null, shiftId: null });
  assert.equal(added.before, null);
  assert.equal(added.delta, 570);
});

test('Productivity is a management tool in the left panel and search, not a Home tile', () => {
  for (const role of ['admin', 'super_admin']) {
    assert.ok(panelToolsFor(role, []).some(t => t.key === 'productivity'), role);
    assert.equal(homeToolsFor(role, []).some(t => t.key === 'productivity'), false, role + ' keeps Home to three rows');
    const management = rolePanel(role, []).groups.find(g => g.title === 'Management');
    assert.ok(management.links.some(l => l.key === 'tool:productivity'), role);
  }
  // Nobody else has Productivity. The Stays team's panel-only tools without a module are Furnishing Studio (role-gated),
  // Property onboarding and their calendars (Alex's menu); Client enquiries still needs its module.
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client']) assert.equal(panelToolsFor(role, []).some(t => t.key === 'productivity'), false, role);
  assert.deepEqual(panelToolsFor('stays', []).map(t => t.key), ['studio', 'onboarding', 'calendar-ready', 'calendar-stays', 'calendar-cleans', 'calendar-safety', 'calendar-onboarding']);
  assert.deepEqual(panelToolsFor('cleans', []).map(t => t.key), ['calendar-cleans']);
  assert.deepEqual(panelToolsFor('client', []).map(t => t.key), ['statements', 'booking-calendar']);
});

test('the calendar: whole weeks, and each day\'s hours, people, missed days and changes waiting', () => {
  const weeks = calendarWeeks('2026-10');
  assert.equal(weeks.length, 5);
  assert.deepEqual([weeks[0][0], weeks[0][6], weeks[4][6]], ['2026-09-28', '2026-10-04', '2026-11-01']);
  assert.equal(ukHours('2026-10-08T07:30:00.000Z'), 8.5, 'BST: 07:30 UTC is 08:30 in the UK');
  const person = (name, days) => ({ userId: crypto.randomUUID(), fullName: name, role: 'stays', department: 'guest_relations', active: true, totalMinutes: 0, days });
  const shift = (from, to, minutes) => ({ id: crypto.randomUUID(), department: 'guest_relations', clockedInAt: from, clockedOutAt: to, minutes, edited: false, editNote: '' });
  const fiona = person('Fiona', [{ day: '2026-10-08', planned: { shift: 'early', department: 'guest_relations', note: '' }, minutes: 480, shifts: [shift('2026-10-08T07:00:00Z', '2026-10-08T15:00:00Z', 480)] }]);
  const callum = person('Callum', [{ day: '2026-10-08', planned: { shift: 'late', department: 'guest_relations', note: '' }, minutes: 0, shifts: [] }]);
  const isla = person('Isla', [{ day: '2026-10-09', planned: null, minutes: 60, shifts: [shift('2026-10-09T08:00:00Z', null, 60)] }]);
  const sheet = timesheetSchema.parse({ from: '2026-10-01', to: '2026-10-31', canEdit: true, people: [callum, fiona, isla], pending: [] });
  const totals = dayTotals(sheet, '2026-10-10');
  assert.deepEqual(totals.get('2026-10-08'), { minutes: 480, people: 1, shifts: 1, missed: 1, waiting: 0, open: 0 });
  assert.deepEqual(totals.get('2026-10-09'), { minutes: 60, people: 1, shifts: 1, missed: 0, waiting: 0, open: 1 });
  assert.deepEqual(dayPeople(sheet, '2026-10-08', '2026-10-10').map(x => x.person.fullName), ['Fiona', 'Callum'], 'who clocked in first, then who was planned but did not');
  assert.deepEqual(dayPeople(sheet, '2026-10-11', '2026-10-10'), []);
});
