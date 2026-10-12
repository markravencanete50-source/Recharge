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
const { designTokens, departmentTokens, depthTokens, designTokenCss } =
  await vite.ssrLoadModule("/lib/design-tokens.ts");
const { todayColors } = await vite.ssrLoadModule("/lib/today-presentation.ts");
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
    assert(ratio(p.headerText, p.header) >= 4.5);
    assert(ratio(p.headerMuted, p.header) >= 4.5);
    assert(ratio(p.headerText, p.headerControl) >= 4.5);
    assert(ratio(p.headerBorder, p.header) >= 3);
    assert(ratio(p.controlBorder, p.surface) >= 3);
    assert(ratio(p.controlBorder, p.background) >= 3);
    for (const d of Object.values(departmentTokens[mode]))
      assert(ratio(d.ink, d.wash) >= 4.5);
    assert(ratio(p.success, p.successWash) >= 4.5);
  }
});
test("report lines, status fills and schedule text preserve contrast in both themes", () => {
  for (const mode of ["light", "dark"]) {
    const p = designTokens[mode];
    for (const ink of [p.primary, p.success, p.waiting, p.danger]) {
      assert(ratio(ink, p.surface) >= 3, `${mode} graph on card`);
      assert(ratio(ink, p.elevated) >= 3, `${mode} bar on track`);
      assert(ratio(ink, p.surface) >= 4.5, `${mode} direct graph label`);
    }
    for (const d of Object.values(departmentTokens[mode]))
      assert(ratio(d.ink, p.elevated) >= 3, `${mode} department bar`);
    assert(ratio(p.heroText, p.hero) >= 4.5, `${mode} selected day`);
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
test("the calm style pass: flat hero, no shine tokens, no decorative CSS, primary colours unchanged", () => {
  assert.equal(designTokens.light.primary, "#1F3D38");
  assert.equal(designTokens.dark.primary, "#A7D9C1");
  for (const mode of ["light", "dark"]) {
    const p = designTokens[mode];
    assert.equal(p.heroEnd, p.hero, `${mode} hero is one flat colour`);
    assert(ratio(p.heroMuted, p.hero) >= 4.5, `${mode} muted hero text`);
    const d = depthTokens[mode];
    assert.equal(d.sheen, "0 0 #0000", `${mode} sheen stays a valid empty shadow`);
    for (const key of ["spot", "canvas-a", "canvas-b", "shimmer", "glow"])
      assert.match(d[key], /^(transparent|rgba\(0,0,0,0\)|#0000|#00000000)$/, `${mode} ${key} is transparent`);
    for (const key of ["elev-1", "elev-2", "elev-3"]) assert(d[key].includes("rgba"), `${mode} ${key} keeps its depth`);
  }
  for (const mode of ["light", "dark"]) {
    const c = todayColors[mode];
    assert.equal(c.heroEnd, c.heroStart, `${mode} Home panel is flat`);
  }
  assert.doesNotMatch(designTokenCss, /gradient|rc-sweep|data-sheen|data-glyph|data-canvas|data-shimmer|--mx|--my|var\(--rc-(spot|canvas|shimmer)/);
  assert.match(designTokenCss, /outline:2px solid var\(--rc-primary\)/, "the 2 px focus outline stays");
  for (const role of ["radio", "link", "tab", "switch"])
    assert.match(
      designTokenCss,
      new RegExp(`\\[role="${role}"\\]:focus-visible[^{]*\\{outline:2px solid var\\(--rc-primary\\);outline-offset:3px`),
      `${role} keeps a visible focus outline now that the glow is transparent`,
    );
  assert.match(designTokenCss, /prefers-reduced-motion:reduce/, "reduced-motion blocks stay");
  assert.match(designTokenCss, /data-reduce-motion="true"/);
});
