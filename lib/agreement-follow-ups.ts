import { z } from 'zod';

// Agreement follow-ups (Business Plan v1.0, "Sign Agreement: a. Follow Up"; migration 20261027200000 checks the same). Once
// the management agreement is sent, Recharge follows up until the owner signs: automatic messages (in the app and by email)
// and personal follow-ups the team ticks off. A reply from the owner stops the automatic ones; with no answer after the last
// step the onboarding is archived. Admins change the steps on the Leads page.
export const FOLLOW_UP_CHANNELS = ['chat', 'email', 'whatsapp', 'phone'] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];
export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = { chat: 'Message in the app', email: 'Email', whatsapp: 'WhatsApp', phone: 'Phone call' };
export const FOLLOW_UP_LIMITS = { steps: 12, hours: 2160, archiveHours: 4320, message: 1000, note: 300 } as const;
export const FOLLOW_UP_PLACEHOLDERS = ['{first_name}', '{property}'] as const;

export const followUpStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto'), afterHours: z.number().int().min(1, 'Wait at least 1 hour').max(FOLLOW_UP_LIMITS.hours, 'Wait up to 90 days'),
    message: z.string().trim().min(1, 'Write the message').max(FOLLOW_UP_LIMITS.message) }).strict(),
  z.object({ kind: z.literal('personal'), afterHours: z.number().int().min(1, 'Wait at least 1 hour').max(FOLLOW_UP_LIMITS.hours, 'Wait up to 90 days') }).strict(),
]);
export type FollowUpStep = z.infer<typeof followUpStepSchema>;
export const followUpStepsSchema = z.array(followUpStepSchema).min(1, 'Add at least one step').max(FOLLOW_UP_LIMITS.steps, `Up to ${FOLLOW_UP_LIMITS.steps} steps`)
  .refine(steps => steps.some(s => s.kind === 'auto'), 'Keep at least one automatic step');

export const DEFAULT_FOLLOW_UP_STEPS: readonly FollowUpStep[] = [
  { kind: 'auto', afterHours: 24, message: "Hi {first_name}, have you had a chance to review your estimate and the management agreement for {property}? If you have any questions before going ahead, reply here and we'll be happy to help." },
  { kind: 'personal', afterHours: 24 },
  { kind: 'auto', afterHours: 48, message: "Hi {first_name}, just checking in on the management agreement for {property}. It only takes a few minutes to read and sign in the Recharge app, and we're here if anything needs explaining." },
  { kind: 'personal', afterHours: 48 },
  { kind: 'auto', afterHours: 168, message: "Hi {first_name}, your management agreement for {property} is still waiting for you. When you're ready, you can read and sign it in the Recharge app, or reply here with any questions." },
  { kind: 'auto', afterHours: 168, message: "Hi {first_name}, we haven't heard back about {property}, so we'll close your onboarding for now in a week. If you'd still like to go ahead, reply here at any time and we'll pick it up straight away." },
];
export const DEFAULT_ARCHIVE_AFTER_HOURS = 168;

const requestId = z.string().uuid();
const propertyId = z.string().uuid();
export const followUpSettingsActionSchema = z.object({
  action: z.literal('saveSettings'), requestId, steps: followUpStepsSchema,
  archiveAfterHours: z.number().int().min(1, 'Wait at least 1 hour').max(FOLLOW_UP_LIMITS.archiveHours, 'Archive within 180 days'),
}).strict();
export const followUpActionSchema = z.union([
  z.object({ action: z.literal('confirm'), requestId, propertyId, channel: z.enum(FOLLOW_UP_CHANNELS) }).strict(),
  z.object({ action: z.literal('stop'), requestId, propertyId, note: z.string().trim().max(FOLLOW_UP_LIMITS.note).optional() }).strict(),
  z.object({ action: z.literal('resume'), requestId, propertyId }).strict(),
  followUpSettingsActionSchema,
]);
export type FollowUpAction = z.infer<typeof followUpActionSchema>;

const check = z.object({ at: z.string(), by: z.string().uuid().nullable().optional() }).passthrough();
export const followUpStateSchema = z.object({
  propertyId: z.string().uuid(), status: z.enum(['running', 'stopped', 'signed', 'archived', 'ended']), reason: z.string().nullable(),
  step: z.number().int().min(0), dueAt: z.string(), startedAt: z.string(), plan: z.array(followUpStepSchema),
  archiveAfterHours: z.number().int(), checks: z.record(z.string(), check), updatedAt: z.string(),
}).passthrough();
export type FollowUpState = z.infer<typeof followUpStateSchema>;
export const followUpSettingsSchema = z.object({
  steps: z.array(followUpStepSchema), archiveAfterHours: z.number().int(), updatedAt: z.string(), updatedByName: z.string().nullable(), canEdit: z.boolean(),
}).passthrough();
export type FollowUpSettings = z.infer<typeof followUpSettingsSchema>;
export const followUpViewSchema = z.object({ settings: followUpSettingsSchema, followUp: followUpStateSchema.nullable(), stage: z.string().nullable() }).passthrough();
export type FollowUpView = z.infer<typeof followUpViewSchema>;

// "1 day", "2 days", "1 week", "36 hours": the wait as the team says it.
export function waitLabel(hours: number): string {
  if (hours % 168 === 0) return hours === 168 ? '1 week' : `${hours / 168} weeks`;
  if (hours % 24 === 0) return hours === 24 ? '1 day' : `${hours / 24} days`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// The step the sequence is on, in words: "Automatic follow-up 2", "Personal follow-up 1", or "Archive" past the last step.
export function stepLabel(plan: readonly FollowUpStep[], index: number): string {
  if (index >= plan.length) return 'Archive';
  const kind = plan[index].kind;
  const n = plan.slice(0, index + 1).filter(s => s.kind === kind).length;
  return `${kind === 'auto' ? 'Automatic' : 'Personal'} follow-up ${n}`;
}

// Fill the placeholders the way the database does, for the preview in settings.
export function fillFollowUp(message: string, firstName: string, property: string): string {
  return message.split('{first_name}').join(firstName || 'there').split('{property}').join(property || 'your property');
}
