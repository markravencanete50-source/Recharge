import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// E's round 9 sweep (R2, R3): on a 390 px phone nothing in a list row runs past its right edge. Read from source, in
// the style of tests/phone-fit.test.mjs, as there is no React Native renderer for tests here. A one-line text with a
// coloured part nested inside overflowed on the web, so each extra piece now has a line of its own.
const source = path => readFileSync(path, 'utf8');

test('Maintenance rows: status, cost and update wrap; Urgent and Safety hazard get their own line', () => {
  const screen = source('mobile/src/LiveRepairs.tsx');
  const row = screen.slice(screen.indexOf('One thin row a repair'), screen.indexOf('<Feather name="chevron-right" size={icon.row}'));
  assert.ok(row.length > 0, 'the repair row');
  assert.match(row, /<View style=\{\{ flex: 1, minWidth: 0, gap: 2 \}\}>/, 'the text column can shrink beside the chevron');
  assert.match(row, /<Text style=\{\[ui\.small, \{ color: p\.muted \}\]\}>\s*<Text style=\{\{ color: stageNow/, 'the status line is not held to one line');
  assert.match(row, /\{!!flags && <Text style=\{\[ui\.small, \{ color: p\.danger, fontWeight: "600" \}\]\}>\{flags\}<\/Text>\}/);
  assert.doesNotMatch(row, /\{` · \$\{flags\}`\}/, 'the flags no longer ride on the end of the status line');
});

test('Access control rows: the contact and the sign-in time are on lines of their own', () => {
  const screen = source('mobile/src/LiveAccessControl.tsx');
  assert.match(screen, /<Text numberOfLines=\{1\} style=\{\[ui\.small, \{ color: p\.muted \}\]\}>\{person\.email \?\? person\.phone \?\? "No contact"\}<\/Text>/);
  assert.match(screen, /<Text numberOfLines=\{1\} style=\{\[ui\.small, \{ color: online \? p\.success : p\.muted, fontWeight: online \? "700" : "400" \}\]\}>\{presenceText\(person\)\}<\/Text>/);
  assert.doesNotMatch(screen, /"No contact"\} · <Text/, 'no presence nested inside the one-line contact text');
  // Both lines sit in the column that is allowed to shrink.
  assert.match(screen, /<View style=\{\{ flex: 1, minWidth: 0, gap: 3 \}\}>/);
});
