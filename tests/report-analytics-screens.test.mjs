import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Report analytics on every report page (Lee: "Every reporting should have an analytics"): each report opens with the
// shared analytics section (mobile/src/AnalyticsKit.tsx) built by its own model (lib/report-analytics-models.ts) from the
// figures it already reads, above the lists it had before, and nobody sees a report they did not see before. The maths
// and the models are in tests/report-analytics.test.mjs.
const read = file => readFileSync(file, 'utf8');
const before = (text, a, b, why) => { const i = text.indexOf(a), j = text.indexOf(b); assert.ok(i >= 0 && j >= 0 && i < j, why ?? `${a} comes before ${b}`); };

test('the kit: one section with the period, headline figures with their change, charts with words and a table, and honest empty states', () => {
  const kit = read('mobile/src/AnalyticsKit.tsx');
  assert.match(kit, /testID="report-analytics"/);
  assert.match(kit, /testID=\{"kpi-" \+ kpi\.key\}/);
  assert.match(kit, /testID=\{"chart-" \+ chart\.id\}/);
  assert.match(kit, /accessibilityLabel=\{table \? undefined : chartSummary\(chart\)\}/, 'every chart has words for a screen reader');
  assert.match(kit, /"Show the chart" : "Show the figures"/, 'and a table of the same figures');
  assert.match(kit, /chart\.emptyText \?\? "No data in this period\."/);
  assert.match(kit, /chart\.lowText \?\? "Not enough data to chart in this period\."/);
  assert.match(kit, /`Show all \$\{ranked\.all\.length\}`/, 'top N with "Show all"');
  assert.match(kit, /strokeDasharray="5 4"/, 'the reference line is the only dashed line');
  assert.match(kit, /strokeWidth=\{2\} strokeLinecap="round"/, '2px lines');
  assert.match(kit, /stroke=\{p\.surface\} strokeWidth=\{2\}/, 'points ringed in the surface colour');
  assert.match(kit, /gap: 2, borderRadius: 4/, 'a 2px gap between the parts of a stacked bar');
  // Lee, 18 October 2026: "different colors different type of graphs not a very basic analytics": a ring with the
  // total in the middle for shares (never a full pie), progress rings for rates, areas and columns for trends.
  assert.doesNotMatch(kit, /\bPie\b/, 'a donut, never a pie');
  assert.match(kit, /case "donut": return <DonutView/); assert.match(kit, /case "rings": return <RingsView/);
  assert.match(kit, /style === "area" && c\.series\.map\(s => <Path key=\{"a" \+ s\.key\}/, 'a shaded area under a trend, flat (no gradients)'); assert.match(kit, /columns && c\.series\.map/, 'or columns per period');
  assert.match(kit, /c\.palette \? seriesAt\(i\)/, 'many-coloured bars and columns');
  assert.doesNotMatch(kit, /#[0-9a-fA-F]{6}\b/, 'colours from the tokens only');
  assert.match(kit, /flexBasis: wide \? "46%" : "100%"/, 'one chart across a phone, two on a wide screen');
  assert.match(kit, /minWidth: 0/, 'nothing pushes the page wider than the screen');
  assert.match(kit, /<Pills p=\{p\} title="Period" values=\{period\.presets\}/);
  assert.match(kit, /period\.key === "custom" && <DateField/);
  assert.match(kit, /read\(period\.previous\)\.catch\(\(\) => null\)/, 'the previous period is for the comparison only');
});

test('Ratings opens with its analytics above the search and the list, for admins only as before', () => {
  const s = read('mobile/src/PropertyRatings.tsx');
  assert.match(s, /const period = usePeriod\(STANDARD_PERIODS, "90d", london\(new Date\(\)\)\);/, 'the last 90 days against the 90 before');
  assert.match(s, /ratingsModel\(data, period\.range, period\.previous, period\.against\)/);
  assert.match(s, /<AnalyticsPanel p=\{p\} model=\{model\} controls=\{<PeriodBar p=\{p\} period=\{period\} \/>\}/);
  before(s, '<AnalyticsPanel', '<SearchBox', 'the analytics first');
  before(s, '<AnalyticsPanel', '{rows.map((r, i) => <Row key={r.propertyId}');
  assert.match(s, /const allowed = isWorkspaceAdmin\(account\.role\)/);
  assert.match(s, /if \(!allowed\) return null;/);
  assert.match(read('lib/property-ratings.ts'), /export const canSeeRatings = \(account: \{ role: string \}\) => account\.role !== 'client';/, 'owners still never see ratings');
});

test('every business report (enquiries, repairs, to-dos, messages, time) opens with its analytics, the period driving the figures below', () => {
  const s = read('mobile/src/BusinessReports.tsx');
  for (const name of ['enquiriesModel', 'repairsModel', 'todosModel', 'messagesModel', 'timeModel']) assert.match(s, new RegExp(`return ${name}\\(loaded\\.report, loaded\\.before, range, against\\)`), name);
  assert.match(s, /usePeriod\(STANDARD_PERIODS, asked \? "custom" : "30d", today, \{ custom: asked \? monthSoFar\(today\) : undefined, maxDays: REPORT_MAX_DAYS \}\)/, 'the last 30 days to start, this month so far from Home');
  assert.match(s, /readTeams\(\{ section: REPORT_SECTION\[kind\], from: period\.previous\.from, to: period\.previous\.to \}\)/);
  before(s, '<AnalyticsPanel', 'shown?.kind === "enquiries" && <EnquiriesView');
  before(s, '<AnalyticsPanel', 'Download CSV');
  assert.match(s, /if \(!allowed\) return null;/);
});

test('Guests and stays, the Business overview, Productivity, Team performance and Decisions open with their analytics', () => {
  const stays = read('mobile/src/StayReports.tsx');
  assert.match(stays, /usePeriod\(\["month", "30d", "90d", "12m", "custom"\], "month", today, \{ maxDays: STAYS_MAX_DAYS \}\)/, 'this month against last month to start');
  assert.match(stays, /staysModel\(shown\.now, shown\.before, range,/);
  before(stays, '<AnalyticsPanel', '<StaysView');
  assert.match(stays, /comparisonRange\(range\)/);

  const overview = read('mobile/src/Reports.tsx');
  assert.match(overview, /overviewModel\(report\.current,report\.previous,report\.available,period,/);
  assert.match(overview, /<AnalyticsPanel p=\{p\} model=\{model\} title=\{report\.headline\}/);
  assert.match(overview, /onChange=\{k=>k==='custom'\?onDates\(\):onPeriod\(periodRange\(k,today\)\)\}/, '30 days, 90 days, 12 months or the date picker');
  assert.doesNotMatch(overview, /StatusChart/, 'the status donut is now a stacked bar');
  before(overview, '<AnalyticsPanel', '{table&&<View');
  assert.match(read('mobile/src/LiveWorkspace.tsx'), /onPeriod=\{range => \{ setPeriod\(range\); setSnapshot\(null\); \}\}/);

  const productivity = read('mobile/src/LiveProductivity.tsx');
  assert.match(productivity, /productivityModel\(now, before, period\.range, period\.against, departmentLabel\)/);
  before(productivity, '<ProductivityAnalytics', '<Segmented');

  const team = read('mobile/src/LiveShifts.tsx');
  assert.match(team, /usePeriod\(\["today", "7d", "30d", "90d", "custom"\], "7d", londonDay\(\), \{ maxDays: 92 \}\)/);
  assert.match(team, /teamPerformanceModel\(data, before, period\.range, period\.against\)/);
  before(team, '<AnalyticsPanel', '<RotaSection');

  const decisions = read('mobile/src/LiveOversight.tsx');
  assert.match(decisions, /usePeriod\(\["7d", "30d", "90d"\], "30d", today\)/, 'within the 90 days the report reads');
  assert.match(decisions, /decisionsModel\(shown, period\.range, period\.previous, period\.against, today,/);
  before(decisions, '<AnalyticsPanel', 'shown.slice(0, 200).map');
});

test('Invoices, My performance, Accounts performance, Furnishing Studio and the owners\' reports have their analytics, for the same people', () => {
  const ws = read('mobile/src/LiveWorkspace.tsx');
  before(ws, '<InvoiceAnalytics p={p} invoices={invoices} />', '<ListSearchBox p={p} search={invoiceSearch} nouns="invoices" />');
  assert.match(ws, /const adminReports: HubReport\[\] = isWorkspaceAdmin\(account\.role\) \? \[/, 'the hub is still admins only');
  assert.match(ws, /\{account\.role === "accounts" && !!invoices\.length && invoiceList\}/, 'Accounts keep their invoice list, now with its analytics');
  assert.match(ws, /tab === "analytics" \? \(account\.role === "client" \? <LiveClientReports /, 'owners keep their own reports page');
  assert.match(read('mobile/src/InvoiceAnalytics.tsx'), /invoicesModel\(invoices, period\.range, period\.previous, period\.against, readableStage\)/);

  const mine = read('mobile/src/MyPerformance.tsx');
  assert.match(mine, /myPerformanceModel\(\{ \.\.\.n, amber: row\?\.amber, red: row\?\.red \}, before,/);
  assert.match(mine, /\{page && model && <AnalyticsPanel p=\{p\} model=\{model\} title="At a glance" \/>\}/, 'on the page; the Home card stays as it was');
  assert.match(mine, /const row = ownPerson\(read\.data\.people, account\.userId\)/, 'only the person\'s own row');

  const accounts = read('mobile/src/AccountsPerformance.tsx');
  assert.match(accounts, /performanceModel\(report, loaded\.before,/);
  assert.match(accounts, /<DateField p=\{p\} label="Dates" value=\{\{ from: range\.from, to: lastDayOfRange\(range\) \}\} onChange=\{chooseDates\}/, 'one date field, as Lee asked');
  before(accounts, '<AnalyticsPanel', '<StatGrid showZeros>');

  const furnishing = read('mobile/src/FurnishingStudio.tsx');
  assert.match(furnishing, /furnishingModel\(data, before, period\.against, monthName,/);
  before(furnishing, '<AnalyticsPanel', 'title="Quotes by status"');

  const owner = read('mobile/src/LiveClientReports.tsx');
  assert.match(owner, /compare\(stats\.earningsMinor, before\.earningsMinor, \{ better: "up", format: n => formatMoneyShort\(n\), against \}\)/, 'each figure against the month before');
  assert.match(owner, /\{!!kpi\.delta && <DeltaLine p=\{p\} delta=\{kpi\.delta\} \/>\}/);
  assert.doesNotMatch(owner, /rating|RatingsReport|propertyRatings/i, 'never ratings for owners');
});

test('the touched screens keep CRLF, no em dashes and theme colours only', () => {
  for (const file of ['mobile/src/PropertyRatings.tsx', 'mobile/src/BusinessReports.tsx', 'mobile/src/StayReports.tsx', 'mobile/src/Reports.tsx', 'mobile/src/LiveProductivity.tsx', 'mobile/src/LiveShifts.tsx',
    'mobile/src/LiveOversight.tsx', 'mobile/src/MyPerformance.tsx', 'mobile/src/AccountsPerformance.tsx', 'mobile/src/FurnishingStudio.tsx', 'mobile/src/LiveClientReports.tsx', 'mobile/src/InvoiceAnalytics.tsx', 'mobile/src/LiveWorkspace.tsx']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF');
    assert.doesNotMatch(text, /—/, file + ' has no em dash');
  }
});
