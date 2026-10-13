import { z } from 'zod';
import { formatMoney } from './format';
import type { FinanceAction } from './workspace-finance-policy';
import type { OperationView } from './workflow-forms';

// The budget chart: the most one of each item should cost.
export const budgetChartSchema = z.array(z.object({ id: z.string().uuid(), item: z.string(), maxUnitMinor: z.number(), note: z.string(), version: z.number() }));
export type BudgetItem = z.infer<typeof budgetChartSchema>[number];

// Accepted cleans waiting to be invoiced, grouped by cleaner (most cleans first), so several can
// go on one invoice.
// With the cleaner's pay rate per clean, each group also carries the amount to invoice.
// cleanWorkId is the clean itself (the invoice task points at it); the cleaner's invoice lines name that clean.
export type CleanerTask = { workId: string; version: number; propertyId: string; propertyName: string; cleanedOn: string | null; cleanWorkId: string | null };
export type CleanerGroup = { cleanerId: string; cleanerName: string; tasks: CleanerTask[]; rateMinor?: number | null; amountMinor?: number | null };
const isWaiting = (w: OperationView) => w.kind === 'cleaning_invoice' && !['completed', 'cancelled'].includes(w.status);
export function cleanerInvoiceGroups(work: readonly OperationView[], propertyName: (id: string) => string, rates: ReadonlyMap<string, number> = new Map()): CleanerGroup[] {
  const groups = new Map<string, CleanerGroup>();
  for (const w of work) {
    if (!isWaiting(w) || typeof w.data.cleanerId !== 'string') continue;
    const g = groups.get(w.data.cleanerId) ?? { cleanerId: w.data.cleanerId, cleanerName: typeof w.data.cleanerName === 'string' && w.data.cleanerName ? w.data.cleanerName : 'Cleaner', tasks: [] };
    g.tasks.push({ workId: w.workId, version: w.version, propertyId: w.propertyId, propertyName: propertyName(w.propertyId), cleanedOn: typeof w.data.cleanedOn === 'string' ? w.data.cleanedOn : null, cleanWorkId: typeof w.data.sourceWorkId === 'string' ? w.data.sourceWorkId : null });
    groups.set(w.data.cleanerId, g);
  }
  return [...groups.values()].map(g => ({ ...g, tasks: g.tasks.sort((a, b) => (a.cleanedOn ?? '').localeCompare(b.cleanedOn ?? '')), rateMinor: rates.get(g.cleanerId) ?? null, amountMinor: rates.has(g.cleanerId) ? rates.get(g.cleanerId)! * g.tasks.length : null }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.cleanerName.localeCompare(b.cleanerName));
}

// --- Cleaner invoices (workspace_payables_action, supabase/migrations/20261012090000_clean_costs_terms.sql).
// A clean is "awaiting an invoice" while it is on no live cleaner invoice and either its accepted-clean invoice task is still open,
// or its task was closed but the clean was freed by a rejected invoice (`freed`), so a corrected invoice can cover it again.
// A closed task with no rejected invoice behind it was invoiced before cleaner invoices were recorded here, so it stays off the list.
// The invoice task is closed when the invoice is APPROVED, never when it is only recorded (mobile/src/AccountsPayable.tsx).
export type AwaitingClean = {
  cleanWorkId: string; taskWorkId: string; taskVersion: number; propertyId: string; propertyName: string;
  cleanerId: string; cleanerName: string; cleanedOn: string | null; rateMinor: number | null;
};
export function awaitingCleans(work: readonly OperationView[], propertyName: (id: string) => string, rates: ReadonlyMap<string, number> = new Map(), onInvoice: ReadonlySet<string> = new Set(), freed: ReadonlySet<string> = new Set()): AwaitingClean[] {
  const taken = new Set([...onInvoice].map(id => id.toLowerCase()));
  const released = new Set([...freed].map(id => id.toLowerCase()));
  const rows: AwaitingClean[] = [];
  for (const w of work) {
    if (w.kind !== 'cleaning_invoice' || w.status === 'cancelled' || typeof w.data.cleanerId !== 'string' || typeof w.data.sourceWorkId !== 'string') continue;
    const clean = w.data.sourceWorkId.toLowerCase(), closed = w.status === 'completed';
    if (taken.has(clean) || (closed && !released.has(clean))) continue;
    rows.push({
      cleanWorkId: w.data.sourceWorkId, taskWorkId: w.workId, taskVersion: w.version, propertyId: w.propertyId, propertyName: propertyName(w.propertyId),
      cleanerId: w.data.cleanerId, cleanerName: typeof w.data.cleanerName === 'string' && w.data.cleanerName ? w.data.cleanerName : 'Cleaner',
      cleanedOn: typeof w.data.cleanedOn === 'string' ? w.data.cleanedOn : null, rateMinor: rates.get(w.data.cleanerId) ?? null,
    });
  }
  return rows.sort((a, b) => (a.cleanedOn ?? '').localeCompare(b.cleanedOn ?? '') || a.propertyName.localeCompare(b.propertyName) || a.cleanWorkId.localeCompare(b.cleanWorkId));
}
type InvoiceLines = { status: string; lines?: readonly { workId: string; live?: boolean | undefined }[] | undefined };
// The cleans on invoices that are waiting or approved. A rejected invoice frees its cleans, and so does a line the database marks not live.
export function cleansOnLiveInvoices(invoices: readonly InvoiceLines[]): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices) if (inv.status !== 'rejected') for (const line of inv.lines ?? []) if (line.live !== false) ids.add(line.workId.toLowerCase());
  return ids;
}
// The cleans a rejected invoice let go (lines no longer live), whatever happened to their invoice task. A clean that is also on a
// live invoice is not free: awaitingCleans checks that separately.
export function cleansFreedByRejection(invoices: readonly InvoiceLines[]): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices) for (const line of inv.lines ?? []) if (inv.status === 'rejected' || line.live === false) ids.add(line.workId.toLowerCase());
  return ids;
}
// The invoice tasks to close when an invoice is approved: the still-open task of each clean on its lines, read fresh so the version is current.
export function invoiceTasksToClose(work: readonly OperationView[], invoice: { lines?: readonly { workId: string }[] | undefined }): { workId: string; version: number }[] {
  const cleans = new Set((invoice.lines ?? []).map(line => line.workId.toLowerCase()));
  return work.filter(w => isWaiting(w) && typeof w.data.sourceWorkId === 'string' && cleans.has(w.data.sourceWorkId.toLowerCase())).map(w => ({ workId: w.workId, version: w.version }));
}

export const sumMinor = (amounts: readonly number[]) => amounts.reduce((sum, n) => sum + n, 0);
// Plain words when the cleans picked do not add up to the invoice total; null when they agree (or there is nothing to compare).
export function invoiceMismatch(totalMinor: number | null, amounts: readonly number[]): string | null {
  if (totalMinor === null || !amounts.length) return null;
  const sum = sumMinor(amounts), diff = totalMinor - sum;
  if (!diff) return null;
  return `The cleans add up to ${formatMoney(sum)}, which is ${formatMoney(Math.abs(diff))} ${diff > 0 ? 'less' : 'more'} than the invoice total of ${formatMoney(totalMinor)}.`;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
type RecordInvoice = Extract<FinanceAction, { action: 'recordCleanerInvoice' }>;
type DecideInvoice = Extract<FinanceAction, { action: 'decideCleanerInvoice' }>;
type ReviewClean = Extract<FinanceAction, { action: 'reviewCleanCost' }>;
export const MAX_LINES = 200;
// The record-invoice form checked before anything is sent. Amounts are pence, or null where the text was not an amount.
export function recordInvoiceAction(input: { requestId: string; supplier: string; reference: string; invoiceDate: string; today: string; totalMinor: number | null; lines: readonly { workId: string; amountMinor: number | null }[] }): { error: string } | { action: RecordInvoice } {
  const supplier = input.supplier.trim(), reference = input.reference.trim();
  if (supplier.length < 2) return { error: 'Add the name of the cleaner or company that sent the invoice.' };
  if (!reference) return { error: 'Add the invoice reference.' };
  if (!isDate(input.invoiceDate)) return { error: 'Enter the invoice date as YYYY-MM-DD.' };
  if (input.invoiceDate > input.today) return { error: 'The invoice date cannot be in the future.' };
  if (!input.lines.length) return { error: 'Pick the cleans this invoice covers.' };
  if (input.lines.length > MAX_LINES) return { error: `An invoice covers up to ${MAX_LINES} cleans. Record the rest on a second invoice.` };
  if (input.lines.some(line => !line.amountMinor)) return { error: 'Enter the amount the invoice charges for each clean you picked.' };
  if (!input.totalMinor) return { error: 'Enter the invoice total in pounds, for example 225.00.' };
  const amounts = input.lines.map(line => line.amountMinor as number), mismatch = invoiceMismatch(input.totalMinor, amounts);
  if (mismatch) return { error: mismatch };
  return { action: { action: 'recordCleanerInvoice', requestId: input.requestId, supplier, reference, invoiceDate: input.invoiceDate, totalMinor: input.totalMinor, lines: input.lines.map(line => ({ workId: line.workId, amountMinor: line.amountMinor as number })) } };
}
// Client answer 8: a cleaner invoice is approved only once every clean on it has its clean form (the database
// refuses otherwise). formIn comes from workspace_cleaner_invoice_view; a line without it (an older server) never blocks.
export function cleansWithoutForm<L extends { live?: boolean; formIn?: boolean }>(lines: readonly L[] | null | undefined): L[] {
  return (lines ?? []).filter(line => line.live !== false && line.formIn === false);
}
export const REJECT_NOTE_MIN = 5;
export function decideInvoiceAction(input: { requestId: string; invoiceId: string; decision: 'approve' | 'reject'; note: string }): { error: string } | { action: DecideInvoice } {
  const note = input.note.trim();
  if (input.decision === 'reject' && note.length < REJECT_NOTE_MIN) return { error: 'Say why the invoice is rejected (at least 5 characters).' };
  return { action: { action: 'decideCleanerInvoice', requestId: input.requestId, invoiceId: input.invoiceId, decision: input.decision, ...(note ? { note } : {}) } };
}

// --- Cleans that cost more than the owner is charged (the 'cleansToReview' report).
export type ReviewState = 'flagged' | 'reviewed' | 'stale';
export type ChargeDecision = 'agreed_fee' | 'actual_cost';
export const REVIEW_NOTE_MIN = 5, REVIEW_NOTE_MAX = 2000;
export const DECISION_LABEL: Record<ChargeDecision, string> = { agreed_fee: 'Charge the owner the agreed fee', actual_cost: 'Charge the owner the actual cost' };
export const STALE_REVIEW_LABEL = 'Cost changed since reviewed';
type Reviewable = { state: ReviewState; decision: ChargeDecision | null; agreedMinor: number | null; actualMinor: number | null; cleanDate: string; propertyName: string };
// What the clean cost above what the owner is charged, or null when either figure is unknown.
export const overrunMinor = (c: Pick<Reviewable, 'agreedMinor' | 'actualMinor'>) => c.agreedMinor !== null && c.actualMinor !== null ? c.actualMinor - c.agreedMinor : null;
// The tag a row wears: to review, reviewed (and what was chosen) or stale.
export function reviewTag(c: Pick<Reviewable, 'state' | 'decision'>): [string, 'good' | 'wait' | 'bad'] {
  if (c.state === 'stale') return [STALE_REVIEW_LABEL, 'bad'];
  if (c.state === 'reviewed') return [c.decision === 'actual_cost' ? 'Reviewed: actual cost' : c.decision === 'agreed_fee' ? 'Reviewed: agreed fee' : 'Reviewed', 'good'];
  return ['To review', 'wait'];
}
// Flagged and stale cleans first, then the reviewed ones; each in date order.
export function splitCleansToReview<T extends Reviewable>(cleans: readonly T[]): { toReview: T[]; reviewed: T[] } {
  const byDate = (a: T, b: T) => a.cleanDate.localeCompare(b.cleanDate) || a.propertyName.localeCompare(b.propertyName);
  return { toReview: cleans.filter(c => c.state !== 'reviewed').sort(byDate), reviewed: cleans.filter(c => c.state === 'reviewed').sort(byDate) };
}
export function reviewCleanAction(input: { requestId: string; workId: string; decision: ChargeDecision | null; note: string }): { error: string } | { action: ReviewClean } {
  const note = input.note.trim();
  if (!input.decision) return { error: 'Choose what the owner is charged: the agreed fee or the actual cost.' };
  if (note.length < REVIEW_NOTE_MIN || note.length > REVIEW_NOTE_MAX) return { error: `Write a reason of ${REVIEW_NOTE_MIN} to ${REVIEW_NOTE_MAX.toLocaleString('en-GB')} characters.` };
  return { action: { action: 'reviewCleanCost', requestId: input.requestId, workId: input.workId, decision: input.decision, note } };
}
