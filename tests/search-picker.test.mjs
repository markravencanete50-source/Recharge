import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The shared property and person picker is search only on long lists (Lee, round 5): before anything is
// typed, only the search box, the fixed options and the current choice; matches once something is typed;
// short lists unchanged. Matching itself (lib/search-options.ts) is not changed.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { pickerView, SHOW_SEARCH_ABOVE, SHOWN, saveDisabled, CHOOSE_PROPERTY_FIRST } = await vite.ssrLoadModule('/lib/search-picker.ts');
const { searchOptions, propertyOption } = await vite.ssrLoadModule('/lib/search-options.ts');

const TOWNS = ['Leith', 'Portobello', 'Stockbridge', 'Morningside', 'Bruntsfield', 'Marchmont', 'Newington', 'Corstorphine', 'Dalry', 'Gorgie', 'Tollcross', 'Abbeyhill', 'Canonmills', 'Inverleith', 'Trinity'];
const many = Array.from({ length: 101 }, (_, i) => propertyOption({ id: 'p' + i, name: `${i + 1} ${TOWNS[i % TOWNS.length]} Road`, address: `${i + 1} ${TOWNS[i % TOWNS.length]} Road, Edinburgh EH${(i % 17) + 1} ${i % 9}AB`, region: 'Edinburgh' }));
const few = many.slice(0, SHOW_SEARCH_ABOVE);

test('a long list shows no options before anything is typed', () => {
  const view = pickerView(many, '', '');
  assert.equal(view.searchable, true);
  assert.deepEqual(view.chips, []);
  assert.equal(view.more, false, 'no "Showing x of y" before typing');
  assert.equal(view.none, false);
  assert.deepEqual(pickerView(many, '   ', '').chips, [], 'spaces are not typing');
});

test('the current choice stays in view as one chip, typed or not', () => {
  assert.deepEqual(pickerView(many, '', 'p57').chips.map(o => o.id), ['p57']);
  const typed = pickerView(many, 'Leith', 'p57');
  assert.equal(typed.chips[0].id, 'p57', 'kept first even when it does not match');
  assert.ok(typed.chips.slice(1).every(o => /leith/i.test(o.label + o.keywords)));
  assert.deepEqual(pickerView(many, '', 'not-an-option').chips, [], 'a fixed choice such as "Every property" is not a list chip');
});

test('typing shows the best matches, up to twelve, with the count and a no-match state', () => {
  const view = pickerView(many, 'road', '');
  const expected = searchOptions(many, 'road', SHOWN);
  assert.deepEqual(view.chips, expected.shown, 'the same matching as before');
  assert.equal(view.chips.length, SHOWN);
  assert.deepEqual([view.shown, view.matches, view.more], [SHOWN, 101, true]);
  const narrow = pickerView(many, 'Trinity', '');
  assert.ok(narrow.chips.length > 0 && narrow.chips.length <= SHOWN);
  assert.equal(narrow.more, narrow.matches > narrow.chips.length);
  const none = pickerView(many, 'zzzz', '');
  assert.deepEqual([none.chips.length, none.none, none.more], [0, true, false]);
});

test('a short list is unchanged: every option, no search box', () => {
  for (const query of ['', 'Leith']) {
    const view = pickerView(few, query, few[2].id);
    assert.deepEqual([view.searchable, view.chips], [false, few]);
    assert.deepEqual([view.more, view.none], [false, false]);
  }
});

test('the picker uses the view, keeps fixed options and says when nothing is chosen', () => {
  const src = readFileSync('mobile/src/SearchPicker.tsx', 'utf8');
  assert.match(src, /pickerView\(options, query, value\)/);
  assert.match(src, /fixed\.map\(o => <OptionChip/, 'fixed options always show');
  assert.match(src, /view\.chips\.map\(o => <OptionChip/);
  assert.match(src, /Keep typing to narrow it down/);
  assert.match(src, /Nothing chosen yet\. Type to find one of the/);
  assert.match(src, /Search for a property by name, street or postcode/);
  assert.doesNotMatch(src, /Type to find the rest/);
  assert.match(src, /onChange\(clearable && id === value \? "" : id\)/, 'tapping the chosen chip clears it when clearable');
});

// Forms that need a property keep Save disabled until one is chosen, with "Choose a property first." (the
// server still checks). One check per screen: the rule, and that the screen's Save button and hint use it.
const SCREENS = [
  ['Record a stay', 'mobile/src/StaySheet.tsx', 'Save stay'],
  ['Report a repair', 'mobile/src/LiveRepairs.tsx', 'Report repair'],
  ['New routine plan', 'mobile/src/LiveRepairs.tsx', 'Save routine'],
  ['Supplier invoice', 'mobile/src/AccountsPayable.tsx', 'Save expense'],
];
test('the rule: disabled with no property or while saving, enabled once one is chosen', () => {
  assert.equal(saveDisabled(false, ''), true);
  assert.equal(saveDisabled(false, null), true);
  assert.equal(saveDisabled(false, undefined), true);
  assert.equal(saveDisabled(false, 'p1'), false);
  assert.equal(saveDisabled(true, 'p1'), true, 'still disabled while saving');
  assert.equal(CHOOSE_PROPERTY_FIRST, 'Choose a property first.');
});
for (const [screen, file, label] of SCREENS) {
  test(`${screen}: Save is disabled until a property is chosen`, () => {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n'), at = lines.findIndex(line => line.includes(`"${label}"`) && line.includes('<Button'));
    assert.ok(at > 0, 'the Save button is there');
    const button = lines[at], before = lines[at - 1];
    assert.match(button, /disabled=\{saveDisabled\(busy, propertyId\)\}/, 'disabled with no property');
    assert.match(before, /\{!propertyId && <Text style=\{\[ui\.small, \{ color: p\.muted \}\]\}>\{CHOOSE_PROPERTY_FIRST\}<\/Text>\}/, 'the hint shows while none is chosen');
    // The server-side check (and its message) is still in the save step.
    assert.match(src, /if \(!propertyId/);
  });
}
