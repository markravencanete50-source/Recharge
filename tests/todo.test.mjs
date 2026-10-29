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
  assert.equal(by('pricing_gap')[0].title, 'Pricing: price 2 empty nights at Flat 1');
  assert.equal(by('pricing_gap')[0].dueOn, '2026-10-14');
  assert.equal(by('pricing_gap')[0].heading, 'client_relations');
  assert.equal(by('guest_reply').length, 1);
  assert.equal(by('guest_reply')[0].title, 'Guest messages: reply to 2 waiting guests');
  assert.equal(by('guest_reply')[0].heading, 'guest_relations');
  assert.deepEqual(by('onboarding').map(r => r.title), ['Onboarding: get the agreement signed by the owner of Flat 1'], 'no contact name: the owner of the property');
  assert.equal(by('onboarding')[0].open.workId, id(300));
  assert.deepEqual(by('licensing').map(r => r.title).sort(), ['Licensing: record the safety checks for Flat 1', 'Licensing: submit the licence application for Flat 1']);
  assert.ok(rows.every(r => r.automatic && r.source === 'derived' && r.id.startsWith('auto:')));
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  // Nobody waiting means no guest task; one guest reads in the singular.
  assert.equal(T.deriveTasks({ role: 'admin', today: TODAY, properties: [], work: [], journeys: [], guestsWaiting: { count: 0, since: null } }).length, 0);
  assert.equal(T.deriveTasks({ role: 'admin', today: TODAY, properties: [], work: [], journeys: [], guestsWaiting: { count: 1, since: null } })[0].title, 'Guest messages: reply to 1 waiting guest');
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

// ---------- clearer titles and the Client relations filters (Alex, client meeting) ----------

const journey = (n, stage, extra = {}) => ({ propertyId: id(900 + n), clientId: null, workId: id(400 + n), stage, version: 1, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ...extra });
const cottage = (n, name, extra = {}) => prop(n, { name, ...extra });

test('every Automatic title reads "<Area>: <what to do>" with the property or the person in it', () => {
  const properties = [cottage(1, 'Rose Cottage'), cottage(2, 'Harbour Flat'), cottage(3, 'Glen Lodge', { status: 'onboarding' })];
  const work = [
    op(1, 'pricing_gap', { nights: ['2026-10-14', '2026-10-15', '2026-10-16'] }),
    op(2, 'pricing_gap', { nights: ['2026-10-20'] }, { propertyId: id(902) }),
    op(3, 'maintenance', { phase: 'referred', issue: 'Boiler not firing' }, { lastActivityAt: '2026-10-08T09:00:00Z' }),
    op(4, 'maintenance', { phase: 'owner_declined', issue: 'New sofa' }, { propertyId: id(902) }),
    op(5, 'maintenance', { phase: 'management_declined' }, { title: 'Repair request', propertyId: id(902) }),
    op(6, 'maintenance', { phase: 'triage', issue: 'Dripping tap' }, { updatedAt: '2026-10-01T09:00:00Z' }),
    op(7, 'maintenance', { phase: 'booked', issue: 'Broken window' }, { updatedAt: '2026-10-01T09:00:00Z' }),
    op(8, 'licensing', { phase: 'checks_done' }, { propertyId: id(903) }),
  ];
  const rows = T.deriveTasks({ role: 'admin', today: TODAY, properties, work, journeys: [], guestsWaiting: null });
  const title = (kind, workId) => rows.find(r => r.derived === kind && r.open.workId === workId).title;
  assert.equal(title('pricing_gap', id(201)), 'Pricing: price 3 empty nights at Rose Cottage');
  assert.equal(title('pricing_gap', id(202)), 'Pricing: price 1 empty night at Harbour Flat');
  assert.equal(title('repair_update', id(203)), 'Repair: book the repair at Rose Cottage (Boiler not firing)');
  assert.equal(title('repair_update', id(204)), 'Repair: re-quote or close the repair at Harbour Flat (New sofa)');
  assert.equal(rows.find(r => r.open?.workId === id(204)).details, 'The owner declined the cost.');
  assert.equal(title('repair_update', id(205)), 'Repair: re-quote or close the repair at Harbour Flat (Repair request)', 'no issue: the work title');
  assert.equal(rows.find(r => r.open?.workId === id(205)).details, 'Management declined the cost.');
  assert.equal(title('repair_update', id(206)), 'Repair: check and refer the repair at Rose Cottage (Dripping tap)');
  assert.equal(title('repair_update', id(207)), 'Repair: confirm the repair is done at Rose Cottage (Broken window)');
  assert.equal(title('licensing', id(208)), 'Licensing: record the licence grant for Glen Lodge');
  assert.deepEqual(rows.filter(r => r.derived === 'listing_check').map(r => r.title).sort(), ['Listing: check the listing for Harbour Flat', 'Listing: check the listing for Rose Cottage']);
  // A property the list does not know: the title still says what to do, without "at".
  const unknown = T.deriveTasks({ role: 'stays', today: TODAY, properties: [], work: [op(9, 'pricing_gap', { nights: ['2026-10-14', '2026-10-15'] })], journeys: [] });
  assert.equal(unknown[0].title, 'Pricing: price 2 empty nights');
  for (const r of rows) assert.match(r.title, /^(Pricing|Repair|Listing|Licensing|Onboarding|Enquiry|Guest messages): [a-z]/, r.title);
});

test('onboarding titles: the next action for each stage, to the contact by name', () => {
  const properties = [cottage(1, 'Rose Cottage', { status: 'onboarding' })];
  const sarah = { contactName: 'Sarah Jones', email: 'sarah@example.com', phone: '07700 900123' };
  const titleAt = (stage, extra = {}) => T.deriveTasks({ role: 'stays', today: TODAY, properties, work: [], journeys: [journey(1, stage, { enquiry: sarah, ...extra })] }).find(r => r.derived === 'onboarding')?.title;
  assert.equal(titleAt('enquiry'), 'Enquiry: send the estimate to Sarah Jones');
  assert.equal(titleAt('estimate'), 'Enquiry: get a decision on the estimate from Sarah Jones');
  assert.equal(titleAt('reviewing'), 'Enquiry: get a decision on the estimate from Sarah Jones');
  assert.equal(titleAt('agreement'), 'Onboarding: send the agreement to Sarah Jones');
  assert.equal(titleAt('agreement', { agreementRevision: 1 }), 'Onboarding: get the agreement signed by Sarah Jones');
  assert.equal(titleAt('form'), 'Onboarding: get the set-up form completed by Sarah Jones');
  assert.equal(titleAt('invoice'), 'Onboarding: send the onboarding invoice to Sarah Jones');
  assert.equal(titleAt('invoice', { invoiceId: id(77) }), 'Onboarding: get the onboarding invoice paid by Sarah Jones');
  assert.equal(titleAt('inspection_to_book'), 'Onboarding: book the inspection at Rose Cottage');
  assert.equal(titleAt('inspection_booked'), 'Onboarding: carry out the inspection at Rose Cottage');
  assert.equal(titleAt('inspection_complete'), 'Onboarding: record the live listing for Rose Cottage');
  assert.equal(titleAt('live'), undefined);
  // The details give the contact to reach.
  const row = T.deriveTasks({ role: 'stays', today: TODAY, properties, work: [], journeys: [journey(1, 'form', { enquiry: sarah })] })[0];
  assert.equal(row.details, 'Sarah Jones, 07700 900123, sarah@example.com');
  // With no contact name and no property, "the owner".
  assert.equal(T.onboardingTitle('form', null, null, { agreementRevision: 0, invoiceId: null }), 'Onboarding: get the set-up form completed by the owner');
});

test('Client relations filters: All, Pricing, Enquiries and Onboarding, with counts of open rows', () => {
  assert.deepEqual(T.CLIENT_FILTERS.map(f => T.CLIENT_FILTER_LABEL[f]), ['All', 'Pricing', 'Enquiries', 'Onboarding']);
  const properties = [cottage(1, 'Rose Cottage'), cottage(2, 'Glen Lodge', { status: 'onboarding' }), cottage(3, 'Mill House', { status: 'onboarding' })];
  const work = [op(1, 'pricing_gap', { nights: ['2026-10-14'] }), op(2, 'licensing', { phase: 'applied' }, { propertyId: id(902) }), op(3, 'listing_health', { checkedOn: '2026-10-01' })];
  const derived = T.deriveTasks({ role: 'stays', today: TODAY, properties, work, journeys: [journey(2, 'enquiry'), journey(3, 'agreement')] });
  const hub = rowsOf([
    todo(1, { department: 'client_relations', title: 'Pricing: check the Christmas rates' }),
    todo(2, { department: 'client_relations', title: 'enquiry: call back Mr Brown' }),
    todo(3, { department: 'client_relations', title: 'Onboarding : chase the keys' }),
    todo(4, { department: 'client_relations', title: 'Ring the owner about the bins' }),
    todo(5, { department: 'client_relations', title: 'Pricing: done already', status: 'done' }),
  ], properties);
  const client = [...derived, ...hub].filter(r => r.heading === 'client_relations');
  const area = r => T.clientAreaOf(r);
  const byKind = k => client.find(r => r.derived === k);
  assert.equal(area(byKind('pricing_gap')), 'pricing');
  assert.equal(area(byKind('listing_check')), 'pricing', 'listing checks sit with pricing');
  assert.equal(area(byKind('licensing')), 'onboarding');
  assert.equal(area(client.find(r => r.derived === 'onboarding' && r.propertyId === id(902))), 'enquiries', 'before the owner says yes: an enquiry');
  assert.equal(area(client.find(r => r.derived === 'onboarding' && r.propertyId === id(903))), 'onboarding');
  assert.deepEqual(hub.map(area), ['pricing', 'enquiries', 'onboarding', null, 'pricing'], 'a person\'s to-do by the area its title starts with');
  // A to-do with no area shows only under All.
  const plain = hub[3];
  assert.equal(T.matchesClientFilter(plain, 'all'), true);
  for (const f of ['pricing', 'enquiries', 'onboarding']) assert.equal(T.matchesClientFilter(plain, f), false, f);
  // An Automatic task is placed by its kind, never by its title.
  assert.equal(T.clientAreaOf({ source: 'derived', title: 'Pricing: looks like it', area: undefined }), null);
  // Counts are of open rows: the done hub to-do is not counted. Rose Cottage is live, so it has a listing check too.
  assert.deepEqual(T.clientFilterCounts(client), { all: 9, pricing: 3, enquiries: 2, onboarding: 3 });
});

test('the To-do page shows the Client relations chips and filters only that heading', () => {
  const list = readFileSync('mobile/src/TodoList.tsx', 'utf8');
  assert.match(list, /import \{ Chip \} from "\.\/LivePortfolio";/, 'the counted chip used elsewhere');
  assert.match(list, /const chipCounts = g\.heading === "client_relations" \? clientFilterCounts\(g\.rows\) : null, filter = chipCounts\?\.all \? clientFilter : "all";/);
  assert.match(list, /g\.rows\.filter\(r => !r\.done && matchesClientFilter\(r, filter\)\)/);
  assert.match(list, /CLIENT_FILTERS\.map\(f => <Chip key=\{f\} p=\{p\} label=\{CLIENT_FILTER_LABEL\[f\]\} count=\{chipCounts\[f\]\} on=\{clientFilter === f\}/);
  assert.match(list, /Nothing under \$\{CLIENT_FILTER_LABEL\[filter\]\} right now\./);
});

test('the New to-do form labels: assign to, departments with what they cover, the due date', () => {
  const sheet = readFileSync('mobile/src/HubItemSheet.tsx', 'utf8');
  assert.match(sheet, /\{ value: "me", label: "Me" \}, \{ value: "person", label: "A person" \}, \{ value: "department", label: "A department" \}/);
  assert.match(sheet, /guest_relations: "guests and their stays", client_relations: "owners, pricing and onboarding", ready: "repairs and maintenance"/);
  assert.match(sheet, /`\$\{DEPARTMENT_LABEL\[d\]\} \(\$\{DEPARTMENT_HINT\[d\]\}\)`/);
  assert.match(sheet, /Area: what to do, for example Pricing: check the rates at Rose Cottage/);
});

test('the list can be ordered by due date, priority, newest, oldest or A to Z', () => {
  const rows = rowsOf([
    todo(1, { title: 'Charlie', dueOn: '2026-10-20', createdAt: '2026-10-02T09:00:00Z' }),
    todo(2, { title: 'Alpha', dueOn: null, createdAt: '2026-10-05T09:00:00Z' }),
    todo(3, { title: 'Bravo', dueOn: '2026-10-13', createdAt: '2026-10-03T09:00:00Z' }),
  ]);
  const titles = sort => T.sortTodoRows(rows, TODAY, sort).map(r => r.title);
  assert.deepEqual(titles(), ['Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(titles('due'), ['Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(titles('newest'), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(titles('oldest'), ['Charlie', 'Bravo', 'Alpha']);
  assert.deepEqual(titles('title'), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(T.TODO_SORTS, ['due', 'priority', 'newest', 'oldest', 'title']);
  const ranked = rowsOf([
    todo(1, { title: 'Low', priority: 'low' }), todo(2, { title: 'None' }), todo(3, { title: 'Urgent', priority: 'urgent' }), todo(4, { title: 'High', priority: 'high' }),
  ]);
  assert.deepEqual(T.sortTodoRows(ranked, TODAY, 'priority').map(r => r.title), ['Urgent', 'High', 'Low', 'None'], 'most urgent first, no priority last');
});

test('derived tasks: work assigned to the person is on their list until it is finished (Launch Preparation tickets)', () => {
  const work = [
    op(30, 'launch_step', { step: 'pricing.base' }, { assigneeId: ME, title: 'Flat 1: Base price set', propertyId: id(901) }),
    op(31, 'maintenance', { phase: 'triage', issue: 'Renew the EICR certificate.' }, { assigneeId: ME, title: 'Renew the EICR', propertyId: id(901), updatedAt: '2026-09-01T09:00:00Z' }),
    op(32, 'launch_step', {}, { assigneeId: OTHER }),
    op(33, 'launch_step', {}, { assigneeId: ME, status: 'completed' }),
  ];
  const rows = T.deriveTasks({ role: 'ready', today: TODAY, properties: [prop(1)], work, journeys: [], me: ME });
  const mine = rows.filter(r => r.derived === 'assigned');
  assert.deepEqual(mine.map(r => r.open.workId), [id(230), id(231)]);
  assert.deepEqual(mine.map(r => r.title), ['Task: Flat 1: Base price set at Flat 1', 'Repair: Renew the EICR at Flat 1 (Renew the EICR certificate.)']);
  assert.ok(mine.every(r => r.heading === 'personal' && r.automatic && r.details === 'Assigned to you.'));
  assert.equal(mine[1].open.target.view, 'repairs');
  // The assigned repair is not listed twice.
  assert.equal(rows.filter(r => r.open?.workId === id(231)).length, 1);
  // Without the person, or for cleaners and owners, nothing is added.
  assert.equal(T.deriveTasks({ role: 'ready', today: TODAY, properties: [], work, journeys: [] }).filter(r => r.derived === 'assigned').length, 0);
  for (const role of ['cleans', 'client']) assert.deepEqual(T.deriveTasks({ role, today: TODAY, properties: [], work, journeys: [], me: ME }), [], role);
});
