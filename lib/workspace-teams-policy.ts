import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { enquiryInviteSchema } from './client-enquiry';
import { enquiryDetailsSchema } from './journey-policy';

const id = z.string().uuid();
export const DEPARTMENTS = ['guest_relations', 'client_relations', 'cleaning', 'ready', 'accounts', 'management'] as const;
export const HUB_KINDS = ['todo', 'approval', 'aircover', 'invoice'] as const;
export const HUB_STATUSES = ['open', 'done', 'pending', 'approved', 'declined', 'to_claim', 'claimed', 'paid', 'to_send', 'sent'] as const;
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
  section: z.enum(['schedule', 'performance', 'management', 'routines', 'training', 'onboarding', 'contracts', 'myContracts', 'shift', 'teamPerformance', 'mailbox', 'signoff', 'budgetChart', 'rota',
    'cleanerRates', 'readyHome', 'defaultCleaners', 'hub', 'responsibilities', 'rotaPlan', 'timesheet', 'favorites', 'viewAsPeople', 'productivity', 'shiftChanges', 'clientEnquiries', 'feedback']),
  from: date.optional(), to: date.optional(), propertyId: id.optional(), userId: id.optional(),
}).strict().superRefine((value, context) => {
  if (value.section === 'schedule') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the schedule dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 62 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 62 days' });
  }
  if (value.section === 'rotaPlan' || value.section === 'timesheet') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 31 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 31 days' });
  }
  if (value.section === 'productivity') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 366 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to a year' });
  }
  if (value.section === 'teamPerformance') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 92 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 92 days' });
  }
});

export const RESPONSIBILITY_FREQUENCIES = ['daily', 'weekly', 'monthly', 'as_needed'] as const;
export const ROTA_SHIFTS = ['early', 'late', 'both', 'off'] as const;
// A time of day in the UK, as HH:MM.
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:MM, for example 10:30');
const moment = z.string().datetime({ offset: true });
export const DAILY_WORK = { signOffs: 'Daily sign-off', listingChecks: 'Listing checks', pricingDecisions: 'Pricing decisions', reviewsLogged: 'Reviews logged' } as const;
const perDay = z.number().int().min(0).max(99);
export const dailyTargetsSchema = z.object({ signOffs: perDay, listingChecks: perDay, pricingDecisions: perDay, reviewsLogged: perDay }).strict();
// A saved place: the key the app opens it by ("tool:queue", "property:<id>") and its label.
export const favoriteItemSchema = z.object({ key: z.string().min(3).max(160).regex(/^[a-z]+:[A-Za-z0-9_.:-]+$/), label: z.string().trim().min(1).max(120) }).strict();
export const favoritesSchema = z.array(favoriteItemSchema).max(40);
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;
export const teamsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decideComplaint'), requestId: id, workId: id, version, outcome: z.enum(['upheld', 'overturned']), note }).strict(),
  z.object({ action: z.literal('decideCleanerReview'), requestId: id, workId: id, version, outcome: z.enum(['no_action', 'supervised', 'removed_from_rota']), note }).strict(),
  z.object({ action: z.literal('addCleanerStatement'), requestId: id, workId: id, statement: text(10, 2000) }).strict(),
  // A cleaner's pay per clean, in pence (version 0 when no rate is set yet).
  // The hub's rows: to-dos, approval tickets, AirCover claims and invoices to send.
  z.object({ action: z.literal('saveHubItem'), requestId: id, id: id.optional(), version: version.optional(), kind: z.enum(HUB_KINDS), title: text(2, 200),
    details: z.string().trim().max(3000).optional(), propertyId: id.nullable().optional(), assigneeId: id.nullable().optional(), department: z.enum(DEPARTMENTS).nullable().optional(),
    dueOn: date.nullable().optional(), amountMinor: z.number().int().min(0).max(10000000).nullable().optional(), link: https.nullable().optional(),
    reference: z.string().trim().max(120).optional() }).strict(),
  z.object({ action: z.literal('moveHubItem'), requestId: id, id, version, status: z.enum(HUB_STATUSES), note: z.string().trim().max(2000).optional(),
    settledMinor: z.number().int().min(0).max(10000000).optional() }).strict(),
  // The responsibilities register, kept by admins.
  z.object({ action: z.literal('saveResponsibility'), requestId: id, id: id.optional(), version: version.optional(), department: z.enum(DEPARTMENTS), title: text(2, 200),
    details: z.string().trim().max(3000).optional(), ownerId: id.nullable(), backupId: id.nullable(), frequency: z.enum(RESPONSIBILITY_FREQUENCIES) }).strict(),
  z.object({ action: z.literal('removeResponsibility'), requestId: id, id, version }).strict(),
  // Each person's own Favorites (saved pages, tools, properties and work), in their order.
  z.object({ action: z.literal('saveFavorites'), items: z.array(favoriteItemSchema).max(40) }).strict(),
  z.object({ action: z.literal('startViewAs'), userId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('stopViewAs') }).strict(),
  // The rota by date (a null shift clears the day), and corrected or forgotten shifts.
  z.object({ action: z.literal('planRota'), requestId: id, userId: id, days: z.array(z.object({ day: date, shift: z.enum(ROTA_SHIFTS).nullable(),
    department: z.enum(DEPARTMENTS).optional(), note: z.string().trim().max(300).optional() }).strict()).min(1).max(31) }).strict(),
  z.object({ action: z.literal('editShift'), requestId: id, shiftId: id, clockedInAt: moment, clockedOutAt: moment.nullable(), department: z.enum(DEPARTMENTS).optional(), note: text(3, 500) }).strict(),
  z.object({ action: z.literal('addShift'), requestId: id, userId: id, clockedInAt: moment, clockedOutAt: moment, department: z.enum(DEPARTMENTS), note: text(3, 500) }).strict(),
  // An admin's change to someone's hours waits for a super admin, who approves or declines it (with
  // a reason); the admin who asked can withdraw it while it waits.
  z.object({ action: z.literal('decideShiftChange'), requestId: id, changeId: id, decision: z.enum(['approve', 'decline']), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('withdrawShiftChange'), requestId: id, changeId: id }).strict(),
  // Client Enquiries: send the property form (the server adds the link and sends the email), send a
  // fresh link, value the property from the answers, or close the enquiry.
  enquiryInviteSchema.extend({ action: z.literal('inviteEnquiry'), requestId: id }).strict(),
  enquiryInviteSchema.omit({ name: true, email: true }).extend({ action: z.literal('resendEnquiry'), requestId: id, enquiryId: id, version }).strict(),
  z.object({ action: z.literal('startValuing'), requestId: id, enquiryId: id, version, name: text(2, 200), address: text(5, 1000), region: z.string().trim().max(200).default(''),
    propertyType: text(2, 120), bedrooms: z.number().int().min(0).max(40), bathrooms: z.number().int().min(0).max(40), enquiry: enquiryDetailsSchema }).strict(),
  z.object({ action: z.literal('closeEnquiry'), requestId: id, enquiryId: id, version, note: text(3, 500) }).strict(),
  // The day and time of a piece of work on the calendar (no start time: any time that day).
  z.object({ action: z.literal('setWorkTime'), requestId: id, workId: id, version, dueOn: date, startTime: clockTime.nullable(), endTime: clockTime.nullable() }).strict(),
  // A property's usual cleaner, who gets its cleans automatically (null clears it).
  z.object({ action: z.literal('setDefaultCleaner'), requestId: id, propertyId: id, cleanerId: id.nullable() }).strict(),
  z.object({ action: z.literal('setCleanerRate'), requestId: id, cleanerId: id, rateMinor: z.number().int().min(1).max(100000), version: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('saveRoutinePlan'), requestId: id, planId: id.optional(), version: version.optional(), propertyId: id,
    moduleId: z.enum(['routine-bin-garden-board', 'safety-maintenance', 'ready-schedule']), title: text(2, 200),
    checklist: z.array(text(1, 200)).min(1).max(30), frequency: z.enum(['monthly', 'quarterly']), dayOfMonth: z.number().int().min(1).max(28),
    assigneeId: id.nullable().optional(), active: z.boolean() }).strict(),
  z.object({ action: z.literal('generateRoutineVisits'), requestId: id, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month') }).strict(),
  z.object({ action: z.literal('saveCourse'), requestId: id, courseId: id.optional(), version: version.optional(), title: text(2, 200),
    audience: z.array(z.enum(['all', 'super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'])).min(1).max(9),
    summary: z.string().trim().max(1000).optional(), body: text(10, 50000), videoUrl: https.optional(), minutes: z.number().int().min(1).max(600), published: z.boolean(),
    // Ask everyone who completed it to do it again (for a real change to the course).
    redoRequired: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('completeCourse'), requestId: id, courseId: id }).strict(),
  // Staff onboarding: admins write the contracts and choose required courses; team members sign.
  z.object({ action: z.literal('saveContract'), requestId: id, contractId: id.optional(), version: version.optional(), title: text(2, 200),
    audience: z.array(z.enum(CONTRACT_AUDIENCES)).min(1).max(6), body: text(20, 100000), active: z.boolean(), resignRequired: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('setCourseRequired'), requestId: id, courseId: id, required: z.boolean() }).strict(),
  // Deleting: a course goes with its completions and files; a signed agreement is taken out of use
  // and kept on record for whoever signed it, an unsigned one goes completely.
  z.object({ action: z.literal('deleteCourse'), requestId: id, courseId: id, version }).strict(),
  z.object({ action: z.literal('deleteContract'), requestId: id, contractId: id, version }).strict(),
  // Shifts and team performance targets.
  z.object({ action: z.literal('clockIn'), requestId: id, department: z.enum(DEPARTMENTS) }).strict(),
  z.object({ action: z.literal('saveRota'), requestId: id, userId: id, department: z.enum(DEPARTMENTS), usualShift: z.enum(['early', 'late', 'both']) }).strict(),
  z.object({ action: z.literal('saveBudgetItem'), requestId: id, id: id.optional(), version: version.optional(), item: z.string().trim().min(2).max(120), maxUnitMinor: z.number().int().min(1).max(10000000), note: z.string().trim().max(500).default('') }).strict(),
  z.object({ action: z.literal('removeBudgetItem'), requestId: id, id, version }).strict(),
  z.object({ action: z.literal('signOffDay'), requestId: id, allVisible: z.literal(true), reviewsHandled: z.literal(true), suspensionsHandled: z.literal(true), relistingsDone: z.literal(true), note: z.string().trim().max(2000).default('') }).strict(),
  z.object({ action: z.literal('clockOut'), requestId: id }).strict(),
  // While clocked in: pause for lunch, a break or an emergency, go back to work, or switch to overtime.
  z.object({ action: z.literal('startPause'), requestId: id, kind: z.enum(['lunch', 'break', 'emergency']), note: z.string().trim().max(200).optional() }).strict(),
  z.object({ action: z.literal('endPause'), requestId: id }).strict(),
  z.object({ action: z.literal('startOvertime'), requestId: id }).strict(),
  // Admins: whether each kind of pause counts as paid time.
  z.object({ action: z.literal('savePausePolicy'), requestId: id, lunchPaid: z.boolean(), breakPaid: z.boolean(), emergencyPaid: z.boolean(), version: z.number().int().positive() }).strict(),
  // Team feedback: admins and Stays send it; super admins mark it seen or done and reply.
  z.object({ action: z.literal('sendFeedback'), requestId: id, category: z.enum(['idea', 'problem', 'praise', 'other']), message: text(5, 2000) }).strict(),
  z.object({ action: z.literal('updateFeedback'), requestId: id, feedbackId: id, version, status: z.enum(['new', 'seen', 'done']), reply: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal('closeShift'), requestId: id, shiftId: id, endedAt: z.string().datetime({ offset: true }), note: text(3, 500).optional() }).strict(),
  z.object({ action: z.literal('saveTargets'), requestId: id, version, greenMinutes: z.number().int().min(1).max(120), amberMinutes: z.number().int().min(2).max(240),
    passPercent: z.number().int().min(1).max(100), bonusPercents: z.array(z.number().int().min(1).max(100)).max(5),
    // How much daily work counts in the score (0-100%), and what's expected on each Stays shift day.
    workWeight: z.number().int().min(0).max(100).optional(), dailyTargets: dailyTargetsSchema.optional() }).strict(),
  z.object({ action: z.literal('signContract'), requestId: id, contractId: id, version, signedName: text(2, 200), agree: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree to the contract' }) }) }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'saveFavorites' && new Set(value.items.map(i => i.key)).size !== value.items.length) context.addIssue({ code: 'custom', message: 'Each favorite once' });
  if (value.action === 'saveRoutinePlan' && Boolean(value.planId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a plan needs its current version' });
  if (value.action === 'saveHubItem' && Boolean(value.id) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing needs the current version' });
  if (value.action === 'saveHubItem' && value.kind === 'approval' && value.amountMinor == null) context.addIssue({ code: 'custom', message: 'Add the amount to approve' });
  if (value.action === 'saveResponsibility' && Boolean(value.id) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing needs the current version' });
  if (value.action === 'saveResponsibility' && value.ownerId && value.ownerId === value.backupId) context.addIssue({ code: 'custom', message: 'The backup must be someone else' });
  if (value.action === 'setWorkTime' && value.endTime && (!value.startTime || value.endTime <= value.startTime)) context.addIssue({ code: 'custom', message: 'The end time must be after the start time' });
  if ((value.action === 'editShift' || value.action === 'addShift') && value.clockedOutAt && Date.parse(value.clockedOutAt) <= Date.parse(value.clockedInAt)) context.addIssue({ code: 'custom', message: 'The shift must end after it starts' });
  if (value.action === 'decideShiftChange' && value.decision === 'decline' && (value.note ?? '').length < 3) context.addIssue({ code: 'custom', message: 'Say why it is declined' });
  if (value.action === 'saveCourse' && Boolean(value.courseId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a course needs its current version' });
  if (value.action === 'saveTargets' && value.amberMinutes <= value.greenMinutes) context.addIssue({ code: 'custom', message: 'Amber must be longer than green' });
  if (value.action === 'saveContract' && Boolean(value.contractId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a contract needs its current version' });
});
export type TeamsAction = z.infer<typeof teamsActionSchema>;

export const defaultCleanersSchema = z.object({
  properties: z.array(z.object({ propertyId: id, propertyName: z.string(), cleanerId: id.nullable(), cleanerName: z.string().nullable(), canEdit: z.boolean() })),
  cleaners: z.array(z.object({ userId: id, fullName: z.string(), propertyIds: z.array(id) })),
});
export type DefaultCleaners = z.infer<typeof defaultCleanersSchema>;

export const hubItemSchema = z.object({
  id, kind: z.enum(HUB_KINDS), title: z.string(), details: z.string(), propertyId: id.nullable(), propertyName: z.string().nullable(),
  assigneeId: id.nullable(), assigneeName: z.string().nullable(), department: z.enum(DEPARTMENTS).nullable(), dueOn: z.string().nullable(),
  amountMinor: z.number().nullable(), settledMinor: z.number().nullable(), link: z.string().nullable(), reference: z.string(),
  status: z.enum(HUB_STATUSES), outcomeNote: z.string(), decidedBy: z.string().nullable(), decidedAt: z.string().nullable(),
  createdBy: id, createdByName: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), version: z.number(),
});
export const hubSchema = z.object({
  department: z.enum(DEPARTMENTS).nullable(), canDecide: z.boolean(), keeps: z.array(z.enum(HUB_KINDS)), items: z.array(hubItemSchema),
  people: z.array(z.object({ userId: id, fullName: z.string(), role: z.string(), department: z.enum(DEPARTMENTS).nullable() })),
});
export type HubItem = z.infer<typeof hubItemSchema>;
export type Hub = z.infer<typeof hubSchema>;

const person = { userId: id, fullName: z.string(), role: z.string(), department: z.enum(DEPARTMENTS).nullable() };
export const responsibilitiesSchema = z.object({
  canEdit: z.boolean(),
  items: z.array(z.object({ id, department: z.enum(DEPARTMENTS), title: z.string(), details: z.string(), frequency: z.enum(RESPONSIBILITY_FREQUENCIES),
    ownerId: id.nullable(), ownerName: z.string().nullable(), backupId: id.nullable(), backupName: z.string().nullable(), updatedAt: z.string(), version: z.number() })),
  people: z.array(z.object(person)),
});
export type Responsibilities = z.infer<typeof responsibilitiesSchema>;
export type Responsibility = Responsibilities['items'][number];

const rotaDay = z.object({ day: z.string(), shift: z.enum(ROTA_SHIFTS), department: z.enum(DEPARTMENTS).nullable(), note: z.string() });
export const rotaPlanSchema = z.object({
  from: z.string(), to: z.string(), canEdit: z.boolean(),
  people: z.array(z.object({ ...person, usualShift: z.enum(['early', 'late', 'both']).nullable(), days: z.array(rotaDay) })),
});
export type RotaPlan = z.infer<typeof rotaPlanSchema>;

// A change to someone's hours: asked for by an admin and waiting for a super admin (pending),
// approved, declined, withdrawn, or made by a super admin directly (direct).
export const SHIFT_CHANGE_STATUSES = ['pending', 'approved', 'declined', 'withdrawn', 'direct'] as const;
const hours = { clockedInAt: z.string(), clockedOutAt: z.string().nullable(), department: z.enum(DEPARTMENTS) };
export const shiftChangeSchema = z.object({
  id, kind: z.enum(['edit', 'add', 'close']), status: z.enum(SHIFT_CHANGE_STATUSES), shiftId: id.nullable(), userId: id, fullName: z.string().nullable(),
  ...hours, before: z.object(hours).nullable(), note: z.string(),
  requestedBy: id, requestedByName: z.string().nullable(), requestedAt: z.string(),
  decidedBy: id.nullable(), decidedByName: z.string().nullable(), decidedAt: z.string().nullable(), decisionNote: z.string(),
});
export type ShiftChange = z.infer<typeof shiftChangeSchema>;
export const shiftChangesSchema = z.object({ canApprove: z.boolean(), me: id, pending: z.array(shiftChangeSchema), recent: z.array(shiftChangeSchema) });
export type ShiftChanges = z.infer<typeof shiftChangesSchema>;

// Hours per person for a period, by week (each starting on its Monday) and by month (YYYY-MM).
const tally = { minutes: z.number(), shifts: z.number(), days: z.number(), overtime: z.number().default(0) };
export const productivitySchema = z.object({
  from: z.string(), to: z.string(), canEdit: z.boolean(), canApprove: z.boolean(), pending: z.number(),
  people: z.array(z.object({ ...person, active: z.boolean(), onShift: z.boolean(), ...tally, overtimeMinutes: z.number().default(0),
    weeks: z.array(z.object({ start: z.string(), ...tally })), months: z.array(z.object({ month: z.string(), ...tally })) })),
});
export type Productivity = z.infer<typeof productivitySchema>;
export type ProductivityPerson = Productivity['people'][number];

export const timesheetSchema = z.object({
  from: z.string(), to: z.string(), canEdit: z.boolean(), canApprove: z.boolean().default(false), pending: z.array(shiftChangeSchema).default([]),
  people: z.array(z.object({ ...person, active: z.boolean(), totalMinutes: z.number(),
    days: z.array(z.object({ day: z.string(), planned: rotaDay.omit({ day: true }).nullable(), minutes: z.number(),
      shifts: z.array(z.object({ id, department: z.enum(DEPARTMENTS), clockedInAt: z.string(), clockedOutAt: z.string().nullable(), minutes: z.number(), edited: z.boolean(), editNote: z.string(),
        overtimeFrom: z.string().nullable().default(null), unpaidMinutes: z.number().default(0),
        pauses: z.array(z.object({ kind: z.enum(['lunch', 'break', 'emergency']), startedAt: z.string(), endedAt: z.string().nullable() })).default([]) })) })) })),
});
export type Timesheet = z.infer<typeof timesheetSchema>;
export type TimesheetPerson = Timesheet['people'][number];
