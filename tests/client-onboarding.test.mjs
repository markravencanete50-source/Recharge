import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Alex's onboarding framework (migration 20261025200000): the owner's checklist, the property facts with TBC, the links
// into the app, the decline reason, the open enquiry form and the onboarding videos.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const co = await vite.ssrLoadModule('/lib/client-onboarding.ts');
const { journeyForms, workflowIssues, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const { journeyActionSchema, declineReasonMissing, DECLINE_REASON_MESSAGE } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { estimateDecisionSchema } = await vite.ssrLoadModule('/lib/estimate-link.ts');
const { formAnswersSchema, enquiryAnswersSchema, HEARD_FROM } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { videoEmbed, isOnboardingVideoLink } = await vite.ssrLoadModule('/lib/video-embed.ts');
const { DEFAULT_OCCUPANCY_BPS } = await vite.ssrLoadModule('/lib/estimate-projection.ts');
after(() => vite.close());

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const estimate = { lowRateMinor: 10000, mediumRateMinor: 12000, highRateMinor: 15000, comparables: [] };
const journey = (stage, extra = {}) => ({ propertyId: id(10), clientId: id(2), workId: id(90), stage, version: 3, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ownerAccount: true, ...extra });
const owner = { userId: id(2), role: 'client', status: 'active', fullName: 'Owner', email: 'o@example.com', modules: ['property-onboarding'] };
const none = { welcome: null, process: null };

test('the checklist: Welcome and Process tick with Next; the estimate is amber, then green, amber dot or red', () => {
  const marks = (j, seen = none) => co.ownerChecklist(j, seen).map(s => s.mark);
  assert.deepEqual(marks(journey('enquiry')), ['todo', 'todo', 'waiting']);
  assert.deepEqual(marks(journey('estimate', { estimate }), { welcome: '2026-10-20T10:00:00Z', process: null }), ['done', 'todo', 'arrived']);
  assert.deepEqual(marks(journey('reviewing', { estimate })), ['todo', 'todo', 'reviewing']);
  assert.deepEqual(marks(journey('agreement', { estimate })), ['todo', 'todo', 'done']);
  assert.deepEqual(marks(journey('archived', { estimate })), ['todo', 'todo', 'declined']);
  assert.equal(co.estimateMark(journey('estimate', { estimate: { comments: 'not a full estimate' } })), 'waiting');
  // The first step not yet read opens; then the estimate once it is there.
  assert.equal(co.firstOpenStep(co.ownerChecklist(journey('estimate', { estimate }), none)), 'welcome');
  assert.equal(co.firstOpenStep(co.ownerChecklist(journey('estimate', { estimate }), { welcome: 'x', process: 'x' })), 'estimate');
  assert.equal(co.firstOpenStep(co.ownerChecklist(journey('agreement', { estimate }), { welcome: 'x', process: 'x' })), null);
  for (const step of co.ownerChecklist(journey('estimate', { estimate }), none)) assert.ok(!/\u2014/.test(step.note + step.title));
});

test('property facts say TBC for anything not yet collected', () => {
  const empty = co.propertyFacts({ answers: null, files: 0, property: {}, journey: {} });
  for (const row of [...empty.about, ...empty.property, ...empty.setup]) assert.equal(row.value, null, row.label);
  const filled = co.propertyFacts({
    answers: { fullName: 'Ann Owner', email: 'ann@example.com', heardFrom: 'Referral from a friend or client', referral: 'Jo Smith', enquiryType: 'I have a property ready to let', bedrooms: 2 },
    files: 3, property: { address: '1 Example Street' }, journey: { propertyType: 'Flat', ownerRepairLimit: { limitMinor: 25000 } },
  });
  const value = (rows, label) => rows.find(r => r.label === label)?.value;
  assert.equal(value(filled.about, 'Your name'), 'Ann Owner');
  assert.equal(value(filled.about, 'How you heard about us'), 'Referral from a friend or client, referred by Jo Smith');
  assert.equal(value(filled.about, 'Phone'), null);
  assert.equal(value(filled.property, 'Address'), '1 Example Street');
  assert.equal(value(filled.property, 'Bedrooms'), '2');
  assert.equal(value(filled.property, 'Photos and videos'), '3 files added');
  assert.match(value(filled.setup, 'Repairs we can approve without asking you'), /250/);
  assert.equal(co.TBC, 'TBC');
});

test('links into the app carry the email; the app reads them back', () => {
  assert.equal(co.appSignUpLink('https://app.example.com', ' Ann@Example.com '), 'https://app.example.com/workspace?signup=1&email=ann%40example.com');
  assert.equal(co.appEstimateLink('', 'ann@example.com'), '/workspace?from=estimate&email=ann%40example.com');
  assert.deepEqual(co.appEntry('?signup=1&email=ann%40example.com'), { signup: true, email: 'ann@example.com', from: null });
  assert.deepEqual(co.appEntry('?from=estimate&email=ann%40example.com'), { signup: false, email: 'ann@example.com', from: 'estimate' });
  assert.deepEqual(co.appEntry('?email=not-an-email&from=elsewhere'), { signup: false, email: '', from: null });
  assert.equal(co.ENQUIRY_THANKS, 'Thanks, we have your details. A member of the team will be in touch with your estimate by email, usually within 48 hours.');
  assert.equal(co.ENQUIRY_ACCOUNT_PROMPT, 'Create your account to track your estimate in real time');
});

test('not proceeding needs a reason, in the policy, the app form and the estimate page', () => {
  assert.equal(declineReasonMissing({ decision: 'decline', feedback: '' }), true);
  assert.equal(declineReasonMissing({ decision: 'decline', feedback: ' ok ' }), true, 'at least three characters');
  assert.equal(declineReasonMissing({ decision: 'decline', feedback: 'Selling instead' }), false);
  assert.equal(declineReasonMissing({ decision: 'proceed', feedback: '' }), false);
  assert.equal(estimateDecisionSchema.safeParse({ decision: 'decline', feedback: '' }).success, false);
  const form = journeyForms(owner, journey('estimate', { estimate })).find(f => f.key === 'decideEstimate');
  const raw = { decision: 'decline', feedback: '', followUpOn: '', repairLimitMinor: '10000', repairLimitOther: '' };
  assert.deepEqual(workflowIssues(form, raw).map(i => i.field), ['feedback']);
  assert.equal(workflowIssues(form, raw)[0].message, DECLINE_REASON_MESSAGE);
  assert.deepEqual(workflowIssues(form, { ...raw, feedback: 'Selling instead' }), []);
});

test('the estimate step offers Proceed, Still reviewing and Not proceeding, each its own form', () => {
  const decide = journeyForms(owner, journey('estimate', { estimate })).find(f => f.key === 'decideEstimate');
  const forms = co.decisionForms(decide);
  assert.equal(co.decisionForms(undefined), null);
  assert.deepEqual(Object.keys(forms), ['proceed', 'review', 'decline']);
  assert.deepEqual(forms.proceed.fields.map(f => f.name), ['repairLimitMinor', 'repairLimitOther', 'feedback']);
  assert.deepEqual(forms.review.fields.map(f => f.name), ['followUpOn', 'feedback']);
  assert.equal(forms.review.fields[0].required, true);
  assert.deepEqual(forms.decline.fields.map(f => [f.name, f.required]), [['feedback', true]]);
  const build = (form, raw) => form.build(workflowValues(form.fields, raw), id(9));
  const proceed = build(forms.proceed, { repairLimitMinor: '25000', repairLimitOther: '', feedback: '' });
  assert.equal(proceed.decision, 'proceed'); assert.equal(proceed.repairLimitMinor, 25000);
  assert.ok(journeyActionSchema.safeParse({ requestId: id(1), ...proceed }).success);
  const review = build(forms.review, { followUpOn: '2026-11-01', feedback: '' });
  assert.equal(review.decision, 'review'); assert.equal(review.followUpOn, '2026-11-01');
  assert.ok(journeyActionSchema.safeParse({ requestId: id(1), ...review }).success);
  assert.deepEqual(workflowIssues(forms.decline, { feedback: '' }).map(i => i.field), ['feedback']);
  const decline = build(forms.decline, { feedback: 'Selling instead' });
  assert.equal(decline.decision, 'decline'); assert.equal(decline.feedback, 'Selling instead');
  assert.ok(journeyActionSchema.safeParse({ requestId: id(1), ...decline }).success);
});

test('the open form asks how they heard about us; the referral is optional', () => {
  assert.deepEqual([...HEARD_FROM], ['Google', 'Social media', 'Airbnb or Booking.com', 'Referral from a friend or client', 'Other']);
  const base = { fullName: 'Ann Owner', email: 'ann@example.com', propertyAddress: '1 Example Street', propertyType: 'Flat', enquiryType: 'I have a property ready to let', bedrooms: 2, wcs: 1, bathrooms: 1 };
  const missing = formAnswersSchema.safeParse(base);
  assert.equal(missing.success, false);
  assert.equal(missing.error.issues[0].path[0], 'heardFrom');
  assert.ok(formAnswersSchema.safeParse({ ...base, heardFrom: 'Google' }).success);
  assert.ok(formAnswersSchema.safeParse({ ...base, heardFrom: 'Referral from a friend or client', referral: 'Jo Smith' }).success);
  assert.equal(formAnswersSchema.safeParse({ ...base, heardFrom: 'A billboard' }).success, false);
  assert.ok(enquiryAnswersSchema.safeParse(base).success, 'answers stored before the question still read');
});

test('onboarding videos: YouTube, Vimeo or Loom only; Loom plays in the app', () => {
  assert.deepEqual(videoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef'), { kind: 'frame', src: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef' });
  for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456789', 'https://www.loom.com/share/0123456789abcdef0123456789abcdef']) assert.ok(isOnboardingVideoLink(url), url);
  for (const url of ['https://cdn.example.com/a.mp4', 'http://youtu.be/dQw4w9WgXcQ', 'https://example.com/']) assert.equal(isOnboardingVideoLink(url), false, url);
  const ok = co.clientOnboardingActionSchema.safeParse({ action: 'setVideo', requestId: id(1), step: 'welcome', url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.ok(ok.success);
  assert.ok(co.clientOnboardingActionSchema.safeParse({ action: 'setVideo', requestId: id(1), step: 'estimate', url: '' }).success, 'empty clears it');
  assert.equal(co.clientOnboardingActionSchema.safeParse({ action: 'setVideo', requestId: id(1), step: 'welcome', url: 'https://cdn.example.com/a.mp4' }).error.issues[0].message, co.VIDEO_LINK_MESSAGE);
  assert.equal(co.clientOnboardingActionSchema.safeParse({ action: 'markSeen', requestId: id(1), propertyId: id(2), step: 'estimate' }).success, false, 'only Welcome and Process are ticked by Next');
});

test('the estimate starts at 75% occupancy', () => {
  assert.equal(DEFAULT_OCCUPANCY_BPS, 7500);
});

test('the owner ticket and the video settings are wired in, with no em dashes or gradients', () => {
  const ticket = readFileSync('mobile/src/OwnerOnboarding.tsx', 'utf8');
  const pages = readFileSync('mobile/src/LivePages.tsx', 'utf8');
  const settings = readFileSync('mobile/src/OnboardingSettings.tsx', 'utf8');
  assert.match(pages, /<OwnerOnboarding /);
  assert.match(pages, /account\.role === "client" && selected\.status !== "active"/);
  assert.match(settings, /account\.role === "super_admin" && <OnboardingVideos/);
  assert.match(ticket, /action: "markSeen"/);
  for (const text of [ticket, settings, readFileSync('lib/client-onboarding.ts', 'utf8'), readFileSync('lib/onboarding-content.ts', 'utf8')]) {
    assert.ok(!text.includes('\u2014'), 'no em dashes');
    assert.ok(!/gradient/i.test(text));
  }
});
