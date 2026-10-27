import { z } from 'zod';
import { isOnboardingVideoLink } from './video-embed';
import { VIDEO_LINK_MESSAGE } from './client-onboarding';

// The onboarding package (Recharge Business Plan v1.0, "Build Onboarding Package"; migration 20261028100000). After the
// owner chooses to go ahead, they build their package like a questionnaire: for each part of getting the property ready,
// whether Recharge does it or they do it themselves. Then who the operator is and where payouts go (this fills in the
// agreement), and a summary of what is included and what they added. "Proceed to signing" submits it; the consultant then
// publishes the agreement, filled in from the package. Every question, note, price and video is an admin's setting.
// After signing, the set-up form asks only what the package did not, and the fee invoice adds the chosen extras.

export const PACKAGE_SECTIONS = ['setUp', 'broadband', 'utilities', 'compliance', 'licensing', 'garden', 'waste'] as const;
export type PackageSection = (typeof PACKAGE_SECTIONS)[number];
export const SECTION_TITLE: Record<PackageSection | 'intro' | 'operator' | 'summary', string> = {
  intro: 'Your onboarding package', setUp: 'Property set-up', broadband: 'Broadband', utilities: 'Utilities', compliance: 'Safety compliance',
  licensing: 'Licensing', garden: 'Garden maintenance', waste: 'Waste collection', operator: 'Operator information', summary: 'Package summary',
};
export const LIMITS = { text: 2000, short: 300, list: 20, price: 10_000_000 } as const;

const text = (max: number = LIMITS.text) => z.string().trim().max(max, `Up to ${max} characters`);
const words = (max: number = LIMITS.text) => text(max).min(1, 'Write the wording');
const video = z.string().trim().max(1000, VIDEO_LINK_MESSAGE).refine(v => v === '' || isOnboardingVideoLink(v), VIDEO_LINK_MESSAGE);
const price = z.number().int('Whole pence').min(0).max(LIMITS.price, 'Up to £100,000');
const items = z.array(words(LIMITS.short)).min(1, 'Add at least one').max(LIMITS.list, `Up to ${LIMITS.list}`);
const part = { on: z.boolean(), question: words(), note: text(), video };

// The settings: the same shape as the database's default (private.workspace_package_settings_default()).
export const packageSettingsSchema = z.object({
  intro: z.object({ note: words(), video }).strict(),
  setUp: z.object({ ...part, rechargeNote: text(), selfNote: text() }).strict(),
  broadband: z.object({ ...part, guide: text(), installQuestion: words(), priceMinor: price }).strict(),
  utilities: z.object({ ...part, understand: words() }).strict(),
  compliance: z.object({ ...part, documents: items, priceMinor: price }).strict(),
  licensing: z.object({ ...part }).strict(),
  garden: z.object({ ...part, quoteQuestion: words(), selfNote: text() }).strict(),
  waste: z.object({ ...part, communalNote: text(), privateNote: text(), monthlyMinor: price }).strict(),
  operator: z.object({ note: words(), video }).strict(),
  summary: z.object({ included: items, note: text() }).strict(),
}).strict();
export type PackageSettings = z.infer<typeof packageSettingsSchema>;

export const DEFAULT_PACKAGE_SETTINGS: PackageSettings = {
  intro: { note: 'We will now guide you through each part of getting your property ready for guests. For each one, choose whether you would like Recharge to do it or to do it yourself. You can come back and change your answers until you sign the agreement.', video: '' },
  setUp: { on: true, question: 'Would you like Recharge to make sure the property has all the right inventory and is in a rentable condition?', note: 'If you would like us to, a furnishing inspection is carried out once your onboarding fee is settled, and we tell you what the property needs.', video: '', rechargeNote: 'We will carry out a furnishing inspection once your onboarding fee is settled.', selfNote: 'You will make sure the property has everything it needs and is in a rentable condition.' },
  broadband: { on: true, question: 'Is there broadband installed at the property?', note: 'Due to the nature of broadband contracts, we do not sign clients up to broadband.', video: '', guide: 'Choose a provider with a fast, reliable connection: at least 50 Mbps for up to three bedrooms and 100 Mbps for larger homes, with no data limit. A 12 or 24 month contract is usual.', installQuestion: 'Once you have signed up to your broadband package, would you like Recharge to install it into the property?', priceMinor: 5000 },
  utilities: { on: true, question: 'Have the utilities been set up at the property, and moved to a credit meter if it was on prepayment?', note: 'Due to the nature of the contracts, we do not sign clients up to utilities. We recommend Octopus for all your properties: they allow several properties on the same log-in, which makes them very easy to access and set up.', video: '', understand: 'I understand the utilities must be set up, on a credit meter, before the property can be guest ready.' },
  compliance: { on: true, question: 'Do you have your safety compliance in place? Choose any you would like Recharge to organise.', note: 'Anything you do not choose, you organise and upload yourself.', video: '', documents: ['EICR', 'Gas Safety', 'PAT Testing', 'EPC', 'Legionella', 'Interlinked smoke, heat and carbon monoxide alarms'], priceMinor: 1000 },
  licensing: { on: true, question: 'Would you like License to Let to contact you about your property licensing?', note: 'Recharge work with License to Let, a specialist short-term let licensing company. There is no financial affiliation with this recommendation. License to Let charge £399 for a full licence application and £299 for a temporary one.', video: '' },
  garden: { on: true, question: 'Does your property have a garden?', note: '', video: '', quoteQuestion: 'Would you like Recharge to obtain a quote for regular garden maintenance?', selfNote: 'We will assume you will look after the garden yourself.' },
  waste: { on: true, question: 'Does your property have private or communal waste bins?', note: '', video: '', communalNote: 'Housekeeping will put the property’s waste in the communal bins.', privateNote: 'Waste from a short-term let counts as commercial waste and is not collected by the council. We partner with a waste collection company who empty the bins every week.', monthlyMinor: 9500 },
  operator: { note: 'Who owns or operates the property, and where your payouts go. Your automatic repair limit and preferred contacts for repair work are set here too. These details fill in your management agreement.', video: '' },
  summary: { included: ['Pricing strategy', 'Listing creation and preparation', 'Photography', 'Property inspection', 'First month’s consumables'], note: 'Check your package, then proceed to signing. You can still change your answers until you sign.' },
};

// The owner's answers (bank details are kept apart, private.workspace_bank_details, and never come back in full).
const yes = z.boolean();
export const packageAnswersSchema = z.object({
  setUp: z.enum(['recharge', 'self']).optional(),
  broadbandInstalled: yes.optional(), broadbandRecharge: yes.optional(),
  utilitiesConnected: yes.optional(), prepaymentMeters: yes.optional(), utilitiesUnderstood: yes.optional(),
  complianceRecharge: z.array(text(LIMITS.short)).max(LIMITS.list).optional(),
  licensingContact: yes.optional(),
  garden: yes.optional(), gardenQuote: yes.optional(),
  waste: z.enum(['communal', 'private']).optional(), wasteRecharge: yes.optional(),
  operatorName: text(200).optional(), repairLimitMinor: z.number().int().min(0).max(10_000_000).optional(), fullRepairPermission: yes.optional(),
  preferredRepairContact: text(2000).optional(),
}).strict();
export type PackageAnswers = z.infer<typeof packageAnswersSchema>;
const bankSchema = z.object({
  accountName: text(200).min(2, 'Enter the account holder'),
  sortCode: z.string().trim().regex(/^\d{2}-?\d{2}-?\d{2}$/, 'Enter the sort code, for example 12-34-56'),
  accountNumber: z.string().trim().regex(/^\d{8}$/, 'Enter the 8-digit account number'),
}).strict();
export type PackageBank = z.infer<typeof bankSchema>;

const id = z.string().uuid();
export const packageActionSchema = z.discriminatedUnion('action', [
  // Saved as they go; `submit` is "Proceed to signing" (everything answered, checked again by the database).
  z.object({ action: z.literal('savePackage'), requestId: id, propertyId: id, answers: packageAnswersSchema, bank: bankSchema.optional(), submit: z.boolean() }).strict(),
  z.object({ action: z.literal('saveSettings'), requestId: id, settings: packageSettingsSchema }).strict(),
]);
export type PackageAction = z.infer<typeof packageActionSchema>;
export const packageReadSchema = z.object({ propertyId: id.optional() }).strict();

const lineSchema = z.object({ label: z.string(), amountMinor: z.number().nullable() });
export const packageViewSchema = z.object({
  settings: packageSettingsSchema,
  canEditSettings: z.boolean().default(false),
  updatedAt: z.string().nullable().default(null), updatedByName: z.string().nullable().default(null),
  // The fee for what is included (the onboarding fee setting, migration 20261027300000); null until an admin sets it.
  baseMinor: z.number().nullable().default(null),
  package: z.object({
    propertyId: id, answers: packageAnswersSchema.passthrough(), submittedAt: z.string().nullable(), updatedAt: z.string().nullable(),
    // Never the account number: its last four digits.
    bank: z.object({ accountName: z.string(), sortCode: z.string(), last4: z.string() }).nullable(),
    canEdit: z.boolean(), stage: z.string(), ownerRepairLimit: z.number().nullable().default(null),
  }).nullable().default(null),
});
export type PackageView = z.infer<typeof packageViewSchema>;

// ---------------------------------------------------------------- what the package comes to
export type PackageLine = z.infer<typeof lineSchema>;
export function packageLines(s: PackageSettings, a: PackageAnswers, baseMinor: number | null) {
  const oneOff: PackageLine[] = [{ label: 'Included: ' + s.summary.included.join(', '), amountMinor: baseMinor }];
  if (s.broadband.on && a.broadbandInstalled === false && a.broadbandRecharge) oneOff.push({ label: 'Broadband installation', amountMinor: s.broadband.priceMinor });
  if (s.compliance.on) for (const doc of (a.complianceRecharge ?? []).filter(d => s.compliance.documents.includes(d))) oneOff.push({ label: 'Organise ' + doc, amountMinor: s.compliance.priceMinor });
  const monthly: PackageLine[] = s.waste.on && a.waste === 'private' && a.wasteRecharge ? [{ label: 'Weekly waste collection', amountMinor: s.waste.monthlyMinor }] : [];
  const extras = oneOff.slice(1).reduce((t, l) => t + (l.amountMinor ?? 0), 0);
  // Recharge does it, or the owner does it (the plan's two symbols), for each part answered.
  const choices: { section: PackageSection; recharge: boolean; label: string }[] = [];
  if (s.setUp.on && a.setUp) choices.push({ section: 'setUp', recharge: a.setUp === 'recharge', label: a.setUp === 'recharge' ? 'Recharge sets up the property' : 'You set up the property' });
  if (s.broadband.on && a.broadbandInstalled !== undefined) choices.push({ section: 'broadband', recharge: a.broadbandInstalled === false && !!a.broadbandRecharge, label: a.broadbandInstalled ? 'Broadband already installed' : a.broadbandRecharge ? 'Recharge installs the broadband' : 'You install the broadband' });
  if (s.utilities.on && a.utilitiesConnected !== undefined) choices.push({ section: 'utilities', recharge: false, label: a.utilitiesConnected && !a.prepaymentMeters ? 'Utilities set up on credit meters' : 'You set up the utilities' });
  if (s.compliance.on && a.complianceRecharge !== undefined) choices.push({ section: 'compliance', recharge: a.complianceRecharge.length > 0, label: a.complianceRecharge.length ? `Recharge organises ${a.complianceRecharge.length} document${a.complianceRecharge.length === 1 ? '' : 's'}` : 'You organise the safety documents' });
  if (s.licensing.on && a.licensingContact !== undefined) choices.push({ section: 'licensing', recharge: a.licensingContact, label: a.licensingContact ? 'License to Let will contact you' : 'You handle licensing' });
  if (s.garden.on && a.garden !== undefined) choices.push({ section: 'garden', recharge: !!a.garden && !!a.gardenQuote, label: !a.garden ? 'No garden' : a.gardenQuote ? 'Recharge gets a garden maintenance quote' : 'You look after the garden' });
  if (s.waste.on && a.waste) choices.push({ section: 'waste', recharge: a.waste === 'private' && !!a.wasteRecharge, label: a.waste === 'communal' ? 'Communal bins' : a.wasteRecharge ? 'Recharge arranges weekly waste collection' : 'You arrange waste collection' });
  return { oneOff, monthly, extrasMinor: extras, totalMinor: baseMinor === null ? null : baseMinor + extras, choices };
}

// What is still to answer before "Proceed to signing" (the database checks the same).
export function packageMissing(s: PackageSettings, a: PackageAnswers, hasBank: boolean): string[] {
  const missing: string[] = [];
  if (s.setUp.on && !a.setUp) missing.push(SECTION_TITLE.setUp);
  if (s.broadband.on && (a.broadbandInstalled === undefined || (a.broadbandInstalled === false && a.broadbandRecharge === undefined))) missing.push(SECTION_TITLE.broadband);
  if (s.utilities.on && (a.utilitiesConnected === undefined || a.prepaymentMeters === undefined || a.utilitiesUnderstood !== true)) missing.push(SECTION_TITLE.utilities);
  if (s.compliance.on && a.complianceRecharge === undefined) missing.push(SECTION_TITLE.compliance);
  if (s.licensing.on && a.licensingContact === undefined) missing.push(SECTION_TITLE.licensing);
  if (s.garden.on && (a.garden === undefined || (a.garden && a.gardenQuote === undefined))) missing.push(SECTION_TITLE.garden);
  if (s.waste.on && (!a.waste || (a.waste === 'private' && a.wasteRecharge === undefined))) missing.push(SECTION_TITLE.waste);
  if (!a.operatorName || a.operatorName.trim().length < 2 || !hasBank || (a.repairLimitMinor === undefined && !a.fullRepairPermission)) missing.push(SECTION_TITLE.operator);
  return missing;
}

// The package's place on the owner's checklist: grey until they go ahead, amber while they build it, green once submitted.
export function packageMark(stage: string, submittedAt: string | null): 'waiting' | 'todo' | 'done' {
  if (submittedAt) return 'done';
  return ['enquiry', 'estimate', 'reviewing', 'archived'].includes(stage) ? 'waiting' : 'todo';
}
