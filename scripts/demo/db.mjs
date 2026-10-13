// Devstack database layer: PGlite with every migration in supabase/migrations, the dev people,
// and per-call "act as" helpers that do what Supabase's Data API (PostgREST) does for each
// request: one transaction, the caller's JWT claims and request headers as transaction-local
// settings, `set local role`, the pre-request hook (public.workspace_request_check), then the call.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { BOOTSTRAP } from './db-core.mjs';
export * from './db-core.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEVSTACK = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

export async function migrationFiles() {
  return (await fs.readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
}
// Changes to the schema, the seed or this file invalidate the cached seeded database.
export async function sourceHash() {
  const hash = createHash('sha256');
  for (const file of await migrationFiles()) hash.update(file).update(await fs.readFile(path.join(MIGRATIONS, file)));
  for (const file of ['db.mjs', 'db-core.mjs', 'seed.mjs']) hash.update(file).update(await fs.readFile(path.join(DEVSTACK, file)).catch(() => ''));
  return hash.digest('hex').slice(0, 16);
}
export async function freshDatabase() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const file of await migrationFiles()) {
    try { await db.exec(await fs.readFile(path.join(MIGRATIONS, file), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file} failed: ${error.message}`); }
  }
  return db;
}
export async function loadDatabase(blob) {
  const db = new PGlite({ loadDataDir: blob });
  await db.waitReady;
  await db.exec(`set time zone 'Europe/London'`);
  return db;
}

