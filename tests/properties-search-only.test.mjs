import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 6 (Lee: "in the properties remove those location buttons, it should be searchable only"): the Properties page has
// one search box and no region or status chips; typing a region or a status narrows the rows and the count.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const T = await vite.ssrLoadModule('/lib/property-table.ts');
const { plural } = await vite.ssrLoadModule('/lib/format.ts');
const screen = readFileSync('mobile/src/PropertiesTable.tsx', 'utf8');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const property = (n, over = {}) => ({ id: id(n), name: `Flat ${n}`, address: `${n} Test Street`, region: 'Edinburgh', status: 'active', version: 1, bedrooms: 2, ...over });
const rows = T.buildPropertyRows([
  ...Array.from({ length: 22 }, (_, i) => property(i + 1, { region: 'Glasgow' })),
  property(30, { region: 'Aberdeen' }), property(31, { region: 'Aberdeenshire and Moray' }),
  property(32, { region: 'Glasgow', status: 'onboarding' }),
], [], []);
// What the screen shows above the table: "N of M properties" while searching, else "M properties".
const count = query => { const shown = T.filterPropertyRows(rows, { query }); return query.trim() ? `${shown.length} of ${plural(rows.length, 'property', 'properties')}` : plural(rows.length, 'property', 'properties'); };

test('searching a region or a status filters the rows and the count', () => {
  assert.equal(count(''), '25 properties');
  assert.equal(count('Glasgow'), '23 of 25 properties');
  assert.equal(count('glasgow onboarding'), '1 of 25 properties');
  assert.equal(count('Onboarding'), '1 of 25 properties');
  assert.equal(count('aberdeen'), '2 of 25 properties', 'Aberdeen and Aberdeenshire both match');
  assert.equal(count('moray'), '1 of 25 properties');
  assert.equal(count('nowhere'), '0 of 25 properties');
});

test('no chip rows: no region or status chips, one search box, the table and its sorting kept', () => {
  assert.doesNotMatch(screen, /Filter by Scotland region|Filter by status|regionOptions|statusOptions|<Chip /);
  assert.doesNotMatch(screen, /setRegion|setStatus/);
  assert.match(screen, /<SearchBox p=\{p\} value=\{query\} onChange=\{v => change\(\(\) => setQuery\(v\)\)\} placeholder="Search by address, region or status" \/>/);
  assert.match(screen, /filterPropertyRows\(all, \{ query \}\)/);
  assert.match(screen, /`\$\{rows\.length\} of \$\{plural\(all\.length, "property", "properties"\)\}`/);
  assert.match(screen, /<Table p=\{p\} rows=\{rows\.slice\(0, shown\)\} sort=\{sort\} onSort=/);
  assert.match(screen, /SORT_KEYS\.map\(k => <SortChip /, 'sorting on the phone stays');
});
