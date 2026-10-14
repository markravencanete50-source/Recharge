import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The management bonus split, round 8: the parts line shows each team's share, the admin form takes the share for the
// combined measure only, and the save sends it. The database side is tests/management-bonus-weighting-database.test.mjs.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const k = await vite.ssrLoadModule('/lib/kpis.ts');
const mp = await vite.ssrLoadModule('/lib/my-performance.ts');
const measures = [
  { key: 'teams_combined', label: 'Guest relations and Client relations, combined', needsMinutes: false, direction: 'higher', areas: ['management'] },
  { key: 'performance_score', label: 'Performance score', needsMinutes: false, direction: 'higher', areas: ['management'] },
];
const form = patch => ({ ...k.emptyKpiForm('management'), name: 'Teams combined', measure: 'teams_combined', target: '80', tiers: '90, 95', countsForBonus: true, placeholder: true, ...patch });

test('the parts line shows each share when both teams count, and none when one has nothing', () => {
  const part = (area, value, share) => ({ area, value, measured: 1, share });
  assert.equal(mp.bonusPartsLine([part('guest_relations', 86, 60), part('client_relations', 74, 40)]), 'Guest relations 86% (60%) · Client relations 74% (40%)');
  assert.equal(mp.bonusPartsLine([part('guest_relations', 86, 70), part('client_relations', null, 30)]), 'Guest relations 86% · Client relations nothing to measure yet');
  // A database before round 8 sends no share: the line is as in round 6.
  assert.equal(mp.bonusPartsLine([{ area: 'guest_relations', value: 86, measured: 1 }, { area: 'client_relations', value: 74, measured: 1 }]), 'Guest relations 86% · Client relations 74%');
});

test('the form: 50 by default, any whole percentage, nothing for other measures', () => {
  assert.equal(k.kpiInput(form({}), measures).value.guestShare, 50, 'empty means the default');
  assert.equal(k.kpiInput(form({ guestShare: '70' }), measures).value.guestShare, 70);
  assert.equal(k.kpiInput(form({ guestShare: '0' }), measures).value.guestShare, 0);
  assert.equal(k.kpiInput(form({ guestShare: '100' }), measures).value.guestShare, 100);
  for (const bad of ['101', '-1', '50.5', 'half']) assert.match(k.kpiInput(form({ guestShare: bad }), measures).error, /whole percentage from 0 to 100/, bad);
  assert.ok(!('guestShare' in k.kpiInput(form({ measure: 'performance_score', guestShare: '70' }), measures).value), 'other measures send no share');
  // Opening a KPI fills the field: the stored share, 50 when unset, empty for other measures.
  const kpi = k.kpiSchema.parse({ id: 'm1', name: 'Combined', area: 'management', measure: 'teams_combined', minutes: null, direction: 'higher', targetPercent: 80, bonusTiers: [90, 95],
    countsForBonus: true, placeholder: true, active: true, sortOrder: 1, version: 3, updatedAt: '2026-10-13T12:00:00Z', guestShare: 60 });
  assert.equal(k.kpiForm(kpi).guestShare, '60');
  assert.equal(k.kpiForm({ ...kpi, guestShare: null }).guestShare, '50');
  assert.equal(k.kpiForm({ ...kpi, measure: 'performance_score', guestShare: null }).guestShare, '');
});

test('the KPI sheet shows the share field only for the combined measure', () => {
  const sheet = readFileSync('mobile/src/KpiAdmin.tsx', 'utf8');
  assert.match(sheet, /\{form\.measure === COMBINED_MEASURE && <Field label="Guest relations share % \(Client relations gets the rest\)" value=\{form\.guestShare\}/);
  assert.match(sheet, /guestShare: m\.key === COMBINED_MEASURE \? form\.guestShare \|\| String\(DEFAULT_GUEST_SHARE\) : ""/);
  assert.doesNotMatch(sheet, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'theme colours only');
});
