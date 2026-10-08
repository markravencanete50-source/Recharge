import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';

const id = z.string().uuid();
export const DEPARTMENTS = ['guest_relations', 'client_relations', 'cleaning', 'ready', 'accounts', 'management'] as const;
export const CONTRACT_AUDIENCES = ['all', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'] as const;
const version = z.number().int().positive();
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), 'Choose a valid date');
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const note = text(5, 2000);
const https = z.string().url().max(1000).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use a public HTTPS link');

export const teamsReadSchema = z.object({
  section: z.enum(['schedule', 'performance', 'management', 'routines', 'training', 'onboarding', 'contracts', 'shift', 'teamPerformance', 'mailbox', 'signoff', 'budgetChart', 'rota']),
  from: date.optional(), to: date.optional(), propertyId: id.optional(), userId: id.optional(),
}).strict().superRefine((value, context) => {
  if (value.section === 'schedule') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the schedule dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 62 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 62 days' });
  }
  if (value.section === 'teamPerformance') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 92 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 92 days' });
  }
});

export const teamsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decideComplaint'), requestId: id, workId: id, version, outcome: z.enum(['upheld', 'overturned']), note }).strict(),
  z.object({ action: z.literal('decideCleanerReview'), requestId: id, workId: id, version, outcome: z.enum(['no_action', 'supervised', 'removed_from_rota']), note }).strict(),
  z.object({ action: z.literal('addCleanerStatement'), requestId: id, workId: id, statement: text(10, 2000) }).strict(),
  z.object({ action: z.literal('saveRoutinePlan'), requestId: id, planId: id.optional(), version: version.optional(), propertyId: id,
    moduleId: z.enum(['routine-bin-garden-board', 'safety-maintenance', 'ready-schedule']), title: text(2, 200),
    checklist: z.array(text(1, 200)).min(1).max(30), frequency: z.enum(['monthly', 'quarterly']), dayOfMonth: z.number().int().min(1).max(28),
    assigneeId: id.nullable().optional(), active: z.boolean() }).strict(),
  z.object({ action: z.literal('generateRoutineVisits'), requestId: id, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month') }).strict(),
  z.object({ action: z.literal('saveCourse'), requestId: id, courseId: id.optional(), version: version.optional(), title: text(2, 200),
    audience: z.array(z.enum(['all', 'super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'])).min(1).max(9),
    summary: z.string().trim().max(1000).optional(), body: text(10, 50000), videoUrl: https.optional(), minutes: z.number().int().min(1).max(600), published: z.boolean() }).strict(),
  z.object({ action: z.literal('completeCourse'), requestId: id, courseId: id }).strict(),
  // Staff onboarding: admins write the contracts and choose required courses; team members sign.
  z.object({ action: z.literal('saveContract'), requestId: id, contractId: id.optional(), version: version.optional(), title: text(2, 200),
    audience: z.array(z.enum(CONTRACT_AUDIENCES)).min(1).max(6), body: text(20, 100000), active: z.boolean(), resignRequired: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('setCourseRequired'), requestId: id, courseId: id, required: z.boolean() }).strict(),
  // Shifts and team performance targets.
  z.object({ action: z.literal('clockIn'), requestId: id, department: z.enum(DEPARTMENTS) }).strict(),
  z.object({ action: z.literal('saveRota'), requestId: id, userId: id, department: z.enum(DEPARTMENTS), usualShift: z.enum(['early', 'late', 'both']) }).strict(),
  z.object({ action: z.literal('saveBudgetItem'), requestId: id, id: id.optional(), version: version.optional(), item: z.string().trim().min(2).max(120), maxUnitMinor: z.number().int().min(1).max(10000000), note: z.string().trim().max(500).default('') }).strict(),
  z.object({ action: z.literal('removeBudgetItem'), requestId: id, id, version }).strict(),
  z.object({ action: z.literal('signOffDay'), requestId: id, allVisible: z.literal(true), reviewsHandled: z.literal(true), suspensionsHandled: z.literal(true), relistingsDone: z.literal(true), note: z.string().trim().max(2000).default('') }).strict(),
  z.object({ action: z.literal('clockOut'), requestId: id }).strict(),
  z.object({ action: z.literal('closeShift'), requestId: id, shiftId: id, endedAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('saveTargets'), requestId: id, version, greenMinutes: z.number().int().min(1).max(120), amberMinutes: z.number().int().min(2).max(240),
    passPercent: z.number().int().min(1).max(100), bonusPercents: z.array(z.number().int().min(1).max(100)).max(5) }).strict(),
  z.object({ action: z.literal('signContract'), requestId: id, contractId: id, version, signedName: text(2, 200), agree: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree to the contract' }) }) }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'saveRoutinePlan' && Boolean(value.planId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a plan needs its current version' });
  if (value.action === 'saveCourse' && Boolean(value.courseId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a course needs its current version' });
  if (value.action === 'saveTargets' && value.amberMinutes <= value.greenMinutes) context.addIssue({ code: 'custom', message: 'Amber must be longer than green' });
  if (value.action === 'saveContract' && Boolean(value.contractId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a contract needs its current version' });
});
export type TeamsAction = z.infer<typeof teamsActionSchema>;
