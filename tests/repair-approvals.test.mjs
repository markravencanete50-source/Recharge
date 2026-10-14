import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Repair approvals in the app: the "Approved automatically (under £100)" label, the limit wording, why a repair is
// waiting for management, the quote source in the HTTP schema, and the "Send by WhatsApp" link.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
after(() => vite.close());
const { autoApprovalLabel, repairLimit, limitPounds, repairLimitSummary, managementReason, repairWhatsAppText, repairWhatsAppLink, whatsAppNumber, quoteSourceOf, APP_LINK } = await vite.ssrLoadModule('/lib/repair-approvals.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { declineNote } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const { repairApprovalSchema } = await vite.ssrLoadModule('/lib/management-live.ts');

test('approved automatically: shown while the current quote is the one approved that way', () => {
  assert.equal(autoApprovalLabel({ estimatedCostMinor: 9000, autoApprovedMinor: 9000, autoApprovalLimitMinor: 10000 }), 'Approved automatically (under £100)');
  assert.equal(autoApprovalLabel({ estimatedCostMinor: 9000, autoApprovedMinor: 9000, autoApprovalLimitMinor: 12550 }), 'Approved automatically (under £125.50)');
  assert.equal(autoApprovalLabel({ estimatedCostMinor: 25000, autoApprovedMinor: 9000, autoApprovalLimitMinor: 10000 }), null, 'a later, higher quote was approved another way');
  assert.equal(autoApprovalLabel({ estimatedCostMinor: 9000 }), null);
});

test('the limit: £100 unless set, in plain words', () => {
  assert.equal(repairLimit(null), 10000);assert.equal(repairLimit(undefined), 10000);assert.equal(repairLimit(0), 0);assert.equal(repairLimit(25000), 25000);
  assert.equal(limitPounds(10000), '£100');assert.equal(limitPounds(150000), '£1,500');
  assert.equal(repairLimitSummary(null), 'Repairs under £100 are approved automatically. At £100 or more, management approve first and then the owner is asked. Contractor estimates always need management approval.');
  assert.match(repairLimitSummary(25000), /^Repairs under £250 are approved automatically/);
  assert.doesNotMatch(repairLimitSummary(null) + managementReason({ estimatedCostMinor: 1, limitMinor: null, ownerApprovedAt: null }), /—/, 'no em dashes');
});

test('why a repair is waiting for management, and what happens after', () => {
  assert.equal(managementReason({ estimatedCostMinor: 25000, limitMinor: 10000, quoteSource: 'team', ownerApprovedAt: null, ownerNext: true }), 'At or over the £100 limit. Once you approve, the owner is asked to approve it.');
  assert.equal(managementReason({ estimatedCostMinor: 5000, limitMinor: 10000, quoteSource: 'contractor', ownerApprovedAt: null, ownerNext: false }), 'A contractor estimate, which management always approve. The owner does not need to approve it, so it carries on once you approve.');
  assert.match(managementReason({ estimatedCostMinor: 25000, limitMinor: 10000, ownerApprovedAt: '2026-10-01T10:00:00Z', ownerNext: false }), /already approved/);
  // The Management read still parses without the new fields (an older database).
  const row = { workId: crypto.randomUUID(), version: 1, title: 'Repair', propertyId: crypto.randomUUID(), propertyName: 'Flat', issue: null, repairType: null, urgent: false, hazard: false, estimatedCostMinor: 1, previousEstimateMinor: null, quoteReason: null, ownerApprovedAt: null, limitMinor: null, waitingSince: '2026-10-01' };
  assert.ok(repairApprovalSchema.safeParse(row).success);
  assert.equal(repairApprovalSchema.parse({ ...row, quoteSource: 'contractor', ownerNext: true }).quoteSource, 'contractor');
});

test('a quote says where it came from: the Ready team or a contractor', () => {
  const base = { action: 'updateOperation', requestId: crypto.randomUUID(), workId: crypto.randomUUID(), version: 1, step: 'reviseQuote' };
  assert.ok(operationsActionSchema.safeParse({ ...base, data: { quoteMinor: 5000, reason: 'Contractor quoted', quoteSource: 'contractor' } }).success);
  assert.ok(operationsActionSchema.safeParse({ ...base, data: { quoteMinor: 5000, reason: 'Ready team quote' } }).success, 'optional, so older apps keep working');
  assert.ok(!operationsActionSchema.safeParse({ ...base, data: { quoteMinor: 5000, reason: 'Who knows', quoteSource: 'friend' } }).success);
  const create = { action: 'createOperation', requestId: crypto.randomUUID(), propertyId: crypto.randomUUID(), kind: 'maintenance' };
  assert.ok(operationsActionSchema.safeParse({ ...create, data: { issue: 'Boiler leaking', estimatedCostMinor: 5000, hazard: false, quoteSource: 'contractor' } }).success);
  assert.equal(quoteSourceOf({ quoteSource: 'contractor' }), 'contractor');assert.equal(quoteSourceOf({}), 'team');
});

test('owners read what happens next, not management’s reason they do not receive', () => {
  assert.equal(declineNote({ phase: 'management_declined', managementDeclinedReason: 'Use the spare part' }), 'Management declined: Use the spare part');
  assert.equal(declineNote({ phase: 'management_declined' }), 'Management declined the cost. Recharge will get a new quote or close the repair.');
});

test('Send by WhatsApp: a ready summary, to the owner when we hold their number', () => {
  const repair = { propertyName: 'Harbour Flat ', issue: 'Boiler losing pressure & no hot water', phase: 'owner_approval', estimateMinor: 25000, quoteSource: 'contractor' };
  assert.equal(repairWhatsAppText(repair), `Repair at Harbour Flat\nIssue: Boiler losing pressure & no hot water\nQuote: £250.00 (contractor estimate)\nNext step: Please approve the quote in the Recharge app: ${APP_LINK}`);
  const link = repairWhatsAppLink(repair, '07700 900123');
  assert.ok(link.startsWith('https://wa.me/447700900123?text='));
  assert.equal(decodeURIComponent(link.split('?text=')[1]), repairWhatsAppText(repair), 'the text is URL-encoded whole');
  assert.ok(!link.includes(' ') && !link.includes('&no') && !link.includes('\n'));
  assert.ok(repairWhatsAppLink(repair, null).startsWith('https://wa.me/?text='), 'no number: staff pick the contact');
  assert.ok(repairWhatsAppLink(repair, 'call the office').startsWith('https://wa.me/?text='));
  for (const [phone, digits] of [['+44 7700 900123', '447700900123'], ['0044 7700 900123', '447700900123'], ['(0131) 496-0000', '441314960000'], ['+1 202 555 0143', '12025550143'], ['123', null], ['', null]]) assert.equal(whatsAppNumber(phone), digits, phone);
  // Under the limit, and after booking: the label and the date, nothing else.
  const booked = repairWhatsAppText({ propertyName: 'Castle Loft', issue: 'Tap dripping', phase: 'booked', estimateMinor: 9000, quoteSource: 'team', autoApproval: 'Approved automatically (under £100)', repairOn: '2026-10-20' });
  assert.equal(booked, 'Repair at Castle Loft\nIssue: Tap dripping\nQuote: £90.00\nApproved automatically (under £100)\nNext step: The repair is booked for 20 October 2026.');
  assert.match(repairWhatsAppText({ propertyName: 'Loft', issue: 'Tap', phase: 'triage', estimateMinor: 0 }), /Quote: not known yet\nNext step: We are arranging the repair\.$/);
  for (const phase of ['management_approval', 'owner_declined', 'management_declined', 'referred', 'completed', 'resolved', 'closed']) assert.doesNotMatch(repairWhatsAppText({ propertyName: 'Loft', issue: 'Tap', phase, estimateMinor: 100 }), /—|undefined|null/, phase);
});
