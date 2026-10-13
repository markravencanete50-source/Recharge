import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The visitor levy on the screens (20261014150000): the Terms sheet's fields, the summary row in the order the
// lines come off, the figures still checked to add up, and the line kind the statements read.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const work = await vite.ssrLoadModule('/lib/accounts-work.ts');
const S = await vite.ssrLoadModule('/lib/tracker-statements.ts');
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { financeActionSchema } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');

test('the Terms sheet fields: rate as a percentage, an optional night cap and start day; off sends only that', () => {
  assert.deepEqual(work.visitorLevyInput({ enabled: true, rate: '5', cap: '5', from: '2026-07-24' }), { value: { enabled: true, rateBps: 500, nightCap: 5, from: '2026-07-24' } });
  assert.deepEqual(work.visitorLevyInput({ enabled: true, rate: ' 2.5 ', cap: '', from: '' }), { value: { enabled: true, rateBps: 250, nightCap: null, from: null } });
  assert.deepEqual(work.visitorLevyInput({ enabled: false, rate: 'nonsense', cap: '0', from: 'x' }), { value: { enabled: false } });
  for (const bad of [{ rate: '' }, { rate: '101' }, { rate: '5%' }, { cap: '0' }, { cap: '367' }, { cap: 'five' }, { from: '2026-02-30' }, { from: '24/07/2026' }])
    assert.ok('error' in work.visitorLevyInput({ enabled: true, rate: '5', cap: '', from: '', ...bad }), JSON.stringify(bad));
  assert.deepEqual(work.visitorLevyForm(null), { enabled: false, rate: '5', cap: '', from: '' });
  assert.deepEqual(work.visitorLevyForm({ enabled: true, rateBps: 500, nightCap: 5, from: '2026-07-24' }), { enabled: true, rate: '5', cap: '5', from: '2026-07-24' });
  // The action the sheet sends is accepted.
  const action = { action: 'setStatementTerms', requestId: crypto.randomUUID(), propertyId: crypto.randomUUID(), managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee',
    visitorLevy: { enabled: true, rateBps: 500, nightCap: 5, from: '2026-07-24' } };
  assert.equal(financeActionSchema.safeParse(action).success, true);
  assert.equal(financeActionSchema.safeParse({ ...action, visitorLevy: { enabled: true, council: 'Edinburgh' } }).success, false);
});

test('the levy line kind is read, labelled and grouped after the platform fees', () => {
  assert.deepEqual([...live.STATEMENT_LINE_KINDS], ['ota_fee', 'visitor_levy', 'changeover', 'management_fee', 'vat', 'payable']);
  assert.equal(live.statementLineSchema.safeParse({ kind: 'visitor_levy', label: 'Visitor levy', date: '2026-11-05', amountMinor: 2277, refId: null }).success, true);
  const groups = S.lineGroups([
    { kind: 'ota_fee', label: 'Airbnb fees', date: '2026-11-05', amountMinor: 1546, refId: 'a' },
    { kind: 'visitor_levy', label: 'Visitor levy', date: '2026-11-05', amountMinor: 2277, refId: 'a' },
    { kind: 'visitor_levy', label: 'Visitor levy', date: '2026-11-28', amountMinor: 1500, refId: 'd' },
  ], new Date('2026-12-01T12:00:00Z'));
  assert.deepEqual(groups.map(g => [g.kind, g.title, g.totalMinor, g.lines.length]), [['ota_fee', 'Platform fees', 1546, 1], ['visitor_levy', 'Visitor levy', 3777, 2]]);
});

test('the summary shows the levy after the platform fees and still checks that the figures add up', () => {
  // The levy worked example of tests/statement-maths.test.mjs.
  const lines = [
    { kind: 'ota_fee', label: 'Airbnb fees', date: '2026-11-05', amountMinor: 1546, refId: 'a' },
    { kind: 'visitor_levy', label: 'Visitor levy', date: '2026-11-05', amountMinor: 2277, refId: 'a' },
    { kind: 'visitor_levy', label: 'Visitor levy', date: '2026-11-28', amountMinor: 1500, refId: 'd' },
    { kind: 'management_fee', label: 'Management fee (15%)', date: '2026-11-01', amountMinor: 11433, refId: null },
    { kind: 'vat', label: 'VAT on the management fee (20%)', date: '2026-11-01', amountMinor: 2287, refId: null },
  ];
  const p = {
    periodStart: '2026-11-01', periodEnd: '2026-12-01', method: 'nights',
    terms: { managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, vatRateBps: 2000, cleanChargeMode: 'agreed_fee', feeBase: 'payout_after_ota_fees_and_changeovers',
      visitorLevy: { enabled: true, rateBps: 500, nightCap: 5, from: '2026-07-24', feeAfterLevy: true } },
    lines, grossMinor: 81546, otaFeesMinor: 1546, revenueMinor: 80000, changeoversMinor: 0, cleaningCount: 0, feeBaseMinor: 76223, feeMinor: 11433, vatMinor: 2287,
    payablesMinor: 0, payoutMinor: 62503, visitorLevyMinor: 3777, nightsBooked: 7, nightsAvailable: 30, flags: [], blocked: false, blockedReasons: [],
  };
  assert.equal(live.statementPreviewSchema.safeParse(p).success, true);
  const sum = S.previewSummary(p);
  assert.deepEqual(sum.problems, []);
  assert.deepEqual(sum.rows.map(r => r.key), ['gross', 'ota_fee', 'visitor_levy', 'changeover', 'management_fee', 'vat', 'payable']);
  const levy = sum.rows.find(r => r.key === 'visitor_levy');
  assert.equal(levy.label, 'Visitor levy (5%)'); assert.match(levy.note, /first 5 nights/);
  assert.match(sum.rows.find(r => r.key === 'management_fee').note, /after platform fees, the visitor levy and changeovers/);
  // A levy left out of the payout is caught, never smoothed over.
  assert.deepEqual(S.previewSummary({ ...p, payoutMinor: 62503 + 3777 }).problems, ['The figures do not add up to the payout.']);
  // No levy and the switch off: no row.
  const none = S.previewSummary({ ...p, terms: { ...p.terms, visitorLevy: { ...p.terms.visitorLevy, enabled: false } }, lines: lines.filter(l => l.kind !== 'visitor_levy'), visitorLevyMinor: 0,
    feeBaseMinor: 80000, payoutMinor: 81546 - 1546 - 11433 - 2287 });
  assert.equal(none.rows.some(r => r.key === 'visitor_levy'), false);
  assert.deepEqual(none.problems, []);
  // A flag for a platform stay with no cleaning fee on its payout.
  assert.match(S.flagNotes(['levy_cleaning_fee_unknown:a']).join(' '), /no cleaning fee on its payout/);
});

test('the Terms sheet shows the levy switch and its fields', () => {
  const screen = readFileSync('mobile/src/AccountsStatements.tsx', 'utf8');
  assert.match(screen, /accessibilityLabel="Charge the visitor levy"/);
  assert.match(screen, /Visitor levy \(% of the accommodation\)/);
  assert.match(screen, /visitorLevy: visitorLevy\.value/);
});
