import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Operation and journey requests are unions; a rejected one names the field and the reason.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { operationsActionSchema, validationReason } = await vite.ssrLoadModule('/lib/operations-policy.ts');
after(() => vite.close());

test('a rejected operation names the field that failed', () => {
  const base = { action: 'updateOperation', requestId: crypto.randomUUID(), workId: crypto.randomUUID(), version: 1 };
  const short = operationsActionSchema.safeParse({ ...base, step: 'completeHandover', data: { evidence: 'Done' } });
  assert.equal(short.success, false);
  assert.match(validationReason(short.error), /^Evidence: .*at least 10/);
  const cost = operationsActionSchema.safeParse({ action: 'createOperation', requestId: crypto.randomUUID(), propertyId: crypto.randomUUID(), kind: 'maintenance', data: { issue: 'Leaking tap in the kitchen', estimatedCostMinor: -5, hazard: false } });
  assert.match(validationReason(cost.error), /^Estimated cost: /);
});
