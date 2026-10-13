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

test('the threshold: 5 or fewer stay pills, more than 5 become a dropdown', () => {
  assert.equal(P.PILLS_LIMIT, 5);
  assert.deepEqual([1, 2, 5, 6, 13].map(P.pillsMode), ['pills', 'pills', 'pills', 'dropdown', 'dropdown']);
  assert.match(pills, /if \(pillsMode\(values\.length\) === "dropdown"\) \{\s*return <Dropdown /);
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
  assert.match(pills, /<Dropdown p=\{p\} label=\{title\} showLabel=\{false\} value=\{value\} options=\{pillOptions\(values, text\)\} onChange=\{onChange\} \/>/);
  assert.match(pills, /onPress=\{\(\) => onChange\(v\)\}/);
  // Accessible: the pills are a radiogroup of radios; the dropdown is a select (web) or a combobox (phone) named by `title`.
  assert.match(pills, /accessibilityRole="radio" accessibilityState=\{\{ selected: on \}\}/);
  const dropdown = source('Dropdown.tsx');
  assert.match(dropdown, /createElement\("select", \{\s*"aria-label": label/);
  assert.match(dropdown, /accessibilityRole="combobox"/);
  assert.match(dropdown, /\{showLabel && <Text/);
  assert.match(dropdown, /fontFamily: "Montserrat_400Regular/);
});

test('Management uses it: its 12 or 13 sections are one dropdown named "Management section"', () => {
  const management = source('LiveManagement.tsx');
  assert.match(management, /import \{ Pills \} from "\.\/Pills";/);
  assert.match(management, /<Pills p=\{p\} title="Management section" values=\{MANAGEMENT_VIEWS\.filter/);
  const views = management.match(/const MANAGEMENT_VIEWS = \[([^\]]*)\]/)[1].split(',').length;
  assert.ok(P.pillsMode(views - 1) === 'dropdown', 'even without Access control it is a dropdown');
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
