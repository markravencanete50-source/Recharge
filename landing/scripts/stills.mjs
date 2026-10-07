// Dev helper: render single frames to PNG to check the animation.
// Usage: node scripts/stills.mjs <outDir> <WxH> <frame> [frame...]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [outDir, size, ...frames] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const browserExecutable = [process.env.REMOTION_BROWSER, "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find(p => p && existsSync(p)) ?? null;
const serveUrl = await bundle({ entryPoint: path.join(root, "remotion/index.ts"), publicDir: path.join(root, "public") });
const base = await selectComposition({ serveUrl, id: "reel", browserExecutable });
const composition = { ...base, width, height, durationInFrames: 2000 };
for (const frame of frames.map(Number)) {
  await renderStill({ composition, serveUrl, frame, browserExecutable, output: path.join(outDir, `${width}x${height}-${String(frame).padStart(3, "0")}.png`) });
}
console.log("done");
