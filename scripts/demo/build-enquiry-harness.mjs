// Builds the enquiry form page for the local backend (scripts/demo/server.mjs serves /enquiry from
// scripts/demo/harness): app/enquiry's form rendered in the browser, with the site's CSS.
//   node scripts/demo/build-enquiry-harness.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('./harness/', import.meta.url));
await mkdir(out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./enquiry-harness.tsx', import.meta.url))], bundle: true, format: 'esm', jsx: 'automatic', minify: true, logLevel: 'warning',
  alias: { '@': root.replace(/\/$/, ''), 'next/image': fileURLToPath(new URL('./next-image.tsx', import.meta.url)) }, nodePaths: [root + 'node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' }, outfile: out + 'enquiry.js',
});
const from = root + 'app/globals.css';
const css = await postcss([tailwind({ base: root })]).process(await readFile(from, 'utf8'), { from });
await writeFile(out + 'enquiry.css', css.css);
console.log('Built', out);
