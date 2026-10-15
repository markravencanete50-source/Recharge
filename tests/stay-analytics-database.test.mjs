import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Guests & stays (migration 20261021600000): the sync keeps each stay's booking detail (and tolerates it missing or odd),
// and workspace_stay_analytics works out the figures for admins and super admins only, read through the app's own schema.
const MIGRATION = 'supabase/migrations/20261021600000_stay_analytics.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const V = await vite.ssrLoadModule('/lib/stay-analytics-view.ts');
const policy = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
await db.exec('update private.workspace_hostaway_sync_state set paused=false where singleton');
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'client', 'accounts', 'cleans'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, ACCOUNTS, CLEANS] = roles.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `stays${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Stays ${i}`]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); });
const sql = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const sync = async input => { await asBackend(); return (await db.query('select public.workspace_hostaway_sync($1) r', [{ trigger: 'schedule', ...input }])).rows[0].r; };

// The fixture lives in a fixed, past month (November 2025) so the dates never depend on today.
const listings = [{ id: '801', name: 'Stay Report Cottage', address: '1 Glen Road, Perth', bedrooms: 2, accessInfo: '' }, { id: '802', name: 'Stay Report Flat', address: '2 High Street, Perth', bedrooms: 1, accessInfo: '' }];
const stay = (id, listingId, checkIn, checkOut, extra = {}) => ({ id, listingId, checkIn, checkOut, status: 'confirmed', channel: 'airbnb', channelReference: 'HM' + id, guests: 2, payoutMinor: 30000, ...extra });
const stored = async id => (await sql(`select adults,children,infants,pets,guest_country,booked_at,arrival_time::text arrival,departure_time::text departure,version
  from private.workspace_reservations where reference=$1`, ['HA:' + id]))[0];

test('the sync keeps the booking detail Hostaway sends, as the app maps it', async () => {
  // Through the real mapping: a Hostaway record in, the stored columns out.
  const mapped = policy.syncReservation({ id: 8101, listingMapId: 801, channelName: 'airbnbOfficial', channelReservationId: 'HM8101', status: 'new', arrivalDate: '2025-11-07', departureDate: '2025-11-10',
    numberOfGuests: 4, adults: 2, children: 1, infants: 1, pets: 1, guestCountry: 'de', reservationDate: '2025-10-08 10:00:00', checkInTime: 15, checkOutTime: 11, currency: 'GBP', totalPrice: 400 });
  const summary = await sync({ listings, reservations: [mapped] });
  assert.deepEqual(summary.problems, []);
  const row = await stored('8101');
  assert.deepEqual([row.adults, row.children, row.infants, row.pets, row.guest_country, row.arrival, row.departure], [2, 1, 1, 1, 'DE', '15:00:00', '11:00:00']);
  assert.equal(new Date(row.booked_at).toISOString(), '2025-10-08T10:00:00.000Z');

  // A later sync that no longer sends a field keeps it; details alone never change the stay's version.
  await sync({ listings, reservations: [{ ...mapped, stayDetails: { ...mapped.stayDetails, pets: null, guestCountry: null, children: 2 } }] });
  const again = await stored('8101');
  assert.deepEqual([again.children, again.pets, again.guest_country], [2, 1, 'DE'], 'a blank never wipes; a new value replaces');
  assert.equal(again.version, row.version, 'a detail alone is not a change to the stay');
});

test('a missing or odd detail never fails the sync and is never stored', async () => {
  const odd = { adults: 2.5, children: -1, infants: '1', pets: 99, guestCountry: '12 Main Street, Leeds', bookedAt: '2025-02-30T10:00:00Z', arrivalTime: '25:00', departureTime: 11, surprise: 'x' };
  const summary = await sync({ listings, reservations: [stay('8201', '801', '2025-11-12', '2025-11-14'), stay('8202', '801', '2025-11-20', '2025-11-21', { stayDetails: odd }),
    stay('8203', '802', '2025-11-03', '2025-11-05', { stayDetails: 'nonsense' }), stay('8204', '802', '2025-11-22', '2025-11-23', { stayDetails: { bookedAt: '2099-01-01T00:00:00Z' } })] });
  assert.deepEqual(summary.problems, [], 'nothing about the details is a problem');
  assert.equal(summary.newReservations, 4, 'every stay is still recorded');
  for (const id of ['8201', '8202', '8203', '8204']) {
    const row = await stored(id);
    assert.deepEqual([row.adults, row.children, row.infants, row.pets, row.guest_country, row.booked_at, row.arrival, row.departure], [null, null, null, null, null, null, null, null], id);
  }
  await assert.rejects(sql("update private.workspace_reservations set pets=51 where reference='HA:8201'"), /stay_details_valid/);
});

test('Guests & stays: the figures for a small month', async () => {
  // November 2025 at the cottage (801) and the flat (802), on top of the stays above:
  // 8101 cottage 7-10 Nov, 3 nights, Fri, 4 guests (2 adults, 2 children after the second sync, 1 infant, 1 pet), DE, booked 30 days ahead.
  // 8201 cottage 12-14 Nov, 2 nights, Wed, 2 guests, nothing else known.  8202 cottage 20-21 Nov, 1 night, Thu.
  // 8203 flat 3-5 Nov, 2 nights, Mon.  8204 flat 22-23 Nov, 1 night, Sat.
  const details = (adults, children, pets, country, bookedAt) => ({ adults, children, infants: 0, pets, guestCountry: country, bookedAt });
  await sync({ listings, reservations: [
    stay('8301', '802', '2025-11-24', '2025-12-08', { guests: 3, channel: 'booking_com', stayDetails: details(2, 1, 0, 'GB', '2025-11-20T09:00:00Z') }), // 14 nights, Mon, 4 days ahead
    stay('8302', '801', '2025-10-30', '2025-11-02', { guests: null, channel: 'direct', stayDetails: details(1, 0, 0, 'GB', '2025-05-01T09:00:00Z') }), // overlaps from October, Thu, 182 days
    stay('8303', '801', '2025-11-15', '2025-11-17', { status: 'cancelled' }),
    stay('8304', '801', '2025-11-17', '2025-11-19', { status: 'enquiry' }),
    stay('8305', '802', '2025-11-10', '2025-11-12', { channel: 'other', channelReference: 'Owner stay' }),
    stay('8306', '801', '2025-10-20', '2025-10-25', { stayDetails: details(2, 0, 0, 'FR', null) }), // October only
  ] });
  await as(ADMIN);
  const read = async (from, to, property = null, channel = null) => {
    const parsed = teamsReadSchema.parse({ section: 'stayAnalytics', from, to, ...(property ? { propertyId: property } : {}), ...(channel ? { channel } : {}) });
    return V.stayAnalyticsSchema.parse((await db.query('select public.workspace_stay_analytics($1,$2,$3,$4) r', [parsed.from, parsed.to, parsed.propertyId ?? null, parsed.channel ?? null])).rows[0].r);
  };
  const r = await read('2025-11-01', '2025-11-30');
  // 8101, 8201, 8202, 8203, 8204, 8301, 8302. Not the cancelled stay, the enquiry, the owner stay or October's.
  assert.equal(r.stays, 7);
  assert.equal(r.nights, 3 + 2 + 1 + 2 + 1 + 14 + 3);
  assert.equal(r.averageNights, 3.7);
  assert.deepEqual(r.guests, { known: 6, total: 4 + 2 + 2 + 2 + 2 + 3, average: 2.5 }, 'a stay with no guest count is left out of the average');
  assert.deepEqual(r.mix.adults, { known: 3, total: 5, stays: 3 });
  assert.deepEqual(r.mix.children, { known: 3, total: 3, stays: 2 });
  assert.deepEqual(r.mix.infants, { known: 3, total: 1, stays: 1 });
  assert.deepEqual(r.mix.pets, { known: 3, total: 1, stays: 1 });
  assert.deepEqual(r.lengths.map(b => [b.bucket, b.stays]), [['1', 2], ['2-3', 4], ['4-6', 0], ['7-13', 0], ['14+', 1]]);
  assert.deepEqual(r.arrivalDays.map(d => d.stays), [2, 0, 1, 2, 1, 1, 0], 'Monday first');
  assert.deepEqual(r.leadTime, { known: 3, averageDays: 72, buckets: [{ bucket: '0-6', stays: 1 }, { bucket: '7-29', stays: 0 }, { bucket: '30-89', stays: 1 }, { bucket: '90-179', stays: 0 }, { bucket: '180+', stays: 1 }] });
  assert.deepEqual(r.channels, [{ channel: 'airbnb', stays: 5 }, { channel: 'booking_com', stays: 1 }, { channel: 'direct', stays: 1 }]);
  assert.deepEqual(r.countries, { known: 3, others: 0, top: [{ country: 'GB', stays: 2 }, { country: 'DE', stays: 1 }] });
  assert.deepEqual(r.byMonth.map(m => [m.month, m.stays, m.guestsKnown, m.averageGuests]), [['2025-11', 7, 6, 2.5]]);
  const cottage = r.byProperty.find(x => x.propertyName === 'Stay Report Cottage'), flat = r.byProperty.find(x => x.propertyName === 'Stay Report Flat');
  assert.deepEqual([cottage.stays, cottage.nights, cottage.guestsKnown, cottage.averageGuests, cottage.leadKnown, cottage.averageLeadDays, cottage.childrenKnown, cottage.childrenStays, cottage.petsStays],
    [4, 9, 3, 2.7, 2, 106, 2, 1, 1]);
  assert.deepEqual([flat.stays, flat.nights, flat.averageGuests, flat.averageLeadDays], [3, 17, 2.3, 4]);
  assert.equal(V.notKnownLine(r.guests.known, r.stays), 'Not known for 14% of stays');
  assert.equal(V.notKnownLine(r.leadTime.known, r.stays), 'Not known for 57% of stays');
  assert.doesNotMatch(JSON.stringify(r), /HM8|HA:|Owner stay/, 'no booking references or stay ids');

  // Two months: a stay across both is counted in each.
  const two = await read('2025-10-01', '2025-11-30');
  assert.equal(two.stays, 8);
  assert.deepEqual(two.byMonth.map(m => [m.month, m.stays]), [['2025-10', 2], ['2025-11', 7]]);
  // One home, one channel.
  const [{ id: flatId }] = await sql("select id from public.workspace_properties where hostaway_listing_id='802'");
  await as(ADMIN);
  assert.equal((await read('2025-11-01', '2025-11-30', flatId)).stays, 3);
  const booking = await read('2025-11-01', '2025-11-30', null, 'booking_com');
  assert.deepEqual([booking.stays, booking.channel, booking.byProperty.length], [1, 'booking_com', 1]);
  assert.equal((await read('2025-12-01', '2025-12-31', null, 'direct')).stays, 0);
  const empty = await read('2024-01-01', '2024-01-31');
  assert.deepEqual([empty.stays, empty.guests.average, empty.averageNights, empty.byProperty, empty.channels], [0, null, null, [], []]);
});

test('only admins and super admins can read it, with sound dates and channels', async () => {
  for (const who of [SUPER, ADMIN]) {
    await as(who);
    assert.equal((await db.query("select public.workspace_stay_analytics('2025-11-01','2025-11-30') r")).rows[0].r.stays, 7);
  }
  for (const who of [STAYS, OWNER, ACCOUNTS, CLEANS]) {
    await as(who);
    await assert.rejects(db.query("select public.workspace_stay_analytics('2025-11-01','2025-11-30') r"), /Management access required/, roles[who]);
  }
  await as(ADMIN);
  await assert.rejects(db.query("select public.workspace_stay_analytics('2025-01-01','2026-01-02') r"), /Choose up to 366 days/);
  await assert.rejects(db.query("select public.workspace_stay_analytics('2025-11-30','2025-11-01') r"), /Choose up to 366 days/);
  await assert.rejects(db.query("select public.workspace_stay_analytics('2025-11-01','2025-11-30',null,'expedia') r"), /Unknown channel/);
  // Signed out and the backend's pieces: nothing.
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query("select public.workspace_stay_analytics('2025-11-01','2025-11-30') r"), /permission denied/);
  await as(ADMIN);
  await assert.rejects(db.query("select private.workspace_store_stay_details(gen_random_uuid(),'{}'::jsonb)"), /permission denied/);
  await assert.rejects(db.query("select private.workspace_stay_details('{}'::jsonb)"), /permission denied/);
});

test('the migration runs twice, patches the sync once and has no DROP or DELETE', async () => {
  const text = await fs.readFile(MIGRATION, 'utf8');
  await db.exec('reset role'); await db.exec(text); await db.exec(text);
  const [{ def }] = await sql("select pg_get_functiondef('private.workspace_hostaway_sync(jsonb)'::regprocedure) def");
  assert.equal(def.split('workspace_store_stay_details').length - 1, 1, 'the patch is applied once');
  assert.equal(def.split('touched:=touched||res.property_id;').length - 1, 1, 'the anchor is still there exactly once for later patches');
  assert.doesNotMatch(text.replace(/^--.*$/gm, ''), /\b(drop|delete)\b/i);
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'CRLF line endings');
  // Still syncs after running twice.
  assert.deepEqual((await sync({ listings, reservations: [stay('8101', '801', '2025-11-07', '2025-11-10', { guests: 4, stayDetails: { pets: 0 } })] })).problems, []);
  assert.equal((await stored('8101')).pets, 0, 'no pets is a value too');
});
