import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
// The calm style pass: no thick type, no shiny fills, no decorative loops.
// Files in mobile/src that may still hold a gradient (Linear or Radial Gradient, or a CSS linear, radial or conic gradient).
// The list is empty: every gradient is gone, so a gradient in any file fails. Only add a file here
// with the lead's say-so, and delete its line again as soon as the gradient is removed.
const ALLOWLIST = [];
const read = (path) => readFileSync(path, "utf8");
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const GRADIENT = /(Linear|Radial)Gradient|(linear|radial|conic)-gradient/;

test("the font weight map has no Bold face and nothing heavier than SemiBold", () => {
  const source = read("mobile/src/Typography.tsx");
  assert.doesNotMatch(source, /Montserrat_\d+Bold/);
  assert.doesNotMatch(source, /Montserrat_[789]00/);
  const map = source.slice(source.indexOf("const font ="), source.indexOf("return ("));
  // Heavy weights step down to SemiBold, 600 and 500 to Medium, anything else is Regular.
  const [heavy, rest] = map.split("Montserrat_600SemiBold");
  assert.match(heavy, /"700"/);
  assert.match(heavy, /"800"/);
  assert.match(heavy, /"900"/);
  assert.match(heavy, /"bold"/);
  assert.match(rest, /"600"[\s\S]*"500"[\s\S]*Montserrat_500Medium/);
  assert.match(rest, /Montserrat_400Regular/);
});

test("primaryFill returns a plain background colour with no gradient, sheen or shadow", () => {
  const source = read("mobile/src/theme.ts");
  const start = source.indexOf("export const primaryFill");
  const end = source.indexOf("export const ui");
  assert(start > 0 && end > start);
  const statement = source.slice(start, end);
  assert.doesNotMatch(statement, /gradient|backgroundImage|boxShadow|shadow|Platform/i);
  const body = statement.slice(statement.indexOf("=>") + 2).replace(/;\s*$/, "");
  const fill = new Function("p", "return " + body);
  assert.deepEqual(fill({ primary: "#1F3D38", isDark: false }), { backgroundColor: "#1F3D38" });
  assert.deepEqual(fill({ primary: "#A7D9C1", isDark: true }), { backgroundColor: "#A7D9C1" });
});

test("motion is calm: no springs, no pointer light, no looping placeholder, no blur", () => {
  const source = read("mobile/src/motion.tsx");
  assert.doesNotMatch(source, /Animated\.spring|pointermove|blur\(|--mx|translateY/);
  assert.doesNotMatch(source, /Animated\.loop/, "nothing in motion.tsx loops, the loading placeholder is static");
  for (const name of ["SwapIn", "Entrance", "Stagger", "Float", "Pop", "Bump", "TweenNumber", "CountUp", "NavSymbol", "ExpandChevron", "Shimmer", "useReducedMotion"])
    assert.match(source, new RegExp("export (function|const) " + name + "(?![A-Za-z])"), name + " must stay exported");
});

test("no gradients anywhere in mobile/src outside the allowlist, which is empty", () => {
  const files = walk("mobile/src")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => relative(".", file).split("\\").join("/"));
  const withGradient = files.filter((file) => GRADIENT.test(read(file))).sort();
  const unlisted = withGradient.filter((file) => !ALLOWLIST.includes(file));
  assert.deepEqual(unlisted, [], "gradient found in a file that is not on the allowlist: " + unlisted.join(", "));
  const stale = ALLOWLIST.filter((file) => !withGradient.includes(file));
  assert.deepEqual(stale, [], "no gradient left in these files, delete them from ALLOWLIST: " + stale.join(", "));
  assert.deepEqual([...ALLOWLIST].sort(), ALLOWLIST, "keep the allowlist sorted");
  assert.equal(new Set(ALLOWLIST).size, ALLOWLIST.length, "no duplicate entries");
});
