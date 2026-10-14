import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';

const id = z.string().uuid();
const version = z.number().int().positive();
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), 'Choose a valid date');
const text = (length: number) => z.string().trim().max(length);
const source = z.string().url().max(1000).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use a public HTTPS source');
const base = { requestId: id, propertyId: id };
export const controlsReadSchema = z.object({
  section: z.enum(['resources', 'reservations', 'events', 'notifications', 'estimate']).default('notifications'),
  propertyId: id.optional(), workId: id.optional(),
}).strict().superRefine((value, context) => {
  if (value.section !== 'notifications' && !value.propertyId) context.addIssue({ code: 'custom', message: 'Choose a property' });
  if (value.workId && value.section !== 'resources') context.addIssue({ code: 'custom', message: 'Work applies to assignment candidates only' });
});
export const estimateAssumptionsSchema = z.object({
  availableNights: z.number().int().min(1).max(366),
  occupancyBps: z.number().int().min(0).max(10000),
  directBookingBps: z.number().int().min(0).max(10000),
  otaFeeBps: z.number().int().min(0).max(10000),
  managementFeeBps: z.number().int().min(0).max(10000),
  lowRateMinor: z.number().int().min(0).max(10000000),
  mediumRateMinor: z.number().int().min(0).max(10000000),
  highRateMinor: z.number().int().min(0).max(10000000),
}).strict().refine(v => v.lowRateMinor <= v.mediumRateMinor && v.mediumRateMinor <= v.highRateMinor, 'Rate scenarios must be ordered');
export const controlsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('updateReservation'), ...base, reservationId: id, version, checkIn: date, checkOut: date, status: z.enum(['enquiry', 'confirmed', 'cancelled']) }).strict(),
  z.object({ action: z.literal('updateEvent'), ...base, eventId: id, version, name: text(200).min(2), eventOn: date, sourceUrl: source, opportunity: text(2000).min(5) }).strict(),
  z.object({ action: z.literal('archiveEvent'), ...base, eventId: id, version }).strict(),
  z.object({ action: z.literal('markNotificationRead'), requestId: id, eventId: z.string().regex(/^[1-9][0-9]{0,18}$/) }).strict(),
  // Opening Updates: everything up to the newest notice shown is read, in one request.
  z.object({ action: z.literal('markAllNotificationsRead'), requestId: id, upTo: z.string().regex(/^[1-9][0-9]{0,15}$/) }).strict(),
  z.object({ action: z.literal('saveEstimate'), ...base, version: z.number().int().min(0), assumptions: estimateAssumptionsSchema }).strict(),
  z.object({ action: z.literal('issueOperationInvoice'), ...base, workId: id, version: version.optional(), recipientId: id.optional(), reference: text(120).min(1), amountMinor: z.number().int().positive().max(10000000) }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'updateReservation' && (value.checkOut <= value.checkIn || Date.parse(value.checkOut) - Date.parse(value.checkIn) > 365 * 86400000)) context.addIssue({ code: 'custom', message: 'Choose a stay of 1 to 365 nights' });
});
export type ControlsAction = z.infer<typeof controlsActionSchema>;
