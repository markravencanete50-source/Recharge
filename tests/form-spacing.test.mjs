import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lee typed into the wrong field of "Publish the estimate" twice: each label sat flush under the field above it and
// read as that field's caption. A label now sits close to its own field (space.tight) and a clear step below the
// field before it (space.section). Read from source: there is no React Native renderer for tests here.
const source = path => readFileSync(path, 'utf8');
const theme = source('mobile/src/theme.ts');
const step = name => Number(theme.match(new RegExp(`${name}: (\\d+)`))[1]);

test('the spacing steps: the gap above a label is clearly larger than the one under it', () => {
  assert.ok(step('section') >= 3 * step('tight'), `section ${step('section')} vs tight ${step('tight')}`);
});

test('workflow sheet forms: fields a section apart, each label close to its own field', () => {
  const pages = source('mobile/src/LivePages.tsx');
  assert.match(pages, /<View style=\{\{ gap: space\.section \}\}>\s*\{shown\.map\(\(f, n\) => <View key=\{f\.name\} style=\{\{ gap: space\.row \}\}>/);
  // Both field shapes keep the label to the field's own tight gap: the date (the shared DateField, with its help
  // under it) and the rest.
  assert.match(pages, /<View style=\{\{ gap: space\.tight \}\} pointerEvents=\{disabled \? "none" : "auto"\}>\s*<DateField /);
  assert.equal((pages.match(/<View style=\{\{ gap: space\.tight \}\}>\s*\{label\}/g) ?? []).length, 1);
  assert.doesNotMatch(pages, /<View style=\{\{ gap: 8 \}\}>\s*\{label\}/);
});

test('workflow forms can group fields under a heading and reveal a group once the one before is started', () => {
  const pages = source('mobile/src/LivePages.tsx'), forms = source('lib/workflow-forms.ts');
  assert.match(forms, /section\?:string;after\?:string;group\?:string\}/);
  assert.match(pages, /const shown = spec\.fields\.filter\(f => !f\.after \|\| filled\(values\[f\.after\]\) \|\| spec\.fields\.some\(g => g\.group === f\.group && filled\(values\[g\.name\]\)\)\);/);
  assert.match(pages, /\{!!f\.section && <Text accessibilityRole="header"/);
  // A short label in a group: no "(optional)" (the heading says it) and the group in what screen readers hear.
  assert.match(pages, /\{!f\.required && !f\.group \? " \(optional\)" : ""\}/);
  assert.match(pages, /const named = f\.group \? `\$\{f\.group\} \$\{f\.label\.toLowerCase\(\)\}` : f\.label;/);
  assert.match(pages, /<TextInput accessibilityLabel=\{named\}/);
});

test('Publish the estimate: each comparable under its own heading, short labels, 2 and 3 once the one before is started', async () => {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
  try {
    const { journeyForms } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
    const admin = { role: 'admin', modules: [], userId: '00000000-0000-4000-8000-000000000001' };
    const form = journeyForms(admin, { stage: 'estimate', propertyId: '00000000-0000-4000-8000-000000000002', clientId: null, ownerAccount: false, agreementRevision: 0 }).find(f => f.key === 'publishEstimate');
    assert.ok(form, 'the publish form');
    const comps = form.fields.filter(f => f.group);
    assert.deepEqual(comps.map(f => [f.name, f.label, f.group, f.section ?? '', f.after ?? '']), [
      ['name0', 'Name', 'Comparable 1', 'Comparable 1 (optional)', ''], ['url0', 'Link (https://)', 'Comparable 1', '', ''], ['adrMinor0', 'Nightly rate, GBP', 'Comparable 1', '', ''],
      ['name1', 'Name', 'Comparable 2', 'Comparable 2 (optional)', 'name0'], ['url1', 'Link (https://)', 'Comparable 2', '', 'name0'], ['adrMinor1', 'Nightly rate, GBP', 'Comparable 2', '', 'name0'],
      ['name2', 'Name', 'Comparable 3', 'Comparable 3 (optional)', 'name1'], ['url2', 'Link (https://)', 'Comparable 3', '', 'name1'], ['adrMinor2', 'Nightly rate, GBP', 'Comparable 3', '', 'name1'],
    ]);
    assert.ok(comps.every(f => !f.required));
    assert.ok(!comps.some(f => f.label.includes(String.fromCharCode(8212))), 'no em dashes');
  } finally { await vite.close(); }
});

test('every other sheet form: sheet sections a section apart, the shared field label a tight step above its box', () => {
  assert.match(source('mobile/src/TeamFlows.tsx'), /contentContainerStyle=\{\{ padding: 20, gap: space\.section,/);
  assert.match(source('mobile/src/LiveKit.tsx'), /<View style=\{\{ gap: space\.tight \}\}>\s*<Text style=\{\[ui\.small, \{ color: focused \? p\.primary : p\.muted, fontWeight: "600" \}\]\}>\{label\}<\/Text>/);
});
