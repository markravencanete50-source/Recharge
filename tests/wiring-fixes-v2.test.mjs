import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Review fixes (FIX-B): the direct-booking discount gate and schedule window, Oversight links, Help -> all
// tools sub, the Flag button on rows without a record, Preventative flags, per-action request ids and
// team event versions.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { gateDiscountPolicy, DISCOUNT_POLICY_WAITING } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const { scheduleWindows, SCHEDULE_WINDOW_DAYS } = await vite.ssrLoadModule('/lib/tracker-direct-bookings.ts');
const { canFlagTarget, FLAG_NEEDS_RECORD_HINT } = await vite.ssrLoadModule('/lib/management-flags.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
after(() => vite.close());
const source = file => readFileSync('mobile/src/' + file, 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';

test('5: the discount gate marks the offer form unavailable with the workspace wording', () => {
  const forms = [{ key: 'prepareQuote', title: 'Prepare a direct-booking offer' }, { key: 'recordGuestAcceptance', title: 'Record answer' }];
  const gated = gateDiscountPolicy(forms, false);
  assert.equal(gated[0].unavailable, 'The discount policy awaits confirmation.');
  assert.equal(gated[0].unavailable, DISCOUNT_POLICY_WAITING);
  assert.equal(gated[1].unavailable, undefined);
  assert.equal(gateDiscountPolicy(forms, true)[0].unavailable, undefined);
  const already = gateDiscountPolicy([{ key: 'prepareQuote', title: 'x', unavailable: 'Other reason' }], false);
  assert.equal(already[0].unavailable, 'Other reason');
  assert.equal(forms[0].unavailable, undefined, 'the input is not changed');
});

test('5: DirectBookings and the workspace use the same gate', () => {
  const direct = source('DirectBookings.tsx');
  assert.match(direct, /gateDiscountPolicy\(workItemForms\(account, w, journeys, work\), policyConfirmed\)/);
  assert.match(direct, /gateDiscountPolicy\(workItemForms\(account, openWork, journeys, work\), policyConfirmed\)/);
  assert.doesNotMatch(direct, /forms=\{openWork \? workItemForms/);
  assert.match(direct, /section=bookingPolicy/);
  assert.match(source('LiveWorkspace.tsx'), /gateDiscountPolicy\(workItemForms\(account, w, journeys, work\), policyConfirmed\)/);
});

test('6: the schedule is read in windows the read accepts and covers a year ahead', () => {
  const windows = scheduleWindows('2026-10-13', 14, 400);
  assert.equal(windows[0].from, '2026-09-29');
  assert.equal(windows.at(-1).to, '2027-11-17');
  assert.ok(SCHEDULE_WINDOW_DAYS <= 62);
  for (const w of windows) {
    assert.ok(w.to >= w.from);
    const parsed = teamsReadSchema.safeParse({ section: 'schedule', from: w.from, to: w.to });
    assert.ok(parsed.success, `${w.from}..${w.to} is accepted`);
  }
  for (let i = 1; i < windows.length; i++) {
    const gap = (Date.parse(windows[i].from) - Date.parse(windows[i - 1].to)) / 86400000;
    assert.equal(gap, 1, 'windows are consecutive with no gap or overlap');
  }
  assert.ok(windows.length <= 8);
});

test('6: DirectBookings asks for the windows and keeps the fallback labels', () => {
  const direct = source('DirectBookings.tsx');
  assert.match(direct, /scheduleWindows\(today, 14, 400\)/);
  assert.doesNotMatch(direct, /addDays\(today, 45\)/);
  assert.match(direct, /A window that fails to read/);
});

test('7: Re-listings open points at Client relations re-listing', () => {
  // Home's "Needs you now" lines live in lib/home-needs.ts now.
  const needs = readFileSync('lib/home-needs.ts', 'utf8');
  assert.match(needs, /'re-listings open'\)[^\n]*\{ kind: 'work', view: 'clients', sub: 'relisting' \}/);
  assert.doesNotMatch(needs + source('LiveOversight.tsx'), /section: ["']Re-listings["']/);
  assert.deepEqual(deepLinkFor({ kind: 'work', view: 'clients', sub: 'relisting' }), { section: 'work', view: 'clients', sub: 'relisting' });
});

test('7: links to the removed pages still land somewhere mounted', () => {
  assert.deepEqual(deepLinkFor({ kind: 'work', view: 'stays', sub: 'inbox' }), { section: 'inbox', redirected: true });
  assert.equal(deepLinkFor({ kind: 'work', view: 'hub', sub: 'approvals' }).section, 'decisions');
  assert.equal(deepLinkFor({ kind: 'work', view: 'hub' }).section, 'todo');
});

test('8: Help -> all tools passes the sub through to the workspace', () => {
  const tools = source('LiveTools.tsx');
  assert.match(tools, /view\?: WorkView, sub\?: string\) => void/);
  assert.match(tools, /onOpen\("work", t\.place\.view, t\.place\.sub\)/);
  assert.match(source('LivePages.tsx'), /view\?: WorkView, sub\?: string\) => void \}\) \{\r?\n  const \[open, setOpen\]/);
  assert.match(source('LiveWorkspace.tsx'), /onOpen=\{\(next, view, sub\) => \{ setTab\(next\); if \(view\) setWorkView\(view\); setFocus\(sub \? \{ sub, nonce: Date\.now\(\) \} : null\); \}\}/);
});

test('10: a row with no record yet cannot be flagged and says why', () => {
  assert.equal(canFlagTarget({}), false);
  assert.equal(canFlagTarget({ workId: undefined }), false);
  assert.equal(canFlagTarget({ workId: ID }), true);
  assert.equal(canFlagTarget({ hubItemId: ID }), true);
  assert.equal(FLAG_NEEDS_RECORD_HINT, 'Log a check first, then you can flag it');
  const tabs = source('ListingsTabs.tsx');
  assert.match(tabs, /canFlagTarget\(open\)/);
  assert.match(tabs, /FLAG_NEEDS_RECORD_HINT/);
  assert.match(tabs, /label="Flag for management" icon="flag" p=\{p\} disabled/);
});

test('11: the Preventative list reads the flags itself when none are passed', () => {
  const list = source('PreventativeList.tsx');
  assert.match(list, /flags: given/);
  assert.match(list, /const flags = given \?\? ownFlags/);
  assert.match(list, /readTeams\(\{ section: "flags" \}\)/);
  assert.match(list, /void reload\(\); void loadFlags\(\);/);
  assert.match(list, /withFlags\(preventativeTrackerItems\(source, ctx, account\.role\), flags\)/);
});

test('12: request ids follow the action chosen', () => {
  const kit = source('LiveKit.tsx');
  assert.match(kit, /get: \(action\?: string\)/);
  assert.match(kit, /done: \(action\?: string\)/);
  assert.match(source('HubItemSheet.tsx'), /moveRequest\.get\(status\)/);
  assert.match(source('HubItemSheet.tsx'), /moveRequest\.done\(status\)/);
  assert.match(source('VisitForm.tsx'), /request\.get\(status\)/);
  assert.match(source('VisitForm.tsx'), /request\.done\(status\)/);
});

test('13: team events carry their version on save and cancel', () => {
  const save = { action: 'saveTeamEvent', requestId: ID, id: ID, version: 3, kind: 'absence', title: 'Away', startsOn: '2026-10-20', endsOn: '2026-10-21' };
  assert.ok(teamsActionSchema.safeParse(save).success);
  assert.ok(teamsActionSchema.safeParse({ ...save, version: undefined }).success, 'version stays optional');
  assert.ok(!teamsActionSchema.safeParse({ ...save, version: 0 }).success);
  assert.ok(teamsActionSchema.safeParse({ action: 'cancelTeamEvent', requestId: ID, id: ID, version: 2 }).success);
  assert.ok(teamsActionSchema.safeParse({ action: 'cancelTeamEvent', requestId: ID, id: ID }).success);
  assert.ok(!teamsActionSchema.safeParse({ action: 'cancelTeamEvent', requestId: ID, id: ID, version: 2, extra: 1 }).success, 'still strict');
  const events = source('TeamEvents.tsx');
  assert.match(events, /id: event\.id, version: event\.version/);
  assert.match(events, /cancelRequest\.get\(\), id: event\.id, version: event\.version/);
  const sql = readFileSync('supabase/migrations/20261012210000_team_calendar.sql', 'utf8');
  assert.match(sql, /saveTeamEvent \{id\?, version\?/);
  assert.match(sql, /cancelTeamEvent \{id, version\?\}/);
});
