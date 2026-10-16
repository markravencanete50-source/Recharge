import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// The owner's enquiry sheet and the estimate form (Lee, 16 October): each problem is shown by its field with a summary by the
// button; "Invalid estimate" (rates out of order) is named; the owner adds photos and videos and sees a confirmation; their
// properties read Enquiry sent, Estimate ready, Agreement, Going live, Live; an onboarding update opens the property.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { newEnquiryForm, journeyForms, workflowIssues, issuesSummary, workflowValues, fieldName, comparableIssues, OWNER_ENQUIRY_DONE } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const { estimateRateIssues, journeyActionSchema, journeyValidationField, RATE_ORDER_MESSAGES } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { ownerPropertyStatus, propertyProgress } = await vite.ssrLoadModule('/lib/owner-approvals.ts');
const { noticeRow } = await vite.ssrLoadModule('/lib/notice-details.ts');
const { enquiryFilesProblem, valuationDraft, storedEnquiryAnswersSchema } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
after(() => vite.close());

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { userId: id(1), role: 'admin', status: 'active', fullName: 'Admin', email: 'a@example.com', modules: [] };
const journey = (stage, extra = {}) => ({ propertyId: id(10), clientId: id(2), workId: id(90), stage, version: 3, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ownerAccount: true, ...extra });
const estimateForm = () => journeyForms(admin, journey('enquiry')).find(f => f.key === 'publishEstimate');
const ESTIMATE = { lowRateMinor: '120', mediumRateMinor: '100', highRateMinor: '150', ownCost0: '100', ownCost1: '100', ownCost2: '100', ownCost3: '150', ownCost4: '250' };

test("Lee's estimate: the expected rate below the low rate is named by its field, not 'Invalid estimate'", () => {
  const form = estimateForm();
  const issues = workflowIssues(form, ESTIMATE);
  assert.deepEqual(issues, [{ field: 'mediumRateMinor', message: RATE_ORDER_MESSAGES.mediumRateMinor }]);
  assert.equal(issuesSummary(issues), 'Check 1 field: The expected nightly rate must be at least the low nightly rate.');
  assert.deepEqual(workflowIssues(form, { ...ESTIMATE, mediumRateMinor: '130', highRateMinor: '125' }), [{ field: 'highRateMinor', message: RATE_ORDER_MESSAGES.highRateMinor }]);
  assert.deepEqual(workflowIssues(form, { ...ESTIMATE, mediumRateMinor: '120' }), [], 'equal rates are fine');
  // The server says the same, with the field, before the database is asked.
  assert.deepEqual(estimateRateIssues({ lowRateMinor: 12000, mediumRateMinor: 10000, highRateMinor: 15000 }).map(i => i.field), ['mediumRateMinor']);
  assert.deepEqual(estimateRateIssues({ lowRateMinor: 12000 }), [], 'a missing rate is a different message');
});

test('each field with a problem is listed, in plain words, with a count', () => {
  const form = estimateForm();
  const issues = workflowIssues(form, { ...ESTIMATE, lowRateMinor: '', mediumRateMinor: '12.299', occupancyBps: '120', ownCost3: 'lots' });
  assert.deepEqual(issues.map(i => i.field), ['lowRateMinor', 'mediumRateMinor', 'occupancyBps', 'ownCost3']);
  assert.equal(issues[0].message, 'Enter low nightly rate');
  assert.equal(issues[1].message, 'Expected nightly rate must be an amount in pounds, like 150 or 150.50');
  assert.equal(issues[2].message, 'Expected occupancy must be 100% or less');
  assert.match(issues[3].message, /must be an amount in pounds/);
  assert.match(issuesSummary(issues), /^Check 4 fields: Enter low nightly rate\. Expected nightly rate must be/);
  assert.equal(issuesSummary([]), '');
});

test('a comparable that is half filled in is named by the field that is missing', () => {
  const form = estimateForm();
  assert.deepEqual(workflowIssues(form, { ...ESTIMATE, mediumRateMinor: '130', name0: 'Flat on Leith Walk' }).map(i => i.field), ['url0', 'adrMinor0']);
  assert.deepEqual(comparableIssues({ name1: 'Two', url1: 'http://example.com', adrMinor1: 9000 }), [{ field: 'url1', message: 'Comparable 2 link: The link must start with https://' }]);
  assert.deepEqual(comparableIssues({ name0: 'https://example.com' }).map(i => i.field), ['name0']);
  assert.deepEqual(comparableIssues({}), []);
  assert.equal(fieldName({ label: 'Nightly rate, GBP', group: 'Comparable 3' }), 'Comparable 3 nightly rate');
  assert.equal(fieldName({ label: 'Council tax, per month, GBP' }), 'Council tax');
});

test('amounts may have a pound sign and thousands commas; three decimal places still do not read', () => {
  const form = estimateForm();
  const v = workflowValues(form.fields, { ...ESTIMATE, mediumRateMinor: '£130', highRateMinor: '1,250.50' });
  assert.equal(v.mediumRateMinor, 13000); assert.equal(v.highRateMinor, 125050);
  assert.throws(() => workflowValues(form.fields, { ...ESTIMATE, mediumRateMinor: '12.299' }), /valid amount/);
  assert.throws(() => workflowValues(form.fields, { ...ESTIMATE, mediumRateMinor: '12,99' }), /valid amount/);
});

test('a refusal from the server names its field', () => {
  const bad = journeyActionSchema.safeParse({ action: 'publishEstimate', requestId: id(1), propertyId: id(2), version: 1, lowRateMinor: 50, mediumRateMinor: 9000, highRateMinor: 9000, comparables: [] });
  assert.equal(journeyValidationField(bad.error), 'lowRateMinor');
  const link = journeyActionSchema.safeParse({ action: 'publishEstimate', requestId: id(1), propertyId: id(2), version: 1, lowRateMinor: 9000, mediumRateMinor: 9000, highRateMinor: 9000, comparables: [{ name: 'A', url: 'nope', adrMinor: 1 }] });
  assert.equal(journeyValidationField(link.error), 'url0');
});

test("the owner's sheet: photos and videos, when to start, the link for big videos, and a confirmation", () => {
  const form = newEnquiryForm(false), team = newEnquiryForm(true);
  const names = form.fields.map(f => f.name);
  assert.ok(names.includes('uploads') && names.includes('startWhen') && names.includes('photoLink'));
  assert.ok(!team.fields.some(f => f.name === 'uploads' || f.name === 'startWhen'), 'the team form is unchanged');
  assert.equal(team.done, undefined);
  assert.deepEqual(form.done, OWNER_ENQUIRY_DONE);
  assert.ok(!/email/i.test(OWNER_ENQUIRY_DONE.title + OWNER_ENQUIRY_DONE.message), 'no email is promised: none is sent');
  assert.match(form.fields.find(f => f.name === 'photoLink').help, /long video/);
  const raw = { address: '1 Shore Road, Leith, Edinburgh EH6 6RG', name: 'Shore Road', region: '', propertyType: 'Flat', bedrooms: '2', wcs: '', bathrooms: '1', parking: '', garden: '', photoLink: '', notes: '', startWhen: '' };
  const body = form.build(workflowValues(form.fields, raw), id(1));
  assert.ok(!('startWhen' in body) && !('uploads' in body), 'an empty choice and the files are not sent');
  assert.ok(journeyActionSchema.safeParse({ requestId: id(1), ...body }).success);
  const chosen = form.build(workflowValues(form.fields, { ...raw, startWhen: 'As soon as possible' }), id(1));
  assert.equal(chosen.startWhen, 'As soon as possible');
  assert.deepEqual(workflowIssues(form, { ...raw, address: '', bedrooms: 'two' }).map(i => [i.field, i.message]), [['address', 'Enter full property address'], ['bedrooms', 'Bedrooms must be a whole number, like 2']]);
});

test("the file limits are the public form's", () => {
  const f = (n, extra = {}) => ({ name: `p${n}.jpg`, mime: 'image/jpeg', bytes: 1000, ...extra });
  assert.equal(enquiryFilesProblem([f(1), f(2, { mime: 'video/quicktime', name: 'v.mov' })]), null);
  assert.match(enquiryFilesProblem(Array.from({ length: 16 }, (_, i) => f(i))), /Up to 15/);
  assert.match(enquiryFilesProblem([f(1, { mime: 'application/pdf', name: 'a.pdf' })]), /a\.pdf is not a photo or video/);
  assert.match(enquiryFilesProblem([f(1, { bytes: 26 * 1024 * 1024 })]), /over 25 MB/);
  assert.match(enquiryFilesProblem(Array.from({ length: 11 }, (_, i) => f(i, { bytes: 24 * 1024 * 1024 }))), /more than we can take/);
});

test("an owner's properties read in their words, and the estimate opens from the card", () => {
  const s = (stage, extra) => ownerPropertyStatus(journey(stage, extra), 'onboarding');
  assert.deepEqual([s('enquiry').label, s('estimate').label, s('reviewing').label, s('agreement').label, s('form').label, s('inspection_booked').label, s('live').label], ['Enquiry sent', 'Estimate ready', 'Estimate ready', 'Agreement', 'Going live', 'Going live', 'Live']);
  assert.match(s('enquiry').detail, /We are valuing it/);
  assert.equal(s('estimate').openEstimate, true); assert.equal(s('enquiry').openEstimate, false); assert.equal(s('agreement').openEstimate, false);
  assert.equal(s('agreement', { agreementRevision: 1 }).detail, 'Read and sign your management agreement.');
  assert.equal(ownerPropertyStatus(null, 'active').label, 'Live');
  const progress = propertyProgress([{ id: id(10), name: 'Shore Road', status: 'onboarding' }], [journey('estimate')], []);
  assert.equal(progress[0].phase, 'Estimate ready', 'Home says the same as the card');
});

test('an onboarding update opens the property, not a work item that cannot be opened', () => {
  const base = { id: 1, created_at: '2026-10-16T10:00:00Z', read_at: null, property_id: id(10), work_id: id(90), work_title: 'Property onboarding', work_kind: null, work_module: 'property-onboarding', property_name: 'Shore Road' };
  const published = noticeRow({ ...base, event_type: 'journey.publishEstimate' });
  assert.deepEqual(published.target, { kind: 'property', propertyId: id(10) });
  assert.equal(published.title, 'Onboarding: Your estimate is ready');
  // Lee's case: a super admin's "Onboarding: Property onboarding" update.
  assert.deepEqual(noticeRow({ ...base, event_type: 'operations.updateOperation' }).target, { kind: 'property', propertyId: id(10) });
  // A real task still opens as a task.
  assert.deepEqual(noticeRow({ ...base, event_type: 'operations.updateOperation', work_kind: 'inspection', work_title: 'Inspection' }).target, { kind: 'work', workId: id(90) });
});

test("an owner's enquiry reads in Client enquiries and values like a form answer", () => {
  const answers = storedEnquiryAnswersSchema.parse({ fullName: 'Jamie Owner', email: 'jamie@example.com', propertyAddress: '3F2, 17 Warrender Park Road, Edinburgh EH9 1EF', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, startWhen: 'Within a month' });
  const draft = valuationDraft(answers);
  assert.equal(draft.name, '17 Warrender Park Road (3F2)');
  assert.equal(draft.enquiry.notes, 'Start: Within a month');
  assert.equal(draft.enquiry.phone, undefined, 'no phone on an owner enquiry, and none is made up');
  assert.ok(!draft.enquiry.notes.includes('Short-term let'), 'no services line when they were not asked');
});

test('the sheet shows each problem by its field and keeps the protected layout', async () => {
  const src = await fs.readFile('mobile/src/LivePages.tsx', 'utf8');
  assert.match(src, /workflowIssues\(spec, values/);
  assert.match(src, /<FieldProblem p=\{p\} error=\{error\} \/>/);
  assert.match(src, /nativeID=\{markerId\(f\.name\)\}/);
  assert.match(src, /setDone\(true\)/);
  assert.match(src, /onOpenProperty\(t\.propertyId\)/);
  assert.match(src, /owner=\{account\.role === "client" \? ownerPropertyStatus/);
  const uploads = await fs.readFile('mobile/src/EnquiryUploads.tsx', 'utf8');
  assert.match(uploads, /uploadEnquiryFile\(propertyId, f\)/);
  const client = await fs.readFile('mobile/src/backend/client.ts', 'utf8');
  assert.match(client, /\/api\/mobile\/enquiry-files\?/);
});

test('item 7: Proceed asks for the repair limit, £100 chosen, on the sheet and on the estimate page', async () => {
  const { repairLimitFrom, REPAIR_LIMIT_CHOICES, repairLimitText } = await vite.ssrLoadModule('/lib/journey-policy.ts');
  const { estimateDecisionSchema } = await vite.ssrLoadModule('/lib/estimate-link.ts');
  const { whenMet } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
  const owner = { userId: id(2), role: 'client', status: 'active', fullName: 'Owner', email: 'o@example.com', modules: ['property-onboarding'] };
  const form = journeyForms(owner, journey('estimate')).find(f => f.key === 'decideEstimate');
  const limit = form.fields.find(f => f.name === 'repairLimitMinor'), other = form.fields.find(f => f.name === 'repairLimitOther');
  assert.equal(limit.label, 'Repairs we can approve without asking you');
  assert.equal(limit.help, 'Up to this amount per repair, we go ahead and tell you after. Above it, we ask you first.');
  assert.deepEqual(limit.options.map(o => o.label), ['Always ask me (£0)', 'Up to £100', 'Up to £250', 'Up to £500', 'Another amount']);
  assert.equal(limit.defaultValue, '10000');
  // Only with Proceed; the amount box only with Another amount.
  assert.equal(whenMet(limit, { decision: 'review' }), false); assert.equal(whenMet(limit, { decision: 'proceed' }), true);
  assert.equal(whenMet(other, { decision: 'proceed', repairLimitMinor: '10000' }), false); assert.equal(whenMet(other, { decision: 'proceed', repairLimitMinor: 'other' }), true);
  const raw = { decision: 'proceed', feedback: '', followUpOn: '', repairLimitMinor: '10000', repairLimitOther: '' };
  const build = r => form.build(workflowValues(form.fields, r), id(9));
  assert.equal(build(raw).repairLimitMinor, 10000, 'the default');
  assert.equal(build({ ...raw, repairLimitMinor: '0' }).repairLimitMinor, 0);
  assert.equal(build({ ...raw, repairLimitMinor: 'other', repairLimitOther: '£1,250' }).repairLimitMinor, 125000);
  assert.ok(!('repairLimitMinor' in build({ ...raw, decision: 'decline' })), 'only with Proceed');
  assert.ok(!('repairLimitOther' in build(raw)));
  assert.ok(journeyActionSchema.safeParse({ requestId: id(1), ...build(raw) }).success);
  // Problems by their field.
  assert.deepEqual(workflowIssues(form, { ...raw, repairLimitMinor: 'other', repairLimitOther: '12.50' }), [{ field: 'repairLimitOther', message: 'Enter the amount in whole pounds, like 300' }]);
  assert.deepEqual(workflowIssues(form, { ...raw, repairLimitMinor: 'other', repairLimitOther: '200000' }), [{ field: 'repairLimitOther', message: 'Choose the repair limit in whole pounds, from 0 to 100,000' }]);
  assert.deepEqual(workflowIssues(form, { ...raw, decision: 'review' }), [{ field: 'followUpOn', message: 'Choose a follow-up date' }]);
  assert.deepEqual(repairLimitFrom('other', ''), { field: 'repairLimitOther', error: 'Enter the amount, in whole pounds' });
  assert.equal(REPAIR_LIMIT_CHOICES.length, 5);
  assert.deepEqual([repairLimitText(0), repairLimitText(25000), repairLimitText(125000)], ['Always ask (£0)', 'Up to £250', 'Up to £1,250']);
  // The private estimate page: the same choices, sent with Proceed.
  const token = 'a'.repeat(64);
  const ok = estimateDecisionSchema.safeParse({ token, decision: 'proceed', feedback: '', repairLimitMinor: 25000 });
  assert.ok(ok.success); assert.equal(ok.data.repairLimitMinor, 25000);
  const bad = estimateDecisionSchema.safeParse({ token, decision: 'proceed', feedback: '', repairLimitMinor: 25050 });
  assert.ok(bad.error.issues.some(i => i.path.at(-1) === 'repairLimitMinor' && i.message === 'Choose the repair limit in whole pounds, from 0 to 100,000'));
  const page = await fs.readFile('app/estimate/estimate-view.tsx', 'utf8');
  assert.match(page, /decision === "proceed" && <fieldset[^>]*data-invalid=\{field === "repairLimitMinor"/);
  assert.match(page, /REPAIR_LIMIT_CHOICES\.map/);
  assert.match(page, /repairLimitFrom\(repairChoice, repairOther\)/);
  const server = await fs.readFile('lib/estimate-link-server.ts', 'utf8');
  assert.match(server, /answer\.decision === 'proceed' && answer\.repairLimitMinor !== undefined \? \{ repairLimitMinor: answer\.repairLimitMinor \}/);
});
