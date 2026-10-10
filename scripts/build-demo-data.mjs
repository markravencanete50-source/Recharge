// Records the demo business for Demo mode (lib/demo-data.ts) into mobile/web-static/demo-data.json.
//
// It replays every read the app makes (scripts/demo/requests.json, one list per role) against the
// local review backend, which runs the real database functions on a seeded sample business
// (scripts/demo/server.mjs), and keeps each answer under the key the app will ask with. Dates in
// the questions are stored relative to today, and the file records today's date, so the app can
// move every date in the answers forward and the sample always looks current.
//
//   node scripts/demo/server.mjs &          # the local backend with the sample business
//   node scripts/build-demo-data.mjs        # writes mobile/web-static/demo-data.json
//
// To record screens added later, crawl the app on the local backend and add the new requests to
// scripts/demo/requests.json (the crawl keeps each request path exactly as the browser sent it).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.DEMO_BACKEND ?? "http://localhost:4318";
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false }, logLevel: "error" });
const { DEMO_ROLES, demoKey, demoLooseKey, demoDataSchema } = await vite.ssrLoadModule("/lib/demo-data.ts");
const requests = JSON.parse(await readFile(new URL("./demo/requests.json", import.meta.url), "utf8"));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
// The browser build asks /api/workspace/…; the app's own paths (what demo mode is asked) are /api/mobile/….
const mobilePath = path => path.replace(/^\/api\/workspace(?=[/?]|$)/, "/api/mobile/workspace").replace(/^\/api\/mobile\/workspace\/(?!$)/, "/api/mobile/");
const get = async (role, path) => {
  const response = await fetch(base + path, { headers: { cookie: `devstack-user=${role}`, accept: "application/json" } });
  const type = response.headers.get("content-type") ?? "";
  return { ok: response.ok, status: response.status, body: type.includes("json") ? await response.json() : await response.text() };
};
const personas = {};
for (const role of DEMO_ROLES) {
  const list = requests[role] ?? [];
  const account = await get(role, "/api/workspace/account");
  if (!account.ok) throw new Error(`${role}: the local backend did not answer /api/workspace/account (${account.status}). Is scripts/demo/server.mjs running?`);
  const responses = {}, loose = {}, failed = [];
  for (const path of list) {
    const answer = await get(role, path);
    if (!answer.ok) { failed.push(`${answer.status} ${path}`); continue; }
    const asked = mobilePath(path);
    responses[demoKey(asked, today)] = answer.body;
    // The first answer for each looser key stands in for questions the recording doesn't have.
    const fallback = demoLooseKey(asked);
    if (!(fallback in loose)) loose[fallback] = answer.body;
  }
  personas[role] = { account: account.body.account, responses, loose };
  console.log(`${role}: ${Object.keys(responses).length} answers${failed.length ? `, ${failed.length} failed:\n  ${failed.join("\n  ")}` : ""}`);
}
const data = demoDataSchema.parse({ version: 1, capturedOn: today, personas });
const out = new URL("../mobile/web-static/demo-data.json", import.meta.url);
await writeFile(out, JSON.stringify(data));
console.log(`Wrote ${fileURLToPath(out)} (${Math.round(JSON.stringify(data).length / 1024)} KB)`);
await vite.close();
