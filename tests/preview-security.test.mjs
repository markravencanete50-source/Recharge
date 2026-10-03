import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.PREVIEW_TEST_URL || "http://127.0.0.1:4173";

test("preview serves the application and synthetic property data", async () => {
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Recharge \| Product preview/);
  assert.match(home.headers.get("x-robots-tag"), /noindex/);
  const response = await fetch(`${base}/api/property-database`, {headers: {"oai-authenticated-user-email": "enquiries@rechargestays.co.uk"}});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.data.properties.length, 2);
  assert.ok(result.data.properties.every(property => property.ownerEmail === "preview@example.com" && property.accessCode === ""));
  assert.equal(result.data.hostawayConnected, false);
});

test("direct requests cannot mutate records or invoke integrations", async () => {
  for (const [path, method] of [["/api/access", "POST"], ["/api/property-database", "DELETE"], ["/api/maintenance", "PATCH"], ["/api/communications/hostaway/sync", "POST"], ["/api/onboarding/files", "POST"], ["/", "POST"]]) {
    const response = await fetch(`${base}${path}`, {method, headers: {"oai-authenticated-user-email": "enquiries@rechargestays.co.uk", "x-recharge-migration-key": "test"}});
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match((await response.json()).error, /read-only/);
  }
});

test("unconnected APIs and legacy authentication routes never fall back to application HTML", async () => {
  for (const path of ["/api", "/api/unknown", "/api/maintenance/evidence/demo", "/signin-with-chatgpt", "/sign-in", "/sign-out", "/api/session", "/tool/client-furnishing", "/_worker.js"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.ok((await response.json()).error);
  }
});
