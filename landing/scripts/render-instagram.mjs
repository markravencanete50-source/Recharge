// Render the Instagram videos (MP4, H.264 + AAC, 30 fps) with the soundtrack.
// Usage: npm run instagram        (rebuilds the soundtrack, then renders both formats)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "out");
// Use a local Chromium when one is installed; otherwise Remotion downloads its own.
const browserExecutable = [process.env.REMOTION_BROWSER, "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find(p => p && existsSync(p)) ?? null;
const serveUrl = await bundle({ entryPoint: path.join(root, "remotion/index.ts"), publicDir: path.join(root, "public") });
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ["reel", "feed"]) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable });
  const outputLocation = path.join(outDir, `recharge-${id}.mp4`);
  await renderMedia({
    composition, serveUrl, codec: "h264", audioCodec: "aac", audioBitrate: "192k", crf: 16, pixelFormat: "yuv420p",
    scale: 2.5, browserExecutable, outputLocation,
    onProgress: ({ progress }) => process.stdout.write(`\r${id}: ${Math.round(progress * 100)}%   `),
  });
  console.log(`\n${outputLocation}`);
}
