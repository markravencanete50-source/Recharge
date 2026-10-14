import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Lee: "remove all of the emdash". No text the app or its emails show may contain an em dash (—). Code comments may.
// Written as two short sentences, a full stop, or a word ("None") instead.
const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? (name === "node_modules" ? [] : walk(full)) : /\.(ts|tsx)$/.test(name) ? [full] : [];
});
// Drops block and JSX comments, then line comments (a // that starts a line or follows a space, so "https://" stays).
const code = source => source.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

test("no user-facing text in mobile/src, lib or app contains an em dash", () => {
  const found = [];
  for (const file of [...walk("mobile/src"), ...walk("lib"), ...walk("app"), "mobile/App.tsx"]) {
    const lines = code(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => { if (line.includes("—")) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(found, []);
});

test("the page title has no accent line under it", () => {
  const pages = readFileSync("mobile/src/LivePages.tsx", "utf8");
  const heading = pages.slice(pages.indexOf("export function PageHeading"), pages.indexOf("export function PageHeading") + 1500);
  assert.doesNotMatch(heading, /DrawLine/);
});
