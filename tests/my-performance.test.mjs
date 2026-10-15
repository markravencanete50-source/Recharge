import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// A team member's own Home: their performance (bonus as a tier only, no pay), their own schedule and
// the places that are no longer on Home (the action pills and the property count).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { ownPerson, bonusFor, workCompleted, shapeOwnNumbers, standingLine, performanceWindow, ownEvents, scheduleDays, myKpis, kpiProgress } = await vite.ssrLoadModule('/lib/my-performance.ts');
const K = await vite.ssrLoadModule('/lib/kpis.ts');
const { teamPerformanceSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const defaults = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
const { BONUS_DISPLAY } = defaults;
after(() => vite.close());
const source = file => readFileSync('mobile/src/' + file, 'utf8');

const ME = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const person = (userId, extra = {}) => ({ userId, fullName: 'Sam Reid', role: 'stays', shifts: 4, minutes: 1920, green: 18, amber: 2, red: 0, percentGreen: 90, onTrack: true, bonusTier: 90, listingChecks: 3, pricingDecisions: 2, signOffs: 4, reviewsLogged: 1, daysWorked: 4, workPercent: 100, score: 94, ...extra });
const read = people => teamPerformanceSchema.parse({ targets: { greenMinutes: 5, amberMinutes: 15, passPercent: 80, bonusPercents: [80, 90, 95], version: 1 }, onShift: [], messages: 20, unassigned: { green: 0, amber: 0, red: 0 }, people });

test('only the person\'s own row is used, never somebody else\'s', () => {
  const data = read([person(OTHER, { score: 10 }), person(ME)]);
  assert.equal(ownPerson(data.people, ME).userId, ME);
  assert.equal(ownPerson(data.people, '33333333-3333-4333-8333-333333333333'), null, 'an id that is not in the list gets nothing');
  assert.equal(ownPerson([person(ME)], null).userId, ME, 'a list of one is theirs when the id is not known');
  assert.equal(ownPerson([person(ME), person(OTHER)], null), null, 'two rows and no id: nothing is guessed');
  assert.equal(shapeOwnNumbers(read([person(OTHER)]), ME, [], '2026-10-01'), null);
});

test('the bonus is a tier and nothing in pounds', () => {
  assert.equal(BONUS_DISPLAY, 'tier_only');
  assert.deepEqual(bonusFor(90, [80, 90, 95]), { tier: 2, of: 3, label: 'Bonus tier 2 of 3', nextAt: 95 });
  assert.deepEqual(bonusFor(95, [95, 80, 90, 90]), { tier: 3, of: 3, label: 'Bonus tier 3 of 3', nextAt: null });
  assert.deepEqual(bonusFor(null, [80, 90]), { tier: null, of: 2, label: 'No bonus tier yet', nextAt: 80 });
  assert.equal(bonusFor(null, []).label, 'No bonus tiers set');
  assert.equal(bonusFor(70, [80, 90]).tier, null, 'a threshold that was removed is not given a number');
  const numbers = shapeOwnNumbers(read([person(ME)]), ME, [], '2026-10-01');
  const text = JSON.stringify(numbers) + standingLine(numbers);
  assert.doesNotMatch(text, /£|pound|pay|wage|salary|amountMinor|rate/i);
  assert.deepEqual(Object.keys(numbers).sort(), ['bonus', 'daily', 'minutes', 'onTrack', 'replies', 'repliesGreen', 'repliesGreenPercent', 'score', 'shifts', 'tasksDone', 'workCompleted']);
});

// KPI read fixtures (the shape of workspace_teams_read('kpis'), 20261015100000).
const kpi = (id, extra = {}) => ({ id, name: 'Replies within 5 minutes', area: 'guest_relations', measure: 'guest_reply_within', minutes: 5, direction: 'higher', targetPercent: 80, bonusTiers: [90, 95],
  countsForBonus: true, placeholder: false, active: true, sortOrder: 1, version: 1, updatedAt: '2026-10-13T09:00:00Z', ...extra });
const res = (kpiId, value, extra = {}) => ({ kpiId, value, measured: value === null ? 0 : 10, count: null, onTarget: null, tier: null, tierAt: null, ...extra });
const KPI = ['k1', 'k2', 'k3', 'k4'];
const kpiRead = (people, kpis = [kpi(KPI[0]), kpi(KPI[1], { name: 'Replies within 30 minutes', minutes: 30, targetPercent: null, bonusTiers: [], countsForBonus: false, sortOrder: 2 }),
  kpi(KPI[2], { name: 'Replies waiting over 60 minutes', measure: 'guest_reply_over', minutes: 60, direction: 'lower', targetPercent: 10, bonusTiers: [5], countsForBonus: false, sortOrder: 3 }),
  kpi(KPI[3], { name: 'Cleaning forms in on time', area: 'cleaning', measure: 'clean_forms_on_time', minutes: null, placeholder: true })]) =>
  K.kpiReadSchema.parse({ from: '2026-10-07', to: '2026-10-13', canEdit: false, myArea: 'guest_relations', measures: [], kpis, people, teams: [], changes: [] });
const me = (results, extra = {}) => ({ userId: ME, fullName: 'Sam Reid', role: 'stays', area: 'guest_relations', results, guestReplies: null, ...extra });

test('the bonus bar comes from the area\'s bonus KPI: the client\'s example for guest relations (80% target, 90% tier 1, 95% tier 2)', () => {
  const at = value => myKpis(kpiRead([me([res(KPI[0], value)])]), ME).bonus;
  const below = at(74);
  assert.deepEqual([below.area, below.areaLabel, below.name, below.measureLabel, below.placeholder], ['guest_relations', 'Guest relations', 'Replies within 5 minutes', 'Guest messages answered within 5 minutes', false]);
  assert.deepEqual(below.marks, [{ label: 'Target', at: 80, reached: false }, { label: 'Tier 1', at: 90, reached: false }, { label: 'Tier 2', at: 95, reached: false }]);
  assert.deepEqual([below.value, below.reached, below.headline, below.next], [74, 0, '6% to go to the target', 'The target is 80%.']);
  assert.deepEqual([at(80).reached, at(80).headline, at(80).next], [1, 'Target reached', 'Tier 1 starts at 90%.']);
  assert.deepEqual([at(89).reached, at(89).headline], [1, 'Target reached']);
  assert.deepEqual([at(90).reached, at(90).headline, at(90).next], [2, 'Bonus tier 1 reached', 'Tier 2 starts at 95%.']);
  assert.deepEqual([at(95).reached, at(95).headline, at(95).next], [3, 'Bonus tier 2 reached', 'That is the top tier.']);
  assert.deepEqual([at(100).reached, at(100).value], [3, 100]);
  const none = at(null);
  assert.deepEqual([none.value, none.reached, none.headline, none.next], [null, 0, 'Nothing to measure yet', 'The target is 80%.']);
  // An admin's edit shows straight away: a new target, new tiers, different minutes.
  const edited = myKpis(kpiRead([me([res(KPI[0], 88)])], [kpi(KPI[0], { name: 'Replies within 10 minutes', minutes: 10, targetPercent: 85, bonusTiers: [92] })]), ME).bonus;
  assert.deepEqual([edited.measureLabel, edited.marks.map(m => m.at), edited.headline], ['Guest messages answered within 10 minutes', [85, 92], 'Target reached']);
  // Lower is better: the target and tiers count down.
  const lower = kpiProgress(kpi(KPI[2], { measure: 'guest_reply_over', minutes: 60, direction: 'lower', targetPercent: 10, bonusTiers: [5, 2] }), { value: 4 });
  assert.deepEqual([lower.marks.map(m => [m.at, m.reached]), lower.headline, lower.next], [[[10, true], [5, true], [2, false]], 'Bonus tier 1 reached', 'Tier 2 starts at 2% or less.']);
  assert.equal(kpiProgress(kpi(KPI[2], { direction: 'lower', targetPercent: 10, bonusTiers: [] }), { value: 14 }).headline, '4% above the target');
});

test('the tracked KPIs are rows under the bar, only the person\'s own, and none of it is in pounds', () => {
  const k = myKpis(kpiRead([me([res(KPI[0], 92, { onTarget: true, tier: 1, tierAt: 90 }), res(KPI[1], null), res(KPI[2], 12, { onTarget: false })]), me([res(KPI[0], 10)], { userId: OTHER })]), ME);
  assert.deepEqual(k.rows.map(r => [r.name, r.value, r.note, r.tone]), [
    ['Replies within 30 minutes', 'Nothing to measure yet', 'Tracked', 'plain'],
    ['Replies waiting over 60 minutes', '12%', 'Target at most 10%', 'bad']]);
  assert.equal(k.bonus.value, 92);
  assert.equal(myKpis(kpiRead([me([], { userId: OTHER })]), ME), null, 'never somebody else\'s row');
  assert.equal(myKpis(kpiRead([me([])]), null).area, 'guest_relations', 'a list of one is theirs');
  // A placeholder bonus KPI is labelled; an area with no bonus KPI has no bar.
  const cleaner = myKpis(kpiRead([me([res(KPI[3], null)], { area: 'cleaning', role: 'cleans' })]), ME);
  assert.deepEqual([cleaner.bonus.placeholder, cleaner.bonus.headline, cleaner.rows.length], [true, 'Nothing to measure yet', 0]);
  assert.equal(myKpis(kpiRead([me([], { area: 'accounts' })]), ME).bonus, null);
  assert.doesNotMatch(JSON.stringify(k), /£|pound|wage|salary|amountMinor/i);
  // The placeholder schemes are gone: the KPI tracker is the one source.
  assert.equal(defaults.BONUS_SCHEMES, undefined);
  assert.equal(defaults.BONUS_AREA_BY_ROLE, undefined);
  const card = source('MyPerformance.tsx');
  assert.match(card, /<BonusBar/);
  assert.match(card, /<KpiRows/);
  assert.match(card, /section: "kpis"/);
  assert.match(card, /accessibilityRole="progressbar"/);
  assert.match(card, /label="Placeholder"/);
  assert.doesNotMatch(card, /BONUS_SCHEMES|bonusProgress/);
});

test('the Team performance list and the admin KPI screen read the same KPI', () => {
  const read = kpiRead([me([res(KPI[0], 96, { onTarget: true, tier: 2, tierAt: 95 })]), me([res(KPI[0], 70, { onTarget: false })], { userId: OTHER }), me([res(KPI[3], null)], { userId: '33333333-3333-4333-8333-333333333333', area: 'cleaning' })]);
  assert.deepEqual(K.bonusTag(read, ME), ['Bonus tier 2 · Replies within 5 minutes 96%', 'good']);
  assert.deepEqual(K.bonusTag(read, OTHER), ['Replies within 5 minutes 70%', 'bad']);
  assert.deepEqual(K.bonusTag(read, '33333333-3333-4333-8333-333333333333'), ['Cleaning forms in on time: nothing to measure yet', 'plain']);
  const shifts = source('LiveShifts.tsx');
  assert.match(shifts, /bonusTag\(kpis, x\.userId\)/);
  assert.doesNotMatch(shifts, /Bonus tier \$\{x\.bonusTier\}/);
  assert.match(shifts, /kpis\?\.canEdit && <KpiAdmin/);
});

test('numbers: replies, minutes worked and tasks done (finished work plus the daily work logged)', () => {
  const work = [
    { assigneeId: ME, status: 'completed', updatedAt: '2026-10-05T10:00:00Z' },
    { assigneeId: ME, status: 'completed', updatedAt: '2026-09-01T10:00:00Z' },
    { assigneeId: ME, status: 'in_progress', updatedAt: '2026-10-05T10:00:00Z' },
    { assigneeId: OTHER, status: 'completed', updatedAt: '2026-10-05T10:00:00Z' },
  ];
  assert.equal(workCompleted(work, ME, '2026-10-01'), 1, 'only mine, only finished, only in the period');
  assert.equal(workCompleted(work, null, '2026-10-01'), 0);
  const n = shapeOwnNumbers(read([person(ME)]), ME, work, '2026-10-01');
  assert.equal(n.replies, 20);
  assert.equal(n.repliesGreenPercent, 90);
  assert.equal(n.minutes, 1920);
  assert.equal(n.tasksDone, 1 + 3 + 2 + 1 + 4);
  assert.equal(n.score, 94);
  assert.match(standingLine(n), /^On track with a score of 94%\. The next bonus tier starts at 95%\.$/);
  assert.equal(standingLine({ ...n, score: null }), 'Nothing to score yet in this period.');
  assert.match(standingLine({ ...n, score: 60, onTrack: false, bonus: { ...n.bonus, nextAt: null } }), /^Off track with a score of 60%\.$/);
});

test('week and month windows count back from today', () => {
  assert.deepEqual(performanceWindow('today', '2026-10-13'), { from: '2026-10-13', to: '2026-10-13' });
  assert.deepEqual(performanceWindow('week', '2026-10-13'), { from: '2026-10-07', to: '2026-10-13' });
  assert.deepEqual(performanceWindow('month', '2026-10-13'), { from: '2026-09-14', to: '2026-10-13' });
});

test('my schedule: own rota and own events, tolerant of a teamEvents read that is missing or odd', () => {
  const plan = { people: [
    { userId: OTHER, days: [{ day: '2026-10-13', shift: 'late', department: 'cleaning', note: '' }] },
    { userId: ME, days: [{ day: '2026-10-13', shift: 'early', department: 'guest_relations', note: 'Cover Ann' }, { day: '2026-10-14', shift: 'off', department: null, note: '' }] },
  ] };
  const events = ownEvents({ events: [
    { id: 'a', userId: ME, kind: 'meeting', title: 'Team meeting', startsOn: '2026-10-15', endsOn: '2026-10-15', startTime: '10:00:00', endTime: '11:00' },
    { id: 'b', user_id: OTHER, kind: 'absence', title: 'Away', starts_on: '2026-10-15', ends_on: '2026-10-16' },
    { id: 'c', userId: ME, kind: 'absence', title: 'Cancelled thing', startsOn: '2026-10-15', cancelledAt: '2026-10-10T00:00:00Z' },
    { id: 'd', user_id: ME, kind: 'training', title: 'Training', starts_on: '2026-10-16', ends_on: '2026-10-17', start_time: '09:30' },
    { title: 'No date' }, 'junk', null,
  ] }, ME);
  assert.deepEqual(events.map(e => e.id), ['a', 'd']);
  assert.equal(events[0].startTime, '10:00');
  assert.equal(events[1].endsOn, '2026-10-17');
  assert.deepEqual(ownEvents(undefined, ME), []);
  assert.deepEqual(ownEvents('nope', ME), []);
  assert.equal(ownEvents([{ id: 'x', title: 'Plain list', startsOn: '2026-10-20' }], ME).length, 1, 'a bare list is accepted');
  const days = scheduleDays(plan, events, ME, '2026-10-13', 5);
  assert.deepEqual(days.map(d => d.day), ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual([days[0].shift, days[0].hours, days[0].note, days[0].planned], ['early', '8am to 4pm', 'Cover Ann', true]);
  assert.deepEqual([days[1].shift, days[1].planned], ['off', false], 'a day off with nothing on is not planned');
  assert.deepEqual([days[2].shift, days[2].events.map(e => e.id), days[2].planned], [null, ['a'], true]);
  assert.deepEqual(days[3].events.map(e => e.id), ['d']);
  assert.deepEqual(days[4].events.map(e => e.id), ['d'], 'a multi-day event shows on every day it covers');
  assert.equal(scheduleDays(null, [], ME, '2026-10-13', 2).every(d => !d.planned), true, 'no rota read: nothing planned, no crash');
  assert.equal(scheduleDays({ people: [plan.people[0]] }, [], ME, '2026-10-13', 1)[0].shift, null, 'somebody else\'s rota is never shown');
});

test('Home is the person\'s own area: no action pills, no property count, their favourites, and the cards one tap away', () => {
  const tools = source('HomeTools.tsx'), home = source('LiveHome.tsx'), focus = source('HomeFocus.tsx');
  assert.doesNotMatch(tools, /homeActionsFor/, 'the quick-action pills are gone');
  const team = home.slice(home.indexOf('function TeamHome('), home.indexOf('function OwnerLiveHome('));
  const owner = home.slice(home.indexOf('function OwnerLiveHome('));
  assert.match(team, /<HomeFavorites [^\n]*savedOnly \/>/, 'the team Home keeps only the places they starred');
  assert.match(tools, /saved\.length \|\| savedOnly \? \[\]/, 'the suggestions are left to the Favorites page');
  assert.match(owner, /<OwnerHome /, 'owners keep where each of their properties is up to');
  assert.doesNotMatch(team, /properties\.length/, 'the team Home has no property count');
  for (const prop of ['favoriteEntries', 'onOpenEntry']) assert.match(home, new RegExp(prop + '\\?:'), prop + ' is an optional prop');
  // My performance is the page in the menu (Reports.tsx), the schedule sits with the shift, the to-do list on its tab.
  assert.doesNotMatch(team, /<MyPerformance|<MySchedule|tasks/, 'the performance and schedule cards and the to-do summary are off Home');
  assert.match(focus, /<ShiftCard palette=\{p\} account=\{account\} \/>\s*<MySchedule palette=\{p\} account=\{account\} \/>/, 'the shift button opens the shift and the week');
  assert.match(team, /<ShiftButton palette=\{p\} account=\{account\} \/>/);
  assert.match(source('MyPerformance.tsx'), /section: "teamPerformance"/);
  assert.match(source('MySchedule.tsx'), /section: "rotaPlan"/);
  assert.match(source('MySchedule.tsx'), /section: "teamEvents"/);
  assert.doesNotMatch(source('MyPerformance.tsx') + source('MySchedule.tsx'), /formatMoney|£|amountMinor/, 'no pay on either card');
});

test('Reports is the My performance page for the team; owners keep their own reports page', () => {
  const reports = source('Reports.tsx');
  assert.match(reports, /My performance/);
  assert.match(reports, /<MyPerformance/);
  assert.match(reports, /isWorkspaceAdmin\(role\)&&<MotionPress/, 'admins keep the CSV export');
});
