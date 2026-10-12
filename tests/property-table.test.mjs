import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

// The Properties table for staff: region derivation, sort, search and filters, the last-update stamp,
// and the maintenance history and statements shaped for the detail sheet. All pure.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const table = await vite.ssrLoadModule('/lib/property-table.ts');
const history = await vite.ssrLoadModule('/lib/property-history.ts');
const { REGION_NOT_SET, regionOf, regionOptions, statusOptions, buildPropertyRows, propertyUpdate, sortPropertyRows, nextSort, filterPropertyRows, usesPropertyTable, seesCleaners, DEFAULT_SORT } = table;
const { propertyHistory, historyGroups, seesHistoryCost, statementHistory } = history;

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const property = (n, over = {}) => ({ id: id(n), name: `Flat ${n}`, address: `${n} Test Street`, region: 'Edinburgh', status: 'active', version: 1, bedrooms: 2, ...over });
const journey = (n, stage) => ({ propertyId: id(n), clientId: null, workId: id(900 + n), stage });
const work = (n, propertyN, over = {}) => ({ workId: id(500 + n), propertyId: id(propertyN), moduleId: 'm', title: `Work ${n}`, kind: 'maintenance', status: 'waiting', version: 1, assigneeId: null, data: {}, ...over });

test('region: what was typed, else the address, else "Region not set"', () => {
  assert.equal(regionOf({ region: 'Glasgow', address: '1 Anywhere Road' }), 'Glasgow');
  assert.equal(regionOf({ region: '', address: '12 Royal Terrace, Edinburgh EH7' }), 'Edinburgh');
  assert.equal(regionOf({ region: '   ', address: '5 Main Street, Pitlochry' }), 'Perth and Kinross');
  assert.equal(regionOf({ region: '', address: '3 Nowhere Lane' }), REGION_NOT_SET);
  assert.equal(regionOf({ region: '', address: '' }), REGION_NOT_SET);
  assert.equal(regionOf({}), REGION_NOT_SET);
  // A region someone typed that is not one of the known areas is kept as it is.
  assert.equal(regionOf({ region: 'Newcastle', address: '9 Quay Side' }), 'Newcastle');
});

test('the region list comes from the data, A to Z, with "Region not set" last', () => {
  const rows = buildPropertyRows([
    property(1, { region: 'Glasgow' }), property(2, { region: 'Edinburgh' }), property(3, { region: '', address: '1 Nowhere' }),
    property(4, { region: 'Edinburgh' }), property(5, { region: 'Aberdeen' }),
  ], [], []);
  assert.deepEqual(regionOptions(rows), [
    { region: 'Aberdeen', count: 1 }, { region: 'Edinburgh', count: 2 }, { region: 'Glasgow', count: 1 }, { region: REGION_NOT_SET, count: 1 },
  ]);
  assert.deepEqual(regionOptions([]), []);
});

test('status and onboarding stage: only an onboarding property has a stage', () => {
  const rows = buildPropertyRows([
    property(1, { status: 'onboarding' }), property(2, { status: 'onboarding' }), property(3, { status: 'active' }), property(4, { status: 'archived' }), property(5, { status: 'onboarding' }),
  ], [journey(1, 'agreement'), journey(2, 'declined'), journey(3, 'live')], []);
  const by = n => rows.find(r => r.id === id(n));
  assert.equal(by(1).statusLabel, 'Onboarding');
  assert.equal(by(1).stage, 'Agreement');
  assert.ok(by(1).nextStep && by(1).nextStep.length > 0);
  assert.equal(by(2).stage, 'Declined');
  assert.equal(by(3).statusLabel, 'Active');
  assert.equal(by(3).stage, null);
  assert.equal(by(4).statusLabel, 'Archived');
  assert.equal(by(5).stage, null, 'an onboarding property with no journey has no stage');
  assert.deepEqual(statusOptions(rows), [
    { status: 'onboarding', label: 'Onboarding', count: 3 }, { status: 'active', label: 'Active', count: 1 }, { status: 'archived', label: 'Archived', count: 1 },
  ]);
});

test('last update: the newest work at the property, or the record when that is later; owners get no name', () => {
  const items = [
    work(1, 1, { updatedAt: '2026-10-10T09:00:00Z', updatedBy: 'Morag Reid', updatedEvent: 'operations.updateOperation.bookRepair' }),
    work(2, 1, { updatedAt: '2026-10-11T09:00:00Z', updatedBy: 'Ian Sloan' }),
    work(3, 2, { updatedAt: '2026-10-12T09:00:00Z', updatedBy: 'Someone Else' }),
  ];
  const u = propertyUpdate({ updatedAt: '2026-10-01T00:00:00Z' }, items.filter(w => w.propertyId === id(1)));
  assert.equal(u.at, '2026-10-11T09:00:00Z');
  assert.equal(u.by, 'Ian Sloan');
  assert.equal(u.source, 'work');
  // The property record changed after all the work.
  const later = propertyUpdate({ updatedAt: '2026-10-13T08:00:00Z' }, items);
  assert.equal(later.source, 'record');
  assert.equal(later.by, null);
  // Nothing at all, and unreadable times, give no update.
  assert.equal(propertyUpdate({}, []), null);
  assert.equal(propertyUpdate({ updatedAt: 'not a date' }, [work(4, 1, { updatedAt: 'nope' })]), null);
  // Owners never see a name.
  assert.equal(propertyUpdate({}, items, true).by, null);
  // Rows carry it, using only the work at their own property.
  const rows = buildPropertyRows([property(1), property(2), property(3)], [], items);
  assert.equal(rows.find(r => r.id === id(1)).lastUpdate.by, 'Ian Sloan');
  assert.equal(rows.find(r => r.id === id(2)).lastUpdate.by, 'Someone Else');
  assert.equal(rows.find(r => r.id === id(3)).lastUpdate, null);
});

test('sorting by each column, both ways, with empty values always last', () => {
  const rows = buildPropertyRows([
    property(1, { address: '10 High Street', region: 'Glasgow', status: 'active', updatedAt: '2026-10-01T10:00:00Z' }),
    property(2, { address: '2 High Street, Nowhere', region: '', status: 'onboarding', updatedAt: '2026-10-05T10:00:00Z' }),
    property(3, { address: '2 Abbey Road', region: 'Aberdeen', status: 'archived' }),
    property(4, { address: '7 Zebra Lane', region: 'Edinburgh', status: 'onboarding' }),
  ], [journey(2, 'inspection_booked'), journey(4, 'estimate')], []);
  const order = (sort) => sortPropertyRows(rows, sort).map(r => Number(r.id.slice(-1)));
  // Numbers inside addresses sort as numbers: "2 Abbey", "2 High", "7 Zebra", then "10 High".
  assert.deepEqual(order({ key: 'address', dir: 'asc' }), [3, 2, 4, 1]);
  assert.deepEqual(order({ key: 'address', dir: 'desc' }), [1, 4, 2, 3]);
  // Region: A to Z, and "Region not set" is last either way round.
  assert.deepEqual(order({ key: 'region', dir: 'asc' }), [3, 4, 1, 2]);
  assert.deepEqual(order({ key: 'region', dir: 'desc' }), [1, 4, 3, 2]);
  // Status: onboarding (earliest stage first), active, archived.
  assert.deepEqual(order({ key: 'status', dir: 'asc' }), [4, 2, 1, 3]);
  assert.deepEqual(order({ key: 'status', dir: 'desc' }), [3, 1, 2, 4]);
  // Last update: newest first by default; rows with no update stay at the end.
  assert.deepEqual(order({ key: 'updated', dir: 'desc' }), [2, 1, 3, 4]);
  assert.deepEqual(order({ key: 'updated', dir: 'asc' }), [1, 2, 3, 4]);
  // Sorting returns a new list and leaves the input alone.
  const before = rows.map(r => r.id);
  sortPropertyRows(rows, DEFAULT_SORT);
  assert.deepEqual(rows.map(r => r.id), before);
});

test('clicking a column heading: a new column starts the natural way, the same one turns round', () => {
  assert.deepEqual(nextSort({ key: 'address', dir: 'asc' }, 'address'), { key: 'address', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'address', dir: 'desc' }, 'address'), { key: 'address', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'address', dir: 'asc' }, 'region'), { key: 'region', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'address', dir: 'asc' }, 'updated'), { key: 'updated', dir: 'desc' });
});

test('search covers address, region, status and stage; filters narrow by region and status', () => {
  const rows = buildPropertyRows([
    property(1, { address: '14 Royal Terrace, Edinburgh', region: 'Edinburgh', status: 'active' }),
    property(2, { address: '3 Queen Street', region: 'Glasgow', status: 'onboarding' }),
    property(3, { address: '8 Harbour View', region: '', status: 'onboarding' }),
    property(4, { address: '1 Old Mill', region: 'Glasgow', status: 'archived' }),
  ], [journey(2, 'inspection_booked')], []);
  const ids = filter => filterPropertyRows(rows, filter).map(r => Number(r.id.slice(-1)));
  assert.deepEqual(ids({ query: '' }), [1, 2, 3, 4]);
  assert.deepEqual(ids({ query: 'royal terrace' }), [1]);
  assert.deepEqual(ids({ query: 'terrace royal' }), [1], 'words in any order');
  assert.deepEqual(ids({ query: 'glasgow' }), [2, 4]);
  assert.deepEqual(ids({ query: 'onboarding' }), [2, 3]);
  assert.deepEqual(ids({ query: 'inspection' }), [2], 'the onboarding stage is searchable');
  assert.deepEqual(ids({ query: 'region not set' }), [3]);
  assert.deepEqual(ids({ query: 'ROYAL   terrace!' }), [1]);
  assert.deepEqual(ids({ query: 'nothing like this' }), []);
  assert.deepEqual(ids({ region: 'Glasgow' }), [2, 4]);
  assert.deepEqual(ids({ region: 'Glasgow', status: 'onboarding' }), [2]);
  assert.deepEqual(ids({ region: REGION_NOT_SET }), [3]);
  assert.deepEqual(ids({ status: 'archived', query: 'mill' }), [4]);
});

test('who gets the table and who reads the cleaner data', () => {
  for (const role of ['admin', 'super_admin', 'stays', 'ready', 'accounts', 'cleaning_manager']) assert.equal(usesPropertyTable(role), true, role);
  for (const role of ['client', 'cleans']) assert.equal(usesPropertyTable(role), false, role);
  assert.equal(seesCleaners('stays', ['cleaning-schedule']), true);
  assert.equal(seesCleaners('stays', []), false);
  assert.equal(seesCleaners('accounts', ['cleaning-schedule']), false);
  assert.equal(seesCleaners('ready', ['cleaning-schedule']), false);
});

test('maintenance history: reactive and preventative together, newest first', () => {
  const items = [
    work(1, 1, { title: 'Leaking tap', kind: 'maintenance', status: 'completed', dueOn: '2026-08-02', updatedAt: '2026-08-03T10:00:00Z', data: { phase: 'completed', estimatedCostMinor: 8000, actualCostMinor: 6500, repairOn: '2026-08-02' } }),
    work(2, 1, { title: 'Monthly visit', kind: 'routine_visit', status: 'approved', dueOn: '2026-10-01' }),
    work(3, 1, { title: 'Broken lock', kind: 'maintenance', status: 'waiting', createdAt: '2026-10-09T08:00:00Z', data: { phase: 'referred', estimatedCostMinor: 12000 } }),
    work(4, 1, { title: 'Clean after stay', kind: 'cleaning', status: 'completed', dueOn: '2026-10-10' }),
    work(5, 2, { title: 'Other property', kind: 'maintenance', data: {} }),
    work(6, 1, { title: 'Sept visit', kind: 'routine_visit', status: 'waiting', dueOn: '2026-09-01' }),
  ];
  const entries = propertyHistory(items, id(1), { costs: true });
  assert.deepEqual(entries.map(e => e.title), ['Broken lock', 'Monthly visit', 'Sept visit', 'Leaking tap'], 'other kinds and other properties are left out; newest day first');
  const by = t => entries.find(e => e.title === t);
  assert.equal(by('Leaking tap').kind, 'reactive');
  assert.equal(by('Leaking tap').status, 'Completed');
  assert.equal(by('Leaking tap').tone, 'good');
  assert.equal(by('Leaking tap').costMinor, 6500);
  assert.equal(by('Leaking tap').costKind, 'actual');
  assert.equal(by('Broken lock').status, 'With Ready');
  assert.equal(by('Broken lock').costMinor, 12000);
  assert.equal(by('Broken lock').costKind, 'estimate');
  assert.equal(by('Broken lock').date, '2026-10-09', 'a repair with no date uses the day it was reported');
  assert.equal(by('Monthly visit').kind, 'preventative');
  assert.equal(by('Monthly visit').status, 'Signed off');
  assert.equal(by('Monthly visit').done, true);
  assert.equal(by('Sept visit').status, 'To do');
  assert.equal(by('Sept visit').done, false);
  assert.equal(by('Monthly visit').costMinor, null);
  const groups = historyGroups(entries);
  assert.deepEqual(groups.reactive.map(e => e.title), ['Broken lock', 'Leaking tap']);
  assert.deepEqual(groups.preventative.map(e => e.title), ['Monthly visit', 'Sept visit']);
  assert.deepEqual(propertyHistory([], id(1)), []);
});

test('ties on the day fall back to the latest change, then the id, so the order is steady', () => {
  const items = [
    work(1, 1, { title: 'A', dueOn: '2026-10-01', updatedAt: '2026-10-02T10:00:00Z' }),
    work(2, 1, { title: 'B', dueOn: '2026-10-01', updatedAt: '2026-10-03T10:00:00Z' }),
    work(3, 1, { title: 'C', dueOn: '2026-10-01', updatedAt: '2026-10-03T10:00:00Z' }),
  ];
  assert.deepEqual(propertyHistory(items, id(1)).map(e => e.title), ['B', 'C', 'A']);
  assert.deepEqual(propertyHistory([...items].reverse(), id(1)).map(e => e.title), ['B', 'C', 'A']);
});

test('history for an owner carries no staff name and no cost', () => {
  const items = [work(1, 1, { title: 'Leaking tap', status: 'completed', updatedAt: '2026-08-03T10:00:00Z', updatedBy: 'Morag Reid', data: { phase: 'completed', estimatedCostMinor: 8000, actualCostMinor: 6500, contractor: 'Dave the Plumber' } })];
  const staff = propertyHistory(items, id(1), { costs: true })[0];
  assert.equal(staff.by, 'Morag Reid');
  assert.equal(staff.costMinor, 6500);
  const owner = propertyHistory(items, id(1), { owner: true, costs: true })[0];
  assert.equal(owner.by, null);
  assert.equal(owner.costMinor, null);
  assert.equal(owner.costKind, null);
  assert.ok(!JSON.stringify(owner).includes('Morag'));
  assert.ok(!JSON.stringify(owner).includes('Dave'), 'the contractor is not carried at all');
  // A staff viewer who may not see costs gets the name but no money.
  const noCost = propertyHistory(items, id(1), { costs: false })[0];
  assert.equal(noCost.by, 'Morag Reid');
  assert.equal(noCost.costMinor, null);
  assert.equal(seesHistoryCost('accounts'), true);
  assert.equal(seesHistoryCost('stays'), true);
  assert.equal(seesHistoryCost('client'), false);
  assert.equal(seesHistoryCost('cleans'), false);
});

test('declined, cancelled and closed repairs read in the stopped colour', () => {
  const items = [
    work(1, 1, { title: 'Declined', status: 'waiting', data: { phase: 'owner_declined', estimatedCostMinor: 5000 } }),
    work(2, 1, { title: 'Cancelled', status: 'cancelled', data: { phase: 'triage' } }),
    work(3, 1, { title: 'Closed', status: 'completed', data: { phase: 'closed' } }),
  ];
  const e = propertyHistory(items, id(1), { costs: true });
  for (const entry of e) assert.equal(entry.tone, 'bad', entry.title);
  // A declined cost still waits for a new quote or for someone to close it; cancelled and closed are finished.
  assert.equal(e.find(x => x.title === 'Declined').done, false);
  assert.equal(e.find(x => x.title === 'Cancelled').done, true);
  assert.equal(e.find(x => x.title === 'Closed').done, true);
  assert.equal(e.find(x => x.title === 'Declined').status, 'Owner declined');
  assert.equal(e.find(x => x.title === 'Cancelled').status, 'Cancelled');
});

test('statements: this property only, each once, void left out, newest first', () => {
  const s = (n, over = {}) => ({ id: id(700 + n), propertyId: id(1), period: '2026-10', status: 'issued', payoutMinor: 100000, paidAt: null, ...over });
  const rows = statementHistory([
    s(1, { period: '2026-09', status: 'paid', paidAt: '2026-10-05T09:00:00Z', payoutMinor: 90000 }),
    s(2, { period: '2026-10', periodStart: '2026-10-01', periodLastDay: '2026-10-31' }),
    s(2, { period: '2026-10', periodStart: '2026-10-01', periodLastDay: '2026-10-31' }),
    s(3, { period: '2026-10', periodStart: '2026-10-05', periodLastDay: '2026-10-20', status: 'draft' }),
    s(4, { status: 'void' }),
    s(5, { propertyId: id(2) }),
  ], id(1));
  assert.deepEqual(rows.map(r => r.id), [id(703), id(702), id(701)]);
  assert.equal(rows[0].label, '5 Oct 2026 to 20 Oct 2026');
  assert.equal(rows[1].label, 'October 2026');
  assert.equal(rows[2].label, 'September 2026');
  assert.equal(rows[2].statusLabel, 'Paid');
  assert.equal(rows[2].paidAt, '2026-10-05T09:00:00Z');
  assert.equal(rows[0].statusLabel, 'Draft');
  assert.deepEqual(statementHistory([], id(1)), []);
});

test('no em dashes in the new files, and the page wires the table for staff only', () => {
  const dash = String.fromCharCode(0x2014);
  for (const file of ['lib/property-table.ts', 'lib/property-history.ts', 'mobile/src/PropertiesTable.tsx', 'tests/property-table.test.mjs']) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes(dash), `${file} has an em dash`);
  }
  const page = fs.readFileSync('mobile/src/LivePages.tsx', 'utf8');
  assert.match(page, /import \{ PropertiesTable \} from "\.\/PropertiesTable"/);
  assert.match(page, /const table = usesPropertyTable\(account\.role\)/);
  assert.match(page, /\{table \? <>\s*<PropertiesTable /);
  // Owners and cleaners keep the cards and their own sheet.
  assert.match(page, /\{!table && <Sheet /);
  assert.match(page, /<PropertyCard property=\{property\}/);
  const component = fs.readFileSync('mobile/src/PropertiesTable.tsx', 'utf8');
  // Statements are only drawn for finance roles, and the cleaner data is only asked for by the roles that may read it.
  assert.match(component, /isFinanceRole\(account\.role\) && account\.modules\.includes\("owner-statements"\)/);
  assert.match(component, /\{finance && <Statements /);
  assert.match(component, /seesCleaners\(account\.role, account\.modules\)/);
});
