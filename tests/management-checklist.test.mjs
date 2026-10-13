import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Management's "Today's checklist" (lib/management-checklist.ts, mobile/src/ManagementChecklist.tsx): today's
// to-dos made from the Management daily tasks, ticked with the To-do list's own action.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
const C = await vite.ssrLoadModule('/lib/management-checklist.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { todoHubItemSchema } = await vite.ssrLoadModule('/lib/todo.ts');
after(() => vite.close());

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-13';
const item = (n, over = {}) => todoHubItemSchema.parse({
  id: uuid(n), kind: 'todo', title: 'Task ' + n, details: '', propertyId: null, propertyName: null, assigneeId: null, assigneeName: null,
  department: 'management', dueOn: TODAY, amountMinor: null, settledMinor: null, link: null, reference: 'TD-' + n, status: 'open', outcomeNote: '',
  decidedBy: null, decidedAt: null, createdBy: uuid(99), createdByName: 'Automatic', createdAt: `2026-10-13T06:0${n % 10}:00Z`, updatedAt: '2026-10-13T06:00:00Z',
  version: 1, templateId: uuid(100 + n), ...over,
});

test("which rows count: today's to-dos from a Management daily task, open or done", () => {
  const items = [
    item(1),
    item(2, { status: 'done', decidedBy: 'Morag Campbell', decidedAt: '2026-10-13T08:14:00Z' }),
    item(3, { templateId: null }), // made by hand
    item(4, { department: 'cleaning' }), // another department's daily task
    item(5, { dueOn: '2026-10-12' }), // yesterday's
    item(6, { kind: 'approval' }),
    item(7, { department: null, templateId: null, assigneeId: uuid(2) }),
  ];
  const rows = C.managementChecklist(items, TODAY);
  assert.deepEqual(rows.map(r => r.title), ['Task 1', 'Task 2']);
  assert.deepEqual(C.checklistProgress(rows), { done: 1, total: 2, label: '1 of 2 done' });
  assert.equal(rows[1].tickedBy, 'Morag Campbell');
  assert.equal(C.tickedLine(rows[1]), 'Ticked by Morag Campbell at 09:14', 'UK time');
  assert.equal(C.tickedLine(rows[0]), '');
  assert.deepEqual(C.managementChecklist([], TODAY), []);
});

test('who sees it: admins, super admins and the management department; who may set it up: admins', () => {
  assert.equal(C.seesManagementChecklist('admin', null), true);
  assert.equal(C.seesManagementChecklist('super_admin', 'cleaning'), true);
  assert.equal(C.seesManagementChecklist('stays', 'management'), true);
  for (const [role, department] of [['stays', 'guest_relations'], ['cleans', 'cleaning'], ['accounts', null], ['client', null], ['cleaning_manager', 'cleaning']])
    assert.equal(C.seesManagementChecklist(role, department), false, role);
  assert.equal(C.canSetUpChecklist('admin'), true);
  assert.equal(C.canSetUpChecklist('stays'), false);
});

test("ticking is the To-do list's own action, valid for the server", () => {
  const [open] = C.managementChecklist([item(1)], TODAY);
  const tick = C.tickAction(open, uuid(500));
  assert.deepEqual(tick, { action: 'moveHubItem', requestId: uuid(500), id: uuid(1), version: 1, status: 'done' });
  assert.ok(teamsActionSchema.safeParse(tick).success, 'the request passes the server schema');
  const [done] = C.managementChecklist([item(2, { status: 'done', version: 4 })], TODAY);
  assert.equal(C.tickAction(done, uuid(501)).status, 'open', 'unticking reopens it');
  // The To-do list sends the same action for the same rows.
  const todo = readFileSync('mobile/src/TodoList.tsx', 'utf8');
  assert.match(todo, /writeTeams\(\{ action: "moveHubItem", requestId: [^,]+, id: item\.id, version: item\.version, status: row\.done \? "open" : "done" \}\)/);
  const card = readFileSync('mobile/src/ManagementChecklist.tsx', 'utf8');
  assert.match(card, /await writeTeams\(tickAction\(row, /);
  assert.match(card, /readTeams\(\{ section: "hub" \}\)/, 'the same hub read as the To-do list');
});

test('the card sits at the top of Management, and "Set up the checklist" opens Daily tasks showing Management only', () => {
  const management = readFileSync('mobile/src/LiveManagement.tsx', 'utf8'), card = readFileSync('mobile/src/ManagementChecklist.tsx', 'utf8');
  assert.ok(management.indexOf('<ManagementChecklist ') < management.indexOf('<Pills p={p} values={MANAGEMENT_VIEWS'), 'above the view picker');
  assert.match(management, /onSetUp=\{\(\) => \{ setDailyOnly\("management"\); setView\("dailytasks"\); \}\}/);
  assert.match(management, /<DailyTaskSettings p=\{p\} account=\{account\} only=\{dailyOnly\}/);
  assert.match(card, /No daily checklist yet\./);
  assert.match(card, /canSetUpChecklist\(account\.role\) && <MotionPress accessibilityRole="link"/);
  assert.doesNotMatch(card, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'theme tokens only');
});
