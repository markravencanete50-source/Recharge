import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Guest relations adapters (client asks B3 and B4): direct-booking follow-ups and AirCover claims drawn as
// tracker items. Phases are the ones the database sets for a direct_booking work item
// (supabase/migrations/20261010180000_team_beta_owner_steps.sql: follow_up, quoted, accepted, confirmed,
// declined) and the claim stages are the hub's (to_claim, claimed, paid, declined).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { directBookingTrackerItem, directBookingTrackerItems, parseStays, nightsBetween } = await vite.ssrLoadModule('/lib/tracker-direct-bookings.ts');
const { aircoverTrackerItem, aircoverTrackerItems, parseAircover, claimJourney } = await vite.ssrLoadModule('/lib/tracker-aircover.ts');
const { withFlags } = await vite.ssrLoadModule('/lib/management-flags.ts');

const NOW = new Date('2026-10-13T12:00:00Z');
const PROPERTIES = { p1: { name: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA' }, p2: { name: 'Harbour cottage', address: '' } };
const form = (key, title) => ({ key, title });
const ctx = (over = {}) => ({ property: id => PROPERTIES[id], forms: () => [], now: NOW, owner: false, ...over });
const RES = '6f1f0f1e-6d0e-4c1a-9f4e-0a1b2c3d4e5f';
const SCHEDULE = { stays: [
  { reservationId: RES, propertyId: 'p1', propertyName: 'Leith flat', checkIn: '2026-11-02', checkOut: '2026-11-10', guests: 3, channel: 'airbnb', guestName: 'Maria Lopez' },
  { reservationId: 'bad', propertyId: 'p1', checkIn: 'soon', checkOut: '2026-11-10' },
  'junk',
] };
const work = (phase, over = {}, data = {}) => ({ workId: 'w1', propertyId: 'p1', moduleId: 'direct-bookings', title: 'Follow up eligible direct booking', kind: 'direct_booking', status: 'waiting', version: 2,
  assigneeId: null, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-11T09:30:00Z', updatedBy: 'Morag Reid', updatedEvent: null, data: { reservationId: RES, ...(phase ? { phase } : {}), ...data }, ...over });
const states = item => item.steps.map(s => s.state);
const stays = () => ({ stays: parseStays(SCHEDULE) });

// ---------- direct bookings ----------

test('the stays come out of a schedule answer, and unreadable rows are left out', () => {
  const map = parseStays(SCHEDULE);
  assert.equal(map.size, 1);
  assert.deepEqual(map.get(RES), { reservationId: RES, checkIn: '2026-11-02', checkOut: '2026-11-10', channel: 'airbnb', guestName: 'Maria Lopez' });
  assert.equal(parseStays(null).size, 0);
  assert.equal(parseStays([{ reservationId: 'x', checkIn: '2026-11-01', checkOut: '2026-11-04' }]).get('x').guestName, null);
});

test('nights run from check-in to check-out', () => {
  assert.equal(nightsBetween('2026-11-02', '2026-11-10'), 8);
  assert.equal(nightsBetween('2026-11-02', '2026-11-03'), 1);
  assert.equal(nightsBetween('2026-11-10', '2026-11-02'), null);
  assert.equal(nightsBetween('', '2026-11-02'), null);
  assert.equal(nightsBetween(null, null), null);
});

test('a direct-booking follow-up moves through its four steps by phase', () => {
  const cases = [
    ['follow_up', {}, ['done', 'current', 'todo', 'todo'], 'Follow up', 'wait', 'Contact the guest with the direct-booking offer', 'Guest relations', 1],
    ['quoted', { quoteAmountMinor: 90000 }, ['done', 'done', 'current', 'todo'], 'Offer sent', 'wait', "Record the guest's answer", 'Guest relations', 2],
    ['accepted', { quoteAmountMinor: 90000 }, ['done', 'done', 'done', 'current'], 'Agreed', 'wait', 'Confirm the booking once the invoice is paid', 'Accounts', 3],
  ];
  for (const [phase, data, expected, status, tone, next, waiting, done] of cases) {
    const item = directBookingTrackerItem(work(phase, {}, data), ctx());
    assert.deepEqual(states(item), expected, phase);
    assert.deepEqual(item.status, { label: status, tone }, phase);
    assert.equal(item.nextStep, next, phase);
    assert.deepEqual(item.nextAction, { label: 'Waiting for ' + waiting }, phase);
    assert.deepEqual(item.progress, { done, total: 4 }, phase);
    assert.equal(item.closed, false, phase);
    assert.equal(item.section, 'direct_bookings');
    assert.equal(item.workId, 'w1');
  }
});

test('a follow-up with no phase yet is at the first step', () => {
  const item = directBookingTrackerItem(work(''), ctx());
  assert.deepEqual(states(item), ['done', 'current', 'todo', 'todo']);
});

test('the steps name the form that records them, and the first form this person may use is the next action', () => {
  const item = directBookingTrackerItem(work('follow_up'), ctx({ forms: () => [form('prepareQuote', 'Prepare a direct-booking offer'), form('recordGuestDecline', 'The guest said no')] }));
  assert.deepEqual(item.steps.map(s => s.actionKey), [undefined, 'prepareQuote', 'recordGuestAcceptance', 'confirmBooking']);
  assert.deepEqual(item.nextAction, { label: 'Prepare a direct-booking offer', actionKey: 'prepareQuote' });
});

test('the decline form is never the next action, and an unavailable offer form says why', () => {
  const decline = form('recordGuestDecline', 'The guest said no');
  const gated = { ...form('prepareQuote', 'Prepare a direct-booking offer'), unavailable: 'The discount policy awaits confirmation.' };
  assert.deepEqual(directBookingTrackerItem(work('follow_up'), ctx({ forms: () => [gated, decline] })).nextAction, { label: 'The discount policy awaits confirmation.' });
  assert.deepEqual(directBookingTrackerItem(work('follow_up'), ctx({ forms: () => [decline] })).nextAction, { label: 'Waiting for Guest relations' });
  const quoted = directBookingTrackerItem(work('quoted'), ctx({ forms: () => [decline, form('recordGuestAcceptance', 'Record guest acceptance')] }));
  assert.deepEqual(quoted.nextAction, { label: 'Record guest acceptance', actionKey: 'recordGuestAcceptance' });
  for (const phase of ['follow_up', 'quoted']) {
    const item = directBookingTrackerItem(work(phase), ctx({ forms: () => [decline] }));
    assert.doesNotMatch(item.nextStep + ' ' + item.nextAction.label, /said no|declined/, phase);
  }
});

test('a confirmed booking is complete and closed', () => {
  const item = directBookingTrackerItem(work('confirmed', { status: 'completed' }, { quoteAmountMinor: 90000 }), ctx());
  assert.deepEqual(states(item), ['done', 'done', 'done', 'done']);
  assert.deepEqual(item.progress, { done: 4, total: 4 });
  assert.deepEqual(item.status, { label: 'Booked', tone: 'good' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  assert.equal(item.nextStep, 'Nothing more to do');
  assert.equal(item.steps[3].detail, 'Booking confirmed');
});

test('a declined offer closes with the last step skipped and the guest\'s words kept', () => {
  const item = directBookingTrackerItem(work('declined', { status: 'cancelled' }, { reason: 'Prefers to stay on Airbnb' }), ctx());
  assert.deepEqual(states(item), ['done', 'done', 'done', 'skipped']);
  assert.equal(item.steps[2].label, 'Declined');
  assert.deepEqual(item.progress, { done: 3, total: 3 });
  assert.deepEqual(item.status, { label: 'Declined', tone: 'plain' });
  assert.equal(item.closed, true);
  assert.equal(item.nextAction, null);
  assert.ok(item.details.some(d => d.label === 'What the guest said' && d.value === 'Prefers to stay on Airbnb'));
  assert.equal(item.nextStep, 'Closed, the guest declined the offer');
  assert.equal(item.steps[2].detail, 'The guest declined the offer');
});

test('a follow-up cancelled because the stay changed is closed and not called declined', () => {
  const item = directBookingTrackerItem(work('follow_up', { status: 'cancelled' }), ctx());
  assert.equal(item.closed, true);
  assert.deepEqual(item.status, { label: 'Cancelled', tone: 'bad' });
  assert.deepEqual(states(item), ['done', 'skipped', 'skipped', 'skipped']);
  assert.equal(item.nextStep, 'Cancelled, the stay changed');
  assert.equal(item.nextAction, null);
});

test('the row shows the address, the guest, the dates, the nights and the channel from the stay', () => {
  const item = directBookingTrackerItem(work('follow_up'), ctx(stays()));
  assert.equal(item.address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(item.propertyName, 'Leith flat');
  assert.match(item.title, /^Maria Lopez · .*2 Nov to .*10 Nov · 8 nights$/);
  const detail = Object.fromEntries(item.details.map(d => [d.label, d.value]));
  assert.equal(detail.Guest, 'Maria Lopez');
  assert.equal(detail.Nights, '8');
  assert.equal(detail['Booked through'], 'Airbnb');
  assert.match(detail.Stay, /2 Nov to .*10 Nov/);
  assert.match(item.search, /Maria Lopez/);
  assert.match(item.search, /Airbnb/);
});

test('without the stay loaded the offer\'s own dates are used, then the ticket title', () => {
  const quoted = directBookingTrackerItem(work('quoted', {}, { checkIn: '2026-11-02', checkOut: '2026-11-05', quoteAmountMinor: 80000, baseAmountMinor: 90000 }), ctx());
  assert.match(quoted.title, /^Stay · .*2 Nov to .*5 Nov · 3 nights$/);
  assert.equal(quoted.details.find(d => d.label === 'Direct-booking offer').value, '£800.00');
  assert.equal(quoted.details.find(d => d.label === 'Original price').value, '£900.00');
  assert.equal(quoted.steps[1].detail, 'Offer £800.00');
  const bare = directBookingTrackerItem(work('follow_up'), ctx());
  assert.equal(bare.title, 'Follow up eligible direct booking');
});

test('a property with no address reads by name, and an unknown property says so', () => {
  assert.equal(directBookingTrackerItem(work('follow_up', { propertyId: 'p2' }), ctx()).address, 'Harbour cottage');
  assert.equal(directBookingTrackerItem(work('follow_up', { propertyId: 'zz' }), ctx()).address, 'Unknown property');
});

test('the last update carries the time and the staff name, and a client viewer never gets the name or the guest', () => {
  const staff = directBookingTrackerItem(work('follow_up'), ctx(stays()));
  assert.equal(staff.lastUpdate.by, 'Morag Reid');
  const client = directBookingTrackerItem(work('follow_up'), ctx({ ...stays(), owner: true }));
  assert.equal(client.lastUpdate.by, null);
  assert.ok(!client.details.some(d => d.label === 'Guest'));
  assert.ok(!JSON.stringify(client).includes('Maria Lopez'));
  assert.ok(!JSON.stringify(client).includes('Morag Reid'));
});

test('direct bookings come out in tracker order, ignoring other kinds of work', () => {
  const items = directBookingTrackerItems([
    work('confirmed', { workId: 'done', status: 'completed' }),
    work('quoted', { workId: 'quoted' }, { quoteAmountMinor: 1000 }),
    work('follow_up', { workId: 'fresh' }),
    { ...work('follow_up'), workId: 'other', kind: 'purchase' },
  ], ctx());
  assert.deepEqual(items.map(i => i.id), ['fresh', 'quoted', 'done']);
});

test('an open flag marks the follow-up through its work item', () => {
  const items = directBookingTrackerItems([work('follow_up')], ctx());
  const flag = { id: '11111111-1111-4111-8111-111111111111', source: 'work', workId: 'w1', title: 't', reason: 'r', status: 'open', createdAt: '2026-10-12T10:00:00Z', version: 1 };
  assert.equal(withFlags(items, [flag])[0].flagged, true);
  assert.equal(withFlags(items, [{ ...flag, status: 'resolved' }])[0].flagged, false);
});

// ---------- AirCover ----------

const ITEM = '7a3f0c10-1b2c-4d3e-8f90-a1b2c3d4e5f6', ISSUE = '2b4c6d8e-0a1b-4c2d-9e3f-5a6b7c8d9e0f', PROP = '3c5d7e9f-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const claim = (status, over = {}) => ({
  itemId: ITEM, version: 4, title: 'Water damage to the hall carpet', details: '', reference: 'HMABCD1234', status, amountMinor: 45000, settledMinor: null, outcomeNote: null,
  decidedAt: null, createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-10T11:00:00Z', mine: false, flaggedBy: 'Morag Reid',
  propertyId: PROP, propertyName: 'Leith flat', address: '12 Leith Walk, Edinburgh EH6 5AA', reservationId: null, workId: ISSUE,
  issue: { workId: ISSUE, title: 'Burst pipe in the hall', kind: 'maintenance', status: 'in_progress', phase: 'booked', repairType: 'leak', urgent: true, dueOn: '2026-10-15', version: 3, updatedAt: '2026-10-10T09:00:00Z' }, ...over });
const aircover = (status, over, manage = false) => aircoverTrackerItem(claim(status, over), ctx(), manage);

test('the aircover read gives its claims and whether this person can move them', () => {
  const read = parseAircover({ section: 'aircover', canManage: true, claims: [claim('claimed'), { itemId: 'nope' }] });
  assert.equal(read.canManage, true);
  assert.equal(read.claims.length, 1);
  assert.equal(parseAircover([claim('paid')]).claims.length, 1);
  assert.deepEqual(parseAircover(null), { canManage: false, claims: [] });
  assert.equal(parseAircover({ claims: [claim('to_claim', { issue: null, workId: null })] }).claims[0].issue, null);
});

test('a claim moves through to claim, claimed and paid by its stage', () => {
  const cases = [
    ['to_claim', ['current', 'todo', 'todo'], 'To claim', 'wait', 'Put the claim in to AirCover', { done: 0, total: 3 }],
    ['claimed', ['done', 'current', 'todo'], 'Claimed', 'wait', "Wait for AirCover's decision", { done: 1, total: 3 }],
    ['paid', ['done', 'done', 'done'], 'Paid', 'good', 'Nothing more to do', { done: 3, total: 3 }],
    ['declined', ['done', 'done', 'done'], 'Declined', 'bad', 'Nothing more to do', { done: 3, total: 3 }],
  ];
  for (const [status, expected, label, tone, next, progress] of cases) {
    const item = aircover(status, status === 'paid' ? { settledMinor: 42000, decidedAt: '2026-10-12T09:00:00Z' } : {});
    assert.deepEqual(states(item), expected, status);
    assert.deepEqual(item.status, { label, tone }, status);
    assert.equal(item.nextStep, next, status);
    assert.deepEqual(item.progress, progress, status);
    assert.equal(item.section, 'aircover');
    assert.equal(item.closed, status === 'paid' || status === 'declined', status);
    assert.equal(item.id, ITEM);
  }
  assert.equal(aircover('paid').steps[2].label, 'Paid');
  assert.equal(aircover('declined').steps[2].label, 'Declined');
  assert.equal(aircover('claimed').steps[2].label, 'Paid or declined');
});

test('an open claim waits on Accounts for people who cannot move it, and tells Accounts what to do', () => {
  assert.deepEqual(aircover('to_claim').nextAction, { label: 'Waiting for Accounts' });
  assert.deepEqual(aircover('claimed').nextAction, { label: 'Waiting for Accounts' });
  assert.deepEqual(aircover('to_claim', {}, true).nextAction, { label: 'Mark as claimed' });
  assert.deepEqual(aircover('claimed', {}, true).nextAction, { label: 'Record the outcome' });
  assert.equal(aircover('paid', {}, true).nextAction, null);
});

test('the amount claimed and the amount paid out are kept apart', () => {
  const item = aircover('paid', { settledMinor: 42000, decidedAt: '2026-10-12T09:00:00Z' });
  const detail = Object.fromEntries(item.details.map(d => [d.label, d.value]));
  assert.equal(detail['Amount claimed'], '£450.00');
  assert.equal(detail['Amount paid out'], '£420.00');
  assert.equal(detail['Reservation code'], 'HMABCD1234');
  assert.equal(item.steps[2].detail, 'Paid £420.00');
  assert.equal(item.steps[1].detail, 'Claim for £450.00');
  assert.ok(!aircover('claimed').details.some(d => d.label === 'Amount paid out'));
});

test('the linked issue shows its title, repair type, status and stage', () => {
  const detail = Object.fromEntries(aircover('claimed').details.map(d => [d.label, d.value]));
  assert.equal(detail.Issue, 'Burst pipe in the hall');
  assert.equal(detail['Repair type'], 'Leak');
  assert.equal(detail['Issue status'], 'In progress');
  assert.equal(detail['Issue stage'], 'Repair booked');
  assert.equal(detail.Priority, 'Urgent');
});

test('a claim that is not linked to an issue still opens, and says so', () => {
  const item = aircover('to_claim', { issue: null, workId: null });
  assert.ok(!item.details.some(d => d.label === 'Issue'));
  assert.match(item.details.find(d => d.label === 'Journey').value, /not linked to a maintenance issue/);
});

test('the journey tells the claim\'s story in order', () => {
  const j = status => claimJourney(claim(status, { settledMinor: 42000, decidedAt: '2026-10-12T09:00:00Z', outcomeNote: 'Not covered by the policy' }), { now: NOW, owner: false });
  assert.match(j('to_claim'), /^Flagged on .*9 Oct by Morag Reid\. Not put in to AirCover yet\. The issue, Burst pipe in the hall, is now: repair booked\.$/);
  assert.match(j('claimed'), /Put in to AirCover \(last moved .*12 Oct\)/);
  assert.match(j('paid'), /Paid £420\.00 on .*12 Oct\./);
  assert.match(j('declined'), /Declined on .*12 Oct: Not covered by the policy\./);
  assert.ok(!claimJourney(claim('to_claim'), { now: NOW, owner: true }).includes('Morag Reid'));
});

test('the last update reads as the team, and a client viewer never gets a staff name', () => {
  assert.equal(aircover('to_claim').lastUpdate.by, 'Morag Reid');
  assert.equal(aircover('claimed').lastUpdate.by, 'The team');
  assert.equal(aircover('claimed').lastUpdate.what, 'Marked as claimed');
  const client = aircoverTrackerItem(claim('to_claim'), ctx({ owner: true }));
  assert.equal(client.lastUpdate.by, null);
  assert.ok(!JSON.stringify(client).includes('Morag Reid'));
});

test('the address comes from the claim, then the property list, then the name', () => {
  assert.equal(aircover('to_claim').address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(aircover('to_claim', { address: null, propertyId: 'p1' }).address, '12 Leith Walk, Edinburgh EH6 5AA');
  assert.equal(aircover('to_claim', { address: null, propertyId: null }).address, 'Leith flat');
  assert.equal(aircover('to_claim', { address: null, propertyId: 'p2' }).address, 'Harbour cottage');
  assert.equal(aircover('to_claim', { address: null, propertyId: null, propertyName: null }).address, 'Unknown property');
});

test('claims come out with the open ones first and a flag on the hub item marks the row', () => {
  const read = { canManage: false, claims: [claim('paid', { itemId: '9a3f0c10-1b2c-4d3e-8f90-a1b2c3d4e5f6' }), claim('to_claim')] };
  const items = aircoverTrackerItems(read, ctx());
  assert.deepEqual(items.map(i => i.status.label), ['To claim', 'Paid']);
  const flag = { id: '11111111-1111-4111-8111-111111111111', source: 'hub', hubItemId: ITEM, title: 't', reason: 'r', status: 'open', createdAt: '2026-10-12T10:00:00Z', version: 1 };
  assert.deepEqual(withFlags(items, [flag]).map(i => i.flagged), [true, false]);
});

// ---------- the screens ----------

const source = path => readFileSync(path, 'utf8');
const SCREENS = ['mobile/src/DirectBookings.tsx', 'mobile/src/AirCoverList.tsx'];

test('both screens take SectionProps, draw a tracker list and sheet, flag, and hide from owners', () => {
  for (const path of SCREENS) {
    const text = source(path);
    assert.match(text, /SectionProps/, path);
    assert.match(text, /TrackerList/, path);
    assert.match(text, /TrackerDetailSheet/, path);
    assert.match(text, /FlagButton/, path);
    assert.match(text, /withFlags/, path);
    assert.match(text, /readTeams\(\{ section: "flags" \}\)/, path);
    assert.match(text, /account\.role === "client"/, path);
  }
  assert.match(source('mobile/src/DirectBookings.tsx'), /export function DirectBookings\(/);
  assert.match(source('mobile/src/AirCoverList.tsx'), /export function AirCoverList\(/);
});

test('the AirCover list is an anchored section, reads the aircover section and moves a claim with the hub logic', () => {
  const text = source('mobile/src/AirCoverList.tsx');
  assert.match(text, /<Anchor id="section-aircover">/);
  assert.match(text, /readTeams\(\{ section: "aircover" \}\)/);
  assert.match(text, /action: "moveHubItem"/);
  assert.match(text, /poundsToMinor/);
  assert.match(text, /useRequestId/);
  assert.match(text, /settledMinor/);
  assert.match(text, /canManage/);
  assert.match(text, /hubItemId: claim\.itemId/);
});

test('the direct bookings screen reads the stays for dates and nights and offers the ticket and the flag', () => {
  const text = source('mobile/src/DirectBookings.tsx');
  assert.match(text, /section: "schedule"/);
  assert.match(text, /directBookingTrackerItems/);
  assert.match(text, /workItemForms/);
  assert.match(text, /onOpenWork/);
});

test('listing checks, empty-night pricing and the Monday owner reports sit in Client relations\' routine, not Guest relations\'', () => {
  const card = source('mobile/src/StaysRoutineCard.tsx');
  assert.match(card, /CLIENT_TOOLS: readonly string\[\] = \["listing-health", "daily-pricing", "weekly-performance"\]/);
  assert.match(card, /CLIENT_TOOLS\.includes\(m\) === \(part === "clients"\)/);
  assert.match(source('mobile/src/GuestRelations.tsx'), /<StaysRoutineCard [^>]*part="guests" \/>/);
  assert.match(source('mobile/src/ClientRelations.tsx'), /<StaysRoutineCard [^>]*part="clients" \/>/);
});

test('the record-a-stay sheet shows the nights and the follow-up hint, and its other callers are unchanged', () => {
  const text = source('mobile/src/StaySheet.tsx');
  assert.match(text, /minimumNights = DEFAULT_MINIMUM_NIGHTS/);
  assert.match(text, /direct-booking follow-up/);
  assert.match(text, /export function StaySheet\(/);
  assert.match(source('mobile/src/GuestRelations.tsx'), /<StaySheet p=\{p\} visible=\{recording\} properties=\{properties\}/);
});

test('none of the new files contains an em dash, and the typed files keep their CRLF line endings', () => {
  const typed = ['lib/tracker-direct-bookings.ts', 'lib/tracker-aircover.ts', ...SCREENS, 'mobile/src/StaySheet.tsx'];
  for (const path of [...typed, 'tests/tracker-guest-relations.test.mjs']) assert.ok(!source(path).includes(String.fromCharCode(0x2014)), path + ' has an em dash');
  for (const path of typed) assert.ok(/\r\n/.test(source(path)) && !/[^\r]\n/.test(source(path)), path + ' is not CRLF');
  assert.ok(!source('tests/tracker-guest-relations.test.mjs').includes('\r'));
});
