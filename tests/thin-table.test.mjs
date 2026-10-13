import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 6, from E's review (Lee is presenting to the client): no thin table is ever wider than its card. At 1440 px
// with the sidebar open, the To-do Status column and the trackers' Progress column were cut off. Fixed columns
// (tick, When, Due, Status, Progress) keep their width; the text columns shrink with "…"; every column Alex asked
// for stays, even when empty.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { thinWidths, THIN_MIN_TEXT } = await vite.ssrLoadModule('/lib/thin-table.ts');
const { TODO_COLUMNS } = await vite.ssrLoadModule('/lib/todo.ts');
const source = path => readFileSync(path, 'utf8');
const sum = list => list.reduce((n, w) => n + w, 0);

// The tracker columns as Tracker.tsx sets them (with and without the percent badge), read from its source.
const tracker = source('mobile/src/Tracker.tsx');
const trackerColumns = percent => [...tracker.matchAll(/\{ key: "(\w+)", label: "[^"]*", width: ([^,]+), ((?:grow: true, |fixed: true, |min: \d+, )*)cell:/g)].map(([, key, width, flags]) => ({
  key, width: width.includes('?') ? (percent ? 200 : 150) : Number(width), fixed: flags.includes('fixed: true'), grow: flags.includes('grow: true'), min: Number(/min: (\d+)/.exec(flags)?.[1] ?? NaN) || undefined,
}));

const TABLES = [['To-do', TODO_COLUMNS], ['Trackers', trackerColumns(false)], ['Trackers with %', trackerColumns(true)]];

test('the columns: the tick, When, Due, Status and Progress are fixed; the text columns shrink', () => {
  assert.deepEqual(TODO_COLUMNS.filter(c => c.fixed).map(c => c.key), ['tick', 'when', 'due', 'status']);
  assert.deepEqual(TODO_COLUMNS.filter(c => !c.fixed).map(c => c.key), ['property', 'task', 'update', 'by'], 'Alex\'s columns, kept');
  assert.deepEqual(trackerColumns(false).map(c => c.key), ['property', 'status', 'next', 'action', 'update', 'progress']);
  assert.deepEqual(trackerColumns(false).filter(c => c.fixed).map(c => c.key), ['status', 'progress']);
});

test('no table is ever wider than its card, at any width', () => {
  for (const [name, columns] of TABLES) {
    for (let width = 200; width <= 2400; width += 7) {
      const w = thinWidths(columns, width);
      assert.equal(w.length, columns.length, `${name} ${width}: every column`);
      assert.ok(sum(w) <= width, `${name} at ${width}: ${sum(w)} wide`);
      assert.ok(w.every(x => x >= 0 && Number.isInteger(x)), `${name} ${width}`);
    }
  }
});

test('at the widths the tables show, the fixed columns keep their width and the text columns stay readable', () => {
  // A computer from 1024 px; with the sidebar open the card is about 1024 - 300 at the smallest.
  for (const [name, columns] of TABLES) {
    const fixed = sum(columns.filter(c => c.fixed).map(c => c.width));
    const mins = sum(columns.filter(c => !c.fixed).map(c => Math.min(c.width, c.min ?? THIN_MIN_TEXT)));
    for (let width = fixed + mins; width <= 2400; width += 5) {
      const w = thinWidths(columns, width);
      columns.forEach((c, i) => {
        if (c.fixed) assert.equal(w[i], c.width, `${name} ${width}: ${c.key} keeps its width`);
        else assert.ok(w[i] >= Math.min(c.width, c.min ?? THIN_MIN_TEXT) - 1, `${name} ${width}: ${c.key} at least its minimum`);
      });
    }
  }
});

test('with room to spare the table fills its card, and the task (or property) takes the extra', () => {
  const at = 1600, w = thinWidths(TODO_COLUMNS, at);
  assert.equal(sum(w), at);
  TODO_COLUMNS.forEach((c, i) => { if (!c.grow) assert.equal(w[i], c.width, c.key); });
  assert.equal(w[TODO_COLUMNS.findIndex(c => c.key === 'task')], 300 + at - sum(TODO_COLUMNS.map(c => c.width)));
  const t = trackerColumns(false), tw = thinWidths(t, 1500);
  assert.equal(sum(tw), 1500);
  assert.ok(tw[0] > 280, 'the property column grows');
});

test('the 1440 px case from the review: the To-do and tracker cards with the sidebar open', () => {
  // The workspace at 1440 with the sidebar: about 1080 px of card.
  const todo = thinWidths(TODO_COLUMNS, 1080);
  assert.ok(sum(todo) <= 1080);
  assert.equal(todo[TODO_COLUMNS.findIndex(c => c.key === 'status')], 116, 'Status fully shown');
  assert.equal(todo[TODO_COLUMNS.findIndex(c => c.key === 'due')], 96);
  const t = trackerColumns(false), tw = thinWidths(t, 1080);
  assert.ok(sum(tw) <= 1080);
  assert.equal(tw[t.findIndex(c => c.key === 'progress')], 150, 'Progress fully shown');
});

test('ThinTable measures its card and sizes the columns from it; no sideways scroll', () => {
  assert.match(tracker, /const widths = inner > 0 \? thinWidths\(columns, inner\) : null;/);
  assert.match(tracker, /onLayout=\{event => \{ const next = Math\.floor\(event\.nativeEvent\.layout\.width\) - 2;/);
  assert.match(tracker, /style=\{\{ width: "100%", borderWidth: 1, borderColor: p\.border, borderRadius: 12, overflow: "hidden"/);
  assert.doesNotMatch(tracker, /ScrollView/);
  assert.match(source('mobile/src/TodoList.tsx'), /TODO_COLUMNS\.map\(c => \(\{ \.\.\.c, cell: cell\[c\.key\] \}\)\)/);
});
