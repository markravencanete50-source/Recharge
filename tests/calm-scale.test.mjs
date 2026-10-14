import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The calmer look (Alex's video feedback): one even type scale, more room between things, counts of nothing
// left out, and long lists cut to a few rows with "Show more".
const read = (path) => readFileSync(path, "utf8");
const theme = read("mobile/src/theme.ts");
const kit = read("mobile/src/LiveKit.tsx");

test("one even type scale: six sizes, each a small step, and the big numbers no longer jump", () => {
  const scale = theme.match(/export const textSize = \{([^}]+)\}/);
  assert(scale, "theme.ts exports textSize");
  const sizes = Object.fromEntries([...scale[1].matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  assert.deepEqual(Object.keys(sizes), ["caption", "small", "body", "heading", "figure", "title"]);
  const values = Object.values(sizes);
  for (let i = 1; i < values.length; i++) assert(values[i] > values[i - 1], "each size is larger than the one before");
  assert(sizes.caption >= 12 && sizes.body >= 15, "captions and body text are not tiny");
  assert(sizes.title <= 28 && sizes.figure <= 24, "titles and figures stay modest");
  assert.match(theme, /statValue: \{\s*fontSize: textSize\.figure/);
  assert.match(theme, /title: \{\s*fontSize: textSize\.title/);
  assert.match(theme, /sectionTitle: \{\s*fontSize: textSize\.heading/);
});

test("spacing steps give more room than before", () => {
  const space = theme.match(/export const space = \{([^}]+)\}/)[1];
  const steps = Object.fromEntries([...space.matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  assert(steps.row >= 12 && steps.section >= 24 && steps.page >= 32, JSON.stringify(steps));
  for (const page of ["LiveCleans", "LiveRepairs", "LiveAccounts", "LiveManagement", "GuestRelations", "ClientRelations"])
    assert.match(read(`mobile/src/${page}.tsx`), /<View style=\{\{ gap: space\.section \}\}>/, page + " spaces its sections by space.section");
});

test("counts of nothing are left out, with an opt-out for screens that must show zeros", () => {
  const grid = kit.slice(kit.indexOf("export function StatGrid"), kit.indexOf("export function StatGrid") + 1200);
  assert.match(grid, /showZeros = false/);
  assert.match(grid, /isZeroTile/);
  assert.match(grid, /<Calm /, "every tile at zero shows one calm line");
  const list = kit.slice(kit.indexOf("export function CountList"));
  assert.match(list, /showZeros/);
  assert.match(list, /value !== 0|value === 0/);
  assert.match(kit, /empty = "Nothing waiting"/);
  // Reports keep their zeros.
  assert.match(read("mobile/src/BusinessReports.tsx"), /<StatGrid showZeros/);
  // A section's count tag only shows when something is waiting.
  assert.match(kit, /\{!!count && <Tag /);
});

test("long lists show the first few rows and a Show more button with a full tap target", () => {
  assert.match(kit, /export const LIST_PREVIEW = \d+/);
  const more = kit.slice(kit.indexOf("export function ShowMore"), kit.indexOf("export function ShowMore") + 900);
  assert.match(more, /minHeight: 44/);
  assert.match(more, /Show \$\{hidden\}/);
  assert.match(read("mobile/src/Tracker.tsx"), /<ShowMore /);
  assert.match(read("mobile/src/LiveCleans.tsx"), /<ShowMore /);
  assert.match(read("mobile/src/SearchPicker.tsx"), /showAll/);
});
