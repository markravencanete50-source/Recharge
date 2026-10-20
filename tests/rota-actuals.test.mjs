import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The rota grid shows what actually happened under each planned day: clock in and clock out in UK
// time, an open shift in amber, and an open shift past 16 hours as "Did not clock out".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { rotaActuals, actualsByPerson, FORGOTTEN_CLOCK_OUT_MINUTES } = await vite.ssrLoadModule('/lib/rota-actuals.ts');
const { OPEN_SHIFT_LIMIT_HOURS } = await vite.ssrLoadModule('/lib/shift-hours.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shift = (n, clockedInAt, clockedOutAt) => ({ id: id(n), department: 'guest_relations', clockedInAt, clockedOutAt, minutes: 0, edited: false, editNote: '', overtimeFrom: null, unpaidMinutes: 0, pauses: [] });
const person = days => ({ userId: id(1), fullName: 'Eric', role: 'staff', department: null, active: true, totalMinutes: 0, days });

test('a closed shift shows its UK clock in and clock out, 24 hour', () => {
  // 19 Oct 2026 is still summer time: 07:02Z is 08:02 in the UK.
  const eric = person([{ day: '2026-10-19', planned: null, minutes: 488, shifts: [shift(2, '2026-10-19T07:02:00.000Z', '2026-10-19T15:10:00.000Z')] }]);
  assert.deepEqual(rotaActuals(eric, '2026-10-19', new Date('2026-10-20T12:00:00Z')), [{ id: id(2), state: 'closed', text: 'In 08:02 · Out 16:10' }]);
  // Winter time after the clock change: 14:30Z is 14:30.
  const winter = person([{ day: '2026-11-02', planned: null, minutes: 0, shifts: [shift(3, '2026-11-02T14:30:00.000Z', '2026-11-02T22:45:00.000Z')] }]);
  assert.equal(rotaActuals(winter, '2026-11-02')[0].text, 'In 14:30 · Out 22:45');
});

test('an open shift is "Not clocked out" until 16 hours, then "Did not clock out"', () => {
  const eric = person([{ day: '2026-10-20', planned: null, minutes: 0, shifts: [shift(4, '2026-10-20T07:02:00.000Z', null)] }]);
  assert.deepEqual(rotaActuals(eric, '2026-10-20', new Date('2026-10-20T12:00:00Z')), [{ id: id(4), state: 'open', text: 'In 08:02 · Not clocked out' }]);
  assert.equal(FORGOTTEN_CLOCK_OUT_MINUTES, OPEN_SHIFT_LIMIT_HOURS * 60, 'the shared limit');
  const limit = Date.parse('2026-10-20T07:02:00.000Z') + FORGOTTEN_CLOCK_OUT_MINUTES * 60000;
  assert.equal(rotaActuals(eric, '2026-10-20', new Date(limit - 60000))[0].state, 'open');
  assert.deepEqual(rotaActuals(eric, '2026-10-20', new Date(limit)), [{ id: id(4), state: 'forgotten', text: 'In 08:02 · Did not clock out' }]);
});

test('a shift past midnight shows on the day it started, several shifts in order, nothing for other days', () => {
  const eric = person([{ day: '2026-10-19', planned: null, minutes: 0, shifts: [
    shift(6, '2026-10-19T21:00:00.000Z', '2026-10-19T23:30:00.000Z'), // 22:00 to 00:30 the next UK day
    shift(5, '2026-10-19T07:00:00.000Z', '2026-10-19T10:00:00.000Z'),
  ] }]);
  assert.deepEqual(rotaActuals(eric, '2026-10-19', new Date('2026-10-21T00:00:00Z')).map(a => a.text), ['In 08:00 · Out 11:00', 'In 22:00 · Out 00:30']);
  assert.deepEqual(rotaActuals(eric, '2026-10-20'), []);
  // The timesheet lists a shift on every day it touches (migration 20261025600000): the next day skips it here.
  const listedTwice = person([{ day: '2026-10-20', planned: null, minutes: 30, shifts: [shift(6, '2026-10-19T21:00:00.000Z', '2026-10-19T23:30:00.000Z')] }]);
  assert.deepEqual(rotaActuals(listedTwice, '2026-10-20'), []);
  assert.deepEqual(rotaActuals(undefined, '2026-10-19'), []);
  const map = actualsByPerson({ from: '2026-10-19', to: '2026-10-25', canEdit: true, canApprove: false, pending: [], people: [eric] });
  assert.equal(map.get(id(1)), eric);
  assert.equal(actualsByPerson(null).size, 0);
});

test('the Rota tab reads the timesheet beside the plan and colours a shift that did not clock out amber', () => {
  const source = readFileSync(new URL('../mobile/src/LiveTeamTime.tsx', import.meta.url), 'utf8');
  const rota = source.slice(source.indexOf('export function RotaTab'), source.indexOf('function RotaWeekSheet'));
  assert.match(rota, /section: "rotaPlan"/);
  assert.match(rota, /section: "timesheet"/);
  assert.match(rota, /rotaActuals\(/);
  assert.match(rota, /a\.state === "open" \? p\.success : p\.waiting/);
  for (const file of ['../mobile/src/LiveTeamTime.tsx', '../lib/rota-actuals.ts']) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /—/);
});
