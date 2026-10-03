import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  publicDir: `${projectRoot}/public`,
  plugins: [react()],
  resolve: { alias: {
    "@": projectRoot,
    "next/navigation": fileURLToPath(new URL("./navigation.ts", import.meta.url)),
  } },
  css: { postcss: projectRoot },
  build: { outDir: `${projectRoot}/preview-dist`, emptyOutDir: true },
});
