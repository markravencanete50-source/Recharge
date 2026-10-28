import { z } from 'zod';

// Launch Preparation (Recharge Business Plan v1.0, 17/10/26; migration 20261029100000): the whole process of getting a
// property live, as one checklist that follows the owner's onboarding package. Each part shows whether Recharge does it or
// the owner does; parts the package left out are greyed out. The readiness inspection opens once set-up, broadband,
// utilities, safety compliance, licensing and the housekeeper are done; the housekeeper's form makes the property guest
// ready. Admins edit the condition statements, the note under each part and whether the changeover video is required.
// Round two (20261029200000): safety certificates with expiry reminders, and each of Recharge's parts mirrored as a ticket
// on its section's task board (an admin setting). Round three (20261029300000): the furnishing order and install, from the
// owner approving a Furnishing Studio quote to the installer's photos of the finished work.

export const LAUNCH_SECTIONS = ['setUp', 'broadband', 'utilities', 'compliance', 'licensing', 'housekeeper', 'readiness', 'photography', 'garden', 'waste', 'guidebook', 'listing', 'pricing', 'social'] as const;
export type LaunchSection = (typeof LAUNCH_SECTIONS)[number];
export const LAUNCH_SECTION_TITLE: Record<LaunchSection, string> = {
  setUp: 'Property set-up', broadband: 'Broadband', utilities: 'Utilities', compliance: 'Safety compliance', licensing: 'Licensing', housekeeper: 'Housekeeper',
  readiness: 'Readiness inspection', photography: 'Photography', garden: 'Garden maintenance', waste: 'Waste collection', guidebook: 'Guidebook',
  listing: 'List the property', pricing: 'Pricing', social: 'Social media',
};
// The task boards are chosen per section, plus one for the furnishing order, delivery and install.
export const BOARD_KEYS = [...LAUNCH_SECTIONS, 'furnishing'] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];
export const BOARD_TITLE: Record<BoardKey, string> = { ...LAUNCH_SECTION_TITLE, furnishing: 'Furnishing order and install' };
// What has to be done before the readiness inspection opens (the plan's a to f).
export const BEFORE_READINESS: readonly LaunchSection[] = ['setUp', 'broadband', 'utilities', 'compliance', 'licensing', 'housekeeper'];

const statementSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  title: z.string().trim().min(1, 'Give the statement a title').max(120),
  text: z.string().trim().min(1, 'Write the statement').max(1000),
}).strict();
export type ConditionStatement = z.infer<typeof statementSchema>;
export const launchSettingsSchema = z.object({
  condition: z.array(statementSchema).min(1, 'Keep at least one statement').max(30, 'Up to 30 statements')
    .refine(list => new Set(list.map(s => s.key)).size === list.length, 'Each statement needs its own key'),
  notes: z.record(z.enum(LAUNCH_SECTIONS), z.string().trim().max(1000, 'Up to 1,000 characters')),
  requireVideo: z.boolean(),
  // Whether a safety document needs its certificate uploaded, and how many months before expiry the owner is reminded.
  requireComplianceFile: z.boolean(),
  reminderMonths: z.number().int().min(1).max(6),
  // The task board each section's tickets go on (a module id), or '' for none.
  boards: z.record(z.enum(BOARD_KEYS), z.string().max(80)),
  // Whether the installer photographs each furnishing item as it arrives.
  requireReceivedPhotos: z.boolean(),
}).strict();
export type LaunchSettings = z.infer<typeof launchSettingsSchema>;

// The same as the database's default (private.workspace_launch_settings_default()).
export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = {
  condition: [
    { key: "keyboxes", title: "Keyboxes", text: "Both keyboxes open and close with ease and have keys inside." },
    { key: "walls", title: "Walls, ceilings and paintwork", text: "Walls and ceilings are free from noticeable scuffs, stains, cracks, peeling paint, damp and mould. Any decorating or touch-ups have been completed neatly." },
    { key: "floors", title: "Floors and carpets", text: "Floors and carpets are clean and free from stains, damage, loose flooring, lifting edges and trip hazards." },
    { key: "doors", title: "Doors, windows and locks", text: "Doors and windows open, close and lock correctly. Handles are secure, glass is undamaged, seals are in good condition, and all keys have been tested." },
    { key: "furniture", title: "Furniture", text: "Furniture is clean, stable and in good condition, with no loose legs, broken drawers, torn upholstery, sharp edges or visible damage." },
    { key: "beds", title: "Beds and mattresses", text: "Bed frames are secure, with no broken slats or excessive creaking. Mattresses are clean and free from stains, odours and excessive sagging. Sofa beds open and close correctly." },
    { key: "linen", title: "Linen and soft furnishings", text: "Bedding, towels, cushions and curtains are clean and free from stains, tears and excessive wear. Blinds, curtain rails and fittings are secure and work correctly." },
    { key: "kitchen", title: "Kitchen surfaces and fittings", text: "Worktops, cupboards, handles and splashbacks are clean and undamaged. Doors and drawers work correctly, and sealant and grout are in good condition." },
    { key: "appliances", title: "Appliances", text: "The fridge, freezer, oven, hob, extractor, microwave, kettle, toaster and laundry appliances have been tested where provided. All are clean and working, with no leaks, unusual noises, mould or unpleasant smells." },
    { key: "bathrooms", title: "Bathrooms and plumbing", text: "Toilets flush and refill correctly. Taps and showers work properly, and sinks, baths and showers drain freely. There are no leaks, loose fittings, damaged seals, mould or excessive limescale." },
    { key: "heating", title: "Heating, hot water and ventilation", text: "Heating and controls work correctly, hot water reaches all relevant outlets and extractor fans operate. There are no visible leaks or signs of persistent condensation." },
    { key: "lighting", title: "Lighting and visible electrics", text: "Lights and switches work correctly. Lampshades and light fittings are secure. There is no visible damage to sockets, plugs or cables." },
    { key: "wifi", title: "Wi-Fi, TV and guest controls", text: "Wi-Fi and TV functions have been tested. Remotes work, batteries have sufficient power and guest instructions match the equipment provided." },
    { key: "safety", title: "Safety and access", text: "Alarm checks have been completed according to manufacturer instructions. Safety equipment is undamaged and accessible, exit routes are clear, and entrances, stairs and handrails are secure." },
    { key: "exterior", title: "Exterior and communal approach", text: "The entrance and communal approach are tidy, paths are clear, outdoor furniture is stable, the garden is presentable and bins are clean and not overflowing." },
    { key: "presentation", title: "Final presentation", text: "The property is free from dust, hair, rubbish, unpleasant odours and belongings left by previous guests. Furniture is arranged neatly, and all repair or installation work has been fully cleaned up." },
  ],
  notes: {
    setUp: "The property has all the right inventory and is in a rentable condition.",
    housekeeper: "The housekeeper looks after the property between stays and carries out the readiness inspection.",
    readiness: "The first changeover: the housekeeper checks the inventory and every condition statement and records a video.",
    photography: "Booked once the property is guest ready. The photos go on the listing.",
    guidebook: "The guest guidebook, created once the property is guest ready.",
    pricing: "Once the listing is in Hostaway: synced to PriceLabs with the minimum stay, minimum price and base price set.",
    social: "A coming soon post once the photos are in, and a second post once the property is live.",
  },
  requireVideo: true,
  requireComplianceFile: true,
  reminderMonths: 3,
  boards: {
    compliance: 'safety-maintenance', broadband: 'new-property-inspection-board', readiness: 'new-property-inspection-board',
    guidebook: 'new-property-inspection-board', pricing: 'daily-pricing', social: 'listing-health', photography: 'listing-health', waste: 'routine-bin-garden-board',
    furnishing: 'purchase-order',
  },
  requireReceivedPhotos: true,
};
// Sections whose parts can have a board ticket; the others already raise their own onboarding tickets.
export const TICKET_SECTIONS: readonly BoardKey[] = ['furnishing', 'broadband', 'compliance', 'readiness', 'photography', 'waste', 'guidebook', 'pricing', 'social'];
// Certificates: PDF or a photo, up to 15 MB, up to 10 for each document.
export const LAUNCH_FILE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const LAUNCH_FILE_BYTES = 15 * 1024 * 1024;

// A new statement's key, from its title ("Hot tub" is hot_tub), kept apart from the ones already there.
export function statementKey(title: string, taken: readonly string[]): string {
  const base = (title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'statement').slice(0, 30);
  let key = base.length >= 2 ? base : base + '_x', n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
export const launchActionSchema = z.discriminatedUnion('action', [
  // Tick a part by hand, with what it asks for (a date and access, the condition ticks, an expiry date, the licence).
  z.object({ action: z.literal('tick'), requestId: id, propertyId: id, step: z.string().max(80), data: z.record(z.unknown()).optional() }).strict(),
  z.object({ action: z.literal('reopen'), requestId: id, propertyId: id, step: z.string().max(80) }).strict(),
  // Certificates are added through the upload route; removing one goes here.
  z.object({ action: z.literal('removeFile'), requestId: id, propertyId: id, step: z.string().max(80), fileId: id, lineId: id.optional() }).strict(),
  // The furnishing (Recharge sets up): the owner's decision on a quote, then the installer, the order, delivery and install.
  z.object({ action: z.literal('decideQuote'), requestId: id, propertyId: id, projectId: id, decision: z.enum(['accept', 'decline']), note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal('assignInstaller'), requestId: id, propertyId: id, installerId: id, deliveryAddress: z.string().trim().min(5, 'Enter the delivery address').max(500) }).strict(),
  z.object({ action: z.literal('orderLines'), requestId: id, propertyId: id, lines: z.array(z.object({ lineId: id, eta: date }).strict()).min(1).max(400) }).strict(),
  z.object({ action: z.literal('receiveLine'), requestId: id, propertyId: id, lineId: id }).strict(),
  z.object({ action: z.literal('proposeInstall'), requestId: id, propertyId: id, date }).strict(),
  z.object({ action: z.literal('approveInstall'), requestId: id, propertyId: id }).strict(),
  z.object({ action: z.literal('completeInstall'), requestId: id, propertyId: id }).strict(),
  z.object({ action: z.literal('allocate'), requestId: id, propertyId: id, housekeeperId: id }).strict(),
  z.object({ action: z.literal('bookReadiness'), requestId: id, propertyId: id, date }).strict(),
  z.object({
    action: z.literal('submitReadiness'), requestId: id, propertyId: id,
    inventory: z.object({ allPresent: z.boolean(), missing: z.array(z.string().trim().min(1).max(200)).max(50) }).strict(),
    condition: z.array(z.object({ key: z.string(), ok: z.boolean(), note: z.string().max(1000) }).strict()).max(30),
    evidence: z.object({ video: z.string().trim().max(1000), note: z.string().max(2000) }).strict(),
  }).strict(),
  z.object({ action: z.literal('saveSettings'), requestId: id, settings: launchSettingsSchema }).strict(),
]);
export type LaunchAction = z.infer<typeof launchActionSchema>;
export const launchQuerySchema = z.object({ propertyId: id.optional() }).strict();

export const STEP_STATES = ['todo', 'done', 'locked', 'na'] as const;
export type StepState = (typeof STEP_STATES)[number];
const stepSchema = z.object({
  key: z.string(), section: z.enum(LAUNCH_SECTIONS), title: z.string(), who: z.enum(['recharge', 'client']),
  kind: z.enum(['tick', 'date', 'condition', 'expiry', 'licence', 'housekeeper', 'readiness', 'auto', 'furnishingQuote', 'furnishingOrder', 'furnishingReceived', 'furnishingInstall']),
  manual: z.boolean(), state: z.enum(STEP_STATES), lockedBecause: z.string().nullable().default(null),
  data: z.record(z.unknown()).default({}), doneAt: z.string().nullable().default(null), doneByName: z.string().nullable().default(null),
  canTick: z.boolean().default(false), canReopen: z.boolean().default(false),
  files: z.array(z.object({ id, name: z.string(), mime: z.string(), uploadedAt: z.string() })).default([]),
  ticketId: id.nullable().default(null),
});
export type LaunchStep = z.infer<typeof stepSchema>;
const person = z.object({ id, name: z.string() });
const fileSchema = z.object({ id, name: z.string(), mime: z.string(), uploadedAt: z.string() });
export const furnishingSchema = z.object({
  quotes: z.array(z.object({
    id, number: z.string(), status: z.string(), quotePence: z.number(), subtotalPence: z.number(), vatPence: z.number(), notes: z.string().default(''), sentAt: z.string().nullable(),
    lines: z.array(z.object({ name: z.string(), category: z.string(), units: z.number(), pricePence: z.number() })),
  })).default([]),
  projectId: id.nullable().default(null), number: z.string().nullable().default(null), quotePence: z.number().nullable().default(null),
  acceptedAt: z.string().nullable().default(null), acceptedByName: z.string().nullable().default(null),
  invoiceStatus: z.string().nullable().default(null), settledAt: z.string().nullable().default(null),
  installer: person.nullable().default(null), deliveryAddress: z.string().nullable().default(null),
  lines: z.array(z.object({
    id, name: z.string(), category: z.string(), units: z.number(), packs: z.number(), unit: z.string(), supplier: z.string().nullable().default(null), productUrl: z.string().nullable().default(null),
    orderedAt: z.string().nullable(), eta: z.string().nullable(), receivedAt: z.string().nullable(), receivedByName: z.string().nullable(), photos: z.array(fileSchema).default([]),
  })).default([]),
  counts: z.object({ total: z.number(), ordered: z.number(), received: z.number() }).default({ total: 0, ordered: 0, received: 0 }),
  installOn: z.string().nullable().default(null), installProposedByName: z.string().nullable().default(null), installApprovedAt: z.string().nullable().default(null),
  installedAt: z.string().nullable().default(null), installedByName: z.string().nullable().default(null), installPhotos: z.array(fileSchema).default([]),
  canDecide: z.boolean().default(false), canAssign: z.boolean().default(false), canOrder: z.boolean().default(false), canReceive: z.boolean().default(false),
  canProposeInstall: z.boolean().default(false), canApproveInstall: z.boolean().default(false), canCompleteInstall: z.boolean().default(false),
});
export type LaunchFurnishing = z.infer<typeof furnishingSchema>;
export const launchViewSchema = z.object({
  propertyId: id, name: z.string().default(''), address: z.string().nullable().default(null), stage: z.string().default(''),
  steps: z.array(stepSchema).nullable(),
  housekeeper: person.nullable().default(null),
  readiness: z.object({
    bookedOn: z.string(), housekeeperName: z.string().nullable(), bookedByName: z.string().nullable(), submittedAt: z.string().nullable(), submittedByName: z.string().nullable(),
    inventory: z.object({ allPresent: z.boolean(), missing: z.array(z.string()) }).nullable(),
    condition: z.array(z.object({ key: z.string(), ok: z.boolean(), note: z.string().optional() }).passthrough()).nullable(),
    evidence: z.object({ video: z.string().nullable(), note: z.string() }).nullable().default(null), issues: z.number(),
  }).nullable().default(null),
  access: z.string().nullable().default(null),
  isTeam: z.boolean().default(false), isOwner: z.boolean().default(false), isHousekeeper: z.boolean().default(false),
  isInstaller: z.boolean().default(false), isAccounts: z.boolean().default(false), furnishing: furnishingSchema.nullable().default(null),
  canAllocate: z.boolean().default(false), canBookReadiness: z.boolean().default(false), canSubmitReadiness: z.boolean().default(false),
});
export type LaunchView = z.infer<typeof launchViewSchema>;
export const launchReadSchema = z.object({
  settings: launchSettingsSchema, canEditSettings: z.boolean().default(false),
  settingsUpdatedAt: z.string().nullable().default(null), settingsUpdatedByName: z.string().nullable().default(null),
  boardIds: z.array(z.string()).default([]),
  housekeepers: z.array(person).default([]),
  installers: z.array(person).default([]),
  furnishingWork: z.array(z.object({
    propertyId: id, name: z.string(), address: z.string().nullable(), installer: z.boolean(), total: z.number(), ordered: z.number(), received: z.number(),
    installOn: z.string().nullable(), installApproved: z.boolean(),
  })).default([]),
  inspections: z.array(z.object({ propertyId: id, name: z.string(), address: z.string().nullable(), bookedOn: z.string() })).default([]),
  launch: launchViewSchema.nullable().default(null),
});
export type LaunchRead = z.infer<typeof launchReadSchema>;

// Each section's mark on the checklist: green when every part is done (or not needed), grey while locked, amber otherwise.
export function sectionMark(steps: readonly LaunchStep[]): 'done' | 'todo' | 'locked' | 'na' {
  if (steps.every(s => s.state === 'na')) return 'na';
  if (steps.every(s => s.state === 'done' || s.state === 'na')) return 'done';
  if (steps.every(s => s.state === 'locked' || s.state === 'na')) return 'locked';
  return 'todo';
}
// How far along: parts done out of the parts that apply.
export function launchProgress(steps: readonly LaunchStep[]) {
  const counted = steps.filter(s => s.state !== 'na');
  return { done: counted.filter(s => s.state === 'done').length, total: counted.length };
}
