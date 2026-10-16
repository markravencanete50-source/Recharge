import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The guest reviews sweep (20261023000000), against the real database functions: the offset each hourly run continues
// from, full passes, refused while the sync is paused, for the backend only; and a partial sweep never removes or hides
// a review it has not reached. The paging itself is tested in property-ratings (no network).
const MINE = '20261023000000_review_sweep.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
const at = migrations.indexOf(MINE);
assert.ok(at > 0);
const SIGS = ['private.workspace_hostaway_reviews_sweep(jsonb)', 'public.workspace_hostaway_reviews_sweep(jsonb)',
  'private.workspace_hostaway_reviews_ingest(jsonb)', 'private.workspace_hostaway_reviews_failed(jsonb)', 'private.workspace_property_ratings(uuid)'];
const fingerprints = async () => Object.fromEntries((await Promise.all(SIGS.map(async sig => [sig,
  (await db.query("select md5(replace(prosrc,chr(13),'')) h from pg_proc where oid=to_regprocedure($1)", [sig])).rows[0]?.h]))).filter(([, h]) => h));
for (const file of migrations.slice(0, at)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const before = await fingerprints();
const text = await fs.readFile('supabase/migrations/' + MINE, 'utf8');
await db.exec(text);
const once = await fingerprints();
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(text);
const secondRun = await definitions();
for (const file of migrations.slice(at + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); });

const sql = async (q, args = []) => { await db.exec('reset role'); return (await db.query(q, args)).rows; };
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sweep = async (input = {}) => { await asBackend(); return (await db.query('select public.workspace_hostaway_reviews_sweep($1) r', [input])).rows[0].r; };
const ingest = async (reviews, extra = {}) => { await asBackend(); return (await db.query('select public.workspace_hostaway_reviews_ingest($1) r', [{ trigger: 'schedule', reviews, done: true, complete: false, ...extra }])).rows[0].r; };
const review = (id, rating = 5) => ({ id: String(id), listingId: '777', channel: 'airbnb', channelName: 'airbnbOfficial', rating, scale: rating === null ? null : 5,
  text: 'Review ' + id, reviewedAt: '2026-10-01T12:00:00Z', url: null, status: rating === null ? 'awaiting' : 'published' });

test('the migration: safe to run twice, new functions only, CRLF, no DROP or DELETE, no em dash', async () => {
  assert.deepEqual(secondRun, firstRun);
  assert.deepEqual(Object.keys(before).sort(), SIGS.slice(2).sort(), 'the sweep functions are new');
  for (const sig of SIGS.slice(2)) assert.equal(once[sig], before[sig], 'unchanged: ' + sig);
  assert.doesNotMatch(text, /\bdrop\s|\bdelete\s+from\b/i);
  assert.doesNotMatch(text, /—/);
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'CRLF line endings');
  for (const sig of SIGS.slice(0, 2)) {
    const d = firstRun[SIGS.indexOf(sig)];
    assert.match(d, /SET search_path TO ''/i, sig);
    if (sig.startsWith('private.')) assert.match(d, /SECURITY DEFINER/, sig);
    for (const role of ['anon', 'authenticated', 'public']) {
      const ok = role === 'public'
        ? (await sql("select exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') ok", [sig]))[0].ok
        : (await sql("select has_function_privilege($1,$2,'execute') ok", [role, sig]))[0].ok;
      assert.equal(ok, false, `${role} ${sig}`);
    }
    assert.equal((await sql("select has_function_privilege('service_role',$1,'execute') ok", [sig]))[0].ok, true, sig);
  }
  const columns = await sql("select column_name,data_type,column_default from information_schema.columns where table_schema='private' and table_name='workspace_hostaway_review_state' and column_name in ('sweep_offset','passes','last_pass_at') order by column_name");
  assert.deepEqual(columns.map(c => c.column_name), ['last_pass_at', 'passes', 'sweep_offset']);
});

test('the offset: read, moved on after a run, a full pass counted when the sweep wraps', async () => {
  assert.deepEqual(await sweep(), { offset: 0, passes: 0, lastPassAt: null }, 'a new install starts at the top');
  assert.deepEqual(await sweep({ nextOffset: 1000, wrapped: false }), { offset: 1000, passes: 0, lastPassAt: null });
  assert.deepEqual(await sweep(), { offset: 1000, passes: 0, lastPassAt: null }, 'reading changes nothing');
  const wrapped = await sweep({ nextOffset: 300, wrapped: true });
  assert.deepEqual([wrapped.offset, wrapped.passes, typeof wrapped.lastPassAt], [300, 1, 'string']);
  const later = await sweep({ nextOffset: 1000, wrapped: false });
  assert.deepEqual([later.offset, later.passes, later.lastPassAt], [1000, 1, wrapped.lastPassAt], 'a pass stays counted');
});

test('bad input is refused, and nothing moves while the sync is paused', async () => {
  for (const bad of [[], 'x', { nextOffset: 100 }, { wrapped: true }, { nextOffset: -1, wrapped: false }, { nextOffset: 1.5, wrapped: false }, { nextOffset: '100', wrapped: false },
    { nextOffset: 1000001, wrapped: false }, { nextOffset: 100, wrapped: 'yes' }, { nextOffset: 100, wrapped: false, extra: 1 }]) {
    await asBackend();
    await assert.rejects(db.query('select public.workspace_hostaway_reviews_sweep($1)', [JSON.stringify(bad)]), /Invalid review sweep/, JSON.stringify(bad));
  }
  const now = await sweep();
  await sql('update private.workspace_hostaway_sync_state set paused=true where singleton');
  assert.deepEqual(await sweep({ nextOffset: 300, wrapped: true }), now, 'paused: nothing recorded');
  await sql('update private.workspace_hostaway_sync_state set paused=false where singleton');
});

test('only the backend may read or move the offset', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role'); await db.exec('set role ' + role);
    await assert.rejects(db.query('select public.workspace_hostaway_reviews_sweep($1)', [{}]), /permission denied/, role);
    await assert.rejects(db.query('select private.workspace_hostaway_reviews_sweep($1)', [{}]), /permission denied/, role);
  }
  await db.exec('reset role');
});

test('a partial sweep never removes or hides a review it has not reached, and unrated reviews never count', async () => {
  await ingest([review(1), review(2, 3), review(3, null)]);
  // The next runs reach other stretches only: the reviews read earlier stay as they were.
  await ingest([review(4, 4)]);
  await ingest([], { complete: true });
  const rows = await sql("select hostaway_id,stars::float8 stars from private.workspace_hostaway_reviews where listing_id='777' order by hostaway_id");
  assert.deepEqual(rows, [{ hostaway_id: '1', stars: 5 }, { hostaway_id: '2', stars: 3 }, { hostaway_id: '3', stars: null }, { hostaway_id: '4', stars: 4 }]);
  // The figures count stars only (workspace_property_ratings: "where h.stars is not null").
  const ratings = (await sql('select pg_get_functiondef($1::regprocedure) d', ['private.workspace_property_ratings(uuid)']))[0].d;
  assert.match(ratings, /from private\.workspace_hostaway_reviews h join visible v on v\.id=h\.property_id where h\.stars is not null/);
  assert.match(ratings, /'unlinked',case when everything then \(select count\(\*\) from private\.workspace_hostaway_reviews where property_id is null and stars is not null\)/);
  const ingestDef = (await sql('select pg_get_functiondef($1::regprocedure) d', ['private.workspace_hostaway_reviews_ingest(jsonb)']))[0].d;
  assert.doesNotMatch(ingestDef, /\bdelete\b/i, 'the ingest never deletes');
  assert.equal((await sql('select complete from private.workspace_hostaway_review_state'))[0].complete, true);
});

test('fingerprints for the install', () => {
  // Printed for the lead's live check: md5 of each function's source with CR removed.
  for (const sig of SIGS) console.log(`# ${sig} before=${before[sig] ?? 'absent'} after=${once[sig]}`);
  assert.ok(once[SIGS[0]] && once[SIGS[1]]);
});
