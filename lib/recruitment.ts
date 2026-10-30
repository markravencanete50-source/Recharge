import { z } from 'zod';

// Recruitment (Recharge Business Plan v1.0, 17/10/26: the Recruitment Manager and the Recruitment board; migration
// 20261029600000). A manager asks for a role (the job, the area, how many people); recruitment write the advert, add
// candidates and shortlist them; the manager who asked selects or turns each one down; recruitment then onboard whoever is
// selected, linking the account made in Access control, and follow their contract and training until they can start.
// Admins edit the jobs (title, the role a hire's account gets, the advert to start from) and who the recruiters are.
// The hiring process (Business Plan v2, migration 20261031300000): the directors approve a request with the maximum budget,
// recruitment is auto-assigned, and the ticket follows a checklist: application form, marketing, reviewing, interviews,
// job offer, contract (from a template a director pre-signed), onboarding and training.

const id = z.string().uuid();
export const HIRE_ROLES = ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'admin'] as const;
export type HireRole = (typeof HIRE_ROLES)[number];
export const HIRE_ROLE_LABEL: Record<HireRole, string> = {
  stays: 'Guest relations', cleans: 'Housekeeping', cleaning_manager: 'Housekeeping manager', ready: 'Property operations', accounts: 'Accounts', admin: 'Management',
};

// Role-specific questions on the application form (for a housekeeper: pay expectations per 1 to 5-bedroom property).
export const QUESTION_KINDS = ['short', 'long', 'yes_no', 'number'] as const;
export const QUESTION_KIND_LABEL: Record<(typeof QUESTION_KINDS)[number], string> = { short: 'Short answer', long: 'Long answer', yes_no: 'Yes or no', number: 'Number' };
export const questionSchema = z.object({
  id: z.string().regex(/^q[a-z0-9]{1,12}$/), label: z.string().trim().min(3, 'Give every question at least 3 characters').max(300), kind: z.enum(QUESTION_KINDS), required: z.boolean(),
}).strict();
export type Question = z.infer<typeof questionSchema>;
const questionsSchema = z.array(questionSchema).max(15, 'Up to 15 questions');
// A new question's id, unique on the form.
export function questionId(taken: readonly string[]) {
  let n = taken.length + 1;
  while (taken.includes('q' + n)) n++;
  return 'q' + n;
}
export const jobSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), title: z.string().trim().min(1).max(80), role: z.enum(HIRE_ROLES), advert: z.string().max(5000),
  hours: z.string().max(200).default(''), earnings: z.string().max(200).default(''), questions: questionsSchema.default([]),
}).strict();
export type Job = z.infer<typeof jobSchema>;
export const recruitmentSettingsSchema = z.object({ jobs: z.array(jobSchema).min(1).max(40) }).strict();
export type RecruitmentSettings = z.infer<typeof recruitmentSettingsSchema>;
// A new job's key, from its title, kept unique among the others.
export function jobKey(title: string, taken: readonly string[]) {
  const base = (title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'job').slice(0, 34).replace(/_+$/, '');
  const root = base.length >= 2 ? base : 'job_' + base;
  let key = root, n = 2;
  while (taken.includes(key)) key = `${root}_${n++}`;
  return key;
}

export const CANDIDATE_STATUSES = ['new', 'shortlisted', 'rejected', 'selected', 'declined', 'hired', 'withdrawn'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  new: 'New', shortlisted: 'Shortlisted', rejected: 'Not taken forward', selected: 'Selected', declined: 'Turned down', hired: 'Hired', withdrawn: 'Withdrawn',
};
const onboardingSchema = z.object({
  required: z.boolean(), complete: z.boolean(), contractsSigned: z.number(), contractsNeeded: z.number(), coursesDone: z.number(), coursesNeeded: z.number(),
}).passthrough();
export const INTERVIEW_STATUSES = ['invited', 'booked', 'declined', 'expired', 'done', 'no_show'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];
export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  invited: 'Invited to interview', booked: 'Interview booked', declined: 'Declined the interview', expired: 'Invite expired', done: 'Interviewed', no_show: 'Did not attend',
};
export const OFFER_STATUSES = ['offered', 'accepted', 'declined'] as const;
export const OFFER_STATUS_LABEL: Record<(typeof OFFER_STATUSES)[number], string> = { offered: 'Offered the job', accepted: 'Accepted the offer', declined: 'Turned down the offer' };
const answerSchema = z.object({ id: z.string(), label: z.string(), answer: z.string() }).passthrough();
export const contractSchema = z.object({
  id, title: z.string(), body: z.string(), fields: z.record(z.string(), z.string()), directorName: z.string(), directorSignature: z.string().nullable(),
  issuedAt: z.string(), issuedByName: z.string().nullable(), signedName: z.string().nullable(), signedSignature: z.string().nullable(), signedAt: z.string().nullable(),
  signedHow: z.enum(['candidate', 'paper']).nullable(),
});
export type HiringContract = z.infer<typeof contractSchema>;
export const messageSchema = z.object({ id, fromApplicant: z.boolean(), body: z.string(), at: z.string(), authorName: z.string() });
export type RecruitmentMessage = z.infer<typeof messageSchema>;
export const candidateSchema = z.object({
  id, fullName: z.string(), email: z.string(), phone: z.string(), cvUrl: z.string(), notes: z.string(), status: z.enum(CANDIDATE_STATUSES),
  decisionNote: z.string(), decidedByName: z.string().nullable(), decidedAt: z.string().nullable(),
  hiredUserId: id.nullable(), hiredName: z.string().nullable(), hiredAt: z.string().nullable(), addedAt: z.string(), onboarding: onboardingSchema.nullable(),
  source: z.enum(['team', 'careers']).default('team'), answers: z.array(answerSchema).default([]), otherRoles: z.boolean().default(false),
  interviewStatus: z.enum(INTERVIEW_STATUSES).nullable().default(null), interviewInvitedAt: z.string().nullable().default(null), interviewExpiresAt: z.string().nullable().default(null),
  interviewAt: z.string().nullable().default(null), interviewNote: z.string().default(''),
  offerStatus: z.enum(OFFER_STATUSES).nullable().default(null), offeredAt: z.string().nullable().default(null), offerAnsweredAt: z.string().nullable().default(null), offerNote: z.string().default(''),
  contract: contractSchema.nullable().default(null),
  // The applicant's side (careers page, migration 20261031400000): their CV file, whether they made an account, and messages.
  cvFile: z.object({ name: z.string(), mime: z.string(), bytes: z.number() }).nullable().default(null), appliedAt: z.string().nullable().default(null),
  hasAccount: z.boolean().default(false), messages: z.array(messageSchema).default([]),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const VACANCY_STATUSES = ['requested', 'open', 'filled', 'cancelled', 'rejected'] as const;
export const BUDGET_UNITS = ['hour', 'job', 'week', 'month', 'year'] as const;
export type BudgetUnit = (typeof BUDGET_UNITS)[number];
export const BUDGET_UNIT_LABEL: Record<BudgetUnit, string> = { hour: 'per hour', job: 'per job', week: 'per week', month: 'per month', year: 'per year' };
export const budgetText = (minor: number | null, unit: BudgetUnit | null) =>
  minor == null ? '' : `up to £${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}${unit ? ' ' + BUDGET_UNIT_LABEL[unit] : ''}`;
// "12.50" or "£1,200" as pence, or null.
export function poundsToMinor(text: string) {
  const clean = text.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 100);
  return minor >= 1 && minor <= 100_000_000 ? minor : null;
}
export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'indeed'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', indeed: 'Indeed' };
export type PlatformState = 'todo' | 'posted' | 'skipped';
export const vacancySchema = z.object({
  id, jobKey: z.string(), title: z.string(), role: z.enum(HIRE_ROLES), area: z.string(), positions: z.number().int(), startBy: z.string().nullable(), notes: z.string(),
  reason: z.string().default(''),
  propertyId: id.nullable(), propertyName: z.string().nullable(), requestedById: id.nullable(), requestedByName: z.string(), requestedAt: z.string(),
  approvedAt: z.string().nullable().default(null), approvedByName: z.string().nullable().default(null), budgetMinor: z.number().nullable().default(null), budgetUnit: z.enum(BUDGET_UNITS).nullable().default(null),
  assignedToId: id.nullable().default(null), assignedToName: z.string().nullable().default(null),
  advert: z.string(), postedTo: z.string(), advertisedAt: z.string().nullable(), advertisedByName: z.string().nullable(), shortlistSharedAt: z.string().nullable(),
  form: z.object({ hours: z.string(), earnings: z.string(), questions: z.array(questionSchema), publishedAt: z.string().nullable(), publishedByName: z.string().nullable(), closedAt: z.string().nullable() })
    .default({ hours: '', earnings: '', questions: [], publishedAt: null, publishedByName: null, closedAt: null }),
  platforms: z.record(z.string(), z.enum(['posted', 'skipped'])).default({}),
  interview: z.object({ mode: z.enum(['virtual', 'in_person']).nullable(), place: z.string(), minutes: z.number().int(), slots: z.array(z.string()), doneAt: z.string().nullable() })
    .default({ mode: null, place: '', minutes: 30, slots: [], doneAt: null }),
  status: z.enum(VACANCY_STATUSES), closedAt: z.string().nullable(), closedByName: z.string().nullable(), closeReason: z.string(),
  hired: z.number().int(), isMine: z.boolean(), candidates: z.array(candidateSchema),
  canDecide: z.boolean().default(false), canAssign: z.boolean().default(false), canInterview: z.boolean().default(false), canAnswerFor: z.boolean().default(false), canContract: z.boolean().default(false),
  canEdit: z.boolean(), canAdvertise: z.boolean(), canShare: z.boolean(), canChoose: z.boolean(), canHire: z.boolean(), canReopen: z.boolean(),
});
export type Vacancy = z.infer<typeof vacancySchema>;
const person = z.object({ id, name: z.string() });
// Contract templates: wording with {{blanks}} filled for each new starter, pre-signed by a director.
export const templateSchema = z.object({
  id, title: z.string(), jobKeys: z.array(z.string()), body: z.string(), blanks: z.array(z.string()), directorName: z.string(), directorSignature: z.string().nullable(),
  directorSignedAt: z.string().nullable(), active: z.boolean(), updatedAt: z.string(),
});
export type ContractTemplate = z.infer<typeof templateSchema>;
export const recruitmentReadSchema = z.object({
  settings: recruitmentSettingsSchema, canEditSettings: z.boolean(), canRecruit: z.boolean(), canRequest: z.boolean(), canApprove: z.boolean().default(false),
  recruiters: z.array(person), directors: z.array(person).default([]), namedDirectors: z.array(id).default([]), people: z.array(person.extend({ role: z.string() })),
  templates: z.array(templateSchema).default([]), vacancies: z.array(vacancySchema),
});
export type RecruitmentRead = z.infer<typeof recruitmentReadSchema>;

// Where a vacancy has got to, in the order the plan follows.
export type VacancyStage = 'approval' | 'requested' | 'advertised' | 'shortlisting' | 'choosing' | 'onboarding' | 'filled' | 'cancelled' | 'rejected';
export function vacancyStage(v: Pick<Vacancy, 'status' | 'advertisedAt' | 'shortlistSharedAt' | 'candidates'>): VacancyStage {
  if (v.status === 'requested') return 'approval';
  if (v.status !== 'open') return v.status;
  if (v.candidates.some(c => c.status === 'selected' || c.status === 'hired')) return 'onboarding';
  if (v.shortlistSharedAt && v.candidates.some(c => c.status === 'shortlisted')) return 'choosing';
  if (v.candidates.length) return 'shortlisting';
  return v.advertisedAt ? 'advertised' : 'requested';
}
export const VACANCY_STAGE_LABEL: Record<VacancyStage, string> = {
  approval: 'Waiting on the directors', requested: 'Advert to write', advertised: 'Advertised', shortlisting: 'Shortlisting', choosing: 'Waiting on the manager', onboarding: 'Onboarding',
  filled: 'Filled', cancelled: 'Closed', rejected: 'Turned down',
};

// The ticket's checklist (Business Plan v2): each step ticks itself from what has been done.
export const HIRING_STEPS = ['approval', 'form', 'marketing', 'review', 'interview', 'offer', 'contract', 'onboarding', 'training'] as const;
export type HiringStep = (typeof HIRING_STEPS)[number];
export const HIRING_STEP_LABEL: Record<HiringStep, string> = {
  approval: 'Directors’ approval', form: 'Application form', marketing: 'Marketing', review: 'Reviewing applicants', interview: 'Interviews',
  offer: 'Job offer', contract: 'Contract', onboarding: 'Onboarding', training: 'Training',
};
export function hiringSteps(v: Vacancy): { key: HiringStep; label: string; done: boolean }[] {
  const hired = v.candidates.filter(c => c.status === 'hired');
  const done: Record<HiringStep, boolean> = {
    approval: v.status !== 'requested' && v.status !== 'rejected',
    form: !!v.form.publishedAt,
    marketing: !!v.advertisedAt,
    review: !!v.shortlistSharedAt,
    interview: !!v.interview.doneAt,
    offer: v.candidates.some(c => c.offerStatus === 'accepted' || (c.status === 'hired' && c.offerStatus == null)),
    contract: v.candidates.some(c => !!c.contract?.signedAt),
    onboarding: hired.length > 0,
    training: hired.length > 0 && hired.every(c => !c.onboarding || !c.onboarding.required || c.onboarding.complete),
  };
  return HIRING_STEPS.map(key => ({ key, label: HIRING_STEP_LABEL[key], done: done[key] }));
}
// The blanks in a contract template's wording, in order (the database reads them the same way).
export function contractBlanks(body: string) {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{([a-z][a-z0-9_]{1,39})\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}
export const blankLabel = (key: string) => key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
// Blanks recruitment rarely need to type: filled from the candidate and the vacancy, still editable.
export function prefillBlanks(blanks: readonly string[], c: Pick<Candidate, 'fullName' | 'email' | 'phone'>, v: Pick<Vacancy, 'title' | 'form' | 'area'>) {
  const known: Record<string, string> = { full_name: c.fullName, name: c.fullName, email: c.email, phone: c.phone, job_title: v.title, role: v.title, hours: v.form.hours, rate: v.form.earnings, area: v.area };
  return Object.fromEntries(blanks.map(b => [b, known[b] ?? '']));
}

const text = (max: number) => z.string().max(max);
const base = { requestId: id };
const vacancy = { ...base, vacancyId: id };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const candidateFields = {
  fullName: z.string().trim().min(2, 'Give the candidate’s full name').max(200), email: text(320), phone: text(40), cvUrl: text(1000), notes: text(2000),
};
const signature = z.string().max(200000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, 'Draw the signature again');
const candidate = { ...vacancy, candidateId: id };
export const recruitmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveSettings'), ...base, settings: recruitmentSettingsSchema, recruiterIds: z.array(id).max(50), directorIds: z.array(id).max(20).optional() }).strict(),
  z.object({ action: z.literal('requestRole'), ...base, jobKey: z.string().min(1).max(40), area: z.string().trim().min(1, 'Say which area the role covers').max(200),
    reason: z.string().trim().min(3, 'Say why the role is needed').max(1000),
    positions: z.number().int().min(1).max(20), startBy: date.or(z.literal('')).optional(), notes: text(2000).optional(), propertyId: id.optional() }).strict(),
  z.object({ action: z.literal('decideRequest'), ...vacancy, decision: z.enum(['approve', 'reject']), budgetMinor: z.number().int().min(1).max(100_000_000).optional(),
    budgetUnit: z.enum(BUDGET_UNITS).optional(), note: text(1000).optional(), userId: id.optional() }).strict(),
  z.object({ action: z.literal('assignVacancy'), ...vacancy, userId: id }).strict(),
  z.object({ action: z.literal('updateVacancy'), ...vacancy, area: z.string().trim().min(1, 'Say which area the role covers').max(200), positions: z.number().int().min(1).max(20),
    startBy: date.or(z.literal('')).optional(), notes: text(2000).optional(), reason: z.string().trim().min(3, 'Say why the role is needed').max(1000).optional() }).strict(),
  z.object({ action: z.literal('saveApplicationForm'), ...vacancy, hours: z.string().trim().min(1, 'Give the hours').max(200), earnings: z.string().trim().min(1, 'Give the expected earnings').max(200),
    advert: z.string().trim().min(20, 'Write the job description (at least 20 characters)').max(5000), questions: questionsSchema, publish: z.boolean() }).strict(),
  z.object({ action: z.literal('withdrawForm'), ...vacancy }).strict(),
  z.object({ action: z.literal('saveMarketing'), ...vacancy, platforms: z.object(Object.fromEntries(PLATFORMS.map(k => [k, z.enum(['todo', 'posted', 'skipped'])])) as Record<Platform, z.ZodEnum<['todo', 'posted', 'skipped']>>).strict(),
    postedTo: text(1000) }).strict(),
  z.object({ action: z.literal('setInterviews'), ...vacancy, mode: z.enum(['virtual', 'in_person']), place: z.string().trim().min(2, 'Give the meeting link or the address').max(500),
    minutes: z.number().int().min(10).max(240), slots: z.array(z.string().datetime({ offset: true })).min(1, 'Give at least one time you are free').max(30) }).strict(),
  z.object({ action: z.literal('inviteToInterview'), ...candidate }).strict(),
  z.object({ action: z.literal('bookInterview'), ...candidate, at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('declineInterview'), ...candidate, note: text(1000).optional() }).strict(),
  z.object({ action: z.literal('interviewOutcome'), ...candidate, outcome: z.enum(['done', 'no_show']), note: text(2000).optional() }).strict(),
  z.object({ action: z.literal('finishInterviews'), ...vacancy }).strict(),
  z.object({ action: z.literal('answerOffer'), ...candidate, answer: z.enum(['accept', 'decline']), note: text(1000).optional() }).strict(),
  z.object({ action: z.literal('saveContractTemplate'), ...base, templateId: id.optional(), title: z.string().trim().min(2, 'Give the template a title').max(200),
    jobKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(40), body: z.string().trim().min(20, 'Write the contract (at least 20 characters)').max(100000), active: z.boolean(),
    directorName: text(200), directorSignature: signature.nullable().optional() }).strict(),
  z.object({ action: z.literal('deleteContractTemplate'), ...base, templateId: id }).strict(),
  z.object({ action: z.literal('issueContract'), ...candidate, templateId: id, fields: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), z.string().trim().min(1).max(500)) }).strict(),
  z.object({ action: z.literal('withdrawContract'), ...candidate }).strict(),
  z.object({ action: z.literal('recordContractSigned'), ...candidate, signedName: z.string().trim().min(2, 'Give the name they signed with').max(200) }).strict(),
  z.object({ action: z.literal('saveAdvert'), ...vacancy, advert: z.string().trim().min(1, 'Write the advert').max(5000), postedTo: text(1000), posted: z.boolean() }).strict(),
  z.object({ action: z.literal('addCandidate'), ...vacancy, ...candidateFields }).strict(),
  z.object({ action: z.literal('editCandidate'), ...vacancy, candidateId: id, ...candidateFields }).strict(),
  z.object({ action: z.literal('setCandidate'), ...vacancy, candidateId: id, status: z.enum(['new', 'shortlisted', 'rejected', 'withdrawn']), note: text(1000).optional() }).strict(),
  z.object({ action: z.literal('deleteCandidate'), ...vacancy, candidateId: id }).strict(),
  z.object({ action: z.literal('shareShortlist'), ...vacancy }).strict(),
  z.object({ action: z.literal('chooseCandidate'), ...vacancy, candidateId: id, decision: z.enum(['select', 'decline']), note: text(1000).optional() }).strict(),
  z.object({ action: z.literal('hireCandidate'), ...vacancy, candidateId: id, userId: id }).strict(),
  z.object({ action: z.literal('cancelVacancy'), ...vacancy, reason: z.string().trim().min(1, 'Say why the vacancy is closed').max(1000) }).strict(),
  z.object({ action: z.literal('reopenVacancy'), ...vacancy }).strict(),
  // A message to a careers applicant (their account and an email), sent by workspace_recruitment_message.
  z.object({ action: z.literal('sendMessage'), ...candidate, body: z.string().trim().min(1, 'Write a message').max(4000) }).strict(),
]);
export type RecruitmentAction = z.infer<typeof recruitmentActionSchema>;
export const recruitmentQuerySchema = z.object({}).strict();
