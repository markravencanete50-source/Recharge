import { build } from "vite";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({ configFile: `${root}/preview/vite.config.ts` });
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
