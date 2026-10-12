import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// A team member's own Home: their performance (bonus as a tier only, no pay), their own schedule and
// the places that are no longer on Home (the action pills and the property count).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { ownPerson, bonusFor, workCompleted, shapeOwnNumbers, standingLine, performanceWindow, ownEvents, scheduleDays } = await vite.ssrLoadModule('/lib/my-performance.ts');
const { teamPerformanceSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const { BONUS_DISPLAY } = await vite.ssrLoadModule('/lib/feedback-defaults.ts');
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

test('Home is the person\'s own area: no action pills, no property count, favourites and the two cards', () => {
  const tools = source('HomeTools.tsx'), home = source('LiveHome.tsx');
  assert.doesNotMatch(tools, /homeActionsFor/, 'the quick-action pills are gone');
  assert.match(home, /!isClient\s*&&\s*<HomeFavorites/);
  assert.match(home, /\.\.\.\(isClient \? \[\{ key: "properties"/, 'only owners get a property count in the overview');
  const overview = home.slice(home.indexOf('const items: OverviewItem[]'), home.indexOf('const hero')).split('\n').filter(line => !line.includes('...(isClient')).join('\n');
  assert.doesNotMatch(overview, /properties\.length/, 'the team overview has no property count');
  for (const prop of ['favoriteEntries', 'onOpenEntry', 'tasks']) assert.match(home, new RegExp(prop + '\\?:'), prop + ' is an optional prop');
  assert.match(home, /tasks\}[\s\S]*<MyPerformance/, 'the to-do summary sits above the performance card');
  assert.match(home, /<MySchedule/);
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
