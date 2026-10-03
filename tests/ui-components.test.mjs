import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test("every Recharge tool has distinct 3D artwork", async () => {
  const { MODULES } = await vite.ssrLoadModule("/lib/modules.ts");
  const { ToolIllustration } = await vite.ssrLoadModule("/components/tool-illustration.tsx");
  const artwork = MODULES.map(module => {
    const html = renderToStaticMarkup(React.createElement(ToolIllustration, {id: module.id}));
    const src = html.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const position = html.match(/<img[^>]+style="([^"]+)"/)?.[1];
    assert.ok(src && position, `${module.id} must have an illustration`);
    return `${src}:${position}`;
  });
  assert.equal(new Set(artwork).size, MODULES.length, "No two tools may share an illustration");
});

test("analytics excludes old and future records and preserves exact status totals", async () => {
  const { buildWorkspaceAnalytics } = await vite.ssrLoadModule("/lib/analytics.ts");
  const now = new Date("2026-10-03T12:00:00").getTime();
  const timestamp = now / 1000;
  const data = { workflows: { available: true, tickets: [
    {createdAt: timestamp, status: "new"}, {createdAt: timestamp - 86400, status: "complete"},
    {createdAt: timestamp - 45 * 86400, status: "new"}, {createdAt: timestamp + 2 * 86400, status: "new"},
  ] }, maintenance: {available: true, tickets: [{createdAt: timestamp, status: "in_progress"}]}, cleans: {available: true, tickets: [{cleanDate: "2026-10-03", status: "approved"}]} };
  const result = buildWorkspaceAnalytics(data, 7, now);
  assert.equal(result.total, 4);
  assert.equal(result.complete, 2);
  assert.equal(result.waiting, 1);
  assert.equal(result.status.reduce((sum,s)=>sum+s.value,0),result.total);
  assert.equal(result.trend.length,7);
  assert.equal(result.trend.reduce((sum,s)=>sum+s.workflows+s.repairs,0),3);
  const empty = buildWorkspaceAnalytics({},7,now);
  assert.equal(empty.total,0);
  assert.ok(empty.sources.every(s=>!s.available));
});

test("API role hierarchy cannot assign elevated access through ordinary admin requests", async () => {
  const { canManageAccess } = await vite.ssrLoadModule("/lib/access-policy.ts");
  assert.equal(canManageAccess("admin","stays","super_admin"), false);
  assert.equal(canManageAccess("admin","admin","stays"), false);
  assert.equal(canManageAccess("admin","stays","ready"), true);
  assert.equal(canManageAccess("client","client","stays"), false);
  assert.equal(canManageAccess("super_admin","admin","super_admin"), true);
});
