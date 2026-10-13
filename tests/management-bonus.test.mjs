import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The management bonus, round 6: the bar for a manager reads "Guest relations and Client relations, combined", with each
// team's own figure under it. The averaging itself is the database's (tests/management-bonus-database.test.mjs).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const k = await vite.ssrLoadModule('/lib/kpis.ts');
const mp = await vite.ssrLoadModule('/lib/my-performance.ts');
const { KPI_MEASURES } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const kpi = k.kpiSchema.parse({ id: 'm1', name: 'Guest relations and Client relations, combined', area: 'management', measure: 'teams_combined', minutes: null, direction: 'higher',
  targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: true, active: true, sortOrder: 1, version: 2, updatedAt: '2026-10-13T12:00:00Z' });
const result = (value, g, c) => k.kpiResultSchema.parse({ kpiId: 'm1', value, measured: 6, count: null, onTarget: value === null ? null : value >= 80, tier: null, tierAt: null,
  parts: [{ area: 'guest_relations', value: g, measured: 4 }, { area: 'client_relations', value: c, measured: 2 }] });

test('the label: Guest relations and Client relations, combined, in the management area', () => {
  assert.ok(KPI_MEASURES.includes('teams_combined'));
  assert.equal(k.kpiMeasureLabel(kpi), 'Guest relations and Client relations, combined');
  const bar = k.kpiProgress(kpi, result(86, 86, 86));
  assert.deepEqual([bar.areaLabel, bar.name, bar.measureLabel, bar.placeholder], ['Management', 'Guest relations and Client relations, combined', 'Guest relations and Client relations, combined', true]);
  assert.deepEqual(bar.marks.map(m => [m.label, m.at]), [['Target', 80], ['Tier 1', 90], ['Tier 2', 95]]);
});

test('the two parts under the bar: both, one, neither', () => {
  assert.equal(mp.bonusPartsLine(k.kpiProgress(kpi, result(80, 86, 74)).parts), 'Guest relations 86% · Client relations 74%');
  assert.equal(mp.bonusPartsLine(k.kpiProgress(kpi, result(86, 86, null)).parts), 'Guest relations 86% · Client relations nothing to measure yet');
  const none = k.kpiProgress(kpi, result(null, null, null));
  assert.equal(none.headline, 'Nothing to measure yet');
  assert.equal(mp.bonusPartsLine(none.parts), 'Guest relations nothing to measure yet · Client relations nothing to measure yet');
  // Any other bonus has no parts and no line; an older read without parts still parses.
  const other = k.kpiSchema.parse({ ...kpi, measure: 'performance_score', name: 'Performance score' });
  assert.deepEqual(k.kpiProgress(other, k.kpiResultSchema.parse({ kpiId: 'm1', value: 70, measured: 1, count: null, onTarget: false, tier: null, tierAt: null })).parts, []);
  assert.equal(mp.bonusPartsLine([]), '');
  assert.equal(mp.bonusPartsLine(undefined), '');
});

test('the admin form takes the measure for management only', () => {
  const measures = [{ key: 'teams_combined', label: 'Guest relations and Client relations, combined', needsMinutes: false, direction: 'higher', areas: ['management'] }];
  const form = { ...k.emptyKpiForm('management'), name: 'Teams combined', measure: 'teams_combined', target: '80', tiers: '90, 95', countsForBonus: true, placeholder: true };
  assert.deepEqual(k.kpiInput(form, measures), { value: { name: 'Teams combined', area: 'management', measure: 'teams_combined', minutes: null, targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: true, guestShare: 50 } });
  assert.match(k.kpiInput({ ...form, area: 'guest_relations' }, measures).error, /does not fit guest relations/);
});

test('My performance shows the parts line under the bar', () => {
  const screen = readFileSync('mobile/src/MyPerformance.tsx', 'utf8');
  assert.match(screen, /const parts = bonusPartsLine\(b\.parts\);/);
  assert.match(screen, /\{!!parts && <Text style=\{\[ui\.small, \{ color: p\.text, fontVariant: \["tabular-nums"\] \}\]\}>\{parts\}<\/Text>\}/);
});
