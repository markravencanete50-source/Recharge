import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// One look for a chosen chip (Lee, round 6): a pill, day, step, segment or rating that is chosen uses A's pillBox and
// pillInk (mobile/src/Pills.tsx), the `selected` tokens: forest in light, deep green with a mint edge in dark. None fills
// with solid primary, which in dark mode is a bright mint block. A chip is a pressable carrying a selected or checked state;
// its style sits on the same line or the next. Checkbox squares, the today circle and primary buttons are not chips and
// are left alone; a chip outlined in primary on a wash is a lighter look and is allowed.
const dir = "mobile/src";
const files = readdirSync(dir).filter(f => f.endsWith(".tsx"));
const chosen = /accessibilityState=\{\{ (selected|checked)\b/;
const solid = /backgroundColor: (?!isToday\b)[^,{}]*\? p\.primary\b/; // the today circle is a marker, not a choice

test("no chosen chip fills with solid primary", () => {
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(join(dir, file), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!chosen.test(line)) return;
      const style = line + "\n" + (lines[i + 1] ?? "");
      if (/borderRadius: (7|8),/.test(style)) return; // a checkbox square
      if (solid.test(style)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "draw the chip with pillBox(p, on) and its text with pillInk(p, on) from ./Pills");
});

test("the screens that drew their own chosen chips now use pillBox and pillInk", () => {
  for (const file of ["LiveStays", "TeamFlows", "TeamEvents", "LivePages", "CleanReport", "SearchPicker", "AccountsFlows", "LiveRepairs", "LiveFurnishing", "LiveOnboarding", "LiveTraining", "ChecklistTemplates", "ListingSheets"]) {
    const source = readFileSync(join(dir, `${file}.tsx`), "utf8");
    assert.match(source, /import \{[^}]*\bpillBox\b[^}]*\} from "\.\/Pills"/, file);
    assert.match(source, /\.\.\.pillBox\(p, /, file);
  }
});
