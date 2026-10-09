// Builds the phone app for the browser and places it where the backend serves /workspace,
// so the web workspace and the phone app are the same screens. Runs after the main build
// (npm run build); the Worker serves dist/client/workspace (worker/index.ts).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = `${root}mobile`;
const expoCli = `${mobile}/node_modules/expo/bin/cli`;
if (!existsSync(expoCli)) {
  if (!process.env.npm_execpath) throw new Error("Install the app's packages with npm ci --prefix mobile before building.");
  execFileSync(process.execPath, [process.env.npm_execpath, "ci", "--prefix", "mobile"], { cwd: root, stdio: "inherit" });
}
const out = `${mobile}/dist-workspace`;
await rm(out, { recursive: true, force: true });
execFileSync(process.execPath, [expoCli, "export", "--platform", "web", "--output-dir", "dist-workspace", "--clear"], {
  cwd: mobile, stdio: "inherit",
  // Files under /workspace, and the live connection through the web session on the same origin.
  env: { ...process.env, RECHARGE_WEB_BASE_URL: "/workspace", EXPO_PUBLIC_WORKSPACE_WEB: "same-origin", RECHARGE_LIVE_ONLY: "1" },
});

// Cloudflare's asset upload leaves out folders named node_modules; Metro puts fonts there.
const vendored = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await vendored(path);
    else if (/\.(html|js|css|json)$/.test(entry.name)) {
      const text = await readFile(path, "utf8");
      if (text.includes("/assets/node_modules/")) await writeFile(path, text.replaceAll("/assets/node_modules/", "/assets/vendor/"));
    }
  }
};
if (existsSync(`${out}/assets/node_modules`)) {
  await cp(`${out}/assets/node_modules`, `${out}/assets/vendor`, { recursive: true });
  await rm(`${out}/assets/node_modules`, { recursive: true });
}
await vendored(out);

const target = `${root}dist/client/workspace`;
if (!existsSync(`${root}dist/client`)) throw new Error("Run the main build first: dist/client is missing.");
await rm(target, { recursive: true, force: true });
await cp(out, target, { recursive: true });
if (!existsSync(`${target}/index.html`)) throw new Error("The app's web build has no index.html.");
// Installable app and notifications: the manifest, home-screen icons and the service worker
// (mobile/web-static), linked from the page so phones can add Recharge to the home screen.
await cp(`${mobile}/web-static`, target, { recursive: true });
// The studio page is a development aid for the sample preview; the live app never links to it.
await rm(`${target}/studio.html`, { force: true });
const page = await readFile(`${target}/index.html`, "utf8");
const install = '<link rel="manifest" href="/workspace/manifest.webmanifest"><link rel="apple-touch-icon" href="/workspace/apple-touch-icon.png"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Recharge"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
if (!page.includes('rel="manifest"')) await writeFile(`${target}/index.html`, page.replace("</head>", install + "</head>"));
console.log("Built the workspace app for the web: dist/client/workspace");
