import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The shared contracts of the remaining client-feedback build: the new team reads and actions, the
// union additions, the defaults that mirror SQL functions, the management-flag helpers, and the copy
// for the new events. Everything here is pure; the SQL is tested by each migration's own test.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { teamsReadSchema, teamsActionSchema, FLAG_SOURCES, TEAM_EVENT_KINDS } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { WORK_VIEW_LABEL, workViewsFor } = await vite.ssrLoadModule('/lib/tool-directory.ts');
const defaults = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
const flags = await vite.ssrLoadModule('/lib/management-flags.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { eventLabel } = await vite.ssrLoadModule('/lib/oversight-policy.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const req = id(1);
const ok = (schema, value) => assert.equal(schema.safeParse(value).success, true, JSON.stringify(value));
const bad = (schema, value) => assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));
const read = text => readFileSync(text, 'utf8');

test('the new read sections parse, and the dated ones are bounded', () => {
  for (const section of ['flags', 'reflection', 'dailyTasks', 'aircover']) ok(teamsReadSchema, { section });
  bad(teamsReadSchema, { section: 'notASection' });
  ok(teamsReadSchema, { section: 'reflections', from: '2026-10-01', to: '2026-10-31' });
  bad(teamsReadSchema, { section: 'reflections' });
  bad(teamsReadSchema, { section: 'reflections', from: '2026-09-01', to: '2026-10-31' });
  ok(teamsReadSchema, { section: 'teamEvents', from: '2026-10-01', to: '2026-11-30' });
  bad(teamsReadSchema, { section: 'teamEvents', from: '2026-10-01', to: '2026-12-31' });
  bad(teamsReadSchema, { section: 'teamEvents', from: '2026-10-05', to: '2026-10-01' });
  // The existing sections still behave.
  ok(teamsReadSchema, { section: 'hub' });
  bad(teamsReadSchema, { section: 'schedule' });
});

test('flag actions: the source follows the target, declining needs a reason', () => {
  const base = { action: 'flagForManagement', requestId: req, title: 'Boiler', reason: 'Quote is far too high' };
  ok(teamsActionSchema, { ...base, source: 'work', workId: id(2) });
  ok(teamsActionSchema, { ...base, source: 'hub', hubItemId: id(3), amountMinor: 12000 });
  ok(teamsActionSchema, { ...base, source: 'request', amountMinor: null });
  bad(teamsActionSchema, { ...base, source: 'work' }, 'work needs a work id');
  bad(teamsActionSchema, { ...base, source: 'work', workId: id(2), hubItemId: id(3) });
  bad(teamsActionSchema, { ...base, source: 'hub', workId: id(2) });
  bad(teamsActionSchema, { ...base, source: 'request', workId: id(2) });
  bad(teamsActionSchema, { ...base, source: 'clean_form' }, 'people cannot raise the automatic kind');
  bad(teamsActionSchema, { ...base, source: 'request', reason: 'no' });
  bad(teamsActionSchema, { ...base, source: 'request', amountMinor: -1 });
  bad(teamsActionSchema, { ...base, source: 'request', extra: true });
  bad(teamsActionSchema, { ...base, requestId: undefined, source: 'request' });
  assert.deepEqual([...FLAG_SOURCES], ['work', 'hub', 'request']);
  ok(teamsActionSchema, { action: 'decideFlag', requestId: req, flagId: id(4), version: 1, decision: 'resolved', note: '' });
  ok(teamsActionSchema, { action: 'decideFlag', requestId: req, flagId: id(4), version: 1, decision: 'resolved' });
  ok(teamsActionSchema, { action: 'decideFlag', requestId: req, flagId: id(4), version: 2, decision: 'declined', note: 'Not covered by the contract' });
  bad(teamsActionSchema, { action: 'decideFlag', requestId: req, flagId: id(4), version: 2, decision: 'declined', note: 'no' });
  bad(teamsActionSchema, { action: 'decideFlag', requestId: req, flagId: id(4), version: 2, decision: 'withdrawn', note: 'whatever' });
  ok(teamsActionSchema, { action: 'withdrawFlag', requestId: req, flagId: id(4), version: 1 });
  bad(teamsActionSchema, { action: 'withdrawFlag', requestId: req, flagId: id(4) });
});

test('reflection actions', () => {
  const body = { action: 'saveReflection', requestId: req, wentWell: 'Cleared the inbox', notWell: '', feedback: '', completed: [{ kind: 'todo', ref: id(5), label: 'Chase invoice' }] };
  ok(teamsActionSchema, body);
  ok(teamsActionSchema, { ...body, shiftId: id(6), completed: [] });
  bad(teamsActionSchema, { ...body, wentWell: '', notWell: '' }, 'something must be said');
  bad(teamsActionSchema, { ...body, wentWell: 'x'.repeat(2001) });
  bad(teamsActionSchema, { ...body, completed: [{ kind: 'todo' }] });
  bad(teamsActionSchema, { ...body, completed: Array.from({ length: 101 }, () => ({ kind: 'todo', label: 'x' })) });
  bad(teamsActionSchema, { ...body, shiftId: 'nope' });
  ok(teamsActionSchema, { action: 'markReflectionsReviewed', requestId: req, ids: [id(7), id(8)] });
  bad(teamsActionSchema, { action: 'markReflectionsReviewed', requestId: req, ids: [] });
  bad(teamsActionSchema, { action: 'markReflectionsReviewed', requestId: req, ids: ['x'] });
});

test('daily task actions', () => {
  ok(teamsActionSchema, { action: 'ensureDailyTodos', requestId: req });
  ok(teamsActionSchema, { action: 'ensureDailyTodos', requestId: req, day: '2026-10-14' });
  bad(teamsActionSchema, { action: 'ensureDailyTodos', requestId: req, day: 'tomorrow' });
  const task = { action: 'saveDailyTask', requestId: req, department: 'guest_relations', title: 'Check the inbox', details: '', weekdays: [1, 2, 3, 4, 5], active: true };
  ok(teamsActionSchema, task);
  ok(teamsActionSchema, { ...task, id: id(9), details: 'Before 10am' });
  bad(teamsActionSchema, { ...task, weekdays: [] });
  bad(teamsActionSchema, { ...task, weekdays: [0] });
  bad(teamsActionSchema, { ...task, weekdays: [8] });
  bad(teamsActionSchema, { ...task, weekdays: [1, 1] });
  bad(teamsActionSchema, { ...task, department: 'nowhere' });
  bad(teamsActionSchema, { ...task, title: 'x' });
  ok(teamsActionSchema, { action: 'removeDailyTask', requestId: req, id: id(9) });
  bad(teamsActionSchema, { action: 'removeDailyTask', requestId: req });
});

test('AirCover, visit form and team event actions', () => {
  ok(teamsActionSchema, { action: 'flagAirCover', requestId: req, workId: id(2) });
  ok(teamsActionSchema, { action: 'flagAirCover', requestId: req, workId: id(2), title: 'Broken lock', amountMinor: 25000, reference: 'AC-1' });
  bad(teamsActionSchema, { action: 'flagAirCover', requestId: req });
  bad(teamsActionSchema, { action: 'flagAirCover', requestId: req, workId: id(2), amountMinor: 1.5 });
  const visit = { action: 'recordVisitForm', requestId: req, workId: id(2), version: 3, answers: [{ item: 'Smoke alarm tested', done: true }, { item: 'Gutters clear', done: false, note: 'Needs a ladder' }], note: 'All fine' };
  ok(teamsActionSchema, visit);
  ok(teamsActionSchema, { ...visit, note: undefined, photoIds: [id(10)] });
  bad(teamsActionSchema, { ...visit, answers: [] });
  bad(teamsActionSchema, { ...visit, answers: [{ item: 'x', done: 'yes' }] });
  bad(teamsActionSchema, { ...visit, version: 0 });
  bad(teamsActionSchema, { ...visit, photoIds: ['nope'] });
  const event = { action: 'saveTeamEvent', requestId: req, kind: 'absence', title: 'Annual leave', startsOn: '2026-11-02', endsOn: '2026-11-06' };
  ok(teamsActionSchema, event);
  ok(teamsActionSchema, { ...event, id: id(11), kind: 'meeting', endsOn: '2026-11-02', startTime: '10:00', endTime: '11:30', location: 'Office' });
  bad(teamsActionSchema, { ...event, kind: 'holiday' });
  bad(teamsActionSchema, { ...event, endsOn: '2026-11-01' });
  bad(teamsActionSchema, { ...event, endsOn: '2027-12-01' });
  bad(teamsActionSchema, { ...event, endsOn: '2026-11-02', startTime: '11:00', endTime: '10:00' });
  bad(teamsActionSchema, { ...event, endTime: '10:00' }, 'an end time needs a start time');
  bad(teamsActionSchema, { ...event, startTime: '25:00' });
  ok(teamsActionSchema, { action: 'cancelTeamEvent', requestId: req, id: id(11) });
  bad(teamsActionSchema, { action: 'cancelTeamEvent', id: id(11) });
  assert.deepEqual([...TEAM_EVENT_KINDS], ['absence', 'meeting', 'away', 'training', 'other']);
});

test('older actions still parse', () => {
  ok(teamsActionSchema, { action: 'clockOut', requestId: req });
  ok(teamsActionSchema, { action: 'moveHubItem', requestId: req, id: id(2), version: 1, status: 'done' });
  bad(teamsActionSchema, { action: 'clockOut', requestId: req, extra: 1 });
});

test('the unions carry the new members', () => {
  const directory = read('lib/tool-directory.ts'), map = read('lib/workspace-map.ts'), tracker = read('lib/tracker.ts'), panel = read('lib/role-panel.ts');
  assert.match(directory, /export type WorkView = [^;]*'clients'/);
  assert.equal(WORK_VIEW_LABEL.clients, 'Client relations');
  assert.ok(Object.keys(WORK_VIEW_LABEL).includes('clients'));
  assert.match(panel, /clients: 'users'/);
  assert.match(map, /export type WorkspaceSection = [^;]*"todo"[^;]*"decisions"/);
  const sections = tracker.match(/export type TrackerSection = ([^;]*);/)?.[1] ?? '';
  for (const s of ['purchases', 'licensing', 'onboarding', 'statements', 'payables', 'receivable', 'direct_bookings', 'aircover', 'listing_health', 'pricing', 'reviews', 'relisting', 'approvals', 'cleans', 'repairs', 'preventative'])
    assert.ok(sections.includes(`'${s}'`), s);
  assert.match(tracker, /section: TrackerSection;/);
  assert.match(tracker, /flagged\?: boolean;/);
  // Nobody's work views lost anything: the new view is added by a later package.
  assert.ok(workViewsFor('admin').includes('management'));
});

test('withFlags marks rows by work id or hub item id, from open flags only, and returns copies', () => {
  const row = (n, extra = {}) => ({ id: id(n), section: 'cleans', source: null, propertyId: null, address: 'A', propertyName: 'A', title: 'T', status: { label: 's', tone: 'plain' }, closed: false,
    nextStep: '', nextAction: null, lastUpdate: null, progress: null, steps: [], details: [], search: '', ...extra });
  const flag = (n, extra = {}) => ({ id: id(n), source: 'work', title: 'F', reason: 'Because', status: 'open', createdAt: '2026-10-10T09:00:00Z', version: 1, ...extra });
  const items = [row(100, { workId: id(200) }), row(101, { workId: id(201) }), row(102), row(103, { workId: id(203) })];
  const out = flags.withFlags(items, [
    flag(1, { workId: id(200) }),
    flag(2, { source: 'hub', hubItemId: id(102) }),
    flag(3, { workId: id(201), status: 'resolved' }),
    flag(4, { workId: id(203), status: 'withdrawn' }),
  ]);
  assert.deepEqual(out.map(i => i.flagged), [true, false, true, false]);
  assert.notEqual(out[0], items[0], 'copies, not the same objects');
  assert.equal(items[0].flagged, undefined, 'the input is untouched');
  assert.deepEqual(flags.withFlags([], [flag(1, { workId: id(200) })]), []);
  assert.deepEqual(flags.withFlags(items, []).map(i => i.flagged), [false, false, false, false]);
  assert.equal(flags.openFlagFor([flag(1, { workId: id(200) })], { workId: id(200) })?.id, id(1));
  assert.equal(flags.openFlagFor([flag(3, { workId: id(201), status: 'resolved' })], { workId: id(201) }), null);
});

test('the approvals list puts open items first, the longest waiting at the top', () => {
  const entry = (key, open, since) => ({ key, kind: 'approval', open, since, title: key, amountMinor: null, source: null });
  const flag = (n, createdAt, status = 'open') => ({ id: id(n), source: 'work', title: 'Flag ' + n, reason: 'Why', status, createdAt, version: 1, amountMinor: 500 });
  const merged = flags.mergeApprovals([flag(1, '2026-10-12T08:00:00Z'), flag(2, '2026-10-09T08:00:00Z'), flag(3, '2026-10-01T08:00:00Z', 'declined')],
    [entry('hub:a', true, '2026-10-10T08:00:00Z'), entry('hub:b', false, '2026-10-11T08:00:00Z'), entry('hub:c', true, 'not a date')]);
  assert.deepEqual(merged.map(e => e.key), ['hub:c', 'flag:' + id(2), 'hub:a', 'flag:' + id(1), 'hub:b', 'flag:' + id(3)]);
  assert.equal(merged.find(e => e.key === 'flag:' + id(1)).amountMinor, 500);
  const input = [entry('x', true, '2026-10-12T00:00:00Z'), entry('y', true, '2026-10-11T00:00:00Z')];
  assert.deepEqual(flags.orderApprovals(input).map(e => e.key), ['y', 'x']);
  assert.deepEqual(input.map(e => e.key), ['x', 'y'], 'the input is not reordered');
});

test('the flags read parses leniently; owners cannot flag', () => {
  const good = { id: id(1), source: 'work', title: 'T', reason: 'R', status: 'open', createdAt: '2026-10-12T08:00:00Z', version: 1 };
  assert.equal(flags.parseFlags({ flags: [good, { nope: true }] }).length, 1);
  assert.equal(flags.parseFlags([good]).length, 1);
  assert.deepEqual(flags.parseFlags(null), []);
  assert.deepEqual(flags.parseFlags({ flags: 'x' }), []);
  for (const role of ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts']) assert.equal(flags.canFlag(role), true, role);
  for (const role of ['client', '', null, undefined]) assert.equal(flags.canFlag(role), false, String(role));
});

test('the flag button builds the right action', () => {
  const work = flags.flagAction({ workId: id(2), title: ' Boiler quote ' }, ' Far too high ', '120.50', req);
  assert.deepEqual(work.action, { action: 'flagForManagement', requestId: req, title: 'Boiler quote', reason: 'Far too high', source: 'work', amountMinor: 12050, workId: id(2) });
  ok(teamsActionSchema, work.action);
  const hub = flags.flagAction({ hubItemId: id(3), title: 'Invoice' }, 'Looks wrong', '', req);
  assert.equal(hub.action.source, 'hub');
  assert.equal('amountMinor' in hub.action, false);
  ok(teamsActionSchema, hub.action);
  const free = flags.flagAction({ title: '' }, 'Can we take a cleaner on?', '', req);
  assert.equal(free.action.source, 'request');
  assert.equal(free.action.title, 'Flagged for management');
  ok(teamsActionSchema, free.action);
  assert.match(flags.flagAction({ title: 'x' }, 'no', '', req).error, /why/i);
  assert.match(flags.flagAction({ title: 'x' }, 'A good reason', '12,5', req).error, /pounds/i);
});

test('feedback defaults: one constant per assumption, mirroring SQL', () => {
  assert.deepEqual([...defaults.REFLECTION_REQUIRED_ROLES], ['stays', 'ready', 'accounts', 'cleaning_manager']);
  for (const role of ['stays', 'ready', 'accounts', 'cleaning_manager']) assert.equal(defaults.reflectionRequired(role), true, role);
  for (const role of ['cleans', 'admin', 'super_admin', 'client', '', null, undefined]) assert.equal(defaults.reflectionRequired(role), false, String(role));
  assert.equal(defaults.CLEAN_FORM_DUE_BY, '18:00');
  assert.equal(defaults.CLEAN_FORM_ZONE, 'Europe/London');
  assert.match(defaults.CLEAN_FORM_DUE_BY, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.equal(defaults.CLEAN_FORM_WARNING, 'no_form');
  assert.deepEqual({ ...defaults.CLEAN_FORM_WARNING_EFFECT }, { tag: true, flagManagement: true, payEffect: 'none', lateSubmitAllowed: true, remindCleaner: true, invoiceApprovalNeedsForm: true });
  assert.equal(defaults.CLEAN_FORM_ESCALATE_AT, '09:00');
  assert.equal(defaults.CLEAN_FORM_SWEEP_LIMIT, 200);
  assert.deepEqual([...defaults.DIRECT_BOOKING_OTA_CHANNELS], ['airbnb', 'booking_com', 'vrbo']);
  assert.equal(defaults.DIRECT_BOOKING_OTA_CHANNELS.includes('other'), false, 'owner stays are excluded');
  assert.equal(defaults.DIRECT_BOOKING_SWEEP_LIMIT, 50);
  assert.equal('DIRECT_BOOKING_MIN_NIGHTS' in defaults, false, 'the minimum nights stays in the booking policy');
  assert.deepEqual([...defaults.AIRCOVER_WORK_KINDS], ['maintenance', 'routine_visit']);
  assert.equal(defaults.REPAIR_ESTIMATE_OPTIONAL, true);
  assert.equal(defaults.READY_QUOTE_NEEDS_OWNER, true);
  assert.equal(defaults.RESOLVE_REPAIR_PHASE, 'triage');
  assert.equal(defaults.RESOLVE_REPAIR_MIN_CHARS, 5);
  assert.equal(defaults.RESOLVE_REPAIR_MAX_CHARS, 2000);
  assert.equal(defaults.VISIT_FORM_REQUIRED, true);
  assert.equal(defaults.guestNameVisible('stays'), true);
  assert.equal(defaults.guestNameVisible('admin'), true);
  assert.equal(defaults.guestNameVisible('cleaning_manager'), false);
  assert.equal(defaults.guestNameVisible('ready'), false, 'contractors see "Guest stay", never a name (repairs with contractors)');
  for (const role of ['cleans', 'cleaner', 'client', '', null]) assert.equal(defaults.guestNameVisible(role), false, String(role));
  assert.equal(defaults.TEAM_EVENTS_WINDOW_DAYS, 62);
  assert.equal(defaults.REFLECTIONS_WINDOW_DAYS, 31);
  assert.equal(defaults.FLAG_MIN_CHARS, 5);
  assert.equal(defaults.FLAG_DECIDED_WINDOW_DAYS, 90);
  assert.equal(defaults.DAILY_TASK_TEMPLATES_SEEDED, 0);
  assert.equal(defaults.BONUS_DISPLAY, 'tier_only');
  assert.equal(defaults.LISTING_HEALTH_VIEW, 'clients');
  assert.equal(defaults.ONBOARDING_PHASES_DEFAULT.length, 7);
  assert.deepEqual([...defaults.ONBOARDING_PHASES_DEFAULT], ['Enquiry', 'Estimate', 'Agreement', 'Property setup', 'Invoice', 'Inspection', 'Live']);
});

test('the new events have their own wording, with no private details', () => {
  for (const event of ['management.flag_raised', 'management.flag_resolved', 'management.flag_declined', 'cleaning.form_missing', 'reflection.saved', 'reflection.reviewed', 'todo.daily_created',
    'aircover.flagged', 'stays.direct_booking_follow_up', 'team.event_added', 'team.event_cancelled', 'operations.updateOperation.resolveRepair', 'routine.visit_form_recorded']) {
    const c = noticeCopy(event);
    assert.notEqual(c.title, 'Update in Recharge', event);
    assert.match(c.message, /Sign in to Recharge/, event);
    assert.ok(c.title.length > 3 && c.title.length <= 60, event);
  }
  assert.equal(noticeCopy('management.flag_raised').title, 'Flagged for management');
  assert.equal(noticeCopy('cleaning.form_missing').title, 'Clean form missing');
  assert.equal(noticeCopy('management.something_new').title, 'Management update', 'unknown management events fall back by area');
  assert.equal(noticeCopy('reflection.later').title, 'Reflection update');
  assert.equal(noticeCopy('aircover.later').title, 'AirCover update');
  // The history uses the short label.
  assert.equal(eventLabel('management.flag_raised'), 'Flagged for management');
  assert.equal(eventLabel('cleaning.form_missing'), 'Clean form missing');
  assert.equal(eventLabel('management.flag_declined'), 'Management declined the flag');
  // The earlier wording is untouched.
  assert.equal(noticeCopy('journey.publishEstimate').title, 'Your estimate is ready');
});

test('the pinned component contracts exist', () => {
  const props = read('mobile/src/SectionProps.ts');
  assert.match(props, /export type SectionProps = \{/);
  for (const part of ['palette: Palette', 'account: WorkspaceAccount', 'properties: PropertyView[]', 'journeys: JourneyView[]', 'work: OperationView[]', 'onForm: (f: WorkflowForm) => void', 'onOpenWork: (w: OperationView) => void', 'onTool: (t: HomeToolTarget) => void'])
    assert.ok(props.includes(part), part);
  const button = read('mobile/src/ManagementFlag.tsx');
  assert.match(button, /export function FlagButton\(/);
  assert.match(button, /export type \{ FlagTarget \}/);
  assert.match(button, /useRequestId/);
  assert.match(button, /writeTeams/);
  assert.match(button, /disabled=\{busy\}/);
  assert.match(button, /if \(!canFlag\(/);
});

test('no em dashes in the files this package wrote or changed', () => {
  for (const file of ['lib/feedback-defaults.ts', 'lib/management-flags.ts', 'lib/workspace-teams-policy.ts', 'lib/tracker.ts', 'lib/notice-copy.ts', 'lib/oversight-policy.ts', 'lib/tool-directory.ts', 'lib/role-panel.ts', 'lib/workspace-map.ts',
    'mobile/src/SectionProps.ts', 'mobile/src/ManagementFlag.tsx', 'tests/feedback-contracts.test.mjs'])
    assert.equal(read(file).includes(String.fromCharCode(0x2014)), false, file);
});
