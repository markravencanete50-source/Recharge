import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The exact requests the Cleans screens build (reporting a problem, deciding a dispute, setting a pay
// rate) pass the server's checks, and the helpers behind the cleaner's month, guests and disputes.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { cleanProblemAction, cleanerRateAction, disputeAction, monthPay, guestLine, disputeFor, problemsOf } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { cleanerInvoiceGroups } = await vite.ssrLoadModule('/lib/accounts-work.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const id = () => crypto.randomUUID();

test('a problem reported from a clean passes the server check, with or without photos', () => {
  const base = { requestId: id(), workId: id(), version: 4, issue: '  Kitchen tap leaking under the sink ', urgent: true, repairType: 'leak' };
  const withPhotos = cleanProblemAction({ ...base, photoIds: [id(), id()] });
  assert.ok(operationsActionSchema.safeParse(withPhotos).success);
  assert.equal(withPhotos.step, 'reportCleanProblem'); assert.equal(withPhotos.data.issue, 'Kitchen tap leaking under the sink');
  const without = cleanProblemAction({ ...base, urgent: false, repairType: 'other', photoIds: [] });
  assert.ok(operationsActionSchema.safeParse(without).success);
  assert.equal('photoIds' in without.data, false, 'no empty photo list is sent');
  assert.equal(operationsActionSchema.safeParse({ ...without, data: { ...without.data, photoIds: [] } }).success, false);
  assert.equal(operationsActionSchema.safeParse({ ...without, data: { issue: 'Leak under the sink' } }).success, false, 'urgent is required');
  assert.equal(operationsActionSchema.safeParse({ ...without, data: { ...without.data, repairType: 'gas' } }).success, false);
  assert.equal(operationsActionSchema.safeParse({ ...without, data: { ...without.data, reservationId: id() } }).success, false, 'nothing else about the stay');
});

test('the review the cleaning manager saves still passes', () => {
  const review = { action: 'updateOperation', requestId: id(), workId: id(), version: 2, step: 'reviewCleaning', data: { accepted: false, guestFeedback: 'Guest found hair', reviewNote: 'Shower not cleaned' } };
  assert.ok(operationsActionSchema.safeParse(review).success);
});

test('deciding a dispute and setting a pay rate pass the server check', () => {
  for (const outcome of ['upheld', 'overturned']) assert.ok(teamsActionSchema.safeParse(disputeAction({ requestId: id(), workId: id(), version: 3, outcome, note: ' Photos show the shower clean ' })).success, outcome);
  assert.equal(disputeAction({ requestId: id(), workId: id(), version: 3, outcome: 'upheld', note: ' Checked ' }).note, 'Checked');
  assert.ok(teamsActionSchema.safeParse(cleanerRateAction({ requestId: id(), cleanerId: id(), rateMinor: 2500, version: 0 })).success, 'a first rate');
  assert.ok(teamsActionSchema.safeParse(cleanerRateAction({ requestId: id(), cleanerId: id(), rateMinor: 2750, version: 3 })).success, 'a change');
  assert.equal(teamsActionSchema.safeParse(cleanerRateAction({ requestId: id(), cleanerId: id(), rateMinor: 0, version: 0 })).success, false);
  assert.equal(teamsActionSchema.safeParse(cleanerRateAction({ requestId: id(), cleanerId: id(), rateMinor: 100001, version: 0 })).success, false);
  assert.ok(teamsReadSchema.safeParse({ section: 'cleanerRates' }).success);
});

test('the cleaner hears plain wording, without property details', () => {
  for (const [event, title] of [['cleaning.accepted', 'Clean accepted'], ['cleaning.rejected', 'Clean not accepted'], ['cleaning.dispute_upheld', 'Rejection upheld'], ['cleaning.dispute_overturned', 'Rejection overturned']]) {
    assert.equal(noticeCopy(event).title, title);
    assert.match(noticeCopy(event).message, /Sign in to Recharge/);
  }
  assert.equal(noticeCopy('operations.updateOperation.reportCleanProblem').title, 'Problem reported from a clean');
});

test('the month comes to the paid cleans at the rate, or says the rate is not set', () => {
  assert.deepEqual(monthPay({ rateMinor: 2500, paidCleans: 4 }), { rateMinor: 2500, cleans: 4, amountMinor: 10000, label: '£100.00', detail: '4 cleans at £25.00' });
  assert.equal(monthPay({ rateMinor: null, paidCleans: 4 }).label, 'Rate not set yet');
  assert.equal(monthPay(undefined).amountMinor, null);
  const work = [1, 2, 3].map(n => ({ workId: `00000000-0000-4000-8000-00000000000${n}`, propertyId: 'p', moduleId: 'cleans-invoices', title: 'Invoice', kind: 'cleaning_invoice', status: 'waiting', version: 1, assigneeId: null, data: { cleanerId: n < 3 ? 'a' : 'b', cleanerName: n < 3 ? 'Cara' : 'Ben', cleanedOn: '2026-10-0' + n } }));
  const groups = cleanerInvoiceGroups(work, () => 'Flat', new Map([['a', 3000]]));
  assert.deepEqual(groups.map(g => [g.cleanerName, g.rateMinor, g.amountMinor]), [['Cara', 3000, 6000], ['Ben', null, null]]);
  assert.equal(cleanerInvoiceGroups(work, () => 'Flat')[0].amountMinor, null, 'without rates as before');
});

test('guests, disputes and problems read from the clean', () => {
  const today = new Date('2026-10-08T12:00:00Z');
  assert.equal(guestLine({ workId: id(), guestsLeaving: 4, nextArrivalOn: '2026-10-10', nextArrivalGuests: 2 }, today), '4 guests leaving · next arrival Sat 10 Oct, 2 guests');
  assert.equal(guestLine({ workId: id(), guestsLeaving: null, nextArrivalOn: '2026-10-10', nextArrivalGuests: 1 }, today), 'Next arrival Sat 10 Oct, 1 guest');
  assert.equal(guestLine({ workId: id(), guestsLeaving: null, nextArrivalOn: null, nextArrivalGuests: null }, today), null);
  const clean = { workId: id(), data: { accepted: false, reviewNote: 'Shower not cleaned', complaintWorkId: id() } };
  const month = { openComplaints: [{ workId: clean.data.complaintWorkId, propertyId: 'p', sourceWorkId: clean.workId, cleanerStatement: null, createdAt: '2026-10-08' }], decidedComplaints: [] };
  assert.deepEqual(disputeFor(clean, month), { status: 'open', complaintWorkId: clean.data.complaintWorkId, note: null, statement: null, responded: false });
  assert.equal(disputeFor({ ...clean, data: { ...clean.data, disputeDecision: 'overturned', disputeNote: 'Photos show it clean' } }, month).status, 'overturned');
  assert.equal(disputeFor({ workId: id(), data: {} }, month), null);
  assert.deepEqual(problemsOf({ problems: [{ repairWorkId: id(), issue: 'Lamp broken', repairType: 'electrics', urgent: false, photos: 0, reportedAt: '2026-10-08T10:00:00Z' }, { bad: true }] }).map(x => x.issue), ['Lamp broken']);
});
