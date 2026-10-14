import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Round 6 leftovers (Lead, from the live check): nothing cut off or squeezed on a 390 px phone. The screens are
// read from source, as there is no React Native renderer for tests here.
const source = path => readFileSync(path, 'utf8');

test('Client enquiries: the stat tile labels fit on one line on a phone', () => {
  const screen = source('mobile/src/LiveEnquiries.tsx');
  const labels = [...screen.matchAll(/<StatTile [^>]*label="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(labels, ['To value', 'Waiting', 'Valuing', 'Sent']);
  // Four tiles sit two to a row on a 390 px phone: about 95 px for the label beside the icon, so 8 characters.
  for (const label of labels) assert.ok(label.length <= 8, label);
  // The meaning moved to the line under the figure (and the screen-reader label).
  assert.match(screen, /detail="Answered forms, ready to value"/);
  assert.match(screen, /detail="Form sent, waiting for them"/);
  assert.match(screen, /detail="Estimates with the landlord"/);
});

test('Client enquiries: on a phone the tags go under the details, so the name keeps the width', () => {
  const screen = source('mobile/src/LiveEnquiries.tsx');
  assert.match(screen, /const narrow = useWindowDimensions\(\)\.width < 600;/);
  assert.match(screen, /\{narrow && <View style=\{\[ui\.row, \{ gap: 6, flexWrap: "wrap", marginTop: 4 \}\]\}>\{tags\}<\/View>\}/);
  assert.match(screen, /\{!narrow && <View style=\{\{ alignItems: "flex-end", gap: 6 \}\}>\{tags\}<\/View>\}/);
});

test('Guest relations: the title keeps its width and "Record a stay" wraps under it on a phone', () => {
  const screen = source('mobile/src/GuestRelations.tsx');
  assert.match(screen, /<View style=\{\[ui\.between, \{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" \}\]\}>\s*<View style=\{\{ flex: 1, minWidth: 220, gap: 4 \}\}>\s*<Text accessibilityRole="header" style=\{\[ui\.title, \{ color: p\.text \}\]\}>Guest relations<\/Text>/);
});
