import { z } from 'zod';
import { csvCell } from './analytics-export';
import { formatMoney } from './format';
import { noticeCopy } from './notice-copy';

// Management oversight: the business at a glance, each work item's history, the decisions report,
// and management's own actions (remind an owner now, mark a missed day as seen, approve an unusual
// owner payout). The database decides who may read or do each of these.
const uuid = z.string().uuid();
export const oversightReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('overview') }).strict(),
  z.object({ section: z.literal('history'), workId: uuid }).strict(),
  z.object({ section: z.literal('decisions') }).strict(),
]);
export const oversightActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remindOwner'), requestId: uuid, workId: uuid }).strict(),
  z.object({ action: z.literal('markMissedSeen'), requestId: uuid, userId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day') }).strict(),
  z.object({ action: z.literal('approvePayout'), requestId: uuid, statementId: uuid, version: z.number().int().min(1), note: z.string().trim().max(2000).default('') }).strict(),
]);
export type OversightAction = z.infer<typeof oversightActionSchema>;

// Across the business: Stays, Cleans, Ready and Accounts in numbers.
const count = z.number().int();
export const overviewSchema = z.object({
  today: z.string(),
  stays: z.object({ listingsToCheck: count, relistingsOpen: count, emptyNights: count, guestsWaiting: count.nullable() }),
  cleans: z.object({ today: count, doneToday: count, unassignedToday: count, toReview: count, disputes: count }),
  ready: z.object({ ownerApproval: count, toRefer: count, referred: count, booked: count, visitsDue: count }),
  accounts: z.object({ expensesToApprove: count, overLimit: count, payoutsToReconcile: count, statementsToIssue: count }),
});
export type Overview = z.infer<typeof overviewSchema>;

// One work item's history, as the database records it.
const entrySchema = z.object({
  type: z.enum(['status', 'event', 'review', 'overturned', 'expense', 'escalated']), at: z.string(),
  by: z.string().nullable().optional(), note: z.string().nullable().optional(),
  from: z.string().optional(), to: z.string().nullable().optional(), event: z.string().optional(), evidence: z.string().nullable().optional(),
  accepted: z.boolean().optional(), guestFeedback: z.string().nullable().optional(), status: z.string().optional(), amountMinor: z.number().nullable().optional(), supplier: z.string().optional(),
});
export const historySchema = z.object({ kind: z.string().nullable(), entries: z.array(entrySchema) });
export type History = z.infer<typeof historySchema>;
export type HistoryRow = { key: string; at: string; label: string; by: string | null; note: string | null; evidence: string[] };

const STATUS: Record<string, string> = { waiting: 'Waiting', in_progress: 'In progress', in_review: 'In review', approved: 'Approved', declined: 'Declined', completed: 'Completed', cancelled: 'Cancelled' };
const CREATED: Record<string, string> = {
  maintenance: 'Repair reported', cleaning: 'Clean scheduled', daily_pricing: 'Pricing decision recorded', listing_health: 'Listing checked', guest_review: 'Review logged', purchase: 'Purchase requested',
};
const EVENT: Record<string, string> = {
  'workspace_work_items.insert': 'Created', 'handover.created': 'Created for the team',
  'operations.updateOperation.referReady': 'Passed to Ready', 'operations.updateOperation.bookRepair': 'Repair booked', 'operations.updateOperation.completeRepair': 'Repair completed',
  'operations.updateOperation.reviseQuote': 'Quote revised', 'operations.updateOperation.approveBudget': 'Owner approved the cost',
  'operations.updateOperation.startRelisting': 'Re-listing started', 'operations.updateOperation.recordApplied': 'Price change applied', 'operations.updateOperation.completeHandover': 'Completed',
  'operations.updateOperation.prepareQuote': 'Offer prepared', 'operations.updateOperation.recordGuestAcceptance': 'Guest accepted the offer', 'operations.updateOperation.recordGuestDecline': 'Guest said no',
  'operations.updateOperation.confirmBooking': 'Booking confirmed', 'operations.updateOperation.approvePurchase': 'Purchase approved', 'operations.updateOperation.recordOrder': 'Purchase ordered',
  'operations.updateOperation.recordDelivery': 'Delivery recorded', 'operations.updateOperation.reconcilePurchase': 'Purchase checked against its invoice',
  'operations.updateOperation.submitApplication': 'Licence application submitted', 'operations.updateOperation.recordSafetyChecks': 'Safety checks recorded', 'operations.updateOperation.recordGranted': 'Licence granted',
  'operations.updateOperation.submitCleaning': 'Clean submitted', 'cleaning.cleaner_responded': 'Cleaner responded',
  'cleaning.decision_upheld': 'Rejection upheld', 'cleaning.decision_overturned': 'Rejection overturned', 'cleaning.decision_no_action': 'Review closed with no action',
  'cleaning.decision_supervised': 'Next cleans to be supervised', 'cleaning.decision_removed_from_rota': 'Removed from the rota',
  'repairs.owner_reminder': 'Reminder sent to the owner', 'journey.estimate_reminder': 'Estimate reminder sent to the owner',
  'journey.createEnquiry': 'Enquiry started', 'journey.publishEstimate': 'Estimate published', 'journey.decideEstimate': 'Owner decided on the estimate',
  'journey.publishAgreement': 'Agreement published', 'journey.signAgreement': 'Agreement signed', 'journey.submitForm': 'Set-up form submitted', 'journey.linkInvoice': 'Onboarding invoice linked', 'journey.recordInvoiceOutside': 'Invoice handled outside the app',
  'journey.bookInspection': 'Inspection booked', 'journey.completeInspection': 'Inspection completed', 'journey.makeLive': 'Property made live',
  'journey.askQuestion': 'Question asked', 'journey.answerQuestion': 'Question answered',
  'management.flag_raised': 'Flagged for management', 'management.flag_resolved': 'Management resolved the flag', 'management.flag_declined': 'Management declined the flag', 'management.flag_withdrawn': 'Flag withdrawn',
  'cleaning.form_missing': 'Clean form missing', 'cleaning.form_reminder': 'Cleaner reminded to send the form', 'aircover.flagged': 'Flagged as an AirCover claim', 'stays.direct_booking_follow_up': 'Direct booking follow-up added',
  'operations.updateOperation.resolveRepair': 'Resolved without a visit', 'routine.visit_form_recorded': 'Visit form recorded',
};
// One recorded event in plain words; events the table does not know fall back to the notice copy.
export const eventLabel = (event: string) => EVENT[event] ?? noticeCopy(event).title;
const CREATION = new Set(['workspace_work_items.insert', 'handover.created', 'operations.createOperation']);
const close = (a: string, b: string, seconds = 5) => Math.abs(Date.parse(a) - Date.parse(b)) <= seconds * 1000;

// The history in plain words, oldest first. A status change saved with a step (same person, same
// moment) is folded into that step, and the duplicate "created" records collapse into one.
export function historyRows(history: History): HistoryRow[] {
  const entries = history.entries;
  const events = entries.filter(e => e.type === 'event');
  const hasExpense = entries.some(e => e.type === 'expense');
  const rows: HistoryRow[] = [];
  const folded = new Set<number>();
  entries.forEach((e, i) => {
    if (e.type !== 'status') return;
    const step = events.find(x => x.by === e.by && close(x.at, e.at) && !CREATION.has(x.event ?? ''));
    if (step) folded.add(i);
  });
  entries.forEach((e, i) => {
    const key = `${e.type}:${i}`, by = e.by ?? null;
    if (e.type === 'status') {
      if (folded.has(i)) return;
      rows.push({ key, at: e.at, by, label: `Marked ${(STATUS[e.to ?? ''] ?? e.to ?? '').toLowerCase()}`, note: e.note ?? null, evidence: e.from ? [`Was ${(STATUS[e.from] ?? e.from).toLowerCase()}`] : [] });
    } else if (e.type === 'event') {
      const event = e.event ?? '';
      // One "created" line: the most specific record of the creation wins.
      if (event === 'workspace_work_items.insert' && events.some(x => x !== e && CREATION.has(x.event ?? '') && close(x.at, e.at))) return;
      if (event === 'handover.created' && events.some(x => x.event === 'operations.createOperation' && close(x.at, e.at))) return;
      if (event.startsWith('finance.expense_') && hasExpense) return;
      const status = entries.find((x, j) => folded.has(j) && x.by === e.by && close(x.at, e.at));
      const evidence = [e.evidence, status ? STATUS[status.to ?? ''] : null].filter((v): v is string => !!v);
      const label = event === 'operations.createOperation' ? CREATED[history.kind ?? ''] ?? 'Created' : eventLabel(event);
      rows.push({ key, at: e.at, by, label, note: e.note ?? status?.note ?? null, evidence });
    } else if (e.type === 'review') {
      rows.push({ key, at: e.at, by, label: e.accepted ? 'Clean accepted' : 'Clean sent back', note: e.note ?? null, evidence: e.guestFeedback ? [`Guest feedback: ${e.guestFeedback}`] : [] });
    } else if (e.type === 'overturned') {
      rows.push({ key, at: e.at, by, label: 'Rejection overturned', note: e.note ?? null, evidence: [] });
    } else if (e.type === 'expense') {
      rows.push({ key, at: e.at, by, label: e.status === 'approved' ? 'Expense approved' : 'Expense rejected', note: e.note ?? null, evidence: [[e.supplier, e.amountMinor != null ? formatMoney(e.amountMinor) : ''].filter(Boolean).join(' · ')].filter(Boolean) });
    } else if (e.type === 'escalated') {
      rows.push({ key, at: e.at, by: null, label: 'Escalated to client relations', note: e.to ?? null, evidence: [] });
    }
  });
  return rows;
}

// Management decisions over the last 90 days, newest first.
export const decisionSchema = z.object({
  at: z.string(), area: z.enum(['repairs', 'work', 'accounts', 'cleans']), decision: z.string(), outcome: z.string().nullable(),
  title: z.string(), propertyName: z.string(), amountMinor: z.number().nullable(), by: z.string().nullable(), note: z.string().nullable(),
});
export const decisionsSchema = z.array(decisionSchema);
export type DecisionRow = z.infer<typeof decisionSchema>;
export const AREA_LABEL: Record<DecisionRow['area'], string> = { repairs: 'Maintenance', work: 'Work', accounts: 'Accounts', cleans: 'Cleans' };
const OUTCOME: Record<string, string> = {
  approved: 'Approved', declined: 'Declined', rejected: 'Rejected', upheld: 'Upheld', overturned: 'Overturned', no_action: 'No action', supervised: 'Supervised', removed_from_rota: 'Removed from the rota',
};
export const outcomeLabel = (outcome: string | null) => outcome ? OUTCOME[outcome] ?? outcome : '';
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function decisionsCsv(rows: DecisionRow[]) {
  const table = [['When', 'Area', 'Decision', 'Outcome', 'Property', 'Item', 'Amount', 'By', 'Note'],
    ...rows.map(r => [when(r.at), AREA_LABEL[r.area], r.decision, outcomeLabel(r.outcome), r.propertyName, r.title, r.amountMinor != null ? (r.amountMinor / 100).toFixed(2) : '', r.by ?? '', r.note ?? ''])];
  return '﻿' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// How long something has waited: "50 hours", then "3 days".
export function waitedLabel(since: string, now = Date.now()) {
  const hours = Math.max(0, Math.floor((now - Date.parse(since)) / 3600000));
  return hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.floor(hours / 24)} days`;
}
