import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Session E's round 9 sweep, the items routed to Session B (docs/notes-session-E.md, "Round 9"). Read from
// source, as there is no React Native renderer for tests here.
const source = path => readFileSync(path, 'utf8');

test('R4: the Productivity month grid uses theme pairs, not a hand-mixed green', () => {
  const screen = source('mobile/src/LiveProductivity.tsx');
  assert.doesNotMatch(screen, /143,211,194|47,143,111|const heat = /, 'no hand-mixed colour');
  assert.match(screen, /export const BUSY_SHARE = 2 \/ 3;/);
  assert.match(screen, /const heatFill = \(p: Palette, share: number\) => \(busy\(share\) \? p\.selected : p\.wash\);/);
  assert.match(screen, /const heatInk = \(p: Palette, share: number\) => \(busy\(share\) \? p\.onSelected : p\.text\);/);
  // The day number and the hours use the matching ink, at full opacity.
  assert.match(screen, /color: on \? p\.onPrimary : !inMonth \? p\.disabled : share > 0 \? heatInk\(p, share\) : p\.text/);
  assert.match(screen, /color: on \? p\.onPrimary : !inMonth \? p\.disabled : heatInk\(p, share\), fontSize: compact \? 10 : 12, fontWeight: "700", fontVariant: \["tabular-nums"\] \}/);
  assert.doesNotMatch(screen, /opacity: inMonth \? 1 : 0\.38/, 'days outside the month are not faded');
  assert.doesNotMatch(screen, /opacity: on \? 0\.95 : 0\.85/);
  assert.match(screen, /\["Busiest days", p\.selected, p\.selectedBorder\]/, 'the legend names both shades');
});

test('R5: the owner\'s booking calendar draws days outside the month in the disabled ink, no opacity', () => {
  const reports = source('mobile/src/LiveClientReports.tsx');
  assert.match(reports, /color: isToday \? p\.onPrimary : inMonth \? p\.text : p\.disabled, fontSize: 12/);
  assert.doesNotMatch(reports, /opacity: inMonth \|\| isToday \? 1 : 0\.55/);
});

test('R6: Responsibilities filters with the shared Pills (a dropdown above five choices)', () => {
  const team = source('mobile/src/LiveTeamTime.tsx');
  assert.match(team, /import \{ Pills \} from "\.\/Pills";/);
  assert.match(team, /<Pills p=\{p\} title="Show" values=\{\["all", "mine", \.\.\.departments\]\} value=\{filter\} onChange=\{setFilter\}/);
  assert.doesNotMatch(team, /\[\["all", "Everything"\], \["mine", "Mine"\]/, 'no row of chips');
  // Pills turns more than five choices into the Dropdown.
  assert.match(source('mobile/src/Pills.tsx'), /if \(mode !== "pills"\) \{\s*return <Dropdown/);
});
