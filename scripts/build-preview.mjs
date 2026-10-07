import { build } from "vite";
import { writeFile, readFile, readdir, cp, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const expoCli = `${root}/mobile/node_modules/expo/bin/cli`;
if (!existsSync(expoCli)) {
  if (!process.env.npm_execpath) throw new Error("Install mobile dependencies with npm ci --prefix mobile before building.");
  execFileSync(process.execPath, [process.env.npm_execpath, "ci", "--prefix", "mobile"], { cwd: root, stdio: "inherit" });
}
await rm(`${root}/preview-dist`, { recursive: true, force: true });
await mkdir(`${root}/preview-dist`, { recursive: true });
// One responsive component bundle powers desktop, mobile web and the studio.
execFileSync(process.execPath, [expoCli, "export", "--platform", "web", "--output-dir", "dist-web"], { cwd: `${root}/mobile`, stdio: "inherit" });
await cp(`${root}/mobile/dist-web/index.html`, `${root}/preview-dist/native.html`);
await cp(`${root}/mobile/dist-web/studio.html`, `${root}/preview-dist/studio.html`);
await cp(`${root}/mobile/dist-web/_expo`, `${root}/preview-dist/_expo`, { recursive: true });
await cp(`${root}/mobile/dist-web/assets`, `${root}/preview-dist/assets`, { recursive: true });
// Pages omits directories named node_modules from its uploaded static assets.
// Metro exports fonts/router images there; publish them under a neutral name.
await cp(`${root}/preview-dist/assets/node_modules`, `${root}/preview-dist/assets/vendor`, { recursive: true });
await rm(`${root}/preview-dist/assets/node_modules`, { recursive: true });
const webBundleDir = `${root}/preview-dist/_expo/static/js/web`;
let nativeHtml = await readFile(`${root}/preview-dist/native.html`, "utf8");
for (const name of await readdir(webBundleDir)) {
  if (!name.endsWith(".js")) continue;
  const path = `${webBundleDir}/${name}`;
  const bundle = (await readFile(path, "utf8")).replaceAll("/assets/node_modules/", "/assets/vendor/");
  const publishedName = `${name.slice(0, -3)}-pages-${createHash("sha256").update(bundle).digest("hex").slice(0, 12)}.js`;
  await writeFile(`${webBundleDir}/${publishedName}`, bundle);
  await rm(path);
  nativeHtml = nativeHtml.replaceAll(name, publishedName);
}
await writeFile(`${root}/preview-dist/native.html`, nativeHtml);
await cp(`${root}/mobile/dist-web/favicon.ico`, `${root}/preview-dist/favicon.ico`);
// Pages advanced mode supports this bundled Worker through Git and dashboard uploads.
await build({
  configFile: false,
  root,
  publicDir: false,
  resolve: { alias: { "@": root } },
  build: {
    outDir: `${root}/preview-dist`, emptyOutDir: false,
    lib: { entry: `${root}/preview/worker.ts`, formats: ["es"], fileName: () => "_worker.js" },
  },
});
await writeFile(`${root}/preview-dist/_routes.json`, JSON.stringify({version: 1, include: ["/*"], exclude: []}));
