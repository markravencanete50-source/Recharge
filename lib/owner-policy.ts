import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';

// Owner reports: confirmed bookings, nights and payouts at the owner's own properties, and their
// statement figures month by month (periods: up to 25 months, for a year against the year before).
// The only thing an owner writes is their own monthly expenses (below), which change the net figure they see.
const id = z.string().uuid();
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), 'Choose a valid date');
export const ownerReadSchema = z.object({
  section: z.enum(['bookings', 'periods']),
  from: date.optional(), to: date.optional(),
}).strict().superRefine((value, context) => {
  const days = value.section === 'periods' ? 762 : 400;
  if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
  else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > days * 86400000) context.addIssue({ code: 'custom', message: value.section === 'periods' ? 'Choose up to 25 months' : 'Choose up to 400 days' });
});
export type OwnerRead = z.infer<typeof ownerReadSchema>;

// An owner's own expense at one of their properties for a month (workspace_owner_save_expense / workspace_owner_remove_expense).
export const OWNER_EXPENSE_CATEGORIES = ['maintenance', 'utilities', 'insurance', 'supplies', 'other'] as const;
export const MAX_OWNER_EXPENSE_MINOR = 10000000;
export const ownerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveOwnerExpense'), requestId: id, propertyId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'),
    amountMinor: z.number().int().min(1).max(MAX_OWNER_EXPENSE_MINOR), category: z.enum(OWNER_EXPENSE_CATEGORIES), note: z.string().trim().max(300).optional() }).strict(),
  z.object({ action: z.literal('removeOwnerExpense'), expenseId: id }).strict(),
]);
export type OwnerAction = z.infer<typeof ownerActionSchema>;

// The response, as the screens read it.
export const ownerStaySchema = z.object({
  reservationId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), reference: z.string(),
  checkIn: z.string(), checkOut: z.string(), nights: z.number(), guests: z.number().nullable(),
  channel: z.string(), channelReference: z.string().nullable(), payoutMinor: z.number().nullable(),
});
export type OwnerStay = z.infer<typeof ownerStaySchema>;
export const ownerBookingsSchema = z.object({
  from: z.string(), to: z.string(),
  properties: z.array(z.object({ propertyId: z.string().uuid(), propertyName: z.string(), stays: z.number(), bookedNights: z.number(), payoutMinor: z.number() })),
  stays: z.array(ownerStaySchema),
});
export type OwnerBookings = z.infer<typeof ownerBookingsSchema>;
