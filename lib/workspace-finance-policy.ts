import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { readPayoutReport } from './payout-reconciliation';

const id = z.string().uuid();
const version = z.number().int().positive();
const money = z.number().int().min(0).max(10000000);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month');
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), 'Choose a valid date');
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const note = text(5, 2000);

export const financeReadSchema = z.object({
  section: z.enum(['overview', 'expenses', 'expense', 'reconciliation', 'statements', 'policy', 'jobs']),
  propertyId: id.optional(), period: period.optional(), id: id.optional(),
  status: z.enum(['draft', 'to_approve', 'queried', 'approved', 'rejected']).optional(),
}).strict().superRefine((value, context) => {
  if (['overview', 'reconciliation'].includes(value.section) && !value.period) context.addIssue({ code: 'custom', message: 'Choose a month' });
  if (value.section === 'expense' && !value.id) context.addIssue({ code: 'custom', message: 'Choose an expense' });
  if (value.section === 'jobs' && !value.propertyId) context.addIssue({ code: 'custom', message: 'Choose a property' });
  if (value.status && value.section !== 'expenses') context.addIssue({ code: 'custom', message: 'Status applies to expenses only' });
});

const channel = z.enum(['airbnb', 'booking_com']);
export const financeActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setFinancePolicy'), requestId: id, version, expenseApprovalLimitMinor: money.nullable() }).strict(),
  z.object({ action: z.literal('setStatementTerms'), requestId: id, propertyId: id, managementFeeBps: z.number().int().min(0).max(10000), cleaningCostMinor: z.number().int().min(0).max(1000000) }).strict(),
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
  // The uploaded CSV is parsed here; the database receives one total per reservation code.
  z.object({ action: z.literal('importPayoutReport'), requestId: id, channel, fileName: text(1, 200), csv: z.string().min(1).max(250000) }).strict(),
  z.object({ action: z.literal('agreePayout'), requestId: id, reservationId: id, version, agreedMinor: money, note }).strict(),
  z.object({ action: z.literal('setAsidePayoutLine'), requestId: id, lineId: id, note }).strict(),
  z.object({ action: z.literal('prepareStatement'), requestId: id, propertyId: id, period }).strict(),
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
]).superRefine((value, context) => {
  if (value.action === 'setReservationFinancials' && (value.channel === 'airbnb' || value.channel === 'booking_com') && !value.channelReference) context.addIssue({ code: 'custom', message: 'Add the platform reservation code' });
  if (value.action === 'addExpenseEvidence' && !value.mediaId && !value.workId && (value.note?.length ?? 0) < 10) context.addIssue({ code: 'custom', message: 'Describe the evidence you checked' });
});
export type FinanceAction = z.infer<typeof financeActionSchema>;
// Sent to workspace_accounts_action / workspace_accounts_read instead of the finance functions.
export const ACCOUNTS_ACTIONS: readonly string[] = ['attachExpensePhotos', 'linkExpenseJob', 'submitDraftExpense', 'recordPurchaseInvoice'];
export const ACCOUNTS_SECTIONS: readonly string[] = ['jobs'];

const CHANNEL_SOURCE: Record<'airbnb' | 'booking_com', string> = { airbnb: 'Airbnb', booking_com: 'Booking.com' };
export function prepareFinanceAction(input: FinanceAction): { input: unknown } | { error: string } {
  if (input.action !== 'importPayoutReport') return { input };
  const channel: 'airbnb' | 'booking_com' = input.channel;
  const report = readPayoutReport(input.csv);
  if (report.error) return { error: report.error };
  if (report.source !== 'Unknown' && report.source !== CHANNEL_SOURCE[channel]) return { error: `This looks like a ${report.source} report` };
  if (!report.rows.length) return { error: 'No reservation payouts were found in this report' };
  if (report.rows.length > 2000) return { error: 'Split reports with more than 2,000 reservations' };
  if (report.rows.some(row => Math.abs(row.amountMinor) > 100000000)) return { error: 'A payout amount is too large' };
  const rest: Omit<typeof input, 'csv'> & { csv?: string } = { ...input };
  delete rest.csv;
  return { input: { ...rest, lines: report.rows.map(row => ({ reference: row.code, amountMinor: row.amountMinor })) } };
}
