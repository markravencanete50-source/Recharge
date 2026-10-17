import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Cleaners report repairs themselves (Alex; database: 20261023100000): the screens and the HTTP side. The cleaner reports
// what is broken from the clean form itself (no more "Repairs or replacements needed" box for the team to raise), with a
// safety hazard tick, and follows the repairs they raised in "Repairs you reported". The team see who raised a repair.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const cr = await vite.ssrLoadModule('/lib/cleaner-repairs.ts');
const { cleanProblemAction } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { repairPrompts, repairFromClean } = await vite.ssrLoadModule('/lib/clean-report.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { operationsReadSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const source = file => readFileSync(file, 'utf8');
const id = () => crypto.randomUUID();
const FILES = ['lib/cleaner-repairs.ts', 'lib/cleans-live.ts', 'lib/clean-report.ts', 'lib/operations-policy.ts', 'lib/journey-policy.ts', 'lib/journey-server.ts',
  'mobile/src/CleanProblem.tsx', 'mobile/src/CleanReport.tsx', 'mobile/src/LiveCleans.tsx', 'mobile/src/LiveRepairs.tsx', 'mobile/src/backend/client.ts'];

test('a problem with a safety hazard passes the server check, and a hazard is always urgent', () => {
  const base = { requestId: id(), workId: id(), version: 2, issue: ' Bathroom light fitting sparking ', urgent: false, repairType: 'electrics', photoIds: [] };
  const hazard = cleanProblemAction({ ...base, hazard: true });
  assert.ok(operationsActionSchema.safeParse(hazard).success);
  assert.deepEqual(hazard.data, { issue: 'Bathroom light fitting sparking', urgent: true, repairType: 'electrics', hazard: true });
  const plain = cleanProblemAction(base);
  assert.equal('hazard' in plain.data, false, 'sent only when ticked, so older servers keep working');
  assert.equal(operationsActionSchema.safeParse({ ...plain, data: { ...plain.data, hazard: 'yes' } }).success, false);
  assert.equal(operationsActionSchema.safeParse({ ...plain, data: { ...plain.data, estimatedCostMinor: 1000 } }).success, false, 'a cleaner never sends a cost');
});

test('the cleaner’s list reads GET /api/mobile/operations?section=cleanerRepairs, which goes to the database read', () => {
  const query = Object.fromEntries(new URLSearchParams(cr.cleanerRepairsQuery().slice(1)));
  assert.deepEqual(operationsReadSchema.parse(query), { section: 'cleanerRepairs' });
  assert.equal(operationsReadSchema.safeParse({ section: 'cleanerRepairs', propertyId: id() }).success, false, 'nothing else on it');
  assert.equal(cr.CLEANER_REPAIRS_READ.rpc, 'workspace_cleaner_repairs');
  assert.match(source('lib/journey-server.ts'), /parsed\.data\.section===CLEANER_REPAIRS_READ\.section\?await session\.client\.rpc\(CLEANER_REPAIRS_READ\.rpc\)/);
  assert.match(source('mobile/src/backend/client.ts'), /readCleanerRepairs = async \(\) => \(await workspaceRequest\('\/api\/mobile\/operations' \+ cleanerRepairsQuery\(\)\)\)\.json\(\)/);
  assert.match(source('supabase/migrations/20261023100000_cleaner_repairs.sql'), /create or replace function public\.workspace_cleaner_repairs\(\)/);
});

test('every status the database gives has plain words, and the rows parse leniently', () => {
  const sql = source('supabase/migrations/20261023100000_cleaner_repairs.sql');
  const fromDb = [...new Set([...sql.matchAll(/then '([a-z_]+)'/g)].map(m => m[1]).concat([...sql.matchAll(/else '([a-z_]+)' end/g)].map(m => m[1])))].sort();
  assert.deepEqual(fromDb, [...cr.CLEANER_REPAIR_STATUSES].sort(), 'the same statuses as the database');
  for (const s of cr.CLEANER_REPAIR_STATUSES) { assert.ok(cr.CLEANER_REPAIR_STATUS[s].label); assert.doesNotMatch(cr.CLEANER_REPAIR_STATUS[s].detail, /£|cost|owner|quote/i, s); }
  assert.deepEqual(cr.CLEANER_REPAIR_STATUSES.filter(cr.cleanerRepairOpen), ['reported', 'approval', 'on_hold', 'contractor', 'booked']);
  const row = { workId: id(), propertyId: id(), propertyName: 'Harbour flat', issue: 'Shower drains slowly', repairType: 'toilet_drain', urgent: true, hazard: false, status: 'booked', visitOn: '2026-10-20', reportedAt: '2026-10-17T09:00:00.000Z', cleanWorkId: id() };
  assert.deepEqual(cr.readCleanerRepairList([row]), [row]);
  assert.deepEqual(cr.readCleanerRepairList({ error: 'old server' }), [], 'an older server shows none');
  assert.deepEqual(cr.readCleanerRepairList([{ ...row, status: 'owner_approval' }]), [], 'never a raw phase');
});

test('the team see who raised a repair; older reports from a clean still say so', () => {
  const day = iso => iso.slice(0, 10);
  assert.equal(cr.raisedByLine({ raisedBy: { role: 'cleans', name: 'Cara Cleaner', at: '2026-10-17T09:00:00.000Z' } }, day), 'Cara Cleaner (cleaner), 2026-10-17, from a clean');
  assert.equal(cr.raisedByLine({ raisedBy: { role: 'cleans', name: ' ' } }, day), 'A cleaner (cleaner), from a clean');
  assert.equal(cr.raisedByLine({ reportedFromClean: id() }, day), 'A cleaner, from a clean');
  assert.equal(cr.raisedByLine({ reportedBy: id() }, day), null, 'a repair the team reported');
  const repairs = source('mobile/src/LiveRepairs.tsx');
  assert.match(repairs, /\{!\["client", "ready"\]\.includes\(role\) && <Detail label="Reported by" value=\{raisedByLine\(repair\.data, reportedDay\)\}/, 'never for owners or contractors');
  assert.match(repairs, /const fromCleaner = !\["client", "ready"\]\.includes\(account\.role\)/);
});

test('the clean form: repairs are reported from it, and the property check offers the ones it found', () => {
  assert.deepEqual(repairPrompts({ heatingHotWater: 'not_working', broadband: 'not_working' }).map(x => [x.key, x.type, x.urgent]), [['heating', 'heating', true], ['wifi', 'wifi', false]]);
  assert.deepEqual(repairPrompts({ heatingHotWater: 'not_working', broadband: 'not_working' }, ['hot_water', 'wifi']), [], 'not when already reported from the clean');
  assert.deepEqual(repairPrompts({ heatingHotWater: 'working', broadband: 'none' }), []);
  // The same words the team's "Raise reactive maintenance" used, so a repair reads the same whoever raised it.
  for (const x of repairPrompts({ heatingHotWater: 'not_working', broadband: 'not_working' })) { assert.ok(repairFromClean({ heatingHotWater: 'not_working', broadband: 'not_working' }).includes(x.issue)); assert.ok(x.issue.length >= 5); }
  const cleans = source('mobile/src/LiveCleans.tsx'), form = source('mobile/src/CleanReport.tsx'), problem = source('mobile/src/CleanProblem.tsx');
  assert.match(cleans, /repairs=\{<CleanRepairs p=\{p\} clean=\{\{ workId: op\.workId, version: op\.version \}\} answers=\{answers\} reported=\{problems\} onSent=\{reported\} \/>\}/, 'in the clean form');
  assert.match(cleans, /\{mineToDo && !canSubmit && <CleanRepairs /, 'and on a clean waiting for review');
  assert.match(form, /\{repairs \?\? <Field label="Repairs or replacements needed \(optional\)"/, 'the old box only where no repairs slot is given');
  assert.match(cleans, /<Section title="Repairs you reported"/);
  assert.match(problem, /This is a safety hazard/);
  assert.match(problem, /accessibilityState=\{\{ checked: urgent \|\| hazard \}\}/, 'a hazard shows as urgent');
  assert.match(problem, /<ChoiceField p=\{p\} label="What kind of problem"/);
});

test('the changed files keep the conventions: CRLF, no em dashes, no emoji', () => {
  for (const file of FILES) {
    const text = source(file);
    assert.doesNotMatch(text, /—/, file + ' has an em dash');
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, file + ' is CRLF');
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, file + ' has an emoji');
  }
  assert.equal(source('tests/cleaner-repairs-database.test.mjs').includes('\r'), false, '.mjs is LF');
});
