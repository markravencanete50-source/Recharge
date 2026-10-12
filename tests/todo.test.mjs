import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The To-do list: four headings, ordering, Automatic tasks worked out from the work the app holds,
// the counts on the summary card, and the weekday rules for daily task templates.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const T = await vite.ssrLoadModule('/lib/todo.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = id(1), OTHER = id(2), TODAY = '2026-10-13';
const prop = (n, extra = {}) => ({ id: id(900 + n), name: 'Flat ' + n, address: n + ' High Street, Perth', region: 'Perthshire', status: 'active', version: 1, bedrooms: 2, ...extra });
const todo = (n, extra = {}) => ({
  id: id(100 + n), kind: 'todo', title: 'Task ' + n, details: '', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null, department: null, dueOn: null,
  amountMinor: null, settledMinor: null, link: null, reference: '', status: 'open', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: ME, createdByName: 'Me',
  createdAt: `2026-10-0${n % 9 + 1}T09:00:00Z`, updatedAt: `2026-10-0${n % 9 + 1}T09:00:00Z`, version: 1, templateId: null, ...extra,
});
const op = (n, kind, data = {}, extra = {}) => ({ workId: id(200 + n), propertyId: id(901), moduleId: 'x', title: kind + ' ' + n, kind, status: 'waiting', version: 1, assigneeId: null, data, ...extra });
const rowsOf = (items, properties = [prop(1)]) => T.hubRows(items, ME, properties);

test('headings: department decides, then whose it is', () => {
  const h = (department, assigneeId, createdBy = ME) => T.headingOf({ department, assigneeId, createdBy }, ME);
  assert.equal(h('guest_relations', null), 'guest_relations');
  assert.equal(h('stays', ME), 'guest_relations');
  assert.equal(h('client_relations', OTHER), 'client_relations');
  assert.equal(h('cleaning', null), 'team');
  assert.equal(h('accounts', ME), 'team');
  assert.equal(h(null, ME), 'personal');
  assert.equal(h(null, null, ME), 'personal');
  assert.equal(h(null, OTHER), 'team');
  assert.equal(h(null, null, OTHER), 'team');
  assert.deepEqual(T.TODO_HEADINGS.map(k => T.TODO_HEADING_LABEL[k]), ['Guest relations', 'Client relations', 'Your team', 'Personal']);
  assert.equal(T.LISTING_CHECKS_DEPARTMENT, 'client_relations');
});

test('hub rows: only to-dos, address from the property, Automatic when a template made it', () => {
  const rows = rowsOf([
    todo(1, { propertyId: id(901), department: 'guest_relations' }),
    todo(2, { assigneeId: ME }),
    todo(3, { templateId: id(50), department: 'cleaning' }),
    { ...todo(4), kind: 'approval' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].address, '1 High Street, Perth');
  assert.equal(rows[0].heading, 'guest_relations');
  assert.equal(rows[1].heading, 'personal');
  assert.equal(rows[1].who, 'Me');
  assert.equal(rows[2].automatic, true);
  assert.equal(rows[2].who, 'Cleaning');
  assert.equal(rows[0].automatic, false);
});

test('ordering: open first, due today, then overdue, later, undated; oldest within each; done last', () => {
  const items = [
    todo(1, { dueOn: null }), todo(2, { dueOn: '2026-10-20' }), todo(3, { dueOn: TODAY }), todo(4, { dueOn: '2026-10-10' }),
    todo(5, { status: 'done' }), todo(6, { dueOn: TODAY, createdAt: '2026-09-01T09:00:00Z' }), todo(7, { dueOn: null, createdAt: '2026-08-01T09:00:00Z' }),
  ];
  const sorted = T.sortTodoRows(rowsOf(items), TODAY).map(r => r.title);
  assert.deepEqual(sorted, ['Task 6', 'Task 3', 'Task 4', 'Task 2', 'Task 7', 'Task 1', 'Task 5']);
});

test('done rows list the most recently finished first', () => {
  const sorted = T.sortTodoRows(rowsOf([todo(1, { status: 'done', updatedAt: '2026-10-01T10:00:00Z' }), todo(2, { status: 'done', updatedAt: '2026-10-05T10:00:00Z' })]), TODAY);
  assert.deepEqual(sorted.map(r => r.title), ['Task 2', 'Task 1']);
});

test('grouping: all four headings in order; guest and client shown only to people who work them, unless they hold rows', () => {
  const rows = rowsOf([todo(1, { department: 'client_relations' }), todo(2, { assigneeId: ME })]);
  const staff = T.groupTodo(rows, 'stays', TODAY);
  assert.deepEqual(staff.map(g => g.heading), ['guest_relations', 'client_relations', 'team', 'personal']);
  assert.deepEqual(staff.map(g => g.always), [true, true, true, true]);
  assert.deepEqual(staff.map(g => g.open), [0, 1, 0, 1]);
  const cleaner = T.groupTodo(rows, 'cleans', TODAY);
  assert.deepEqual(cleaner.map(g => g.always), [false, false, true, true]);
  assert.equal(cleaner[1].rows.length, 1);
});

test('derived tasks: repairs needing an update', () => {
  const work = [
    op(1, 'maintenance', { phase: 'referred' }, { lastActivityAt: '2026-10-08T09:00:00Z' }),
    op(2, 'maintenance', { phase: 'booked' }, { updatedAt: '2026-10-12T09:00:00Z' }),
    op(3, 'maintenance', { phase: 'completed' }, { status: 'completed', updatedAt: '2026-09-01T09:00:00Z' }),
    op(4, 'maintenance', { phase: 'owner_declined' }, { updatedAt: '2026-10-12T09:00:00Z' }),
    op(5, 'maintenance', { phase: 'owner_approval' }, { updatedAt: '2026-09-01T09:00:00Z' }),
  ];
  const stays = T.deriveTasks({ role: 'stays', today: TODAY, properties: [], work, journeys: [] }).filter(r => r.derived === 'repair_update');
  assert.deepEqual(stays.map(r => r.open.workId).sort(), [id(201), id(204)].sort());
  assert.ok(stays.every(r => r.automatic && r.heading === 'guest_relations' && !r.done));
  assert.match(stays.find(r => r.open.workId === id(201)).details, /5 days/);
  // Ready hears only about repairs it has been sent.
  const ready = T.deriveTasks({ role: 'ready', today: TODAY, properties: [], work, journeys: [] });
  assert.deepEqual(ready.map(r => r.open.workId), [id(201)]);
});

test('derived tasks: listing checks due go under Client relations and stop once checked today', () => {
  const properties = [prop(1), prop(2), prop(3, { status: 'onboarding' })];
  const work = [op(1, 'listing_health', { checkedOn: TODAY }, { propertyId: id(901) }), op(2, 'listing_health', { checkedOn: '2026-10-12' }, { propertyId: id(902) })];
  const rows = T.deriveTasks({ role: 'stays', today: TODAY, properties, work, journeys: [] }).filter(r => r.derived === 'listing_check');
  assert.deepEqual(rows.map(r => r.propertyId), [id(902)]);
  assert.equal(rows[0].heading, 'client_relations');
  assert.equal(rows[0].dueOn, TODAY);
  assert.equal(rows[0].address, '2 High Street, Perth');
  assert.deepEqual(rows[0].open.target, { kind: 'work', view: 'clients', sub: 'listings' });
});

test('derived tasks: pricing gaps, guests waiting, onboarding and licensing', () => {
  const properties = [prop(1)];
  const work = [
    op(1, 'pricing_gap', { nights: ['2026-10-16', '2026-10-14'] }, { createdAt: '2026-10-12T09:00:00Z' }),
    op(2, 'pricing_gap', { nights: [] }),
    op(3, 'pricing_gap', { nights: ['2026-10-15'] }, { status: 'completed' }),
    op(4, 'licensing', { phase: 'applied', authority: 'Perth Council' }),
    op(5, 'licensing', { phase: 'granted' }),
    op(6, 'licensing', {}),
  ];
  const journeys = [
    { propertyId: id(901), clientId: null, workId: id(300), stage: 'agreement', version: 1, agreement: '', agreementRevision: 1, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null },
    { propertyId: id(901), clientId: null, workId: id(301), stage: 'live', version: 1, agreement: '', agreementRevision: 1, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null },
  ];
  const rows = T.deriveTasks({ role: 'admin', today: TODAY, properties, work, journeys, guestsWaiting: { count: 2, since: '2026-10-13T08:00:00Z' } });
  const by = k => rows.filter(r => r.derived === k);
  assert.equal(by('pricing_gap').length, 1);
  assert.equal(by('pricing_gap')[0].title, 'Price 2 empty nights');
  assert.equal(by('pricing_gap')[0].dueOn, '2026-10-14');
  assert.equal(by('pricing_gap')[0].heading, 'client_relations');
  assert.equal(by('guest_reply').length, 1);
  assert.equal(by('guest_reply')[0].title, '2 guests are waiting for a reply');
  assert.equal(by('guest_reply')[0].heading, 'guest_relations');
  assert.deepEqual(by('onboarding').map(r => r.title), ['Agreement to sign']);
  assert.equal(by('onboarding')[0].open.workId, id(300));
  assert.deepEqual(by('licensing').map(r => r.title).sort(), ['Record the safety checks', 'Submit the licence application']);
  assert.ok(rows.every(r => r.automatic && r.source === 'derived' && r.id.startsWith('auto:')));
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  // Nobody waiting means no guest task; one guest reads in the singular.
  assert.equal(T.deriveTasks({ role: 'admin', today: TODAY, properties: [], work: [], journeys: [], guestsWaiting: { count: 0, since: null } }).length, 0);
  assert.equal(T.deriveTasks({ role: 'admin', today: TODAY, properties: [], work: [], journeys: [], guestsWaiting: { count: 1, since: null } })[0].title, '1 guest is waiting for a reply');
});

test('derived tasks: roles that do not work guest or client relations get none', () => {
  const work = [op(1, 'maintenance', { phase: 'referred' }, { updatedAt: '2026-09-01T09:00:00Z' }), op(2, 'pricing_gap', { nights: ['2026-10-15'] })];
  for (const role of ['cleans', 'cleaning_manager', 'accounts', 'client']) assert.deepEqual(T.deriveTasks({ role, today: TODAY, properties: [prop(1)], work, journeys: [], guestsWaiting: { count: 3, since: null } }), [], role);
  assert.deepEqual(T.derivedKindsFor('ready'), ['repair_update']);
  assert.equal(T.derivedKindsFor('super_admin').length, 6);
});

test('counts: open, due today, overdue, Automatic and per heading', () => {
  const rows = [
    ...rowsOf([todo(1, { dueOn: TODAY, department: 'guest_relations' }), todo(2, { dueOn: '2026-10-01', assigneeId: ME }), todo(3, { status: 'done' }), todo(4, { templateId: id(50), department: 'cleaning', dueOn: TODAY })]),
    ...T.deriveTasks({ role: 'stays', today: TODAY, properties: [prop(1)], work: [], journeys: [] }),
  ];
  const c = T.todoCounts(rows, TODAY);
  assert.equal(c.open, 4);
  assert.equal(c.done, 1);
  assert.equal(c.dueToday, 3);
  assert.equal(c.overdue, 1);
  assert.equal(c.automatic, 2);
  assert.deepEqual(c.byHeading, { guest_relations: 1, client_relations: 1, team: 1, personal: 1 });
});

test('next rows: three open rows in page order, never a done one', () => {
  const rows = rowsOf([todo(1), todo(2, { dueOn: TODAY }), todo(3, { status: 'done', dueOn: TODAY }), todo(4, { dueOn: '2026-10-20' }), todo(5, { dueOn: '2026-10-01' })]);
  const next = T.nextRows(rows, TODAY);
  assert.equal(next.length, T.SUMMARY_ROWS);
  assert.deepEqual(next.map(r => r.title), ['Task 2', 'Task 5', 'Task 4']);
  assert.equal(T.dueState({ dueOn: TODAY, done: false }, TODAY), 'today');
  assert.equal(T.dueState({ dueOn: '2026-10-01', done: false }, TODAY), 'overdue');
  assert.equal(T.dueState({ dueOn: '2026-10-01', done: true }, TODAY), 'later');
  assert.equal(T.dueState({ dueOn: null, done: false }, TODAY), 'none');
});

test('the daily to-dos are asked for once a day per person and never for owners', () => {
  const done = new Set();
  assert.equal(T.needsEnsure('stays', ME, TODAY, done), true);
  done.add(T.ensureKey(ME, TODAY));
  assert.equal(T.needsEnsure('stays', ME, TODAY, done), false);
  assert.equal(T.needsEnsure('stays', ME, '2026-10-14', done), true);
  assert.equal(T.needsEnsure('stays', OTHER, TODAY, done), true);
  assert.equal(T.needsEnsure('client', ME, '2026-10-14', done), false);
});

test('weekdays are 1 (Monday) to 7 (Sunday), each once, at least one', () => {
  assert.equal(T.validWeekdays([1, 2, 3, 4, 5]), true);
  assert.equal(T.validWeekdays([7]), true);
  assert.equal(T.validWeekdays([]), false);
  assert.equal(T.validWeekdays([0]), false);
  assert.equal(T.validWeekdays([8]), false);
  assert.equal(T.validWeekdays([1, 1]), false);
  assert.equal(T.validWeekdays([1.5]), false);
  assert.equal(T.validWeekdays(['1']), false);
  assert.equal(T.validWeekdays([1, 2, 3, 4, 5, 6, 7, 1]), false);
  assert.deepEqual(T.toggleWeekday([5, 1], 3), [1, 3, 5]);
  assert.deepEqual(T.toggleWeekday([1, 3], 3), [1]);
  assert.deepEqual(T.normaliseWeekdays([7, 1, 1, 9, 0, 3]), [1, 3, 7]);
  assert.equal(T.weekdaysSummary([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(T.weekdaysSummary([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(T.weekdaysSummary([6, 7]), 'Weekends');
  assert.equal(T.weekdaysSummary([3, 1]), 'Mon, Wed');
  assert.equal(T.isoWeekday('2026-10-12'), 1);
  assert.equal(T.isoWeekday('2026-10-18'), 7);
  assert.equal(T.templateRunsOn({ weekdays: [1, 2], active: true }, '2026-10-13'), true);
  assert.equal(T.templateRunsOn({ weekdays: [1, 2], active: false }, '2026-10-13'), false);
  assert.equal(T.templateRunsOn({ weekdays: [1], active: true }, '2026-10-13'), false);
});

test('the actions the screens send are accepted by the action schema', () => {
  const req = id(7);
  const ok = input => assert.ok(teamsActionSchema.safeParse(input).success, JSON.stringify(input));
  const bad = input => assert.ok(!teamsActionSchema.safeParse(input).success, JSON.stringify(input));
  ok({ action: 'ensureDailyTodos', requestId: req });
  ok({ action: 'moveHubItem', requestId: req, id: id(1), version: 1, status: 'done' });
  ok({ action: 'saveDailyTask', requestId: req, department: 'cleaning', title: 'Check stock', details: '', weekdays: [1, 3, 5], active: true });
  ok({ action: 'saveDailyTask', requestId: req, id: id(2), department: 'accounts', title: 'Bank check', details: 'x', weekdays: [1], active: false });
  ok({ action: 'removeDailyTask', requestId: req, id: id(2) });
  bad({ action: 'saveDailyTask', requestId: req, department: 'cleaning', title: 'Check stock', details: '', weekdays: [], active: true });
  bad({ action: 'saveDailyTask', requestId: req, department: 'cleaning', title: 'Check stock', details: '', weekdays: [1, 1], active: true });
  bad({ action: 'saveDailyTask', requestId: req, department: 'cleaning', title: 'Check stock', details: '', weekdays: [8], active: true });
});

test('the hub read keeps the template link and parses an answer without it', () => {
  const base = { department: null, canDecide: false, keeps: ['todo'], people: [], items: [todo(1, { templateId: id(50) }), (({ templateId, ...rest }) => rest)(todo(2))] };
  const parsed = T.todoHubSchema.parse(base);
  assert.equal(parsed.items[0].templateId, id(50));
  assert.equal(parsed.items[1].templateId, undefined);
  const list = T.dailyTasksSchema.parse({ today: TODAY, templates: [{ id: id(3), department: 'ready', title: 'Stock', details: '', weekdays: [1, 2], active: true, version: 1, lastMadeOn: null }] });
  assert.equal(list.templates.length, 1);
});

test('no em dashes in the To-do files', () => {
  for (const file of ['lib/todo.ts', 'mobile/src/TodoList.tsx', 'mobile/src/DailyTaskSettings.tsx', 'mobile/src/HubItemSheet.tsx', 'tests/todo.test.mjs'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(String.fromCharCode(0x2014)), file);
});

test('the screens use the pinned actions and shared pieces', () => {
  const list = readFileSync('mobile/src/TodoList.tsx', 'utf8');
  assert.match(list, /export function TodoList\(/);
  assert.match(list, /export function TodoSummary\(/);
  assert.match(list, /ensureDailyTodos/);
  assert.match(list, /moveHubItem/);
  assert.match(list, /HubItemSheet/);
  assert.match(list, /SectionProps/);
  const settings = readFileSync('mobile/src/DailyTaskSettings.tsx', 'utf8');
  assert.match(settings, /export function DailyTaskSettings\(/);
  assert.match(settings, /saveDailyTask/);
  assert.match(settings, /removeDailyTask/);
  const sheet = readFileSync('mobile/src/HubItemSheet.tsx', 'utf8');
  assert.match(sheet, /A department/);
  assert.match(sheet, /export function HubItemSheet\(/);
});
