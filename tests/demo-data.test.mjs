import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'vite';

// Demo mode answers reads from a recorded sample business: requests are matched with dates made
// relative, answers are moved to the current day, and the shipped file parses.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { demoKey, demoLooseKey, shiftDates, daysBetween, demoAnswer, demoDataSchema, demoPeople } = await vite.ssrLoadModule('/lib/demo-data.ts');
after(() => vite.close());

test('a request is recognised on any later day: dates become relative and parameters sorted', () => {
  const recorded = demoKey('/api/mobile/teams?to=2026-10-31&section=schedule&from=2026-10-03', '2026-10-10');
  assert.equal(recorded, '/api/mobile/teams?from=@-7&section=schedule&to=@21');
  assert.equal(demoKey('/api/mobile/teams?section=schedule&from=2026-11-07&to=2026-12-05', '2026-11-14'), recorded);
  assert.equal(demoKey('/api/mobile/finance?section=statements&month=2026-11', '2026-11-02'), demoKey('/api/mobile/finance?month=2026-10&section=statements', '2026-10-20'));
  assert.equal(demoKey('/api/mobile/workspace', '2026-10-10'), '/api/mobile/workspace');
});

test('the looser key leaves out dates, ids and paging', () => {
  assert.equal(demoLooseKey('/api/mobile/property-details?propertyId=4f6c8a52-0f7e-4b0a-9a3c-2d6f0e8b9a11&section=access'), '/api/mobile/property-details?section=access');
  assert.equal(demoLooseKey('/api/mobile/workspace?entity=properties&limit=100&cursor=abc'), '/api/mobile/workspace?entity=properties');
  assert.equal(demoLooseKey('/api/mobile/teams?section=schedule&from=2026-10-03&to=2026-10-31'), '/api/mobile/teams?section=schedule');
});

test('answers move to the current day: dates, timestamps and months, nothing else', () => {
  assert.equal(daysBetween('2026-10-10', '2026-10-17'), 7);
  assert.equal(daysBetween('2026-10-10', '2027-03-28'), 169); // across the clocks changing
  const moved = shiftDates({ dueOn: '2026-10-10', at: '2026-10-09T14:05:00.000Z', month: '2026-10', title: 'Clean at 12 High St', n: 3, list: ['2026-09-30'] }, 7);
  assert.deepEqual(moved, { dueOn: '2026-10-17', at: '2026-10-16T14:05:00.000Z', month: '2026-10', title: 'Clean at 12 High St', n: 3, list: ['2026-10-07'] });
  assert.equal(shiftDates({ month: '2026-10' }, 31).month, '2026-11');
  const same = { a: '2026-10-10' };
  assert.equal(shiftDates(same, 0), same);
});

const account = role => ({ userId: '00000000-0000-4000-8000-00000000000' + (role === 'cleans' ? '2' : '1'), email: null, fullName: role === 'cleans' ? 'Jamie Cleaner' : 'Sam Taylor', responsibilities: '', role, status: 'active', modules: [] });
const data = {
  version: 2, capturedOn: '2026-10-10',
  answers: { a: { data: { day: '2026-10-10' } }, b: { data: { day: '2026-10-01' } } },
  personas: {
    super_admin: { account: account('super_admin'), responses: { '/api/mobile/teams?from=@0&section=schedule': 'a' }, loose: { '/api/mobile/teams?section=schedule': 'b' } },
    cleans: { account: account('cleans'), responses: {}, loose: {} },
  },
};

test('reads are answered from the recording for the persona, falling back to the looser match', () => {
  const parsed = demoDataSchema.parse(data);
  assert.deepEqual(demoAnswer(parsed, 'super_admin', '/api/mobile/teams?section=schedule&from=2026-10-12', '2026-10-12'), { data: { day: '2026-10-12' } });
  assert.deepEqual(demoAnswer(parsed, 'super_admin', '/api/mobile/teams?section=schedule&from=2026-10-20', '2026-10-12'), { data: { day: '2026-10-03' } });
  assert.equal(demoAnswer(parsed, 'cleans', '/api/mobile/teams?section=schedule', '2026-10-12'), null);
  assert.equal(demoAnswer(parsed, 'ready', '/api/mobile/teams?section=schedule', '2026-10-12'), null);
  assert.deepEqual(demoPeople(parsed).map(p => p.role), ['cleans']);
});

test('the shipped sample business parses and covers every role', { skip: !existsSync('mobile/web-static/demo-data.json') }, () => {
  const shipped = demoDataSchema.parse(JSON.parse(readFileSync('mobile/web-static/demo-data.json', 'utf8')));
  assert.deepEqual(Object.keys(shipped.personas).sort(), ['accounts', 'admin', 'cleaning_manager', 'cleans', 'client', 'ready', 'stays', 'super_admin']);
  for (const [role, persona] of Object.entries(shipped.personas)) {
    assert.equal(persona.account.role, role);
    assert.ok(Object.keys(persona.responses).length > 5, role + ' has recorded answers');
    for (const id of [...Object.values(persona.responses), ...Object.values(persona.loose)]) assert.ok(id in shipped.answers, `${role}: answer ${id} is in the file`);
  }
});
