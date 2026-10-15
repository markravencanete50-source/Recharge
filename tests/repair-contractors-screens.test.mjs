import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Repairs with contractors (Lee, 15 October 2026): the screens and the HTTP side. A guest reports a problem in the chat,
// Stays try to fix it there ("Fixed in chat"), else send it to ONE named contractor ("Send to contractor"). The contractor
// sends an estimate, waits for approval, books the visit once "Approved, please book", and marks the job done with the
// invoice. Everything the sheets send passes the HTTP schema; the database (migration 20261021200000) checks it again.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const rc = await vite.ssrLoadModule('/lib/repair-contractors.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { operationsReadSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const media = await vite.ssrLoadModule('/lib/integration-policy.ts');
const { guestNameVisible } = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
const source = file => readFileSync(file, 'utf8');
const repairs = source('mobile/src/LiveRepairs.tsx'), shared = source('mobile/src/RepairContractors.tsx'), inbox = source('mobile/src/LiveGuestInbox.tsx');
const readyHome = source('mobile/src/ReadyHome.tsx'), approvals = source('mobile/src/LiveApprovals.tsx'), photos = source('mobile/src/Photos.tsx');

const W = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222', ME = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444', FILE = '55555555-5555-4555-8555-555555555555', CHAT = '66666666-6666-4666-8666-666666666666';
const update = (step, data) => operationsActionSchema.parse({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: W, version: 3, step, data });
const ok = built => { assert.ok('data' in built, 'error' in built ? built.error : ''); return built.data; };

test('Send to contractor: one named contractor is required, and the request passes the HTTP schema', () => {
  const base = { troubleshooting: 'Reset the boiler with the guest', guestUpdate: 'A contractor is being arranged', urgent: false, warranty: '', warrantyNeeded: false };
  assert.match(rc.referData({ ...base, readyUserId: '' }).error, /Choose the contractor/);
  const data = ok(rc.referData({ ...base, readyUserId: ME }));
  assert.equal(data.readyUserId, ME);
  update('referReady', data);
  assert.throws(() => update('referReady', { troubleshooting: base.troubleshooting, guestUpdate: base.guestUpdate }), 'readyUserId is required');
  // Changing the contractor: never to the same one, always with a reason.
  assert.match(rc.reassignData(ME, ME, 'Not available this week').error, /already has the job/);
  assert.match(rc.reassignData(OTHER, ME, 'no').error, /why/);
  update(rc.REASSIGN_STEP, ok(rc.reassignData(OTHER, ME, 'Not available this week')));
  assert.equal(rc.canReassign('stays', { phase: 'referred', assignedReadyId: ME }), true);
  assert.equal(rc.canReassign('ready', { phase: 'referred', assignedReadyId: ME }), false);
  assert.equal(rc.canReassign('admin', { phase: 'completed', assignedReadyId: ME }), false);
  // The picker reads GET /api/mobile/operations?section=repairContractors&propertyId=…
  const query = Object.fromEntries(new URLSearchParams(rc.contractorsQuery(P).slice(1)));
  assert.deepEqual(operationsReadSchema.parse(query), { section: 'repairContractors', propertyId: P });
  assert.equal(operationsReadSchema.safeParse({ section: 'repairContractors' }).success, false, 'a property is required');
  assert.deepEqual(operationsReadSchema.parse({ workId: W }), { workId: W }, 'the work item read is unchanged');
  assert.equal(rc.contractorLabel({ id: ME, name: 'Sam Pipes', trade: 'Plumber' }), 'Sam Pipes · Plumber');
  assert.match(source('lib/journey-server.ts'), /CONTRACTORS_READ\.rpc,\{\[CONTRACTORS_READ\.arg\]:parsed\.data\.propertyId\}/);
});

test('the contractor: send an estimate, wait for approval, book only once approved, then mark it done', () => {
  const mine = { assignedReadyId: ME, assignedReadyName: 'Sam Pipes' };
  assert.equal(rc.contractorStage({ ...mine, phase: 'referred' }), 'estimate');
  assert.equal(rc.contractorAction('ready', ME, { ...mine, phase: 'referred' }), 'estimate');
  assert.equal(rc.contractorAction('ready', OTHER, { ...mine, phase: 'referred' }), null, 'never on a job given to someone else');
  assert.equal(rc.contractorStage({ ...mine, phase: 'management_approval' }), 'waiting');
  assert.equal(rc.contractorStage({ ...mine, phase: 'owner_approval' }), 'waiting');
  // "Approved, please book" = referred AND bookingApprovedAt. No fallback.
  assert.equal(rc.contractorStage({ ...mine, phase: 'referred', managementApprovedAt: '2026-10-15T10:00:00Z' }), 'estimate');
  assert.equal(rc.contractorStage({ ...mine, phase: 'referred', bookingApprovedAt: '2026-10-15T10:00:00Z' }), 'book');
  assert.equal(rc.contractorStageLabel('book'), 'Approved, please book');
  assert.equal(rc.contractorAction('ready', ME, { ...mine, phase: 'booked' }), 'complete');

  assert.match(rc.estimateData('', 'Replace the cartridge', []).error, /price/);
  const estimate = ok(rc.estimateData('180.50', 'Replace the cartridge', [FILE]));
  assert.deepEqual(estimate, { quoteMinor: 18050, reason: 'Replace the cartridge', quoteSource: 'contractor', quoteFileIds: [FILE] });
  update('reviseQuote', estimate);
  assert.equal('quoteFileIds' in ok(rc.estimateData('180', 'Replace the cartridge', [])), false, 'no empty file list is sent');

  assert.match(rc.bookingData({ day: '2026-10-20', from: '12:00', to: '09:00', contractor: 'Sam', guestUpdate: 'Visit booked' }).error, /end after it starts/);
  const booking = ok(rc.bookingData({ day: '2026-10-20', from: '09:00', to: '12:00', contractor: 'Sam Pipes', guestUpdate: rc.visitGuestUpdate('2026-10-20', '09:00', '12:00') }));
  assert.equal(booking.guestUpdate, 'A repair visit is booked for Tuesday 20 October between 09:00 and 12:00.');
  update('bookRepair', booking);
  assert.throws(() => update('bookRepair', { ...booking, visitFrom: '12:00', visitTo: '09:00' }));
  assert.throws(() => update('bookRepair', { ...booking, visitFrom: '9:00' }), 'HH:MM only');
  assert.throws(() => update('bookRepair', { repairOn: booking.repairOn, contractor: booking.contractor, guestUpdate: booking.guestUpdate }), 'a new booking has a window');
  assert.ok(rc.VISIT_TIMES.includes('07:00') && rc.VISIT_TIMES.includes('21:00') && rc.VISIT_TIMES.every(t => /^\d\d:(00|30)$/.test(t)));

  assert.match(rc.completeData({ report: 'Cartridge replaced', cost: '200', guestUpdate: 'All done', estimateMinor: 18050, photoIds: [], invoiceIds: [] }).error, /above the approved estimate/);
  const done = ok(rc.completeData({ report: 'Cartridge replaced and tested', cost: '180.50', guestUpdate: 'The repair is done.', estimateMinor: 18050, photoIds: [], invoiceIds: [FILE] }));
  assert.deepEqual(done.invoiceFileIds, [FILE]);
  update('completeRepair', done);
  assert.throws(() => update('completeRepair', { ...done, invoiceFileIds: ['not-a-uuid'] }));
});

test('clashes warn with the ready-made label and never a guest name; Ready sees no guest names', () => {
  const clashes = [{ checkIn: '2026-10-19', checkOut: '2026-10-22', label: 'Guest stay, check-in 14:00' }];
  assert.deepEqual(rc.clashesOf({ clashes }), clashes, 'on the repair');
  assert.deepEqual(rc.clashesOf({ data: { clashes } }), clashes, 'in the write\'s answer');
  assert.deepEqual(rc.clashesOf({ data: { clashes: 'nonsense' } }), []);
  assert.equal(rc.clashWarning([]), null);
  assert.match(rc.clashWarning(clashes), /Stays will let the guest know/);
  assert.match(rc.clashWarning(clashes, false), /Let the guest know/);
  assert.match(shared, /\{c\.label\}/);
  assert.doesNotMatch(shared, /guestName/, 'the contractor pieces never show a guest name');
  assert.equal(guestNameVisible('ready'), false);
  assert.equal(rc.seesGuestChat('ready'), false);
  assert.ok(rc.seesGuestChat('stays') && rc.seesGuestChat('admin'));
});

test('from the guest chat: Report a repair is prefilled, and Fixed in chat sends the resolution through the guest send', () => {
  operationsActionSchema.parse({ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: P, kind: 'maintenance', data: { issue: 'No hot water in the shower', estimatedCostMinor: 0, hazard: false, guestConversationId: CHAT } });
  assert.match(inbox, /canReportRepair\(account\.role\) && <Button label="Report a repair"/);
  assert.match(inbox, /prefill=\{\{ propertyId: t\.propertyId, guestConversationId: t\.id, guestName: t\.guestName, reservationRef: t\.reservationRef, checkIn: t\.checkIn \}\}/);
  assert.match(repairs, /\.\.\.\(prefill \? \{ guestConversationId: prefill\.guestConversationId \} : \{\}\)/);
  const stays = [{ id: 'a', reference: 'HM123', checkIn: '2026-10-10' }, { id: 'b', reference: 'X9', checkIn: '2026-10-14' }];
  assert.equal(rc.matchStay(stays, { reservationRef: 'hm123', checkIn: null }), 'a');
  assert.equal(rc.matchStay(stays, { reservationRef: null, checkIn: '2026-10-14T15:00:00Z' }), 'b');
  assert.equal(rc.matchStay(stays, { reservationRef: null, checkIn: null }), '');
  // Triage: the checklist with a link back to the chat, then Fixed in chat or Send to contractor.
  assert.match(repairs, /dataSet: \{ repairSheet: "troubleshoot" \}[^\n]*\n\s*<GuestChatLink p=\{p\} data=\{repair\.data\} \/>/);
  assert.match(repairs, /chatId \? "Fixed in chat" : "Resolved without a visit"/);
  assert.match(repairs, /writeInbox\(\{ action: "sendReply", requestId: guestRequest\.get\(\), threadId: chatId, body: words \}\)/);
  assert.match(repairs, /useGuestSend\(phase === "triage" && seesGuestChat\(role\) \? chatId : null\)/);
  assert.equal(rc.guestSendRoute({ canSend: true, canSendEmail: false, thread: { source: 'hostaway' } }), 'send');
  assert.equal(rc.guestSendRoute({ canSend: true, canSendEmail: false, thread: { source: 'manual' } }), 'none');
  assert.equal(rc.guestSendRoute({ canSend: false, canSendEmail: true, thread: { source: 'email' } }), 'send');
  assert.equal(rc.fixedInChatMessage('Reset the boiler'), 'Thanks for your patience. Reset the boiler. Let us know if anything else needs a look.');
});

test('the sheets: Send to contractor, Send estimate, Approved please book, Mark done, Change contractor', () => {
  assert.match(repairs, /dataSet: \{ repairSheet: "send-to-contractor" \}[\s\S]{0,600}<ContractorPicker p=\{p\} propertyId=\{repair\.propertyId\} value=\{f\("readyUserId"\)\}/);
  assert.match(repairs, /referReady: "Send to contractor"/);
  assert.match(repairs, /dataSet: \{ repairSheet: "estimate" \}[\s\S]{0,1200}<RepairFiles key=\{"quote:" \+ resetKey\}/);
  assert.match(repairs, /step: "reviseQuote", data: built\.data/);
  assert.match(repairs, /contractorView && step === "bookRepair" \? "Approved, please book"/);
  assert.match(repairs, /dataSet: \{ repairSheet: "book" \}[\s\S]{0,900}label="From"[\s\S]{0,200}label="To"/);
  assert.match(repairs, /<ClashNotice p=\{p\} clashes=\{clashes\}/);
  assert.match(repairs, /completeRepair: "Mark done"/);
  assert.match(repairs, /dataSet: \{ repairSheet: "invoice" \}[\s\S]{0,200}<RepairFiles key=\{"invoice:" \+ resetKey\}/);
  assert.match(repairs, /dataSet: \{ repairSheet: "reassign" \}[\s\S]{0,600}exclude=\{contractor\?\.id\}/);
  assert.match(repairs, /step: REASSIGN_STEP/);
  // Ready Home: "Jobs for you", only the jobs given to them, by what they do next.
  assert.match(readyHome, /<ContractorJobs p=\{p\} userId=\{userId\}/);
  assert.match(shared, />Jobs for you</);
  assert.match(shared, /assignedTo\(op\.data, userId\) && !!assignedContractor\(op\.data\)/);
  // Management approvals: the contractor's name and their quote, read from the repair.
  assert.match(approvals, /!owner && <ApprovalContractor/);
  assert.match(shared, /readWorkItem\(workId\)/);
  assert.match(shared, /title="Contractor's quote"/);
});

test('quotes and invoices: a PDF for repairs only, shown as a file to open, never in a photo strip', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(40)), jpeg = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(40).fill(0)]);
  assert.deepEqual([...media.DOCUMENT_PURPOSES], ['maintenance'], 'the one allow-list line');
  assert.equal(media.mediaFormat(pdf, 'maintenance'), 'pdf');
  for (const purpose of ['cleaning', 'expense', 'delivery', 'licence']) assert.equal(media.mediaFormat(pdf, purpose), null, purpose);
  assert.equal(media.mediaFormat(jpeg, 'cleaning'), 'jpg');
  assert.equal(media.mediaFormat(new TextEncoder().encode('%PDX-' + 'x'.repeat(40)), 'maintenance'), null);
  assert.equal(media.mediaContentType('pdf'), 'application/pdf');
  assert.equal(media.mediaContentType('jpg'), 'image/jpeg');
  const server = source('lib/media-server.ts');
  assert.match(server, /format=mediaFormat\(bytes,parsed\.data\.purpose\)/);
  assert.match(server, /'Content-Type':mediaContentType\(String\(result\.data\.format\)\)/);
  assert.match(source('lib/integration-providers.ts'), /contentType: mediaContentType\(format\)/);
  // The screens: a PDF is a chip that opens it; photos stay in the strip.
  assert.match(shared, /pdfs\.map\(\(id, i\) => <FileChip/);
  assert.match(shared, /images = ids\.filter\(id => formats\.get\(id\) !== "pdf"\)/);
  assert.match(shared, /documentsAllowed\("maintenance"\) && <>/);
  assert.match(photos, /setItems\(photosOnly\(parsed\.data\)\)/);
  assert.match(repairs, /x\.purpose === "maintenance" && x\.format !== "pdf"/);
});

test('the older generic repair forms point to Maintenance for the steps that now need a contractor or a time', () => {
  const forms = source('lib/workflow-forms.ts');
  assert.match(forms, /'Open this repair from Maintenance to choose the contractor it goes to\.'/);
  assert.match(forms, /'Open this repair from Maintenance to book the day and time of the visit\.'/);
});
