import { z } from 'zod';
import { formatDay, formatMoney } from './format';
import { nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerForm } from './tracker-sections';
import { poundsToMinor } from './repairs-live';
import type { TeamsAction } from './workspace-teams-policy';
import type { Detail } from './work-details';

// Accounts receivable as tracker items. One row is one invoice from the hub (kind 'invoice') that is
// still to send or sent and not yet paid, read through the 'receivable' finance report
// (supabase/migrations/20261012110000_receivable.sql). Steps: Invoice to send, Sent, Settled.
const id = z.string().uuid();
const minor = z.number().int();

export const receivableItemSchema = z.object({
  itemId: id, version: z.number(), title: z.string(), reference: z.string(), details: z.string(), status: z.enum(['to_send', 'sent']),
  propertyId: id.nullable(), propertyName: z.string().nullable(), address: z.string().nullable(),
  amountMinor: minor.nullable(), settledMinor: minor, outstandingMinor: minor,
  createdAt: z.string(), updatedAt: z.string(), dueOn: z.string().nullable(), overdue: z.boolean(), ageDays: z.number(), sentOn: z.string().nullable(), link: z.string().nullable(),
  reservationId: id.nullable(), stayReference: z.string().nullable(), checkIn: z.string().nullable(), checkOut: z.string().nullable(),
  clientId: id.nullable(), clientName: z.string().nullable(),
}).passthrough();
export type ReceivableItem = z.infer<typeof receivableItemSchema>;

// A direct booking with no invoice linked yet, suggested as "Needs an invoice". totalMinor is the stay's total where it is known.
export const needsInvoiceSchema = z.object({
  reservationId: id, propertyId: id, propertyName: z.string().nullable(), address: z.string().nullable(), stayReference: z.string().nullable(),
  checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), totalMinor: minor.nullable(),
}).passthrough();
export type NeedsInvoice = z.infer<typeof needsInvoiceSchema>;

export const receivableReportSchema = z.object({
  toSend: z.array(receivableItemSchema), toSettle: z.array(receivableItemSchema), needsInvoice: z.array(needsInvoiceSchema),
  totals: z.object({ toSendMinor: minor, toSettleMinor: minor, toSendCount: z.number(), toSettleCount: z.number(), needsInvoiceCount: z.number() }),
  options: z.object({
    clients: z.array(z.object({ clientId: id, name: z.string(), propertyIds: z.array(id) })),
    stays: z.array(z.object({ reservationId: id, propertyId: id, propertyName: z.string().nullable(), stayReference: z.string().nullable(), channel: z.string(), checkIn: z.string(), checkOut: z.string(), invoiced: z.boolean() })),
  }),
}).passthrough();
export type ReceivableReport = z.infer<typeof receivableReportSchema>;

// The section name. TrackerItem['section'] lives in lib/tracker.ts and does not list it yet, so it is widened here,
// in one place. Once the union gains 'receivable' this can be a plain literal.
export const RECEIVABLE_SECTION = 'receivable' as string as TrackerItem['section'];

const STEPS = [
  { key: 'to_send', label: 'Invoice to send' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Settled' },
];

// What a person can do to an invoice here. The keys are handled by the Receivable screen.
export const MARK_SENT = 'markSent';
export const RECORD_PAYMENT = 'recordPayment';
export const EDIT_INVOICE = 'editInvoice';
export function receivableForms(row: Pick<ReceivableItem, 'status'>): TrackerForm[] {
  return [
    row.status === 'to_send' ? { key: MARK_SENT, title: 'Mark sent' } : { key: RECORD_PAYMENT, title: 'Record payment' },
    { key: EDIT_INVOICE, title: 'Edit invoice' },
  ];
}

const text = (v: string | null | undefined) => (v ?? '').trim();
const days = (n: number) => n === 1 ? '1 day' : `${n} days`;

export type ReceivableContext = { now: Date; owner?: boolean };

export function receivableTrackerItem(row: ReceivableItem, ctx: ReceivableContext): TrackerItem<ReceivableItem> {
  const sent = row.status === 'sent';
  // An owner sees that an invoice exists and where it has got to, nothing else: no amounts, invoice number, client, notes or link.
  const owner = !!ctx.owner;
  const client = owner ? '' : text(row.clientName), reference = owner ? '' : text(row.reference);
  const propertyName = text(row.propertyName), address = text(row.address) || propertyName || client || 'No property';
  const detailOf = (i: number) => {
    if (i === 0) return 'Raised ' + formatDay(row.createdAt, ctx.now);
    if (i === 1 && row.sentOn) return 'Sent ' + formatDay(row.sentOn, ctx.now);
    return undefined;
  };
  // An invoice to send is at its first step; a sent one has done two and waits for payment at the last.
  const states: TrackerStep['state'][] = sent ? ['done', 'done', 'current'] : ['current', 'todo', 'todo'];
  const steps: TrackerStep[] = STEPS.map((s, i) => {
    const detail = states[i] === 'todo' ? undefined : detailOf(i);
    return { key: s.key, label: s.label, state: states[i], ...(detail ? { detail } : {}) };
  });
  const partlyPaid = sent && row.settledMinor > 0;
  const status: { label: string; tone: TrackerTone } = !sent ? { label: 'To send', tone: row.overdue ? 'bad' : 'wait' }
    : row.overdue ? { label: 'Overdue', tone: 'bad' } : partlyPaid ? { label: 'Part paid', tone: 'wait' } : { label: 'Sent', tone: 'plain' };
  const owed = row.amountMinor === null ? 'No amount' : formatMoney(row.outstandingMinor);
  const title = owner ? 'Invoice' : [sent && partlyPaid ? `${owed} still owed` : owed, reference, client].filter(Boolean).join(' · ');
  const forms = receivableForms(row);
  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  if (!owner) {
    add('Invoice number', reference);
    add('Invoice', row.title);
    add('Amount', row.amountMinor !== null ? formatMoney(row.amountMinor) : '');
    if (sent) { add('Paid so far', formatMoney(row.settledMinor)); add('Still owed', owed, row.outstandingMinor > 0 && row.overdue ? 'bad' : undefined); }
  }
  add(sent ? 'Payment due' : 'Send by', row.dueOn ? formatDay(row.dueOn, ctx.now) + (row.overdue ? ' (overdue)' : '') : '', row.overdue ? 'bad' : undefined);
  add('For', client);
  if (!owner) add('Stay', [text(row.stayReference), row.checkIn && row.checkOut ? `${formatDay(row.checkIn, ctx.now)} to ${formatDay(row.checkOut, ctx.now)}` : ''].filter(Boolean).join(', '));
  add('Property', propertyName);
  add(sent ? 'Sent' : 'Waiting', sent ? (row.sentOn ? `${formatDay(row.sentOn, ctx.now)}, ${days(row.ageDays)} ago` : '') : `${days(row.ageDays)} since it was raised`);
  if (!owner) { add('Link', text(row.link)); add('Notes', text(row.details)); }
  // An owner's copy of the row carries none of the money, numbers, client or notes either.
  const source: ReceivableItem = owner
    ? { ...row, title: 'Invoice', reference: '', details: '', link: null, amountMinor: null, settledMinor: 0, outstandingMinor: 0, clientId: null, clientName: null, stayReference: null }
    : row;
  return {
    id: row.itemId, section: RECEIVABLE_SECTION, source, propertyId: row.propertyId, address, propertyName: propertyName || address,
    title, status, closed: false,
    nextStep: sent ? (client ? `Payment from ${client}` : 'Payment from the client') : 'Send the invoice',
    nextAction: nextActionOf(forms.filter(f => f.key !== EDIT_INVOICE), sent ? 'the client' : 'Accounts'),
    lastUpdate: { at: row.updatedAt, by: ctx.owner ? null : 'Accounts', what: null },
    progress: progressOf(steps), steps, details, version: row.version,
    search: [address, propertyName, title, owner ? '' : row.title, reference, client, owner ? '' : text(row.stayReference), status.label].filter(Boolean).join(' '),
  };
}

// Open invoices, oldest due date first (the report already orders them; this keeps the screen stable if it changes).
export function receivableTrackerItems(rows: readonly ReceivableItem[], ctx: ReceivableContext): TrackerItem<ReceivableItem>[] {
  return rows.map(r => receivableTrackerItem(r, ctx));
}

// A payment against an invoice. settledMinor is the total received so far, so the new payment is added to what was already paid.
// The invoice is settled when the total reaches its amount (or it has no amount); otherwise it stays Sent with a part payment.
export function paymentMove(row: Pick<ReceivableItem, 'amountMinor' | 'settledMinor' | 'outstandingMinor'>, paidMinor: number): { status: 'sent' | 'paid'; settledMinor: number } | { error: string } {
  if (!Number.isInteger(paidMinor) || paidMinor <= 0) return { error: 'Enter the amount received, in pounds, for example 450.00.' };
  const total = row.settledMinor + paidMinor;
  if (row.amountMinor !== null && total > row.amountMinor) return { error: `That is more than the ${formatMoney(row.outstandingMinor)} still owed.` };
  return { status: row.amountMinor === null || total >= row.amountMinor ? 'paid' : 'sent', settledMinor: total };
}

export type InvoiceValues = { title: string; amount: string; reference: string; dueOn: string; propertyId: string; reservationId: string; clientId: string; details?: string; link?: string | null };
type SaveHubItem = Omit<Extract<TeamsAction, { action: 'saveHubItem' }>, 'requestId'>;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;

// The Record invoice form as a saveHubItem action (kind invoice), or the reason it cannot be sent. Every link is sent every
// time (null clears it), because saving a hub row replaces its property and link. When a stay is chosen the property comes from it.
export function invoiceAction(values: InvoiceValues, editing?: { id: string; version: number }): { error: string } | { action: SaveHubItem } {
  const title = values.title.trim(), amountMinor = poundsToMinor(values.amount), dueOn = values.dueOn.trim(), reference = values.reference.trim();
  if (title.length < 2) return { error: 'Say what the invoice is for.' };
  if (amountMinor === null || amountMinor <= 0 || amountMinor > 10000000) return { error: 'Enter the amount in pounds, for example 450.00.' };
  if (reference.length > 120) return { error: 'The invoice number is too long.' };
  if (dueOn && !isDay(dueOn)) return { error: 'Enter the date as year-month-day, for example 2026-11-30.' };
  return { action: {
    action: 'saveHubItem', kind: 'invoice', ...(editing ? { id: editing.id, version: editing.version } : {}), title, amountMinor, reference,
    details: (values.details ?? '').trim(), dueOn: dueOn || null, link: values.link ?? null,
    propertyId: values.reservationId ? null : values.propertyId || null, reservationId: values.reservationId || null, clientId: values.clientId || null,
  } };
}

// The suggestion row's prefilled form: the stay, its total and a plain title.
export function invoiceFromStay(stay: Pick<NeedsInvoice, 'reservationId' | 'propertyId' | 'stayReference' | 'checkIn' | 'checkOut' | 'totalMinor'>): InvoiceValues {
  return {
    title: `Direct stay ${text(stay.stayReference)}, ${stay.checkIn} to ${stay.checkOut}`.replace(/\s+,/, ','), amount: stay.totalMinor !== null ? (stay.totalMinor / 100).toFixed(2) : '',
    reference: '', dueOn: '', propertyId: stay.propertyId, reservationId: stay.reservationId, clientId: '',
  };
}
