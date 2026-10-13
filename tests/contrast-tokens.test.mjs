import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

// Every text and background pair the app draws from the tokens (lib/contrast.ts) meets WCAG AA in both
// themes: 4.5:1 for body text, 3:1 for large text, icons and control outlines. Run on its own with
//   node --test tests/contrast-tokens.test.mjs
// and it prints the table, lowest ratio first.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
after(() => vite.close());
const { contrastReport, contrastPairs, contrastRatio } = await vite.ssrLoadModule("/lib/contrast.ts");
const { designTokens } = await vite.ssrLoadModule("/lib/design-tokens.ts");
const report = contrastReport();

test("every token pair meets its contrast minimum in light and dark", () => {
  const rows = [...report].sort((a, b) => a.ratio / a.minimum - b.ratio / b.minimum);
  console.log(rows.map(r => `# ${r.mode.padEnd(5)} ${r.ratio.toFixed(2).padStart(5)} ≥ ${String(r.minimum).padEnd(3)} ${r.ink} on ${r.ground} (${r.inkHex} on ${r.groundHex}): ${r.use}`).join("\n"));
  const failing = rows.filter(r => r.ratio < r.minimum);
  assert.deepEqual(failing.map(r => `${r.mode}: ${r.ink} on ${r.ground} is ${r.ratio.toFixed(2)}, needs ${r.minimum} (${r.use})`), []);
});

test("both themes define the same tokens, every one a #RRGGBB or #RRGGBBAA colour", () => {
  assert.deepEqual(Object.keys(designTokens.dark).sort(), Object.keys(designTokens.light).sort());
  for (const mode of ["light", "dark"])
    for (const [key, value] of Object.entries(designTokens[mode])) assert.match(value, /^#([0-9A-F]{6}|[0-9A-F]{8})$/i, `${mode} ${key}`);
  for (const [ink, ground] of contrastPairs) assert(ink in designTokens.light && ground in designTokens.light, `${ink} on ${ground} are tokens`);
});

test("the dark scale steps up from the page: background, surface, raised, border, control outline", () => {
  const d = designTokens.dark;
  const steps = ["background", "surface", "elevated", "border", "controlBorder"];
  for (let i = 1; i < steps.length; i++)
    assert(contrastRatio(d[steps[i]], d.background) > contrastRatio(d[steps[i - 1]], d.background), `${steps[i]} is lighter than ${steps[i - 1]}`);
  // Text steps down: text, muted, disabled.
  assert(contrastRatio(d.text, d.surface) > contrastRatio(d.muted, d.surface));
  assert(contrastRatio(d.muted, d.surface) > contrastRatio(d.disabled, d.surface));
});

test("the brand stays: forest green and bone", () => {
  assert.equal(designTokens.light.primary, "#1F3D38");
  assert.equal(designTokens.light.background, "#EFE9DB");
  assert.equal(designTokens.dark.header, "#EFE9DB");
  assert.equal(designTokens.dark.hero, "#1F3D38");
});

test("shared controls draw from the state tokens, not hand-picked colours", () => {
  const kit = readFileSync("mobile/src/LiveKit.tsx", "utf8");
  const button = kit.slice(kit.indexOf("export function Button("), kit.indexOf("export function RefreshButton"));
  assert.match(button, /p\.washBorder/, "the secondary button has a visible edge");
  assert.match(button, /p\.disabled/, "a disabled button's label uses the disabled token");
  assert.doesNotMatch(button, /#[0-9A-Fa-f]{3,8}\b|rgba?\(/, "no literal colours in Button");
});
