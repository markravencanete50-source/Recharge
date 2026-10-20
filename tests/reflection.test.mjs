import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The end-of-day reflection helpers (ask A7): which roles need one, what counts as a reflection, the
// action that is sent, and how the two reads are shaped when fields are missing. All pure.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const r = await vite.ssrLoadModule('/lib/reflection.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const defaults = await vite.ssrLoadModule('/lib/feedback-defaults.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DASHES = new RegExp(String.fromCharCode(0x2014) + '|' + String.fromCharCode(0x2013));
const EMDASH = new RegExp(String.fromCharCode(0x2014));
const draft = (over = {}) => ({ wentWell: 'Two clean handovers', notWell: '', feedback: '', ...over });

test('needsReflection follows the shared role list: stays, ready, accounts and cleaning managers', () => {
  for (const role of ['stays', 'ready', 'accounts', 'cleaning_manager']) assert.equal(r.needsReflection(role), true, role);
  for (const role of ['cleans', 'admin', 'super_admin', 'client', '', null, undefined]) assert.equal(r.needsReflection(role), false, String(role));
  for (const role of ['stays', 'cleans', 'admin', 'x']) assert.equal(r.needsReflection(role), defaults.reflectionRequired(role));
});

test('a reflection needs three real characters in went well or not well, either one is enough', () => {
  assert.equal(r.validateReflection(draft()).ok, true);
  assert.equal(r.validateReflection(draft({ wentWell: '', notWell: 'Late key' })).ok, true);
  assert.equal(r.validateReflection(draft({ wentWell: 'abc', notWell: '' })).ok, true);
  for (const bad of [draft({ wentWell: '' }), draft({ wentWell: 'ab' }), draft({ wentWell: '  a  ', notWell: ' b ' }), draft({ wentWell: '', notWell: '', feedback: 'Only feedback here' })]) {
    const result = r.validateReflection(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.match(result.error, /went well|did not/i);
  }
});

test('every box is capped at 2000 characters', () => {
  assert.equal(r.validateReflection(draft({ wentWell: 'a'.repeat(2000) })).ok, true);
  for (const field of ['wentWell', 'notWell', 'feedback']) {
    const result = r.validateReflection(draft({ [field]: 'a'.repeat(2001) }));
    assert.equal(result.ok, false, field);
    assert.match(result.error, /2000/);
  }
});

test('the saveReflection action is trimmed, capped and passes the shared action schema', () => {
  const action = r.buildSaveReflection({
    requestId: id(1), shiftId: id(2), wentWell: '  Good day  ', notWell: ' ', feedback: ' Needs a second phone ',
    completed: [{ kind: 'ticket', ref: id(3), label: ' Boiler fixed ' }, { kind: 'todo', ref: null, label: 'Call the sweep' }],
  });
  assert.deepEqual(action, {
    action: 'saveReflection', requestId: id(1), shiftId: id(2), wentWell: 'Good day', notWell: '', feedback: 'Needs a second phone',
    completed: [{ kind: 'ticket', ref: id(3), label: 'Boiler fixed' }, { kind: 'todo', label: 'Call the sweep' }],
  });
  assert.equal(teamsActionSchema.safeParse(action).success, true);
  // No shift id is sent when there is none: the database uses the open shift.
  const bare = r.buildSaveReflection({ requestId: id(1), ...draft() });
  assert.equal('shiftId' in bare, false);
  assert.deepEqual(bare.completed, []);
  assert.equal(teamsActionSchema.safeParse(bare).success, true);
});

test('the completed list drops blanks and repeats, and never exceeds the database limits', () => {
  const items = [
    { kind: 'ticket', ref: id(1), label: 'A' }, { kind: 'ticket', ref: id(1), label: 'A again' }, { kind: 'ticket', ref: null, label: '   ' },
    { kind: 'todo', ref: null, label: 'Same' }, { kind: 'todo', ref: null, label: 'Same' }, { kind: 'todo', ref: null, label: 'x'.repeat(500) },
  ];
  const out = r.completedForAction(items);
  assert.deepEqual(out.map(i => i.label.length), [1, 4, 200]);
  const many = Array.from({ length: 150 }, (_, n) => ({ kind: 'ticket', ref: id(n + 1), label: `Ticket ${n}` }));
  assert.equal(r.completedForAction(many).length, 100);
  assert.equal(teamsActionSchema.safeParse(r.buildSaveReflection({ requestId: id(1), ...draft(), completed: many })).success, true);
});

test('markReflectionsReviewed removes repeats, caps at 100 and passes the schema', () => {
  const action = r.buildMarkReviewed(id(9), [id(1), id(1), id(2), '']);
  assert.deepEqual(action, { action: 'markReflectionsReviewed', requestId: id(9), ids: [id(1), id(2)] });
  assert.equal(teamsActionSchema.safeParse(action).success, true);
  assert.equal(r.buildMarkReviewed(id(9), Array.from({ length: 130 }, (_, n) => id(n + 1))).ids.length, 100);
});

test('the summary is shaped with zeros when fields are missing or wrong', () => {
  const empty = { day: null, ticketsTouched: 0, ticketsCompleted: 0, todosDone: 0, guestReplies: 0, items: [] };
  for (const raw of [undefined, null, {}, 'oops', 5, []]) assert.deepEqual(r.shapeSummary(raw), empty, String(raw));
  const partial = r.shapeSummary({ day: '2026-10-13', ticketsTouched: 4, guestReplies: '3', todosDone: -2, ticketsCompleted: 'x', items: [{ kind: 'ticket', ref: id(1), label: 'Boiler' }, { label: '  ' }, { kind: 'todo' }, 'bad'] });
  assert.equal(partial.day, '2026-10-13');
  assert.equal(partial.ticketsTouched, 4);
  assert.equal(partial.guestReplies, 3);
  assert.equal(partial.todosDone, 0);
  assert.equal(partial.ticketsCompleted, 0);
  assert.deepEqual(partial.items.map(i => i.label), ['Boiler']);
});

test('the summary line and figures read plainly with singular and plural', () => {
  assert.equal(r.summaryLine({ ...r.shapeSummary({}), ticketsTouched: 3, ticketsCompleted: 2, todosDone: 1, guestReplies: 5 }), '3 tickets touched, 2 completed, 1 to-do done, 5 guest replies');
  assert.equal(r.summaryLine(r.shapeSummary({ ticketsTouched: 1, guestReplies: 1 })), '1 ticket touched, 0 completed, 0 to-dos done, 1 guest reply');
  assert.deepEqual(r.summaryFigures(r.shapeSummary({ ticketsTouched: 3, ticketsCompleted: 2, todosDone: 1, guestReplies: 5 })).map(f => f.value), [3, 2, 1, 5]);
});

test('the own reflection read is shaped from the database answer, and from nothing', () => {
  const nothing = r.shapeOwnReflection(undefined);
  assert.equal(nothing.required, false);
  assert.equal(nothing.missing, false);
  assert.equal(nothing.shift, null);
  assert.equal(nothing.reflection, null);
  assert.equal(nothing.summary.ticketsTouched, 0);
  const own = r.shapeOwnReflection({
    required: true, missing: true, day: '2026-10-13', shift: { id: id(2), department: 'guest_relations', clockedInAt: '2026-10-13T08:00:00Z' },
    summary: { ticketsTouched: 2, items: [{ kind: 'ticket', ref: id(3), label: 'Boiler' }] },
    reflection: { id: id(4), wentWell: 'Fine', completed: [{ kind: 'todo', label: 'Call' }], reviewedAt: null },
  });
  assert.equal(own.required, true);
  assert.equal(own.missing, true);
  assert.equal(own.shift.id, id(2));
  assert.equal(own.summary.items.length, 1);
  assert.equal(own.reflection.wentWell, 'Fine');
  assert.equal(own.reflection.notWell, '');
  assert.equal(own.reflection.summary.guestReplies, 0);
  assert.equal(own.reflection.completed[0].ref, null);
  // A reflection with no id is not a reflection.
  assert.equal(r.shapeOwnReflection({ reflection: { wentWell: 'x' } }).reflection, null);
});

test('the admin read keeps the order, counts unread and survives missing fields', () => {
  const list = r.shapeReflections({
    from: '2026-10-07', to: '2026-10-13', unreviewed: 3,
    items: [
      { id: id(1), fullName: 'Ana', day: '2026-10-13', wentWell: 'Good', summary: { ticketsCompleted: 2 } },
      { id: id(2), day: '2026-10-12', reviewedAt: '2026-10-13T09:00:00Z', reviewedByName: 'Lee' },
      { nonsense: true }, null,
    ],
  });
  assert.equal(list.items.length, 2);
  assert.equal(list.unreviewed, 3);
  assert.deepEqual(list.items.map(i => i.id), [id(1), id(2)]);
  assert.equal(list.items[0].summary.ticketsCompleted, 2);
  assert.equal(list.items[1].fullName, null);
  // Without a reported total the unread count comes from the rows.
  assert.equal(r.shapeReflections({ items: [{ id: id(1) }, { id: id(2), reviewedAt: '2026-10-13T09:00:00Z' }] }).unreviewed, 1);
  assert.deepEqual(r.shapeReflections(undefined), { from: null, to: null, unreviewed: 0, items: [] });
});

test('the admin window never asks the database for more than 31 days and starts from the right day', () => {
  assert.deepEqual(r.reflectionWindow('2026-10-13', 7), { from: '2026-10-07', to: '2026-10-13' });
  assert.deepEqual(r.reflectionWindow('2026-10-13', 1), { from: '2026-10-13', to: '2026-10-13' });
  const wide = r.reflectionWindow('2026-10-13', 400);
  assert.equal((Date.parse(wide.to) - Date.parse(wide.from)) / 86400000, 30);
  assert.equal(teamsReadSchema.safeParse({ section: 'reflections', ...wide }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: 'reflections', ...r.reflectionWindow('2026-03-31', 31) }).success, true);
});

test('the clock-out refusal is recognised, and other errors are not', () => {
  assert.equal(r.isReflectionRefusal(r.REFLECTION_REFUSAL), true);
  assert.equal(r.isReflectionRefusal('Fill in your end-of-day reflection before clocking out'), true);
  for (const other of ['You are not clocked in', '', 'Workflow access changed', null, undefined, 42]) assert.equal(r.isReflectionRefusal(other), false, String(other));
});

test('the copy is plain, short and has no em dashes', () => {
  for (const [key, text] of Object.entries(r.REFLECTION_COPY)) {
    assert.equal(typeof text, 'string', key);
    assert.doesNotMatch(text, DASHES, key);
    assert.ok(text.length > 0 && text.length < 140, key);
  }
  for (const file of ['lib/reflection.ts', 'mobile/src/DayReflection.tsx', 'mobile/src/ReflectionReview.tsx', 'tests/reflection.test.mjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), EMDASH, file);
  }
});

test('clocking out opens the reflection first for required roles, and other roles clock out as before', () => {
  const shifts = readFileSync('mobile/src/LiveShifts.tsx', 'utf8');
  assert.match(shifts, /needsReflection\(account\.role\)/);
  assert.match(shifts, /shift\.open && needsReflectionNow\) \{[^}]*setReflecting\(true\); return;/);
  assert.match(shifts, /isReflectionRefusal\(text\)/);
  assert.match(shifts, /<DayReflection palette=\{p\} visible=\{reflecting\}/);
  // The plain clock-out call is unchanged.
  assert.match(shifts, /action: "clockOut", requestId: request\.get\(\)/);
  // The old sign-off card now lives in its own file (Home offers it when nobody is clocked in).
  assert.match(readFileSync('mobile/src/SignOffCard.tsx', 'utf8'), /function SignOffCard/);
  const sheet = readFileSync('mobile/src/DayReflection.tsx', 'utf8');
  assert.match(sheet, /useRequestId/);
  assert.match(sheet, /disabled=\{busy\}/);
  assert.match(readFileSync('mobile/src/ReflectionReview.tsx', 'utf8'), /export function ReflectionReview/);
});
