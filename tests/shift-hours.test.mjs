import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The one rule for counting shift hours (lib/shift-hours.ts, migration 20261025600000): clipped to the period, and a
// shift left open counts up to 16 hours and is flagged "Did not clock out".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const H = await vite.ssrLoadModule('/lib/shift-hours.ts');
const { londonInstant } = await vite.ssrLoadModule('/lib/team-time.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { dayTotals } = await vite.ssrLoadModule('/lib/productivity.ts');
after(() => vite.close());

const at = (day, clock) => londonInstant(day, clock);
const now = Date.parse(at('2026-10-20', '10:00'));

test("Erika's shift: clocked in Thu 15 Oct 08:39, never out, now Tue 20 Oct", () => {
  const erika = { clockedInAt: at('2026-10-15', '08:39'), clockedOutAt: null };
  assert.equal(H.isStaleOpen(erika, now), true);
  assert.equal(H.shiftState(erika, now), 'not_clocked_out');
  assert.equal(H.dayMinutes(erika, '2026-10-15', now), 15 * 60 + 21, 'the day view of 15 Oct counts at most 15h 21m');
  assert.equal(H.dayMinutes(erika, '2026-10-16', now), 39, 'the 16 hours run to 00:39 on Friday');
  assert.equal(H.dayMinutes(erika, '2026-10-17', now), 0);
  assert.equal(Math.round(H.countedMinutes(erika, null, now)), 16 * 60, 'counted up to 16 hours, never more');
  assert.equal(Math.round(H.countedMinutes(erika, H.ukPeriodWindow('2026-10-12', '2026-10-18'), now)), 16 * 60, 'the week holds the same 16 hours');
  assert.deepEqual(H.shiftDays(erika, now), ['2026-10-15', '2026-10-16']);
  assert.equal(H.shiftSpan(erika, now), 'Thu 08:39 - did not clock out');
  assert.deepEqual(H.shiftEnds(erika, now), { in: 'Thu 08:39', out: 'Did not clock out', state: 'not_clocked_out' });
  assert.equal(H.COUNTED_UNTIL_CORRECTED, 'Counted up to 16h until corrected');
  assert.deepEqual(H.dayHours(erika, '2026-10-15', now), { from: 8 + 39 / 60, to: 24 });
});

test('an open shift under the limit is on shift and counts up to now', () => {
  const s = { clockedInAt: at('2026-10-20', '08:00'), clockedOutAt: null };
  assert.equal(H.shiftState(s, now), 'on_shift');
  assert.equal(H.dayMinutes(s, '2026-10-20', now), 120);
  assert.equal(H.shiftSpan(s, now), '08:00 - now');
});

test('a shift across midnight: each day counts its own part, labels carry the day', () => {
  const s = { clockedInAt: at('2026-10-15', '22:00'), clockedOutAt: at('2026-10-16', '02:10') };
  assert.equal(H.dayMinutes(s, '2026-10-15', now), 120);
  assert.equal(H.dayMinutes(s, '2026-10-16', now), 130);
  assert.equal(H.shiftSpan(s, now), 'Thu 22:00 - Fri 02:10');
  assert.deepEqual(H.dayHours(s, '2026-10-16', now), { from: 0, to: 2 + 10 / 60 });
  assert.equal(H.shiftSpan({ clockedInAt: at('2026-10-15', '08:39'), clockedOutAt: at('2026-10-15', '16:00') }, now), '08:39 - 16:00');
  // Unpaid pauses come off only inside the window.
  const pauses = [{ startedAt: at('2026-10-15', '23:30'), endedAt: at('2026-10-16', '00:30') }];
  assert.equal(H.dayMinutes(s, '2026-10-15', now, pauses), 90);
  assert.equal(H.dayMinutes(s, '2026-10-16', now, pauses), 100);
  // A day never holds more than 24 hours, even for the longest shift allowed.
  const long = { clockedInAt: at('2026-10-14', '06:00'), clockedOutAt: at('2026-10-15', '06:00') };
  assert.ok(H.dayMinutes(long, '2026-10-14', now) <= 24 * 60);
  // The clocks going back (25 October 2026): the day is 25 hours long, a day-length shift still counts once.
  assert.equal(H.ukDayWindow('2026-10-25').to - H.ukDayWindow('2026-10-25').from, 25 * 3600000);
});

test('correcting a shift: own date and time each end, after clock in, over 16 hours confirmed, never over 24', () => {
  const check = (from, to, confirmedLong = false) => H.checkShiftTimes({ clockedInAt: from, clockedOutAt: to, confirmedLong, now });
  // John, 15 Oct: 14:56 to 14:55 the same day is refused, not read as after midnight.
  assert.equal(check(at('2026-10-15', '14:56'), at('2026-10-15', '14:55')).error, 'Clock out must be after clock in.');
  assert.equal(check(at('2026-10-15', '14:56'), at('2026-10-15', '14:56')).error, 'Clock out must be after clock in.');
  const long = check(at('2026-10-15', '14:56'), at('2026-10-16', '14:55'));
  assert.deepEqual([long.error, long.needsConfirm, long.minutes], ['This shift is over 16 hours. Is that right?', true, 23 * 60 + 59]);
  assert.deepEqual(check(at('2026-10-15', '14:56'), at('2026-10-16', '14:55'), true), { error: null, needsConfirm: false, minutes: 23 * 60 + 59 });
  assert.match(check(at('2026-10-15', '08:00'), at('2026-10-16', '08:01'), true).error, /at most 24 hours/);
  assert.deepEqual(check(at('2026-10-15', '08:00'), at('2026-10-15', '16:30')), { error: null, needsConfirm: false, minutes: 510 });
  assert.match(check(at('2026-10-20', '09:00'), at('2026-10-20', '11:00')).error, /future/);
  assert.match(H.checkShiftTimes({ clockedInAt: at('2026-10-15', '08:00'), clockedOutAt: null, now }).error, /clocked out/);
  assert.equal(H.checkShiftTimes({ clockedInAt: at('2026-10-15', '08:00'), clockedOutAt: null, open: true, now }).error, null);
  assert.equal(H.fullStamp(at('2026-10-15', '14:56')), '15 Oct 2026, 14:56');
  // The same rule in the request the app sends.
  const base = { action: 'addShift', requestId: crypto.randomUUID(), userId: crypto.randomUUID(), department: 'guest_relations', note: 'Forgot to clock in' };
  assert.throws(() => teamsActionSchema.parse({ ...base, clockedInAt: at('2026-10-15', '14:56'), clockedOutAt: at('2026-10-16', '14:55') }), /over 16 hours/);
  assert.ok(teamsActionSchema.parse({ ...base, clockedInAt: at('2026-10-15', '14:56'), clockedOutAt: at('2026-10-16', '14:55'), confirmLong: true }));
  assert.throws(() => teamsActionSchema.parse({ ...base, clockedInAt: at('2026-10-15', '08:00'), clockedOutAt: at('2026-10-16', '09:00'), confirmLong: true }), /at most 24 hours/);
});

test('the day view: a shift left open needs attention, not "on shift"', () => {
  const shift = (id, extra) => ({ id, department: 'guest_relations', clockedInAt: at('2026-10-15', '08:39'), clockedOutAt: null, minutes: 921, edited: false, editNote: '', overtimeFrom: null, unpaidMinutes: 0, pauses: [], stale: true, countedUntil: at('2026-10-16', '00:39'), ...extra });
  const sheet = { from: '2026-10-01', to: '2026-10-31', canEdit: true, canApprove: true, pending: [], people: [
    { userId: crypto.randomUUID(), fullName: 'Erika Mendoza', role: 'stays', department: 'guest_relations', active: true, totalMinutes: 960, days: [{ day: '2026-10-15', planned: null, minutes: 921, shifts: [shift('a')] }] },
  ] };
  const t = dayTotals(sheet, '2026-10-20').get('2026-10-15');
  assert.deepEqual([t.minutes, t.open, t.stale], [921, 0, 1]);
  assert.ok(t.minutes <= 24 * 60);
});

test('the correction, add and end-shift sheets: own date and time each end, dated stamps, a yes over 16 hours', async () => {
  const { readFileSync } = await import('node:fs');
  const team = readFileSync('mobile/src/LiveTeamTime.tsx', 'utf8');
  const sheet = team.slice(team.indexOf('export function ShiftSheet'));
  for (const label of ['"Clock in date"', '"Clock out date"', 'Clock in time (HH:MM)', 'Clock out time (HH:MM']) assert.ok(sheet.includes(label), label);
  assert.match(sheet, /checkShiftTimes\(/);
  assert.match(sheet, /Clock in: \{fullStamp\(clockedInAt\)\}/);
  assert.match(sheet, /Clock out: \{clockedOutAt \? fullStamp\(clockedOutAt\)/);
  assert.match(sheet, /LONG_SHIFT_QUESTION/);
  assert.match(sheet, /confirmLong: true/);
  assert.doesNotMatch(sheet, /to <= from \? addDays/, 'no more guessing the next day from the times');
  const shifts = readFileSync('mobile/src/LiveShifts.tsx', 'utf8');
  assert.match(shifts, /label="Stopped work on"/);
  assert.match(shifts, /Clock out: \{fullStamp\(endedAt\)\}/);
  assert.match(shifts, /checkShiftTimes\(\{ clockedInAt: closing\.clockedInAt/);
  for (const source of [team, shifts]) { assert.doesNotMatch(source, /—/); assert.doesNotMatch(source, /linear-gradient|LinearGradient/); }
  // Ending a shift goes through the same rule on the server (closeShift takes the yes too).
  const base = { action: 'closeShift', requestId: crypto.randomUUID(), shiftId: crypto.randomUUID(), endedAt: at('2026-10-16', '02:00') };
  assert.ok(teamsActionSchema.parse({ ...base, confirmLong: true }));
});
