import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The "fewer buttons" rule for choices in forms (lib/choice-control.ts): up to 5 options stay as compact
// radio choices, 6 to 10 become a dropdown, more than 10 a dropdown with a search box. Lists of
// properties, people or stays use the search-only picker. One check per converted screen follows.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
const { choiceControl, filterChoices, RADIO_MAX, PLAIN_DROPDOWN_MAX } = await vite.ssrLoadModule('/lib/choice-control.ts');
const { newEnquiryForm } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
after(() => vite.close());
const source = file => readFileSync('mobile/src/' + file, 'utf8');

test('the threshold rule: 5 or fewer radios, more than 5 a dropdown, more than 10 a searchable dropdown', () => {
  assert.equal(RADIO_MAX, 5);
  assert.equal(PLAIN_DROPDOWN_MAX, 10);
  for (const n of [0, 1, 2, 5]) assert.equal(choiceControl(n), 'radio', `${n} options`);
  for (const n of [6, 8, 10]) assert.equal(choiceControl(n), 'dropdown', `${n} options`);
  for (const n of [11, 23, 200]) assert.equal(choiceControl(n), 'search', `${n} options`);
});

test("a dropdown's search keeps the options with every word typed, ignoring case and accents", () => {
  const options = ['Edinburgh', 'Perth and Kinross', 'Inverness and Highlands', 'Argyll and Bute'].map(label => ({ value: label, label }));
  assert.deepEqual(filterChoices(options, '').map(o => o.label), options.map(o => o.label));
  assert.deepEqual(filterChoices(options, 'and high').map(o => o.label), ['Inverness and Highlands']);
  assert.deepEqual(filterChoices(options, 'PERTH').map(o => o.label), ['Perth and Kinross']);
  assert.deepEqual(filterChoices([{ value: 'x', label: 'Café Royal' }], 'cafe').length, 1);
  assert.deepEqual(filterChoices(options, 'glasgow'), []);
});

test('Add a new property enquiry: Area is a searchable dropdown that starts on "Work it out from the address"', () => {
  for (const team of [true, false]) {
    const area = newEnquiryForm(team).fields.find(f => f.name === 'region');
    assert.ok(area, 'the form has an Area field');
    assert.equal(area.type, 'select');
    assert.equal(area.defaultValue, '');
    assert.deepEqual(area.options[0], { value: '', label: 'Work it out from the address' });
    assert.equal(choiceControl(area.options.length), 'search', `${area.options.length} options`);
  }
  assert.equal(newEnquiryForm(true).title, 'Add a new property enquiry');
});

test('the shared form renderer draws every select field with ChoiceField, which applies the rule', () => {
  const pages = source('LivePages.tsx'), field = source('ChoiceField.tsx'), dropdown = source('Dropdown.tsx');
  const renderer = pages.slice(pages.indexOf('function Field('), pages.indexOf('export function WorkflowSheet'));
  assert.match(renderer, /f\.type === "select" \?[\s\S]*<ChoiceField /);
  assert.doesNotMatch(renderer, /accessibilityRole="radio"/, 'no hand-drawn radio cards in the renderer');
  assert.match(field, /const control = choiceControl\(options\.length\);[\s\S]*control !== "radio"[\s\S]*searchable=\{control === "search"\}/);
  assert.match(dropdown, /searchable && <View/, 'the dropdown puts a search box at the top of a long list');
  // Quick picks under a field follow the same rule.
  assert.match(pages.slice(pages.indexOf('function Suggestions('), pages.indexOf('function PostcodeLookup(')), /choiceControl\(items\.length\) !== "radio"[\s\S]*<Dropdown /);
});

// One check per converted screen: the long list is now a ChoiceField / ChoicePills / search picker.
const screens = [
  ['LiveEnquiries.tsx', 'Start valuing: Area (23) and Property type (8)', [/<ChoiceField p=\{p\} label="Area"/, /<ChoiceField p=\{p\} label="Property type"/], [/SCOTTISH_REGIONS\.map\(r => <Chip/]],
  ['LiveRepairs.tsx', 'Report a repair: type of repair (11) and the stay (search picker)', [/<ChoiceField p=\{p\} label="Type of repair"/, /<SearchPicker p=\{p\} options=\{stays\.map/], [/stays\.map\(s => \(\s*<MotionPress/]],
  ['CleanProblem.tsx', 'Clean problem: kind of problem (11)', [/<ChoiceField p=\{p\} label="What kind of problem"/], [/REPAIR_GUIDES\) as RepairType\[\]\)\.map\(t => \(\s*<MotionPress/]],
  ['LiveAccessControl.tsx', 'Access control: role (8) in both sheets, and the people filter (6)', [/<ChoiceField p=\{p\} label="Role"[\s\S]*<ChoiceField p=\{p\} label="Role"/, /<ChoicePills p=\{p\} name="Show" values=\{FILTERS\}/], [/rolesFor\("super_admin"\)\.map\(r => \{/]],
  ['KpiAdmin.tsx', 'KPIs: area (6) and what it measures', [/<ChoicePills p=\{p\} name="Area"/, /<ChoiceField p=\{p\} label="What it measures"/], [/measures\.map\(m => \(\s*<MotionPress/]],
  ['DefaultCleaners.tsx', 'Usual cleaners: cleaners are people (search picker)', [/<SearchPicker p=\{p\} options=\{choices\.map/], [/choices\.map\(c => \{/]],
  ['LivePropertyProfile.tsx', 'Listing links: platform (6)', [/<ChoiceField p=\{p\} label="Platform"/], [/LISTING_PLATFORMS\.map\(x => <MotionPress/]],
  ['ListingSheets.tsx', 'Guest review: a rating out of 10 is a dropdown; the night to price', [/outOf > 5 \? <ChoiceField/, /<ChoicePills p=\{p\} name="Night"/], []],
  // Merged with Session B's round 6 form: the department is the second dropdown of "Assign to".
  ['HubItemSheet.tsx', 'New to-do: department (6)', [/<Dropdown p=\{p\} label="Department to assign it to" value=\{f\.department \?\? ""\} options=\{DEPARTMENT_OPTIONS\}/], [/DEPARTMENTS\.map\(d => <Chip/]],
  ['ViewAs.tsx', 'View as: people in the search picker, a role preview in one dropdown', [/<SearchPicker p=\{p\} nouns="people"/, /<ChoiceField p=\{p\} label="A role's screens only"/], [/group\.people\.map\(person => option\(/]],
  ['LiveShifts.tsx', 'Usual shift: department (6)', [/<ChoicePills p=\{p\} name="Department"/], [/<Pills p=\{p\} values=\{DEPARTMENTS\}/]],
  ['LivePeople.tsx', 'People: role and OTA platform (8)', [/<ChoicePills p=\{p\} name="Role"/, /<ChoicePills p=\{p\} name="Platform" values=\{OTA_PLATFORMS\}/], [/<Pills p=\{p\} values=\{OTA_PLATFORMS\}/]],
  ['MenuOrderEditor.tsx', 'Menu order: role (8)', [/<ChoicePills p=\{p\} name="Role" values=\{MENU_ROLES\}/], [/<Pills p=\{p\} values=\{MENU_ROLES\}/]],
  ['OwnerExpenses.tsx', 'Owner expenses: the property (search picker) and the month', [/<PropertySelect p=\{p\} properties=\{properties\.map/, /<ChoicePills p=\{p\} name="Month"/], [/<Pills p=\{p\} values=\{properties\.map/]],
  ['LiveGuestInbox.tsx', 'Log a guest message: channel', [/<ChoicePills p=\{p\} name="Channel" values=\{OFFERED_CHANNELS\}/], []],
  ['LiveCalendar.tsx', 'Calendar: views in one segmented control, the team filter in one dropdown', [/<Segmented p=\{p\} label="Calendar view"/, /<Dropdown p=\{p\} label="Team" hideLabel/], [/<Pills p=\{p\} values=\{MODES\}/]],
  ['LiveRepairs.tsx', 'Maintenance: the stage filter in one dropdown, no Refresh button', [/<Dropdown p=\{p\} label="Show" value=\{stage\}/], [/RefreshButton/, /<ScrollView horizontal/]],
];
for (const [file, what, present, gone] of screens) {
  test(`${file}: ${what}`, () => {
    const text = source(file);
    for (const pattern of present) assert.match(text, pattern);
    for (const pattern of gone) assert.doesNotMatch(text, pattern);
  });
}
