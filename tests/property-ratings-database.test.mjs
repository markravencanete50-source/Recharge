import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Property ratings (migration 20261022500000): Hostaway's guest reviews are stored through the service-role-only ingest
// (insert or update only, so a second run changes nothing), linked to the property with their listing (or kept unlinked),
// and workspace_property_ratings works out the figures on a 5-star scale with the team's logged reviews, for the team only:
// admins, super admins and Guest relations see every property, the rest of the team their assigned ones, owners none.
const MINE = '20261022500000_property_ratings.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const R = await vite.ssrLoadModule('/lib/property-ratings.ts');
const policy = await vite.ssrLoadModule('/lib/hostaway-reviews-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes(MINE));
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_hostaway_reviews_ingest(jsonb)', 'private.workspace_hostaway_reviews_failed(jsonb)', 'private.workspace_property_ratings(uuid)', 'public.workspace_property_ratings(uuid)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'client', 'ready', 'cleans'];
const users = roles.map((_, i) => `97750000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, READY, CLEANS] = roles.map((_, i) => i);
const session = i => users[i].replace('9775', '9875');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ratings${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Ratings ${i}`]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); });
const sql = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const ingest = async (reviews, extra = {}) => { await asBackend(); return (await db.query('select public.workspace_hostaway_reviews_ingest($1) r', [{ trigger: 'schedule', reviews, done: true, complete: true, ...extra }])).rows[0].r; };
const ratings = async (i, propertyId = null) => { await as(i); return R.propertyRatingsSchema.parse((await db.query('select public.workspace_property_ratings($1) r', [propertyId])).rows[0].r); };
const syncListings = async listings => { await asBackend(); return (await db.query('select public.workspace_hostaway_sync($1) r', [{ trigger: 'schedule', listings, reservations: [] }])).rows[0].r; };

// Two Hostaway listings become properties; a third property has no listing (the team logs its reviews by hand).
await syncListings([{ id: '901', name: 'Ratings Cottage', address: '1 Loch Road, Oban', bedrooms: 2, accessInfo: '' }, { id: '902', name: 'Ratings Flat', address: '2 Quay Street, Oban', bedrooms: 1, accessInfo: '' }]);
const propertyOf = async listing => (await sql('select id from public.workspace_properties where hostaway_listing_id=$1', [listing]))[0].id;
const COTTAGE = await propertyOf('901'), FLAT = await propertyOf('902');
await as(ADMIN);
const MANUAL = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Ratings Bothy', address: '3 Glen Lane, Oban', region: 'Highlands', bedrooms: 1 })])).rows[0].id;
for (const [property, user, kind] of [[COTTAGE, OWNER, 'client'], [COTTAGE, READY, 'staff'], [MANUAL, STAYS, 'staff']]) await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[user], kind]);

const daysAgo = n => new Date(Date.now() - n * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', ' ').replace('Z', '');
// Hostaway's records as its API sends them, through the app's own mapping (no network).
const raw = [
  { id: 5001, listingMapId: 901, channelId: 2018, channelName: 'airbnbOfficial', type: 'guest-to-host', status: 'published', rating: 5, publicReview: 'Spotless and cosy.', submittedAt: daysAgo(10) },
  { id: 5002, listingMapId: 901, channelName: 'airbnbOfficial', type: 'guest-to-host', status: 'published', rating: 4, publicReview: 'Lovely views, a bit noisy.', submittedAt: daysAgo(200) },
  { id: 5003, listingMapId: 901, channelName: 'bookingcom', type: 'guest-to-host', status: 'published', rating: 8, publicReview: 'Good location.', submittedAt: daysAgo(20), reviewUrl: 'https://www.booking.com/reviews/5003' },
  { id: 5004, listingMapId: 902, channelName: 'airbnbOfficial', type: 'guest-to-host', status: 'published', rating: 10, reviewCategory: [{ category: 'cleanliness', rating: 10 }], publicReview: 'Perfect.', submittedAt: daysAgo(5) },
  { id: 5005, listingMapId: 901, channelName: 'airbnbOfficial', type: 'host-to-guest', status: 'published', rating: 5, publicReview: 'Great guest.', submittedAt: daysAgo(3) },
  { id: 5006, listingMapId: 999, channelName: 'bookingcom', type: 'guest-to-host', status: 'published', rating: 6, publicReview: 'Not linked yet.', submittedAt: daysAgo(4) },
  { id: 5007, listingMapId: 902, channelName: 'airbnbOfficial', type: 'guest-to-host', status: 'awaiting', rating: null, publicReview: '', submittedAt: null },
];
const mapped = raw.map(policy.syncReview).filter(Boolean);

test('the migration runs twice to the same functions, has no em dash, and only the backend can store reviews', async () => {
  assert.deepEqual(secondRun, firstRun);
  for (const d of firstRun) assert.ok(!d.includes('\u2014'), 'no em dash');
  for (const fn of ['private.workspace_hostaway_reviews_ingest(jsonb)', 'public.workspace_hostaway_reviews_ingest(jsonb)', 'public.workspace_hostaway_reviews_failed(jsonb)']) {
    for (const role of ['anon', 'authenticated']) assert.equal((await sql('select has_function_privilege($1,$2,\'execute\') ok', [role, fn]))[0].ok, false, `${role} ${fn}`);
    assert.equal((await sql('select has_function_privilege(\'service_role\',$1,\'execute\') ok', [fn]))[0].ok, true, fn);
  }
  assert.equal((await sql("select has_function_privilege('anon','public.workspace_property_ratings(uuid)','execute') ok"))[0].ok, false);
  assert.equal((await sql("select has_function_privilege('authenticated','public.workspace_property_ratings(uuid)','execute') ok"))[0].ok, true);
  for (const table of ['private.workspace_hostaway_reviews', 'private.workspace_hostaway_review_state']) {
    assert.equal((await sql("select has_table_privilege('authenticated',$1,'select') ok", [table]))[0].ok, false, table);
  }
  const text = await fs.readFile('supabase/migrations/' + MINE, 'utf8');
  assert.doesNotMatch(text, /\bdrop\s|\bdelete\s+from\b/i, 'no DROP and no DELETE');
  await as(ADMIN);
  await assert.rejects(db.query('select public.workspace_hostaway_reviews_ingest($1)', [{ trigger: 'schedule', reviews: [] }]), /permission denied/);
});

test('reviews are stored once, linked by listing, and a second run changes nothing', async () => {
  assert.equal(mapped.length, 6, "the host's review of a guest is never stored");
  const first = await ingest(mapped);
  assert.deepEqual(first, { added: 6, changed: 0, unchanged: 0, paused: false });
  const rows = await sql('select hostaway_id,property_id,channel,rating::float8 rating,scale,stars::float8 stars,review_url from private.workspace_hostaway_reviews order by hostaway_id');
  const by = Object.fromEntries(rows.map(r => [r.hostaway_id, r]));
  assert.deepEqual([by['5001'].property_id, by['5001'].channel, by['5001'].rating, by['5001'].scale, by['5001'].stars], [COTTAGE, 'airbnb', 5, 5, 5], 'Airbnb stars kept out of 5');
  assert.deepEqual([by['5003'].channel, by['5003'].rating, by['5003'].scale, by['5003'].stars, by['5003'].review_url], ['booking_com', 8, 10, 4, 'https://www.booking.com/reviews/5003'], 'Booking.com out of 10, halved');
  assert.deepEqual([by['5004'].property_id, by['5004'].scale, by['5004'].stars], [FLAT, 10, 5], 'an Airbnb 10 is out of 10');
  assert.equal(by['5006'].property_id, null, 'a listing not linked to a property: kept, unlinked');
  assert.deepEqual([by['5007'].rating, by['5007'].scale, by['5007'].stars], [null, null, null], 'no rating yet');

  const again = await ingest(mapped);
  assert.deepEqual(again, { added: 0, changed: 0, unchanged: 6, paused: false }, 'idempotent');
  assert.equal((await sql('select count(*)::int n from private.workspace_hostaway_reviews'))[0].n, 6);
  const edited = await ingest([{ ...mapped[0], text: 'Spotless, cosy and warm.' }]);
  assert.deepEqual(edited, { added: 0, changed: 1, unchanged: 0, paused: false });
  assert.equal((await sql("select review_text from private.workspace_hostaway_reviews where hostaway_id='5001'"))[0].review_text, 'Spotless, cosy and warm.');
  const state = (await sql('select last_success_at,last_error,last_summary from private.workspace_hostaway_review_state'))[0];
  assert.ok(state.last_success_at); assert.equal(state.last_error, null); assert.deepEqual(state.last_summary, { reviews: 6, unlinked: 1 });
});

test('bad input is refused whole, and nothing comes in while the sync is paused', async () => {
  for (const bad of [{ ...mapped[0], rating: 6, scale: 5 }, { ...mapped[0], scale: 7 }, { ...mapped[0], rating: 3, scale: null }, { ...mapped[0], channel: 'expedia' }, { ...mapped[0], url: 'http://x.example' }, { ...mapped[0], extra: 1 }]) {
    await asBackend();
    await assert.rejects(db.query('select public.workspace_hostaway_reviews_ingest($1)', [{ trigger: 'schedule', reviews: [bad] }]), /Invalid reviews/, JSON.stringify(bad));
  }
  await sql('update private.workspace_hostaway_sync_state set paused=true where singleton');
  assert.deepEqual(await ingest([{ ...mapped[0], id: '5999' }]), { added: 0, changed: 0, unchanged: 0, paused: true });
  await sql('update private.workspace_hostaway_sync_state set paused=false where singleton');
  assert.equal((await sql("select count(*)::int n from private.workspace_hostaway_reviews where hostaway_id='5999'"))[0].n, 0);
});

test('a listing linked later brings its stored reviews to the property', async () => {
  await syncListings([{ id: '999', name: 'Ratings Lodge', address: '4 Pier Road, Oban', bedrooms: 3, accessInfo: '' }]);
  const LODGE = await propertyOf('999');
  await ingest([]);
  assert.equal((await sql("select property_id from private.workspace_hostaway_reviews where hostaway_id='5006'"))[0].property_id, LODGE);
});

test('a failed run is recorded on the reviews, never on the reservation sync', async () => {
  await asBackend();
  await db.query('select public.workspace_hostaway_reviews_failed($1)', [{ trigger: 'manual', error: 'Hostaway could not be reached. The next sync will try again.' }]);
  const state = (await sql('select last_error,last_trigger from private.workspace_hostaway_review_state'))[0];
  assert.deepEqual([state.last_error, state.last_trigger], ['Hostaway could not be reached. The next sync will try again.', 'manual']);
  assert.equal((await sql('select last_error from private.workspace_hostaway_sync_state'))[0].last_error, null);
  await ingest([]);
});

test('the figures: 5-star averages, the last 90 days, by channel, the latest reviews, with the team\'s logged reviews', async () => {
  // Guest relations logs a review by hand on the property with no Hostaway listing, and one on the Cottage.
  await as(ADMIN);
  await db.query('select public.workspace_assign_property($1,$2,$3)', [COTTAGE, users[STAYS], 'staff']);
  const today = (await sql("select (now() at time zone 'Europe/London')::date::text d"))[0].d;
  const log = async (propertyId, data) => { await as(STAYS); return (await db.query('select public.workspace_operations_action($1::jsonb) r', [JSON.stringify({ requestId: crypto.randomUUID(), action: 'createOperation', propertyId, kind: 'guest_review', data })])).rows[0].r; };
  await log(MANUAL, { platform: 'Booking.com', reviewedOn: today, rating: 9, outOf: 10, sentiment: 'positive', summary: 'Quiet and comfortable', relist: false });
  await log(COTTAGE, { platform: 'Airbnb', reviewedOn: today, rating: 3, outOf: 5, sentiment: 'negative', summary: 'The heating was off', relist: false });

  const all = await ratings(ADMIN);
  const row = id => all.properties.find(p => p.propertyId === id);
  // Cottage: Hostaway 5 (10 days), 4 (200 days), 8/10=4 (20 days); team 3 today. Average (5+4+4+3)/4=4; last 90 days (5+4+3)/3=4.
  assert.deepEqual(R.starsLine(row(COTTAGE).average, row(COTTAGE).reviews), '4.0 stars from 4 reviews');
  assert.equal(row(COTTAGE).recentReviews, 3); assert.equal(row(COTTAGE).recentAverage, 4);
  assert.deepEqual([row(COTTAGE).hostawayReviews, row(COTTAGE).teamReviews], [3, 1], 'counted once each: Hostaway\'s and the team\'s are separate items');
  assert.deepEqual([row(FLAT).reviews, row(FLAT).average], [1, 5], 'the review with no rating yet is left out');
  assert.deepEqual([row(MANUAL).reviews, row(MANUAL).average, row(MANUAL).linked, row(MANUAL).teamReviews], [1, 4.5, false, 1], '9 out of 10 is 4.5 stars');
  assert.ok(all.properties.length >= 4); assert.equal(all.property, null);
  assert.equal(all.sync.unlinked, 0); assert.ok(all.sync.lastSuccessAt);

  const one = await ratings(ADMIN, COTTAGE);
  assert.equal(one.properties.length, 1);
  assert.deepEqual(one.property.channels.map(c => [c.channel, c.reviews, c.average]), [['airbnb', 3, 4], ['booking_com', 1, 4]]);
  assert.deepEqual(one.property.latest.map(r => [r.source, r.text]), [['team', 'The heating was off'], ['hostaway', 'Spotless, cosy and warm.'], ['hostaway', 'Good location.'], ['hostaway', 'Lovely views, a bit noisy.']]);
  assert.equal(R.reviewByLine(one.property.latest[0]).endsWith('Logged by the team'), true);
  assert.equal(R.reviewRatingLine(one.property.latest.find(r => r.channel === 'booking_com')), '8 out of 10 (4.0 stars)');
  // Through the app's own read schema.
  assert.equal(teamsReadSchema.safeParse({ section: R.RATINGS_SECTION, propertyId: COTTAGE }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: R.RATINGS_SECTION }).success, true);
});

test('who sees which ratings: admins and Guest relations everything, the team its own properties, owners nothing', async () => {
  for (const i of [SUPER, ADMIN, STAYS]) assert.ok((await ratings(i)).properties.some(p => p.propertyId === FLAT), roles[i]);
  const ready = await ratings(READY);
  assert.deepEqual(ready.properties.map(p => p.propertyId), [COTTAGE], 'only the assigned property');
  assert.equal(ready.sync.lastError, null); assert.equal(ready.sync.unlinked, 0);
  await as(READY); await assert.rejects(db.query('select public.workspace_property_ratings($1)', [FLAT]), /Property access denied/);
  assert.deepEqual((await ratings(CLEANS)).properties, [], 'nothing assigned, nothing shown');
  // Owners are refused, even for their own property (Lee decides later).
  await as(OWNER); await assert.rejects(db.query('select public.workspace_property_ratings(null)'), /not shown to owners/);
  await as(OWNER); await assert.rejects(db.query('select public.workspace_property_ratings($1)', [COTTAGE]), /not shown to owners/);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_property_ratings(null)'), /permission denied/);
});
