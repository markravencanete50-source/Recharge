import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// One way to write numbers, money, percentages and dates across the app.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const f = await vite.ssrLoadModule('/lib/format.ts');
after(() => vite.close());

test('counts, compact numbers and money', () => {
  assert.equal(f.formatCount(1234), '1,234');
  assert.equal(f.formatCount(null), '–');
  assert.equal(f.formatCompact(9999), '9,999');
  assert.equal(f.formatCompact(12_500), '12.5k');
  assert.equal(f.formatCompact(2_500_000), '2.5m');
  assert.equal(f.formatMoney(123450), '£1,234.50');
  assert.equal(f.formatMoney(-1200), '−£12.00');
  assert.equal(f.formatMoneyShort(85000), '£850');
  assert.equal(f.formatMoneyShort(8550), '£85.50');
  assert.equal(f.formatMoneyShort(1_250_000), '£12.5k');
});

test('percentages, durations, days and plurals', () => {
  assert.equal(f.formatBps(1250), '12.5%');
  assert.equal(f.formatShare(0.946), '94%');
  assert.equal(f.formatDuration(45), '45 min');
  assert.equal(f.formatDuration(425), '7h 05m');
  assert.equal(f.formatDay('2026-10-08', new Date('2026-10-08T10:00:00Z')), 'Thu 8 Oct');
  assert.equal(f.formatDay('2025-12-24', new Date('2026-10-08T10:00:00Z')), 'Wed 24 Dec 2025');
  assert.equal(f.plural(1, 'property', 'properties'), '1 property');
  assert.equal(f.plural(1200, 'clean'), '1,200 cleans');
});
