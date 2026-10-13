import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// FIX-A: features that were built but unreachable are mounted again. AirCover can be flagged from a repair,
// Accounts holds an AirCover tab, the rota, responsibilities and personal timesheet are reachable, Stays can
// sign off a day with no open shift, and the daily routine and the purchase orders are shown.
const read = file => readFileSync(file, 'utf8');
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const air = await vite.ssrLoadModule('/lib/aircover-flag.ts');
const day = await vite.ssrLoadModule('/lib/end-of-day.ts');
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const dir = await vite.ssrLoadModule('/lib/tool-directory.ts');
const home = await vite.ssrLoadModule('/lib/home-tools.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const ID = '11111111-1111-4111-8111-111111111111', REQ = '22222222-2222-4222-8222-222222222222';

test('B4: flagAirCover is built from the repair, with an optional amount and reference', () => {
  assert.deepEqual(air.flagAirCoverAction(ID, '', '', REQ), { action: { action: 'flagAirCover', requestId: REQ, workId: ID } });
  assert.deepEqual(air.flagAirCoverAction(ID, '£149.99', ' AC-1 ', REQ), { action: { action: 'flagAirCover', requestId: REQ, workId: ID, amountMinor: 14999, reference: 'AC-1' } });
  assert.match(air.flagAirCoverAction(ID, 'lots', '', REQ).error, /pounds/);
  assert.match(air.flagAirCoverAction(ID, '', 'x'.repeat(121), REQ).error, /reference/);
  // Whatever it builds, the server-side policy accepts.
  for (const [amount, ref] of [['', ''], ['120', ''], ['120.50', 'AC-9']]) {
    const built = air.flagAirCoverAction(ID, amount, ref, REQ);
    assert.ok(teamsActionSchema.safeParse(built.action).success, amount + '/' + ref);
  }
});

test('B4: only Stays, Ready, Accounts and admins are offered the flag, and not when a claim is already in progress', () => {
  for (const role of ['stays', 'ready', 'accounts', 'admin', 'super_admin']) assert.ok(air.canFlagAirCover(role), role);
  for (const role of ['client', 'cleans', 'cleaning_manager', '', null]) assert.ok(!air.canFlagAirCover(role), String(role));
  const claim = status => ({ status, workId: ID, issue: null });
  assert.ok(air.hasLiveClaim([claim('to_claim')], ID) && air.hasLiveClaim([claim('claimed')], ID));
  assert.ok(!air.hasLiveClaim([claim('paid'), claim('declined')], ID), 'a settled claim does not block a new one');
  assert.ok(air.hasLiveClaim([{ status: 'claimed', workId: null, issue: { workId: ID } }], ID), 'the linked issue counts too');
  assert.ok(!air.hasLiveClaim([claim('to_claim')], REQ), 'another repair is not affected');
});

test('B4: the repair sheet offers both flags, and the AirCover sheet sends once and shows the server message', () => {
  const repairs = read('mobile/src/LiveRepairs.tsx'), flag = read('mobile/src/AirCoverFlag.tsx');
  assert.match(repairs, /<FlagButton p=\{p\} role=\{role\} target=\{\{ workId: repair\.workId/);
  assert.match(repairs, /canFlagAirCover\(role\) && <AirCoverFlag key=\{repair\.workId\}/);
  assert.match(flag, /writeTeams\(built\.action\)/);
  assert.match(flag, /useRequestId\(/);
  assert.match(flag, /if \(busy\) return;/);
  assert.match(flag, /disabled=\{busy\}/);
  assert.match(flag, /setError\(message\(e\)\)/, 'a refused duplicate shows the server message');
  assert.match(flag, /readTeams\(\{ section: "aircover" \}\)/);
  assert.match(flag, /hasLiveClaim\(/);
});

test('Accounts holds an AirCover tab and the AirCover tool opens it', () => {
  assert.ok(map.ACCOUNTS_SUBS.includes('aircover'));
  assert.ok(map.deepLinkFor({ kind: 'work', view: 'accounts', sub: 'aircover' }));
  const place = dir.toolsFor('accounts', ['aircover-reporting'])[0].place;
  assert.deepEqual([place.kind, place.view, place.sub], ['work', 'accounts', 'aircover']);
  assert.deepEqual(dir.toolsFor('admin', ['aircover-reporting'])[0].place.view, 'stays', 'admins keep Guest relations');
  const accounts = read('mobile/src/LiveAccounts.tsx');
  assert.match(accounts, /view === "aircover" && !!sectionProps && <AirCoverList \{\.\.\.sectionProps\} \/>/);
  // The sections are one Pills row (a dropdown for finance roles); AirCover keeps its label there.
  assert.match(accounts, /aircover: "AirCover"/);
  assert.match(read('mobile/src/LiveWorkspace.tsx'), /<LiveAccounts key=\{"accounts:"[^>]*sectionProps=\{sectionProps\} \/>/);
  // The empty-list copy is now true: a repair can be flagged.
  assert.match(read('mobile/src/AirCoverList.tsx'), /Flag a maintenance ticket to start one/);
});

test('the rota, the responsibilities register and the personal timesheet are mounted', () => {
  for (const sub of ['rota', 'responsibilities']) assert.ok(map.MANAGEMENT_SUBS.includes(sub), sub);
  assert.ok(map.deepLinkFor({ kind: 'work', view: 'management', sub: 'rota' }));
  const management = read('mobile/src/LiveManagement.tsx');
  assert.match(management, /"dailytasks", "rota", "responsibilities", "access"\] as const/);
  assert.match(management, /view === "rota" && <RotaTab p=\{p\} account=\{account\} \/>/);
  assert.match(management, /view === "responsibilities" && <ResponsibilitiesTab p=\{p\} account=\{account\} \/>/);
  assert.doesNotMatch(management, /rota, timesheets and hours are under Productivity/, 'the false comment is gone');
  const reports = read('mobile/src/Reports.tsx');
  assert.match(reports, /import \{ TimesheetTab \} from '\.\/LiveTeamTime'/);
  assert.match(reports, /account&&account\.role!=='client'&&<View style=\{\{gap:12\}\}>[^]*<TimesheetTab p=\{p\} account=\{account\}\/>/);
  assert.ok(reports.indexOf('<MyPerformance') < reports.indexOf('<TimesheetTab'), 'below the personal card');
});

test('Stays can sign off a day with no open shift, from Home, and only Stays', () => {
  const offered = (role, openShift, shiftsToday, hour) => day.endOfDayOffered({ role, openShift, shiftsToday, hour });
  assert.ok(offered('stays', false, 0, 16), 'a late afternoon with no shift');
  assert.ok(offered('stays', false, 1, 10), 'clocked out earlier');
  assert.ok(!offered('stays', false, 0, 9), 'first thing in the morning there is nothing to end');
  assert.ok(!offered('stays', true, 1, 17), 'an open shift ends with the reflection');
  // The database refuses signOffDay for these roles, so they are not offered a button that fails.
  for (const role of ['ready', 'accounts', 'cleaning_manager', 'cleans', 'client', 'admin', 'super_admin']) assert.ok(!offered(role, false, 1, 17), role);
  assert.equal(day.londonHour(new Date('2026-07-01T12:30:00Z')), 13, 'London summer time');
  const card = read('mobile/src/SignOffCard.tsx'), stays = read('mobile/src/LiveStays.tsx'), homeSource = read('mobile/src/LiveHome.tsx');
  assert.match(card, /export function SignOffCard\(/);
  assert.match(card, /action: "signOffDay"/);
  assert.match(card, /quietWhenDone/);
  assert.match(stays, /import \{ SignOffCard \} from "\.\/SignOffCard";\s+export \{ SignOffCard \};/, 'LiveStays still exports it');
  assert.doesNotMatch(stays, /function SignOffCard/);
  assert.match(homeSource, /<EndOfDayCard palette=\{p\} account=\{account\} \/>/);
  const eod = read('mobile/src/EndOfDayCard.tsx');
  assert.match(eod, /<SignOffCard p=\{p\} quietWhenDone \/>/);
  assert.match(eod, /End of day/);
  assert.match(eod, /section: "shift"/);
});

test('the daily routine tops Guest relations for Stays and admins, and Ready sees its purchase orders', () => {
  const guest = read('mobile/src/GuestRelations.tsx'), routine = read('mobile/src/StaysRoutineCard.tsx');
  assert.ok(guest.indexOf('<StaysRoutineCard') > 0 && guest.indexOf('<StaysRoutineCard') < guest.indexOf('<Pills'), 'above the chips');
  assert.match(routine, /ROUTINE_ROLES = \["stays", "admin", "super_admin"\]/);
  assert.match(routine, /<TodaysRoutine p=\{p\} account=\{account\} properties=\{properties\} operations=\{work\} schedule=\{schedule\}/);
  assert.match(routine, /section: "schedule"/);
  const repairs = read('mobile/src/LiveRepairs.tsx');
  assert.match(repairs, /account\.role === "ready" && !!sectionProps && account\.modules\.includes\("purchase-order"\) && <Anchor id="section-purchase-orders"><PurchaseOrdersList \{\.\.\.sectionProps\} \/><\/Anchor>/);
  assert.ok(repairs.indexOf('<PurchaseOrdersList') > repairs.indexOf('Preventative maintenance'), 'below the repairs list');
  assert.match(read('mobile/src/LiveWorkspace.tsx'), /<LiveRepairs key=\{"repairs:"[^>]*sectionProps=\{sectionProps\} \/>/);
  // Ready's Purchases tile lands on it; Accounts already see purchase requests in their own Purchases section.
  const tile = home.homeToolsFor('ready', ['purchase-order']).find(t => t.key === 'purchases');
  assert.deepEqual([tile.target.view, tile.target.anchor], ['repairs', 'section-purchase-orders']);
  assert.match(read('mobile/src/LiveAccountsWork.tsx'), /<Section title="Purchases"/);
});

test('no em dashes in what this package added', () => {
  for (const file of ['lib/aircover-flag.ts', 'lib/end-of-day.ts', 'mobile/src/AirCoverFlag.tsx', 'mobile/src/SignOffCard.tsx', 'mobile/src/EndOfDayCard.tsx', 'mobile/src/StaysRoutineCard.tsx', 'tests/restored-features.test.mjs'])
    assert.ok(!read(file).includes(String.fromCharCode(0x2014)), file);
});
