import assert from "node:assert/strict";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { fileURLToPath } from "node:url";

test("the built Cloudflare server redirects unauthenticated users to a usable sign-in page", async () => {
  // The built server imports cloudflare:workers and must run in workerd,
  // rather than being imported into Node's incompatible module loader.
  process.env.WRANGLER_SEND_METRICS = "false";
  const worker = await unstable_dev(fileURLToPath(new URL("../dist/server/index.js", import.meta.url)), {
    config: fileURLToPath(new URL("../dist/server/wrangler.json", import.meta.url)),
    local: true, ip: "127.0.0.1", port: 0, persist: false, logLevel: "error",
    experimental: { disableExperimentalWarning: true, watch: false, disableDevRegistry: true },
  });
  try {
    const origin = `http://${worker.address}:${worker.port}`;
    // The old portal is retired: the front page goes to the live workspace,
    // which sends signed-out visitors to sign in.
    const home = await worker.fetch(origin + "/", { redirect: "manual" });
    assert.equal(home.status, 307);
    assert.equal(new URL(home.headers.get("location")).pathname, "/workspace");
    const workspace = await worker.fetch(origin + "/workspace", { redirect: "manual" });
    assert.equal(workspace.status, 307);
    assert.equal(new URL(workspace.headers.get("location")).pathname, "/sign-in");
    const response = await worker.fetch(origin + "/sign-in", { redirect: "manual", headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), /Welcome back/);
    assert.match(response.headers.get("cache-control"), /no-store/);
  } finally { await worker.stop(); }
});
