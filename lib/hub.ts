import type { JourneyView, OperationView } from './workflow-forms';
import type { HubItem } from './workspace-teams-policy';

// The hub's labels and flows (its rows of to-dos, approval tickets, AirCover claims and invoices to send come from
// the hub read), and the purchase and onboarding rows worked out from the work and onboardings the app already holds.
export const DEPARTMENT_LABEL: Record<string, string> = {
  guest_relations: 'Guest relations', client_relations: 'Client relations', cleaning: 'Cleaning', ready: 'Ready', accounts: 'Accounts', management: 'Management',
};
export const HUB_STATUS_LABEL: Record<HubItem['status'], string> = {
  open: 'To do', done: 'Done', pending: 'Waiting', approved: 'Approved', declined: 'Declined',
  to_claim: 'To claim', claimed: 'Claimed', paid: 'Paid', to_send: 'To send', sent: 'Sent',
};
// The statuses each kind moves through, in order.
export const HUB_FLOW: Record<HubItem['kind'], HubItem['status'][]> = {
  todo: ['open', 'done'], approval: ['pending', 'approved', 'declined'], aircover: ['to_claim', 'claimed', 'paid', 'declined'], invoice: ['to_send', 'sent', 'paid'],
};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const num = (v: unknown) => typeof v === 'number' ? v : null;
export const PURCHASE_STAGE: Record<string, string> = { requested: 'Requested', approved: 'Approved', ordered: 'Ordered', delivered: 'Delivered', reconciled: 'Done' };
export function purchaseRows(work: readonly OperationView[]) {
  return work.filter(w => w.kind === 'purchase').map(w => ({
    work: w, propertyId: w.propertyId, items: text(w.data.requirements).split('\n').find(l => l.trim() && !/^From the/i.test(l)) ?? text(w.data.requirements),
    budgetMinor: num(w.data.budgetMinor), approvedMinor: num(w.data.approvedAmountMinor),
    stage: w.status === 'cancelled' ? 'Cancelled' : w.status === 'completed' && !w.data.phase ? 'Done' : PURCHASE_STAGE[text(w.data.phase)] ?? 'Requested',
    supplier: text(w.data.supplier), orderReference: text(w.data.orderReference), receivedOn: text(w.data.receivedOn) || null,
    raisedOn: w.createdAt?.slice(0, 10) ?? null,
  })).sort((a, b) => (b.raisedOn ?? '').localeCompare(a.raisedOn ?? ''));
}

// Onboarding as one row per property: where it is and what happens next.
const NEXT_STEP: Record<string, string> = {
  enquiry: 'Send the estimate', estimate: 'Owner decides on the estimate', reviewing: 'Owner decides on the estimate', agreement: 'Agreement to sign',
  form: 'Set-up form to complete', invoice: 'Onboarding invoice', inspection_to_book: 'Book the inspection', inspection_booked: 'Inspection booked',
  inspection_complete: 'Go live', live: 'Live', archived: 'Archived',
};
export function onboardingRows(journeys: readonly JourneyView[]) {
  return journeys.map(j => ({
    journey: j, propertyId: j.propertyId, stage: j.stage, next: NEXT_STEP[j.stage] ?? j.stage.replaceAll('_', ' '),
    contact: j.enquiry?.contactName ?? (j.clientId ? 'Owner account' : ''), phone: j.enquiry?.phone ?? '', email: j.enquiry?.email ?? '',
    inspectionOn: j.inspectionOn ?? null, signed: !!j.signedAt,
  })).sort((a, b) => Number(a.stage === 'live' || a.stage === 'archived') - Number(b.stage === 'live' || b.stage === 'archived'));
}
