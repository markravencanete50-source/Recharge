import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 6, from Alex's video: the To-do page as thin, spreadsheet-like rows (a table on a computer, a
// two-line card on a phone), each to-do's update log in its detail, the New to-do form's dropdowns and
// date field, and the 180 automatic pricing rows kept but shown ten at a time.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const T = await vite.ssrLoadModule('/lib/todo.ts');
const { timeAgo, EMPTY_CELL } = await vite.ssrLoadModule('/lib/tracker.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const source = path => readFileSync(path, 'utf8');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = id(1), TODAY = '2026-10-13', NOW = new Date('2026-10-13T14:00:00Z');
const prop = (n, extra = {}) => ({ id: id(900 + n), name: 'Flat ' + n, address: n + ' High Street, Perth', region: 'Perthshire', status: 'active', version: 1, bedrooms: 2, ...extra });
const update = (n, text, byName, at, kind = 'note') => ({ id: n, text, kind, byId: ME, byName, at });
const todo = (n, extra = {}) => T.todoHubItemSchema.parse({
  id: id(100 + n), kind: 'todo', title: 'Task ' + n, details: '', propertyId: null, propertyName: null, assigneeId: ME, assigneeName: 'Me', department: null, dueOn: null,
  amountMinor: null, settledMinor: null, link: null, reference: '', status: 'open', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: ME, createdByName: 'Me',
  createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T09:00:00Z', version: 1, templateId: null, ...extra,
});
const row = (item, properties = [prop(1)]) => T.hubRows([item], ME, properties)[0];

test('the update log reaches the rows: newest update, who and the running total', () => {
  const item = todo(1, { propertyId: id(901), updateCount: 3, updates: [
    update(3, 'Booked for Thursday', 'Dan', '2026-10-13T12:00:00Z'), update(2, 'Emailed the engineer', 'Morag', '2026-10-12T09:00:00Z'), update(1, 'Asked for a quote', 'Dan', '2026-10-10T09:00:00Z'),
  ] });
  const r = row(item);
  assert.deepEqual(r.latest, { text: 'Booked for Thursday', by: 'Dan', at: '2026-10-13T12:00:00Z' });
  assert.equal(r.updateCount, 3);
  // An older answer without updates still parses, with none.
  const bare = row(todo(2));
  assert.deepEqual([bare.latest, bare.updateCount, bare.item.updates], [null, 0, []]);
  // Automatic tasks have no log.
  const auto = T.deriveTasks({ role: 'stays', today: TODAY, properties: [prop(1)], work: [{ workId: id(300), propertyId: id(901), moduleId: 'x', title: 'Gap', kind: 'pricing_gap', status: 'waiting', version: 1, assigneeId: null, data: { nights: ['2026-10-14'] } }], journeys: [] });
  assert.deepEqual([auto[0].latest, auto[0].updateCount], [null, 0]);
});

test('"Marked done" and "Reopened" parse as their own kinds; anything else reads as a note', () => {
  const parsed = T.todoUpdateSchema.parse(update(1, 'Marked done', 'Dan', '2026-10-13T12:00:00Z', 'done'));
  assert.equal(parsed.kind, 'done');
  assert.equal(T.todoUpdateSchema.parse(update(2, 'Reopened', 'Dan', '2026-10-13T12:00:00Z', 'reopened')).kind, 'reopened');
  assert.equal(T.todoUpdateSchema.parse(update(3, 'x', 'Dan', '2026-10-13T12:00:00Z', 'something-new')).kind, 'note');
});

test('the add-update action: text required, trimmed and capped at 2,000', () => {
  const base = { action: 'addTodoUpdate', requestId: id(7), id: id(101) };
  assert.equal(teamsActionSchema.parse({ ...base, text: '  Called the owner  ' }).text, 'Called the owner');
  assert.throws(() => teamsActionSchema.parse({ ...base, text: '' }));
  assert.throws(() => teamsActionSchema.parse({ ...base, text: 'x'.repeat(2001) }));
  assert.throws(() => teamsActionSchema.parse({ ...base, text: 'ok', by: 'Someone' }), 'no other keys');
});

test('"when" is relative: just now, minutes, hours, days, then the day', () => {
  assert.equal(timeAgo('2026-10-13T13:59:40Z', NOW), 'just now');
  assert.equal(timeAgo('2026-10-13T13:55:00Z', NOW), '5m ago');
  assert.equal(timeAgo('2026-10-13T12:00:00Z', NOW), '2h ago');
  assert.equal(timeAgo('2026-10-10T14:00:00Z', NOW), '3d ago');
  assert.equal(timeAgo('2026-10-01T09:00:00Z', NOW), '1 Oct');
  assert.equal(timeAgo('2025-12-24T09:00:00Z', NOW), '24 Dec 2025');
  assert.equal(timeAgo('2026-10-13T14:05:00Z', NOW), 'just now', 'a clock a little ahead is not "in the future"');
  assert.equal(timeAgo('not a time', NOW), '');
  assert.equal(timeAgo(null, NOW), '');
});

test('the desktop columns, left to right', () => {
  assert.deepEqual(T.TODO_COLUMNS.map(c => c.key), ['tick', 'property', 'task', 'update', 'by', 'when', 'due', 'status']);
  assert.deepEqual(T.TODO_COLUMNS.map(c => c.label), ['', 'Property', 'Task', 'Latest update', 'Updated by', 'When', 'Due', 'Status']);
  assert.deepEqual(T.TODO_COLUMNS.filter(c => c.grow).map(c => c.key), ['task'], 'the task takes the spare width');
  assert.equal(T.THIN_ROW_HEIGHT, 40);
});

test('what each column shows', () => {
  const item = todo(1, { propertyId: id(901), title: 'Chase the gas certificate', details: 'Engineer said\nThursday,   ask again', dueOn: '2026-10-12',
    updateCount: 1, updates: [update(1, 'Booked for\nThursday', 'Dan', '2026-10-13T12:00:00Z')] });
  const c = T.todoCells(row(item), TODAY, NOW);
  assert.deepEqual(c, {
    property: '1 High Street, Perth', task: 'Chase the gas certificate', detail: 'Engineer said Thursday, ask again',
    update: 'Booked for Thursday', by: 'Dan', when: '2h ago', due: '12 Oct', dueTone: 'overdue', status: 'To do', statusTone: 'wait',
  });
  // No property, no update, no date: each empty cell reads "–" (the sheet tables' own dash).
  const empty = T.todoCells(row(todo(2)), TODAY, NOW);
  assert.deepEqual([empty.property, empty.update, empty.by, empty.when, empty.due], [EMPTY_CELL, EMPTY_CELL, EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);
  assert.equal(EMPTY_CELL, '–');
  assert.equal(T.todoCells(row(todo(3, { dueOn: TODAY })), TODAY, NOW).due, 'Today');
  assert.equal(T.todoCells(row(todo(3, { dueOn: TODAY })), TODAY, NOW).dueTone, 'today');
  assert.equal(T.todoCells(row(todo(4, { dueOn: '2027-01-03' })), TODAY, NOW).due, '3 Jan 2027');
  const done = T.todoCells(row(todo(5, { status: 'done', dueOn: '2026-10-01' })), TODAY, NOW);
  assert.deepEqual([done.status, done.statusTone, done.dueTone], ['Done', 'good', 'plain'], 'a done to-do is never overdue');
  const auto = T.todoCells(row(todo(6, { templateId: id(50), department: 'cleaning', assigneeId: null })), TODAY, NOW);
  assert.deepEqual([auto.status, auto.statusTone], ['Automatic', 'plain']);
  // An update from the database with no person reads Automatic.
  assert.equal(T.todoCells(row(todo(7, { updates: [update(1, 'x', null, '2026-10-13T12:00:00Z')] })), TODAY, NOW).by, 'Automatic');
});

test('the phone card: the task and due day, then the property and the latest update', () => {
  const item = todo(1, { propertyId: id(901), title: 'Chase the gas certificate', dueOn: TODAY, updates: [update(1, 'Booked for Thursday', 'Dan', '2026-10-13T12:00:00Z')] });
  assert.deepEqual(T.todoCardLines(row(item), TODAY, NOW), { top: 'Chase the gas certificate', due: 'Today', bottom: '1 High Street, Perth · Booked for Thursday · Dan · 2h ago' });
  // With no update, the description; with no property and no date, nothing for them.
  assert.deepEqual(T.todoCardLines(row(todo(2, { details: 'Bin bags and sponges' })), TODAY, NOW), { top: 'Task 2', due: '', bottom: 'Bin bags and sponges' });
  assert.deepEqual(T.todoCardLines(row(todo(3)), TODAY, NOW), { top: 'Task 3', due: '', bottom: '' });
});

test('phone versus desktop: cards under 1,024 px, the thin table from there', () => {
  assert.equal(T.todoLayout(390), 'cards');
  assert.equal(T.todoLayout(768), 'cards');
  assert.equal(T.todoLayout(1023), 'cards');
  assert.equal(T.todoLayout(1024), 'table');
  assert.equal(T.todoLayout(1440), 'table');
});

test('the detail: "Last update X ago by Y" and the running total', () => {
  assert.equal(T.lastUpdateWords({ text: 'x', by: 'Dan', at: '2026-10-13T12:00:00Z' }, NOW), 'Last update 2h ago by Dan');
  assert.equal(T.lastUpdateWords({ text: 'x', by: null, at: '2026-10-13T13:59:59Z' }, NOW), 'Last update just now by Automatic');
  assert.equal(T.lastUpdateWords(null, NOW), 'No updates yet');
  assert.deepEqual([T.updateTotal(0), T.updateTotal(1), T.updateTotal(12)], ['0 updates', '1 update', '12 updates']);
});

test('180 automatic pricing rows are kept; the section shows ten with "Show all 180"', () => {
  const properties = Array.from({ length: 180 }, (_, i) => prop(i + 1));
  const work = properties.map((p, i) => ({ workId: id(5000 + i), propertyId: p.id, moduleId: 'x', title: 'Gap', kind: 'pricing_gap', status: 'waiting', version: 1, assigneeId: null, data: { nights: ['2026-10-20', '2026-10-21'] } }));
  const rows = T.deriveTasks({ role: 'stays', today: TODAY, properties: properties.map(p => ({ ...p, status: 'archived' })), work, journeys: [] });
  assert.equal(rows.filter(r => r.derived === 'pricing_gap').length, 180, 'how they are made is unchanged');
  const group = T.groupTodo(rows, 'stays', TODAY).find(g => g.heading === 'client_relations');
  assert.equal(group.open, 180);
  assert.equal(T.ROWS_PER_HEADING, 10);
  assert.equal(group.rows.filter(r => !r.done).slice(0, T.ROWS_PER_HEADING).length, 10);
  assert.equal(T.showAllLabel(180, false), 'Show all 180');
  assert.equal(T.showAllLabel(180, true), 'Show fewer');
});

// ---------- the screens (no React Native renderer in the tests, so they are read from source) ----------

test('the New to-do form: one "Assign to" dropdown, a second one for which person or department', () => {
  const sheet = source('mobile/src/HubItemSheet.tsx');
  assert.match(sheet, /import \{ Dropdown \} from "\.\/Dropdown";/, "Session A's dropdown, not a new one");
  assert.match(sheet, /<Dropdown p=\{p\} label="Assign to" value=\{\(f\.assign \|\| "me"\) as Assign\} options=\{ASSIGN_OPTIONS\}/);
  assert.match(sheet, /\{f\.assign === "person" && <Dropdown p=\{p\} label="Person to assign it to"/);
  assert.match(sheet, /\{f\.assign === "department" && <Dropdown p=\{p\} label="Department to assign it to" value=\{f\.department \?\? ""\} options=\{DEPARTMENT_OPTIONS\}/);
  assert.doesNotMatch(sheet, /label="Who is it for\?"|label="Which person\?"|label="Which department\?"/, 'the old vague labels are gone');
  assert.match(sheet, /\{ value: "me", label: "Me" \}, \{ value: "person", label: "A person" \}, \{ value: "department", label: "A department" \}/);
  assert.doesNotMatch(sheet, /ASSIGN_CHOICES|<Chip /, 'no row of chips for who');
  assert.match(sheet, /Choose the person\./);
});

test('the New to-do form: the due date is a DateField, and the property is the search-only picker', () => {
  const sheet = source('mobile/src/HubItemSheet.tsx');
  assert.match(sheet, /import \{ DateField \} from "\.\/CalendarPicker";/);
  assert.match(sheet, /<DateField p=\{p\} label=\{kind === "todo" \? "Due date \(optional\)" : "Send by \(optional\)"\} mode="single" wholeMonthLink=\{false\}/);
  assert.match(sheet, /empty=\{kind === "todo" \? "No due date" : undefined\}/, 'an empty due date says so');
  assert.match(sheet, /onChange=\{r => setF\(v => \(\{ \.\.\.v, dueOn: r\.from \}\)\)\}/);
  assert.match(sheet, /Remove the due date/, 'an optional due date can be removed');
  assert.doesNotMatch(sheet, /YYYY-MM-DD\)"/, 'no typed date box');
  assert.match(sheet, /<PropertySelect p=\{p\} properties=\{properties\} value=\{f\.propertyId \?\? ""\}/);
  assert.match(source('mobile/src/SearchPicker.tsx'), /pickerView\(options, query, value\)/, 'the picker is search only on long lists');
});

test('the To-do page: thin table on a computer, two-line cards on a phone, 44 px ticks on the phone', () => {
  const list = source('mobile/src/TodoList.tsx');
  assert.match(list, /const table = todoLayout\(useWindowDimensions\(\)\.width\) === "table";/);
  assert.match(list, /if \(table\) return <ThinTable p=\{p\} columns=\{todoColumns\(p, today, busy, onTick\)\}/);
  assert.match(list, /TODO_COLUMNS\.map\(c => \(\{ \.\.\.c, cell: cell\[c\.key\] \}\)\)/);
  assert.match(list, /<Tick p=\{p\} row=\{row\} busy=\{busy\} size=\{44\} onTick=\{onTick\} \/>/, 'the phone tick is 44 px');
  assert.match(list, /minHeight: 44, justifyContent: "center"/, 'the phone card is at least 44 px');
  assert.match(list, /todoCardLines\(row, today\)/);
  // Every section uses the same rows: the headings (automatic ones too) and the done list.
  assert.equal((list.match(/<TodoRows p=\{p\} rows=/g) ?? []).length, 2);
  assert.match(list, /showAllLabel\(openRows\.length, expanded\)/);
  assert.doesNotMatch(list, /TodoRowView/);
  assert.match(list, /onRow=\{onOpen\}/, 'clicking a row opens it');
});

test('the To-do detail: Add update, the history newest first, the running total and the last update', () => {
  const list = source('mobile/src/TodoList.tsx');
  assert.match(list, /function TodoDetailSheet\(/);
  assert.match(list, /<Field label="Add update"/);
  assert.match(list, /writeTeams\(\{ action: "addTodoUpdate", requestId: request\.get\(\), id: item\.id, text: text\.trim\(\) \}\)/);
  assert.match(list, /`\$\{updateTotal\(row\.updateCount\)\} · \$\{lastUpdateWords\(row\.latest, now\)\}`/);
  assert.match(list, /lastUpdateWords\(row\.latest, now\)/);
  assert.match(list, /item\.updates\.map\(\(u, n\) =>/, 'drawn in the order the database gives: newest first');
  assert.match(list, /const open = \(row: TodoRow\) => \{ if \(row\.item\) setDetailId\(row\.id\); else openAutomatic\(row\); \};/);
  assert.match(list, /<TodoDetailSheet p=\{p\} row=\{detail\}/);
});

test('the tracker table uses the same thin rows', () => {
  const tracker = source('mobile/src/Tracker.tsx');
  assert.match(tracker, /export const THIN_ROW = 40;/);
  assert.match(tracker, /height: THIN_ROW, borderTopWidth: 1/);
  assert.match(tracker, /\? <ThinTable p=\{p\} columns=\{columnsFor\(p, owner, percent\)\}/);
  assert.doesNotMatch(tracker, /SheetTable/);
  assert.match(tracker, /<Text numberOfLines=\{1\}/);
});

test('no em dashes in the round 6 files', () => {
  for (const file of ['lib/todo.ts', 'lib/tracker.ts', 'mobile/src/TodoList.tsx', 'mobile/src/HubItemSheet.tsx', 'mobile/src/Tracker.tsx', 'tests/todo-rows.test.mjs', 'tests/todo-updates-database.test.mjs', 'supabase/migrations/20261016200000_todo_updates.sql'])
    assert.ok(!source(file).includes(String.fromCharCode(0x2014)), file);
});
