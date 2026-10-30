import { z } from 'zod';
import { HTTPS_LINK_MESSAGE, MAX_COMPARABLES, estimateRateIssues, isHttpsLink } from './journey-policy';
import { ownCostsSchema } from './estimate-projection';

// What the team saves on a lead's Estimate Delivery steps, and the lead actions, checked before they reach the database
// (migration 20261025300000 checks the same). The ticket itself is in lib/lead-estimate.ts.
export const LEAD_RADIUS_MILES = 30;
export const LEAD_STEPS = ['internal', 'external', 'local', 'revenue', 'submit'] as const;
export type LeadStep = (typeof LEAD_STEPS)[number];
// External Analysis: the comparables the consultant hand-picks, the same ceiling as a new estimate.
export const MAX_LEAD_COMPARABLES = MAX_COMPARABLES;

const text = (max: number) => z.string().trim().max(max);
const https = z.string().trim().max(1000).refine(isHttpsLink, HTTPS_LINK_MESSAGE);
const minor = z.number().int().min(0).max(10000000);
const bps = z.number().int().min(0).max(10000);
const miles = z.number().min(0).max(LEAD_RADIUS_MILES, `Only within ${LEAD_RADIUS_MILES} miles`);
export const internalRowSchema = z.object({
  propertyId: z.string().uuid(), name: text(200).min(1), miles, occupancyBps: bps.nullable().optional(), adrMinor: minor.nullable().optional(),
  revenueMinor: z.number().int().min(0).nullable().optional(), trend: text(40).optional(), note: text(500).optional(),
}).strict();
export const internalDataSchema = z.object({ rows: z.array(internalRowSchema).max(60).default([]), notes: text(5000).default(''), noLocation: z.boolean().optional() }).strict();
export const leadComparableSchema = z.object({
  name: text(160).min(1, 'Add the name'), url: https, adrMinor: minor.refine(v => v >= 0, 'Add the nightly rate'),
}).strict();
export const externalDataSchema = z.object({
  reportUrl: z.union([z.literal(''), https]).default(''), reportFileId: z.string().uuid().optional(),
  comparables: z.array(leadComparableSchema).max(MAX_COMPARABLES, `Up to ${MAX_COMPARABLES} comparables`).default([]),
  averageRateMinor: z.number().int().min(100, 'The average nightly rate must be at least £1').max(10000000).nullable().optional(), notes: text(5000).default(''),
}).strict();
export const localItemSchema = z.object({
  kind: z.enum(['event', 'repair', 'note']), id: z.string().max(60).optional(), name: text(300).min(1), on: text(40).optional(),
  miles: miles.nullable().optional(), place: text(300).optional(), note: text(500).optional(),
}).strict();
export const localDataSchema = z.object({ items: z.array(localItemSchema).max(150).default([]), notes: text(5000).default('') }).strict();
export const revenueDataSchema = z.object({
  lowRateMinor: minor.nullable().optional(), mediumRateMinor: minor.nullable().optional(), highRateMinor: minor.nullable().optional(),
  occupancyBps: bps.optional(), directBookingBps: bps.optional(), otaFeeBps: bps.optional(), managementFeeBps: bps.optional(),
  ownCosts: ownCostsSchema.optional(), comments: text(5000).default(''),
}).strict();
export const stepDataSchema = { internal: internalDataSchema, external: externalDataSchema, local: localDataSchema, revenue: revenueDataSchema } as const;
export type SavableStep = keyof typeof stepDataSchema;
export type StepData<S extends SavableStep> = z.infer<(typeof stepDataSchema)[S]>;
export const SAVABLE_STEPS = ['internal', 'external', 'local', 'revenue'] as const;
// The steps the Property Performance Manager approves: the consultant's Approve sends them instead of ticking them
// (private.workspace_lead_needs_manager, migration 20261031100000).
export const MANAGER_STEPS = ['internal'] as const;
export const needsManager = (step: string) => (MANAGER_STEPS as readonly string[]).includes(step);

// What stops a step being saved, or ticked when `done`, in plain words; null when it can go. The database checks the same.
export function leadStepIssue(step: SavableStep, data: unknown, done: boolean): string | null {
  const parsed = stepDataSchema[step].safeParse(data);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check the step’s details';
  if (!done) return null;
  if (step === 'internal') { const d = parsed.data as z.infer<typeof internalDataSchema>; return !d.rows.length && d.notes.trim().length < 3 ? 'Add a note: with no properties listed, say what the analysis is based on' : null; }
  if (step === 'external') {
    const d = parsed.data as z.infer<typeof externalDataSchema>;
    if (!d.reportUrl && !d.reportFileId) return 'Add the PriceLabs report: a link or the file';
    return typeof d.averageRateMinor === 'number' ? null : 'Enter the average nightly rate';
  }
  if (step === 'revenue') {
    const d = parsed.data as z.infer<typeof revenueDataSchema>;
    if (typeof d.lowRateMinor !== 'number' || typeof d.mediumRateMinor !== 'number' || typeof d.highRateMinor !== 'number') return 'Enter the low, medium and high nightly rates';
    if (d.lowRateMinor < 100) return 'The low nightly rate must be at least £1';
    return estimateRateIssues(d)[0]?.message ?? null;
  }
  return null;
}

// The actions (through the team route, lib/workspace-teams-policy.ts).
const id = z.string().uuid();
export const leadActionSchemas = [
  z.object({ action: z.literal('addLeadComment'), requestId: id, enquiryId: id, text: text(2000).min(1, 'Write a comment') }).strict(),
  z.object({ action: z.literal('saveLeadStep'), requestId: id, enquiryId: id, step: z.enum(SAVABLE_STEPS), data: z.record(z.unknown()), done: z.boolean() }).strict(),
  z.object({ action: z.literal('reopenLeadStep'), requestId: id, enquiryId: id, step: z.enum(LEAD_STEPS) }).strict(),
  // The Property Performance Manager approves a step sent to them, or returns it with a note (migration 20261031100000).
  z.object({ action: z.literal('approveLeadStep'), requestId: id, enquiryId: id, step: z.enum(MANAGER_STEPS) }).strict(),
  z.object({ action: z.literal('returnLeadStep'), requestId: id, enquiryId: id, step: z.enum(MANAGER_STEPS), note: text(1000).min(3, 'Say what to change (at least 3 characters)') }).strict(),
] as const;
export const LEAD_ACTIONS = ['addLeadComment', 'saveLeadStep', 'reopenLeadStep', 'approveLeadStep', 'returnLeadStep'] as const;


// The PriceLabs report as a file (lib/lead-files-server.ts): what the bucket takes, read from the file's bytes.
export const LEAD_FILE_MIMES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const LEAD_FILE_RULE = 'A PDF, Word document or picture (JPG, PNG, WebP), up to 25 MB.';
