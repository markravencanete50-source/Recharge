// Lead developer's tool: builds supabase/install-pending.sql, one transaction holding every migration whose version
// starts with the given prefix, in filename order, each recorded in supabase_migrations.schema_migrations.
// Usage: node scripts/lead/build-install-bundle.mjs <version prefix[,prefix…]> "<round label>" [output path]
//   e.g. node scripts/lead/build-install-bundle.mjs 20261016,20261017,20261018 "Rounds 6 to 8"
// Then check it with scripts/lead/check-install.mjs before anyone runs it.
import fs from 'node:fs/promises';
import path from 'node:path';
const [prefix, label, out = 'supabase/install-pending.sql'] = process.argv.slice(2);
if (!prefix || !label) { console.error('usage: build-install-bundle.mjs <prefix> "<label>" [out]'); process.exit(1); }
const dir = 'supabase/migrations';
const prefixes = prefix.split(',');
const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql') && prefixes.some(x => f.startsWith(x))).sort();
if (!files.length) { console.error('no migrations start with', prefix); process.exit(1); }
const parts = [
  `-- ${label}: the ${files.length} migrations not yet installed, in filename order, in ONE transaction.`,
  '-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.',
  '-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations',
  '-- under its filename version. Generated from supabase/migrations; do not edit by hand.',
  '-- Running it a second time stops at the first line below and changes nothing.',
  '',
  'begin;',
  "set local lock_timeout='20s';",
  `do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where ${prefixes.map(x => `version like '${x}%'`).join(' or ')}) then raise exception '${label} is already installed (or partly): stop and check'; end if; end $guard$;`,
];
for (const f of files) {
  const m = /^(\d+)_(.+)\.sql$/.exec(f);
  const sql = (await fs.readFile(path.join(dir, f), 'utf8')).replace(/\r/g, '').trimEnd();
  parts.push('', `-- ===== ${m[1]}_${m[2]} =====`, sql, '', `insert into supabase_migrations.schema_migrations(version,name) values ('${m[1]}','${m[2]}');`);
}
parts.push('', 'commit;', '');
await fs.writeFile(out, parts.join('\n'));
console.log(`wrote ${out}: ${files.length} migrations`, files.join(' '));
