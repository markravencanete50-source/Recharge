import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The app side of "every new enquiry in Properties straight away" (migration 20261015200000): the enquiry's
// new fields, its step once its property exists, the button wording and duplicate badge, one onboarding row
// per property, and the Properties table's stage.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { clientEnquirySchema, enquiryStep, valueButtonLabel, duplicateNote, DUPLICATE_LABEL } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { onboardingTrackerItems, withEnquiry, onboardingSection, NEW_ENQUIRIES } = await vite.ssrLoadModule('/lib/tracker-onboarding.ts');
const { stageLabel, buildPropertyRows } = await vite.ssrLoadModule('/lib/property-table.ts');

const NOW = new Date('2026-10-15T12:00:00Z');
const ID = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const ANSWERS = { fullName: 'Sam Roy', correspondenceAddress: '1 High St', email: 'sam@example.com', phone: '07700 900123', existingClient: 'no', propertyAddress: '9 Dalry Road\nEdinburgh EH11 2BG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1,
  shortLet: 'no', furnishQuote: 'no', compliance: 'yes', enquiryType: "I'd like a free performance estimate" };
const raw = (over = {}) => ({ id: ID(1), status: 'received', recipientName: 'Sam Roy', recipientEmail: 'sam@example.com', subject: 's', body: 'b', delivery: 'link', emailStatus: 'manual', sentBy: ID(9), sentByName: 'Morag Reid',
  sentAt: '2026-10-10T10:00:00Z', openedAt: '2026-10-11T10:00:00Z', submittedAt: '2026-10-12T10:00:00Z', expiresAt: '2026-11-10T10:00:00Z', answers: ANSWERS, files: [],
  propertyId: ID(5), propertyName: '9 Dalry Road', stage: 'enquiry', valuedByName: null, valuedAt: null, closedByName: null, closedAt: null, closeNote: '', version: 2, ...over });
const journey = (stage, propertyId = ID(5)) => ({ propertyId, clientId: null, workId: 'w-' + propertyId, stage, version: 1, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, enquiry: { wcs: 1 }, ownerAccount: false });
const ctx = (over = {}) => ({ property: id => ({ id, name: '9 Dalry Road', address: '9 Dalry Road, Edinburgh EH11 2BG' }), forms: () => [], now: NOW, owner: false, canAct: true, ...over });

test('the enquiry read carries the duplicate flag, and an older answer without it still parses', () => {
  const flagged = clientEnquirySchema.parse(raw({ duplicateOf: ID(7), duplicateOfName: 'Dalry flat', duplicateReason: 'same_address' }));
  assert.deepEqual([flagged.duplicateOf, flagged.duplicateOfName, flagged.duplicateReason], [ID(7), 'Dalry flat', 'same_address']);
  const plain = clientEnquirySchema.parse(raw());
  assert.deepEqual([plain.duplicateOf, plain.duplicateOfName, plain.duplicateReason], [null, null, null]);
  assert.throws(() => clientEnquirySchema.parse(raw({ duplicateReason: 'merged' })));
});

test('an answered enquiry with its property is ready to value, and follows the property once it moves on', () => {
  assert.equal(enquiryStep(raw(), NOW.getTime()), 'received');
  assert.equal(enquiryStep(raw({ stage: 'estimate' }), NOW.getTime()), 'estimate', 'an estimate sent from the property');
  assert.equal(enquiryStep(raw({ stage: 'archived' }), NOW.getTime()), 'declined');
  assert.equal(enquiryStep(raw({ status: 'closed', stage: 'archived' }), NOW.getTime()), 'closed');
  assert.equal(enquiryStep(raw({ propertyId: null, propertyName: null, stage: null }), NOW.getTime()), 'received', 'answered before properties were made on submit');
});

test('the button says what happens: check and value an existing property, or start valuing', () => {
  assert.equal(valueButtonLabel(raw()), 'Check the details and value');
  assert.equal(valueButtonLabel(raw({ propertyId: null })), 'Start valuing');
  assert.match(duplicateNote({ duplicateReason: 'same_address', duplicateOfName: 'Dalry flat' }), /Same address as Dalry flat/);
  assert.match(duplicateNote({ duplicateReason: 'same_address', duplicateOfName: null }), /another property/);
  assert.match(duplicateNote({ duplicateReason: 'existing_client', duplicateOfName: null }), /already work with us/);
  assert.equal(duplicateNote({ duplicateReason: null, duplicateOfName: null }), '');
  const screen = readFileSync('mobile/src/LiveEnquiries.tsx', 'utf8');
  assert.match(screen, /label=\{valueButtonLabel\(e\)\}/);
  assert.match(screen, /<Tag label=\{DUPLICATE_LABEL\} tone="bad"/);
  assert.match(screen, /Its property in Properties is archived too/);
});

test('one onboarding row per property: the journey, carrying the enquiry\'s flag for staff only', () => {
  const e = clientEnquirySchema.parse(raw({ duplicateOf: ID(7), duplicateOfName: 'Dalry flat', duplicateReason: 'same_address' }));
  const rows = onboardingTrackerItems([journey('enquiry')], [e], ctx());
  assert.equal(rows.length, 1, 'no second row for the enquiry');
  const [row] = rows;
  assert.equal(row.propertyId, ID(5));
  assert.equal(onboardingSection(row), NEW_ENQUIRIES);
  assert.deepEqual(row.details.find(d => d.label === DUPLICATE_LABEL), { label: DUPLICATE_LABEL, value: duplicateNote(e), tone: 'bad' });
  assert.match(row.details.find(d => d.label === 'From').value, /^The enquiry form, answered/);
  assert.match(row.search, /Possible duplicate/);
  for (const secret of ['sam@example.com', '07700', 'Sam Roy']) assert.ok(!JSON.stringify(row.details).includes(secret), secret + ' stays on the enquiry');
  // Owners never get the enquiry's details; a closed enquiry adds nothing.
  assert.equal(withEnquiry(row, e, { owner: true, now: NOW }), row);
  const closed = clientEnquirySchema.parse(raw({ status: 'closed' }));
  const base = onboardingTrackerItems([journey('enquiry')], [], ctx())[0];
  assert.deepEqual(withEnquiry(base, closed, { owner: false, now: NOW }), base);
  // An enquiry still out with the landlord (no property yet) keeps its own row.
  const out = clientEnquirySchema.parse(raw({ id: ID(2), status: 'sent', answers: null, submittedAt: null, openedAt: null, propertyId: null, propertyName: null, stage: null }));
  assert.equal(onboardingTrackerItems([journey('enquiry')], [e, out], ctx()).length, 2);
});

test('the Properties table shows a new enquiry as "New enquiry"', () => {
  assert.equal(stageLabel('onboarding', { stage: 'enquiry' }), 'New enquiry');
  assert.equal(stageLabel('onboarding', { stage: 'estimate' }), 'Estimate');
  assert.equal(stageLabel('onboarding', { stage: 'archived' }), 'Declined');
  assert.equal(stageLabel('active', { stage: 'live' }), null);
  const [row] = buildPropertyRows([{ id: ID(5), name: '9 Dalry Road', address: '9 Dalry Road, Edinburgh EH11 2BG', region: 'Edinburgh', status: 'onboarding', bedrooms: 2, version: 1 }], [journey('enquiry')], []);
  assert.deepEqual([row.statusLabel, row.stage, row.region], ['Onboarding', 'New enquiry', 'Edinburgh']);
});

test('the migration keeps the agreed shape: same transaction, no backfill, no live data, privacy for Accounts', () => {
  const sql = readFileSync('supabase/migrations/20261015200000_enquiry_property_on_submit.sql', 'utf8');
  assert.match(sql, /perform private\.workspace_enquiry_create_property\(e\.id\);/);
  assert.doesNotMatch(sql, /update private\.workspace_client_enquiries set property_id[^;]*where status *= *'received'/i, 'no backfill of answered enquiries');
  assert.match(sql, /'accounts' and not private\.workspace_property_unvalued\(id\)/);
  assert.match(sql, /and not private\.workspace_property_unvalued\(target\)/);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /activity_scoped|workspace_activity/, 'the activity table and its policy are untouched');
  assert.ok(!sql.includes(String.fromCharCode(0x2014)), 'no em dashes');
});
