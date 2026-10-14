import { z } from 'zod';
import { agreementReadable } from './agreement-copy';
import type { WorkflowForm } from './workflow-forms';

// The contract uploaded as the agreement template (migration 20261020870000) and the other onboarding settings: what the
// app reads and sends. The database fills the contract in; this file only names things and checks shapes.
export const MAX_AGREEMENT_BYTES = 5 * 1024 * 1024;
// The placeholders a Word contract can use, in this order (the database's private.workspace_agreement_placeholders()).
export const AGREEMENT_PLACEHOLDERS = ['Owner name', 'Owner email', 'Company name', 'Property name', 'Property address', 'Management fee', 'Start date'] as const;
export const PLACEHOLDER_HELP: Record<(typeof AGREEMENT_PLACEHOLDERS)[number], string> = {
  'Owner name': "The owner's name from their account, or from the enquiry",
  'Owner email': "The owner's email address",
  'Company name': "The owner's company, if they gave one on the enquiry",
  'Property name': 'The property as named in the app',
  'Property address': "The property's address",
  'Management fee': 'The management fee on the estimate, for example 18%',
  'Start date': 'The day the agreement is published',
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
export type JourneyAgreement = { agreementFormat?: 'text' | 'outline'; agreementTemplate?: AgreementTemplateRef | null; agreementDraft?: AgreementDraft | null };
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

// The team's "Publish the agreement from the contract" at the agreement step: the agreement the contract in use makes
// for this property, to read before publishing. The database fills it in again when it is published, from the same
// contract (a contract replaced in the meantime is refused), so the owner signs exactly what was shown.
export function agreementTemplateForms(a: { role: string }, j: { propertyId: string; version: number; stage: string; signedName: string | null }): WorkflowForm[] {
  const d = journeyAgreement(j).agreementDraft;
  if (!d?.text || j.stage !== 'agreement' || j.signedName || !['admin', 'super_admin', 'stays'].includes(a.role)) return [];
  const made = `Made from ${d.fileName} (contract ${d.version})` + (d.kind === 'pdf' ? '. The PDF is the agreement; this page goes with it as its cover.' : '.');
  return [{
    key: 'publishAgreementTemplate', title: 'Publish the agreement from the contract', endpoint: 'journeys',
    description: [made, d.missing.length ? `Not recorded yet, so left blank: ${d.missing.join(', ')}.` : '', 'Read it before publishing. The owner signs exactly this wording.', agreementReadable(d.text, 'outline')].filter(Boolean).join('\n\n'),
    fields: [{ name: 'checked', label: 'I have read the agreement above', type: 'checkbox', required: true }],
    build: () => ({ action: 'publishAgreement', propertyId: j.propertyId, version: j.version, templateId: d.templateId }),
  }];
}
