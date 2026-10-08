// Recharge furnishing calculator: turns a property layout into a category-by-category quantity
// list for a guest-ready short-stay setup. Every item carries the rule it was calculated from, so
// owners can see why each number is what it is. The rules live in one table below to make the
// Recharge furnishing guidance easy to adjust.
export type Layout = {
  address: string;
  bedrooms: number; bathrooms: number; livingRooms: number; kitchens: number; guests: number; windows: number; exitDoors: number;
  singleBeds: number; doubleBeds: number; zipLinkBeds: number; sofaBeds: number; bedsideTables: number; exposedBulbs: number;
};
export type Count = Exclude<keyof Layout, 'address'>;
export type Line = { item: string; rule: string; quantity: number };
export type Category = { id: string; label: string; title: string; lines: Line[] };
export type FurnishingList = { beds: number; categories: Category[]; total: number };

// Each input: its group, label, help text, starting value and allowed range.
export const INPUTS: { key: Count; group: 'rooms' | 'sleeping'; label: string; help: string; start: number; min: number; max: number }[] = [
  { key: 'bedrooms', group: 'rooms', label: 'Bedrooms', help: 'Total sleeping rooms', start: 1, min: 0, max: 12 },
  { key: 'bathrooms', group: 'rooms', label: 'Bathrooms', help: 'Including shower rooms', start: 1, min: 1, max: 8 },
  { key: 'livingRooms', group: 'rooms', label: 'Living rooms', help: 'Separate lounge areas', start: 1, min: 0, max: 4 },
  { key: 'kitchens', group: 'rooms', label: 'Kitchens', help: 'Including kitchenettes', start: 1, min: 0, max: 3 },
  { key: 'guests', group: 'rooms', label: 'Maximum guests', help: 'Maximum advertised occupancy', start: 2, min: 1, max: 24 },
  { key: 'windows', group: 'rooms', label: 'Windows', help: 'Needing curtains or blinds', start: 4, min: 0, max: 40 },
  { key: 'exitDoors', group: 'rooms', label: 'Exit doors', help: 'External property exits', start: 1, min: 1, max: 6 },
  { key: 'singleBeds', group: 'sleeping', label: 'Single beds', help: 'Standard single frames', start: 0, min: 0, max: 16 },
  { key: 'doubleBeds', group: 'sleeping', label: 'Double beds', help: 'Fixed double frames', start: 1, min: 0, max: 12 },
  { key: 'zipLinkBeds', group: 'sleeping', label: 'Zip & link beds', help: 'Count each complete bed', start: 0, min: 0, max: 12 },
  { key: 'sofaBeds', group: 'sleeping', label: 'Sofa beds', help: 'Guest sleeping sofa beds', start: 1, min: 0, max: 4 },
  { key: 'bedsideTables', group: 'sleeping', label: 'Bedside tables', help: 'Across all bedrooms', start: 2, min: 0, max: 30 },
  { key: 'exposedBulbs', group: 'sleeping', label: 'Exposed bulbs', help: 'Bulbs needing lamp shades', start: 0, min: 0, max: 30 },
];
export const DEFAULT_LAYOUT: Layout = { address: '', ...Object.fromEntries(INPUTS.map(i => [i.key, i.start])) } as Layout;
export const clampInput = (key: Count, value: number) => { const i = INPUTS.find(x => x.key === key)!; return Math.min(i.max, Math.max(i.min, Math.floor(Number.isFinite(value) ? value : i.start))); };

type Rule = [item: string, rule: string, quantity: (l: Layout, beds: number) => number];
const per = (n: number, what: string, key: Count): [string, (l: Layout) => number] => [`${n} per ${what}`, l => n * l[key]];
const fixed = (n: number, text: string): [string, () => number] => [text, () => n];
const RULES: { id: string; label: string; title: string; items: Rule[] }[] = [
  { id: 'safety', label: 'Safety', title: 'Safety, security & entrance', items: [
    ['Keyboxes', ...fixed(2, '2 required at every property')],
    ['Security camera', ...fixed(1, '1 required per property')],
    ['Fire blanket', ...per(1, 'kitchen', 'kitchens')],
    ['First-aid kit', ...fixed(1, '1 required per property')],
    ['Storage cupboard padlock', ...fixed(1, '1 required per property')],
    ['Outside door mats', ...per(1, 'exit door', 'exitDoors')],
    ['Inside door mats', ...per(1, 'exit door', 'exitDoors')],
  ] },
  { id: 'kitchen', label: 'Kitchen', title: 'Kitchen & dining', items: [
    ...([['Kettle', 1], ['Toaster', 1], ['Microwave', 1], ['Saucepan set (3 pans)', 1], ['Frying pans', 2], ['Baking trays', 2], ['Casserole dish', 1], ['Chopping boards', 2],
      ['Kitchen knife set', 1], ['Utensil set', 1], ['Colander', 1], ['Measuring jug', 1], ['Mixing bowl', 1], ['Cafetière', 1], ['Tea towels', 4], ['Washing-up bowl', 1],
      ['Kitchen bin', 1], ['Recycling bins', 2]] as [string, number][]).map(([item, n]): Rule => [item, ...per(n, 'kitchen', 'kitchens')]),
    ...['Dinner plates', 'Side plates', 'Bowls', 'Mugs', 'Drinking glasses', 'Wine glasses', 'Knives', 'Forks', 'Spoons', 'Teaspoons']
      .map((item): Rule => [item, '2 per guest, with a kitchen', l => l.kitchens > 0 ? 2 * l.guests : 0]),
  ] },
  { id: 'living', label: 'Living', title: 'Living & dining room', items: [
    ['Sofa', ...per(1, 'living room', 'livingRooms')],
    ['Coffee table', ...per(1, 'living room', 'livingRooms')],
    ['Smart TV', ...per(1, 'living room', 'livingRooms')],
    ['TV unit', ...per(1, 'living room', 'livingRooms')],
    ['Rug', ...per(1, 'living room', 'livingRooms')],
    ['Dining chairs', '1 per guest', l => l.guests],
  ] },
  { id: 'bathroom', label: 'Bathroom', title: 'Bathrooms', items: [
    ['Bath mats', ...per(2, 'bathroom', 'bathrooms')],
    ['Toilet brush and holder', ...per(1, 'bathroom', 'bathrooms')],
    ['Toilet roll holder', ...per(1, 'bathroom', 'bathrooms')],
    ['Pedal bin', ...per(1, 'bathroom', 'bathrooms')],
    ['Mirror', ...per(1, 'bathroom', 'bathrooms')],
    ['Soap and shampoo dispensers', ...per(2, 'bathroom', 'bathrooms')],
    ['Shower curtain or screen squeegee', ...per(1, 'bathroom', 'bathrooms')],
    ['Towel rail or hooks', ...per(1, 'bathroom', 'bathrooms')],
  ] },
  { id: 'bedroom', label: 'Bedroom', title: 'Beds & bedrooms', items: [
    ['Single bed frames', ...per(1, 'single bed', 'singleBeds')],
    ['Single mattresses', ...per(1, 'single bed', 'singleBeds')],
    ['Double bed frames', ...per(1, 'double bed', 'doubleBeds')],
    ['Double mattresses', ...per(1, 'double bed', 'doubleBeds')],
    ['Zip & link bed frames', ...per(1, 'zip & link bed', 'zipLinkBeds')],
    ['Zip & link mattresses', '2 per zip & link bed', l => 2 * l.zipLinkBeds],
    ['Mattress protectors', '1 per bed, sofa beds included', (_, beds) => beds],
    ['Duvets', '1 per bed, sofa beds included', (_, beds) => beds],
    ['Pillows', '2 per single bed or sofa bed, 4 per double or zip & link bed', l => 2 * (l.singleBeds + l.sofaBeds) + 4 * (l.doubleBeds + l.zipLinkBeds)],
    ['Pillow protectors', '1 per pillow', l => 2 * (l.singleBeds + l.sofaBeds) + 4 * (l.doubleBeds + l.zipLinkBeds)],
    ['Bedside lamps', '1 per bedside table', l => l.bedsideTables],
    ['Wardrobe or hanging rail', ...per(1, 'bedroom', 'bedrooms')],
    ['Coat hangers', ...per(10, 'bedroom', 'bedrooms')],
    ['Full-length mirror', ...per(1, 'bedroom', 'bedrooms')],
    ['Luggage rack', ...per(1, 'bedroom', 'bedrooms')],
    ['Bedroom bin', ...per(1, 'bedroom', 'bedrooms')],
  ] },
  { id: 'linen', label: 'Linen', title: 'Linen & towels', items: [
    ['Bed linen sets (duvet cover, sheet, pillowcases)', '3 per bed: on the bed, in the wash and spare', (_, beds) => 3 * beds],
    ['Bath towels', '2 per guest', l => 2 * l.guests],
    ['Hand towels', '2 per guest', l => 2 * l.guests],
    ['Face cloths', '2 per guest', l => 2 * l.guests],
  ] },
  { id: 'windows', label: 'Windows & lighting', title: 'Windows & lighting', items: [
    ['Curtains or blinds', ...per(1, 'window', 'windows')],
    ['Lamp shades', ...per(1, 'exposed bulb', 'exposedBulbs')],
  ] },
  { id: 'cleaning', label: 'Cleaning', title: 'Cleaning & laundry', items: [
    ['Vacuum cleaner', ...fixed(1, '1 required per property')],
    ['Mop and bucket', ...fixed(1, '1 required per property')],
    ['Iron', ...fixed(1, '1 required per property')],
    ['Ironing board', ...fixed(1, '1 required per property')],
    ['Clothes airer', ...fixed(1, '1 required per property')],
  ] },
];

export function calculateFurnishing(input: Layout): FurnishingList {
  const layout = { ...input, ...Object.fromEntries(INPUTS.map(i => [i.key, clampInput(i.key, input[i.key])])) } as Layout;
  const beds = layout.singleBeds + layout.doubleBeds + layout.zipLinkBeds + layout.sofaBeds;
  const categories = RULES.map(c => ({ id: c.id, label: c.label, title: c.title,
    lines: c.items.map(([item, rule, quantity]) => ({ item, rule, quantity: quantity(layout, beds) })).filter(l => l.quantity > 0) })).filter(c => c.lines.length);
  return { beds, categories, total: categories.reduce((sum, c) => sum + c.lines.reduce((s, l) => s + l.quantity, 0), 0) };
}

// The list as plain text (to copy or share) and as a spreadsheet (CSV).
export function furnishingText(layout: Layout, list: FurnishingList) {
  return [`Recharge furnishing list`, `Property: ${layout.address.trim() || 'Address not entered'}`, `Bedrooms ${layout.bedrooms} · Guests ${layout.guests} · Beds ${list.beds} · ${list.total} units`,
    ...list.categories.flatMap(c => ['', c.title, ...c.lines.map(l => `${l.quantity} × ${l.item}`)])].join('\n');
}
export function furnishingCsv(layout: Layout, list: FurnishingList) {
  const cell = (v: string | number) => /[",\r\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v);
  const rows: (string | number)[][] = [['Recharge furnishing list'], ['Property', layout.address.trim() || 'Address not entered'], ['Bedrooms', layout.bedrooms], ['Guests', layout.guests],
    ['Total beds', list.beds], ['Required units', list.total], [], ['Category', 'Item', 'Quantity', 'Rule'],
    ...list.categories.flatMap(c => c.lines.map(l => [c.title, l.item, l.quantity, l.rule]))];
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
