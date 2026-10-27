import { z } from 'zod';
import type { WorkflowForm } from './workflow-forms';

// The contract uploaded as the agreement template (migration 20261020870000) and the other onboarding settings: what the
// app reads and sends. The database fills the contract in; this file only names things and checks shapes.
export const MAX_AGREEMENT_BYTES = 5 * 1024 * 1024;
// An agreement's wording, typed, uploaded or edited from the contract (migration 20261024100000).
export const MAX_AGREEMENT_CHARACTERS = 200000;
export const PDF_WORDING_MESSAGE = "A PDF can't be edited word by word. Upload the Word version (.docx) to edit its wording, or add the PDF as the contract in Onboarding settings.";
// The placeholders a Word contract can use, in this order (the database's private.workspace_agreement_placeholders()).
// The last eight come from the owner's onboarding package (migration 20261028100000); they are empty until it is in.
export const AGREEMENT_PLACEHOLDERS = ['Owner name', 'Owner email', 'Company name', 'Property name', 'Property address', 'Management fee', 'Start date',
  'Operator name', 'Payout account name', 'Payout sort code', 'Payout account ending', 'Repair limit', 'Preferred repair contact', 'Onboarding package', 'Onboarding fee'] as const;
export const PLACEHOLDER_HELP: Record<(typeof AGREEMENT_PLACEHOLDERS)[number], string> = {
  'Owner name': "The owner's name from their account, or from the enquiry",
  'Owner email': "The owner's email address",
  'Company name': "The owner's company, if they gave one on the enquiry",
  'Property name': 'The property as named in the app',
  'Property address': "The property's address",
  'Management fee': 'The management fee on the estimate, for example 18%',
  'Start date': 'The day the agreement is published',
  'Operator name': 'The person or business who owns or operates the property, from the onboarding package',
  'Payout account name': 'The payout account holder, from the onboarding package',
  'Payout sort code': 'The payout sort code, for example 12-34-56',
  'Payout account ending': 'The last four digits of the payout account number (the full number is never shown)',
  'Repair limit': 'The automatic repair limit, for example "£200.00 per repair" or "No limit"',
  'Preferred repair contact': 'Who the owner prefers for repair work',
  'Onboarding package': 'What is included and what the owner added, with prices',
  'Onboarding fee': 'The onboarding fee: what is included plus the extras, for example "£535.00 + VAT"',
};
export const placeholderToken = (name: string) => `{{${name}}}`;
export const DEFAULT_OWN_COST_CATEGORIES = ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Other'] as const;
export const MAX_OWN_COST_CATEGORIES = 12;

// What a file is from its first bytes, not its name: a Word document is a zip, a PDF starts "%PDF-".
export function agreementFileType(bytes: Uint8Array): { kind: 'docx' | 'pdf'; mime: string } | null {
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { kind: 'pdf', mime: 'application/pdf' };
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  return null;
}
// Why a file that is neither a zip nor a PDF was refused, when that can be told. Word saves a password-protected document
// and an old Word 97-2003 document (.doc) the same way, as an "OLE" compound file (it starts D0 CF 11 E0); a protected
// one holds an "EncryptionInfo" stream. Both would otherwise get "upload a Word document", which a protected .docx is.
export const PASSWORD_MESSAGE = 'This document is password protected. Remove the password and upload it again.';
export const OLD_WORD_MESSAGE = 'This is an older Word document (.doc). Open it in Word, save it as a Word Document (.docx) or a PDF, and upload that.';
export function agreementFileProblem(bytes: Uint8Array): string | null {
  if (!(bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) return null;
  const marker = new Uint8Array([...'EncryptionInfo'].flatMap(c => [c.charCodeAt(0), 0]));
  for (let i = 0, end = Math.min(bytes.length, 1024 * 1024) - marker.length; i <= end; i++) {
    let j = 0;
    while (j < marker.length && bytes[i + j] === marker[j]) j++;
    if (j === marker.length) return PASSWORD_MESSAGE;
  }
  return OLD_WORD_MESSAGE;
}
export const fileSizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

const templateSchema = z.object({
  id: z.string().uuid(), version: z.number().int(), kind: z.enum(['docx', 'pdf']), fileName: z.string(), bytes: z.number(), sha256: z.string(),
  uploadedAt: z.string(), uploadedByName: z.string().nullable(), placeholders: z.array(z.string()), unknown: z.array(z.string()), characters: z.number(), agreements: z.number(),
});
export const onboardingSettingsSchema = z.object({
  template: templateSchema.nullable(),
  history: z.array(z.object({ id: z.string().uuid(), version: z.number().int(), kind: z.enum(['docx', 'pdf']), fileName: z.string(), uploadedAt: z.string(), inUse: z.boolean(), agreements: z.number() })),
  supported: z.array(z.string()), companyDetails: z.string(), ownCostCategories: z.array(z.string()), updatedAt: z.string(),
});
export type OnboardingSettings = z.infer<typeof onboardingSettingsSchema>;
export type AgreementTemplate = NonNullable<OnboardingSettings['template']>;

// The agreement parts of a journey (lib/workspace-view.ts): the format and contract of the published agreement, and for
// the team at the agreement step, the agreement the contract in use would make.
export const agreementTemplateRefSchema = z.object({ id: z.string().uuid(), version: z.number(), kind: z.enum(['docx', 'pdf']), fileName: z.string(), bytes: z.number(), sha256: z.string() });
export const agreementDraftSchema = z.object({ templateId: z.string().uuid(), version: z.number(), kind: z.enum(['docx', 'pdf']), fileName: z.string(), text: z.string().nullable(), missing: z.array(z.string()) });
export type AgreementTemplateRef = z.infer<typeof agreementTemplateRefSchema>;
export type AgreementDraft = z.infer<typeof agreementDraftSchema>;
export type JourneyAgreement = { agreementFormat?: 'text' | 'outline'; signatureImage?: string | null; agreementSentAt?: string | null; agreementTemplate?: AgreementTemplateRef | null; agreementDraft?: AgreementDraft | null };
export const journeyAgreement = (j: object): JourneyAgreement => j as JourneyAgreement;

export const onboardingSettingsActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stopTemplate') }).strict(),
  z.object({ action: z.literal('useTemplate'), templateId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('saveCompanyDetails'), companyDetails: z.string().trim().max(2000, "Recharge's details can be up to 2,000 characters") }).strict(),
  z.object({ action: z.literal('saveCostCategories'), categories: z.array(z.string().trim().min(1, 'Name each category').max(60, 'Up to 60 characters')).min(1, 'Keep at least one category').max(MAX_OWN_COST_CATEGORIES, `Up to ${MAX_OWN_COST_CATEGORIES} categories`) }).strict(),
]).superRefine((v, context) => {
  if (v.action === 'saveCostCategories' && new Set(v.categories.map(c => c.toLowerCase())).size !== v.categories.length) context.addIssue({ code: 'custom', message: 'Each category once' });
});
export type OnboardingSettingsAction = z.infer<typeof onboardingSettingsActionSchema>;

// How the wording is written when it is edited in the app: the outline format of lib/agreement-copy.ts.
export const OUTLINE_HELP = 'Change any words. A line starting # is a heading, ## a smaller heading, - a bullet point and 1. a numbered point; a blank line starts a new paragraph.';
// The team's "Publish the agreement from the contract" at the agreement step: the agreement the contract in use makes
// for this property, to read before publishing. The database fills it in again when it is published, from the same
// contract (a contract replaced in the meantime is refused), so the owner signs exactly what was shown.
// {{Start date}} is filled in with the day it is drafted (London). The team can pick another start date: it replaces
// that date wherever the wording shows it.
export const agreementDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
export const londonToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function withStartDate(text: string, from: string, to: string): string {
  return from === to ? text : text.split(agreementDate(from)).join(agreementDate(to));
}
export function agreementTemplateForms(a: { role: string }, j: { propertyId: string; version: number; stage: string; signedName: string | null }, now = new Date()): WorkflowForm[] {
  const d = journeyAgreement(j).agreementDraft;
  if (!d?.text || j.stage !== 'agreement' || j.signedName || !['admin', 'super_admin', 'stays'].includes(a.role)) return [];
  const drafted = d.text, today = londonToday(now), dated = drafted.includes(agreementDate(today));
  const made = `Made from ${d.fileName} (contract ${d.version})` + (d.kind === 'pdf' ? '. The PDF is the agreement; this page goes with it as its cover.' : '.');
  return [{
    key: 'publishAgreementTemplate', title: 'Publish the agreement from the contract', endpoint: 'journeys',
    description: [made, d.missing.length ? `Not recorded yet, so left blank: ${d.missing.join(', ')}.` : '', 'Read it and change any wording before publishing. The owner signs exactly the wording below.'].filter(Boolean).join('\n\n'),
    fields: [
      ...(dated ? [{ name: 'startOn', label: 'Start date', type: 'date' as const, required: true, defaultValue: today,
        help: `The agreement shows ${agreementDate(today)} as the start date. Pick another day and it replaces that date wherever it appears.` }] : []),
      { name: 'agreement', label: 'The agreement', type: 'textarea', required: true, defaultValue: drafted, help: OUTLINE_HELP },
      { name: 'checked', label: 'I have read the agreement above', type: 'checkbox', required: true },
    ],
    // Only changed wording (or another start date) is sent; otherwise the database fills the agreement in from the contract again.
    build: v => {
      const typed = typeof v.agreement === 'string' ? v.agreement : drafted;
      const startOn = dated && typeof v.startOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.startOn) ? v.startOn : today;
      const agreement = withStartDate(typed, today, startOn);
      return { action: 'publishAgreement', propertyId: j.propertyId, version: j.version, templateId: d.templateId,
        ...(agreement.trim() !== drafted.trim() ? { agreement } : {}) };
    },
  }];
}
