import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Client enquiries (Lee and Alex): "As soon as possible" is a priority, tagged in the list and first within its step; the
// form's correspondence address and "existing client" are gone, while older answers still read; the team's own enquiry form
// no longer asks "Existing client?".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { PRIORITY_LABEL, START_WHEN, enquiryAnswersSchema, storedEnquiryAnswersSchema, isPriority, priorityFirst, valuationDraft } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { newEnquiryForm } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());

const ANSWERS = {
  fullName: 'Sam Roy', email: 'sam@example.com', phone: '07700 900123', propertyAddress: '9 Dalry Road\nEdinburgh EH11 2BG', propertyType: 'Flat',
  bedrooms: 2, wcs: 1, bathrooms: 1, shortLet: 'no', furnishQuote: 'no', compliance: 'yes', enquiryType: "I'm just exploring my options",
};
const item = (id, step, startWhen) => ({ id, step, answers: startWhen === undefined ? null : { ...ANSWERS, ...(startWhen ? { startWhen } : {}) } });

test('"As soon as possible" is a priority until the enquiry is closed or declined', () => {
  assert.equal(PRIORITY_LABEL, 'Priority');
  assert.equal(START_WHEN[0], 'As soon as possible');
  assert.equal(isPriority(item('a', 'received', 'As soon as possible'), 'received'), true);
  for (const step of ['valuing', 'estimate', 'estimate_ready', 'won']) assert.equal(isPriority(item('a', step, 'As soon as possible'), step), true, step);
  for (const step of ['closed', 'declined']) assert.equal(isPriority(item('a', step, 'As soon as possible'), step), false, step);
  assert.equal(isPriority(item('b', 'received', 'Within a month'), 'received'), false);
  assert.equal(isPriority(item('c', 'received', ''), 'received'), false, 'not answered');
  assert.equal(isPriority(item('d', 'sent'), 'sent'), false, 'no answers yet');
});

test('priority enquiries come first within their step; everything else keeps its place (newest first)', () => {
  const list = [
    item('r1', 'received', 'Within a month'), item('v1', 'valuing', 'Not sure yet'), item('r2', 'received', 'As soon as possible'),
    item('s1', 'sent'), item('v2', 'valuing', 'As soon as possible'), item('r3', 'received', 'As soon as possible'), item('c1', 'closed', 'As soon as possible'), item('c2', 'closed', ''),
  ];
  const sorted = priorityFirst(list, e => e.step).map(e => e.id);
  assert.deepEqual(sorted, ['r2', 'v2', 'r3', 's1', 'v1', 'r1', 'c1', 'c2'], 'each step keeps its places; its priority ones fill them first, in their own order');
  // Within one step (the filtered "To value" list) that is simply priority first.
  assert.deepEqual(priorityFirst(list.filter(e => e.step === 'received'), e => e.step).map(e => e.id), ['r2', 'r3', 'r1']);
  assert.deepEqual(priorityFirst([], e => e.step), []);
});

test('the Client enquiries list tags and sorts them', () => {
  const view = readFileSync('mobile/src/LiveEnquiries.tsx', 'utf8');
  assert.match(view, /const items = priorityFirst\(/);
  assert.match(view, /\{priority && <Tag label=\{PRIORITY_LABEL\} tone="wait" p=\{p\} \/>\}/);
  assert.match(view, /\$\{priority \? ", " \+ PRIORITY_LABEL : ""\}/, 'screen readers hear it too');
  assert.doesNotMatch(view, /—/);
});

test('new forms have no correspondence address or "existing client"; older answers still read and value', () => {
  assert.deepEqual(enquiryAnswersSchema.parse(ANSWERS), ANSWERS);
  assert.throws(() => enquiryAnswersSchema.parse({ ...ANSWERS, correspondenceAddress: '1 High St' }), /Unrecognized key/);
  const old = storedEnquiryAnswersSchema.parse({ ...ANSWERS, correspondenceAddress: '1 High St\nEdinburgh', existingClient: 'yes' });
  assert.deepEqual([old.correspondenceAddress, old.existingClient], ['1 High St\nEdinburgh', 'yes']);
  assert.throws(() => storedEnquiryAnswersSchema.parse({ ...ANSWERS, admin: true }), /Unrecognized key/, 'still strict');
  const fresh = valuationDraft(ANSWERS);
  assert.doesNotMatch(fresh.enquiry.notes, /Correspondence address/);
  assert.equal('existingClient' in fresh.enquiry, false);
  const before = valuationDraft(old);
  assert.match(before.enquiry.notes, /Correspondence address: 1 High St, Edinburgh/);
  assert.equal(before.enquiry.existingClient, true);
});

test('the team\'s enquiry form no longer asks "Existing client?"', () => {
  const form = newEnquiryForm(true);
  assert.equal(form.fields.some(f => f.name === 'existingClient'), false);
  const built = form.build({ contactName: 'Jo Smith', email: 'jo@example.com', address: '2 Harbour Road, Oban PA34 4LW', name: 'Harbour cottage', propertyType: 'Cottage', bedrooms: 2, bathrooms: 1 });
  assert.deepEqual(built.enquiry, { contactName: 'Jo Smith', email: 'jo@example.com' });
});
