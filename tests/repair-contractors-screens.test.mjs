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
const { repairStep } = await vite.ssrLoadModule('/lib/repairs-live.ts');
const limiter = source('mobile/src/LimitChanger.tsx'), managementApprovals = source('mobile/src/ManagementApprovals.tsx'), management = source('mobile/src/LiveManagement.tsx');
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
  // After the estimate: being reviewed by management, then waiting for the owner, then "Approved, please book".
  assert.equal(rc.contractorStage({ ...mine, phase: 'team_review' }), 'review');
  assert.equal(rc.contractorStageLabel('review'), 'Being reviewed by management');
  assert.equal(rc.contractorStage({ ...mine, phase: 'owner_approval' }), 'owner');
  assert.equal(rc.contractorStageLabel('owner'), 'Waiting for the owner');
  assert.equal(rc.contractorStage({ ...mine, phase: 'management_approval' }), 'waiting', 'older estimates still waiting on management');
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
  // The label carries the stay's own time from Hostaway (migration 20261021700000), 14:00 / 10:00 when unknown.
  const clashes = [{ checkIn: '2026-10-19', checkOut: '2026-10-22', label: 'Guest stay, check-in 15:00' }];
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
  // Approvals: the contractor's name and their quote, read from the repair.
  assert.match(approvals, /<ApprovalContractor key=/);
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

test('Review done: management (admins and super admins) review a contractor estimate; Stays see it waiting; a preview of the owner limit', () => {
  assert.equal(repairStep('admin', 'team_review'), 'reviewDone');
  assert.equal(repairStep('super_admin', 'team_review'), 'reviewDone');
  for (const role of ['stays', 'ready', 'client', 'accounts']) assert.equal(repairStep(role, 'team_review'), null, role);
  update('reviewDone', rc.reviewData(''));
  assert.deepEqual(rc.reviewData('  Checked against the last repair '), { note: 'Checked against the last repair' });
  update('reviewDone', rc.reviewData('Checked against the last repair'));
  assert.throws(() => update('reviewDone', { note: 'ok', approve: true }), 'nothing else is sent');
  const est = { phase: 'team_review', estimatedCostMinor: 18000 };
  assert.equal(rc.ownerLimitLine('admin', { ...est, ownerLimitMinor: 25000, ownerFullPermission: false, ownerLimitSource: 'set' }), "Within the owner's limit (£250): this will be approved straight away.");
  assert.equal(rc.ownerLimitLine('stays', { ...est, ownerLimitMinor: 10000, ownerFullPermission: false, ownerLimitSource: 'form' }), "Above the owner's limit (£100): the owner will be asked.");
  assert.equal(rc.ownerLimitLine('admin', { ...est, ownerLimitMinor: 18000 }), "Within the owner's limit (£180): this will be approved straight away.", 'at the limit is within it');
  assert.match(rc.ownerLimitLine('admin', { ...est, ownerLimitMinor: null, ownerFullPermission: true, ownerLimitSource: 'set' }), /full permission/);
  assert.match(rc.ownerLimitLine('admin', { ...est, ownerLimitMinor: null, ownerFullPermission: false, ownerLimitSource: 'none' }), /owner will be asked/);
  assert.equal(rc.ownerLimitLine('admin', est), null, 'no fields: the general line instead');
  assert.match(repairs, /\{step === "reviewDone" && <Text style=\{\[ui\.small, \{ color: p\.muted \}\]\}>\{REVIEW_CAPTION\}<\/Text>\}/);
  assert.match(shared, /export const REVIEW_CAPTION = "Management approval of the contractor's estimate";/);
  assert.match(repairs, /: <Notice text="Waiting for management to review\." p=\{p\} \/>/);
  assert.match(repairs, /phase === "team_review" && seesGuestChat\(role\) && <View/);
  // In Management approvals, labelled "Contractor estimate to review", with Review done there too.
  assert.match(managementApprovals, /\{admin && <ContractorReviews p=\{p\} role=\{account\.role\}/);
  assert.match(shared, /<Tag label="Contractor estimate to review"/);
  assert.match(shared, /label=\{busy \? "Saving…" : "Review done"\}/);
  // The owner's Approvals: the contractor, what the work is and the quote.
  assert.match(approvals, /<ApprovalContractor key=\{"contractor:" \+ decision\.workId \+ ":" \+ decision\.version\} p=\{p\} workId=\{decision\.workId\} version=\{decision\.version\} showReason=/);
});

test('a contractor never sees an owner limit, even when a limit field is present', () => {
  const leaked = { phase: 'referred', estimatedCostMinor: 18000, ownerLimitMinor: 25000, ownerFullPermission: false, ownerLimitSource: 'set', autoApprovedMinor: 18000, autoApprovalLimitMinor: 25000, autoApprovalSource: 'set' };
  assert.equal(rc.ownerLimitLine('ready', leaked), null);
  assert.match(shared, /export function EstimatePreview[^\n]*\n\s*if \(role === "ready" \|\| role === "client"\) return null;/);
  assert.match(repairs, /role !== "ready" && !!autoApprovalLabel\(repair\.data\)/);
  for (const s of rc.CONTRACTOR_STAGES) assert.doesNotMatch(s.label + s.detail, /limit/i, s.stage);
  // The contractor's own screens: Jobs for you, and the Send estimate panel.
  const jobs = shared.slice(shared.indexOf('export function ContractorJobs'), shared.indexOf('// --- Review done'));
  assert.ok(jobs.length > 100);
  assert.doesNotMatch(jobs, /limit/i);
  const estimate = repairs.slice(repairs.indexOf('dataSet: { repairSheet: "estimate" }'), repairs.indexOf('{!contractorView && canReviseQuote'));
  assert.ok(estimate.length > 100);
  assert.doesNotMatch(estimate, /limit/i);
  const waiting = repairs.slice(repairs.indexOf('{!step && contractorView && !estimating'), repairs.indexOf('{!step && !contractorView'));
  assert.ok(waiting.length > 100);
  assert.doesNotMatch(waiting, /limit/i);
});

test('Limit Changer: every owner and property, super admins change limits, admins look; waiting estimates approved after a change', () => {
  const query = Object.fromEntries(new URLSearchParams(rc.limitsQuery().slice(1)));
  assert.deepEqual(operationsReadSchema.parse(query), { section: 'repairLimits' });
  const server = source('lib/journey-server.ts');
  assert.match(server, /parsed\.data\.section===LIMITS_READ\.section\?await session\.client\.rpc\(LIMITS_READ\.rpc\)/);
  assert.match(server, /\(body as \{action\?:unknown\}\)\.action===LIMITS_ACTION\.action/);
  assert.match(server, /session\.client\.rpc\(LIMITS_ACTION\.rpc,\{\[LIMITS_ACTION\.arg\]:limit\.data\}\)/);
  assert.equal(rc.LIMITS_ACTION.rpc, 'workspace_repair_limits_action');
  assert.equal(rc.LIMITS_READ.rpc, 'workspace_repair_limits_read');

  const amount = rc.limitAction(W, [P], 'amount', '250');
  assert.deepEqual(amount.data, { requestId: W, action: 'setRepairLimit', propertyIds: [P], limitMinor: 25000, fullPermission: false });
  assert.deepEqual(rc.limitAction(W, [P, ME], 'full', '250').data, { requestId: W, action: 'setRepairLimit', propertyIds: [P, ME], limitMinor: null, fullPermission: true }, 'full permission has no amount');
  assert.deepEqual(rc.limitAction(W, [P], 'ask', '').data, { requestId: W, action: 'setRepairLimit', propertyIds: [P], limitMinor: null, fullPermission: false });
  assert.match(rc.limitAction(W, [P], 'amount', 'lots').error, /pounds/);
  assert.match(rc.limitAction(W, [], 'ask', '').error, /property/);
  assert.equal(rc.repairLimitActionSchema.safeParse({ requestId: W, action: 'setRepairLimit', propertyIds: [P], limitMinor: 100, fullPermission: true }).success, false);
  assert.equal(rc.repairLimitActionSchema.safeParse({ requestId: W, action: 'setRepairLimit', propertyIds: Array(201).fill(P), limitMinor: null, fullPermission: false }).success, false);

  const limits = rc.limitsSchema.parse({ companyLimitMinor: 10000, canEdit: false, owners: [
    { ownerKey: 'user:' + ME, ownerName: 'Jo Owner', properties: [{ propertyId: P, propertyName: 'Flat 1', limitMinor: 25000, fullPermission: false, source: 'set', updatedBy: 'Alex', updatedAt: '2026-10-15T09:00:00Z' }] },
    { ownerKey: 'property:' + P, ownerName: null, properties: [{ propertyId: P, propertyName: 'Flat 2', limitMinor: null, fullPermission: false, source: 'none', updatedBy: null, updatedAt: null }] },
  ] });
  assert.equal(limits.canEdit, false);
  assert.equal(rc.ownerTitle(limits.owners[1]), 'Owner not recorded');
  assert.equal(rc.limitText(limits.owners[0].properties[0]), 'Up to £250');
  assert.equal(rc.limitText({ limitMinor: null, fullPermission: true }), 'Full permission');
  assert.equal(rc.limitText({ limitMinor: null, fullPermission: false }), 'Always ask');
  assert.equal(rc.SOURCE_TEXT.form, 'From the set-up form');
  assert.equal(rc.SOURCE_TEXT.set, 'Set in Limit Changer');
  assert.equal(rc.changedText(limits.owners[0].properties[0]), 'Changed by Alex on 15 Oct 2026');
  assert.equal(rc.changedText({ updatedBy: ME, updatedAt: null }), null, 'never a raw id');
  assert.equal(rc.autoApprovedText(2), '2 waiting estimates were approved automatically.');
  assert.equal(rc.autoApprovedText(1), '1 waiting estimate was approved automatically.');
  assert.deepEqual(rc.limitResultSchema.parse({ properties: [], autoApproved: [W] }).autoApproved, [W]);

  // The screen: editing only when the read says canEdit (super admins); admins see the limits.
  assert.match(limiter, /\{limits && !limits\.canEdit && <Notice text="Only a super admin can change repair limits\. You can see them here\."/);
  assert.match(limiter, /\{limits\?\.canEdit && o\.properties\.length > 1 && <Button label="Set for all of this owner's properties"/);
  assert.match(limiter, /canEdit=\{!!limits\?\.canEdit\}/);
  assert.match(limiter, /\{canEdit && <Button label="Change"/);
  assert.match(limiter, /Company limit for estimates the team enters/);
  assert.match(limiter, /<Notice text=\{autoApprovedText\(approved\.length\)\}/);
  assert.match(limiter, /onOpenWork\(op\)/);
  assert.match(management, /\(v !== "limits" \|\| isWorkspaceAdmin\(account\.role\)\)/);
  assert.match(management, /limits: \{ key: "limits", label: "Limit Changer", /);
  assert.match(source('lib/home-tools.ts'), /tool\('limits', 'Limit Changer', 'Repair spending limits by owner', 'coins', work\('management', \{ sub: 'limits' \}\)\)/);
  assert.match(source('lib/role-panel.ts'), /'tool:access', 'tool:limits'/);
});

test('the contractor line: staff and owners see the name; owners are given the name without the id (20261021700000)', () => {
  assert.equal(rc.contractorNameOf({ assignedReadyId: ME, assignedReadyName: 'Sam Pipes' }), 'Sam Pipes');
  assert.equal(rc.contractorNameOf({ assignedReadyName: 'Sam Pipes' }), 'Sam Pipes', 'the owner\'s copy has no id');
  assert.equal(rc.assignedContractor({ assignedReadyName: 'Sam Pipes' }), null, 'which never makes the owner the contractor');
  assert.equal(rc.contractorNameOf({}), null);
  assert.equal(rc.contractorNameOf({ assignedReadyName: { email: 'x@example.com' } }), null);
  assert.match(shared, /Contractor: <Text style=\{\{ fontWeight: "600" \}\}>\{name\}<\/Text>/);
  assert.match(source('mobile/src/LiveApprovals.tsx'), /Contractor: \{r\.contractor\}/, 'on the owner\'s approval list');
});
