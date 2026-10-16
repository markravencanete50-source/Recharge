import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Property ratings: Hostaway's review records mapped with fake responses (no network), the paging and the reviews run with
// Hostaway and the database mocked, the plain words and order of the Ratings report, and the screens' markup. The figures
// and who sees them are tested against the database in property-ratings-database.
const state = { env: {}, calls: [], pages: [], fetched: [], rpc: {}, fail: null };
globalThis.__ratings = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__ratings.env;`,
  'auth-security': `const s=globalThis.__ratings;export const securityRpc=async(name,args)=>{s.calls.push({name,args});if(s.rpc[name])return s.rpc[name](args);return {added:args?.input?.reviews?.length??0,changed:0,unchanged:0,paused:false};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});`,
  'hostaway': `const s=globalThis.__ratings;
    export const isHostawayConfigured=()=>Boolean(s.env.HOSTAWAY_ACCOUNT_ID&&s.env.HOSTAWAY_API_KEY);
    export const hostawaySyncErrorMessage=()=>'Hostaway could not be reached. The next sync will try again.';
    export const fetchHostawayReviews=async(pages)=>{s.fetched.push('reviews:'+pages);if(s.fail)throw s.fail;return {rows:s.pages.flat(),complete:s.complete??true};};`,
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-hostaway-reviews', enforce: 'pre',
  transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (/\/lib\/hostaway-sync\.ts$/.test(file)) {
      for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === 'cloudflare:workers' ? name : './' + name}'`, `from 'ratings-test:${name}'`);
      return { code, map: null };
    }
    if (/\/lib\/hostaway\.ts$/.test(file)) return { code: code.replaceAll('from "cloudflare:workers"', `from 'ratings-test:cloudflare:workers'`), map: null };
  },
  resolveId: id => id.startsWith('ratings-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0ratings-test:') ? mocks[id.slice(14)] : null,
}] });
const policy = await vite.ssrLoadModule('/lib/hostaway-reviews-policy.ts');
const R = await vite.ssrLoadModule('/lib/property-ratings.ts');
const { runHostawayReviews } = await vite.ssrLoadModule('/lib/hostaway-sync.ts');
const hostaway = await vite.ssrLoadModule('/lib/hostaway.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const realFetch = globalThis.fetch;
after(async () => { globalThis.fetch = realFetch; delete globalThis.__ratings; await vite.close(); });
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function reset(env = { HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true' }) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { calls: [], pages: [], fetched: [], rpc: {}, fail: null, complete: true });
}

// Shapes as Hostaway's /reviews sends them.
const airbnb = { id: 81001, listingMapId: 40160, channelId: 2018, channelName: 'airbnbOfficial', type: 'guest-to-host', status: 'published', rating: 5,
  publicReview: 'Lovely flat, very clean.', privateFeedback: 'The shower was slow.', guestName: 'Morag', submittedAt: '2026-09-30 18:22:05', reviewUrl: 'https://www.airbnb.co.uk/rooms/1/reviews' };

test('a Hostaway review maps to what the database keeps, and never the private feedback or the guest', () => {
  assert.deepEqual(policy.syncReview(airbnb), { id: '81001', listingId: '40160', channel: 'airbnb', channelName: 'airbnbOfficial', rating: 5, scale: 5,
    text: 'Lovely flat, very clean.', reviewedAt: '2026-09-30T18:22:05Z', url: 'https://www.airbnb.co.uk/rooms/1/reviews', status: 'published' });
  assert.equal(policy.syncReview({ ...airbnb, type: 'host-to-guest' }), null, "the host's review of a guest");
  assert.equal(policy.syncReview({ ...airbnb, id: null, reviewId: null }), null, 'no id');
  assert.equal(policy.syncReview({ ...airbnb, channelName: '', channel: '' }).channel, 'airbnb', 'Hostaway channel id 2018');
  assert.equal(policy.syncReview({ ...airbnb, channelName: '', channelId: 2005 }).channel, 'booking_com');
  assert.equal(policy.syncReview({ ...airbnb, channelName: '', channelId: 9999 }).channel, 'other', 'an unknown channel is other, never direct');
  assert.equal(policy.syncReview({ ...airbnb, channelName: 'homeaway' }).channel, 'vrbo');
  const mapped = policy.syncReview({ ...airbnb, reviewUrl: 'http://insecure.example/r', publicReviewUrl: 'https://user:pw@x.example/r', publicReview: 'x'.repeat(5000), submittedAt: 'soon' });
  assert.deepEqual([mapped.url, mapped.text.length, mapped.reviewedAt], [null, 4000, null], 'https links only, words capped, an unreadable date left out');
  assert.equal(policy.syncReview({ ...airbnb, submittedAt: null, departureDate: '2026-09-28' }).reviewedAt, '2026-09-28T12:00:00Z', 'a day alone stays on that day');
  assert.equal(policy.syncReview({ ...airbnb, submittedAt: '2026-09-30T18:22:05+01:00' }).reviewedAt, '2026-09-30T17:22:05Z');
  assert.equal(policy.syncReview({ ...airbnb, submittedAt: '2099-01-01 00:00:00' }).reviewedAt, null, 'not in the future');
  for (const bare of ['', null, ' ']) assert.equal(policy.syncReview({ ...airbnb, publicReview: bare }).text, null);
});

test('the rating scale: stated, else out of 10 above 5, else 5 stars for Airbnb and Vrbo, else 10', () => {
  const scale = over => { const r = policy.syncReview({ ...airbnb, ...over }); return [r.rating, r.scale]; };
  assert.deepEqual(scale({ rating: 4 }), [4, 5], 'Airbnb stars as they are');
  assert.deepEqual(scale({ rating: 10 }), [10, 10], 'Airbnb passed as out of 10');
  assert.deepEqual(scale({ rating: 4, reviewCategory: [{ category: 'cleanliness', rating: 8 }, { category: 'location', rating: 10 }] }), [4, 10], 'categories above 5 mean out of 10');
  assert.deepEqual(scale({ rating: 4, ratingScale: 10 }), [4, 10], 'a stated scale wins');
  assert.deepEqual(scale({ channelName: 'bookingcom', rating: 8 }), [8, 10]);
  assert.deepEqual(scale({ channelName: 'bookingcom', rating: 4 }), [4, 10], 'Booking.com is out of 10 even when low');
  assert.deepEqual(scale({ channelName: 'vrbo', rating: 4 }), [4, 5]);
  assert.deepEqual(scale({ channelName: 'direct', rating: 9 }), [9, 10]);
  assert.deepEqual(scale({ rating: '4.5' }), [4.5, 5], 'a number as text');
  assert.deepEqual(scale({ rating: null, overallRating: 9, channelName: 'bookingcom' }), [9, 10]);
  for (const none of [null, 0, -1, 'n/a']) assert.deepEqual(scale({ rating: none }), [null, null], `no rating: ${none}`);
  assert.deepEqual(scale({ rating: 12 }), [null, null], 'above any scale: kept without a rating');
  assert.deepEqual(scale({ rating: 7, ratingScale: 5 }), [null, null], 'above its stated scale');
  assert.equal(policy.toStars(8, 10), 4); assert.equal(policy.toStars(9, 10), 4.5); assert.equal(policy.toStars(4, 5), 4);
});

test('batches: every review once, in batches, and always one call so the run is recorded', () => {
  const r = id => ({ ...policy.syncReview(airbnb), id: String(id) });
  const batches = policy.reviewBatches([r(1), r(2), r(1), r(3), r(4), r(5)], 2);
  assert.deepEqual(batches.map(b => b.map(x => x.id)), [['1', '2'], ['3', '4'], ['5']]);
  assert.deepEqual(policy.reviewBatches([]), [[]]);
  assert.equal(policy.REVIEW_PAGES, 20); assert.equal(policy.REVIEW_BATCH, 250);
});

test('the reviews run: off unless the sync is on, batches to the database, the last batch marked, paused stops it', async () => {
  reset({});
  assert.equal(await runHostawayReviews('schedule'), null); assert.deepEqual(state.fetched, []);
  reset({ HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k' });
  assert.equal(await runHostawayReviews('schedule'), null, 'switched off by default');

  reset();
  state.pages = [Array.from({ length: 300 }, (_, i) => ({ ...airbnb, id: 90000 + i })), [{ ...airbnb, id: 99999, type: 'host-to-guest' }, { ...airbnb, id: 90000 }]];
  state.complete = false;
  const summary = await runHostawayReviews('manual');
  assert.deepEqual(state.fetched, ['reviews:20']);
  const ingests = state.calls.filter(c => c.name === 'workspace_hostaway_reviews_ingest');
  assert.deepEqual(ingests.map(c => [c.args.input.trigger, c.args.input.reviews.length, c.args.input.done, c.args.input.complete]), [['manual', 250, false, true], ['manual', 50, true, false]]);
  assert.deepEqual(summary, { added: 300, changed: 0, unchanged: 0, fetched: 302, complete: false, paused: false });
  assert.deepEqual(Object.keys(ingests[0].args.input.reviews[0]).sort(), ['channel', 'channelName', 'id', 'listingId', 'rating', 'reviewedAt', 'scale', 'status', 'text', 'url']);

  reset();
  state.pages = [[airbnb]]; state.rpc.workspace_hostaway_reviews_ingest = () => ({ added: 0, changed: 0, unchanged: 0, paused: true });
  assert.equal((await runHostawayReviews('schedule')).paused, true);

  reset();
  assert.deepEqual((await runHostawayReviews('schedule')), { added: 0, changed: 0, unchanged: 0, fetched: 0, complete: true, paused: false });
  assert.deepEqual(state.calls.map(c => [c.name, c.args.input.reviews.length, c.args.input.done]), [['workspace_hostaway_reviews_ingest', 0, true]], 'no reviews still records the run');
});

test('a failed reviews run is recorded on its own and thrown, so the cron logs it and retries next hour', async () => {
  reset(); state.fail = new Error('rate limited');
  await assert.rejects(runHostawayReviews('schedule'), /rate limited/);
  assert.deepEqual(state.calls, [{ name: 'workspace_hostaway_reviews_failed', args: { input: { trigger: 'schedule', error: 'Hostaway could not be reached. The next sync will try again.' } } }]);
  reset(); state.pages = [[airbnb]]; state.rpc.workspace_hostaway_reviews_ingest = () => { throw new Error('database down'); };
  await assert.rejects(runHostawayReviews('manual'), /database down/);
  assert.equal(state.calls.at(-1).name, 'workspace_hostaway_reviews_failed');
});

test('paging against a fake Hostaway: pages of 100 until a short page, and at most the pages asked for', async () => {
  reset();
  const asked = [];
  let total = 250;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    asked.push(u.pathname + u.search);
    assert.equal(init.redirect, 'manual'); assert.ok(init.signal, 'every request has a timeout');
    if (u.pathname.endsWith('/accessTokens')) return Response.json({ access_token: 'fake-token', expires_in: 3600 });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fake-token');
    const offset = Number(u.searchParams.get('offset'));
    return Response.json({ status: 'success', result: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => ({ id: offset + i + 1 })) });
  };
  const all = await hostaway.fetchHostawayReviews(20);
  assert.deepEqual([all.rows.length, all.complete], [250, true]);
  assert.deepEqual(asked.filter(a => a.includes('/reviews')), ['/v1/reviews?limit=100&offset=0', '/v1/reviews?limit=100&offset=100', '/v1/reviews?limit=100&offset=200']);
  asked.length = 0; total = 10_000;
  const capped = await hostaway.fetchHostawayReviews(2);
  assert.deepEqual([capped.rows.length, capped.complete, asked.length], [200, false, 2], 'stops at the page limit and says so');
  globalThis.fetch = async () => Response.json({ status: 'success', result: { not: 'a list' } });
  await assert.rejects(hostaway.fetchHostawayReviews(1), /invalid review list/);
  globalThis.fetch = realFetch;
});

test('the plain words: stars from reviews, the last 90 days, the sources, and the empty states', () => {
  assert.equal(R.starsLine(4.83, 132), '4.8 stars from 132 reviews');
  assert.equal(R.starsLine(5, 1), '5.0 stars from 1 review');
  assert.equal(R.starsLine(null, 0), 'No reviews yet');
  assert.equal(R.starsLine(4.25, 1200), '4.3 stars from 1,200 reviews');
  assert.equal(R.recentLine({ recentAverage: 4.6, recentReviews: 12 }), '4.6 in the last 90 days (12 reviews)');
  assert.equal(R.recentLine({ recentAverage: null, recentReviews: 0 }), 'No reviews in the last 90 days');
  assert.equal(R.sourceLine({ hostawayReviews: 128, teamReviews: 4 }), '128 from Hostaway, 4 logged by the team');
  assert.equal(R.sourceLine({ hostawayReviews: 0, teamReviews: 1 }), '1 logged by the team');
  assert.equal(R.reviewRatingLine({ rating: 5, scale: 5, stars: 5 }), '5 stars');
  assert.equal(R.reviewRatingLine({ rating: 1, scale: 5, stars: 1 }), '1 star');
  assert.equal(R.reviewRatingLine({ rating: 9, scale: 10, stars: 4.5 }), '9 out of 10 (4.5 stars)');
  assert.equal(R.reviewByLine({ source: 'hostaway', channel: 'booking_com', reviewedOn: '2026-10-02' }), 'Booking.com · 2 October 2026');
  assert.equal(R.reviewByLine({ source: 'team', channel: 'airbnb', reviewedOn: null }), 'Airbnb · Logged by the team');
  const never = { sync: { lastRunAt: null, lastSuccessAt: null, complete: true, lastError: null, unlinked: 0 } };
  const synced = { sync: { lastRunAt: '2026-10-22T08:15:00Z', lastSuccessAt: '2026-10-22T08:15:00Z', complete: true, lastError: null, unlinked: 0 } };
  assert.match(R.emptyRatingsLine(never), /Hostaway has not sent any reviews/);
  assert.match(R.emptyRatingsLine(synced, { linked: false }), /not linked to a Hostaway listing/);
  assert.equal(R.emptyRatingsLine(synced, { linked: true }), 'No reviews yet for this property.');
  assert.match(R.syncLine(never.sync), /have not synced from Hostaway yet/);
  assert.equal(R.syncLine(synced.sync), 'Reviews last synced from Hostaway on 22 October 2026 at 09:15.');
  assert.match(R.syncLine({ ...synced.sync, lastRunAt: '2026-10-22T09:15:00Z', lastError: 'Hostaway is limiting requests.', complete: false, unlinked: 3 }),
    /The last try failed: Hostaway is limiting requests\. Hostaway had more reviews than one sync reads, so the oldest may be missing\. 3 rated reviews are for Hostaway listings not linked to a property yet\./);
  assert.equal(R.canSeeRatings({ role: 'client' }), false, 'owners are not shown ratings for now');
  for (const role of ['super_admin', 'admin', 'stays', 'ready', 'cleans', 'cleaning_manager', 'accounts']) assert.equal(R.canSeeRatings({ role }), true, role);
});

test('the report order: lowest first by default with unrated last, and a search by name', () => {
  const row = (name, average, reviews) => ({ propertyId: crypto.randomUUID(), propertyName: name, linked: true, reviews, average, recentReviews: 0, recentAverage: null, hostawayReviews: reviews, teamReviews: 0, latestOn: null });
  const rows = [row('Harbour Flat', 4.9, 40), row('Glen Cottage', 3.2, 5), row('Quay House', null, 0), row('Abbey Mews', 4.1, 90)];
  const names = (sort, q) => R.sortRatings(rows, sort, q).map(r => r.propertyName);
  assert.deepEqual(names('lowest'), ['Glen Cottage', 'Abbey Mews', 'Harbour Flat', 'Quay House']);
  assert.deepEqual(names('highest'), ['Harbour Flat', 'Abbey Mews', 'Glen Cottage', 'Quay House']);
  assert.deepEqual(names('most'), ['Abbey Mews', 'Harbour Flat', 'Glen Cottage', 'Quay House']);
  assert.deepEqual(names('name'), ['Abbey Mews', 'Glen Cottage', 'Harbour Flat', 'Quay House']);
  assert.deepEqual(names('lowest', 'harb'), ['Harbour Flat']);
  assert.deepEqual(names('lowest', 'nothing like it'), []);
  assert.deepEqual([...R.RATING_SORTS], ['lowest', 'highest', 'most', 'name']);
  assert.equal(rows[0].propertyName, 'Harbour Flat', 'the list given is not reordered');
});

test('the read: its own section, with or without one property, through the teams route', () => {
  assert.equal(teamsReadSchema.safeParse({ section: R.RATINGS_SECTION }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: R.RATINGS_SECTION, propertyId: '11111111-1111-4111-8111-111111111111' }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: R.RATINGS_SECTION, propertyId: 'nope' }).success, false);
  assert.match(read('lib/workspace-finance-server.ts'), /input\.section === 'propertyRatings' \? client\.rpc\('workspace_property_ratings', \{ target_property: input\.propertyId \|\| null \}\)/);
});

test('the sync runs hourly after the reservation sync, and after "Sync now", without failing it', () => {
  const worker = read('worker/index.ts');
  assert.match(worker, /const reviewsHour = new Date\(\)\.getUTCMinutes\(\) < 15;/);
  const sync = worker.indexOf("await module.runHostawaySync('schedule')"), reviews = worker.indexOf("if (reviewsHour) await module.runHostawayReviews('schedule')");
  assert.ok(sync > 0 && reviews > sync, 'straight after the sync, never at the same time');
  assert.ok(worker.indexOf('if (hostawayOn) {', worker.indexOf("controller.cron !== '*/15 * * * *') return;")) < sync, 'on the 15-minute tick, only when the sync is on');
  const integration = read('lib/integration-server.ts');
  assert.match(integration, /const summary=await runHostawaySync\('manual'\);\s*\r?\n\s*\/\/[^\n]*\r?\n\s*const reviews=await runHostawayReviews\('manual'\)\.catch\(\(\)=>null\);\s*\r?\n\s*return businessResponse\(\{\.\.\.summary,reviews\}\);/);
  assert.match(read('mobile/src/HostawaySyncCard.tsx'), /s\.reviews\?\.added && plural\(s\.reviews\.added, "new guest review"\)/);
});

test('the screens: a Ratings card in the admins\' Reports hub, and a ratings line on the team\'s property page', () => {
  const page = read('mobile/src/LiveWorkspace.tsx');
  const start = page.indexOf('const adminReports'), end = page.indexOf('const reportsPage');
  assert.match(page.slice(start, end), /\{ key: "ratings", label: "Ratings", detail: "[^"]+", icon: "star", ownIntro: true, page: <RatingsReport p=\{p\} account=\{account\} \/> \}/);
  assert.equal(page.match(/<RatingsReport /g).length, 1, 'only inside the admins\' hub');
  const screen = read('mobile/src/PropertyRatings.tsx');
  assert.match(screen, /if \(!allowed\) return null;/);
  assert.match(screen, /useState<RatingSort>\("lowest"\)/, 'lowest first by default, so problems surface');
  assert.match(screen, /<SearchBox p=\{p\} value=\{query\} onChange=\{setQuery\} placeholder="Search properties by name" \/>/);
  assert.match(screen, /<Pills p=\{p\} title="Sort" values=\{RATING_SORTS\}/);
  assert.match(screen, /onPress=\{\(\) => setOpen\(\{ id: r\.propertyId, name: r\.propertyName \}\)\}/, 'tap a property to see its reviews');
  assert.match(screen, /emptyRatingsLine\(/, 'empty states in plain words');
  assert.match(screen, /<StatTile p=\{p\} icon="clock" label="Last 90 days"/);
  assert.match(screen, /title="By channel"/); assert.match(screen, /title="Latest reviews"/);
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b/, 'theme tokens only');
  assert.doesNotMatch(screen, /fontWeight: "700"/, 'weight 600 for emphasis');
  const profile = read('mobile/src/LivePropertyProfile.tsx');
  assert.match(profile, /if \(canSeeRatings\(account\)\) panels\.push\(\s*<Panel key="ratings" p=\{p\} icon="star" tone="stays" title="Guest ratings"[^>]*>\s*<PropertyRatingsSummary p=\{p\} propertyId=\{propertyId\} \/>/);
  assert.match(screen, /starsLine\(r\.average, r\.reviews\)/, '"4.8 stars from 132 reviews"');
  assert.match(screen, /\(data\.property\?\.latest \?\? \[\]\)\.slice\(0, 3\)/, 'the latest few reviews on the property page');
  for (const file of ['mobile/src/PropertyRatings.tsx', 'lib/property-ratings.ts', 'lib/hostaway-reviews-policy.ts', 'lib/hostaway-sync.ts', 'lib/hostaway.ts', 'worker/index.ts',
    'supabase/migrations/20261022500000_property_ratings.sql', 'mobile/src/LivePropertyProfile.tsx', 'mobile/src/LiveWorkspace.tsx', 'lib/integration-server.ts']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF line endings');
    assert.doesNotMatch(text, /\u2014/, file + ' has no em dashes');
  }
  for (const file of ['tests/property-ratings.test.mjs', 'tests/property-ratings-database.test.mjs']) {
    const text = read(file);
    assert.doesNotMatch(text, /\r/, file + ' keeps LF line endings');
    assert.doesNotMatch(text, /\u2014/, file + ' has no em dashes');
  }
});
