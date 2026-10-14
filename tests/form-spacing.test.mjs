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
  // Both field shapes (the date and the rest) keep the label to the field's own tight gap.
  assert.equal((pages.match(/<View style=\{\{ gap: space\.tight \}\}>\s*\{label\}/g) ?? []).length, 2);
  assert.doesNotMatch(pages, /<View style=\{\{ gap: 8 \}\}>\s*\{label\}/);
});

test('workflow forms can group fields under a heading and reveal a group once the one before is started', () => {
  const pages = source('mobile/src/LivePages.tsx'), forms = source('lib/workflow-forms.ts');
  assert.match(forms, /section\?:string;after\?:string\}/);
  assert.match(pages, /const shown = spec\.fields\.filter\(f => !f\.after \|\| \(values\[f\.after\] !== undefined && values\[f\.after\] !== "" && values\[f\.after\] !== null\)\);/);
  assert.match(pages, /\{!!f\.section && <Text accessibilityRole="header"/);
});

test('every other sheet form: sheet sections a section apart, the shared field label a tight step above its box', () => {
  assert.match(source('mobile/src/TeamFlows.tsx'), /contentContainerStyle=\{\{ padding: 20, gap: space\.section,/);
  assert.match(source('mobile/src/LiveKit.tsx'), /<View style=\{\{ gap: space\.tight \}\}>\s*<Text style=\{\[ui\.small, \{ color: focused \? p\.primary : p\.muted, fontWeight: "600" \}\]\}>\{label\}<\/Text>/);
});
