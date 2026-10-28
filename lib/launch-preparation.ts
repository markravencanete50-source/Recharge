import { z } from 'zod';

// Launch Preparation (Recharge Business Plan v1.0, 17/10/26; migration 20261029100000): the whole process of getting a
// property live, as one checklist that follows the owner's onboarding package. Each part shows whether Recharge does it or
// the owner does; parts the package left out are greyed out. The readiness inspection opens once set-up, broadband,
// utilities, safety compliance, licensing and the housekeeper are done; the housekeeper's form makes the property guest
// ready. Admins edit the condition statements, the note under each part and whether the changeover video is required.

export const LAUNCH_SECTIONS = ['setUp', 'broadband', 'utilities', 'compliance', 'licensing', 'housekeeper', 'readiness', 'photography', 'garden', 'waste', 'guidebook', 'listing', 'pricing', 'social'] as const;
export type LaunchSection = (typeof LAUNCH_SECTIONS)[number];
export const LAUNCH_SECTION_TITLE: Record<LaunchSection, string> = {
  setUp: 'Property set-up', broadband: 'Broadband', utilities: 'Utilities', compliance: 'Safety compliance', licensing: 'Licensing', housekeeper: 'Housekeeper',
  readiness: 'Readiness inspection', photography: 'Photography', garden: 'Garden maintenance', waste: 'Waste collection', guidebook: 'Guidebook',
  listing: 'List the property', pricing: 'Pricing', social: 'Social media',
};
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
};

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
  kind: z.enum(['tick', 'date', 'condition', 'expiry', 'licence', 'housekeeper', 'readiness', 'auto']),
  manual: z.boolean(), state: z.enum(STEP_STATES), lockedBecause: z.string().nullable().default(null),
  data: z.record(z.unknown()).default({}), doneAt: z.string().nullable().default(null), doneByName: z.string().nullable().default(null),
  canTick: z.boolean().default(false), canReopen: z.boolean().default(false),
});
export type LaunchStep = z.infer<typeof stepSchema>;
const person = z.object({ id, name: z.string() });
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
  canAllocate: z.boolean().default(false), canBookReadiness: z.boolean().default(false), canSubmitReadiness: z.boolean().default(false),
});
export type LaunchView = z.infer<typeof launchViewSchema>;
export const launchReadSchema = z.object({
  settings: launchSettingsSchema, canEditSettings: z.boolean().default(false),
  settingsUpdatedAt: z.string().nullable().default(null), settingsUpdatedByName: z.string().nullable().default(null),
  housekeepers: z.array(person).default([]),
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
