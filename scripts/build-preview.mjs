import { build } from "vite";
import { writeFile, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const expoCli = `${root}/mobile/node_modules/expo/bin/cli`;
if (!existsSync(expoCli)) {
  if (!process.env.npm_execpath) throw new Error("Install mobile dependencies with npm ci --prefix mobile before building.");
  execFileSync(process.execPath, [process.env.npm_execpath, "ci", "--prefix", "mobile"], { cwd: root, stdio: "inherit" });
}
await build({ configFile: `${root}/preview/vite.config.ts` });
// Ship the mobile components alongside the original desktop product preview.
execFileSync(process.execPath, [expoCli, "export", "--platform", "web", "--output-dir", "dist-web"], { cwd: `${root}/mobile`, stdio: "inherit" });
await cp(`${root}/mobile/dist-web/index.html`, `${root}/preview-dist/native.html`);
await cp(`${root}/mobile/dist-web/studio.html`, `${root}/preview-dist/studio.html`);
await cp(`${root}/mobile/dist-web/_expo`, `${root}/preview-dist/_expo`, { recursive: true });
await cp(`${root}/mobile/dist-web/assets`, `${root}/preview-dist/assets`, { recursive: true });
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
