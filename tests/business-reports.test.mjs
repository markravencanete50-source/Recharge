import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Business reports (Alex's meeting): the date rules, the labels and CSV shape, and that the section is drawn on the
// Reports page for admins only. The figures themselves are tested against the database in business-reports-database.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const R = await vite.ssrLoadModule('/lib/business-reports-view.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('dates: the last 30 days to start, and up to 366 days', () => {
  assert.deepEqual(R.defaultReportRange('2026-10-14'), { from: '2026-09-15', to: '2026-10-14' });
  assert.equal(R.reportRangeError('2026-01-01', '2026-12-31'), '');
  assert.equal(R.reportRangeError('2024-01-01', '2024-12-31'), '', 'a leap year is 366 days');
  assert.equal(R.reportRangeError('2026-01-01', '2027-01-02'), 'Choose up to 366 days.');
  assert.equal(R.reportRangeError('2026-02-01', '2026-01-01'), 'The last day must be on or after the first day.');
  assert.equal(R.reportRangeError('', '2026-01-01'), 'Choose the first and last day.');
  for (const kind of R.REPORT_KINDS) {
    const section = R.REPORT_SECTION[kind];
    assert.equal(teamsReadSchema.safeParse({ section, from: '2026-01-01', to: '2026-12-31' }).success, true, section);
    assert.equal(teamsReadSchema.safeParse({ section }).success, false, section + ' needs dates');
    assert.equal(teamsReadSchema.safeParse({ section, from: '2026-01-01', to: '2027-01-02' }).success, false, section + ' over 366 days');
  }
});

test('labels: reply times, the funnel and months', async () => {
  assert.deepEqual([null, 0, 45, 60, 125, 49 * 60].map(R.waitLabel), ['–', '0 min', '45 min', '1h 00m', '2h 05m', '2 days 1h']);
  assert.deepEqual(R.funnelSteps({ received: 10, estimate: 5, agreement: 2, live: 1, declined: 3 }).map(s => [s.label, s.count, s.fromPrevious, s.ofReceived]), [
    ['Enquiries received', 10, null, 100], ['Estimate sent', 5, 50, 50], ['Agreement signed', 2, 40, 20], ['Gone live', 1, 50, 10]]);
  assert.equal(R.funnelSteps({ received: 0, estimate: 0, agreement: 0, live: 0, declined: 0 })[1].fromPrevious, null, 'no dividing by nothing');
  assert.equal(R.monthName('2026-10'), 'October 2026');
  const { PRIORITY_START, START_WHEN } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
  assert.equal(R.PRIORITY_START, PRIORITY_START);
  assert.equal(PRIORITY_START, START_WHEN[0]);
  assert.ok(read('supabase/migrations/20261020860000_business_reports.sql').includes(`start_when='${PRIORITY_START}'`), 'the database counts the same answer as Priority');
  assert.equal(R.departmentName(''), 'Given to a person');
});

test('messages: received per month across channels, for pricing an AI reply helper', () => {
  const r = R.messagesReportSchema.parse({ from: '2026-09-01', to: '2026-10-31', amberMinutes: 10, replyTimes: [], byChannel: [], byWeek: [],
    byMonth: [{ month: '2026-10', channel: 'owner_chat', received: 2, sent: 1 }, { month: '2026-09', channel: 'airbnb', received: 5, sent: 4 }, { month: '2026-10', channel: 'airbnb', received: 3, sent: 3 }] });
  assert.deepEqual(R.receivedByMonth(r).map(m => [m.month, m.received, m.channels.map(c => c.channel)]), [['2026-09', 5, ['airbnb']], ['2026-10', 5, ['airbnb', 'owner_chat']]]);
  const csv = R.messagesCsv(r);
  assert.ok(csv.startsWith('﻿"Recharge business report"\r\n'), 'a spreadsheet-friendly CSV: BOM, quoted cells, CRLF');
  assert.match(csv, /"Messages received per month"/);
  assert.equal(R.reportFilename('messages', r), 'recharge-messages-2026-09-01-2026-10-31.csv');
});

test('the Reports page shows Business reports to admins only, with a CSV download and no PDF', () => {
  const page = read('mobile/src/LiveWorkspace.tsx');
  assert.match(page, /\{isWorkspaceAdmin\(account\.role\) && <BusinessReports p=\{p\} account=\{account\} \/>\}/);
  assert.ok(page.indexOf('<BusinessReports') > page.indexOf('const reportsPage'), 'inside the Reports page');
  const screen = read('mobile/src/BusinessReports.tsx');
  assert.match(screen, /if \(!allowed\) return null;/);
  assert.match(screen, /exportReport\(csvOf\(shown\), reportFilename\(shown\.kind, shown\.report\)\)/);
  assert.doesNotMatch(screen, /pdf/i);
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b/, 'theme tokens only');
  assert.doesNotMatch(screen, /fontWeight: "700"/, 'weight 600 for emphasis');
  for (const file of ['mobile/src/BusinessReports.tsx', 'lib/business-reports-view.ts', 'supabase/migrations/20261020860000_business_reports.sql']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF line endings');
    assert.doesNotMatch(text, /—/, file + ' has no em dashes');
  }
});
