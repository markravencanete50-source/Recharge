import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { MAX_PAYOUT_CSV_CHARS, MAX_PAYOUT_LINES, PAYOUT_UPLOAD_BODY_LIMIT, readPayoutLines } from './payout-reconciliation';
import { RECONCILED_CHANNELS } from './payout-report-formats';

const id = z.string().uuid();
const version = z.number().int().positive();
const money = z.number().int().min(0).max(10000000);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month');
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), 'Choose a valid date');
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const note = text(5, 2000);
export const CLEAN_CHARGE_MODES = ['agreed_fee', 'actual_cost'] as const;
export const STATEMENT_METHODS = ['nights', 'check_in_month'] as const;
// A statement period is any dates, up to a year; to is the first day not included.
export const MAX_STATEMENT_DAYS = 366;
// The most cleans one supplier invoice carries, and its largest total in pence.
export const MAX_INVOICE_LINES = 200;
const invoiceMoney = z.number().int().min(1).max(100000000);
// The most stays one bulk approval carries; the screen sends longer lists in several requests.
export const BULK_PAYOUT_LIMIT = 500;
// The largest payout report (characters and coded lines) and the finance route's body limit for it: see lib/payout-reconciliation.ts.
export { MAX_PAYOUT_CSV_CHARS, MAX_PAYOUT_LINES, PAYOUT_UPLOAD_BODY_LIMIT };
const reconciled = (value: string) => (RECONCILED_CHANNELS as readonly string[]).includes(value);

// Report sections are read through workspace_finance_report (from and to dates, filters), not workspace_finance_read.
// A section whose database function comes from a later migration answers 'needs a database update' until that is applied.
export const REPORT_SECTIONS: readonly string[] = ['payoutLines', 'cleansToReview', 'cleanerInvoices', 'receivable', 'performance', 'statementPreview'];
// The filters each report accepts besides its dates, the property (propertyId) and one record (id). Any other is refused.
export const REPORT_FILTERS: Record<string, readonly ('channel' | 'region' | 'reportId' | 'state' | 'status' | 'cleanerId' | 'method')[]> = {
  payoutLines: ['channel', 'reportId', 'state'],
  cleansToReview: ['region', 'state'],
  cleanerInvoices: ['region', 'status', 'cleanerId'],
  statementPreview: ['method'],
  receivable: ['region', 'channel'],
  performance: ['region', 'channel'],
};
// Every platform a stay can come from; payout lines are held for the reconciled platforms only.
export const STAY_CHANNELS = ['airbnb', 'booking_com', 'vrbo', 'direct', 'other'] as const;
export const financeReadSchema = z.object({
  section: z.enum(['overview', 'expenses', 'expense', 'reconciliation', 'statements', 'policy', 'jobs', 'payoutLines', 'cleansToReview', 'cleanerInvoices', 'receivable', 'performance', 'statementPreview']),
  propertyId: id.optional(), period: period.optional(), id: id.optional(),
  status: z.enum(['draft', 'to_approve', 'queried', 'approved', 'rejected']).optional(),
  from: date.optional(), to: date.optional(), channel: z.enum(STAY_CHANNELS).optional(), region: text(1, 80).optional(),
  // Payout lines report: one upload, and active, set aside or with no confirmed stay.
  reportId: id.optional(), state: z.enum(['active', 'setAside', 'noConfirmedStay', 'toReview', 'reviewed', 'all']).optional(),
  // Cleaner invoices: one cleaner. Statement preview: how the period is worked out.
  cleanerId: id.optional(), method: z.enum(STATEMENT_METHODS).optional(),
}).strict().superRefine((value, context) => {
  if (['overview', 'reconciliation'].includes(value.section) && !value.period) context.addIssue({ code: 'custom', message: 'Choose a month' });
  const report = REPORT_SECTIONS.includes(value.section);
  if (!report && (value.from || value.to || value.channel || value.region || value.reportId || value.state || value.cleanerId || value.method)) context.addIssue({ code: 'custom', message: 'Dates and filters apply to reports only' });
  if (report && value.period) context.addIssue({ code: 'custom', message: 'Reports take from and to dates' });
  if (report) {
    const accepted = REPORT_FILTERS[value.section] ?? [];
    for (const name of ['channel', 'region', 'reportId', 'state', 'status', 'cleanerId', 'method'] as const) if (value[name] && !accepted.includes(name)) context.addIssue({ code: 'custom', message: 'This report does not take that filter' });
    if (value.section === 'payoutLines' && value.channel && !reconciled(value.channel)) context.addIssue({ code: 'custom', message: 'Payout lines are held for Airbnb, Booking.com and Vrbo' });
  }
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: 'custom', message: 'The start date must be on or before the end date' });
  if (value.section === 'expense' && !value.id) context.addIssue({ code: 'custom', message: 'Choose an expense' });
  if (value.section === 'jobs' && !value.propertyId) context.addIssue({ code: 'custom', message: 'Choose a property' });
  if (value.status && value.section !== 'expenses' && value.section !== 'cleanerInvoices') context.addIssue({ code: 'custom', message: 'Status applies to expenses and cleaner invoices only' });
});

// The platforms whose payout reports are reconciled. A stay on one of them needs the platform's reservation code.
const channel = z.enum(RECONCILED_CHANNELS);
export const financeActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setFinancePolicy'), requestId: id, version, expenseApprovalLimitMinor: money.nullable() }).strict(),
  // Repairs above this also need an admin's approval; null switches it off.
  z.object({ action: z.literal('setRepairApprovalLimit'), requestId: id, version, managementRepairLimitMinor: money.nullable() }).strict(),
  // vatOnFee: VAT is charged on the management fee. cleanChargeMode: owners pay the agreed cleaning value or what each clean cost.
  z.object({ action: z.literal('setStatementTerms'), requestId: id, propertyId: id, managementFeeBps: z.number().int().min(0).max(10000), cleaningCostMinor: z.number().int().min(0).max(1000000),
    vatOnFee: z.boolean().optional(), cleanChargeMode: z.enum(CLEAN_CHARGE_MODES).optional() }).strict(),
  z.object({ action: z.literal('setReservationFinancials'), requestId: id, propertyId: id, reservationId: id, version,
    channel: z.enum(['airbnb', 'booking_com', 'vrbo', 'direct', 'other']), channelReference: text(1, 120).optional(),
    guests: z.number().int().min(1).max(50).nullable().optional(), payoutMinor: money.nullable().optional() }).strict(),
  z.object({ action: z.literal('createExpense'), requestId: id, propertyId: id, workId: id.optional(), supplier: text(2, 200), reference: text(1, 120),
    category: z.enum(['maintenance', 'property_setup', 'cleaning_supplies', 'utilities', 'furnishing', 'other']), description: text(5, 3000),
    amountMinor: money.min(1), receivedOn: date, source: z.enum(['manual', 'email']), sender: text(3, 320).optional() }).strict(),
  z.object({ action: z.literal('addExpenseEvidence'), requestId: id, expenseId: id, kind: z.enum(['invoice', 'photo', 'quote', 'report']), label: text(2, 200),
    mediaId: id.optional(), workId: id.optional(), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal('approveExpense'), requestId: id, expenseId: id, version, note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal('queryExpense'), requestId: id, expenseId: id, version, note }).strict(),
  z.object({ action: z.literal('resolveExpenseQuery'), requestId: id, expenseId: id, version, note: text(5, 1000) }).strict(),
  z.object({ action: z.literal('rejectExpense'), requestId: id, expenseId: id, version, note }).strict(),
  // The uploaded CSV is parsed here (prepareFinanceAction); the database receives every coded line with its key.
  z.object({ action: z.literal('importPayoutReport'), requestId: id, channel, fileName: text(1, 200), csv: z.string().min(1).max(MAX_PAYOUT_CSV_CHARS, 'This report is too large. Split it into parts of up to 8,000 lines') }).strict(),
  z.object({ action: z.literal('agreePayout'), requestId: id, reservationId: id, version, agreedMinor: money, note }).strict(),
  // Approve many stays at once (the Payouts list's "Approve all"). The database works out each amount: the expected payout for a
  // stay not paid yet, the amount received for one paid a different amount, which is only included when asked for.
  z.object({ action: z.literal('agreePayouts'), requestId: id, note: text(5, 1900), includeDifferent: z.boolean().optional(),
    items: z.array(z.object({ reservationId: id, version }).strict()).min(1).max(BULK_PAYOUT_LIMIT) }).strict(),
  // Set a payout line aside (for example a stay cancelled after payout); `note` is the reason.
  z.object({ action: z.literal('setAsidePayoutLine'), requestId: id, lineId: id, note }).strict(),
  // One month (period) or any dates (from, and to which is the first day not included), never both. method says how a stay is shared between periods.
  z.object({ action: z.literal('prepareStatement'), requestId: id, propertyId: id, period: period.optional(), from: date.optional(), to: date.optional(), method: z.enum(STATEMENT_METHODS).optional() }).strict(),
  z.object({ action: z.literal('issueStatement'), requestId: id, statementId: id, version }).strict(),
  z.object({ action: z.literal('recordOwnerPayout'), requestId: id, statementId: id, version, method: z.enum(['bank_transfer', 'stripe']), reference: text(3, 120) }).strict(),
  z.object({ action: z.literal('voidStatement'), requestId: id, statementId: id, version, reason: note }).strict(),
  // Expense paperwork and purchase invoices (workspace_accounts_action).
  z.object({ action: z.literal('attachExpensePhotos'), requestId: id, expenseId: id, kind: z.enum(['invoice', 'photo', 'quote', 'report']), label: text(2, 180),
    mediaIds: z.array(id).min(1).max(20), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal('linkExpenseJob'), requestId: id, expenseId: id, version, workId: id.nullable() }).strict(),
  z.object({ action: z.literal('submitDraftExpense'), requestId: id, expenseId: id, version, supplier: text(2, 200), reference: text(1, 120),
    amountMinor: money.min(1), receivedOn: date, description: text(5, 3000) }).strict(),
  z.object({ action: z.literal('recordPurchaseInvoice'), requestId: id, purchaseId: id, reference: text(1, 100), amountMinor: money.min(1), paid: z.boolean() }).strict(),
  // Cleaner and supplier invoices, and the review of what a clean cost (workspace_payables_action).
  // The total must equal the lines; each line is the amount charged for one clean.
  z.object({ action: z.literal('recordCleanerInvoice'), requestId: id, cleanerId: id.optional(), supplier: text(2, 200), reference: text(1, 120), invoiceDate: date, totalMinor: invoiceMoney,
    lines: z.array(z.object({ workId: id, amountMinor: money.min(1) }).strict()).min(1).max(MAX_INVOICE_LINES), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal('decideCleanerInvoice'), requestId: id, invoiceId: id, version: version.optional(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal('reviewCleanCost'), requestId: id, workId: id, decision: z.enum(CLEAN_CHARGE_MODES), note: text(5, 2000) }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'setReservationFinancials' && reconciled(value.channel) && !value.channelReference) context.addIssue({ code: 'custom', message: 'Add the platform reservation code' });
  if (value.action === 'recordCleanerInvoice') {
    if (value.lines.reduce((sum, line) => sum + line.amountMinor, 0) !== value.totalMinor) context.addIssue({ code: 'custom', message: 'The lines must add up to the invoice total' });
    if (new Set(value.lines.map(line => line.workId)).size !== value.lines.length) context.addIssue({ code: 'custom', message: 'Each clean can appear once on an invoice' });
  }
  if (value.action === 'decideCleanerInvoice' && value.decision === 'reject' && (value.note?.length ?? 0) < 5) context.addIssue({ code: 'custom', message: 'Say why the invoice is rejected' });
  if (value.action === 'prepareStatement') {
    const range = value.from || value.to;
    if (value.period && range) context.addIssue({ code: 'custom', message: 'Choose a month or a date range, not both' });
    else if (!value.period && !(value.from && value.to)) context.addIssue({ code: 'custom', message: range ? 'Choose both the first day and the day it ends' : 'Choose a month or a date range' });
    else if (value.from && value.to) {
      const days = (Date.parse(value.to + 'T00:00:00Z') - Date.parse(value.from + 'T00:00:00Z')) / 86400000;
      if (days <= 0) context.addIssue({ code: 'custom', message: 'The statement must end after it starts' });
      else if (days > MAX_STATEMENT_DAYS) context.addIssue({ code: 'custom', message: 'A statement covers up to 366 days' });
    }
  }
  if (value.action === 'addExpenseEvidence' && !value.mediaId && !value.workId && (value.note?.length ?? 0) < 10) context.addIssue({ code: 'custom', message: 'Describe the evidence you checked' });
});
export type FinanceAction = z.infer<typeof financeActionSchema>;
// Sent to workspace_accounts_action / workspace_accounts_read instead of the finance functions.
export const ACCOUNTS_ACTIONS: readonly string[] = ['attachExpensePhotos', 'linkExpenseJob', 'submitDraftExpense', 'recordPurchaseInvoice'];
export const ACCOUNTS_SECTIONS: readonly string[] = ['jobs'];
// Sent to workspace_payables_action.
export const PAYABLES_ACTIONS: readonly string[] = ['recordCleanerInvoice', 'decideCleanerInvoice', 'reviewCleanCost'];

// Largest amount on one payout line, in pence (the database checks the same).
export const MAX_PAYOUT_LINE_MINOR = 100_000_000;
// The finance route reads a request body up to this size. Only the finance roles can upload payout reports (the database
// checks the same), so only they get the larger limit; every other action is far smaller and keeps the old one.
export const FINANCE_BODY_LIMIT = 300_000;
const PAYOUT_UPLOAD_ROLES: readonly string[] = ['accounts', 'admin', 'super_admin'];
export const financeBodyLimit = (account: { role: string }) => PAYOUT_UPLOAD_ROLES.includes(account.role) ? PAYOUT_UPLOAD_BODY_LIMIT : FINANCE_BODY_LIMIT;
// Reads the uploaded report on the server and sends the database { action, requestId, channel, fileName, lines }:
// one entry per coded line of the file (see PayoutLine in lib/payout-reconciliation.ts), never the CSV itself.
export function prepareFinanceAction(input: FinanceAction): { input: unknown } | { error: string } {
  if (input.action !== 'importPayoutReport') return { input };
  const report = readPayoutLines(input.csv, input.channel);
  if (report.error) return { error: report.error };
  if (!report.lines.length) {
    const { noCode, noAmount } = report.skipped;
    const why = [noCode ? `${noCode} row${noCode === 1 ? '' : 's'} had no reservation code` : '', noAmount ? `${noAmount} row${noAmount === 1 ? '' : 's'} had no net amount` : ''].filter(Boolean).join(' and ');
    return { error: 'No reservation payouts were found in this report' + (why ? `: ${why}.` : '') };
  }
  if (report.lines.length > MAX_PAYOUT_LINES) return { error: 'Split reports with more than 8,000 payout lines' };
  const amounts = report.lines.flatMap(line => [line.amountMinor, line.grossMinor, line.commissionMinor, line.hostFeeMinor, line.paymentFeeMinor, line.cleaningFeeMinor]);
  if (amounts.some(minor => minor !== null && Math.abs(minor) > MAX_PAYOUT_LINE_MINOR)) return { error: 'A payout amount is too large' };
  return { input: { action: input.action, requestId: input.requestId, channel: input.channel, fileName: input.fileName, lines: report.lines } };
}
