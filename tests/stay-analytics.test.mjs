import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Reports > Guests & stays: the dates (this month against last month), the plain words, the read section, and that the
// section is drawn on the Reports page for admins only. The figures are tested against the database in stay-analytics-database.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const V = await vite.ssrLoadModule('/lib/stay-analytics-view.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('dates: this month to start, compared with last month', () => {
  assert.deepEqual(V.thisMonth('2026-10-15'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(V.thisMonth('2024-02-10'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(V.comparisonRange({ from: '2026-10-01', to: '2026-10-31' }), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(V.comparisonRange({ from: '2026-01-01', to: '2026-01-31' }), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(V.comparisonRange({ from: '2026-07-01', to: '2026-09-30' }), { from: '2026-04-01', to: '2026-06-30' }, 'whole months against as many months before');
  assert.deepEqual(V.comparisonRange({ from: '2026-10-05', to: '2026-10-11' }), { from: '2026-09-28', to: '2026-10-04' }, 'other dates against as many days before');
  assert.equal(V.comparisonLabel({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-15'), 'last month');
  assert.equal(V.comparisonLabel({ from: '2026-10-05', to: '2026-10-11' }, '2026-10-15'), '28 September to 4 October 2026');
  assert.equal(V.stayRangeLabel({ from: '2026-10-01', to: '2026-10-31' }), 'October 2026');
  assert.equal(V.stayRangeLabel({ from: '2026-10-01', to: '2026-10-14' }), '1 to 14 October 2026');
  assert.equal(V.stayRangeLabel({ from: '2025-12-20', to: '2026-01-05' }), '20 December 2025 to 5 January 2026');
  assert.equal(V.stayRangeError('2026-01-01', '2026-12-31'), '');
  assert.equal(V.stayRangeError('2026-01-01', '2027-01-02'), 'Choose up to 366 days.');
  assert.equal(V.stayRangeError('2026-02-01', '2026-01-01'), 'The last day must be on or after the first day.');
});

test('the read: dates up to 366 days, one property and one channel, for this section only', () => {
  const property = '11111111-1111-4111-8111-111111111111';
  assert.equal(teamsReadSchema.safeParse({ section: V.STAYS_SECTION, from: '2026-10-01', to: '2026-10-31', propertyId: property, channel: 'airbnb' }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: V.STAYS_SECTION }).success, false, 'needs dates');
  assert.equal(teamsReadSchema.safeParse({ section: V.STAYS_SECTION, from: '2026-01-01', to: '2027-01-02' }).success, false, 'over 366 days');
  assert.equal(teamsReadSchema.safeParse({ section: V.STAYS_SECTION, from: '2026-10-01', to: '2026-10-31', channel: 'expedia' }).success, false);
  assert.equal(teamsReadSchema.safeParse({ section: 'reportMessages', from: '2026-10-01', to: '2026-10-31', channel: 'airbnb' }).success, false, 'a channel is for this report only');
  const server = read('lib/workspace-finance-server.ts');
  assert.match(server, /input\.section === 'stayAnalytics' \? client\.rpc\('workspace_stay_analytics', \{ start_on: input\.from, end_on: input\.to, target_property: input\.propertyId \|\| null, target_channel: input\.channel \|\| null \}\)/);
  assert.deepEqual([...V.STAY_CHANNELS], ['airbnb', 'booking_com', 'vrbo', 'direct', 'other']);
});

test('plain words: what is not known, comparisons, countries and the guest mix', () => {
  assert.equal(V.notKnownLine(7, 7), '');
  assert.equal(V.notKnownLine(0, 0), '');
  assert.equal(V.notKnownLine(6, 7), 'Not known for 14% of stays');
  assert.equal(V.notKnownLine(0, 4), 'Not known for any of these stays');
  assert.equal(V.notKnownLine(999, 1000), 'Not known for 1% of stays', 'a gap is never rounded away');
  assert.equal(V.compareLine(9, 7, 'stays'), '2 stays more than last month');
  assert.equal(V.compareLine(2.4, 2.6, 'guests', 'last month', 1), '0.2 guests fewer than last month');
  assert.equal(V.compareLine(3, 3, 'stays'), 'The same as last month');
  assert.equal(V.compareLine(3, null, 'stays'), '');
  assert.equal(V.oneDecimal(null), 'Not known');
  assert.equal(V.oneDecimal(2.5), '2.5');
  assert.equal(V.plainDays(1), '1 day');
  assert.equal(V.plainDays(72), '72 days');
  assert.equal(V.countryName('United Kingdom'), 'United Kingdom');
  assert.ok(['United Kingdom', 'GB'].includes(V.countryName('GB')), 'a code is named where the device can');
  assert.deepEqual([1, 7].map(V.arrivalDayName), ['Monday', 'Sunday']);
  const part = (known, total, stays) => ({ known, total, stays });
  const r = { stays: 4, mix: { adults: part(4, 8, 4), children: part(2, 3, 1), infants: part(0, 0, 0), pets: part(2, 1, 1) } };
  assert.deepEqual(V.guestMix(r).map(m => [m.label, m.total, m.detail]), [
    ['Adults', 8, 'With adults: 100% of stays where known'],
    ['Children', 3, 'With children: 50% of stays where known · Not known for 50% of stays'],
    ['Infants', 0, 'Not known for any of these stays'],
    ['Pets', 1, 'With pets: 50% of stays where known · Not known for 50% of stays'],
  ]);
});

test('why they stay, the rating and the survey replies (20261021800000), in plain words', () => {
  const base = { stays: 10, reasons: { known: 4, counts: [{ reason: 'holiday', stays: 2 }, { reason: 'work', stays: 1 }, { reason: 'event', stays: 1 }] }, rating: { known: 3, average: 4.3 }, survey: { sent: 4, answered: 3 } };
  assert.deepEqual(V.reasonRows(base).map(r => [r.label, r.stays]), [['Holiday', 2], ['Work', 1], ['Visiting family or friends', 0], ['An event', 1], ['Something else', 0]], 'every reason, in the question\'s order');
  assert.equal(V.notKnownLine(base.reasons.known, base.stays), 'Not known for 60% of stays');
  assert.equal(V.ratingLine(base), 'From 3 stays');
  assert.equal(V.ratingLine({ ...base, rating: { known: 1, average: 5 } }), 'From 1 stay');
  assert.equal(V.ratingLine({ ...base, rating: { known: 0, average: null } }), 'No ratings yet');
  assert.equal(V.surveyReplyLine(base), '3 of 4 surveys answered');
  assert.equal(V.surveyReplyLine({ ...base, survey: { sent: 0, answered: 0 } }), 'No surveys sent for these dates');
  // Before the update is installed the report still reads.
  const { reasons, rating, survey, ...older } = base;
  assert.ok(reasons && rating && survey);
  assert.deepEqual(V.reasonRows(older).map(r => r.stays), [0, 0, 0, 0, 0]);
  assert.ok(!V.STAYS_NOTES.some(n => /not asked yet/.test(n)), 'the old note is gone');
  assert.ok(V.STAYS_NOTES.some(n => /switches them on/.test(n)));
  const screen = read('mobile/src/StayReports.tsx');
  assert.match(screen, /title="Why they stay"/);
  assert.match(screen, /notKnownLine\(r\.reasons\.known, r\.stays\)/, '"Not known for N%"');
  assert.match(screen, /label="Average rating"/);
  assert.match(screen, /label="Survey replies"/);
  assert.match(screen, /<Switch accessibilityLabel=\{STAY_SWITCHES\[which\]\}/);
});

test('the Reports page shows Guests & stays to admins only, in the calm style, with no guest details', () => {
  const page = read('mobile/src/LiveWorkspace.tsx');
  assert.match(page, /\{isWorkspaceAdmin\(account\.role\) && <StayReports p=\{p\} account=\{account\} properties=\{properties\} \/>\}/);
  const start = page.indexOf('const reportsPage');
  assert.ok(page.indexOf('<StayReports') > start && page.indexOf('<StayReports') < page.indexOf('const page = tab'), 'inside the Reports page');
  const screen = read('mobile/src/StayReports.tsx');
  assert.match(screen, /if \(!allowed\) return null;/);
  assert.match(screen, /<StatGrid showZeros>/);
  assert.match(screen, /notKnownLine\(/, 'gaps are said in plain words');
  assert.match(screen, /comparisonRange\(range\)/, 'compared with the period before');
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b/, 'theme tokens only');
  assert.doesNotMatch(screen, /fontWeight: "700"/, 'weight 600 for emphasis');
  assert.doesNotMatch((screen + read('lib/stay-analytics-view.ts')).replace(/^\s*\/\/.*$/gm, ''), /guestName|guestEmail|guestPhone|channelReference|reference/i, 'aggregates only');
  for (const file of ['mobile/src/StayReports.tsx', 'lib/stay-analytics-view.ts', 'supabase/migrations/20261021600000_stay_analytics.sql', 'lib/hostaway-sync-policy.ts']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF line endings');
    assert.doesNotMatch(text, /—/, file + ' has no em dashes');
  }
});
