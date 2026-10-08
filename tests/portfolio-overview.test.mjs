import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Client follow-ups due and the portfolio summary shown to the team.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { followUpsDue, portfolioSummary } = await vite.ssrLoadModule('/lib/portfolio-overview.ts');
const { journeyViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
after(() => vite.close());
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const journey = (n, stage, extra = {}) => journeyViewSchema.parse({ propertyId: id(n), clientId: id(90 + (n % 2)), workId: id(50 + n), stage, version: 1, agreement: '', agreementRevision: 1,
  signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null, ...extra });

test('follow-ups come due on their date, oldest first, and keep the client\'s comments', () => {
  const journeys = [journey(1, 'reviewing', { followUpOn: '2026-10-05', feedback: 'Talking to my partner' }), journey(2, 'reviewing', { followUpOn: '2026-10-08' }),
    journey(3, 'reviewing', { followUpOn: '2026-10-20' }), journey(4, 'agreement', { followUpOn: '2026-10-01' })];
  const due = followUpsDue(journeys, [{ id: id(1), name: 'Harbour Flat' }, { id: id(2), name: 'Mill Cottage' }], '2026-10-08');
  assert.deepEqual(due.map(d => [d.propertyName, d.overdueDays, d.feedback]), [['Harbour Flat', 3, 'Talking to my partner'], ['Mill Cottage', 0, '']]);
});

test('the portfolio summary counts live and onboarding properties, owners and regions', () => {
  const properties = [
    { id: id(1), region: 'Edinburgh', status: 'active' }, { id: id(2), region: 'Edinburgh ', status: 'onboarding' }, { id: id(3), region: 'Glasgow', status: 'active' },
    { id: id(4), region: '', status: 'active' }, { id: id(5), region: 'Perth', status: 'archived' }];
  const summary = portfolioSummary(properties, [journey(1, 'live'), journey(2, 'agreement'), journey(3, 'live'), journey(5, 'archived')]);
  assert.deepEqual(summary, { total: 4, live: 3, onboarding: 1, archived: 1, owners: 2,
    regions: [{ region: 'Edinburgh', count: 2 }, { region: 'Glasgow', count: 1 }, { region: 'Region not set', count: 1 }] });
});
