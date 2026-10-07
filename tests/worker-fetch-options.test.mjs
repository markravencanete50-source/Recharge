import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Cloudflare Workers throw on fetch(..., { redirect: 'error' }) ("Invalid redirect value"), so
// every call to Hostaway, Cloudinary, Resend or Expo failed on the live backend while passing in
// Node. Server code uses redirect: 'manual' and treats a 3xx answer as a failure.
test('server code never uses a fetch option Cloudflare Workers reject', async () => {
  const offenders = [];
  const scan = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(path);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && /redirect\s*:\s*["']error["']/.test(await readFile(path, 'utf8'))) offenders.push(path);
    }
  };
  for (const dir of ['lib', 'app', 'worker']) await scan(dir);
  assert.deepEqual(offenders, []);
});
