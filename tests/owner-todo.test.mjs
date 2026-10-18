import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// The super admins' To-do (Lee: "the super admin are the owners of the company"): it opens on what the company needs
// from them (approvals, and the to-dos given to them, the most important on top), with buttons for their employees'
// to-dos and for the whole company's list.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const O = await vite.ssrLoadModule('/lib/owner-todo.ts');
const T = await vite.ssrLoadModule('/lib/todo.ts');
const ME = '11111111-1111-4111-8111-111111111111', FIONA = '22222222-2222-4222-8222-222222222222', ROSS = '33333333-3333-4333-8333-333333333333';
const today = '2026-10-18';
const item = (id, extra) => ({ id, kind: 'todo', title: 'Task ' + id, details: '', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null, department: null, dueOn: null,
  amountMinor: null, settledMinor: null, link: null, reference: '', status: 'open', outcomeNote: '', decidedBy: null, decidedAt: null, createdBy: ME, createdByName: 'Lee', createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-01T09:00:00Z', version: 1, updateCount: 0, updates: [], ...extra });
const hub = [
  item('a', { assigneeId: ME, assigneeName: 'Lee', dueOn: '2026-10-25' }),
  item('b', { dueOn: '2026-10-10' }),
  item('c', { assigneeId: FIONA, assigneeName: 'Fiona', dueOn: '2026-10-12' }),
  item('d', { assigneeId: FIONA, assigneeName: 'Fiona' }),
  item('e', { assigneeId: ROSS, assigneeName: 'Ross', dueOn: today }),
  item('f', { department: 'client_relations' }),
  item('g', { assigneeId: ME, status: 'done' }),
  item('h', { dueOn: today }),
];
const rows = [...T.hubRows(hub, ME, []), ...T.deriveTasks({ role: 'super_admin', today, properties: [], work: [], journeys: [] })];
const approvals = O.approvalTodoRows([
  { id: 'repair:w1', closed: false, title: 'Boiler repair, £640', nextStep: 'Approve or decline the cost', propertyId: null, address: 'No property', lastUpdate: { at: '2026-10-15T10:00:00Z' } },
  { id: 'hub:x', closed: false, title: 'New laptop', nextStep: 'Decide', propertyId: 'p1', address: '8 Shore Road', lastUpdate: { at: '2026-10-16T10:00:00Z' } },
  { id: 'flag:old', closed: true, title: 'Done already', nextStep: '', propertyId: null, address: '', lastUpdate: null },
]);

test('only super admins get it', () => {
  assert.equal(O.hasOwnerTodo('super_admin'), true);
  for (const role of ['admin', 'stays', 'cleans', 'accounts', 'client']) assert.equal(O.hasOwnerTodo(role), false, role);
  assert.deepEqual(O.OWNER_TODO_VIEWS.map(v => O.OWNER_TODO_LABEL[v]), ['Needs you', "Employees' to-dos", 'Company to-do list']);
});

test('Needs you: overdue, due today, approvals (longest waiting first), due later; nothing of anyone else\'s', () => {
  const needs = O.ownerNeeds(rows, approvals, ME, today);
  assert.deepEqual(needs.map(r => r.id), ['b', 'h', 'approval:repair:w1', 'approval:hub:x', 'a']);
  const approval = needs[2];
  assert.equal(approval.title, 'Approve: Boiler repair, £640');
  assert.equal(approval.address, null);
  assert.deepEqual(approval.open, { target: { kind: 'work', view: 'hub', sub: 'approvals' } });
  assert.equal(T.todoCells(approval, today).status, 'Approval');
  assert.equal(needs[3].address, '8 Shore Road');
});

test("employees' to-dos: person by person, the most overdue first, each most important first", () => {
  const groups = O.teamTodoGroups(rows, ME, today);
  assert.deepEqual(groups.map(g => [g.who, g.rows.map(r => r.id), g.overdue, g.dueToday]), [
    ['Fiona', ['c', 'd'], 1, 0],
    ['Ross', ['e'], 0, 1],
    ['Client relations', ['f'], 0, 0],
  ]);
});

test('wiring: the To-do page opens super admins on Needs you, with the views as buttons', async () => {
  const screen = await fs.readFile('mobile/src/TodoList.tsx', 'utf8');
  assert.match(screen, /const \[view, setView\] = useState<OwnerTodoView>\(ownerTodo \? "mine" : "company"\);/);
  assert.match(screen, /OWNER_TODO_VIEWS\.map\(v => <Chip /);
  assert.match(screen, /readTeams\(\{ section: "flags" \}\), readTeams\(\{ section: "management" \}\)/);
  assert.match(screen, /\{company && \(!loading \|\| !!rows\.length\) && groups\.filter\(/, 'the company list is the one everyone else sees');
  assert.doesNotMatch(await fs.readFile('lib/owner-todo.ts', 'utf8'), /—/);
});
