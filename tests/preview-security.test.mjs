import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";
import { fileURLToPath } from "node:url";

let base = process.env.PREVIEW_TEST_URL;
let worker;
before(async()=>{
  if(base)return;
  process.env.WRANGLER_SEND_METRICS="false";
  worker=await unstable_dev(fileURLToPath(new URL('../preview-dist/_worker.js',import.meta.url)),{
    config:fileURLToPath(new URL('../preview/wrangler.jsonc',import.meta.url)),local:true,ip:'127.0.0.1',port:0,persist:false,logLevel:'error',
    experimental:{disableExperimentalWarning:true,watch:false,disableDevRegistry:true},
  });
  base=`http://${worker.address}:${worker.port}`;
});
after(async()=>{await worker?.stop();});

test("preview serves the application, and the retired portal address returns to it", async () => {
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html=await home.text();
  assert.match(html, /Recharge Mobile Preview/);
  const mobileHtml=await (await fetch(`${base}/home`)).text();
  assert.equal(html,mobileHtml,'desktop and mobile must serve the same responsive screens');
  assert.match(home.headers.get("x-robots-tag"), /noindex/);
  // The old portal is retired: its preview address sends visitors to the app.
  const legacy=await fetch(`${base}/legacy-preview`,{redirect:'manual'});
  assert.equal(legacy.status,301);
  assert.equal(new URL(legacy.headers.get('location')).pathname,'/');
  // No sample API data is served any more.
  const api = await fetch(`${base}/api/property-database`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type"), /application\/json/);
});

test("hosted phone links serve the new mobile studio and reloadable mobile routes", async () => {
  for (const path of ["/?view=phone", "/studio.html"]) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Recharge mobile studio/);
  }
  for (const path of ["/home", "/analytics", "/workspace", "/help", "/activity"]) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 200, `${path} must load without changing the frame's URL`);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /Recharge Mobile Preview/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
  }
});

test("direct requests cannot mutate records or invoke integrations", async () => {
  for (const [path, method] of [["/api/access", "POST"], ["/api/property-database", "DELETE"], ["/api/maintenance", "PATCH"], ["/api/communications/hostaway/sync", "POST"], ["/api/onboarding/files", "POST"], ["/", "POST"]]) {
    const response = await fetch(`${base}${path}`, {method, headers: {"oai-authenticated-user-email": "enquiries@rechargestays.co.uk", "x-recharge-migration-key": "test"}});
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match((await response.json()).error, /read-only/);
  }
});

test("mobile icon fonts are published outside ignored dependency directories", async () => {
  const html = await (await fetch(`${base}/home`)).text();
  const scriptPath = html.match(/src="([^"]+\/entry-[^"]+\.js)"/)?.[1];
  assert.ok(scriptPath, "mobile entry bundle is referenced");
  const bundle = await (await fetch(new URL(scriptPath, base))).text();
  assert.ok(!bundle.includes("/assets/node_modules/"), "no ignored dependency asset paths remain");
  const fontPath = bundle.match(/\/assets\/vendor\/[^"']*\/Feather\.[^"']*\.ttf/)?.[0];
  assert.ok(fontPath, "the visible interface's Feather font is referenced");
  const font = await fetch(new URL(fontPath, base));
  assert.equal(font.status, 200);
  assert.ok(!font.headers.get("content-type").includes("text/html"), "font request must not fall back to page HTML");
  const bytes = new Uint8Array(await font.arrayBuffer());
  assert.ok(bytes.length > 50000, "complete font bytes are served");
});

test("unconnected APIs and legacy authentication routes never fall back to application HTML", async () => {
  for (const path of ["/api", "/api/unknown", "/api/maintenance/evidence/demo", "/signin-with-chatgpt", "/sign-in", "/sign-out", "/api/session", "/api/session/recovery", "/api/session/password", "/auth/recovery", "/reset-password", "/update-password", "/tool/client-furnishing", "/_worker.js"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.ok((await response.json()).error);
  }
});
