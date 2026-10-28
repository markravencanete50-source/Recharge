import { z } from 'zod';

// Recruitment (Recharge Business Plan v1.0, 17/10/26: the Recruitment Manager and the Recruitment board; migration
// 20261029600000). A manager asks for a role (the job, the area, how many people); recruitment write the advert, add
// candidates and shortlist them; the manager who asked selects or turns each one down; recruitment then onboard whoever is
// selected, linking the account made in Access control, and follow their contract and training until they can start.
// Admins edit the jobs (title, the role a hire's account gets, the advert to start from) and who the recruiters are.

const id = z.string().uuid();
export const HIRE_ROLES = ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'admin'] as const;
export type HireRole = (typeof HIRE_ROLES)[number];
export const HIRE_ROLE_LABEL: Record<HireRole, string> = {
  stays: 'Guest relations', cleans: 'Housekeeping', cleaning_manager: 'Housekeeping manager', ready: 'Property operations', accounts: 'Accounts', admin: 'Management',
};

export const jobSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), title: z.string().trim().min(1).max(80), role: z.enum(HIRE_ROLES), advert: z.string().max(5000),
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
export const candidateSchema = z.object({
  id, fullName: z.string(), email: z.string(), phone: z.string(), cvUrl: z.string(), notes: z.string(), status: z.enum(CANDIDATE_STATUSES),
  decisionNote: z.string(), decidedByName: z.string().nullable(), decidedAt: z.string().nullable(),
  hiredUserId: id.nullable(), hiredName: z.string().nullable(), hiredAt: z.string().nullable(), addedAt: z.string(), onboarding: onboardingSchema.nullable(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const VACANCY_STATUSES = ['open', 'filled', 'cancelled'] as const;
export const vacancySchema = z.object({
  id, jobKey: z.string(), title: z.string(), role: z.enum(HIRE_ROLES), area: z.string(), positions: z.number().int(), startBy: z.string().nullable(), notes: z.string(),
  propertyId: id.nullable(), propertyName: z.string().nullable(), requestedById: id.nullable(), requestedByName: z.string(), requestedAt: z.string(),
  advert: z.string(), postedTo: z.string(), advertisedAt: z.string().nullable(), advertisedByName: z.string().nullable(), shortlistSharedAt: z.string().nullable(),
  status: z.enum(VACANCY_STATUSES), closedAt: z.string().nullable(), closedByName: z.string().nullable(), closeReason: z.string(),
  hired: z.number().int(), isMine: z.boolean(), candidates: z.array(candidateSchema),
  canEdit: z.boolean(), canAdvertise: z.boolean(), canShare: z.boolean(), canChoose: z.boolean(), canHire: z.boolean(), canReopen: z.boolean(),
});
export type Vacancy = z.infer<typeof vacancySchema>;
const person = z.object({ id, name: z.string() });
export const recruitmentReadSchema = z.object({
  settings: recruitmentSettingsSchema, canEditSettings: z.boolean(), canRecruit: z.boolean(), canRequest: z.boolean(),
  recruiters: z.array(person), people: z.array(person.extend({ role: z.string() })), vacancies: z.array(vacancySchema),
});
export type RecruitmentRead = z.infer<typeof recruitmentReadSchema>;

// Where a vacancy has got to, in the order the plan follows.
export type VacancyStage = 'requested' | 'advertised' | 'shortlisting' | 'choosing' | 'onboarding' | 'filled' | 'cancelled';
export function vacancyStage(v: Pick<Vacancy, 'status' | 'advertisedAt' | 'shortlistSharedAt' | 'candidates'>): VacancyStage {
  if (v.status !== 'open') return v.status;
  if (v.candidates.some(c => c.status === 'selected' || c.status === 'hired')) return 'onboarding';
  if (v.shortlistSharedAt && v.candidates.some(c => c.status === 'shortlisted')) return 'choosing';
  if (v.candidates.length) return 'shortlisting';
  return v.advertisedAt ? 'advertised' : 'requested';
}
export const VACANCY_STAGE_LABEL: Record<VacancyStage, string> = {
  requested: 'Advert to write', advertised: 'Advertised', shortlisting: 'Shortlisting', choosing: 'Waiting on the manager', onboarding: 'Onboarding', filled: 'Filled', cancelled: 'Closed',
};

const text = (max: number) => z.string().max(max);
const base = { requestId: id };
const vacancy = { ...base, vacancyId: id };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const candidateFields = {
  fullName: z.string().trim().min(2, 'Give the candidate’s full name').max(200), email: text(320), phone: text(40), cvUrl: text(1000), notes: text(2000),
};
export const recruitmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveSettings'), ...base, settings: recruitmentSettingsSchema, recruiterIds: z.array(id).max(50) }).strict(),
  z.object({ action: z.literal('requestRole'), ...base, jobKey: z.string().min(1).max(40), area: z.string().trim().min(1, 'Say which area the role covers').max(200),
    positions: z.number().int().min(1).max(20), startBy: date.or(z.literal('')).optional(), notes: text(2000).optional(), propertyId: id.optional() }).strict(),
  z.object({ action: z.literal('updateVacancy'), ...vacancy, area: z.string().trim().min(1, 'Say which area the role covers').max(200), positions: z.number().int().min(1).max(20),
    startBy: date.or(z.literal('')).optional(), notes: text(2000).optional() }).strict(),
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
]);
export type RecruitmentAction = z.infer<typeof recruitmentActionSchema>;
export const recruitmentQuerySchema = z.object({}).strict();
