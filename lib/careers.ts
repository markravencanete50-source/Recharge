import { z } from 'zod';
import { questionSchema } from './recruitment';
import { emailSignature } from './email-brand';

// Careers (Business Plan v2, "Hiring & Training Processes"; migration 20261031400000): the public careers page lists
// every vacancy whose application form recruitment published, anyone applies with their CV and the role's questions, and
// each applicant can make a limited account to follow their application: choose an interview time or decline (within 3
// days), accept or turn down the offer, sign the contract and message recruitment. Emails come from careers@.
export const CAREERS_FROM = 'Recharge Careers <careers@rechargegroup.co.uk>';
export const CAREERS_ADDRESS = 'careers@rechargegroup.co.uk';
export const RESPONSE_PROMISE = 'We aim to respond to every application within 14 working days.';

const id = z.string().uuid();
export const listingSchema = z.object({
  id, title: z.string(), area: z.string(), hours: z.string(), earnings: z.string(), description: z.string(), questions: z.array(questionSchema),
  startBy: z.string().nullable(), positions: z.number(), publishedAt: z.string().nullable(),
});
export type Listing = z.infer<typeof listingSchema>;

// CVs: PDF or Word, up to 10 MB, the type read from the file's first bytes.
export const MAX_CV_BYTES = 10 * 1024 * 1024;
export const CV_RULE = 'PDF or Word (DOC, DOCX), up to 10 MB.';
export function cvFileType(bytes: Uint8Array): { mime: string; ext: 'pdf' | 'doc' | 'docx' } | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
  // Word 97-2003 (an OLE compound file) and Word 2007+ (a zip holding word/document.xml).
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { mime: 'application/msword', ext: 'doc' };
  if (starts([0x50, 0x4b, 0x03, 0x04])) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  return null;
}

// The application, as the form sends it (the CV comes alongside as a file).
export const applicationSchema = z.object({
  vacancyId: id,
  fullName: z.string().trim().min(2, 'Give your full name').max(200),
  email: z.string().trim().email('Check your email address').max(320),
  phone: z.string().trim().min(6, 'Give your phone number').max(40),
  answers: z.record(z.string().regex(/^q[a-z0-9]{1,12}$/), z.string().trim().max(3000, 'Keep each answer to 3,000 characters')),
  otherRoles: z.boolean(),
}).strict();
export type Application = z.infer<typeof applicationSchema>;
// Required questions answered, yes/no and number answers in shape: the database checks again.
export function answersProblem(questions: readonly z.infer<typeof questionSchema>[], answers: Record<string, string>): { id: string; message: string } | null {
  for (const q of questions) {
    const a = (answers[q.id] ?? '').trim();
    if (!a && q.required) return { id: q.id, message: 'Please answer this question' };
    if (a && q.kind === 'yes_no' && a !== 'Yes' && a !== 'No') return { id: q.id, message: 'Answer yes or no' };
    if (a && q.kind === 'number' && !/^-?[0-9]+(\.[0-9]+)?$/.test(a)) return { id: q.id, message: 'Answer with a number' };
  }
  return null;
}

// ---------------------------------------------------------------- the applicant's account
export const APPLICATION_STAGES = ['received', 'shortlisted', 'interview', 'offer', 'accepted', 'contract', 'signed', 'hired', 'closed', 'withdrawn'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const APPLICATION_STAGE_LABEL: Record<ApplicationStage, string> = {
  received: 'Application received', shortlisted: 'Shortlisted', interview: 'Interview', offer: 'Job offer', accepted: 'Offer accepted',
  contract: 'Contract to sign', signed: 'Contract signed', hired: 'Hired', closed: 'Not progressing', withdrawn: 'Withdrawn',
};
const messageSchema = z.object({ id, fromApplicant: z.boolean(), body: z.string(), at: z.string(), authorName: z.string() });
export const applicantApplicationSchema = z.object({
  id, title: z.string(), area: z.string(), appliedAt: z.string(), stage: z.enum(APPLICATION_STAGES),
  interview: z.object({
    status: z.enum(['invited', 'booked', 'declined', 'expired', 'done', 'no_show']), expiresAt: z.string().nullable(), at: z.string().nullable(),
    mode: z.enum(['virtual', 'in_person']).nullable(), place: z.string(), minutes: z.number().nullable(), freeSlots: z.array(z.string()),
  }).nullable(),
  offerStatus: z.enum(['offered', 'accepted', 'declined']).nullable(),
  contract: z.object({
    title: z.string(), body: z.string(), directorName: z.string(), directorSignature: z.string().nullable(), issuedAt: z.string(),
    signedName: z.string().nullable(), signedSignature: z.string().nullable(), signedAt: z.string().nullable(),
  }).nullable(),
  messages: z.array(messageSchema), open: z.boolean(),
});
export type ApplicantApplication = z.infer<typeof applicantApplicationSchema>;
export const applicantReadSchema = z.object({ applicant: z.boolean(), name: z.string().nullable().optional(), applications: z.array(applicantApplicationSchema) });
export type ApplicantRead = z.infer<typeof applicantReadSchema>;
const base = { requestId: id, candidateId: id };
const note = z.string().trim().max(1000).optional();
export const applicantActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bookInterview'), ...base, at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('declineInterview'), ...base, note }).strict(),
  z.object({ action: z.literal('answerOffer'), ...base, answer: z.enum(['accept', 'decline']), note }).strict(),
  z.object({ action: z.literal('signContract'), ...base, signedName: z.string().trim().min(2, 'Type your full name').max(200),
    signatureImage: z.string().max(200000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, 'Draw your signature again'), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal('sendMessage'), ...base, body: z.string().trim().min(1, 'Write a message').max(4000) }).strict(),
  z.object({ action: z.literal('withdraw'), ...base }).strict(),
]);
export type ApplicantAction = z.infer<typeof applicantActionSchema>;

// ---------------------------------------------------------------- the emails
export const CAREERS_EMAIL_KINDS = ['received', 'shortlisted', 'interview', 'offer', 'contract', 'message'] as const;
export type CareersEmailKind = (typeof CAREERS_EMAIL_KINDS)[number];
export const careersEmailJobSchema = z.object({
  id, kind: z.enum(CAREERS_EMAIL_KINDS), to: z.string(), name: z.string(), title: z.string(), candidateId: id, hasAccount: z.boolean(),
  interviewExpiresAt: z.string().nullable(), interviewMode: z.enum(['virtual', 'in_person']).nullable(),
});
export type CareersEmailJob = z.infer<typeof careersEmailJobSchema>;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';
const londonDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
/** One careers email: what happened, and the button to the account (to make one, or to sign in). */
export function careersEmail(job: CareersEmailJob, link: { url: string; label: string }) {
  const role = job.title;
  const lines: Record<CareersEmailKind, { subject: string; body: string }> = {
    received: { subject: `We received your application: ${role}`,
      body: `Thank you for applying for the ${role} role at Recharge. ${RESPONSE_PROMISE}\n\nCreate your account to follow your application, choose an interview time if we invite you, and message our recruitment team.` },
    shortlisted: { subject: `You have been shortlisted: ${role}`,
      body: `Good news: your application for ${role} has been shortlisted. We will be in touch about the next step.` },
    interview: { subject: `Invitation to interview: ${role}`,
      body: `We would like to invite you to ${job.interviewMode === 'in_person' ? 'an interview in person' : 'a video interview'} for ${role}. Please choose a time that suits you, or let us know if you cannot make it${job.interviewExpiresAt ? `, by ${londonDay(job.interviewExpiresAt)}` : ' within 3 days'}.` },
    offer: { subject: `Job offer: ${role}`,
      body: `We are delighted to offer you the ${role} role at Recharge. Please accept or decline the offer in your account.` },
    contract: { subject: `Your contract is ready to sign: ${role}`,
      body: `Your contract for ${role} is ready. Please read it and sign it in your account.` },
    message: { subject: `A message from Recharge recruitment: ${role}`,
      body: `Our recruitment team have sent you a message about your application for ${role}. Open your account to read it and reply.` },
  };
  const { subject, body } = lines[job.kind];
  const greeting = `Hi ${firstName(job.name)},`;
  const text = `${greeting}\n\n${body}\n\n${link.label}: ${link.url}\n\nRecharge Careers\n${CAREERS_ADDRESS}\n`;
  const paragraphs = [greeting, ...body.split(/\n{2,}/)].map(p => `<p style="margin:0 0 14px">${escape(p)}</p>`).join('');
  const button = `<p style="margin:24px 0"><a href="${escape(link.url)}" style="background:#0f1f3d;color:#ffffff;padding:13px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">${escape(link.label)}</a></p>`;
  const html = `<div style="font-family:Poppins,Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f1f3d;max-width:560px">${paragraphs}${button}`
    + `<p style="margin:0;color:#4E6259;font-size:13px;word-break:break-all">If the button doesn't work, copy this link into your browser: ${escape(link.url)}</p>${emailSignature(CAREERS_ADDRESS)}</div>`;
  return { subject, text, html };
}
