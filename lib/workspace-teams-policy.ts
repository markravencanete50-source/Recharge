import { z } from 'zod';
import { parseAnalyticsDate } from './analytics';
import { enquiryInviteSchema } from './client-enquiry';
import { enquiryDetailsSchema } from './journey-policy';
import { MENU_ROLES, menuLayoutSchema } from './menu-layout';
import { leadActionSchemas, leadStepIssue } from './lead-policy';

const id = z.string().uuid();
export const DEPARTMENTS = ['guest_relations', 'client_relations', 'cleaning', 'ready', 'accounts', 'management'] as const;
export const HUB_KINDS = ['todo', 'approval', 'aircover', 'invoice'] as const;
// A to-do's priority, as in ClickUp (migration 20261025100000); none is allowed.
export const TODO_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export const TODO_PRIORITY_LABEL: Record<(typeof TODO_PRIORITIES)[number], string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
// The reactions on a to-do's comments: the chat's eight.
export const TODO_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '✅'] as const;
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

// The business reports, read through workspace_business_report (lib/workspace-finance-server.ts).
export const BUSINESS_REPORT_SECTIONS = ['reportEnquiries', 'reportRepairs', 'reportTodos', 'reportMessages', 'reportTime'] as const;
export const BUSINESS_REPORT_KIND = { reportEnquiries: 'enquiries', reportRepairs: 'repairs', reportTodos: 'todos', reportMessages: 'messages', reportTime: 'time' } as const satisfies Record<(typeof BUSINESS_REPORT_SECTIONS)[number], string>;
export const teamsReadSchema = z.object({
  section: z.enum(['schedule', 'performance', 'management', 'routines', 'training', 'onboarding', 'contracts', 'myContracts', 'shift', 'teamPerformance', 'mailbox', 'signoff', 'budgetChart', 'rota',
    'cleanerRates', 'readyHome', 'defaultCleaners', 'hub', 'responsibilities', 'rotaPlan', 'timesheet', 'favorites', 'viewAsPeople', 'productivity', 'shiftChanges', 'clientEnquiries', 'feedback', 'chatReports',
    // Client feedback build, October 2026: management flags, day reflections, daily to-dos, AirCover claims, team calendar.
    'flags', 'reflection', 'reflections', 'dailyTasks', 'aircover', 'teamEvents',
    // Menu order (Access control → Menu order): your own role's, and every role's for super admins.
    'menuLayout', 'menuLayouts',
    // Round 5: the KPI tracker (20261015100000).
    'kpis',
    // Management's Home: guest replies on time this month and the same days of last month (20261020910000).
    'guestReplies',
    // Each role's Home (20261021300000): the caller's own counts and figures; `role` is the role an admin previews.
    'roleHome',
    // Business reports for admins (20261020860000): enquiries, repairs and spend, to-dos, messages, time worked.
    ...BUSINESS_REPORT_SECTIONS,
    // Reports > Guests & stays (20261021600000), admins only: optionally one property and one channel.
    'stayAnalytics',
    // Its two switches (20261021800000), admins only: ask guests why they stay, and the survey after direct stays.
    'stayReasonSettings',
    // Cleaner invoices (20261022000000): invoices (userId: one cleaner), one invoice (invoiceId), a cleaner's earnings
    // (userId, else the cleaner's own) and the cleaners' rates and pay periods. Read through workspace_cleaner_pay_read.
    'payInvoices', 'payInvoice', 'payEarnings', 'paySettings',
    // VA pay (20261022200000): who may see it, the requests for invoice (userId: one VA), one request (invoiceId) and the
    // VAs' pay setup. Read through workspace_va_pay_read, which decides who sees what.
    'vaPayAccess', 'vaPayRequests', 'vaPayRequest', 'vaPaySetup',
    // Property ratings (20261022500000): every visible property's guest ratings, or one property's (propertyId) in full.
    // Read through workspace_property_ratings, which decides who sees which properties (owners are refused for now).
    'propertyRatings',
    // A lead's ticket (20261025300000): the enquiry, its checklist, Estimate Delivery steps and activity (enquiryId).
    'lead']),
  from: date.optional(), to: date.optional(), propertyId: id.optional(), userId: id.optional(), invoiceId: id.optional(), enquiryId: id.optional(),
  channel: z.enum(['airbnb', 'booking_com', 'vrbo', 'direct', 'other']).optional(),
  role: z.enum(['stays', 'cleaning_manager', 'cleans', 'ready', 'accounts']).optional(),
}).strict().superRefine((value, context) => {
  if (value.channel && value.section !== 'stayAnalytics') context.addIssue({ code: 'custom', message: 'A channel is only for Guests & stays' });
  if (value.invoiceId && value.section !== 'payInvoice' && value.section !== 'vaPayRequest') context.addIssue({ code: 'custom', message: 'An invoice is only for one cleaner invoice or one request for invoice' });
  if ((value.section === 'payInvoice' || value.section === 'vaPayRequest') && !value.invoiceId) context.addIssue({ code: 'custom', message: 'Choose an invoice' });
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
  if (value.section === 'reflections') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 31 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 31 days' });
  }
  if (value.section === 'teamEvents') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 62 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 62 days' });
  }
  if ((value.section === 'lead') !== !!value.enquiryId) context.addIssue({ code: 'custom', message: value.enquiryId ? 'A lead is read on its own' : 'Choose a lead' });
  if ((BUSINESS_REPORT_SECTIONS as readonly string[]).includes(value.section) || value.section === 'stayAnalytics') {
    if (!value.from || !value.to) context.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (value.to < value.from || Date.parse(value.to) - Date.parse(value.from) > 365 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to 366 days' });
  }
  if (value.section === 'teamPerformance' || value.section === 'kpis') {
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
// Management flags: anyone on the team can flag work or a hub item (or ask management something free-standing);
// admins resolve or decline; the person who raised it can withdraw it. The 'clean_form' source is raised only
// by the database sweep, never by a person.
export const FLAG_SOURCES = ['work', 'hub', 'request'] as const;
export const FLAG_DECISIONS = ['resolved', 'declined'] as const;
// Team calendar entries: your own absences, meetings and so on. Owners never see them.
export const TEAM_EVENT_KINDS = ['absence', 'meeting', 'away', 'training', 'other'] as const;
// Day of the week as the database counts it: 1 is Monday and 7 is Sunday (ISO).
export const WEEKDAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;
const reflectionNote = z.string().trim().max(2000);
// One thing the person says they got done today (a ticket, a to-do, a guest reply...). The label is the words they see.
export const reflectionItemSchema = z.object({ kind: z.string().trim().min(1).max(40), ref: z.string().trim().max(80).nullable().optional(), label: text(1, 200) }).strict();
export const visitAnswerSchema = z.object({ item: text(1, 200), done: z.boolean(), note: z.string().trim().max(500).optional() }).strict();
// The KPI measure keys (private.workspace_kpi_measures() holds their labels, directions and areas).
export const KPI_MEASURES = ['guest_reply_within', 'guest_reply_over', 'daily_work_done', 'performance_score', 'clean_forms_on_time', 'teams_combined'] as const;
const kpiPercent = z.number().int().min(0).max(100);
export const teamsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decideComplaint'), requestId: id, workId: id, version, outcome: z.enum(['upheld', 'overturned']), note }).strict(),
  z.object({ action: z.literal('decideCleanerReview'), requestId: id, workId: id, version, outcome: z.enum(['no_action', 'supervised', 'removed_from_rota']), note }).strict(),
  z.object({ action: z.literal('addCleanerStatement'), requestId: id, workId: id, statement: text(10, 2000) }).strict(),
  // A cleaner's pay per clean, in pence (version 0 when no rate is set yet).
  // The hub's rows: to-dos, approval tickets, AirCover claims and invoices to send.
  z.object({ action: z.literal('saveHubItem'), requestId: id, id: id.optional(), version: version.optional(), kind: z.enum(HUB_KINDS), title: text(2, 200),
    details: z.string().trim().max(3000).optional(), propertyId: id.nullable().optional(), assigneeId: id.nullable().optional(), department: z.enum(DEPARTMENTS).nullable().optional(),
    dueOn: date.nullable().optional(), amountMinor: z.number().int().min(0).max(10000000).nullable().optional(), link: https.nullable().optional(),
    // reference is the invoice number on an invoice. reservationId and clientId link the row to a stay or an owner.
    reference: z.string().trim().max(120).optional(), reservationId: id.nullable().optional(), clientId: id.nullable().optional(),
    // A to-do's priority and start date (migration 20261025100000).
    priority: z.enum(TODO_PRIORITIES).nullable().optional(), startOn: date.nullable().optional() }).strict(),
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
  // Reports > Guests & stays: "Ask guests the reason for their stay" and "Send a survey after direct stays" (admins only, 20261021800000).
  z.object({ action: z.literal('setStayReasonSwitch'), switch: z.enum(['ask', 'survey']), on: z.boolean() }).strict(),
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
  // Cleaner invoices (20261022000000), through workspace_cleaner_pay_action: Accounts and admins approve, query (a note to the
  // cleaner) and mark paid; and set a cleaner's pay period, weekly or monthly.
  z.object({ action: z.literal('approvePayInvoice'), requestId: id, invoiceId: id, version }).strict(),
  z.object({ action: z.literal('queryPayInvoice'), requestId: id, invoiceId: id, version, note }).strict(),
  z.object({ action: z.literal('markPayInvoicePaid'), requestId: id, invoiceId: id, version, paidOn: date }).strict(),
  z.object({ action: z.literal('setCleanerPayPeriod'), requestId: id, cleanerId: id, period: z.enum(['weekly', 'monthly']), version: z.number().int().min(0) }).strict(),
  // VA pay (20261022200000), through workspace_va_pay_action, management only: a VA's hourly rate and bonus per KPI tier in US
  // cents (version 0 before the first save); approve, query or reject a request for invoice (with a note), adjust it before
  // approval (an hours correction in minutes and/or the bonus, with a reason) and mark it paid. The database also refuses an adjustment that changes neither.
  z.object({ action: z.literal('saveVaPay'), requestId: id, vaId: id, version: z.number().int().min(0), hourlyRateMinor: z.number().int().min(1).max(100000).nullable(),
    bonusTargetMinor: z.number().int().min(0).max(10000000), bonusTier2Minor: z.number().int().min(0).max(10000000), bonusTier3Minor: z.number().int().min(0).max(10000000) }).strict(),
  z.object({ action: z.literal('issueVaRequest'), requestId: id, vaId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), version: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('approveVaRequest'), requestId: id, id, version }).strict(),
  z.object({ action: z.literal('queryVaRequest'), requestId: id, id, version, note }).strict(),
  z.object({ action: z.literal('rejectVaRequest'), requestId: id, id, version, note }).strict(),
  z.object({ action: z.literal('adjustVaRequest'), requestId: id, id, version, hoursAdjustMinutes: z.number().int().min(-44640).max(44640).optional(),
    bonusMinor: z.number().int().min(0).max(10000000).nullable().optional(), reason: text(5, 500) }).strict(),
  z.object({ action: z.literal('markVaRequestPaid'), requestId: id, id, version, paidOn: date }).strict(),
  // Requests for invoice (20261022000000): a clean's outcome while its request waits for approval.
  z.object({ action: z.literal('setPayLineOutcome'), requestId: id, invoiceId: id, workId: id, outcome: z.enum(['completed', 'partial', 'unsuccessful']), version }).strict(),
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
  // While clocked in: pause for a break or an emergency, go back to work, or switch to overtime. Lunch is no
  // longer a pause (Alex, client meeting); old lunch pauses are still read below.
  z.object({ action: z.literal('startPause'), requestId: id, kind: z.enum(['break', 'emergency']), note: z.string().trim().max(200).optional() }).strict(),
  z.object({ action: z.literal('endPause'), requestId: id }).strict(),
  z.object({ action: z.literal('startOvertime'), requestId: id }).strict(),
  // Admins: whether each kind of pause counts as paid time. The screen no longer shows lunch and sends the
  // stored lunch rule back unchanged, so old lunch pauses keep their totals.
  z.object({ action: z.literal('savePausePolicy'), requestId: id, lunchPaid: z.boolean(), breakPaid: z.boolean(), emergencyPaid: z.boolean(), version: z.number().int().positive() }).strict(),
  // Team feedback: admins and Stays send it; super admins mark it seen or done and reply.
  z.object({ action: z.literal('sendFeedback'), requestId: id, category: z.enum(['idea', 'problem', 'praise', 'other']), message: text(5, 2000) }).strict(),
  // Reported chat messages: admins and super admins remove the message (hidden for everyone) or dismiss the report.
  z.object({ action: z.literal('decideChatReport'), requestId: id, reportId: id, version, decision: z.enum(['remove', 'dismiss']) }).strict(),
  // A reported guest or client message: hide it in the app, or dismiss the report.
  z.object({ action: z.literal('decideMessageReport'), requestId: id, reportId: id, version, decision: z.enum(['hide', 'dismiss']) }).strict(),
  z.object({ action: z.literal('updateFeedback'), requestId: id, feedbackId: id, version, status: z.enum(['new', 'seen', 'done']), reply: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal('closeShift'), requestId: id, shiftId: id, endedAt: z.string().datetime({ offset: true }), note: text(3, 500).optional() }).strict(),
  z.object({ action: z.literal('saveTargets'), requestId: id, version, greenMinutes: z.number().int().min(1).max(120), amberMinutes: z.number().int().min(2).max(240),
    passPercent: z.number().int().min(1).max(100), bonusPercents: z.array(z.number().int().min(1).max(100)).max(5),
    // How much daily work counts in the score (0-100%), and what's expected on each Stays shift day.
    workWeight: z.number().int().min(0).max(100).optional(), dailyTargets: dailyTargetsSchema.optional() }).strict(),
  // KPIs (admins and super admins only): add or edit one, switch it off or on, move it up or down within its area.
  // The direction (higher or lower is better) comes from the measure; tiers sit beyond the target in that direction.
  z.object({ action: z.literal('saveKpi'), requestId: id, kpiId: id.optional(), version: version.optional(), name: text(2, 120), area: z.enum(DEPARTMENTS), measure: z.enum(KPI_MEASURES),
    minutes: z.number().int().min(1).max(1440).nullable().optional(), targetPercent: kpiPercent.nullable(), bonusTiers: z.array(kpiPercent).max(5), countsForBonus: z.boolean(), placeholder: z.boolean(),
    // The combined management measure only: Guest relations' share, Client relations gets the rest (migration 20261018300000).
    guestShare: kpiPercent.nullable().optional() }).strict(),
  z.object({ action: z.literal('setKpiActive'), requestId: id, kpiId: id, version, active: z.boolean() }).strict(),
  z.object({ action: z.literal('moveKpi'), requestId: id, kpiId: id, version, direction: z.enum(['up', 'down']) }).strict(),
  z.object({ action: z.literal('signContract'), requestId: id, contractId: id, version, signedName: text(2, 200), agree: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree to the contract' }) }) }).strict(),
  // Flag something for management (work, a hub item, or a free-standing request with an optional amount).
  z.object({ action: z.literal('flagForManagement'), requestId: id, workId: id.optional(), hubItemId: id.optional(), title: text(2, 200), reason: text(5, 2000),
    amountMinor: z.number().int().min(0).max(10000000).nullable().optional(), source: z.enum(FLAG_SOURCES) }).strict(),
  // Admins decide a flag; declining needs a reason. The person who raised a flag can withdraw it while it is open.
  z.object({ action: z.literal('decideFlag'), requestId: id, flagId: id, version, decision: z.enum(FLAG_DECISIONS), note: z.string().trim().max(2000).default('') }).strict(),
  z.object({ action: z.literal('withdrawFlag'), requestId: id, flagId: id, version }).strict(),
  // The end-of-day reflection (needed to clock out for some roles) and an admin marking reflections as read.
  z.object({ action: z.literal('saveReflection'), requestId: id, shiftId: id.optional(), wentWell: reflectionNote, notWell: reflectionNote, feedback: reflectionNote,
    completed: z.array(reflectionItemSchema).max(100) }).strict(),
  z.object({ action: z.literal('markReflectionsReviewed'), requestId: id, ids: z.array(id).min(1).max(100) }).strict(),
  // Daily to-dos: make today's (or another day's) from the templates, and the admins' list of templates.
  z.object({ action: z.literal('ensureDailyTodos'), requestId: id, day: date.optional() }).strict(),
  z.object({ action: z.literal('saveDailyTask'), requestId: id, id: id.optional(), department: z.enum(DEPARTMENTS), title: text(2, 200),
    details: z.string().trim().max(3000).default(''), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), active: z.boolean() }).strict(),
  z.object({ action: z.literal('removeDailyTask'), requestId: id, id }).strict(),
  // Link an AirCover claim to the maintenance or visit it came from.
  z.object({ action: z.literal('flagAirCover'), requestId: id, workId: id, title: text(2, 200).optional(), amountMinor: z.number().int().min(0).max(10000000).nullable().optional(),
    reference: z.string().trim().max(120).optional() }).strict(),
  // A routine visit's form: one answer per checklist item, in order, a note, and photos already uploaded.
  z.object({ action: z.literal('recordVisitForm'), requestId: id, workId: id, version, answers: z.array(visitAnswerSchema).min(1).max(30),
    note: z.string().trim().max(2000).default(''), photoIds: z.array(id).max(20).optional() }).strict(),
  // The team calendar: your own absences, meetings and so on (admins can change anyone's).
  z.object({ action: z.literal('saveTeamEvent'), requestId: id, id: id.optional(), version: version.optional(), userId: id.optional(), kind: z.enum(TEAM_EVENT_KINDS), title: text(2, 200), startsOn: date, endsOn: date,
    startTime: clockTime.nullable().optional(), endTime: clockTime.nullable().optional(), location: z.string().trim().max(200).optional() }).strict(),
  z.object({ action: z.literal('cancelTeamEvent'), requestId: id, id, version: version.optional() }).strict(),
  // Menu order per role (super admins only). Version 0 is a role nobody has reordered yet.
  z.object({ action: z.literal('saveMenuLayout'), requestId: id, role: z.enum(MENU_ROLES), version: z.number().int().min(0), ...menuLayoutSchema.shape }).strict(),
  z.object({ action: z.literal('resetMenuLayout'), requestId: id, role: z.enum(MENU_ROLES), version: z.number().int().min(0) }).strict(),
  // Round 6: an update on a to-do (anyone who can see the to-do; never owners).
  z.object({ action: z.literal('addTodoUpdate'), requestId: id, id, text: text(1, 2000),
    // Like ClickUp (migration 20261025100000): a reply to a comment, and the people the comment @mentions.
    replyTo: z.number().int().positive().nullable().optional(), mentions: z.array(id).max(20, 'Mention up to 20 people').optional() }).strict(),
  z.object({ action: z.literal('reactTodoUpdate'), requestId: id, updateId: z.number().int().positive(), emoji: z.enum(TODO_REACTIONS).nullable() }).strict(),
  z.object({ action: z.literal('setTodoFields'), requestId: id, id, priority: z.enum(TODO_PRIORITIES).nullable().optional(), startOn: date.nullable().optional(), dueOn: date.nullable().optional() }).strict(),
  z.object({ action: z.literal('readTodo'), requestId: id, id }).strict(),
  // Round 6: delete a client enquiry that has not moved on (admins and super admins).
  z.object({ action: z.literal('deleteEnquiry'), requestId: id, enquiryId: id, version, confirm: z.literal('DELETE').optional() }).strict(),
  // Leads (20261025300000): a comment on a lead, and its Estimate Delivery steps saved, ticked or reopened.
  ...leadActionSchemas,
]).superRefine((value, context) => {
  if (value.action === 'saveLeadStep') { const issue = leadStepIssue(value.step, value.data, value.done); if (issue) context.addIssue({ code: 'custom', path: ['data'], message: issue }); }
  if (value.action === 'flagForManagement') {
    if (value.source === 'work' && (!value.workId || value.hubItemId)) context.addIssue({ code: 'custom', message: 'Flag work with its work id only' });
    if (value.source === 'hub' && (!value.hubItemId || value.workId)) context.addIssue({ code: 'custom', message: 'Flag a hub item with its id only' });
    if (value.source === 'request' && (value.workId || value.hubItemId)) context.addIssue({ code: 'custom', message: 'A request is not linked to anything' });
  }
  if (value.action === 'decideFlag' && value.decision === 'declined' && value.note.length < 5) context.addIssue({ code: 'custom', message: 'Say why it is declined' });
  if (value.action === 'saveReflection' && value.wentWell.length < 3 && value.notWell.length < 3) context.addIssue({ code: 'custom', message: 'Say what went well or what did not' });
  if (value.action === 'saveDailyTask' && new Set(value.weekdays).size !== value.weekdays.length) context.addIssue({ code: 'custom', message: 'Each day once' });
  if (value.action === 'saveTeamEvent') {
    if (value.endsOn < value.startsOn) context.addIssue({ code: 'custom', message: 'The end date must be on or after the start date' });
    else if (Date.parse(value.endsOn) - Date.parse(value.startsOn) > 365 * 86400000) context.addIssue({ code: 'custom', message: 'Choose up to a year' });
    if (value.endTime && !value.startTime) context.addIssue({ code: 'custom', message: 'Add the start time too' });
    if (value.startTime && value.endTime && value.startsOn === value.endsOn && value.endTime <= value.startTime) context.addIssue({ code: 'custom', message: 'The end time must be after the start time' });
  }
  if (value.action === 'saveFavorites' && new Set(value.items.map(i => i.key)).size !== value.items.length) context.addIssue({ code: 'custom', message: 'Each favorite once' });
  if (value.action === 'saveRoutinePlan' && Boolean(value.planId) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing a plan needs its current version' });
  if (value.action === 'saveHubItem' && Boolean(value.id) !== Boolean(value.version)) context.addIssue({ code: 'custom', message: 'Editing needs the current version' });
  if (value.action === 'saveHubItem' && value.kind === 'approval' && value.amountMinor == null) context.addIssue({ code: 'custom', message: 'Add the amount to approve' });
  if ((value.action === 'saveHubItem' || value.action === 'setTodoFields') && value.startOn && value.dueOn && value.startOn > value.dueOn) context.addIssue({ code: 'custom', message: 'The start date must be on or before the due date' });
  if (value.action === 'saveHubItem' && value.kind !== 'todo' && (value.priority || value.startOn)) context.addIssue({ code: 'custom', message: 'Only a to-do has a priority or a start date' });
  if (value.action === 'setTodoFields' && value.priority === undefined && value.startOn === undefined && value.dueOn === undefined) context.addIssue({ code: 'custom', message: 'Nothing to change' });
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
  // Added with the hub links migration; optional so older answers still parse.
  reservationId: id.nullable().optional(), clientId: id.nullable().optional(),
  // A to-do's priority and start date (migration 20261025100000); optional so older answers still parse.
  priority: z.enum(TODO_PRIORITIES).nullable().optional().catch(null), startOn: z.string().nullable().optional(),
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
