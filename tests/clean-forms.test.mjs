import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Clean forms (B1 and B2, client answer 8): the form state of a clean at an instant (Unsubmitted after 18:00 UK
// on the day, Warning from 09:00 the next day, also across the clock changes), the forms that are in, the counts, the next action, the
// "Sent to management" line and the tick the review needs before a clean can be accepted.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const f = await vite.ssrLoadModule('/lib/clean-forms.ts');
const defaults = await vite.ssrLoadModule('/lib/feedback-defaults.ts');

const A = '11111111-1111-4111-8111-111111111111';
const clean = (dueOn, extra = {}, data = {}) => ({ dueOn, status: 'in_progress', assigneeId: A, data: { phase: 'assigned', dueOn, checklist: ['Kitchen', 'Bathrooms'], ...data }, ...extra });
const at = iso => new Date(iso);

test('the cut-off is 18:00 UK time on the clean day: outstanding after it, not due before it', () => {
  assert.equal(defaults.CLEAN_FORM_DUE_BY, '18:00');
  const c = clean('2026-11-10');
  assert.equal(f.formState(c, at('2026-11-10T09:00:00Z')), 'not_due');
  assert.equal(f.formState(c, at('2026-11-10T17:59:59Z')), 'not_due');
  assert.equal(f.formState(c, at('2026-11-10T18:00:00Z')), 'not_due', 'exactly 18:00 is still on time');
  assert.equal(f.formState(c, at('2026-11-10T18:00:01Z')), 'outstanding');
  assert.equal(f.formState(c, at('2026-11-10T23:59:59Z')), 'outstanding');
  assert.equal(f.formState(c, at('2026-11-09T22:00:00Z')), 'not_due', 'the day before');
});

test('the warning begins at 09:00 UK time the day after the clean; until then the clean is unsubmitted', () => {
  assert.equal(defaults.CLEAN_FORM_ESCALATE_AT, '09:00');
  assert.equal(f.FORM_STATE_LABEL.outstanding, 'Unsubmitted');
  const c = clean('2026-11-10');
  assert.equal(f.formState(c, at('2026-11-11T00:00:00Z')), 'outstanding');
  assert.equal(f.formState(c, at('2026-11-11T08:59:59Z')), 'outstanding');
  assert.equal(f.formState(c, at('2026-11-11T09:00:00Z')), 'warning');
  assert.equal(f.formState(c, at('2026-11-14T10:00:00Z')), 'warning');
  // In summer 09:00 UK is 08:00 UTC.
  const s = clean('2026-07-10');
  assert.equal(f.formState(s, at('2026-07-11T07:59:59Z')), 'outstanding');
  assert.equal(f.formState(s, at('2026-07-11T08:00:00Z')), 'warning');
  // The database reminder shows at once, whatever the device's clock says.
  assert.equal(f.formState(clean('2026-11-10', {}, { unsubmittedAt: '2026-11-10T18:01:00Z' }), at('2026-11-10T17:00:00Z')), 'outstanding');
});

test('the cut-off holds across the clock changes (spring forward 29 March, back 25 October 2026)', () => {
  // 29 March: UK summer time starts at 01:00 UTC, so 18:00 UK is 17:00 UTC.
  const spring = clean('2026-03-29');
  assert.equal(f.formState(spring, at('2026-03-29T16:59:59Z')), 'not_due');
  assert.equal(f.formState(spring, at('2026-03-29T17:00:01Z')), 'outstanding');
  // The day before is still winter time: 18:00 UK is 18:00 UTC.
  const eve = clean('2026-03-28');
  assert.equal(f.formState(eve, at('2026-03-28T17:30:00Z')), 'not_due');
  assert.equal(f.formState(eve, at('2026-03-28T18:00:01Z')), 'outstanding');
  // 25 October: UK summer time ends at 01:00 UTC, so 18:00 UK is 18:00 UTC.
  const autumn = clean('2026-10-25');
  assert.equal(f.formState(autumn, at('2026-10-25T17:59:59Z')), 'not_due');
  assert.equal(f.formState(autumn, at('2026-10-25T18:00:01Z')), 'outstanding');
  // The day before is still summer time: 18:00 UK is 17:00 UTC, and the day ends at 23:00 UTC.
  const before = clean('2026-10-24');
  assert.equal(f.formState(before, at('2026-10-24T17:30:00Z')), 'outstanding');
  assert.equal(f.formState(before, at('2026-10-24T22:59:59Z')), 'outstanding');
  assert.equal(f.formState(before, at('2026-10-24T23:00:00Z')), 'outstanding', 'midnight UK, not yet the next morning');
  // The clocks have gone back by the next morning, so its warning begins at 09:00 UTC on the 25th.
  assert.equal(f.formState(before, at('2026-10-25T08:59:59Z')), 'outstanding');
  assert.equal(f.formState(before, at('2026-10-25T09:00:00Z')), 'warning');
  assert.equal(f.formState(autumn, at('2026-10-26T00:00:00Z')), 'outstanding');
  assert.equal(f.formState(autumn, at('2026-10-26T09:00:00Z')), 'warning');
});

test('a form that is in is submitted whatever the time, even late', () => {
  const submitted = clean('2026-11-10', {}, { phase: 'review', report: 'Done', submittedBy: A });
  for (const when of ['2026-11-10T09:00:00Z', '2026-11-10T20:00:00Z', '2026-11-20T09:00:00Z']) assert.equal(f.formState(submitted, at(when)), 'submitted', when);
  assert.equal(f.formState(clean('2026-11-10', {}, { phase: 'accepted' }), at('2026-12-01T00:00:00Z')), 'submitted');
  // A clean sent back for another go keeps its first report, so its form is in.
  assert.equal(f.formState(clean('2026-11-10', {}, { phase: 'assigned', accepted: false, report: 'Cleaned' }), at('2026-11-20T00:00:00Z')), 'submitted');
  // Late: the database had warned, then the cleaner sent it.
  const late = clean('2026-11-10', {}, { warning: 'no_form', formWarningAt: '2026-11-11T00:05:00Z', phase: 'review', report: 'Sorry, late' });
  assert.equal(f.formState(late, at('2026-11-12T00:00:00Z')), 'submitted');
  assert.equal(f.submittedLate(late), true);
  assert.equal(f.submittedLate(submitted), false);
});

test('the database warning shows at once, before the next day', () => {
  const marked = clean('2026-11-10', {}, { warning: 'no_form', formWarningAt: '2026-11-10T21:00:00Z' });
  assert.equal(f.formState(marked, at('2026-11-10T09:00:00Z')), 'warning');
  assert.equal(f.formState(marked, at('2026-11-10T21:30:00Z')), 'warning');
  // Any other warning value is not the form warning.
  assert.equal(f.formState(clean('2026-11-10', {}, { warning: 'something_else' }), at('2026-11-10T09:00:00Z')), 'not_due');
});

test('nothing is due for a clean nobody has, a cancelled one, one with no date or one with unknown data', () => {
  const late = at('2026-12-01T12:00:00Z');
  assert.equal(f.formState(clean('2026-11-10', { assigneeId: null }), late), 'not_due');
  assert.equal(f.formState(clean('2026-11-10', { status: 'cancelled' }), late), 'not_due');
  assert.equal(f.formState(clean(null), late), 'not_due');
  assert.equal(f.formState(clean('not a date'), late), 'not_due');
  assert.equal(f.formState({ dueOn: '2026-11-10', assigneeId: A }, late), 'not_due');
  assert.equal(f.formState(clean('2026-11-10'), new Date('nonsense')), 'not_due');
  assert.equal(f.isMissing('outstanding') && f.isMissing('warning'), true);
  assert.equal(f.isMissing('submitted') || f.isMissing('not_due'), false);
});

test('the forms that are in: checklist, photos, report and the property check', () => {
  const none = f.formsIn(clean('2026-11-10').data);
  assert.deepEqual([none.count, none.checklist, none.photos, none.report], [0, false, 0, false]);
  assert.equal(f.formsText(none), 'Nothing in yet');
  const all = f.formsIn(clean('2026-11-10', {}, { phase: 'review', checks: ['Kitchen', 'Bathrooms'], photoIds: ['a', 'b', 'c'], report: 'All done', condition: { x: 1 }, submittedBy: A }).data);
  assert.deepEqual([all.count, all.expected, all.checks, all.photos, all.propertyCheck], [3, 3, 2, 3, true]);
  assert.equal(f.formsText(all), 'Checklist · 3 photos · Report · Property check');
  assert.equal(f.formsText(f.formsIn({ phase: 'review', report: 'Done', photoIds: ['a'], checklist: ['Kitchen'] })), 'Checklist · 1 photo · Report');
  assert.equal(f.formsIn(null).count, 0);
});

test('counts per day and overall leave out cancelled cleans and count outstanding plus warning as missing', () => {
  const now = at('2026-11-11T09:00:00Z');
  const cleans = [
    clean('2026-11-10', {}, { phase: 'review', report: 'Done' }),
    clean('2026-11-10'),
    clean('2026-11-10', {}, { warning: 'no_form' }),
    clean('2026-11-10', { status: 'cancelled' }),
    clean('2026-11-11'),
    clean('2026-11-12', { assigneeId: null }),
    clean(null),
  ];
  const day = f.countFormsByDay(cleans, now);
  assert.deepEqual(Object.keys(day).sort(), ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.deepEqual(day['2026-11-10'], { submitted: 1, outstanding: 0, warning: 2, not_due: 0, total: 3, missing: 2 });
  assert.deepEqual(day['2026-11-11'], { submitted: 0, outstanding: 0, warning: 0, not_due: 1, total: 1, missing: 0 });
  const all = f.countForms(cleans, now);
  assert.deepEqual(all, { submitted: 1, outstanding: 0, warning: 2, not_due: 3, total: 6, missing: 2 });
  const evening = f.countForms(cleans, at('2026-11-11T19:00:00Z'));
  assert.equal(evening.outstanding, 1, 'the 11th is outstanding after 18:00');
  assert.equal(evening.missing, 3);
});

test('a warning clean says "Sent to management" only when management holds an open flag for it', () => {
  const W = '22222222-2222-4222-8222-222222222222';
  const flag = (extra = {}) => ({ id: '33333333-3333-4333-8333-333333333333', source: 'clean_form', workId: W, title: 'No form', reason: 'No form was sent for this clean', status: 'open', createdAt: '2026-11-11T00:05:00Z', version: 1, ...extra });
  assert.equal(f.managementLine('warning', [flag()], W), 'Sent to management');
  assert.equal(f.managementLine('warning', [flag({ status: 'resolved' })], W), null);
  assert.equal(f.managementLine('warning', [flag({ workId: '44444444-4444-4444-8444-444444444444' })], W), null);
  assert.equal(f.managementLine('outstanding', [flag()], W), null);
  assert.equal(f.managementLine('warning', [], W), null, 'no flags read, no line');
  assert.equal(f.managementLine('warning', undefined, W), null);
});

test('the next action follows the phase and who is looking', () => {
  const manager = { manager: true, userId: 'm' }, cleaner = { manager: false, userId: A };
  const next = (c, v) => f.cleanNext(c, v);
  assert.deepEqual(next(clean('2026-11-10', { assigneeId: null }), manager), { label: 'Assign a cleaner', mine: true });
  assert.equal(next(clean('2026-11-10', { assigneeId: null }), cleaner).mine, false);
  assert.deepEqual(next(clean('2026-11-10'), cleaner), { label: 'Send your form', mine: true });
  assert.deepEqual(next(clean('2026-11-10'), manager), { label: 'Waiting for the cleaner to send the form', mine: false });
  assert.equal(next(clean('2026-11-10', {}, { accepted: false }), cleaner).label, 'Clean it again and send the form');
  assert.deepEqual(next(clean('2026-11-10', {}, { phase: 'review' }), manager), { label: 'Check the form and guest feedback', mine: true });
  assert.equal(next(clean('2026-11-10', {}, { phase: 'review' }), { manager: true, userId: A }).mine, false, 'nobody reviews their own clean');
  assert.equal(next(clean('2026-11-10', {}, { phase: 'accepted' }), manager), null);
  assert.equal(next(clean('2026-11-10', { status: 'cancelled' }), manager), null);
});

test('accepting a clean needs the "form checked and guest happy" tick; rejecting does not', () => {
  const draft = (extra = {}) => ({ accepted: true, formChecked: true, guestFeedback: 'Guest was happy', reviewNote: 'Checked the form', ...extra });
  assert.deepEqual(f.reviewBlockers(draft()), []);
  assert.deepEqual(f.reviewBlockers(draft({ formChecked: false })), ['Tick that the form is checked and the guest is happy.']);
  assert.deepEqual(f.reviewBlockers(draft({ accepted: false, formChecked: false })), []);
  assert.deepEqual(f.reviewBlockers(draft({ accepted: null, formChecked: false })), ['Choose Accept or Reject.']);
  assert.equal(f.reviewBlockers(draft({ guestFeedback: 'ok', reviewNote: '' })).length, 2);
  assert.equal(f.FORM_CHECKED_LABEL, 'Form checked and guest happy');
  assert.match(f.REJECT_NOTE, /goes to management/);
});

test('the Cleans screens show the forms column, the filter, the tick and the flag button', () => {
  const live = readFileSync('mobile/src/LiveCleans.tsx', 'utf8'), who = readFileSync('mobile/src/DefaultCleaners.tsx', 'utf8');
  assert.match(live, /label: "Submitted forms"/);
  assert.match(live, /Unsubmitted forms/);
  assert.match(live, /FORM_CHECKED_LABEL/);
  assert.match(live, /REJECT_NOTE/);
  assert.match(live, /<FlagButton /);
  assert.match(live, /reviewBlockers\(/);
  assert.match(live, /canStart\(account, "new-clean"\) && <Button/, 'the new-clean form stays on the screen');
  assert.match(live, /focus\?\.open === "new-clean"/);
  assert.match(who, /formState/);
  assert.match(who, /FormStateTag/);
});

test('no em dashes in the clean forms files', () => {
  for (const file of ['lib/clean-forms.ts', 'tests/clean-forms.test.mjs', 'mobile/src/LiveCleans.tsx', 'mobile/src/DefaultCleaners.tsx'])
    assert.equal(readFileSync(file, 'utf8').includes(String.fromCharCode(8212)), false, file);
});
