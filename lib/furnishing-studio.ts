import { z } from 'zod';
import { formatCount, formatMoney } from './format';

// Furnishing Studio (Alex: "we need a product catalogue for anything we're going to purchase, as well as provide quotes to
// clients for the furnished items"; Lee: build it into Recharge, Stays and Management only, with analytics). It replaces the
// standalone prototype that kept its projects in one browser. Everything is shared and kept in the database (migration
// 20261023200000_furnishing_studio.sql):
//  * the catalogue: each product with its room, pack size, cost cap (the most we pay for one retail unit, in pence), an
//    optional retail price for client quotes, the supplier and link, and a quantity rule worked out from the property;
//  * projects (quotes): the property details, the quantities (worked out by the rules, fine-tuned, existing stock deducted),
//    the client quote (markup, fee, VAT), its status, and the shopping list ticked off while buying with the actual spend.
// This file is the one place the rules and the money are worked out for the screens. The database repeats the money sums
// (private.workspace_furnishing_write_lines) so a saved quote never depends on the app's arithmetic.

// --- Who may use it ---------------------------------------------------------------------------------------------------
// The Stays team and Management (admin, super_admin). The database refuses everyone else (private.workspace_furnishing_actor); the
// app mirrors it so nobody else is offered the tool.
export const FURNISHING_ROLES = ['stays', 'admin', 'super_admin'] as const;
export const canUseFurnishingStudio = (role: string | null | undefined) => !!role && (FURNISHING_ROLES as readonly string[]).includes(role);
export const FURNISHING_TITLE = 'Furnishing Studio';
export const FURNISHING_INTRO = 'A shared product catalogue, client quotes worked out from the property, and the shopping list the team ticks off while buying.';

// --- Property details ---------------------------------------------------------------------------------------------------
export const PROPERTY_TYPES = ['flat', 'house', 'cottage', 'bungalow', 'maisonette', 'studio', 'other'] as const;
export const PROPERTY_TYPE_LABEL: Record<(typeof PROPERTY_TYPES)[number], string> = { flat: 'Flat', house: 'House', cottage: 'Cottage', bungalow: 'Bungalow', maisonette: 'Maisonette', studio: 'Studio', other: 'Other' };
export const TV_SETUPS = ['bracket', 'stand', 'none'] as const;
export const TV_LABEL: Record<(typeof TV_SETUPS)[number], string> = { bracket: 'Wall bracket', stand: 'TV stand', none: 'No TV' };
export const WINDOW_COVERINGS = ['curtains', 'blinds', 'none'] as const;
export const COVERING_LABEL: Record<(typeof WINDOW_COVERINGS)[number], string> = { curtains: 'Curtains', blinds: 'Blinds', none: 'None' };
export const COOKERS = ['electric', 'gas', 'induction'] as const;
export const COOKER_LABEL: Record<(typeof COOKERS)[number], string> = { electric: 'Electric', gas: 'Gas', induction: 'Induction' };
export const ZIP_SETUPS = ['double', 'twin'] as const;
export const ZIP_SETUP_LABEL: Record<(typeof ZIP_SETUPS)[number], string> = { double: 'Double', twin: 'Twin' };
export const OPTION_KEYS = ['garden', 'dishwasher', 'tumbleDryer', 'noiseMonitor', 'securityCamera', 'longKeybox'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];
export const OPTION_LABEL: Record<OptionKey, string> = {
  garden: 'Garden', dishwasher: 'Dishwasher', tumbleDryer: 'Tumble dryer', noiseMonitor: 'Noise monitor', securityCamera: 'External security camera', longKeybox: 'Extra-long keybox',
};

// Each count: its group, label, help, starting value and range. The database checks the same ranges
// (private.workspace_furnishing_inputs); a test keeps the two the same.
export const COUNT_KEYS = ['bedrooms', 'guests', 'bathrooms', 'livingRooms', 'exitDoors', 'zipLinkBeds', 'doubleBeds', 'singleBeds', 'sofaBeds',
  'windows', 'exposedBulbs', 'bedsideTables', 'mirrors', 'clothesRails', 'drawers', 'wardrobes'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type CountGroup = 'property' | 'beds' | 'rooms';
export const COUNT_INPUTS: { key: CountKey; group: CountGroup; label: string; help: string; start: number; min: number; max: number }[] = [
  { key: 'bedrooms', group: 'property', label: 'Bedrooms', help: 'Sleeping rooms', start: 1, min: 0, max: 12 },
  { key: 'guests', group: 'property', label: 'Maximum guests', help: 'Advertised occupancy', start: 2, min: 1, max: 24 },
  { key: 'bathrooms', group: 'property', label: 'Bathrooms', help: 'Including shower rooms', start: 1, min: 0, max: 8 },
  { key: 'livingRooms', group: 'property', label: 'Living rooms', help: 'Separate lounge areas', start: 1, min: 0, max: 4 },
  { key: 'exitDoors', group: 'property', label: 'Exit doors', help: 'External doors', start: 1, min: 1, max: 6 },
  { key: 'zipLinkBeds', group: 'beds', label: 'Zip & link beds', help: 'Each complete bed', start: 0, min: 0, max: 12 },
  { key: 'doubleBeds', group: 'beds', label: 'Standard double beds', help: 'Fixed double frames', start: 1, min: 0, max: 12 },
  { key: 'singleBeds', group: 'beds', label: 'Single beds', help: 'Single frames', start: 0, min: 0, max: 16 },
  { key: 'sofaBeds', group: 'beds', label: 'Sofa beds', help: 'Guest sleeping sofas', start: 0, min: 0, max: 4 },
  { key: 'windows', group: 'rooms', label: 'Windows', help: 'Needing curtains or blinds', start: 4, min: 0, max: 40 },
  { key: 'exposedBulbs', group: 'rooms', label: 'Exposed bulbs', help: 'Needing a shade', start: 0, min: 0, max: 30 },
  { key: 'bedsideTables', group: 'rooms', label: 'Bedside tables', help: 'Across all bedrooms', start: 2, min: 0, max: 30 },
  { key: 'mirrors', group: 'rooms', label: 'Full-length mirrors', help: 'Across the property', start: 1, min: 0, max: 12 },
  { key: 'clothesRails', group: 'rooms', label: 'Clothes rails', help: 'Freestanding rails', start: 0, min: 0, max: 12 },
  { key: 'drawers', group: 'rooms', label: 'Chests of drawers', help: 'Across all bedrooms', start: 1, min: 0, max: 12 },
  { key: 'wardrobes', group: 'rooms', label: 'Wardrobes', help: 'Across all bedrooms', start: 1, min: 0, max: 12 },
];

export type StudioInputs = Record<CountKey, number> & Record<OptionKey, boolean> & {
  propertyType: (typeof PROPERTY_TYPES)[number]; zipLinkSetups: (typeof ZIP_SETUPS)[number][];
  tv: (typeof TV_SETUPS)[number]; windowCovering: (typeof WINDOW_COVERINGS)[number]; cooker: (typeof COOKERS)[number];
};
export const DEFAULT_INPUTS: StudioInputs = {
  propertyType: 'flat', ...Object.fromEntries(COUNT_INPUTS.map(i => [i.key, i.start])) as Record<CountKey, number>, zipLinkSetups: [],
  tv: 'bracket', windowCovering: 'curtains', cooker: 'electric',
  garden: false, dishwasher: false, tumbleDryer: false, noiseMonitor: true, securityCamera: false, longKeybox: false,
};
export const clampCount = (key: CountKey, value: number) => {
  const i = COUNT_INPUTS.find(x => x.key === key)!;
  return Math.min(i.max, Math.max(i.min, Math.floor(Number.isFinite(value) ? value : i.start)));
};
// Clean inputs: counts in range, one primary setup per zip & link bed (Double unless chosen), choices known.
export function normaliseInputs(input: Partial<StudioInputs> | null | undefined): StudioInputs {
  const raw = { ...DEFAULT_INPUTS, ...(input ?? {}) } as StudioInputs;
  const out = { ...raw } as StudioInputs;
  for (const i of COUNT_INPUTS) out[i.key] = clampCount(i.key, Number(raw[i.key]));
  for (const k of OPTION_KEYS) out[k] = raw[k] === true;
  if (!(PROPERTY_TYPES as readonly string[]).includes(raw.propertyType)) out.propertyType = 'flat';
  if (!(TV_SETUPS as readonly string[]).includes(raw.tv)) out.tv = 'bracket';
  if (!(WINDOW_COVERINGS as readonly string[]).includes(raw.windowCovering)) out.windowCovering = 'curtains';
  if (!(COOKERS as readonly string[]).includes(raw.cooker)) out.cooker = 'electric';
  const setups = Array.isArray(raw.zipLinkSetups) ? raw.zipLinkSetups : [];
  out.zipLinkSetups = Array.from({ length: out.zipLinkBeds }, (_, n) => setups[n] === 'twin' ? 'twin' : 'double');
  return out;
}

// --- Quantity rules -------------------------------------------------------------------------------------------------
// A rule is "per x of something", rounded up, optionally only when something applies. Linen rotations: every bed has
// three sets (on the bed, in the wash, spare). A zip & link bed is covered both ways: three rotations for its primary
// setup and one for the other (Double: a super king set; Twin: two single sets).
export const LINEN_ROTATIONS = 3;
export const RULE_BASES = ['fixed', 'bedroom', 'bathroom', 'guest', 'livingRoom', 'exitDoor', 'window', 'exposedBulb', 'bedsideTable', 'mirror', 'clothesRail',
  'drawers', 'wardrobe', 'bed', 'singleBed', 'doubleBed', 'sofaBed', 'zipLink', 'singleSize', 'doubleSize', 'pillow', 'singleSets', 'doubleSets', 'kingSets'] as const;
export type RuleBasis = (typeof RULE_BASES)[number];
export const BASIS_LABEL: Record<RuleBasis, [string, string]> = {
  fixed: ['property', 'property'], bedroom: ['bedroom', 'bedrooms'], bathroom: ['bathroom', 'bathrooms'], guest: ['guest', 'guests'], livingRoom: ['living room', 'living rooms'],
  exitDoor: ['exit door', 'exit doors'], window: ['window', 'windows'], exposedBulb: ['exposed bulb', 'exposed bulbs'], bedsideTable: ['bedside table', 'bedside tables'],
  mirror: ['full-length mirror', 'full-length mirrors'], clothesRail: ['clothes rail', 'clothes rails'], drawers: ['chest of drawers', 'chests of drawers'], wardrobe: ['wardrobe', 'wardrobes'],
  bed: ['bed (sofa beds included)', 'beds'], singleBed: ['single bed', 'single beds'], doubleBed: ['standard double bed', 'standard double beds'], sofaBed: ['sofa bed', 'sofa beds'],
  zipLink: ['zip & link bed', 'zip & link beds'], singleSize: ['single sleeping space (zip & link halves included)', 'single spaces'], doubleSize: ['double or sofa bed', 'double or sofa beds'], pillow: ['pillow (2 per single or sofa bed, 4 per double)', 'pillows'],
  singleSets: ['single linen set needed', 'single linen sets'], doubleSets: ['double linen set needed', 'double linen sets'], kingSets: ['super king linen set needed', 'super king linen sets'],
};
export const RULE_WHEN = ['garden', 'dishwasher', 'noDishwasher', 'tumbleDryer', 'noiseMonitor', 'securityCamera', 'longKeybox', 'tvBracket', 'tvStand', 'tvAny',
  'curtains', 'blinds', 'cookerElectric', 'cookerGas', 'cookerInduction', 'cookerNotInduction'] as const;
export type RuleWhen = (typeof RULE_WHEN)[number];
export const WHEN_LABEL: Record<RuleWhen, string> = {
  garden: 'with a garden', dishwasher: 'with a dishwasher', noDishwasher: 'without a dishwasher', tumbleDryer: 'with a tumble dryer', noiseMonitor: 'with a noise monitor',
  securityCamera: 'with an external camera', longKeybox: 'with an extra-long keybox', tvBracket: 'when the TV is wall mounted', tvStand: 'when the TV is on a stand',
  tvAny: 'when there is a TV', curtains: 'with curtains', blinds: 'with blinds', cookerElectric: 'with an electric cooker', cookerGas: 'with a gas cooker', cookerInduction: 'with an induction hob',
  cookerNotInduction: 'with a gas or electric cooker',
};
export type QuantityRule = { basis: RuleBasis; per: number; when: RuleWhen | null };

const zipSets = (i: StudioInputs, primary: 'double' | 'twin') => i.zipLinkSetups.reduce((n, s) => n + (s === primary ? LINEN_ROTATIONS : 1), 0);
export function basisValue(i: StudioInputs, basis: RuleBasis): number {
  switch (basis) {
    case 'fixed': return 1;
    case 'bedroom': return i.bedrooms;
    case 'bathroom': return i.bathrooms;
    case 'guest': return i.guests;
    case 'livingRoom': return i.livingRooms;
    case 'exitDoor': return i.exitDoors;
    case 'window': return i.windows;
    case 'exposedBulb': return i.exposedBulbs;
    case 'bedsideTable': return i.bedsideTables;
    case 'mirror': return i.mirrors;
    case 'clothesRail': return i.clothesRails;
    case 'drawers': return i.drawers;
    case 'wardrobe': return i.wardrobes;
    case 'bed': return i.singleBeds + i.doubleBeds + i.zipLinkBeds + i.sofaBeds;
    case 'singleBed': return i.singleBeds;
    case 'doubleBed': return i.doubleBeds;
    case 'sofaBed': return i.sofaBeds;
    case 'zipLink': return i.zipLinkBeds;
    case 'singleSize': return i.singleBeds + 2 * i.zipLinkBeds;
    case 'doubleSize': return i.doubleBeds + i.sofaBeds;
    case 'pillow': return 2 * (i.singleBeds + i.sofaBeds) + 4 * (i.doubleBeds + i.zipLinkBeds);
    // Twin is two singles, so each rotation is two single sets.
    case 'singleSets': return LINEN_ROTATIONS * i.singleBeds + 2 * zipSets(i, 'twin');
    case 'doubleSets': return LINEN_ROTATIONS * (i.doubleBeds + i.sofaBeds);
    case 'kingSets': return zipSets(i, 'double');
  }
}
export function ruleApplies(i: StudioInputs, when: RuleWhen | null): boolean {
  switch (when) {
    case null: return true;
    case 'noDishwasher': return !i.dishwasher;
    case 'tvBracket': return i.tv === 'bracket';
    case 'tvStand': return i.tv === 'stand';
    case 'tvAny': return i.tv !== 'none';
    case 'curtains': return i.windowCovering === 'curtains';
    case 'blinds': return i.windowCovering === 'blinds';
    case 'cookerElectric': return i.cooker === 'electric';
    case 'cookerGas': return i.cooker === 'gas';
    case 'cookerInduction': return i.cooker === 'induction';
    case 'cookerNotInduction': return i.cooker !== 'induction';
    default: return i[when];
  }
}
// "per" is kept to two decimals (0.5 per guest); the quantity is rounded up.
export const perHundredths = (per: number) => Math.max(0, Math.round(per * 100));
export function ruleQuantity(rule: QuantityRule, inputs: StudioInputs): number {
  if (!ruleApplies(inputs, rule.when)) return 0;
  return Math.floor((perHundredths(rule.per) * basisValue(inputs, rule.basis) + 99) / 100);
}
const perWords = (per: number) => Number.isInteger(per) ? String(per) : per.toLocaleString('en-GB', { maximumFractionDigits: 2 });
// "2 per bedroom", "1 per property, with a garden", "3 per guest".
export function ruleLine(rule: QuantityRule): string {
  const base = rule.basis === 'fixed' ? `${perWords(rule.per)} per property` : `${perWords(rule.per)} per ${BASIS_LABEL[rule.basis][0]}`;
  return rule.when ? `${base}, ${WHEN_LABEL[rule.when]}` : base;
}

// --- Catalogue ----------------------------------------------------------------------------------------------------------
// Whether an item goes on a property's inventory in Launch Preparation (20261029400000): required, additional (the owner
// can remove it), or not at all (labour, for example).
export const INVENTORY_ROLES = ['required', 'additional', 'none'] as const;
export type InventoryRole = (typeof INVENTORY_ROLES)[number];
export const INVENTORY_ROLE_LABEL: Record<InventoryRole, string> = { required: 'Required', additional: 'Additional', none: 'Not on the inventory' };
export const FURNISHING_CATEGORIES = ['bedroom', 'linen', 'bathroom', 'kitchen', 'living', 'windows', 'appliances', 'cleaning', 'safety', 'outdoor', 'labour'] as const;
export type FurnishingCategory = (typeof FURNISHING_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<FurnishingCategory, string> = {
  bedroom: 'Bedrooms', linen: 'Linen & towels', bathroom: 'Bathrooms', kitchen: 'Kitchen & dining', living: 'Living room', windows: 'Windows & lighting',
  appliances: 'Appliances', cleaning: 'Cleaning & laundry', safety: 'Safety & entrance', outdoor: 'Outdoor', labour: 'Labour',
};
export const categoryName = (c: string) => CATEGORY_LABEL[c as FurnishingCategory] ?? 'Other';

const pence = z.number().int().min(0).max(10_000_000);
const https = z.string().trim().max(1000).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'Use a public https:// link');
export const quantityRuleSchema = z.object({ basis: z.enum(RULE_BASES), per: z.number().min(0).max(100), when: z.enum(RULE_WHEN).nullable() }).strict();
export const catalogueItemSchema = z.object({
  id: z.string().uuid(), code: z.string().nullable(), name: z.string(), category: z.enum(FURNISHING_CATEGORIES), unit: z.string(), packSize: z.number().int().min(1),
  costCapPence: z.number().int().min(0), retailPricePence: z.number().int().min(0).nullable(), supplier: z.string(), productUrl: z.string().nullable(),
  rule: quantityRuleSchema, stepPence: z.number().int().min(0), active: z.boolean(), inventory: z.enum(INVENTORY_ROLES).default('required'), sortOrder: z.number().int(), version: z.number().int().positive(),
  updatedAt: z.string().nullable().optional(), updatedBy: z.string().nullable().optional(),
});
export type CatalogueItem = z.infer<typeof catalogueItemSchema>;
export const catalogueSchema = z.array(catalogueItemSchema);

// What a person types for an item (Catalogue → Add or edit).
export const itemFormSchema = z.object({
  name: z.string().trim().min(2, 'Name the product').max(200), category: z.enum(FURNISHING_CATEGORIES), unit: z.string().trim().min(1, 'Say what one unit is, for example each or set of 4').max(60),
  packSize: z.number().int().min(1, 'A pack holds at least 1').max(1000), costCapPence: pence, retailPricePence: pence.nullable(), supplier: z.string().trim().max(120),
  productUrl: https.nullable(), rule: quantityRuleSchema, stepPence: pence, active: z.boolean(), inventory: z.enum(INVENTORY_ROLES),
}).strict();
export type ItemForm = z.infer<typeof itemFormSchema>;
export const emptyItemForm = (): ItemForm => ({ name: '', category: 'bedroom', unit: 'each', packSize: 1, costCapPence: 0, retailPricePence: null, supplier: '', productUrl: null,
  rule: { basis: 'fixed', per: 1, when: null }, stepPence: 0, active: true, inventory: 'required' });
export const itemToForm = (i: CatalogueItem): ItemForm => ({ name: i.name, category: i.category, unit: i.unit, packSize: i.packSize, costCapPence: i.costCapPence,
  retailPricePence: i.retailPricePence, supplier: i.supplier, productUrl: i.productUrl, rule: { ...i.rule }, stepPence: i.stepPence, active: i.active, inventory: i.inventory });

// Pounds typed as text ("12.50", "£1,200") to pence; null when empty or not a sum of money.
export function poundsToPence(text: string): number | null {
  const t = text.replace(/[£,\s]/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const penceToPounds = (minor: number | null | undefined) => minor == null ? '' : (minor / 100).toFixed(2);

// --- Money --------------------------------------------------------------------------------------------------------------
export const VAT_PERCENT = 20;
// Labour and anything else with a step: the price for one bedroom, plus the step for each bedroom after the first.
export const extraBedrooms = (bedrooms: number) => Math.max(bedrooms, 1) - 1;
export const unitCostPence = (item: Pick<CatalogueItem, 'costCapPence' | 'stepPence'>, bedrooms: number) => item.costCapPence + item.stepPence * extraBedrooms(bedrooms);
// What the client is charged per unit before the markup: the retail price when set, else the cost cap.
export const unitPricePence = (item: Pick<CatalogueItem, 'costCapPence' | 'retailPricePence' | 'stepPence'>, bedrooms: number) => (item.retailPricePence ?? item.costCapPence) + item.stepPence * extraBedrooms(bedrooms);
// Retail units to buy: what is needed less the stock already there, in whole packs.
export const packsFor = (units: number, existing: number, packSize: number) => Math.ceil(Math.max(units - existing, 0) / Math.max(packSize, 1));
// The markup in basis points (12.5% is 1250); prices round to the nearest penny, halves up. The database does the same.
export const markupBps = (percent: number) => Math.round(percent * 100);
export const markedUp = (minor: number, percent: number) => Math.floor((minor * (10_000 + markupBps(percent)) + 5_000) / 10_000);
export const vatOn = (minor: number) => Math.floor((minor * VAT_PERCENT + 50) / 100);

// One line of an estimate, as the screens show it and as it is saved.
export type EstimateLine = {
  itemId: string; name: string; category: FurnishingCategory; unit: string; packSize: number; supplier: string; productUrl: string | null; rule: string;
  suggestedUnits: number; units: number; existingUnits: number; packs: number;
  unitCostPence: number; unitPricePence: number; costPence: number; pricePence: number;
  // After a quote is sent: the saved line, ticked off while buying.
  lineId?: string; purchased?: boolean; actualPence?: number | null; purchasedBy?: string | null; purchasedAt?: string | null;
};
export type Override = { units?: number; existing?: number };
export type QuoteSettings = { markupPercent: number; feePence: number; vat: boolean };

// The estimate for a draft: every active catalogue item, quantities from its rule unless fine-tuned, stock deducted.
// Items with nothing needed are left out unless someone set a quantity or stock for them.
export function estimateLines(catalogue: readonly CatalogueItem[], inputs: StudioInputs, overrides: Record<string, Override>, settings: Pick<QuoteSettings, 'markupPercent'>): EstimateLine[] {
  return catalogue.filter(i => i.active).map(item => {
    const suggestedUnits = ruleQuantity(item.rule, inputs), o = overrides[item.id] ?? {};
    const units = clampUnits(o.units ?? suggestedUnits), existingUnits = Math.min(clampUnits(o.existing ?? 0), units);
    const packs = packsFor(units, existingUnits, item.packSize), cost = unitCostPence(item, inputs.bedrooms), price = unitPricePence(item, inputs.bedrooms);
    return { itemId: item.id, name: item.name, category: item.category, unit: item.unit, packSize: item.packSize, supplier: item.supplier, productUrl: item.productUrl, rule: ruleLine(item.rule),
      suggestedUnits, units, existingUnits, packs, unitCostPence: cost, unitPricePence: price, costPence: packs * cost, pricePence: packs * markedUp(price, settings.markupPercent) };
  }).filter(l => l.suggestedUnits > 0 || l.units > 0 || l.existingUnits > 0);
}
export const MAX_UNITS = 10_000;
export const clampUnits = (n: number) => Math.min(MAX_UNITS, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

export type EstimateTotals = {
  estimatePence: number; toPurchase: number; shoppingLines: number; linkedLines: number;
  subtotalPence: number; feePence: number; netPence: number; vatPence: number; quotePence: number; marginPence: number;
};
export function estimateTotals(lines: readonly EstimateLine[], settings: QuoteSettings): EstimateTotals {
  const buying = lines.filter(l => l.packs > 0);
  const estimatePence = buying.reduce((t, l) => t + l.costPence, 0), subtotalPence = buying.reduce((t, l) => t + l.pricePence, 0);
  const feePence = Math.max(0, Math.floor(settings.feePence || 0)), netPence = subtotalPence + feePence, vatPence = settings.vat ? vatOn(netPence) : 0;
  return { estimatePence, toPurchase: buying.reduce((t, l) => t + l.packs, 0), shoppingLines: buying.length, linkedLines: buying.filter(l => !!l.productUrl).length,
    subtotalPence, feePence, netPence, vatPence, quotePence: netPence + vatPence, marginPence: netPence - estimatePence };
}
// The three figures at the top of a project.
export function headerStats(t: EstimateTotals) {
  return [
    { key: 'estimate', label: 'Maximum estimate', value: formatMoney(t.estimatePence), detail: 'From the catalogue cost caps' },
    { key: 'purchase', label: 'To purchase', value: formatCount(t.toPurchase), detail: 'Retail units, sets and packs' },
    { key: 'links', label: 'Shopping links', value: `${formatCount(t.linkedLines)} / ${formatCount(t.shoppingLines)}`, detail: 'Lines with a product link' },
  ];
}

// --- Projects -----------------------------------------------------------------------------------------------------------
export const PROJECT_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'purchasing', 'complete'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const STATUS_LABEL: Record<ProjectStatus, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', purchasing: 'Purchasing', complete: 'Complete' };
export const STATUS_TONE: Record<ProjectStatus, 'good' | 'wait' | 'bad' | 'plain'> = { draft: 'plain', sent: 'wait', accepted: 'good', declined: 'bad', purchasing: 'wait', complete: 'good' };
// Where a quote can go next. The database allows exactly these moves (private.workspace_furnishing_action, moveProject).
export const NEXT_STATUS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['sent'], sent: ['accepted', 'declined', 'draft'], declined: ['draft'], accepted: ['purchasing'], purchasing: ['complete'], complete: [],
};
export const MOVE_LABEL: Record<ProjectStatus, string> = { draft: 'Reopen to edit', sent: 'Mark sent to client', accepted: 'Client accepted', declined: 'Client declined', purchasing: 'Start purchasing', complete: 'Mark complete' };
// Quantities and prices can be changed only on a draft; a sent quote keeps the catalogue prices it was sent with.
export const editable = (status: ProjectStatus) => status === 'draft';
// Purchases are ticked off once the client accepts.
export const buying = (status: ProjectStatus) => status === 'accepted' || status === 'purchasing' || status === 'complete';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const projectLineSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), position: z.number().int(), name: z.string(), category: z.enum(FURNISHING_CATEGORIES), unit: z.string(), packSize: z.number().int(),
  supplier: z.string(), productUrl: z.string().nullable(), unitCostPence: z.number().int(), unitPricePence: z.number().int(), suggestedUnits: z.number().int(), units: z.number().int(),
  existingUnits: z.number().int(), packs: z.number().int(), costPence: z.number().int(), pricePence: z.number().int(), purchased: z.boolean(), actualPence: z.number().int().nullable(),
  purchasedAt: z.string().nullable(), purchasedBy: z.string().nullable(),
});
export type ProjectLine = z.infer<typeof projectLineSchema>;
const historySchema = z.object({ action: z.string(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), at: z.string(), by: z.string().nullable() });
export const projectSummarySchema = z.object({
  id: z.string().uuid(), number: z.string(), status: z.enum(PROJECT_STATUSES), archived: z.boolean(), clientName: z.string(), clientEmail: z.string().nullable(),
  propertyId: z.string().uuid().nullable(), propertyName: z.string().nullable(), address: z.string(), estimateOn: isoDay, bedrooms: z.number().int(),
  estimatePence: z.number().int(), quotePence: z.number().int(), toPurchase: z.number().int(), purchasedLines: z.number().int(), shoppingLines: z.number().int(),
  version: z.number().int().positive(), updatedAt: z.string(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export const projectSchema = projectSummarySchema.extend({
  inputs: z.record(z.string(), z.unknown()), markupPercent: z.number(), feePence: z.number().int(), vat: z.boolean(), notes: z.string(),
  subtotalPence: z.number().int(), vatPence: z.number().int(), actualPence: z.number().int(), sentAt: z.string().nullable(),
  lines: z.array(projectLineSchema), history: z.array(historySchema),
});
export type Project = z.infer<typeof projectSchema>;
export const projectsSchema = z.array(projectSummarySchema);
export const propertyChoiceSchema = z.array(z.object({ id: z.string().uuid(), name: z.string(), address: z.string(), bedrooms: z.number().int() }));
export type PropertyChoice = z.infer<typeof propertyChoiceSchema>[number];

// A saved project's lines back as the screen's overrides: a quantity someone changed, and stock they deducted.
export function overridesFrom(lines: readonly Pick<ProjectLine, 'itemId' | 'units' | 'suggestedUnits' | 'existingUnits'>[]): Record<string, Override> {
  const out: Record<string, Override> = {};
  for (const l of lines) {
    const o: Override = {};
    if (l.units !== l.suggestedUnits) o.units = l.units;
    if (l.existingUnits > 0) o.existing = l.existingUnits;
    if (Object.keys(o).length) out[l.itemId] = o;
  }
  return out;
}
// A sent quote's saved lines as estimate lines (the prices it was sent with).
export const savedLines = (lines: readonly ProjectLine[]): EstimateLine[] => lines.map(l => ({
  itemId: l.itemId, name: l.name, category: l.category, unit: l.unit, packSize: l.packSize, supplier: l.supplier, productUrl: l.productUrl, rule: '',
  suggestedUnits: l.suggestedUnits, units: l.units, existingUnits: l.existingUnits, packs: l.packs, unitCostPence: l.unitCostPence, unitPricePence: l.unitPricePence,
  costPence: l.costPence, pricePence: l.pricePence, lineId: l.id, purchased: l.purchased, actualPence: l.actualPence, purchasedBy: l.purchasedBy, purchasedAt: l.purchasedAt,
}));

// --- Reads and actions (GET/POST /api/{workspace,mobile}/furnishing) -----------------------------------------------------
export const FURNISHING_SECTIONS = ['catalogue', 'projects', 'project', 'properties', 'analytics'] as const;
export const furnishingReadSchema = z.object({
  section: z.enum(FURNISHING_SECTIONS), id: z.string().uuid().optional(), from: isoDay.optional(), to: isoDay.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.section === 'project' && !v.id) ctx.addIssue({ code: 'custom', message: 'Choose a project' });
  if (v.section !== 'project' && v.id) ctx.addIssue({ code: 'custom', message: 'A project is only for one project' });
  if (v.section === 'analytics') {
    if (!v.from || !v.to) ctx.addIssue({ code: 'custom', message: 'Choose the dates' });
    else if (v.to < v.from || Date.parse(v.to) - Date.parse(v.from) > 731 * 86_400_000) ctx.addIssue({ code: 'custom', message: 'Choose up to two years' });
  } else if (v.from || v.to) ctx.addIssue({ code: 'custom', message: 'Dates are only for the analytics' });
});
export type FurnishingRead = z.infer<typeof furnishingReadSchema>;
export const catalogueQuery = () => ({ section: 'catalogue' });
export const projectsQuery = () => ({ section: 'projects' });
export const projectQuery = (id: string) => ({ section: 'project', id });
export const propertiesQuery = () => ({ section: 'properties' });
export const analyticsQuery = (from: string, to: string) => ({ section: 'analytics', from, to });

const id = z.string().uuid();
const version = z.number().int().positive();
const countValue = z.number().int().min(0).max(100);
export const inputsSchema = z.object({
  propertyType: z.enum(PROPERTY_TYPES), ...Object.fromEntries(COUNT_KEYS.map(k => [k, countValue])) as Record<CountKey, typeof countValue>,
  zipLinkSetups: z.array(z.enum(ZIP_SETUPS)).max(12), tv: z.enum(TV_SETUPS), windowCovering: z.enum(WINDOW_COVERINGS), cooker: z.enum(COOKERS),
  ...Object.fromEntries(OPTION_KEYS.map(k => [k, z.boolean()])) as Record<OptionKey, z.ZodBoolean>,
}).strict();
export const saveLineSchema = z.object({ itemId: id, suggestedUnits: z.number().int().min(0).max(MAX_UNITS), units: z.number().int().min(0).max(MAX_UNITS), existingUnits: z.number().int().min(0).max(MAX_UNITS) }).strict();
export const furnishingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveItem'), requestId: id, id: id.optional(), version: version.optional(), name: z.string().trim().min(2).max(200), category: z.enum(FURNISHING_CATEGORIES),
    unit: z.string().trim().min(1).max(60), packSize: z.number().int().min(1).max(1000), costCapPence: pence, retailPricePence: pence.nullable(), supplier: z.string().trim().max(120),
    productUrl: https.nullable(), rule: quantityRuleSchema, stepPence: pence, active: z.boolean(), inventory: z.enum(INVENTORY_ROLES).optional() }).strict(),
  z.object({ action: z.literal('saveProject'), requestId: id, id: id.optional(), version: version.optional(), clientName: z.string().trim().min(2).max(200),
    clientEmail: z.string().trim().email().max(320).nullable(), propertyId: id.nullable(), address: z.string().trim().max(500), estimateOn: isoDay, inputs: inputsSchema,
    markupPercent: z.number().min(0).max(200), feePence: pence, vat: z.boolean(), notes: z.string().trim().max(2000), lines: z.array(saveLineSchema).max(400) }).strict(),
  z.object({ action: z.literal('moveProject'), requestId: id, id, version, status: z.enum(PROJECT_STATUSES) }).strict(),
  z.object({ action: z.literal('archiveProject'), requestId: id, id, version, archived: z.boolean() }).strict(),
  z.object({ action: z.literal('tickLine'), requestId: id, id, lineId: id, purchased: z.boolean(), actualPence: pence.nullable() }).strict(),
]);
export type FurnishingAction = z.infer<typeof furnishingActionSchema>;

// The save for a draft: the details and every line the estimate shows (fine-tuned quantities and stock included).
export type ProjectForm = {
  id: string | null; version: number | null; clientName: string; clientEmail: string; propertyId: string | null; address: string; estimateOn: string;
  inputs: StudioInputs; markupPercent: number; feePence: number; vat: boolean; notes: string; overrides: Record<string, Override>;
};
export const emptyProjectForm = (today: string): ProjectForm => ({ id: null, version: null, clientName: '', clientEmail: '', propertyId: null, address: '', estimateOn: today,
  inputs: normaliseInputs(DEFAULT_INPUTS), markupPercent: 0, feePence: 0, vat: false, notes: '', overrides: {} });
export function formFromProject(p: Project): ProjectForm {
  return { id: p.id, version: p.version, clientName: p.clientName, clientEmail: p.clientEmail ?? '', propertyId: p.propertyId, address: p.address, estimateOn: p.estimateOn,
    inputs: normaliseInputs(p.inputs as Partial<StudioInputs>), markupPercent: p.markupPercent, feePence: p.feePence, vat: p.vat, notes: p.notes, overrides: overridesFrom(p.lines) };
}
export function saveProjectAction(form: ProjectForm, lines: readonly EstimateLine[], requestId: string): Extract<FurnishingAction, { action: 'saveProject' }> {
  return {
    action: 'saveProject', requestId, ...(form.id ? { id: form.id, version: form.version ?? 1 } : {}), clientName: form.clientName.trim(),
    clientEmail: form.clientEmail.trim() || null, propertyId: form.propertyId, address: form.address.trim(), estimateOn: form.estimateOn, inputs: normaliseInputs(form.inputs),
    markupPercent: form.markupPercent, feePence: form.feePence, vat: form.vat, notes: form.notes.trim(),
    lines: lines.map(l => ({ itemId: l.itemId, suggestedUnits: l.suggestedUnits, units: l.units, existingUnits: l.existingUnits })),
  };
}
// What stops a save, in plain words, or null.
export function projectFormError(form: ProjectForm): string | null {
  if (form.clientName.trim().length < 2) return 'Enter the client name.';
  if (form.clientEmail.trim() && !z.string().email().safeParse(form.clientEmail.trim()).success) return 'Check the client email address.';
  if (!form.propertyId && form.address.trim().length < 3) return 'Choose a property or type the address or project name.';
  if (!(form.markupPercent >= 0 && form.markupPercent <= 200)) return 'The markup can be 0% to 200%.';
  return null;
}

// --- Shopping list ------------------------------------------------------------------------------------------------------
export type ShoppingGroup = { key: string; title: string; lines: EstimateLine[]; costPence: number; purchased: number };
// Lines to buy, grouped by supplier (or by room), suppliers A to Z with "No supplier yet" last.
export function shoppingGroups(lines: readonly EstimateLine[], by: 'supplier' | 'room'): ShoppingGroup[] {
  const groups = new Map<string, ShoppingGroup>();
  for (const l of lines.filter(x => x.packs > 0)) {
    const key = by === 'room' ? l.category : (l.supplier.trim() || '');
    const title = by === 'room' ? categoryName(l.category) : (l.supplier.trim() || 'No supplier yet');
    const g = groups.get(key) ?? { key: key || 'none', title, lines: [], costPence: 0, purchased: 0 };
    g.lines.push(l); g.costPence += l.costPence; g.purchased += l.purchased ? 1 : 0;
    groups.set(key, g);
  }
  const order = (g: ShoppingGroup) => by === 'room' ? FURNISHING_CATEGORIES.indexOf(g.key as FurnishingCategory) : 0;
  return [...groups.values()].sort((a, b) => by === 'room' ? order(a) - order(b) : (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.title.localeCompare(b.title, 'en-GB')));
}
// Bought so far against the estimate: only lines with an actual spend recorded are compared.
export function spendSummary(lines: readonly EstimateLine[]) {
  const recorded = lines.filter(l => l.packs > 0 && l.purchased && l.actualPence != null);
  const estimatePence = recorded.reduce((t, l) => t + l.costPence, 0), actualPence = recorded.reduce((t, l) => t + (l.actualPence ?? 0), 0);
  return { purchased: lines.filter(l => l.packs > 0 && l.purchased).length, toBuy: lines.filter(l => l.packs > 0).length, recorded: recorded.length, estimatePence, actualPence, variancePence: actualPence - estimatePence };
}
export const varianceLine = (variancePence: number, recorded: number) => !recorded ? 'No actual spend recorded yet.'
  : variancePence === 0 ? `On estimate across ${plural(recorded)}.` : `${formatMoney(Math.abs(variancePence))} ${variancePence > 0 ? 'over' : 'under'} the estimate across ${plural(recorded)}.`;
const plural = (n: number) => `${formatCount(n)} ${n === 1 ? 'line' : 'lines'}`;

// --- Analytics ------------------------------------------------------------------------------------------------------------
const n = z.number().int().nonnegative();
export const analyticsSchema = z.object({
  from: isoDay, to: isoDay, projects: n,
  byStatus: z.array(z.object({ status: z.enum(PROJECT_STATUSES), projects: n, quotePence: z.number().int() })),
  sent: n, accepted: n, declined: n, conversionPercent: z.number().nullable(),
  quotedPence: z.number().int(), acceptedPence: z.number().int(), averagePerBedroomPence: z.number().int().nullable(), averageQuotePence: z.number().int().nullable(),
  spend: z.object({ purchasedLines: n, recordedLines: n, estimatePence: z.number().int(), actualPence: z.number().int(), variancePence: z.number().int(), variancePercent: z.number().nullable() }),
  topByUnits: z.array(z.object({ itemId: z.string().uuid(), name: z.string(), category: z.string(), packs: n, spendPence: z.number().int() })),
  topBySpend: z.array(z.object({ itemId: z.string().uuid(), name: z.string(), category: z.string(), packs: n, spendPence: z.number().int() })),
  byMonth: z.array(z.object({ month: z.string(), projects: n, sent: n, accepted: n, quotedPence: z.number().int() })),
});
export type FurnishingAnalytics = z.infer<typeof analyticsSchema>;
export const monthName = (month: string) => new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
