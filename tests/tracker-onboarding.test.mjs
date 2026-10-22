import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Onboarding as a staged tracker list (client ask C3), plus the grouping helper, the Flagged tag and the
// three section components (onboarding, licensing, purchase orders) that take SectionProps.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const mod = await vite.ssrLoadModule('/lib/tracker-onboarding.ts');
const { ONBOARDING_STEPS, ONBOARDING_STAGES, onboardingTrackerItem, onboardingTrackerItems, enquiryTrackerItem, sortOnboarding, onboardingSection, groupBySection, percentOf, NEW_ENQUIRIES, journeyProgress } = mod;
const { ONBOARDING_PHASES } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const { withFlags } = await vite.ssrLoadModule('/lib/management-flags.ts');

const NOW = new Date('2026-10-13T12:00:00Z');
const PROPERTIES = { p1: { name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA' }, p2: { name: 'Harbour cottage', address: '' }, p3: { name: 'Stockbridge', address: '4 Raeburn Place, Edinburgh EH4 1HX' } };
const form = (key, title) => ({ key, title });
const WORK = {};
const ctx = (over = {}) => ({ property: id => PROPERTIES[id], forms: () => [], workOf: id => WORK[id], now: NOW, owner: false, canAct: true, ...over });
const journey = (stage, over = {}) => ({ propertyId: 'p1', clientId: null, workId: 'j-' + stage + (over.propertyId ?? 'p1'), stage, version: 2, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null,
  enquiry: { contactName: 'Alex Morgan', email: 'alex@example.com', phone: '07700900123' }, ownerAccount: false, ...over });
const root = (j, over = {}) => { WORK[j.workId] = { workId: j.workId, propertyId: j.propertyId, moduleId: 'property-onboarding', title: 'Onboarding', kind: 'onboarding', status: 'waiting', version: 5, assigneeId: null,
  createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-12T09:30:00Z', updatedBy: 'Morag Reid', updatedEvent: null, data: {}, ...over }; return j; };
const states = item => item.steps.map(s => s.state);
const RES = '11111111-1111-4111-8111-111111111111';
const enquiry = (status, over = {}) => ({ id: RES, status, recipientName: 'Sam Roy', recipientEmail: 'sam@example.com', subject: 's', body: 'b', delivery: 'email', emailStatus: 'sent', sentBy: RES, sentByName: 'Morag Reid',
  sentAt: '2026-10-10T10:00:00Z', openedAt: null, submittedAt: null, expiresAt: '2026-11-10T10:00:00Z', answers: null, files: [], propertyId: null, propertyName: null, stage: null, valuedByName: null, valuedAt: null, closedByName: null, closedAt: null, closeNote: '', version: 1, ...over });
const ANSWERS = { fullName: 'Sam Roy', correspondenceAddress: '1 High St', email: 'sam@example.com', phone: '07700900123', existingClient: 'no', propertyAddress: '9 Dalry Road\nEdinburgh EH11 2BG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1,
  shortLet: 'no', furnishQuote: 'no', compliance: 'yes', enquiryType: "I'd like a free performance estimate" };

// ---------- the constant ----------

test('ONBOARDING_STEPS is today\'s seven phases, each owning its stages exactly once', () => {
  assert.equal(ONBOARDING_STEPS.length, 7);
  assert.deepEqual(ONBOARDING_STEPS.map(s => s.label), [...ONBOARDING_PHASES]);
  assert.deepEqual(ONBOARDING_STEPS.map(s => s.label), ['Enquiry', 'Estimate', 'Agreement', 'Property setup', 'Invoice', 'Inspection', 'Live']);
  assert.equal(new Set(ONBOARDING_STEPS.map(s => s.key)).size, 7);
  const stages = ONBOARDING_STEPS.flatMap(s => s.stages);
  assert.equal(new Set(stages).size, stages.length);
  for (const stage of stages) assert.ok(ONBOARDING_STAGES[stage], stage);
  for (const s of ONBOARDING_STEPS) assert.ok(s.stages.length >= 1 && s.key && s.label);
});

// ---------- one property ----------

test('each stage reads its step, progress, next step and who must act', () => {
  const cases = [
    ['enquiry', 0, 'New enquiry', 'Send the estimate', 'Guest relations'],
    ['estimate', 1, 'Estimate', 'Owner decides on the estimate', 'Guest relations'],
    ['agreement', 2, 'Agreement', 'Agreement to sign', 'Guest relations'],
    ['form', 3, 'Property setup', 'Set-up form to complete', 'Guest relations'],
    ['invoice', 4, 'Invoice', 'Onboarding invoice', 'Accounts'],
    ['inspection_to_book', 5, 'Inspection', 'Book the inspection', 'Ready'],
    ['inspection_booked', 5, 'Inspection', 'Inspection booked, then record the findings', 'Ready'],
    ['inspection_complete', 6, 'Inspection', 'Record the live listing', 'Guest relations'],
  ];
  for (const [stage, done, status, next, waiting] of cases) {
    const item = onboardingTrackerItem(journey(stage), ctx());
    assert.deepEqual(item.progress, { done, total: 7 }, stage);
    assert.equal(item.status.label, status, stage);
    assert.equal(item.nextStep, next, stage);
    assert.deepEqual(item.nextAction, { label: 'Waiting for ' + waiting }, stage);
    assert.equal(item.closed, false, stage);
    assert.equal(item.section, 'onboarding');
    assert.equal(states(item).filter(s => s === 'current').length, 1, stage);
    assert.equal(states(item).filter(s => s === 'done').length, done, stage);
  }
});

test('a live property is closed at 100 percent and a declined one is closed with the bad tone', () => {
  const live = onboardingTrackerItem(journey('live'), ctx());
  assert.deepEqual(live.progress, { done: 7, total: 7 });
  assert.equal(percentOf(live.progress), 100);
  assert.deepEqual(live.status, { label: 'Live', tone: 'good' });
  assert.equal(live.closed, true);
  assert.equal(live.nextAction, null);
  assert.ok(states(live).every(s => s === 'done'));
  const declined = onboardingTrackerItem(journey('archived'), ctx());
  assert.deepEqual(declined.status, { label: 'Declined', tone: 'bad' });
  assert.equal(declined.closed, true);
  assert.ok(!states(declined).includes('current'));
});

test('progress percent runs from 0 to 100', () => {
  assert.equal(percentOf(null), 0);
  assert.equal(percentOf({ done: 0, total: 7 }), 0);
  assert.equal(percentOf({ done: 3, total: 7 }), 43);
  assert.equal(percentOf({ done: 7, total: 7 }), 100);
});

test('the next action is the form this person may use at that stage, and waits on the owner when one has an account', () => {
  const forms = [form('askQuestion', 'Add a question'), form('publishEstimate', 'Publish the estimate')];
  const j = root(journey('enquiry'));
  const item = onboardingTrackerItem(j, ctx({ forms: () => forms }));
  assert.deepEqual(item.nextAction, { label: 'Publish the estimate', actionKey: 'publishEstimate' });
  assert.equal(item.steps[0].actionKey, 'publishEstimate');
  // A form that belongs to another stage is not the next action.
  assert.deepEqual(onboardingTrackerItem(root(journey('estimate', { workId: 'w-e' })), ctx({ forms: () => forms })).nextAction, { label: 'Waiting for Guest relations' });
  const owned = onboardingTrackerItem(journey('agreement', { clientId: RES, ownerAccount: true }), ctx());
  assert.deepEqual(owned.nextAction, { label: 'Waiting for the owner' });
  assert.deepEqual(onboardingTrackerItem(journey('invoice', { clientId: RES, ownerAccount: true }), ctx()).nextAction, { label: 'Waiting for Accounts' });
});

test('the checklist ticks what the journey holds', () => {
  const j = journey('inspection_booked', { estimate: { mediumRateMinor: 12000 }, agreementRevision: 1, signedAt: '2026-10-05T10:00:00Z', signedName: 'Alex Morgan', form: { licensingRequired: true }, invoiceOutsideAt: '2026-10-07T10:00:00Z', invoiceOutsideNote: 'Xero INV-0123', inspectionOn: '2026-10-20' });
  const item = onboardingTrackerItem(j, ctx());
  const checks = key => item.steps.find(s => s.key === key).checks.map(c => c.done);
  assert.deepEqual(checks('estimate'), [true, true]);
  assert.deepEqual(checks('agreement'), [true, true]);
  assert.deepEqual(checks('setup'), [true]);
  assert.deepEqual(checks('invoice'), [true]);
  assert.deepEqual(checks('inspection'), [true, false]);
  assert.equal(item.steps[1].detail, 'Expected £120.00 a night');
  assert.match(item.steps[2].detail, /^Signed by Alex Morgan, /);
  assert.equal(item.steps[4].detail, 'Xero INV-0123');
  assert.ok(item.details.some(d => d.label === 'Licensing'));
  assert.ok(item.details.some(d => d.label === 'Inspection'));
});

test('the row carries the address, the stamp source and the contact', () => {
  const j = root(journey('estimate', { workId: 'w-stamp' }));
  const item = onboardingTrackerItem(j, ctx());
  assert.equal(item.address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(item.title, 'Onboarding, Alex Morgan');
  assert.deepEqual(item.lastUpdate, { at: '2026-10-12T09:30:00Z', by: 'Morag Reid', what: null });
  assert.equal(item.workId, 'w-stamp');
  assert.equal(onboardingTrackerItem(journey('estimate', { propertyId: 'p2' }), ctx()).address, 'Harbour cottage');
  assert.equal(onboardingTrackerItem(journey('estimate', { propertyId: 'nope' }), ctx()).address, 'Unknown property');
  assert.equal(onboardingTrackerItem(journey('estimate'), ctx()).lastUpdate, null);
});

// ---------- owners ----------

test('an owner never sees staff names, other contacts or enquiry forms', () => {
  const j = root(journey('estimate', { workId: 'w-own', clientId: RES, ownerAccount: true }));
  const rows = onboardingTrackerItems([j], [enquiry('received', { answers: ANSWERS })], ctx({ owner: true }));
  assert.equal(rows.length, 1);
  const text = JSON.stringify({ ...rows[0], source: null });
  assert.equal(rows[0].lastUpdate.by, null);
  assert.ok(!text.includes('Morag Reid'));
  assert.ok(!text.includes('Alex Morgan'));
  assert.ok(!text.includes('alex@example.com'));
  assert.equal(rows[0].title, 'Property onboarding');
  assert.ok(!rows[0].details.some(d => ['Contact', 'Phone', 'Email', 'Company'].includes(d.label)));
});

test('an enquiry row never exposes the sender to an owner', () => {
  const item = enquiryTrackerItem(enquiry('sent'), ctx({ owner: true }));
  assert.equal(item.lastUpdate, null);
});

// ---------- enquiries ----------

test('a client enquiry form is a row at the enquiry step', () => {
  const sent = enquiryTrackerItem(enquiry('sent'), ctx());
  assert.equal(sent.id, 'enquiry:' + RES);
  assert.equal(sent.section, 'onboarding');
  assert.deepEqual(sent.progress, { done: 0, total: 7 });
  assert.equal(sent.nextStep, 'Waiting for the landlord to open the form');
  assert.deepEqual(sent.nextAction, { label: 'Waiting for the landlord' });
  assert.deepEqual(sent.lastUpdate, { at: '2026-10-10T10:00:00Z', by: 'Morag Reid', what: 'Form sent' });
  assert.deepEqual(sent.steps[0].checks.map(c => c.done), [true, false, false]);
  const answered = enquiryTrackerItem(enquiry('received', { submittedAt: '2026-10-12T16:40:00Z', answers: ANSWERS }), ctx());
  assert.equal(answered.address, '9 Dalry Road, Edinburgh EH11 2BG');
  assert.equal(answered.title, 'Enquiry from Sam Roy');
  assert.equal(answered.nextStep, 'Value the property');
  assert.deepEqual(answered.nextAction, { label: 'Start valuing', actionKey: 'startValuing' });
  assert.deepEqual(answered.lastUpdate, { at: '2026-10-12T16:40:00Z', by: 'Sam Roy', what: 'Form answered' });
  assert.deepEqual(answered.steps[0].checks.map(c => c.done), [true, true, true]);
  assert.deepEqual(enquiryTrackerItem(enquiry('received', { answers: ANSWERS }), ctx({ canAct: false })).nextAction, { label: 'Waiting for Guest relations' });
});

test('enquiries come first, answered forms before waiting ones, then each stage in order', () => {
  const a = root(journey('inspection_booked', { propertyId: 'p1', workId: 'wa' }), { updatedAt: '2026-10-01T09:00:00Z' });
  const b = root(journey('agreement', { propertyId: 'p2', workId: 'wb' }));
  const c = root(journey('enquiry', { propertyId: 'p3', workId: 'wc' }));
  const done = root(journey('live', { propertyId: 'p1', workId: 'wd' }));
  const waiting = enquiry('sent', { id: '22222222-2222-4222-8222-222222222222' });
  const answered = enquiry('received', { id: '33333333-3333-4333-8333-333333333333', submittedAt: '2026-10-12T16:40:00Z', answers: ANSWERS });
  const rows = onboardingTrackerItems([done, a, b, c], [waiting, answered], ctx());
  assert.deepEqual(rows.map(r => r.id), ['enquiry:33333333-3333-4333-8333-333333333333', 'enquiry:22222222-2222-4222-8222-222222222222', 'wc', 'wb', 'wa', 'wd']);
  assert.deepEqual(rows.map(r => onboardingSection(r)), [NEW_ENQUIRIES, NEW_ENQUIRIES, NEW_ENQUIRIES, 'Agreement', 'Inspection', 'Live']);
});

test('valued, closed and unreadable enquiries are not drawn as new enquiries', () => {
  const rows = onboardingTrackerItems([], [
    enquiry('valuing', { id: '44444444-4444-4444-8444-444444444444', propertyId: RES, stage: 'estimate' }),
    enquiry('closed', { id: '55555555-5555-4555-8555-555555555555' }),
    enquiry('sent', { id: '66666666-6666-4666-8666-666666666666' }),
  ], ctx());
  assert.deepEqual(rows.map(r => r.id), ['enquiry:66666666-6666-4666-8666-666666666666']);
});

test('within a stage the longest without an update comes first', () => {
  const old = root(journey('agreement', { propertyId: 'p1', workId: 'old' }), { updatedAt: '2026-10-02T09:00:00Z' });
  const fresh = root(journey('agreement', { propertyId: 'p3', workId: 'fresh' }), { updatedAt: '2026-10-12T09:00:00Z' });
  assert.deepEqual(sortOnboarding([fresh, old].map(j => onboardingTrackerItem(j, ctx()))).map(i => i.id), ['old', 'fresh']);
});

// ---------- grouping ----------

test('groupBySection keeps the order headings first appear and the order of the rows', () => {
  const groups = groupBySection([{ n: 1, s: 'B' }, { n: 2, s: 'A' }, { n: 3, s: 'B' }, { n: 4, s: 'C' }], x => x.s);
  assert.deepEqual(groups.map(g => g.heading), ['B', 'A', 'C']);
  assert.deepEqual(groups.map(g => g.items.map(i => i.n)), [[1, 3], [2], [4]]);
  assert.deepEqual(groupBySection([], x => x), []);
  assert.deepEqual(groupBySection([1, 2]), [{ heading: '', items: [1, 2] }]);
});

test('a flagged row is marked and keeps its section', () => {
  const j = root(journey('agreement', { workId: '77777777-7777-4777-8777-777777777777' }));
  const flag = { id: RES, source: 'work', workId: j.workId, title: 't', reason: 'r', status: 'open', createdAt: '2026-10-12T10:00:00Z', version: 1 };
  const [item] = withFlags(onboardingTrackerItems([j], [], ctx()), [flag]);
  assert.equal(item.flagged, true);
  assert.equal(onboardingSection(item), 'Agreement');
});

// ---------- the screens ----------

const source = path => readFileSync(path, 'utf8');

test('Tracker.tsx gains sectionOf, percent and the Flagged tag without changing its other props', () => {
  const text = source('mobile/src/Tracker.tsx');
  assert.match(text, /sectionOf\?: \(item: TrackerItem\) => string/);
  assert.match(text, /groupBySection\(open, sectionOf\)/);
  assert.match(text, /label="Flagged"/);
  assert.match(text, /percent = false/);
  assert.match(text, /layout\?: "auto" \| "table" \| "cards"; groups\?: boolean; owner\?: boolean/);
});

test('the onboarding, licensing and purchase screens take SectionProps, draw a tracker, flag, and use the existing forms', () => {
  for (const [path, name] of [['mobile/src/OnboardingTracker.tsx', 'OnboardingTracker'], ['mobile/src/LicensingList.tsx', 'LicensingList'], ['mobile/src/PurchaseOrdersList.tsx', 'PurchaseOrdersList']]) {
    const text = source(path);
    assert.match(text, new RegExp(`export function ${name}\\(`), path);
    assert.match(text, /SectionProps/, path);
    assert.match(text, /TrackerList/, path);
    assert.match(text, /TrackerDetailSheet/, path);
    assert.match(text, /FlagButton/, path);
    assert.match(text, /withFlags/, path);
    assert.match(text, /readTeams\(\{ section: "flags" \}\)/, path);
    assert.match(text, /workItemForms/, path);
    assert.match(text, /onOpenWork/, path);
  }
  const onboarding = source('mobile/src/OnboardingTracker.tsx');
  assert.match(onboarding, /sectionOf=\{onboardingSection\}/);
  assert.match(onboarding, /clientEnquiries/);
  assert.match(onboarding, /newEnquiryForm/);
  assert.match(source('mobile/src/LicensingList.tsx'), /trackerItemsFor\(work, ctx, "licensing"\)/);
  assert.match(source('mobile/src/PurchaseOrdersList.tsx'), /trackerItemsFor\(work, ctx, "purchases"\)/);
});

test('none of the new files holds an em dash', () => {
  for (const path of ['lib/tracker-onboarding.ts', 'mobile/src/OnboardingTracker.tsx', 'mobile/src/LicensingList.tsx', 'mobile/src/PurchaseOrdersList.tsx', 'mobile/src/Tracker.tsx', 'tests/tracker-onboarding.test.mjs'])
    assert.ok(!source(path).includes(String.fromCharCode(0x2014)), path);
});

// The owner's onboarding ticket shows the same progress as the property's tracker row, at every stage.
test('journeyProgress counts exactly as the tracker row does', () => {
  for (const stage of Object.keys(ONBOARDING_STAGES)) assert.deepEqual(journeyProgress(stage), onboardingTrackerItem(journey(stage), ctx()).progress, stage);
  assert.equal(percentOf(journeyProgress('live')), 100);
  assert.equal(percentOf(journeyProgress('enquiry')), 0);
  // A lead with no property yet is at the start, as its enquiry row is.
  assert.deepEqual(journeyProgress('enquiry'), enquiryTrackerItem(enquiry('received', { submittedAt: '2026-10-11T10:00:00Z', answers: ANSWERS }), ctx()).progress);
  // An unknown stage reads as a new enquiry rather than failing.
  assert.deepEqual(journeyProgress('something-new'), journeyProgress('enquiry'));
});
