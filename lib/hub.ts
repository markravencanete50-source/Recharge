import type { JourneyView, OperationView } from './workflow-forms';
import type { HubItem } from './workspace-teams-policy';

// The hub: the business's trackers laid out like rows in a sheet. Its own rows (to-dos, approval
// tickets, AirCover claims, invoices to send) come from the hub read; the rest are worked out here
// from the work, routine plans and onboardings the app already holds.
export type HubTab = 'todos' | 'approvals' | 'purchases' | 'preventative' | 'daily' | 'aircover' | 'invoices' | 'onboarding' | 'responsibilities' | 'rota' | 'timesheets';
export const HUB_TAB_LABEL: Record<HubTab, string> = {
  todos: 'To-dos', approvals: 'Approvals', purchases: 'Purchase orders', preventative: 'Preventative', daily: 'Reviews & pricing',
  aircover: 'AirCover', invoices: 'Invoices to send', onboarding: 'Onboarding', responsibilities: 'Responsibilities', rota: 'Rota', timesheets: 'Timesheets',
};
export function hubTabsFor(role: string, keeps: readonly string[]): HubTab[] {
  const admin = role === 'admin' || role === 'super_admin';
  const tabs: HubTab[] = ['todos', 'approvals'];
  if (admin || ['stays', 'ready', 'accounts'].includes(role)) tabs.push('purchases');
  if (admin || ['stays', 'ready'].includes(role)) tabs.push('preventative');
  if (admin || role === 'stays') tabs.push('daily');
  if (keeps.includes('aircover')) tabs.push('aircover');
  if (keeps.includes('invoice')) tabs.push('invoices');
  if (admin || role === 'stays') tabs.push('onboarding');
  // Everyone on the team reads who does what and the rota, and their own timesheet.
  tabs.push('responsibilities', 'rota', 'timesheets');
  return tabs;
}

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
export const hubOpen = (i: HubItem) => ['open', 'pending', 'to_claim', 'claimed', 'to_send', 'sent'].includes(i.status);

// To-dos for one view: yours (given to you, or to your department), or everyone's for an admin.
export function todoRows(items: readonly HubItem[], filter: { userId: string; department: string | null; who: 'mine' | 'department' | 'everyone' | string }) {
  return items.filter(i => i.kind === 'todo').filter(i =>
    filter.who === 'everyone' ? true
      : filter.who === 'mine' ? i.assigneeId === filter.userId
        : filter.who === 'department' ? !!filter.department && i.department === filter.department
          : i.assigneeId === filter.who)
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || b.createdAt.localeCompare(a.createdAt));
}

const text = (v: unknown) => typeof v === 'string' ? v : '';
const num = (v: unknown) => typeof v === 'number' ? v : null;
export const PURCHASE_STAGE: Record<string, string> = { requested: 'Requested', approved: 'Approved', ordered: 'Ordered', delivered: 'Delivered' };
export function purchaseRows(work: readonly OperationView[]) {
  return work.filter(w => w.kind === 'purchase').map(w => ({
    work: w, propertyId: w.propertyId, items: text(w.data.requirements).split('\n').find(l => l.trim() && !/^From the/i.test(l)) ?? text(w.data.requirements),
    budgetMinor: num(w.data.budgetMinor), approvedMinor: num(w.data.approvedAmountMinor),
    stage: w.status === 'cancelled' ? 'Cancelled' : w.status === 'completed' && !w.data.phase ? 'Done' : PURCHASE_STAGE[text(w.data.phase)] ?? 'Requested',
    supplier: text(w.data.supplier), orderReference: text(w.data.orderReference), receivedOn: text(w.data.receivedOn) || null,
    raisedOn: w.createdAt?.slice(0, 10) ?? null,
  })).sort((a, b) => (b.raisedOn ?? '').localeCompare(a.raisedOn ?? ''));
}

// Preventative maintenance: each routine plan with its last visit and when the next is due.
export type RoutinePlan = { id: string; propertyId: string; propertyName: string; title: string; frequency: string; dayOfMonth: number; active: boolean; lastVisit: { period: string; workId: string } | null };
const monthAdd = (period: string, months: number) => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + months, 1)); return d.toISOString().slice(0, 7); };
export function nextDue(plan: RoutinePlan, today: string): string {
  const step = plan.frequency === 'quarterly' ? 3 : 1;
  const period = plan.lastVisit ? monthAdd(plan.lastVisit.period, step) : today.slice(0, 7);
  return `${period}-${String(plan.dayOfMonth).padStart(2, '0')}`;
}
export function preventativeRows(plans: readonly RoutinePlan[], work: readonly OperationView[], today: string) {
  return plans.filter(p => p.active).map(plan => {
    const visit = plan.lastVisit ? work.find(w => w.workId === plan.lastVisit!.workId) : undefined;
    const photos = Array.isArray(visit?.data.photoIds) ? (visit!.data.photoIds as unknown[]).length : 0;
    const done = visit?.status === 'completed';
    const lastOn = visit?.dueOn ?? (plan.lastVisit ? plan.lastVisit.period + '-' + String(plan.dayOfMonth).padStart(2, '0') : null);
    return { plan, visit, lastOn, done, photos, nextOn: done || !plan.lastVisit ? nextDue(plan, today) : lastOn, overdue: !done && !!lastOn && lastOn < today };
  }).sort((a, b) => (a.nextOn ?? '').localeCompare(b.nextOn ?? '') || a.plan.propertyName.localeCompare(b.plan.propertyName));
}

// Each day's guest reviews (top and bottom scores, re-listings) and pricing decisions, newest first.
export function dailyRows(work: readonly OperationView[], days: number, today: string) {
  const since = new Date(Date.parse(today + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = new Map<string, { day: string; reviews: number; top: number; bottom: number; relisted: number; changes: number; held: number; reasons: string[] }>();
  const row = (day: string) => { if (!rows.has(day)) rows.set(day, { day, reviews: 0, top: 0, bottom: 0, relisted: 0, changes: 0, held: 0, reasons: [] }); return rows.get(day)!; };
  for (const w of work) {
    if (w.kind === 'guest_review') {
      const day = text(w.data.reviewedOn) || w.createdAt?.slice(0, 10) || '';
      if (!day || day < since || day > today) continue;
      const r = row(day), rating = num(w.data.rating), outOf = num(w.data.outOf) ?? 5;
      r.reviews++;
      if (rating !== null && rating >= outOf) r.top++;
      if (rating !== null && rating <= outOf / 5) r.bottom++;
    } else if (w.kind === 'daily_pricing') {
      const day = w.createdAt?.slice(0, 10) || text(w.data.night);
      if (!day || day < since || day > today) continue;
      const r = row(day);
      if (w.data.decision === 'change') { r.changes++; if (text(w.data.reason)) r.reasons.push(text(w.data.reason)); } else r.held++;
    } else if (w.kind === 'relisting') {
      // A re-listing (after a bad review or a hidden listing) is its own piece of work.
      const day = w.createdAt?.slice(0, 10) ?? '';
      if (day && day >= since && day <= today) row(day).relisted++;
    }
  }
  return [...rows.values()].sort((a, b) => b.day.localeCompare(a.day));
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
