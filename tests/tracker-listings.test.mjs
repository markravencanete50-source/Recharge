import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Listing health, pricing, reviews and re-listing as tracker rows (client ask C7). Pure adapters:
// one row per live property for the first three, one per work item for re-listing.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const L = await vite.ssrLoadModule('/lib/tracker-listings.ts');
const { updateStamp } = await vite.ssrLoadModule('/lib/tracker.ts');

const TODAY = '2026-10-13';
const NOW = new Date('2026-10-13T12:00:00Z');
const PROPS = [
  { id: 'p1', name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA', status: 'active' },
  { id: 'p2', name: 'Harbour cottage', address: '', status: 'active' },
  { id: 'p3', name: 'Onboarding house', address: '9 New Road', status: 'onboarding' },
];
const form = (key, title, unavailable) => ({ key, title, ...(unavailable ? { unavailable } : {}) });
const ctx = (over = {}) => ({
  properties: PROPS, today: TODAY, now: NOW, owner: false,
  property: id => PROPS.find(p => p.id === id), forms: () => [], can: () => true, ...over,
});
let n = 0;
const work = (kind, data, over = {}) => ({
  workId: 'w' + ++n, propertyId: 'p1', moduleId: 'm', title: 'T', kind, status: 'completed', version: 2, assigneeId: null,
  createdAt: '2026-10-13T09:30:00Z', updatedAt: '2026-10-13T09:30:00Z', updatedBy: 'Morag Reid', updatedEvent: null, data, ...over,
});
const check = (on, data = {}, over = {}) => work('listing_health', { checkedOn: on, platform: 'Airbnb', listingVisible: true, reviewSentiment: 'none', reviewAcknowledged: false, suspended: false, evidence: 'Photos, price and calendar match', ...data }, { createdAt: on + 'T09:30:00Z', updatedAt: on + 'T09:30:00Z', ...over });
const pricing = (night, over = {}, data = {}) => work('daily_pricing', { night, currentRateMinor: 9000, proposedRateMinor: 9000, decision: 'hold', reason: 'Local event', phase: 'applied', ...data }, over);
const review = (on, data = {}, over = {}) => work('guest_review', { platform: 'Airbnb', reviewedOn: on, rating: 5, outOf: 5, sentiment: 'positive', summary: 'Lovely stay', relist: false, ...data }, { createdAt: on + 'T10:00:00Z', ...over });
const states = item => item.steps.map(s => s.state);
const row = (items, id) => items.find(i => i.propertyId === id);

test('only live properties get a row, with the full address (or the name when none is held)', () => {
  const items = L.listingHealthTrackerItems([], ctx());
  assert.deepEqual(items.map(i => i.propertyId).sort(), ['p1', 'p2']);
  assert.equal(row(items, 'p1').address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(row(items, 'p2').address, 'Harbour cottage');
  for (const i of items) { assert.equal(i.section, 'listing_health'); assert.equal(i.id, 'listing_health:' + i.propertyId); }
});

test('listing health: due today when yesterday was the last check', () => {
  const item = row(L.listingHealthTrackerItems([check('2026-10-12')], ctx()), 'p1');
  assert.equal(item.status.label, 'Due');
  assert.equal(item.status.tone, 'wait');
  assert.equal(item.closed, false);
  assert.deepEqual(states(item), ['current', 'todo', 'todo']);
  assert.deepEqual(item.progress, { done: 0, total: 3 });
  assert.equal(item.nextStep, 'Check the listing today');
  assert.deepEqual(item.nextAction, { label: 'Record the listing check', actionKey: 'listing_health' });
  assert.equal(item.source.overdueDays, 0);
});

test('listing health: overdue once a daily check has been missed, and a never-checked property is due', () => {
  const late = row(L.listingHealthTrackerItems([check('2026-10-10')], ctx()), 'p1');
  assert.equal(late.status.label, 'Overdue');
  assert.equal(late.status.tone, 'bad');
  assert.equal(late.source.overdueDays, 2);
  assert.match(late.steps[0].detail, /Overdue by 2 days/);
  assert.match(late.nextStep, /was due/);
  const never = row(L.listingHealthTrackerItems([], ctx()), 'p2');
  assert.equal(never.status.label, 'Due');
  assert.equal(never.nextStep, 'Do the first listing check');
  assert.equal(never.lastUpdate, null);
  assert.equal(never.workId, undefined);
  assert.equal(never.details[0].value, 'Never checked');
});

test('listing health: done today folds away with the next check tomorrow', () => {
  const item = row(L.listingHealthTrackerItems([check(TODAY), check(TODAY, { platform: 'Booking.com' })], ctx()), 'p1');
  assert.equal(item.status.label, 'Done today');
  assert.equal(item.status.tone, 'good');
  assert.equal(item.closed, true);
  assert.deepEqual(states(item), ['done', 'done', 'skipped']);
  assert.deepEqual(item.progress, { done: 2, total: 2 });
  assert.match(item.nextStep, /Next check .*14 Oct/);
  assert.equal(item.nextAction, null);
  assert.ok(item.details.some(d => d.label === 'Checked today on' && d.value === 'Airbnb, Booking.com'));
});

test('listing health: an issue is raised, and the row stays open while the re-listing does', () => {
  const bad = check(TODAY, { listingVisible: false, platform: 'Booking.com' });
  const relist = work('relisting', { phase: 'to_relist', reason: 'hidden', platform: 'Booking.com' }, { status: 'waiting' });
  const open = row(L.listingHealthTrackerItems([bad, relist], ctx()), 'p1');
  assert.equal(open.status.label, 'Done today');
  assert.equal(open.status.tone, 'wait');
  assert.equal(open.closed, false);
  assert.deepEqual(states(open), ['done', 'done', 'done']);
  assert.match(open.steps[2].detail, /Listing not visible on Booking\.com/);
  assert.equal(open.nextStep, 'Follow the open re-listing');
  const finished = row(L.listingHealthTrackerItems([bad, { ...relist, status: 'completed' }], ctx()), 'p1');
  assert.equal(finished.closed, true);
  const suspended = row(L.listingHealthTrackerItems([check(TODAY, { suspended: true })], ctx()), 'p1');
  assert.match(suspended.steps[2].detail, /Listing suspended/);
  const review = row(L.listingHealthTrackerItems([check(TODAY, { reviewSentiment: 'negative', reviewAcknowledged: true })], ctx()), 'p1');
  assert.match(review.steps[2].detail, /Bad review/);
});

test('listing health: a person who may not log a check is told who it waits for', () => {
  const item = row(L.listingHealthTrackerItems([], ctx({ can: () => false })), 'p1');
  assert.deepEqual(item.nextAction, { label: 'Waiting for Guest relations' });
});

test('stamps: the newest check names who and when, in UK time; owners see Recharge', () => {
  const items = L.listingHealthTrackerItems([check('2026-10-12'), check(TODAY, {}, { updatedBy: 'Ailsa Grant', updatedAt: '2026-10-13T10:05:00Z' })], ctx());
  const item = row(items, 'p1');
  assert.equal(updateStamp(item.lastUpdate, NOW), 'Today 11:05 · Ailsa Grant');
  assert.equal(item.workId, item.source.latest.workId);
  const owned = row(L.listingHealthTrackerItems([check(TODAY)], ctx({ owner: true })), 'p1');
  assert.equal(owned.lastUpdate.by, null);
  assert.equal(updateStamp(owned.lastUpdate, NOW, true), 'Today 10:30 · Recharge');
  assert.ok(!owned.details.some(d => d.label === 'What was checked'));
});

test('listing health ordering: overdue first (longest late first), then due, then done', () => {
  const props = [
    { id: 'a', name: 'A', address: '1 A Street', status: 'active' }, { id: 'b', name: 'B', address: '2 B Street', status: 'active' },
    { id: 'c', name: 'C', address: '3 C Street', status: 'active' }, { id: 'd', name: 'D', address: '4 D Street', status: 'active' },
  ];
  const w = [check('2026-10-12', {}, { propertyId: 'a' }), check(TODAY, {}, { propertyId: 'b' }), check('2026-10-09', {}, { propertyId: 'c' }), check('2026-10-11', {}, { propertyId: 'd' })];
  const items = L.listingHealthTrackerItems(w, ctx({ properties: props }));
  assert.deepEqual(items.map(i => i.propertyId), ['c', 'd', 'a', 'b']);
  assert.deepEqual(items.map(i => i.status.label), ['Overdue', 'Overdue', 'Due', 'Done today']);
});

test('pricing: empty nights from the flagged ticket, with the steps and the sheet target', () => {
  const gap = work('pricing_gap', { nights: ['2026-10-14', '2026-10-15', '2026-10-16'] }, { status: 'waiting', createdAt: '2026-10-13T06:00:00Z', updatedAt: '2026-10-13T06:00:00Z', updatedBy: null });
  const w = [gap, pricing('2026-10-15', { createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z' })];
  const item = row(L.pricingTrackerItems(w, ctx()), 'p1');
  assert.deepEqual(item.source.nights, ['2026-10-14', '2026-10-16']);
  assert.equal(item.status.label, '2 to price');
  assert.equal(item.status.tone, 'wait');
  assert.deepEqual(states(item), ['done', 'current', 'todo']);
  assert.match(item.steps[1].detail, /1 of 3 priced/);
  assert.match(item.nextStep, /Price 2 empty nights, starting .*14 Oct/);
  assert.deepEqual(item.nextAction, { label: 'Price a night', actionKey: 'daily_pricing' });
  assert.equal(item.workId, gap.workId);
  assert.ok(item.details.some(d => d.label === 'Empty nights to price'));
  assert.ok(item.details.some(d => d.label === 'Last pricing review' && /12 Oct/.test(d.value)));
});

test('pricing: tonight unpriced is urgent; the stays find gaps the system has not flagged yet', () => {
  const stays = [{ propertyId: 'p1', checkIn: '2026-10-14', checkOut: '2026-10-19' }, { propertyId: 'p2', checkIn: '2026-10-01', checkOut: '2026-10-30' }];
  const items = L.pricingTrackerItems([], ctx({ stays }));
  const p1 = row(items, 'p1'), p2 = row(items, 'p2');
  assert.deepEqual(p1.source.nights, ['2026-10-13', '2026-10-19']);
  assert.equal(p1.status.tone, 'bad');
  assert.equal(p1.source.overdueDays, 1);
  assert.equal(p2.status.label, 'Up to date');
  assert.equal(p2.closed, true);
  assert.equal(p2.steps[1].state, 'skipped');
  assert.equal(items[0].propertyId, 'p1');
});

test('pricing: a decision waiting to be applied is the next step once every night is priced', () => {
  const nights = ['2026-10-13', '2026-10-14'];
  const w = [work('pricing_gap', { nights }, { status: 'waiting' }), ...nights.map(night => pricing(night, { status: 'waiting' }, { phase: 'proposed', decision: 'change', proposedRateMinor: 11000 }))];
  const done = w.slice(1);
  const item = row(L.pricingTrackerItems(done, ctx({ forms: x => [form('recordApplied', 'Record the applied pricing decision')] })), 'p1');
  assert.equal(item.status.label, 'To apply');
  assert.equal(item.closed, false);
  assert.deepEqual(states(item), ['done', 'done', 'current']);
  assert.equal(item.nextStep, 'Record that the new price is live');
  assert.deepEqual(item.nextAction, { label: 'Record the applied pricing decision', actionKey: 'recordApplied' });
  assert.equal(item.source.pending.workId, done[0].workId);
  const applied = row(L.pricingTrackerItems(done.map(x => ({ ...x, status: 'completed', data: { ...x.data, phase: 'applied' } })), ctx()), 'p1');
  assert.equal(applied.status.label, 'Up to date');
  assert.deepEqual(states(applied), ['done', 'done', 'done']);
  assert.deepEqual(applied.progress, { done: 3, total: 3 });
});

test('reviews: counts this period, average, mixed sentiment and replies due', () => {
  const w = [
    review('2026-10-12', { rating: 5, outOf: 5 }), review('2026-10-10', { rating: 8, outOf: 10, sentiment: 'neutral' }),
    review('2026-10-11', { rating: 1, outOf: 5, sentiment: 'negative', relist: true, platform: 'Booking.com' }),
    review('2026-08-01', { rating: 1, outOf: 5, sentiment: 'negative' }),
  ];
  const item = row(L.reviewTrackerItems(w, ctx()), 'p1');
  assert.equal(item.section, 'reviews');
  assert.equal(item.status.label, '1 reply due');
  assert.equal(item.status.tone, 'bad');
  assert.equal(item.closed, false);
  assert.deepEqual(states(item), ['done', 'current', 'done']);
  assert.match(item.nextStep, /Reply to the bad review on Booking\.com/);
  assert.ok(item.details.some(d => d.label === 'Reviews in the last 30 days' && d.value === '3'));
  assert.ok(item.details.some(d => d.label === 'Average' && d.value === '3.3 out of 5 · mixed'));
  assert.ok(item.details.some(d => d.label === 'Good, mixed and bad' && d.value === '1 good, 1 mixed, 1 bad'));
  const handled = row(L.reviewTrackerItems(w.map(x => x.data.sentiment === 'negative' ? { ...x, data: { ...x.data, response: 'Replied publicly' } } : x), ctx()), 'p1');
  assert.equal(handled.closed, true);
  assert.equal(handled.steps[1].state, 'done');
});

test('reviews: a quiet period reads as none, and an old bad review does not stay as a reply due', () => {
  const none = row(L.reviewTrackerItems([], ctx()), 'p2');
  assert.equal(none.status.label, 'None this period');
  assert.deepEqual(states(none), ['current', 'skipped', 'skipped']);
  assert.deepEqual(none.progress, { done: 0, total: 1 });
  assert.equal(none.nextStep, 'Log the next guest review when one arrives');
  const old = row(L.reviewTrackerItems([review('2026-09-30', { sentiment: 'negative', rating: 2 })], ctx()), 'p1');
  assert.equal(old.closed, true);
  assert.deepEqual(old.nextAction, { label: 'Log a review', actionKey: 'guest_review' });
  const good = row(L.reviewTrackerItems([review('2026-10-12')], ctx()), 'p1');
  assert.equal(good.status.label, 'Good');
  assert.equal(good.status.tone, 'good');
});

test('reviews: rows needing a reply come first', () => {
  const w = [review('2026-10-12', { sentiment: 'negative', rating: 1 }, { propertyId: 'p2' }), review('2026-10-12', {}, { propertyId: 'p1' })];
  assert.deepEqual(L.reviewTrackerItems(w, ctx()).map(i => i.propertyId), ['p2', 'p1']);
});

test('re-listing: each phase, with dates and the step the person can take', () => {
  const base = { reason: 'review', platform: 'Airbnb' };
  const toRelist = work('relisting', { ...base, phase: 'to_relist' }, { status: 'waiting', createdAt: '2026-10-11T08:00:00Z', updatedAt: '2026-10-11T08:00:00Z', updatedBy: null, updatedEvent: 'workspace_work_items' });
  const a = L.relistingTrackerItem(toRelist, ctx({ forms: () => [form('startRelisting', 'Start re-listing')] }));
  assert.equal(a.section, 'relisting');
  assert.equal(a.status.label, 'To re-list');
  assert.deepEqual(states(a), ['done', 'current', 'todo']);
  assert.match(a.nextStep, /Start re-listing/);
  assert.deepEqual(a.nextAction, { label: 'Start re-listing', actionKey: 'startRelisting' });
  assert.match(a.steps[0].detail, /Flagged .*11 Oct/);
  assert.equal(a.title, 'Re-list on Airbnb · Bad review');
  assert.equal(a.address, '12 Leith Walk, Edinburgh EH6 5AA');
  const b = L.relistingTrackerItem({ ...toRelist, status: 'in_progress', data: { ...toRelist.data, phase: 'relisting', note: 'New photos and title' } }, ctx());
  assert.equal(b.status.label, 'Under way');
  assert.deepEqual(states(b), ['done', 'done', 'current']);
  assert.equal(b.steps[1].detail, 'New photos and title');
  assert.deepEqual(b.nextAction, { label: 'Waiting for Guest relations' });
  const c = L.relistingTrackerItem({ ...toRelist, status: 'completed', updatedAt: '2026-10-13T08:00:00Z', data: { ...toRelist.data, phase: 'completed' } }, ctx());
  assert.equal(c.status.label, 'Re-listed');
  assert.equal(c.closed, true);
  assert.deepEqual(c.progress, { done: 3, total: 3 });
  assert.match(c.steps[2].detail, /Re-listed .*13 Oct/);
  assert.ok(c.details.some(d => d.label === 'Re-listed on'));
  const x = L.relistingTrackerItem({ ...toRelist, status: 'cancelled' }, ctx());
  assert.equal(x.status.tone, 'bad');
  assert.deepEqual(states(x), ['done', 'skipped', 'skipped']);
});

test('re-listing: open ones first, the longest waiting at the top', () => {
  const mk = (id, phase, status, at) => work('relisting', { phase, reason: 'hidden' }, { workId: id, status, createdAt: at, updatedAt: at, propertyId: 'p1' });
  const list = L.relistingTrackerItems([mk('done', 'completed', 'completed', '2026-10-01T08:00:00Z'), mk('new', 'to_relist', 'waiting', '2026-10-12T08:00:00Z'), mk('old', 'to_relist', 'waiting', '2026-10-05T08:00:00Z'), mk('going', 'relisting', 'in_progress', '2026-10-02T08:00:00Z'), work('purchase', {})], ctx());
  assert.deepEqual(list.map(i => i.id), ['old', 'new', 'going', 'done']);
});

test('search text carries the address, property, status and next step; stays strings only', () => {
  const item = row(L.listingHealthTrackerItems([check('2026-10-10')], ctx()), 'p1');
  for (const word of ['Leith Walk', 'Leith flat', 'Overdue', 'listing health', 'Check the listing']) assert.ok(item.search.includes(word), word);
  const p = row(L.pricingTrackerItems([], ctx({ stays: [] })), 'p1');
  assert.ok(p.search.includes('pricing') && p.search.includes('Leith Walk'));
  for (const i of [...L.listingHealthTrackerItems([], ctx()), ...L.pricingTrackerItems([], ctx()), ...L.reviewTrackerItems([], ctx())]) assert.equal(typeof i.search, 'string');
});

test('parseStayDates reads the schedule answer and ignores unreadable rows', () => {
  const stays = L.parseStayDates({ work: [], stays: [{ propertyId: 'p1', checkIn: '2026-10-14', checkOut: '2026-10-16' }, { propertyId: 'p1', checkIn: 'soon', checkOut: '2026-10-16' }, null, { checkIn: '2026-10-14', checkOut: '2026-10-16' }] });
  assert.deepEqual(stays, [{ propertyId: 'p1', checkIn: '2026-10-14', checkOut: '2026-10-16' }]);
  assert.deepEqual(L.parseStayDates('nope'), []);
});

test('no em dashes in the adapter, the screens or the copy it produces', () => {
  for (const file of ['lib/tracker-listings.ts', 'mobile/src/ListingsTabs.tsx', 'mobile/src/ListingSheets.tsx', 'mobile/src/WorkHistory.tsx']) assert.doesNotMatch(readFileSync(file, 'utf8'), /—/, file);
  const w = [check('2026-10-10', { suspended: true }), pricing('2026-10-14'), review('2026-10-12', { sentiment: 'negative', rating: 1 }), work('relisting', { phase: 'to_relist', reason: 'suspended' }, { status: 'waiting' })];
  const items = [...L.listingHealthTrackerItems(w, ctx()), ...L.pricingTrackerItems(w, ctx()), ...L.reviewTrackerItems(w, ctx()), ...L.relistingTrackerItems(w, ctx())];
  const words = JSON.stringify(items.map(i => ({ ...i, source: undefined })));
  assert.doesNotMatch(words, /—/);
});

test('the screens use the shared tracker and the existing sheets, and the pricing link goes to Client relations', () => {
  const tabs = readFileSync('mobile/src/ListingsTabs.tsx', 'utf8');
  for (const name of ['ListingHealthList', 'PricingList', 'ReviewsList', 'RelistingList']) assert.match(tabs, new RegExp('export const ' + name));
  assert.match(tabs, /TrackerList/);
  assert.match(tabs, /TrackerDetailSheet/);
  assert.match(tabs, /FlagButton/);
  assert.match(tabs, /ListingSheet/);
  assert.match(tabs, /PricingSheet/);
  assert.match(tabs, /ReviewSheet/);
  assert.match(readFileSync('mobile/src/WorkHistory.tsx', 'utf8'), /view: "clients", sub: "pricing"/);
});
