import { z } from 'zod';
import { normaliseRegion } from './regions';

// Client Enquiries: the New Property Enquiry Form landlords fill in from a link the team emails
// them, and what the team does with each answer (value the property, or close it).
//
// The form matches the one the business used in ClickUp: contact information, property
// information, photos or videos (uploaded, or a link), and the services they want.
export const PROPERTY_TYPES = ['Flat', 'House', 'Cottage', 'Bungalow', 'Studio', 'Townhouse', 'Lodge', 'Other'] as const;
export const START_WHEN = ['As soon as possible', 'Within a month', 'In 1 to 3 months', 'In 3 months or more', 'Not sure yet'] as const;
export const ENQUIRY_TYPES = [
  "I'd like a free performance estimate",
  "I'm ready to get started",
  'My property is already a short-term let and I want a new manager',
  "I'm thinking about switching from long-term letting",
  "I'm just exploring my options",
  'Something else',
] as const;
export const YES_NO = ['yes', 'no'] as const;

const text = (max: number) => z.string().trim().max(max);
const required = (label: string, max: number) => z.string().trim().min(1, `Add ${label}`).max(max);
const count = (label: string) => z.number({ invalid_type_error: `Choose the number of ${label}` }).int().min(0).max(40);
const yesNo = (label: string) => z.enum(YES_NO, { errorMap: () => ({ message: `Answer “${label}”` }) });
const https = z.string().trim().max(1000).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'The link must start with https://');
// UK numbers (07…, 01…, 02…, +44…); spaces, brackets and dashes are fine.
export const ukPhone = z.string().trim().max(30).refine(v => /^(\+44\s?\(?0?\)?|0)\d[\d\s()-]{8,13}$/.test(v) && v.replace(/\D/g, '').length >= 10, 'Enter a UK phone number, for example 07700 900123');

export const enquiryAnswersSchema = z.object({
  fullName: required('your name', 200).refine(v => v.length >= 2, 'Add your name'),
  companyName: text(200).optional(),
  correspondenceAddress: required('your correspondence address', 1000),
  email: z.string().trim().email('Enter a valid email address').max(320),
  phone: ukPhone,
  existingClient: yesNo('Are you an existing client?'),
  propertyAddress: required('the property address', 1000).refine(v => v.length >= 5, 'Add the full property address'),
  propertyType: required('the property type', 120),
  bedrooms: count('bedrooms'),
  wcs: count('WCs'),
  bathrooms: count('full bathrooms'),
  parking: text(300).optional(),
  garden: text(300).optional(),
  mediaLink: z.union([z.literal(''), https]).optional(),
  shortLet: yesNo('Is the property currently operating as a short-term let?'),
  furnishQuote: yesNo('Would you like us to provide a quote to furnish the property?'),
  compliance: yesNo('Would you like us to handle your compliance and licensing?'),
  startWhen: text(200).optional(),
  notes: text(3000).optional(),
  enquiryType: required('how you would describe your enquiry', 200),
}).strict();
export type EnquiryAnswers = z.infer<typeof enquiryAnswersSchema>;

// What the team writes when sending the form: who to, and the email (the link is added for them).
export const DEFAULT_SUBJECT = 'Your free property performance estimate from Recharge';
export const defaultBody = (name: string) => `Hi ${name.trim().split(/\s+/)[0] || 'there'},

Thank you for your interest in Recharge. To prepare your free performance estimate, please fill in our short property form using the link below. It takes about five minutes, and you can add photos or videos of the property.

A member of the team will be in touch once we have your details.

Kind regards,
The Recharge team`;
export const LINK_PLACEHOLDER = '{form link}';

export const enquiryInviteSchema = z.object({
  name: required('their name', 200),
  email: z.string().trim().email('Enter a valid email address').max(320),
  subject: required('a subject', 200),
  body: required('a message', 5000),
  // email: sent by Recharge's email service; link: the team copies the link or opens their own email.
  delivery: z.enum(['email', 'link']),
}).strict();

export const ENQUIRY_STATUSES = ['sent', 'opened', 'received', 'valuing', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
const fileSchema = z.object({ id: z.string().uuid(), name: z.string(), mime: z.string(), bytes: z.number() });
export const clientEnquirySchema = z.object({
  id: z.string().uuid(), status: z.enum(ENQUIRY_STATUSES), recipientName: z.string(), recipientEmail: z.string(),
  subject: z.string(), body: z.string(), delivery: z.enum(['email', 'link']), emailStatus: z.enum(['pending', 'sent', 'failed', 'manual']),
  sentBy: z.string().uuid(), sentByName: z.string().nullable(), sentAt: z.string(), openedAt: z.string().nullable(), submittedAt: z.string().nullable(),
  expiresAt: z.string(), answers: enquiryAnswersSchema.nullable(), files: z.array(fileSchema),
  propertyId: z.string().uuid().nullable(), propertyName: z.string().nullable(), stage: z.string().nullable(),
  valuedByName: z.string().nullable(), valuedAt: z.string().nullable(), closedByName: z.string().nullable(), closedAt: z.string().nullable(), closeNote: z.string(), version: z.number(),
  // A possible duplicate, flagged when the form came back (migration 20261015200000): another property at the
  // same address, or the landlord said they already work with us. Never merged; the team decides.
  duplicateOf: z.string().uuid().nullable().default(null), duplicateOfName: z.string().nullable().default(null),
  duplicateReason: z.enum(['same_address', 'existing_client']).nullable().default(null),
});
export type ClientEnquiry = z.infer<typeof clientEnquirySchema>;
export const clientEnquiriesSchema = z.object({ canInvite: z.boolean(), emailReady: z.boolean().default(false), items: z.array(clientEnquirySchema) });
export type ClientEnquiries = z.infer<typeof clientEnquiriesSchema>;

// Where an enquiry is, in the team's words. Once valuing has started, the property's onboarding
// stage says how far it has gone (estimate sent, agreed, live or declined). An answered enquiry already has
// its property (made when the form came back); if the team moved that property on from its own page, the
// enquiry follows its stage too.
export type EnquiryStep = 'sent' | 'opened' | 'received' | 'valuing' | 'estimate' | 'won' | 'declined' | 'closed' | 'expired';
export function enquiryStep(e: Pick<ClientEnquiry, 'status' | 'stage' | 'expiresAt'>, now = Date.now()): EnquiryStep {
  if (e.status === 'closed') return 'closed';
  if (e.status === 'valuing' || (e.status === 'received' && !!e.stage && e.stage !== 'enquiry')) {
    if (e.stage === 'archived') return 'declined';
    if (e.stage === 'estimate' || e.stage === 'reviewing') return 'estimate';
    if (e.stage && e.stage !== 'enquiry') return 'won';
    return 'valuing';
  }
  if ((e.status === 'sent' || e.status === 'opened') && Date.parse(e.expiresAt) < now) return 'expired';
  return e.status;
}
export const STEP_LABEL: Record<EnquiryStep, string> = {
  sent: 'Form sent', opened: 'Form opened', received: 'New: ready to value', valuing: 'Valuing', estimate: 'Estimate sent',
  won: 'Onboarding', declined: 'Declined', closed: 'Closed', expired: 'Link expired',
};
// The badge on a possible duplicate, and a line saying why.
export const DUPLICATE_LABEL = 'Possible duplicate';
export function duplicateNote(e: Pick<ClientEnquiry, 'duplicateReason' | 'duplicateOfName'>): string {
  if (e.duplicateReason === 'same_address') return `Same address as ${e.duplicateOfName?.trim() || 'another property'}. Check before valuing; close one of them if it is the same place.`;
  if (e.duplicateReason === 'existing_client') return 'They said they already work with us. Check their other properties before valuing.';
  return '';
}
// The main button on an answered enquiry: its property is already in Properties, so the team checks the
// details and values it. An enquiry answered before properties were made on submit still starts valuing.
export const valueButtonLabel = (e: Pick<ClientEnquiry, 'propertyId'>) => e.propertyId ? 'Check the details and value' : 'Start valuing';
export const STEP_TONE: Record<EnquiryStep, 'good' | 'wait' | 'bad' | 'plain'> = {
  sent: 'plain', opened: 'plain', received: 'wait', valuing: 'wait', estimate: 'good', won: 'good', declined: 'bad', closed: 'plain', expired: 'bad',
};

// The property's details for "Start valuing", from the landlord's answers: a short name from the
// first line of the address, and everything else they told us in the enquiry notes.
const yes = (v: string) => v === 'yes' ? 'Yes' : 'No';
export function valuationDraft(a: EnquiryAnswers) {
  // "3F2, 17 Warrender Park Road, …" reads "17 Warrender Park Road (3F2)": a flat's position alone is no name.
  const parts = a.propertyAddress.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const firstLine = parts.length > 1 && parts[0].length <= 10 && /\d/.test(parts[0]) && /[a-z]{3}/i.test(parts[1]) ? `${parts[1]} (${parts[0]})` : parts[0] ?? a.propertyAddress;
  const notes = [
    `Enquiry: ${a.enquiryType}`,
    `Short-term let now: ${yes(a.shortLet)} · Furnishing quote: ${yes(a.furnishQuote)} · Compliance and licensing: ${yes(a.compliance)}`,
    a.startWhen ? `Start: ${a.startWhen}` : '',
    `Correspondence address: ${a.correspondenceAddress.replace(/\s*\n\s*/g, ', ')}`,
    a.notes ? `They added: ${a.notes}` : '',
  ].filter(Boolean).join('\n');
  return {
    name: firstLine.slice(0, 200), address: a.propertyAddress, region: normaliseRegion('', a.propertyAddress), propertyType: a.propertyType.slice(0, 120), bedrooms: a.bedrooms, bathrooms: a.bathrooms,
    enquiry: {
      contactName: a.fullName, ...(a.companyName ? { companyName: a.companyName } : {}), email: a.email, phone: a.phone, existingClient: a.existingClient === 'yes',
      wcs: a.wcs, ...(a.parking ? { parking: a.parking } : {}), ...(a.garden ? { garden: a.garden } : {}), ...(a.mediaLink ? { photoLink: a.mediaLink } : {}),
      notes: notes.slice(0, 3000),
    },
  };
}

// The email the landlord receives: the team's message, with the form link where they put
// {form link}, or at the end. Plain text, and HTML with a button.
export function enquiryEmail(subject: string, body: string, link: string) {
  const text = body.includes(LINK_PLACEHOLDER) ? body.split(LINK_PLACEHOLDER).join(link) : `${body.trimEnd()}\n\nFill in the form: ${link}\n`;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const button = `<p style="margin:28px 0"><a href="${escape(link)}" style="background:#1F3D38;color:#FAF7F0;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">Open the property form</a></p>`;
  const paragraphs = body.split(/\n{2,}/).map(part => part.includes(LINK_PLACEHOLDER) ? button : `<p style="margin:0 0 14px">${escape(part).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">${paragraphs}${body.includes(LINK_PLACEHOLDER) ? '' : button}<p style="margin:0;color:#4E6259;font-size:13px">If the button doesn't work, copy this link into your browser: ${escape(link)}</p></div>`;
  return { subject, text, html };
}

// Uploads on the public form: pictures and short videos, checked from their bytes.
export const MAX_ENQUIRY_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ENQUIRY_FILES = 15;
const starts = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
export function enquiryFileType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length < 12 || bytes.length > MAX_ENQUIRY_FILE_BYTES) return null;
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (/^hei[cs]|^mif1|^heix/.test(brand)) return { mime: 'image/heic', ext: 'heic' };
    return brand === 'qt  ' ? { mime: 'video/quicktime', ext: 'mov' } : { mime: 'video/mp4', ext: 'mp4' };
  }
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'video/webm', ext: 'webm' };
  return null;
}
// The link token (64 hex characters, made on the server from the request, so a retried send
// gives the same link) and the hash the database keeps instead of the token.
export const tokenPattern = /^[0-9a-f]{64}$/;
export async function tokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

// Delete (round 6, then Lee: "WE SHOULD BE ABLE TO DELETE ENQUIRIES"): admins and super admins, at any stage up to
// and including the agreement. The button shows only then; the database checks again (unsigned, not live, no invoice,
// bookings or other money) and otherwise answers ENQUIRY_PAST_AGREEMENT or names what stops it. Close stays as it is.
export const DELETABLE_STAGES = ['enquiry', 'estimate', 'reviewing', 'agreement', 'archived'] as const;
export const canDeleteEnquiry = (role: string, e: Pick<ClientEnquiry, 'propertyId' | 'stage'>) =>
  (role === 'admin' || role === 'super_admin') && (!e.propertyId || !e.stage || (DELETABLE_STAGES as readonly string[]).includes(e.stage));
export const deleteEnquiryWarning = (e: Pick<ClientEnquiry, 'propertyId' | 'propertyName' | 'stage'>) => {
  if (!e.propertyId) return 'Delete this enquiry? This removes the enquiry, its answers and photos. This can’t be undone.';
  const place = e.propertyName?.trim() || 'the property', estimate = !!e.stage && e.stage !== 'enquiry';
  return `Delete this enquiry? This also removes the onboarding for ${place}${estimate ? ', its estimate and history' : ' and its history'}. This can’t be undone.`;
};
export const ENQUIRY_PAST_AGREEMENT = 'The agreement is signed or the property is live, so this enquiry can no longer be deleted. Archive it instead.';
