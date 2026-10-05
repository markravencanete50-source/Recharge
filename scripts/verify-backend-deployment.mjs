import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Anonymous boundary checks only: no accounts, credentials or business writes.
const origin = 'https://recharge-backend.markravencanete50.workers.dev';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(path, expectedStatus, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expectedStatus, `${path}: unexpected HTTP status`);
  assert.equal(response.headers.get('access-control-allow-origin'), null, `${path}: unexpected CORS grant`);
  if (path === '/health' || path.startsWith('/api/') || expectedStatus === 404) {
    assert.match(response.headers.get('cache-control') ?? '', /no-store/i, `${path}: missing no-store`);
  }
  return response;
}

const health = await (await request('/health', 200)).json();
assert.equal(health.service, 'Recharge backend');
assert.equal(health.configured, true, 'Required runtime configuration was not preserved');
console.log('PASS: backend health and required runtime configuration');

const protectedPaths = [
  '/api/workspace', '/api/workspace/reports', '/api/workspace/reports/export',
  '/api/workspace/property-details', '/api/workspace/journeys',
  '/api/workspace/operations', '/api/workspace/portfolio',
  '/api/mobile/workspace', '/api/mobile/journeys',
  '/api/mobile/operations', '/api/mobile/portfolio', '/api/mobile/reports/export',
  '/api/workspace/integrations', '/api/mobile/integrations',
  '/api/workspace/media', '/api/mobile/media',
];
await Promise.all(protectedPaths.map(async path => {
  const payload = await (await request(path, 401)).json();
  assert.equal(typeof payload.error, 'string', `${path}: missing refusal message`);
  assert.equal(payload.data, undefined, `${path}: anonymous data exposure`);
}));
console.log(`PASS: ${protectedPaths.length} protected web/native routes refuse anonymous requests with no-store and no CORS grant`);

const deniedPaths = ['/api/analytics', '/api/onboarding/files', '/api/communications/threads', '/tool/property-onboarding'];
await Promise.all(deniedPaths.map(path => request(path, 404)));
console.log(`PASS: ${deniedPaths.length} legacy/sample routes remain excluded`);

await request('/api/workspace/journeys', 403, {
  method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{}',
});
await request('/api/mobile/journeys', 403, {
  method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{}',
});
console.log('PASS: web/native journey writes reject an untrusted origin before processing');

assert.match(await (await request('/sign-in', 200)).text(), /Recharge/i, 'Sign-in page unavailable');
for (const name of ['recharge-company-logo.png', 'recharge-company-logo-dark.png']) {
  const response = await request(`/${name}`, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/png/i);
  const actual = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(actual), digest(await readFile(new URL(`../public/${name}`, import.meta.url))), `${name}: changed or missing asset`);
}
console.log('PASS: sign-in page and both unchanged company logo assets');
console.log('PASS: all backend release checks. Real-user workflows and provider delivery require separate acceptance testing.');
