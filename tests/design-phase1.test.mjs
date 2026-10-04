import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());
const { MODULE_IDS, MODULES } = await vite.ssrLoadModule("/lib/modules.ts");
const { WORKSPACE_MAP } = await vite.ssrLoadModule("/lib/workspace-map.ts");
const { featureGlyphs, departmentGlyphs, iconNodes } =
  await vite.ssrLoadModule("/lib/artwork.ts");
const { designTokens, departmentTokens } = await vite.ssrLoadModule(
  "/lib/design-tokens.ts",
);
const { findTools, titleParts } = await vite.ssrLoadModule(
  "/lib/tool-finder.ts",
);
const luminance = (hex) => {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};
const ratio = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
test("all 37 features and five departments have distinct nonempty vector geometry, including a separate save control", () => {
  assert.deepEqual(Object.keys(featureGlyphs).sort(), [...MODULE_IDS].sort());
  const names = [
    ...Object.values(featureGlyphs),
    ...Object.values(departmentGlyphs),
  ];
  assert.equal(new Set(names).size, 42);
  for (const name of [...names, "bookmark"]) assert(iconNodes[name]?.length);
  assert(!names.includes("bookmark"));
  assert(!names.includes("sun"));
});
test("text, department tiles, input borders and primary action labels meet contrast targets in both themes", () => {
  for (const mode of ["light", "dark"]) {
    const p = designTokens[mode];
    for (const bg of [p.background, p.surface, p.elevated, p.wash])
      for (const ink of [p.text, p.muted])
        assert(ratio(ink, bg) >= 4.5, `${mode} ${ink} on ${bg}`);
    assert(ratio(p.onPrimary, p.primary) >= 4.5);
    assert(ratio(p.controlBorder, p.surface) >= 3);
    assert(ratio(p.controlBorder, p.background) >= 3);
    for (const d of Object.values(departmentTokens[mode]))
      assert(ratio(d.ink, d.wash) >= 4.5);
    assert(ratio(p.success, p.successWash) >= 4.5);
  }
});
test("finder scales to 100 entries without truncating counts, saved rows or literal title matching", () => {
  const catalog = Array.from({ length: 100 }, (_, i) => {
    const tool = MODULES[i % 37];
    return {
      key: "test-" + i,
      name: tool.name + " " + (i + 1),
      tone: WORKSPACE_MAP[tool.id].tone,
      tool,
    };
  });
  assert.equal(findTools(catalog, "").length, 100);
  assert.equal(findTools(catalog, "  DIRECT BOOKING ").length, 3);
  assert.equal(findTools(catalog, "DOES NOT EXIST").length, 0);
  assert.equal(
    findTools(
      catalog,
      "",
      catalog.map((t) => t.key),
    ).length,
    100,
  );
  assert.equal(
    ["stays", "ready", "cleans", "clients", "accounts"].reduce(
      (sum, tone) => sum + catalog.filter((t) => t.tone === tone).length,
      0,
    ),
    100,
  );
  assert.deepEqual(
    titleParts("A + B + C", "+")
      .filter((t) => t.match)
      .map((t) => t.text),
    ["+", "+"],
  );
});
