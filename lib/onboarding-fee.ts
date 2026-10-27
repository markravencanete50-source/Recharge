import { z } from 'zod';

// The onboarding fee (Business Plan v1.0, "Onboarding Fee"; migration 20261027300000 checks the same). Signing the agreement
// opens the fee as an invoice to send in Accounts > Receivable; it goes through the usual steps there. While it is sent and not
// settled the owner is reminded every 48 hours; settling it releases the onboarding package's tasks. Admins set the fee, the
// reminders and the four messages to the owner.
export const FEE_LIMITS = { hours: 2160, message: 1000, maxMinor: 100000000 } as const;
export const FEE_PLACEHOLDERS = ['{first_name}', '{property}', '{amount}', '{amount_text}'] as const;
export const FEE_MESSAGES = [
  { key: 'signedMessage', label: 'When the agreement is signed (app and email)' },
  { key: 'sentMessage', label: 'When accounts send the invoice (app)' },
  { key: 'reminderMessage', label: 'Payment reminder (app and email)' },
  { key: 'settledMessage', label: 'When the fee is settled (app and email)' },
] as const;
export type FeeMessageKey = (typeof FEE_MESSAGES)[number]['key'];
export const DEFAULT_FEE_REMINDER_HOURS = 48;

const message = z.string().trim().min(1, 'Write each message').max(FEE_LIMITS.message);
export const feeSettingsActionSchema = z.object({
  action: z.literal('saveSettings'), requestId: z.string().uuid(),
  amountMinor: z.number().int().min(0).max(FEE_LIMITS.maxMinor, 'Enter a fee up to £1,000,000').nullable(),
  remindersOn: z.boolean(), reminderHours: z.number().int().min(1, 'Remind every 1 hour to 90 days').max(FEE_LIMITS.hours, 'Remind every 1 hour to 90 days'),
  signedMessage: message, sentMessage: message, reminderMessage: message, settledMessage: message,
}).strict();
export type FeeSettingsAction = z.infer<typeof feeSettingsActionSchema>;

export const feeSettingsSchema = z.object({
  amountMinor: z.number().int().nullable(), remindersOn: z.boolean(), reminderHours: z.number().int(),
  signedMessage: z.string(), sentMessage: z.string(), reminderMessage: z.string(), settledMessage: z.string(),
  updatedAt: z.string(), updatedByName: z.string().nullable(), canEdit: z.boolean(),
}).passthrough();
export type FeeSettings = z.infer<typeof feeSettingsSchema>;
export const feeStateSchema = z.object({
  propertyId: z.string().uuid(), itemId: z.string().uuid(), status: z.enum(['to_send', 'sent', 'paid']), title: z.string(), reference: z.string(),
  amountMinor: z.number().int().nullable(), settledMinor: z.number().int(), openedAt: z.string(), sentAt: z.string().nullable(),
  lastReminderAt: z.string().nullable(), reminders: z.number().int(), settledAt: z.string().nullable(), released: z.number().int(),
  held: z.array(z.object({ title: z.string(), releasedAt: z.string().nullable() }).passthrough()),
}).passthrough();
export type FeeState = z.infer<typeof feeStateSchema>;
export const feeViewSchema = z.object({ settings: feeSettingsSchema, fee: feeStateSchema.nullable() }).passthrough();
export type FeeView = z.infer<typeof feeViewSchema>;

// Where the fee is, in the plan's colours: orange while accounts prepare or wait for it, green once settled.
export function feeStage(fee: Pick<FeeState, 'status' | 'settledAt'>): { label: string; tone: 'wait' | 'good' } {
  if (fee.settledAt || fee.status === 'paid') return { label: 'Settled', tone: 'good' };
  return fee.status === 'sent' ? { label: 'Invoice sent, waiting for payment', tone: 'wait' } : { label: 'Invoice being prepared by accounts', tone: 'wait' };
}

// When the next payment reminder goes, or null when none is due (not sent yet, settled, or reminders off).
export function nextReminder(fee: Pick<FeeState, 'status' | 'settledAt' | 'lastReminderAt'>, settings: Pick<FeeSettings, 'remindersOn' | 'reminderHours'>): Date | null {
  if (!settings.remindersOn || fee.settledAt || fee.status !== 'sent' || !fee.lastReminderAt) return null;
  return new Date(Date.parse(fee.lastReminderAt) + settings.reminderHours * 3600000);
}
