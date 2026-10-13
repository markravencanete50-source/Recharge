import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The shared date picker (lib/calendar-picker.ts, mobile/src/CalendarPicker.tsx) and the Dropdown (mobile/src/Dropdown.tsx).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const C = await vite.ssrLoadModule('/lib/calendar-picker.ts');

test('the month grid: six weeks from Monday, counts, today, muted days outside the data', () => {
  const weeks = C.pickerWeeks('2026-10', { today: '2026-10-13', counts: { '2026-10-01': 9, '2026-10-02': 23, '2026-10-03': 0 }, dataFrom: '2026-10-01', dataTo: '2026-10-31' });
  assert.equal(weeks.length, 6); assert.ok(weeks.every(w => w.length === 7));
  assert.equal(weeks[0][0].date, '2026-09-28', 'Monday on or before the 1st');
  const day = d => weeks.flat().find(c => c.date === d);
  assert.deepEqual([day('2026-10-01').count, day('2026-10-02').count, day('2026-10-03').count, day('2026-10-04').count], [9, 23, null, null], 'no count shown for 0');
  assert.deepEqual([day('2026-10-13').isToday, day('2026-09-28').inMonth, day('2026-09-28').muted, day('2026-10-31').muted, day('2026-11-01').muted], [true, false, true, false, true]);
});

test('single day: choose, choose again to clear (when clearable), and the selection drawn', () => {
  let v = { from: null, to: null };
  v = C.pickDay(v, '2026-10-05', 'single'); assert.deepEqual(v, { from: '2026-10-05', to: '2026-10-05' });
  assert.deepEqual(C.pickDay(v, '2026-10-06', 'single'), { from: '2026-10-06', to: '2026-10-06' });
  assert.deepEqual(C.pickDay(v, '2026-10-05', 'single'), { from: null, to: null });
  assert.deepEqual(C.pickDay(v, '2026-10-05', 'single', false), v, 'not clearable: stays chosen');
  const cell = C.pickerWeeks('2026-10', { today: '2026-10-13', value: v }).flat().find(c => c.date === '2026-10-05');
  assert.deepEqual([cell.selected, cell.inRange, cell.rangeStart, cell.rangeEnd], [true, true, true, true]);
});

test('range: start, end (an earlier day becomes the start), a new click starts again; across months', () => {
  let v = C.pickDay({ from: null, to: null }, '2026-10-20', 'range');
  assert.deepEqual(v, { from: '2026-10-20', to: null });
  assert.equal(C.rangeLabel(v), 'From 20 Oct 2026');
  assert.deepEqual(C.pickDay(v, '2026-10-03', 'range'), { from: '2026-10-03', to: '2026-10-20' });
  v = C.pickDay(v, '2026-11-04', 'range');
  assert.deepEqual(v, { from: '2026-10-20', to: '2026-11-04' });
  assert.equal(C.rangeLabel(v), '20 Oct 2026 to 4 Nov 2026');
  assert.deepEqual(C.pickDay(v, '2026-12-01', 'range'), { from: '2026-12-01', to: null });
  const flat = C.pickerWeeks('2026-11', { today: '2026-10-13', value: v }).flat();
  assert.deepEqual(flat.filter(c => c.inRange).map(c => c.date)[0], '2026-10-26', 'the grid shows the part of the range it holds');
  assert.equal(flat.find(c => c.date === '2026-11-04').selected, true);
  assert.equal(flat.find(c => c.date === '2026-11-02').selected, false);
  assert.deepEqual(C.wholeMonth('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(C.wholeMonth('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(C.rangeLabel(C.wholeMonth('2026-10')), '1 Oct 2026 to 31 Oct 2026');
  assert.equal(C.rangeLabel({ from: null, to: null }), 'Choose dates');
});

test('keyboard: arrows, Page Up and Down keep the day where it fits, Home and End', () => {
  assert.equal(C.moveFocus('2026-10-31', 'ArrowRight'), '2026-11-01');
  assert.equal(C.moveFocus('2026-10-01', 'ArrowUp'), '2026-09-24');
  assert.equal(C.moveFocus('2026-03-31', 'PageUp'), '2026-02-28');
  assert.equal(C.moveFocus('2026-10-15', 'PageDown'), '2026-11-15');
  assert.equal(C.moveFocus('2026-10-15', 'Home'), '2026-10-12');
  assert.equal(C.moveFocus('2026-10-15', 'End'), '2026-10-18');
  assert.equal(C.moveFocus('2026-10-15', 'a'), null);
  assert.equal(C.cellLabel({ date: '2026-10-02', count: 23, isToday: false, selected: true, inRange: true }, 'to approve'), 'Friday 2 October 2026, 23 to approve, selected');
  assert.equal(C.isDay('2026-02-30'), false); assert.equal(C.isDay('2026-02-28'), true);
});

test('the components: 44pt cells on the phone, month arrows, Today, Whole month; the Dropdown is one control', () => {
  const picker = readFileSync('mobile/src/CalendarPicker.tsx', 'utf8');
  for (const needle of ['phone ? 44 : 38', 'accessibilityLabel="Previous month"', 'accessibilityLabel="Next month"', 'label="Today"', 'label="Whole month"', 'onKeyDown', 'export function DateField'])
    assert.ok(picker.includes(needle), needle);
  assert.doesNotMatch(picker, /gradient|loop|repeat/i);
  const dropdown = readFileSync('mobile/src/Dropdown.tsx', 'utf8');
  assert.match(dropdown, /createElement\("select"/);
  assert.match(dropdown, /accessibilityRole="menu"/);
  // The team calendar and the search picker are left alone.
  assert.doesNotMatch(picker + dropdown, /from "\.\/LiveCalendar"|from "\.\/SearchPicker"/);
});
