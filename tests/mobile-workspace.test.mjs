import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { MODULE_IDS, MODULES } = await vite.ssrLoadModule("/lib/modules.ts");
const { WORKSPACE_MAP, navigationFor, searchFeatureTitles, calendarCells } = await vite.ssrLoadModule("/lib/workspace-map.ts");
const { propertiesFor, recordsFor, workFor, toolsFor } = await vite.ssrLoadModule("/mobile/src/model.ts");
const fixtures = await vite.ssrLoadModule("/preview/fixtures.ts");
const { scopeCleanerData, assertCleanerAction } = await vite.ssrLoadModule("/lib/clean-access.ts");

test("cleaner and manager permissions remain separate even with unlinked identities", () => {
  assert(!toolsFor("cleans").some(tool => tool.id === "cleaner-database"));
  assert(toolsFor("cleaning_manager").some(tool => tool.id === "cleaner-database"));
  const own = scopeCleanerData({ role: "cleans", email: "cleaner@example.com" }, fixtures.cleans);
  assert(own.tickets.length > 0);
  assert(own.tickets.every(ticket => ticket.assignedCleanerId === "demo-cleaner"));
  assert.equal(own.onboarding.length, 0);
  assert.equal(own.reviews.length, 0);
  assert.equal(scopeCleanerData({ role: "cleans", email: "unlinked@example.com" }, fixtures.cleans).tickets.length, 0);
  assert.equal(scopeCleanerData({ role: "cleaning_manager", email: "manager@example.com" }, fixtures.cleans).tickets.length, fixtures.cleans.tickets.length);
  for (const action of ["assign_cleaner", "save_cleaner", "approve_clean", "add_to_invoice", "sync"]) assert.throws(() => assertCleanerAction("cleans", action), /manager/);
  assert.doesNotThrow(() => assertCleanerAction("cleans", "start_clean"));
  assert.doesNotThrow(() => assertCleanerAction("cleaning_manager", "assign_cleaner"));
});

test("all 37 original modules retain a destination and each persona has five stable tabs", () => {
  assert.equal(MODULE_IDS.length, 37);
  assert.deepEqual(Object.keys(WORKSPACE_MAP).sort(), [...MODULE_IDS].sort());
  for (const role of ["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "client"]) {
    const tabs = navigationFor(role);
    assert.equal(tabs.length, 5);
    assert.equal(new Set(tabs.map(tab => tab.value)).size, 5);
  }
});

test("feature search trims and ignores case but does not match descriptions or area labels", () => {
  assert.deepEqual(searchFeatureTitles(MODULES, "  ROUTINE  ").map(tool => tool.id).sort(), ["routine-bin-garden-board", "safety-maintenance"].sort());
  assert.equal(searchFeatureTitles(MODULES, "gardening, bin collections").length, 0);
  assert.equal(searchFeatureTitles(MODULES, "internal team").length, 0);
});

test("preview client property lists exclude another owner just as analytics do", () => {
  const other = { ...fixtures.properties.properties[0], id: "isolated-other-property", propertyName: "Another owner's property", ownerEmail: "other@example.com" };
  fixtures.properties.properties.push(other);
  try {
    assert(!propertiesFor("client").some(property => property.id === other.id));
    assert(!recordsFor("client", "client-dashboard").some(property => property.id === other.id));
    assert(propertiesFor("super_admin").some(property => property.id === other.id));
    assert(!propertiesFor("cleans").some(property => property.id === other.id));
  } finally { fixtures.properties.properties.pop(); }
});

test("cleaner jobs exclude other assignments and work queues do not duplicate reporting records", () => {
  const cleanerJobs = recordsFor("cleans", "cleaning-schedule");
  assert.equal(cleanerJobs.length, 10);
  assert(!cleanerJobs.some(job => job.id === "sample-clean-10"));
  const all = workFor("super_admin");
  assert.equal(new Set(all.map(item => item.record.id)).size, all.length);
  assert.equal(recordsFor("client", "cleaning-schedule").length, 0);
  for (const role of ["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "client"]) {
    const allowed = new Set(toolsFor(role).map(tool => tool.id));
    assert(workFor(role).every(item => allowed.has(item.tool.id)));
  }
});

test("calendar uses Monday columns, preserves leap days and rejects invalid months", () => {
  const october = calendarCells("2026-10");
  assert.equal(october[3], "2026-10-01");
  assert.equal(october.filter(Boolean).length, 31);
  assert.equal(october.length % 7, 0);
  assert.equal(calendarCells("2028-02").filter(Boolean).length, 29);
  assert.throws(() => calendarCells("2026-13"));
});
