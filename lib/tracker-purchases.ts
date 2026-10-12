import { formatDay, formatMoney } from './format';
import { PURCHASE_STAGE, purchaseRows } from './hub';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { OperationView } from './workflow-forms';

// A purchase order as tracker steps. `data.phase` runs requested, approved, ordered, delivered,
// reconciled (supabase/migrations/20261010180000_team_beta_owner_steps.sql). Recording the supplier
// invoice does not move the phase: it sits inside the last step, before the reconcile.
const PHASES = ['requested', 'approved', 'ordered', 'delivered', 'reconciled'];
const STEPS = [
  { key: 'requested', label: 'Requested', actionKey: undefined },
  { key: 'approved', label: 'Budget approved', actionKey: 'approvePurchase' },
  { key: 'ordered', label: 'Ordered', actionKey: 'recordOrder' },
  { key: 'delivered', label: 'Delivered', actionKey: 'recordDelivery' },
  { key: 'reconciled', label: 'Checked against invoice', actionKey: 'recordPurchaseInvoice' },
];
// What is needed after each phase, and which team it waits on: Accounts, Accounts, Ready, Accounts.
const NEXT = [
  { step: 'Budget approval', waitingOn: 'Accounts' },
  { step: 'Place the order', waitingOn: 'Accounts' },
  { step: 'Delivery', waitingOn: 'Ready' },
  { step: 'Check against the supplier invoice', waitingOn: 'Accounts' },
];
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';

export function purchaseTrackerItem(work: OperationView, ctx: TrackerContext): TrackerItem<OperationView> {
  const row = purchaseRows([work])[0], property = ctx.property(work.propertyId);
  const address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const cancelled = work.status === 'cancelled', done = work.status === 'completed', closed = cancelled || done;
  // How many steps have been reached. A completed purchase with no phase is an old one: all done.
  const reached = done ? STEPS.length - 1 : Math.max(0, PHASES.indexOf(text(work.data.phase)));
  const available = ctx.forms(work);
  const invoiceKey = ['recordPurchaseInvoice', 'reconcilePurchase'].find(k => available.some(f => f.key === k && !f.unavailable)) ?? 'recordPurchaseInvoice';
  const detailOf = (i: number) => {
    if (i === 0) return row.raisedOn ? 'Raised ' + formatDay(row.raisedOn, ctx.now) : undefined;
    if (i === 1) return row.approvedMinor !== null ? 'Approved ' + formatMoney(row.approvedMinor) : undefined;
    if (i === 2) return [row.supplier, row.orderReference && 'ref ' + row.orderReference].filter(Boolean).join(', ') || undefined;
    if (i === 3) return row.receivedOn ? 'Received ' + formatDay(row.receivedOn, ctx.now) : undefined;
    return undefined;
  };
  const steps: TrackerStep[] = STEPS.map((s, i) => {
    const state: TrackerStep['state'] = i <= reached ? 'done' : i === reached + 1 && !closed ? 'current' : 'todo';
    const detail = state === 'done' ? detailOf(i) : undefined, actionKey = i === 4 ? invoiceKey : s.actionKey;
    return { key: s.key, label: s.label, state, ...(detail ? { detail } : {}), ...(actionKey ? { actionKey } : {}) };
  });
  const next = NEXT[Math.min(reached, NEXT.length - 1)];
  const tone: TrackerTone = cancelled ? 'bad' : done ? 'good' : 'wait';
  // A cancelled or finished purchase is named here; any other stage comes from PURCHASE_STAGE.
  const stage = cancelled ? 'Cancelled' : done ? 'Done' : PURCHASE_STAGE[text(work.data.phase)] ?? 'Requested';
  const title = row.items.trim() || work.title || 'Purchase request';
  const details: Detail[] = [];
  const add = (label: string, value: string) => { if (value) details.push({ label, value }); };
  add('Items', text(work.data.requirements));
  add('Budget', row.budgetMinor !== null ? formatMoney(row.budgetMinor) : '');
  add('Approved amount', row.approvedMinor !== null ? formatMoney(row.approvedMinor) : '');
  add('Supplier', row.supplier);
  add('Order reference', row.orderReference);
  add('Received on', row.receivedOn ? formatDay(row.receivedOn, ctx.now) : '');
  const update = lastUpdateOf(work);
  return {
    id: work.workId, section: 'purchases', source: work, propertyId: work.propertyId || null, address, propertyName, title,
    status: { label: stage, tone }, closed,
    nextStep: cancelled ? 'Cancelled' : done ? 'Nothing more to do' : next.step,
    nextAction: closed ? null : nextActionOf(available, next.waitingOn),
    // Owners never see who made the change, even if the data carried a name.
    lastUpdate: update && ctx.owner ? { ...update, by: null } : update,
    progress: progressOf(steps), steps, details, workId: work.workId, version: work.version,
    search: [address, propertyName, title, stage, closed ? '' : next.step, row.supplier, row.orderReference, text(work.data.requirements)].filter(Boolean).join(' '),
  };
}
