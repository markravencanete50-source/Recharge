import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The in-app furnishing calculator: category quantities from the property layout, with the rule
// behind each number.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { calculateFurnishing, furnishingCsv, furnishingText, DEFAULT_LAYOUT, INPUTS, clampInput, cleanExtras, EXTRA_LIMITS } = await vite.ssrLoadModule('/lib/furnishing-calculator.ts');
after(() => vite.close());
const line = (list, category, item) => list.categories.find(c => c.id === category)?.lines.find(l => l.item === item);

test('the starting layout (one bedroom, double and sofa bed, two guests) gives the safety list and counts beds', () => {
  const list = calculateFurnishing(DEFAULT_LAYOUT);
  assert.equal(list.beds, 2);
  assert.deepEqual(list.categories.find(c => c.id === 'safety').lines.map(l => [l.item, l.quantity, l.rule]), [
    ['Keyboxes', 2, '2 required at every property'], ['Security camera', 1, '1 required per property'], ['Fire blanket', 1, '1 per kitchen'],
    ['First-aid kit', 1, '1 required per property'], ['Storage cupboard padlock', 1, '1 required per property'], ['Outside door mats', 1, '1 per exit door'], ['Inside door mats', 1, '1 per exit door']]);
  assert.equal(line(list, 'linen', 'Bed linen sets (duvet cover, sheet, pillowcases)').quantity, 6);
  assert.equal(line(list, 'bedroom', 'Pillows').quantity, 6);
  assert.equal(line(list, 'kitchen', 'Dinner plates').quantity, 4);
  assert.equal(line(list, 'windows', 'Curtains or blinds').quantity, 4);
  assert.equal(list.total, list.categories.reduce((s, c) => s + c.lines.reduce((a, l) => a + l.quantity, 0), 0));
});

test('every input changes the list, and values stay within their ranges', () => {
  const base = calculateFurnishing(DEFAULT_LAYOUT).total;
  for (const i of INPUTS) if (calculateFurnishing({ ...DEFAULT_LAYOUT, [i.key]: Math.min(i.max, DEFAULT_LAYOUT[i.key] + 1) }).total <= base) assert.fail(i.key + ' has no effect');
  assert.equal(clampInput('bathrooms', 0), 1);
  assert.equal(clampInput('guests', 99), 24);
  assert.equal(calculateFurnishing({ ...DEFAULT_LAYOUT, kitchens: 0 }).categories.some(c => c.id === 'kitchen'), false, 'no kitchen, no kitchenware');
  assert.equal(line(calculateFurnishing({ ...DEFAULT_LAYOUT, zipLinkBeds: 1 }), 'bedroom', 'Zip & link mattresses').quantity, 2);
});

test('the list copies as text and downloads as a spreadsheet with the address and every line', () => {
  const layout = { ...DEFAULT_LAYOUT, address: '1 Quay Street, Leith' };
  const list = calculateFurnishing(layout);
  assert.match(furnishingText(layout, list), /^Recharge furnishing list\nProperty: 1 Quay Street, Leith/);
  const csv = furnishingCsv(layout, list);
  assert.match(csv, /"1 Quay Street, Leith"/);
  assert.equal(csv.trim().split('\r\n').length, 8 + list.categories.reduce((s, c) => s + c.lines.length, 0));
});

test('other items join the list, the total, the copied text and the spreadsheet, and are cleaned', () => {
  const base = calculateFurnishing(DEFAULT_LAYOUT);
  assert.equal(base.categories.some(c => c.id === 'other'), false);
  const extras = [{ id: 'a', item: '  Baby cot ', quantity: 2, note: 'Ground floor, "quiet" room' }, { id: 'b', item: '   ', quantity: 5, note: '' }, { id: 'c', item: 'Hot tub cover', quantity: -4, note: '' }];
  const list = calculateFurnishing(DEFAULT_LAYOUT, extras);
  const other = list.categories.find(c => c.id === 'other');
  assert.deepEqual(other.lines.map(l => [l.item, l.quantity, l.rule]), [['Baby cot', 2, 'Ground floor, "quiet" room'], ['Hot tub cover', 1, 'Added by you']]);
  assert.equal(list.total, base.total + 3);
  assert.match(furnishingText(DEFAULT_LAYOUT, list), /Other items\n2 × Baby cot\n1 × Hot tub cover/);
  assert.match(furnishingCsv(DEFAULT_LAYOUT, list), /Other items,Baby cot,2,"Ground floor, ""quiet"" room"/);
  assert.equal(cleanExtras(Array.from({ length: 80 }, (_, i) => ({ id: String(i), item: 'x'.repeat(200), quantity: 99999, note: '' }))).length, EXTRA_LIMITS.items);
  assert.equal(cleanExtras([{ id: '1', item: 'x'.repeat(200), quantity: 99999, note: '' }])[0].quantity, EXTRA_LIMITS.quantity);
});

test('the list downloads as a structured PDF: valid file, every line, page numbers, tidy text', async () => {
  const { furnishingPdf, furnishingFileName, wrapText } = await vite.ssrLoadModule('/lib/furnishing-pdf.ts');
  const layout = { ...DEFAULT_LAYOUT, address: 'Flat 4 (top), 21 Queen’s Road', bedrooms: 3, guests: 6, windows: 9 };
  const list = calculateFurnishing(layout, [{ id: 'x', item: 'Baby cot', quantity: 2, note: 'Grey — owner asked' }]);
  const bytes = furnishingPdf(layout, list, { generatedOn: new Date(2026, 9, 25) });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.every(b => b < 128), 'the file is plain ASCII, so it survives every download path');
  const pdf = Buffer.from(bytes).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4\n/);
  assert.match(pdf, /%%EOF\n$/);
  // Every cross-reference offset points at its object.
  const xrefAt = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.startsWith('xref', xrefAt));
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1}`));
  // Stream lengths match.
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.equal(pdf.slice(m.index + m[0].length + Number(m[1]), m.index + m[0].length + Number(m[1]) + 10), '\nendstream');
  const pages = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.ok(pages >= 2);
  assert.match(pdf, new RegExp(`\\(Page ${pages} of ${pages}\\)`));
  assert.match(pdf, /\(Flat 4 \\\(top\\\), 21 Queen\\222s Road\)/, 'brackets escaped, curly quote in WinAnsi');
  assert.match(pdf, /\(25 October 2026\)|Prepared 25 October 2026/);
  for (const c of list.categories) for (const l of c.lines) if (/^[\x20-\x7e]+$/.test(l.item)) assert.ok(pdf.includes(`(${l.item.split(' ')[0]}`), l.item);
  assert.match(pdf, /\(Cafeti\\350re\)/, 'accented letters print, not as question marks');
  assert.match(pdf, /\(Other items\)/);
  assert.match(pdf, /\(Total required units\)/);
  assert.match(pdf, new RegExp(`\\(${list.total}\\) Tj`));
  assert.equal(furnishingFileName(layout, 'pdf'), 'Recharge-furnishing-list-flat-4-top-21-queen-s-road.pdf');
  assert.equal(furnishingFileName(DEFAULT_LAYOUT, 'csv'), 'Recharge-furnishing-list.csv');
  assert.deepEqual(wrapText('a '.repeat(3) + 'x'.repeat(200), 100, 10).every(Boolean), true);
});
