import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 9, from E's sweep (R1 and R7). At 1440 with the sidebar open, the cleaning manager's schedule table (Cleans ->
// Schedule, and the Cleans tab in Guest relations) was wider than its card and "Last update" was cut off. It now sizes
// its columns like the To-do list: Status and Submitted forms are fixed, the text columns shrink with "…". The day
// strip's chosen day uses the selected tokens, like the calendar.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { thinWidths, THIN_MIN_TEXT } = await vite.ssrLoadModule('/lib/thin-table.ts');
const { CLEAN_SCHEDULE_COLUMNS: COLUMNS } = await vite.ssrLoadModule('/lib/clean-schedule-table.ts');
const src = path => readFileSync(path, 'utf8');
const sum = list => list.reduce((n, w) => n + w, 0);
const at = key => COLUMNS.findIndex(c => c.key === key);

test('every column the manager had stays; Status and Submitted forms are fixed', () => {
  assert.deepEqual(COLUMNS.map(c => c.label), ['Property', 'Cleaner', 'Status', 'Submitted forms', 'Next action', 'Last update']);
  assert.deepEqual(COLUMNS.filter(c => c.fixed).map(c => c.key), ['status', 'forms']);
  assert.deepEqual(COLUMNS.filter(c => c.grow).map(c => c.key), ['property']);
});

test('the schedule table is never wider than its card, at any width', () => {
  for (let width = 200; width <= 2400; width += 7) {
    const w = thinWidths(COLUMNS, width);
    assert.equal(w.length, COLUMNS.length);
    assert.ok(sum(w) <= width, `${width}: ${sum(w)} wide`);
  }
});

test('the 1440 case: the card with the sidebar open shows all of Last update', () => {
  // The workspace at 1440 with the sidebar open: the Cleans table measured 1136 px (1134 inside its border);
  // a little narrower with a scroll bar.
  for (const card of [1080, 1100, 1134]) {
    const w = thinWidths(COLUMNS, card);
    assert.ok(sum(w) <= card, `${card}`);
    assert.equal(w[at('status')], 170);
    assert.equal(w[at('forms')], 210);
    assert.ok(w[at('update')] >= 140, `${card}: Last update ${w[at('update')]} px, room for "Sun 11 Oct, 09:41 · Morag Reid" on two lines`);
    COLUMNS.forEach((c, i) => { if (!c.fixed) assert.ok(w[i] >= Math.min(c.width, c.min ?? THIN_MIN_TEXT) - 1, `${card}: ${c.key}`); });
  }
  // The old fixed widths added up to 1250 px, wider than that card.
  assert.ok(sum(COLUMNS.map(c => c.width)) <= 1134);
});

test('the Cleans screen uses the sizes with a measured, non-scrolling table', () => {
  const live = src('mobile/src/LiveCleans.tsx'), sheet = src('mobile/src/SheetTable.tsx');
  assert.match(live, /return CLEAN_SCHEDULE_COLUMNS\.map\(c => \(\{ \.\.\.c, cell: cells\[c\.key\]\ }\)\);/);
  assert.match(live, /<SheetTable p=\{p\} columns=\{cleanColumns\(p, onlyOutstanding\)\}[^\n]*search=\{false\} fit \/>/);
  assert.match(sheet, /const widths = fit && inner > 0 \? thinWidths\(/);
  assert.match(sheet, /const table = fit \? sheet : <ScrollView horizontal/, 'no sideways scroll when it fits');
  assert.match(sheet, /setInner\(next\)/);
});

test('R7: the day strip and the cleaner filter use the selected tokens, never a solid primary block', () => {
  const live = src('mobile/src/LiveCleans.tsx');
  assert.match(live, /backgroundColor: on \? p\.selected : p\.surface, borderWidth: 1, borderColor: on \? p\.selectedBorder : p\.border/);
  assert.match(live, /color: on \? p\.onSelected : p\.muted/);
  assert.match(live, /color: on \? p\.onSelected : p\.text/);
  assert.match(live, /pillBox\(p, cleaner === id\)/);
  assert.doesNotMatch(live, /backgroundColor: on \? p\.primary|backgroundColor: cleaner === id \? p\.primary/);
});
