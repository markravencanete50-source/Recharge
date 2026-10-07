import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Supabase's API connections refuse an UPDATE without a WHERE clause, so a function that does
// one works in tests and the SQL Editor but fails for every real request. Single-row settings
// tables are updated "where singleton".
test('every UPDATE in a migration has a WHERE clause', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const missing = [];
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(file, dir), 'utf8')).replace(/--[^\n]*/g, '');
    for (const match of sql.matchAll(/\bupdate\s+[\w."]+\s+(?:\w+\s+)?set\b[\s\S]*?;/gi)) {
      if (!/\bwhere\b/i.test(match[0])) missing.push(`${file}: ${match[0].replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(missing, []);
});
