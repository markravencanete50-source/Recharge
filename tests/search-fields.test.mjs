import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Lee: a search field shows focus once, by its own frame; never a second box, outline or glow inside it. Every
// "Search …" field is the shared SearchBox (mobile/src/SearchPicker.tsx), whose frame is marked bareInput so the
// global input outline in lib/design-tokens.ts never draws inside it. The one exception is the workspace search panel,
// which has its own bareInput frame. A new raw TextInput with a "Search …" placeholder fails here.
const dir = "mobile/src";
const files = readdirSync(dir).filter(f => f.endsWith(".tsx"));
const searchInput = /<TextInput\b[^>]*?placeholder=\{?["`]Search/gs;

test("every TextInput with a \"Search …\" placeholder is the shared SearchBox or sits in a bareInput frame", () => {
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const match of source.matchAll(searchInput)) {
      const before = source.slice(Math.max(0, match.index - 700), match.index);
      if (file === "SearchPicker.tsx" && before.includes("export function SearchBox(")) continue;
      if (/dataSet: \{ bareInput: "true" \}/.test(before)) continue;
      offenders.push(`${file}: ${source.slice(match.index, match.index + 90).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(offenders, [], "use SearchBox from ./SearchPicker for these");
});

test("SearchBox shows focus by its frame only: bareInput, a primary border, no outline, glow or animation", () => {
  const source = readFileSync(join(dir, "SearchPicker.tsx"), "utf8");
  const box = source.slice(source.indexOf("export function SearchBox("), source.indexOf("function OptionChip("));
  assert.match(box, /dataSet: \{ bareInput: "true" \}/);
  assert.match(box, /borderColor: focused \? p\.primary : p\.controlBorder/);
  assert.match(box, /outlineStyle: "none"/);
  assert.doesNotMatch(box, /boxShadow|transition|Animated|glow/i);
});

test("the global focus rule leaves bare frames alone", () => {
  const css = readFileSync("lib/design-tokens.ts", "utf8");
  assert.match(css, /\[data-bare-input\] :is\(input,textarea\):is\(:focus,:focus-visible\)\{outline:none!important;box-shadow:none!important\}/);
});
