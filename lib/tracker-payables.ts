import { formatDay, formatMoney, plural } from './format';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, sortTracker, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { CleanerInvoice } from './accounts-live';
import type { Detail } from './work-details';

// Cleaner invoices as tracker items: the Payable side of Accounts. One row is one invoice a cleaner sent, matched
// to the cleans it covers and approved or rejected by Accounts (the 'cleanerInvoices' finance report,
// supabase/migrations/20261012090000_clean_costs_terms.sql). Steps: Invoice received, Matched to cleans, Approved,
// Paid or settled. The database holds no payment status for a cleaner invoice, so that last step is never ticked:
// it waits while the invoice does, and reads "not recorded here yet" once the invoice is decided.
//
// The section name. TrackerItem['section'] in lib/tracker.ts may not list 'payables' yet, so it is widened here;
// once it does, this cast is a no-op and can go.
export const PAYABLES_SECTION = 'payables' as string as TrackerItem['section'];

// An invoice as the report sends it. cleanerName and the per-line fields come from the database view and are optional
// here because the screen's schema may not carry them (lib/accounts-live.ts).
type InvoiceLine = NonNullable<CleanerInvoice['lines']>[number] & { propertyId?: string | null; overAgreed?: boolean; agreedMinor?: number | null };
export type PayableInvoice = Omit<CleanerInvoice, 'lines'> & { cleanerName?: string | null; lines?: InvoiceLine[] };
// canDecide: this person may approve or reject (finance roles). property gives an address from a property id when a line carries one.
export type PayablesContext = Pick<TrackerContext, 'property' | 'now' | 'owner'> & { canDecide?: boolean };

const STATUS: Record<string, { label: string; tone: TrackerTone }> = {
  to_approve: { label: 'To approve', tone: 'wait' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export const DECIDE_KEY = 'decideCleanerInvoice';

export function cleanerInvoiceTrackerItem(inv: PayableInvoice, ctx: PayablesContext): TrackerItem<PayableInvoice> {
  const owner = ctx.owner;
  const lines = inv.lines ?? [];
  const count = lines.length || inv.lineCount || 0;
  const status = STATUS[inv.status] ?? { label: text(inv.status).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) || 'Unknown', tone: 'plain' as TrackerTone };
  const approved = inv.status === 'approved', rejected = inv.status === 'rejected', waiting = !approved && !rejected, closed = !waiting;

  // Where: each distinct property on the invoice, as an address when a line carries a property id the context knows.
  const places: { id: string | null; label: string }[] = [];
  for (const line of lines) {
    const known = line.propertyId ? ctx.property(line.propertyId) : null;
    const label = addressOf(known) || text(line.propertyName);
    if (label && !places.some(p => p.label === label)) places.push({ id: line.propertyId ?? null, label });
  }
  const address = !places.length ? 'No property yet' : places.length === 1 ? places[0].label : `${places[0].label} and ${plural(places.length - 1, 'other')}`;
  const propertyId = places.length === 1 ? places[0].id : null, propertyName = places.length === 1 ? places[0].label : address;

  // An owner sees that an invoice exists and where it has got to, nothing else: no supplier, cleaner, reference, amounts or cost flags.
  const supplier = owner ? '' : text(inv.supplier), cleaner = owner ? '' : text(inv.cleanerName), reference = owner ? '' : text(inv.reference);
  const title = owner ? 'Cleaner invoice' : [supplier, reference].filter(Boolean).join(' · ') || 'Cleaner invoice';

  const received = inv.createdAt ?? inv.invoiceDate;
  const step3: TrackerStep['state'] = approved ? 'done' : rejected ? 'skipped' : count > 0 ? 'current' : 'todo';
  const steps: TrackerStep[] = [
    { key: 'received', label: 'Invoice received', state: 'done', detail: 'Dated ' + formatDay(inv.invoiceDate, ctx.now) },
    { key: 'matched', label: 'Matched to cleans', state: count > 0 ? 'done' : 'current', ...(count > 0 ? { detail: owner ? plural(count, 'clean') : `${plural(count, 'clean')}, ${formatMoney(inv.totalMinor)}` } : {}) },
    { key: 'approved', label: 'Approved', state: step3, ...(approved && inv.decidedAt ? { detail: 'Approved ' + formatDay(inv.decidedAt.slice(0, 10), ctx.now) } : rejected ? { detail: 'Rejected, so its cleans are free for a corrected invoice' } : {}), ...(waiting && ctx.canDecide && !owner ? { actionKey: DECIDE_KEY } : {}) },
    { key: 'settled', label: 'Paid or settled', state: waiting ? 'todo' : 'skipped', ...(closed ? { detail: 'Payment is not recorded here yet' } : {}) },
  ];

  const over = owner ? 0 : lines.filter(l => l.overAgreed).length;
  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  add('Supplier', supplier);
  add('Cleaner', cleaner && cleaner !== supplier ? cleaner : '');
  add('Invoice reference', reference);
  add('Invoice date', formatDay(inv.invoiceDate, ctx.now));
  if (!owner) {
    add('Invoice total', formatMoney(inv.totalMinor));
    add('Cleans', lines.map(l => [formatDay(l.cleanDate ?? null, ctx.now), text(l.propertyName), formatMoney(l.amountMinor), l.overAgreed ? 'above the agreed fee' : ''].filter(s => s && s !== '–').join(' · ')).join('\n'));
  }
  if (over) add('Cost flag', `${plural(over, 'clean')} on this invoice cost more than the owner is charged. Review them under Cleans to review.`, 'bad');
  add('Note', owner ? '' : text(inv.note));
  add(rejected ? 'Why it was rejected' : 'Decision note', owner ? '' : text(inv.decisionNote), rejected ? 'bad' : undefined);

  const update = lastUpdateOf({ updatedAt: inv.decidedAt ?? null, createdAt: received.length === 10 ? received + 'T12:00:00Z' : received });
  const forms = ctx.canDecide && !owner && waiting ? [{ key: DECIDE_KEY, title: 'Approve or reject' }] : [];
  // Nobody is named: staff read "Accounts", owners read "Recharge" (the stamp's own owner rule).
  const lastUpdate = update ? { ...update, by: owner ? null : 'Accounts' } : null;
  // What an owner's copy carries: the status and dates only. The lines keep their clean and property, with every amount and flag removed.
  const source: PayableInvoice = owner
    ? { ...inv, supplier: '', reference: '', cleanerName: null, cleanerId: null, note: null, decisionNote: null, totalMinor: 0,
      lines: lines.map(l => ({ workId: l.workId, amountMinor: 0, propertyName: l.propertyName ?? null, propertyId: l.propertyId ?? null, cleanDate: l.cleanDate ?? null })) }
    : inv;
  return {
    id: inv.id, section: PAYABLES_SECTION, source, propertyId, address, propertyName, title,
    status, closed,
    nextStep: waiting ? (count > 0 ? 'Approve or reject the invoice' : 'Match the invoice to the cleans it covers') : approved ? 'Nothing more to do here' : 'Rejected',
    nextAction: closed ? null : nextActionOf(forms, 'Accounts'),
    lastUpdate, progress: progressOf(steps), steps, details,
    search: [address, supplier, cleaner, reference, status.label, title, ...lines.map(l => text(l.propertyName))].filter(Boolean).join(' '),
  };
}

// Every invoice as a tracker item in tracker order: waiting ones first, longest without an update first.
export function cleanerInvoiceTrackerItems(invoices: readonly PayableInvoice[], ctx: PayablesContext): TrackerItem<PayableInvoice>[] {
  return sortTracker(invoices.map(inv => cleanerInvoiceTrackerItem(inv, ctx)));
}
