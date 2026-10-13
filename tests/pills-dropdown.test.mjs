import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

// Round 6 (Lee: "I'd rather have a drop down, so it's much cleaner"): Pills (mobile/src/Pills.tsx) stay pills on one line
// for 5 or fewer choices and become the shared Dropdown above that, with the same props, labels and onChange.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const P = await vite.ssrLoadModule('/lib/pills.ts');
const source = name => readFileSync('mobile/src/' + name, 'utf8');
const pills = source('Pills.tsx');

test('the threshold, shared with the forms: 5 or fewer pills, 6 to 10 a dropdown, more than 10 a dropdown with search', async () => {
  const C = await vite.ssrLoadModule('/lib/choice-control.ts');
  assert.equal(P.PILLS_LIMIT, C.RADIO_MAX);
  assert.deepEqual([1, 2, 5, 6, 10, 11, 13].map(P.pillsMode), ['pills', 'pills', 'pills', 'dropdown', 'dropdown', 'search', 'search']);
  for (let n = 1; n <= 20; n++) assert.equal(P.pillsMode(n), C.choiceControl(n) === 'radio' ? 'pills' : C.choiceControl(n), String(n));
  assert.match(pills, /const mode = pillsMode\(values\.length\);\s*if \(mode !== "pills"\) \{\s*return <Dropdown /);
  assert.match(pills, /searchable=\{mode === "search"\}/);
  // D's ChoicePills draws the same way, through Pills.
  assert.match(source('ChoiceField.tsx'), /return <Pills p=\{p\} title=\{name\} values=\{values\}/);
  // Pills on one line: a sideways row, never wrapping onto more lines.
  assert.match(pills, /<ScrollView horizontal accessibilityRole="radiogroup"/);
  assert.doesNotMatch(pills, /flexWrap/);
});

test('the dropdown lists every choice with the pill\'s own words, counts included, and hands onChange the same value', () => {
  const label = v => ({ pending: 'Waiting (3)', online: 'Online (12)', offline: 'Offline', revoked: 'Revoked', all: 'Everyone', extra: 'Extra' })[v];
  const values = ['pending', 'online', 'offline', 'revoked', 'all', 'extra'];
  assert.deepEqual(P.pillOptions(values, label), values.map(v => ({ value: v, label: label(v) })));
  assert.deepEqual(P.pillOptions(values, label).map(o => o.label).slice(0, 2), ['Waiting (3)', 'Online (12)']);
  // The same onChange and value go straight through; the pills call it with the value too.
  assert.match(pills, /<Dropdown p=\{p\} label=\{title\} hideLabel searchable=\{mode === "search"\} value=\{value\} options=\{pillOptions\(values, text\)\} onChange=\{onChange\} \/>/);
  assert.match(pills, /onPress=\{\(\) => onChange\(v\)\}/);
  // Accessible: the pills are a radiogroup of radios; the dropdown is a select (web) or a combobox (phone) named by `title`.
  assert.match(pills, /accessibilityRole="radio" accessibilityState=\{\{ selected: on \}\}/);
  const dropdown = source('Dropdown.tsx');
  assert.match(dropdown, /createElement\("select", \{\s*"aria-label": label/);
  assert.match(dropdown, /accessibilityRole="combobox"/);
  assert.match(dropdown, /const caption = hideLabel \? null : <Text/);
  assert.match(dropdown, /fontFamily: "Montserrat_400Regular/);
});

test('Management uses it: its 12 or 13 sections are one dropdown (with search) named "Management section"', () => {
  const management = source('LiveManagement.tsx');
  assert.match(management, /import \{ Pills \} from "\.\/Pills";/);
  assert.match(management, /<Pills p=\{p\} title="Management section" values=\{MANAGEMENT_VIEWS\.filter/);
  const views = management.match(/const MANAGEMENT_VIEWS = \[([^\]]*)\]/)[1].split(',').length;
  assert.equal(P.pillsMode(views - 1), 'search', 'even without Access control it is a dropdown, with a search box past 10');
});

test('Pills lives in its own file; AccountsPayable re-exports it; every screen imports it from Pills.tsx', () => {
  assert.match(pills, /export function Pills<T extends string>\(\{ p, values, value, onChange, label, title = "Choose" \}: \{ p: Palette; values: readonly T\[\]; value: T; onChange: \(v: T\) => void; label\?: \(v: T\) => string; wrap\?: boolean; title\?: string \}\)/);
  const payable = source('AccountsPayable.tsx');
  assert.match(payable, /export \{ Pills \} from "\.\/Pills";/);
  assert.doesNotMatch(payable, /export function Pills/);
  for (const file of readdirSync('mobile/src').filter(f => f.endsWith('.tsx') && f !== 'Pills.tsx' && f !== 'AccountsFlows.tsx')) {
    const text = source(file);
    if (!/<Pills /.test(text)) continue;
    assert.match(text, /import \{ Pills \} from "\.\/Pills";|import \{ Pills \} from "\.\/Pills"/, file);
    assert.doesNotMatch(text, /import \{[^}]*\bPills\b[^}]*\} from "\.\/(AccountsPayable|LiveAccounts)"/, file);
  }
});
