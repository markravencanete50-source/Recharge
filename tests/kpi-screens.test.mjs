import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The admin's KPI screen (Team performance -> KPIs, 20261015100000): the form's checks match the database's, the
// actions it sends are accepted, and the screen is for admins only.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const K = await vite.ssrLoadModule('/lib/kpis.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

// The catalogue as private.workspace_kpi_measures() returns it.
const MEASURES = [
  { key: 'guest_reply_within', label: 'Guest messages answered within the minutes set', needsMinutes: true, direction: 'higher', areas: ['guest_relations'] },
  { key: 'guest_reply_over', label: 'Guest messages waiting longer than the minutes set', needsMinutes: true, direction: 'lower', areas: ['guest_relations'] },
  { key: 'daily_work_done', label: 'Daily work done against its targets', needsMinutes: false, direction: 'higher', areas: ['guest_relations', 'client_relations'] },
  { key: 'performance_score', label: 'Performance score', needsMinutes: false, direction: 'higher', areas: ['guest_relations', 'client_relations', 'cleaning', 'ready', 'accounts', 'management'] },
  { key: 'clean_forms_on_time', label: 'Cleaning forms in by 18:00 on the day', needsMinutes: false, direction: 'higher', areas: ['cleaning'] },
];
const form = (extra = {}) => ({ ...K.emptyKpiForm('guest_relations'), name: 'Replies within 5 minutes', measure: 'guest_reply_within', minutes: '5', target: '80', tiers: '95, 90', countsForBonus: true, ...extra });

test('the form: a KPI with minutes, a target and tiers; the action it makes is accepted', () => {
  const ok = K.kpiInput(form(), MEASURES);
  assert.deepEqual(ok, { value: { name: 'Replies within 5 minutes', area: 'guest_relations', measure: 'guest_reply_within', minutes: 5, targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: false } });
  assert.equal(teamsActionSchema.safeParse({ action: 'saveKpi', requestId: crypto.randomUUID(), ...ok.value }).success, true);
  // Tracked only: no target, no tiers, no minutes for a measure that takes none.
  assert.deepEqual(K.kpiInput(form({ name: 'Score', measure: 'performance_score', minutes: '12', target: '', tiers: '', countsForBonus: false }), MEASURES).value,
    { name: 'Score', area: 'guest_relations', measure: 'performance_score', minutes: null, targetPercent: null, bonusTiers: [], countsForBonus: false, placeholder: false });
  // Lower is better: tiers below the target.
  assert.deepEqual(K.kpiInput(form({ measure: 'guest_reply_over', minutes: '60', target: '10', tiers: '5', countsForBonus: false }), MEASURES).value.bonusTiers, [5]);
  // Editing starts from the saved KPI and gives the same KPI back.
  const saved = { id: 'k', name: 'Cleaning forms in on time', area: 'cleaning', measure: 'clean_forms_on_time', minutes: null, direction: 'higher', targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: true, active: true, sortOrder: 1, version: 3, updatedAt: '2026-10-13T09:00:00Z' };
  assert.deepEqual(K.kpiInput(K.kpiForm(saved), MEASURES).value, { name: saved.name, area: 'cleaning', measure: 'clean_forms_on_time', minutes: null, targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: true });
});

test('the form refuses what the database refuses, with the same words', () => {
  const error = extra => K.kpiInput(form(extra), MEASURES).error;
  assert.match(error({ name: ' ' }), /Give the KPI a name/);
  assert.match(error({ measure: '' }), /Choose what it measures/);
  assert.match(error({ area: 'cleaning' }), /does not fit cleaning/);
  assert.match(error({ minutes: '' }), /Set the minutes/);
  assert.match(error({ minutes: '2000' }), /Set the minutes/);
  assert.match(error({ target: '120' }), /percentage from 0 to 100/);
  assert.match(error({ tiers: '70' }), /must be above the target/);
  assert.match(error({ measure: 'guest_reply_over', tiers: '90' }), /must be below the target/);
  assert.match(error({ target: '', tiers: '90' }), /Set a target before the bonus tiers/);
  assert.match(error({ target: '', tiers: '' }), /A bonus KPI needs a target/);
  assert.match(error({ tiers: '81, 82, 83, 84, 85, 86' }), /up to five/);
  assert.match(error({ tiers: 'ninety' }), /up to five percentages/);
  // The schemas refuse the rest before it leaves the app.
  const base = { action: 'saveKpi', requestId: crypto.randomUUID(), name: 'X1', area: 'guest_relations', measure: 'guest_reply_within', minutes: 5, targetPercent: 80, bonusTiers: [], countsForBonus: false, placeholder: false };
  assert.equal(teamsActionSchema.safeParse({ ...base, measure: 'revenue' }).success, false);
  assert.equal(teamsActionSchema.safeParse({ ...base, bonusTiers: [101] }).success, false);
  assert.equal(teamsActionSchema.safeParse({ ...base, amountMinor: 100 }).success, false, 'never an amount in pounds');
  assert.equal(teamsActionSchema.safeParse({ action: 'moveKpi', requestId: crypto.randomUUID(), kpiId: crypto.randomUUID(), version: 1, direction: 'left' }).success, false);
  assert.equal(teamsActionSchema.safeParse({ action: 'setKpiActive', requestId: crypto.randomUUID(), kpiId: crypto.randomUUID(), version: 1, active: false }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: 'kpis', from: '2026-10-07', to: '2026-10-13' }).success, true);
});

test('the admin screen: area tabs, the list with who changed it last, add, edit, switch off and reorder; admins only', () => {
  const screen = readFileSync('mobile/src/KpiAdmin.tsx', 'utf8');
  for (const needle of ['action: "saveKpi"', 'action: "moveKpi"', 'action: "setKpiActive"', 'label="Add a KPI"', 'label="Counts for the bonus"', 'Placeholder (not agreed yet)', 'Last changed by', 'only one KPI per area counts'])
    assert.ok(screen.includes(needle), needle);
  assert.doesNotMatch(screen, /linear-gradient|LinearGradient|loop|repeat/i, 'calm: no gradients or looping motion');
  assert.doesNotMatch(screen, /£|amountMinor/);
  // Mounted on Team performance only when the read says the viewer may edit (admins and super admins).
  assert.match(readFileSync('mobile/src/LiveShifts.tsx', 'utf8'), /\{kpis\?\.canEdit && <KpiAdmin p=\{p\} read=\{kpis\} onChanged=\{load\} \/>\}/);
});

test('the targets sheet no longer edits the pass mark or bonus tiers; it sends the stored ones back unchanged', () => {
  const shifts = readFileSync('mobile/src/LiveShifts.tsx', 'utf8');
  const sheet = shifts.slice(shifts.indexOf('function TargetsSheet'), shifts.indexOf('function RotaSection'));
  assert.doesNotMatch(sheet, /On track: score of at least|Bonus tiers \(score|setPass|setBonus/);
  assert.match(sheet, /passPercent: targets\.passPercent, bonusPercents: targets\.bonusPercents/);
  assert.match(sheet, /Bonus targets and tiers are set for each area under KPIs/);
});
