import { createServer } from "vite";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
try {
  const { MODULES, DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule("/lib/modules.ts");
  const { WORKSPACE_MAP } = await vite.ssrLoadModule("/lib/workspace-map.ts");
  const routes = {};
  async function visit(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const target = path.join(folder, item.name);
      if (item.isDirectory()) await visit(target);
      else if (item.name === "route.ts") {
        const source = await readFile(target, "utf8");
        routes[path.relative(root, target).replaceAll("\\", "/").replace(/^app/, "").replace(/\/route\.ts$/, "")] = {
          methods: [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map(match => match[1]),
          declaredActions: [...new Set([...source.matchAll(/action:\s*z\.literal\("([^"]+)"\)/g)].map(match => match[1]))],
        };
      }
    }
  }
  await visit(path.join(root, "app/api"));
  const services = { operations: ["/api/operations"], "purchase-order": ["/api/purchase-orders", "/api/purchase-orders/files"], properties: ["/api/property-database"], onboarding: ["/api/onboarding", "/api/onboarding/files"], maintenance: ["/api/maintenance", "/api/maintenance/evidence"], cleans: ["/api/cleans", "/api/cleans/files"], workflows: ["/api/workflows/tickets", "/api/workflows/referrals", "/api/workflows/onboarding"], communications: ["/api/communications/threads", "/api/communications/hostaway/reply", "/api/communications/workflows"], "owner-statements": ["/api/owner-statements"] };
  const inventory = { generatedAt: new Date().toISOString(), scope: "Source inventory only. Routes and declarations do not certify live integration or granular authorization.", modules: MODULES.map(tool => ({ id: tool.id, title: tool.name, destination: WORKSPACE_MAP[tool.id].area, defaultRoles: Object.entries(DEFAULT_ROLE_MODULES).filter(([, ids]) => ids.includes(tool.id)).map(([role]) => role), service: WORKSPACE_MAP[tool.id].service, routes: services[WORKSPACE_MAP[tool.id].service] || [], nativeStatus: "Preview navigation and read-only detail; live edit flow requires service validation", externalReference: tool.url })), routes };
  await writeFile(path.join(root, "docs/MOBILE-WORKFLOW-INVENTORY.json"), JSON.stringify(inventory, null, 2) + "\n");
  console.log(`Mapped ${inventory.modules.length} modules and ${Object.keys(routes).length} routes.`);
} finally { await vite.close(); }
