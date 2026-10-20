import { z } from 'zod';
import { isOnboardingVideoLink } from './video-embed';
import { readEstimate } from './estimate-projection';
import { repairLimitText } from './journey-policy';

// The owner's onboarding checklist (Alex's framework, migration 20261025200000). On the owner's property in onboarding:
// the property information they gave on the left ("TBC" until we have it), and on the right the checklist, then the
// rest of the onboarding as it was. The checklist starts with three steps:
//  * Welcome: who we are and how we work, with a video from the directors. "Next" ticks it.
//  * Process, fees and services: the detail (lib/onboarding-content.ts), with a video. "Next" ticks it.
//  * Estimate: an amber tick once it has arrived; then green (proceeding), an amber dot (still reviewing) or a red cross
//    (not proceeding).
// The two ticks are kept per property in the database (private.workspace_onboarding_seen) by the owner's markSeen,
// with a receipt per requestId. The three videos are a super admin's setting (private.workspace_onboarding_videos);
// until one is set the step shows its words only.

export const VIDEO_STEPS = ['welcome', 'process', 'estimate'] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];
export const SEEN_STEPS = ['welcome', 'process'] as const;
export type SeenStep = (typeof SEEN_STEPS)[number];
export const VIDEO_STEP_LABEL: Record<VideoStep, string> = { welcome: 'Welcome', process: 'Process, fees and services', estimate: 'Your estimate' };
export const VIDEO_LINK_MESSAGE = 'Paste a YouTube, Vimeo or Loom link starting https://';
export const VIDEO_SETTINGS_HELP = 'A video for each step of the owner’s onboarding checklist. Paste a YouTube, Vimeo or Loom link. Until a link is set, the step shows its words only.';

const id = z.string().uuid();
export const clientOnboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('markSeen'), requestId: id, propertyId: id, step: z.enum(SEEN_STEPS) }).strict(),
  // An empty link takes the video away again.
  z.object({ action: z.literal('setVideo'), requestId: id, step: z.enum(VIDEO_STEPS), url: z.string().trim().max(1000, VIDEO_LINK_MESSAGE).refine(v => v === '' || isOnboardingVideoLink(v), VIDEO_LINK_MESSAGE) }).strict(),
]);
export type ClientOnboardingAction = z.infer<typeof clientOnboardingActionSchema>;
// With a property: its ticks, its enquiry's answers and the videos. Without one: the videos (the settings card).
export const clientOnboardingReadSchema = z.object({ propertyId: id.optional() }).strict();

const answersSchema = z.record(z.string(), z.unknown());
export const clientOnboardingSchema = z.object({
  videos: z.object({ welcome: z.string(), process: z.string(), estimate: z.string() }),
  seen: z.object({ welcome: z.string().nullable(), process: z.string().nullable() }).default({ welcome: null, process: null }),
  answers: answersSchema.nullable().default(null),
  files: z.number().int().min(0).default(0),
  canEditVideos: z.boolean().default(false),
});
export type ClientOnboarding = z.infer<typeof clientOnboardingSchema>;

// ---------------------------------------------------------------- the checklist
export type StepMark = 'done' | 'arrived' | 'reviewing' | 'declined' | 'waiting' | 'todo';
export type ChecklistStep = { key: VideoStep; title: string; mark: StepMark; note: string };
const ESTIMATE_STAGES = ['enquiry', 'estimate', 'reviewing'];
export function estimateMark(j: { stage: string; estimate: Record<string, unknown> | null }): StepMark {
  if (j.stage === 'archived') return j.estimate ? 'declined' : 'waiting';
  if (!j.estimate || !readEstimate(j.estimate)) return 'waiting';
  if (j.stage === 'reviewing') return 'reviewing';
  if (ESTIMATE_STAGES.includes(j.stage)) return 'arrived';
  return 'done';
}
export const ESTIMATE_NOTE: Record<StepMark, string> = {
  waiting: 'We are preparing your estimate. It appears here as soon as it is ready.',
  arrived: 'Your estimate is ready. Open it to see what the property could earn and tell us how you would like to go ahead.',
  reviewing: 'You are still reviewing your estimate. We will be in touch on the date you chose.',
  declined: 'You chose not to go ahead. Thank you for telling us why.',
  done: 'You chose to go ahead. The next steps are below.',
  todo: '',
};
export function ownerChecklist(j: { stage: string; estimate: Record<string, unknown> | null }, seen: ClientOnboarding['seen']): ChecklistStep[] {
  const mark = estimateMark(j);
  return [
    { key: 'welcome', title: 'Welcome', mark: seen.welcome ? 'done' : 'todo', note: 'Who we are and how we work.' },
    { key: 'process', title: 'Process, fees and services', mark: seen.process ? 'done' : 'todo', note: 'How onboarding runs, what it costs and what we do.' },
    { key: 'estimate', title: 'Estimate', mark, note: ESTIMATE_NOTE[mark] },
  ];
}
// The step to open first: the first welcome or process step not ticked, else the estimate once it is there.
export function firstOpenStep(steps: ChecklistStep[]): VideoStep | null {
  const next = steps.find(s => s.key !== 'estimate' && s.mark === 'todo');
  if (next) return next.key;
  const estimate = steps.find(s => s.key === 'estimate');
  return estimate && (estimate.mark === 'arrived' || estimate.mark === 'reviewing') ? 'estimate' : null;
}

// ---------------------------------------------------------------- what they told us, with TBC
export const TBC = 'TBC';
export type FactRow = { label: string; value: string | null };
type Facts = {
  answers: Record<string, unknown> | null; files: number;
  property: { address?: string | null; bedrooms?: number | null };
  journey: { propertyType?: string | null; bathrooms?: number | null; enquiry?: Record<string, unknown> | null; form?: Record<string, unknown> | null; ownerRepairLimit?: { limitMinor: number } | null };
};
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
const yesNo = (v: unknown) => v === true ? 'Yes' : v === false ? 'No' : null;
export function propertyFacts({ answers, files, property, journey }: Facts): { about: FactRow[]; property: FactRow[]; setup: FactRow[] } {
  const a = answers ?? {}, e = journey.enquiry ?? {}, f = journey.form ?? null;
  const photos = files ? `${files} ${files === 1 ? 'file' : 'files'} added` + (str(a.mediaLink) || str(e.photoLink) ? ', and a link' : '') : str(a.mediaLink) || str(e.photoLink) ? 'A link to photos or videos' : null;
  const heard = str(a.heardFrom);
  const furnishing = f?.furnishingChoice === 'recharge' ? 'Recharge furnishes it' : f?.furnishingChoice === 'self' ? 'You furnish it' : null;
  return {
    about: [
      { label: 'Your name', value: str(a.fullName) ?? str(e.contactName) },
      { label: 'Email', value: str(a.email) ?? str(e.email) },
      { label: 'Phone', value: str(a.phone) ?? str(e.phone) },
      { label: 'How you heard about us', value: heard ? heard + (str(a.referral) ? `, referred by ${str(a.referral)}` : '') : null },
      { label: 'Stage you’re at', value: str(a.enquiryType) },
      { label: 'When you would like to start', value: str(a.startWhen) },
    ],
    property: [
      { label: 'Address', value: str(property.address) ?? str(a.propertyAddress) },
      { label: 'Property type', value: str(journey.propertyType) ?? str(a.propertyType) },
      { label: 'Bedrooms', value: num(property.bedrooms) ?? num(a.bedrooms) },
      { label: 'Full bathrooms', value: num(journey.bathrooms) ?? num(a.bathrooms) },
      { label: 'WCs', value: num(e.wcs) ?? num(a.wcs) },
      { label: 'Parking', value: str(e.parking) ?? str(a.parking) },
      { label: 'Garden', value: str(e.garden) ?? str(a.garden) },
      { label: 'Photos and videos', value: photos },
      { label: 'Anything else', value: str(a.notes) },
    ],
    setup: [
      { label: 'First access date', value: str(f?.accessDate) },
      { label: 'Gas and electric', value: str(f?.gasElectricMeters) },
      { label: 'Broadband connected', value: yesNo(f?.broadbandConnected) },
      { label: 'Furnishing', value: furnishing },
      { label: 'Licensing support', value: yesNo(f?.licensingRequired) },
      { label: 'Repairs we can approve without asking you', value: journey.ownerRepairLimit ? repairLimitText(journey.ownerRepairLimit.limitMinor) : null },
    ],
  };
}

// ---------------------------------------------------------------- links into the app
// The app on the web is at /workspace. The open form's thank-you and the "estimate ready" email open it with the email
// filled in: signup=1 opens "Create an account", from=estimate says why they are signing in.
export const APP_PATH = '/workspace';
const appLink = (origin: string, params: Record<string, string>) => `${origin.replace(/\/$/, '')}${APP_PATH}?${new URLSearchParams(params)}`;
export const appSignUpLink = (origin: string, email: string) => appLink(origin, { signup: '1', email: email.trim().toLowerCase() });
export const appEstimateLink = (origin: string, email: string) => appLink(origin, { from: 'estimate', email: email.trim().toLowerCase() });
export type AppEntry = { signup: boolean; email: string; from: 'estimate' | null };
export function appEntry(search: string): AppEntry {
  const q = new URLSearchParams(search);
  const email = (q.get('email') ?? '').trim().toLowerCase();
  return { signup: q.get('signup') === '1', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '', from: q.get('from') === 'estimate' ? 'estimate' : null };
}
export const APP_ENTRY_NOTICE = {
  signup: 'Create your account with the email you gave us. Your property and estimate are added to it as soon as you sign in.',
  estimate: 'Your estimate is ready. Sign in, or create an account with the email you gave us, to view it.',
};

// The open form's thank-you (Alex's words).
export const ENQUIRY_THANKS = 'Thanks, we have your details. A member of the team will be in touch with your estimate by email, usually within 48 hours.';
export const ENQUIRY_ACCOUNT_PROMPT = 'Create your account to track your estimate in real time';
