import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Maintenance (client asks B5, B6, C8): resolving a repair without a visit, the visit form, and the
// preventative list. Pure checks plus source wiring; the database side is tests/repairs-visit-forms-database
// and tests/live-repairs-contract.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const live = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { preventativeTrackerItems, preventativeInfo, RECORD_VISIT_KEY } = await vite.ssrLoadModule('/lib/tracker-repairs.ts');
const defaults = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
const source = file => readFileSync(`mobile/src/${file}`, 'utf8');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-13T12:00:00Z');
const TODAY = '2026-10-13';
const PROPERTIES = { [id(1)]: { name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA' }, [id(2)]: { name: 'Harbour cottage', address: '' } };
const ctx = (over = {}) => ({ property: p => PROPERTIES[p], forms: () => [], now: NOW, owner: false, ...over });
const visit = (n, over = {}, data = {}) => ({ workId: id(100 + n), propertyId: id(1), moduleId: 'routine-bin-garden-board', title: 'Monthly bins', kind: 'routine_visit', status: 'waiting', version: 2,
  assigneeId: null, dueOn: '2026-10-20', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-11T09:30:00Z', updatedBy: 'Morag Reid', updatedEvent: null, data: { planId: id(50 + n), checklist: ['Bins out', 'Bins in'], ...data }, ...over });
const formData = (done = [true, true], over = {}) => ({ visitForm: { answers: [{ item: 'Bins out', done: done[0] }, { item: 'Bins in', done: done[1], ...(done[1] ? {} : { note: 'Collection missed' }) }], note: 'All fine', photoIds: [], doneCount: done.filter(Boolean).length, totalCount: 2, recordedAt: '2026-10-12T10:00:00Z' }, lastDoneAt: '2026-10-12T10:00:00Z', nextDueOn: '2026-11-20', ...over });

test('resolveRepair is a known step with a 5 to 2000 character resolution, and resolved counts as closed', () => {
  const base = { action: 'updateOperation', requestId: id(1), workId: id(2), version: 1, step: 'resolveRepair' };
  assert.ok(operationsActionSchema.safeParse({ ...base, data: { resolution: 'Reset the boiler with the guest' } }).success);
  assert.ok(operationsActionSchema.safeParse({ ...base, data: { resolution: '  Reset the boiler  ' } }).success);
  for (const data of [{ resolution: 'Done' }, { resolution: 'x'.repeat(2001) }, {}, { resolution: 'Reset the boiler', extra: 1 }]) assert.equal(operationsActionSchema.safeParse({ ...base, data }).success, false, JSON.stringify(data).slice(0, 40));
  assert.equal(live.RESOLUTION_MIN, defaults.RESOLVE_REPAIR_MIN_CHARS);
  assert.equal(live.RESOLUTION_MAX, defaults.RESOLVE_REPAIR_MAX_CHARS);
  for (const role of defaults.RESOLVE_REPAIR_ROLES) assert.ok(live.canResolveRepair(role, defaults.RESOLVE_REPAIR_PHASE), role);
  for (const [role, phase] of [['ready', 'triage'], ['client', 'triage'], ['accounts', 'triage'], ['stays', 'referred'], ['stays', 'booked'], ['stays', 'owner_approval'], ['stays', 'resolved'], ['admin', 'completed']]) assert.equal(live.canResolveRepair(role, phase), false, `${role} ${phase}`);
  assert.ok(live.repairClosed('resolved') && live.repairClosed('completed') && live.repairClosed('closed') && !live.repairClosed('triage'));
  const stage = live.REPAIR_STAGES.find(s => s.phase === 'resolved');
  assert.equal(stage.label, 'Resolved');
  assert.equal(live.repairStage({ phase: 'resolved' }), 'resolved');
  assert.ok(!live.READY_STAGES.some(s => s.phase === 'resolved'), 'Ready never sees a resolved repair stage');
});

test('the repair sheet offers Resolved without a visit only while the repair is in triage', () => {
  const t = source('LiveRepairs.tsx');
  assert.match(t, /Resolved without a visit/);
  assert.match(t, /canResolveRepair\(role, phase\)/);
  assert.match(t, /step: "resolveRepair"/);
  assert.match(t, /Cost not known yet/);
});

test('visit checklists: the visit own list first, else the type list, mirroring the database', () => {
  assert.deepEqual(live.visitChecklist({ title: 'x', data: { checklist: ['Bins out', ' Lawn cut '] } }), ['Bins out', 'Lawn cut']);
  assert.equal(live.visitChecklist({ title: 'Property check' }).length, 6);
  assert.equal(live.visitChecklist({ title: 'Garden tidy', data: {} })[0], 'Lawn and hedges tidy');
  assert.equal(live.visitChecklist({ title: 'Bin collection check', data: { checklist: [] } })[0], 'Bins out for collection');
  assert.equal(live.visitType('Anything', { visitType: 'bins' }), 'bins');
  assert.equal(live.visitType('Garden and bins'), 'garden', 'garden wins over bin, as in the database');
  assert.equal(live.visitType('Safety checks'), 'routine');
  // The fallback lists are the same text as the migration's.
  const file = ['supabase/migrations/20261012200000_repairs_visit_forms.sql', 'supabase/migrations/20261012200000_repairs_visit_forms.sql.draft'].find(existsSync);
  const sql = readFileSync(file, 'utf8');
  for (const [kind, items] of Object.entries(live.VISIT_FALLBACK_CHECKLIST)) for (const item of items) assert.ok(sql.includes(`'${item}'`), `${kind}: ${item}`);
  assert.equal(Object.values(live.VISIT_FALLBACK_CHECKLIST).flat().length, 14);
});

test('the visit form request answers every item once, in order, and matches the schema', () => {
  const v = { workId: id(5), version: 4, title: 'Monthly bins', data: { checklist: ['Bins out', 'Bins in'] } };
  const built = live.visitFormAction(v, [{ done: true, note: '' }, { done: false, note: ' Missed ' }], '  Visited  ', id(9));
  assert.ok('action' in built);
  assert.deepEqual(built.action.answers, [{ item: 'Bins out', done: true }, { item: 'Bins in', done: false, note: 'Missed' }]);
  assert.equal(built.action.note, 'Visited');
  assert.equal('photoIds' in built.action, false, 'no photos unless some are passed');
  assert.ok(teamsActionSchema.safeParse(built.action).success);
  assert.ok(teamsActionSchema.safeParse(live.visitFormAction(v, [{ done: true, note: '' }, { done: true, note: '' }], '', id(9), [id(7)]).action).success);
  assert.ok('error' in live.visitFormAction(v, [{ done: true, note: '' }], '', id(9)), 'one answer per item');
  assert.ok('error' in live.visitFormAction(v, [{ done: true, note: 'x'.repeat(301) }, { done: true, note: '' }], '', id(9)));
  assert.ok('error' in live.visitFormAction(v, [{ done: true, note: '' }, { done: true, note: '' }], 'x'.repeat(2001), id(9)));
  assert.ok('error' in live.visitFormAction(v, [{ done: true, note: '' }, { done: true, note: '' }], '', id(9), Array.from({ length: 11 }, () => id(7))));
});

test('sending a visit for review is blocked until a form exists', () => {
  const move = live.visitMoves('ready', 'in_progress', false)[0];
  assert.equal(move.status, 'in_review'); assert.equal(move.label, 'Send for review'); assert.equal(move.blocked, live.VISIT_FORM_FIRST);
  assert.equal(live.visitMoves('ready', 'in_progress', true)[0].blocked, undefined);
  assert.equal(live.visitMoves('ready', 'in_progress')[0].blocked, undefined, 'a caller that does not say is not blocked');
  assert.deepEqual(live.visitMoves('ready', 'in_review', true), [], 'Ready cannot sign off its own visit');
  assert.equal(live.visitMoves('stays', 'in_review', true)[0].status, 'approved');
  assert.equal(defaults.VISIT_FORM_REQUIRED, true);
  const t = source('VisitForm.tsx');
  assert.match(t, /visitMoves\(role, visit\.status, recorded\)/);
  assert.match(t, /action: "transitionWork"/);
});

test('a recorded form is read back with the dates the database stamped', () => {
  assert.equal(live.visitFormOf({}), null);
  assert.equal(live.visitFormOf({ visitForm: 'x' }), null);
  const f = live.visitFormOf(formData([true, false]));
  assert.equal(f.doneCount, 1); assert.equal(f.totalCount, 2); assert.equal(f.answers[1].note, 'Collection missed'); assert.equal(f.note, 'All fine');
  assert.deepEqual(live.visitDates(formData()), { lastDoneAt: '2026-10-12T10:00:00Z', nextDueOn: '2026-11-20' });
  assert.deepEqual(live.visitDates({}), { lastDoneAt: null, nextDueOn: null });
  assert.equal(live.daysFromNow('2026-10-01', TODAY), '12 days ago');
  assert.equal(live.daysFromNow(TODAY, TODAY), 'today');
  assert.equal(live.daysFromNow('2026-10-12', TODAY), 'yesterday');
  assert.equal(live.daysFromNow('2026-10-16', TODAY), 'in 3 days');
  assert.equal(live.londonDayOf('2026-10-12T23:30:00Z'), '2026-10-13', 'UK time: 00:30 on the 13th during summer time');
});

test('preventative rows: Due, Overdue and Done, with last done and next due', () => {
  const overdue = visit(1, { dueOn: '2026-10-05' }, { lastDoneAt: '2026-09-04T09:00:00Z' });
  const due = visit(2, { dueOn: '2026-10-20', title: 'Garden tidy', propertyId: id(2) });
  const done = visit(3, { status: 'in_review' }, formData());
  const [o] = preventativeTrackerItems([overdue], ctx(), 'ready');
  assert.equal(o.section, 'preventative'); assert.equal(o.status.label, 'Overdue'); assert.equal(o.status.tone, 'bad'); assert.equal(o.address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.deepEqual(o.nextAction, { label: 'Record visit', actionKey: RECORD_VISIT_KEY });
  assert.match(o.nextStep, /last done 39 days ago/);
  assert.ok(o.details.some(d => d.label === 'Last done' && /39 days ago/.test(d.value)));
  assert.ok(o.details.some(d => d.label === 'Visit type' && d.value === 'Bins'));
  assert.deepEqual(o.steps.map(s => s.state), ['current', 'todo', 'todo', 'todo']);
  const [d] = preventativeTrackerItems([due], ctx(), 'stays');
  assert.equal(d.status.label, 'Due'); assert.equal(d.address, 'Harbour cottage', 'no address held, so the name');
  assert.ok(d.details.some(x => x.label === 'Visit type' && x.value === 'Garden'));
  const [n] = preventativeTrackerItems([done], ctx(), 'ready');
  assert.equal(n.status.label, 'Done'); assert.equal(n.closed, false); assert.equal(n.nextAction.label, 'Waiting for Stays');
  assert.ok(n.details.some(x => x.label === 'Next due' && /20 Nov/.test(x.value)));
  assert.ok(n.details.some(x => x.label === 'Checklist' && x.value === '2 of 2 done'));
  assert.deepEqual(n.steps.map(s => s.state), ['done', 'done', 'done', 'current']);
  // After the form, Ready can send an in-progress visit for review; Stays sign off.
  const [started] = preventativeTrackerItems([visit(4, { status: 'in_progress' }, formData())], ctx(), 'ready');
  assert.equal(started.nextAction.label, 'Send for review');
  const [signing] = preventativeTrackerItems([visit(5, { status: 'in_review' }, formData())], ctx(), 'stays');
  assert.equal(signing.nextAction.label, 'Sign off');
  // A missing form keeps the form as the next action even when the visit has been started.
  const [begun] = preventativeTrackerItems([visit(6, { status: 'in_progress' })], ctx(), 'ready');
  assert.equal(begun.nextAction.actionKey, RECORD_VISIT_KEY);
  assert.deepEqual(begun.steps.map(s => s.state), ['done', 'current', 'todo', 'todo']);
});

test('preventative rows are ordered overdue first, then due soonest, then done, then finished', () => {
  const closed = visit(4, { status: 'completed', dueOn: '2026-09-20' }, formData([true, true], { lastDoneAt: '2026-09-20T10:00:00Z', nextDueOn: '2026-10-20' }));
  const rows = preventativeTrackerItems([
    visit(1, { dueOn: '2026-10-25' }), closed, visit(2, { dueOn: '2026-10-02' }), visit(3, { dueOn: '2026-10-18' }), visit(5, { dueOn: '2026-10-01' }), visit(6, { status: 'in_review' }, formData()),
  ], ctx(), 'ready');
  assert.deepEqual(rows.map(r => r.status.label), ['Overdue', 'Overdue', 'Due', 'Due', 'Done', 'Done']);
  assert.deepEqual(rows.slice(0, 4).map(r => r.id), [id(105), id(102), id(103), id(101)], 'longest overdue first, then soonest due');
  assert.equal(rows[5].closed, true, 'finished visits come last');
  assert.equal(rows[5].id, closed.workId);
});

test('one row per plan: the open visit stands for the plan and the plan keeps its last done date', () => {
  const lastMonth = visit(1, { status: 'completed', dueOn: '2026-09-20' }, formData([true, true], { lastDoneAt: '2026-09-21T10:00:00Z', nextDueOn: '2026-10-20' }));
  const thisMonth = { ...visit(1, { dueOn: '2026-10-20' }), workId: id(900) };
  const rows = preventativeTrackerItems([lastMonth, thisMonth], ctx(), 'ready');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id(900));
  assert.equal(rows[0].status.label, 'Due');
  assert.ok(rows[0].details.some(d => d.label === 'Last done' && /22 days ago/.test(d.value)));
  assert.deepEqual(preventativeInfo([lastMonth, thisMonth], TODAY), { state: 'due', lastDoneAt: '2026-09-21T10:00:00Z', nextDueOn: '2026-10-20', formRecorded: false });
  // Cancelled visits and other kinds are left out; owners get nothing.
  assert.deepEqual(preventativeTrackerItems([visit(1, { status: 'cancelled' }), { ...visit(2), kind: 'maintenance' }], ctx(), 'ready'), []);
  assert.deepEqual(preventativeTrackerItems([visit(1)], ctx({ owner: true }), 'client'), []);
  // Accounts and cleaners are not offered an action.
  assert.equal(preventativeTrackerItems([visit(1)], ctx(), 'accounts')[0].nextAction, null);
});

test('the preventative list is wired: SectionProps, Record visit, the form, flags, staff only', () => {
  const t = source('PreventativeList.tsx');
  assert.match(t, /export function PreventativeList\(\{ palette: p, account, properties, work/);
  assert.match(t, /SectionProps/);
  assert.match(t, /preventativeTrackerItems\(/);
  assert.match(t, /<VisitForm /);
  assert.match(t, /<VisitMoves /);
  assert.match(t, /<FlagButton /);
  assert.match(t, /account\.role === "client"/);
  assert.match(t, /<TrackerList /);
  const form = source('VisitForm.tsx');
  assert.match(form, /writeTeams\(built\.action\)/);
  assert.match(form, /export function VisitForm\(/);
  assert.match(source('LiveRepairs.tsx'), /<VisitForm /);
});

test('no em dashes in the maintenance files', () => {
  const dash = String.fromCharCode(0x2014);
  for (const file of ['mobile/src/LiveRepairs.tsx', 'mobile/src/VisitForm.tsx', 'mobile/src/PreventativeList.tsx', 'lib/repairs-live.ts', 'lib/tracker-repairs.ts', 'lib/operations-policy.ts']) assert.ok(!readFileSync(file, 'utf8').includes(dash), file);
});
