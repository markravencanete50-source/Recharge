import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The Hostaway mapping, the webhook and the full sync, with Hostaway and the database mocked.
const state = { env: {}, calls: [], fetched: [], fail: null, rpc: {}, conversations: [], conversation: null, messages: {}, failOn: null };
globalThis.__hostawaySync = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__hostawaySync.env;`,
  'auth-security': `const s=globalThis.__hostawaySync;export const securityRpc=async(name,args)=>{s.calls.push({name,args});return s.rpc[name]??{createdProperties:0,linkedProperties:0,newReservations:1,changedReservations:0,newCleans:1,movedCleans:0,cancelledCleans:0,problems:[]};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});`,
  'hostaway': `const s=globalThis.__hostawaySync;const go=(what,value)=>{s.fetched.push(what);if(s.fail)throw s.fail;return value;};
    export const isHostawayConfigured=()=>Boolean(s.env.HOSTAWAY_ACCOUNT_ID&&s.env.HOSTAWAY_API_KEY);
    export const hostawaySyncErrorMessage=()=>'Hostaway could not be reached. The next sync will try again.';
    export const fetchHostawayListings=async()=>go('listings',[{id:501,name:'Harbour View Flat',city:'Bristol'}]);
    export const fetchHostawayReservations=async(from)=>go('reservations:'+from,[s.reservation]);
    export const fetchHostawayReservation=async(id)=>go('reservation:'+id,s.reservation);
    export const fetchHostawayListing=async(id)=>go('listing:'+id,{id:Number(id),name:'Harbour View Flat'});
    export const fetchHostawayConversations=async(pages)=>go('conversations:'+pages,s.conversations);
    export const fetchHostawayConversation=async(id)=>go('conversation:'+id,s.conversation);
    export const fetchHostawayConversationMessages=async(id)=>{if(s.failOn===id){s.fetched.push('messages:'+id);throw new Error('rate limited');}return go('messages:'+id,s.messages[id]??[]);};`,
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-hostaway-sync', enforce: 'pre',
  transform(code, id) {
    if (!/\/hostaway-sync\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === 'cloudflare:workers' ? name : './' + name}'`, `from 'hostaway-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('hostaway-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0hostaway-test:') ? mocks[id.slice(15)] : null,
}] });
const policy = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const { hostawayWebhookRoute, runHostawaySync, runHostawayMessages } = await vite.ssrLoadModule('/lib/hostaway-sync.ts');
after(async () => { delete globalThis.__hostawaySync; await vite.close(); });

const airbnb = { id: 7001, listingMapId: 501, channelName: 'airbnbOfficial', channelReservationId: 'HMABC123', status: 'new', arrivalDate: '2026-11-02', departureDate: '2026-11-05',
  numberOfGuests: 3, currency: 'GBP', totalPrice: 480, airbnbExpectedPayoutAmount: 412.5, channelCommissionAmount: 67.5 };
function reset(env = { HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true', HOSTAWAY_WEBHOOK_SECRET: 'a'.repeat(32) }) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { calls: [], fetched: [], fail: null, failOn: null, rpc: {}, conversations: [], conversation: null, messages: {}, reservation: { ...airbnb } });
}
const hook = (body, auth = 'recharge:' + 'a'.repeat(32)) => new Request('https://backend.example/api/hostaway/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth === null ? {} : { Authorization: 'Basic ' + btoa(auth) }) }, body: JSON.stringify(body) });

test('reservations map to the platform, confirmation code, guests and platform payout', () => {
  assert.deepEqual(policy.syncReservation(airbnb), { id: '7001', listingId: '501', checkIn: '2026-11-02', checkOut: '2026-11-05', status: 'confirmed',
    channel: 'airbnb', channelReference: 'HMABC123', guests: 3, payoutMinor: 41250,
    payoutBreakdown: { source: 'airbnb', grossMinor: 48000, commissionMinor: 6750, guestFeeMinor: null, paymentChargeMinor: null, commissionVatMinor: null, cleaningFeeMinor: null, cityTaxMinor: null },
    stayDetails: { adults: null, children: null, infants: null, pets: null, guestCountry: null, bookedAt: null, arrivalTime: null, departureTime: null } });
  // Booking.com: the guest total less the platform's commission.
  const booking = policy.syncReservation({ ...airbnb, channelName: 'bookingcom', channelReservationId: '4455667788', airbnbExpectedPayoutAmount: null, totalPrice: 300, channelCommissionAmount: 45, hostChannelFee: 0 });
  assert.equal(booking.channel, 'booking_com'); assert.equal(booking.payoutMinor, 25500); assert.equal(booking.channelReference, '4455667788');
  assert.equal(policy.syncReservation({ ...airbnb, channelName: 'homeaway' }).channel, 'vrbo');
  assert.equal(policy.syncReservation({ ...airbnb, channelName: 'bookingengine' }).channel, 'direct');
  assert.equal(policy.syncReservation({ ...airbnb, channelName: 'expedia' }).channel, 'other');
  assert.equal(policy.syncReservation({ ...airbnb, currency: 'EUR' }).payoutMinor, null, 'not in pounds: Accounts fills it in');
  assert.equal(policy.syncReservation({ ...airbnb, status: 'cancelled' }).status, 'cancelled');
  assert.equal(policy.syncReservation({ ...airbnb, status: 'inquiryPreapproved' }).status, 'enquiry');
  assert.equal(policy.syncReservation({ ...airbnb, status: 'somethingNew' }), null, 'unknown states never touch the calendar');
  assert.equal(policy.syncReservation({ ...airbnb, departureDate: '2026-11-02' }), null);
  const owner = policy.syncReservation({ ...airbnb, status: 'ownerStay', numberOfGuests: undefined, adults: 2, children: 1 });
  assert.deepEqual([owner.status, owner.channel, owner.payoutMinor, owner.channelReference, owner.guests], ['confirmed', 'other', 0, 'Owner stay', 3]);
});

// Guests & stays (20261021600000): the booking detail Hostaway sends, read as policy.HOSTAWAY_STAY_FIELDS names it.
test('stay details: guest mix, country, when they booked and planned times; anything missing or odd stays null', () => {
  const full = policy.syncReservation({ ...airbnb, adults: 2, children: '1', infants: 0, pets: 1, guestCountry: ' gb ', reservationDate: '2026-09-20 18:45:10',
    checkInTime: 16, checkOutTime: '10:30', guestName: 'Alex Kim', guestEmail: 'alex@example.com', phone: '+44 7700 900123', guestAddress: '1 Road', guestCity: 'Leeds', guestZipCode: 'LS1' });
  assert.deepEqual(full.stayDetails, { adults: 2, children: 1, infants: 0, pets: 1, guestCountry: 'GB', bookedAt: '2026-09-20T18:45:10Z', arrivalTime: '16:00', departureTime: '10:30' });
  assert.doesNotMatch(JSON.stringify(full), /Alex Kim|example\.com|7700|Leeds|LS1|1 Road/, 'never a name, email, phone or address');
  const named = policy.syncReservation({ ...airbnb, numberOfAdults: 3, numberOfChildren: 2, numberOfInfants: 1, guestCountry: 'United Kingdom', insertedOn: '2026-08-01T09:00:00+01:00' }).stayDetails;
  assert.deepEqual([named.adults, named.children, named.infants, named.guestCountry, named.bookedAt], [3, 2, 1, 'United Kingdom', '2026-08-01T08:00:00Z'], 'the other names, and insertedOn when there is no reservationDate');
  const odd = policy.syncReservation({ ...airbnb, adults: -1, children: 2.5, infants: 99, pets: 'two', guestCountry: '12 Main St', reservationDate: 'yesterday', checkInTime: 25, checkOutTime: '9:75' }).stayDetails;
  assert.deepEqual(odd, { adults: null, children: null, infants: null, pets: null, guestCountry: null, bookedAt: null, arrivalTime: null, departureTime: null });
  assert.equal(policy.syncReservation({ ...airbnb, status: 'ownerStay', adults: 2, guestCountry: 'GB' }).stayDetails, null, 'owner stays send no details');
  assert.deepEqual(Object.keys(policy.HOSTAWAY_STAY_FIELDS), ['adults', 'children', 'infants', 'pets', 'guestCountry', 'bookedAt', 'arrivalTime', 'departureTime']);
});

test('a stay keeps the full Airbnb reference: one booking can sit under two Airbnb accounts', () => {
  const ref = id => policy.syncReservation({ ...airbnb, channelReservationId: id }).channelReference;
  assert.equal(ref('579754-guest-40852018-confirmation-HM8T9KM2YD'), '579754-guest-40852018-confirmation-HM8T9KM2YD');
  assert.notEqual(ref('579754-guest-40852018-confirmation-HM8T9KM2YD'), ref('507365-guest-40852018-confirmation-HM8T9KM2YD'));
});

test('listings map to a name, address, bedrooms and access notes', () => {
  assert.deepEqual(policy.syncListing({ id: 501, internalListingName: 'Harbour View Flat', name: 'Lovely flat by the harbour', address: '1 Quay Street', city: 'Bristol', zipcode: 'BS1 4SB',
    bedroomsNumber: 2, doorSecurityCode: '4821', checkInInstructions: 'Key safe left of the door' }),
    { id: '501', name: 'Harbour View Flat', address: '1 Quay Street, Bristol, BS1 4SB', bedrooms: 2, accessInfo: 'Door code: 4821\nKey safe left of the door' });
  assert.equal(policy.syncListing({ name: 'No id' }), null);
  assert.equal(policy.syncListing({ id: 1, address: '1 Quay Street, Bristol', city: 'Bristol' }).address, '1 Quay Street, Bristol');
});

test('the webhook needs its password, ignores other events, and re-fetches the reservation', async () => {
  reset({ HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true' });
  assert.equal((await hostawayWebhookRoute(hook({ object: 'reservation', data: { id: 7001 } }))).status, 503, 'not set up yet');
  // Switched off (the default): acknowledged so Hostaway stops retrying, and nothing changes.
  reset({ HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_WEBHOOK_SECRET: 'a'.repeat(32) });
  assert.deepEqual(await (await hostawayWebhookRoute(hook({ object: 'reservation', data: { id: 7001 } }))).json(), { ok: true, ignored: true });
  assert.deepEqual([state.fetched, state.calls], [[], []]);
  reset();
  for (const auth of [null, 'recharge:wrong', 'someone:' + 'a'.repeat(32)]) assert.equal((await hostawayWebhookRoute(hook({ object: 'reservation', data: { id: 7001 } }, auth))).status, 401);
  assert.deepEqual(state.fetched, []);
  assert.deepEqual(await (await hostawayWebhookRoute(hook({ object: 'conversationMessage', event: 'message.received', data: { id: 9 } }))).json(), { ok: true, ignored: true });

  // The body says checkout on the 9th; Hostaway itself says the 5th. Hostaway wins.
  const response = await hostawayWebhookRoute(hook({ object: 'reservation', event: 'reservation.updated', data: { id: 7001, departureDate: '2026-11-09' } }));
  assert.deepEqual(await response.json(), { ok: true, synced: true });
  assert.deepEqual(state.fetched, ['reservation:7001', 'listing:501']);
  const [call] = state.calls;
  assert.equal(call.name, 'workspace_hostaway_sync');
  assert.equal(call.args.input.trigger, 'webhook');
  assert.equal(call.args.input.reservations[0].checkOut, '2026-11-05');
  assert.equal(call.args.input.listings[0].id, '501');

  reset(); state.fail = new Error('down');
  assert.equal((await hostawayWebhookRoute(hook({ object: 'reservation', data: { id: 7001 } }))).status, 503);
  assert.deepEqual(state.calls.map(c => [c.name, c.args.input.trigger, c.args.input.error]), [['workspace_hostaway_sync_failed', 'webhook', 'Hostaway could not be reached. The next sync will try again.']]);
});

test('the webhook also accepts the password as the key in its address', async () => {
  reset();
  const at = (key, auth = null) => hostawayWebhookRoute(new Request('https://backend.example/api/hostaway/webhook' + (key === null ? '' : '?key=' + encodeURIComponent(key)), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Basic ' + btoa(auth) } : {}) }, body: JSON.stringify({ object: 'reservation', event: 'reservation.created', data: { id: 7001 } }) }));
  for (const key of ['wrong', '', 'a'.repeat(31)]) assert.equal((await at(key)).status, 401, key);
  // A wrong key is refused even alongside the right Basic password.
  assert.equal((await at('wrong', 'recharge:' + 'a'.repeat(32))).status, 401);
  assert.deepEqual(state.fetched, []);
  assert.deepEqual(await (await at('a'.repeat(32))).json(), { ok: true, synced: true });
  assert.deepEqual(state.fetched, ['reservation:7001', 'listing:501']);
  assert.equal(state.calls[0].args.input.trigger, 'webhook');
});

test('the full sync sends every listing and every stay from 30 days back', async () => {
  reset();
  const summary = await runHostawaySync('schedule');
  assert.equal(summary.newCleans, 1);
  assert.equal(state.fetched[0], 'listings');
  const from = state.fetched[1].split(':')[1];
  const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() - 30 * 86_400_000));
  assert.equal(from, expected);
  const { input } = state.calls[0].args;
  assert.equal(input.trigger, 'schedule');
  assert.deepEqual(input.listings, [{ id: '501', name: 'Harbour View Flat', address: 'Bristol', bedrooms: 0, accessInfo: '' }]);
  assert.equal(input.reservations[0].payoutMinor, 41250);

  reset(); state.fail = new Error('down');
  await assert.rejects(runHostawaySync('manual'));
  assert.equal(state.calls[0].name, 'workspace_hostaway_sync_failed');
});

// Hostaway's "YYYY-MM-DD HH:MM:SS" (UTC), a number of minutes ago.
const hostawayTime = minutes => new Date(Date.now() - minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
const talk = (id, minutes, extra = {}) => ({ id, listingMapId: 501, reservationId: 7001, recipientName: 'Alex Kim', messageReceivedOn: hostawayTime(minutes), messageSentOn: null,
  Reservation: { channelName: 'airbnbOfficial' }, ...extra });
const said = (id, incoming, minutes, body = 'Hello') => ({ id, body, isIncoming: incoming ? 1 : 0, status: incoming ? 'received' : 'sent', date: hostawayTime(minutes) });

test('a message webhook fetches that conversation fresh and never trusts the body', async () => {
  reset();
  state.conversation = talk(41, 3);
  state.messages['41'] = [said(5001, true, 3, 'Is early check-in possible?'), said(5002, false, 2, 'Scheduled'), { ...said(5003, false, 1), status: 'scheduled' }];
  const forged = { object: 'conversationMessage', event: 'message.received', data: { id: 5001, conversationId: 41, body: 'forged', listingMapId: 999, guestName: 'Mallory' } };
  for (const auth of [null, 'recharge:wrong']) assert.equal((await hostawayWebhookRoute(hook(forged, auth))).status, 401);
  assert.deepEqual([state.fetched, state.calls], [[], []]);
  assert.deepEqual(await (await hostawayWebhookRoute(hook(forged))).json(), { ok: true, synced: true });
  assert.deepEqual(state.fetched, ['conversation:41', 'messages:41']);
  const [call] = state.calls;
  assert.equal(call.name, 'workspace_hostaway_messages_ingest');
  const [sent] = call.args.input.conversations;
  assert.deepEqual([sent.id, sent.listingId, sent.reservationId, sent.guestName, sent.channel], ['41', '501', '7001', 'Alex Kim', 'airbnb']);
  assert.deepEqual(sent.messages.map(m => [m.id, m.incoming, m.body]), [['5001', true, 'Is early check-in possible?'], ['5002', false, 'Scheduled']]);

  // A reservation event still takes the reservation path.
  reset();
  await hostawayWebhookRoute(hook({ object: 'reservation', event: 'reservation.updated', data: { id: 7001 } }));
  assert.deepEqual(state.fetched, ['reservation:7001', 'listing:501']);
  // A message event without its conversation, or a listing event, is acknowledged and ignored.
  reset();
  for (const body of [{ object: 'conversationMessage', event: 'message.received', data: { id: 5001 } }, { object: 'listing', event: 'listing.updated', data: { id: 501 } }]) {
    assert.deepEqual(await (await hostawayWebhookRoute(hook(body))).json(), { ok: true, ignored: true });
  }
  assert.deepEqual([state.fetched, state.calls], [[], []]);
  // Switched off: acknowledged, nothing fetched.
  reset({ HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_WEBHOOK_SECRET: 'a'.repeat(32) });
  assert.deepEqual(await (await hostawayWebhookRoute(hook(forged))).json(), { ok: true, ignored: true });
  assert.deepEqual([state.fetched, state.calls], [[], []]);
  // Hostaway or the database failing: refused so Hostaway retries; the reservation sync's error is untouched.
  reset(); state.fail = new Error('down');
  assert.equal((await hostawayWebhookRoute(hook(forged))).status, 503);
  assert.deepEqual(state.calls, []);
});

test('the minute run fetches only changed conversations, newest first, 25 at most', async () => {
  reset();
  // 30 conversations in an unsorted list, one quiet for a month.
  state.conversations = [...Array.from({ length: 30 }, (_, i) => talk(100 + i, 10 + i)).reverse(), talk(999, 40 * 1440), { listingMapId: 5 }];
  for (const c of state.conversations) if (c.id) state.messages[String(c.id)] = [said(c.id * 10, true, 5)];
  state.rpc.workspace_hostaway_conversations_due = { due: state.conversations.map(c => String(c.id)).filter(id => id !== 'undefined'), paused: false };
  state.rpc.workspace_hostaway_messages_ingest = { added: 25, conversations: 25 };
  const summary = await runHostawayMessages('schedule');
  assert.deepEqual(summary, { added: 25, conversations: 25 });
  const [due, ingest] = state.calls;
  assert.equal(due.name, 'workspace_hostaway_conversations_due');
  assert.equal(due.args.input.conversations.length, 30, 'the quiet one and the unreadable one are never asked about');
  assert.deepEqual(due.args.input.conversations[0], { id: '100', marker: state.conversations.find(c => c.id === 100).messageReceivedOn + '|' }, 'newest first, marker as Hostaway gave it');
  assert.deepEqual(state.fetched.slice(0, 2), ['conversations:1', 'messages:100']);
  assert.equal(state.fetched.length, 1 + 25, 'one list request, then 25 conversations');
  assert.deepEqual(ingest.args.input.conversations.map(c => c.id).slice(0, 3), ['100', '101', '102']);
  assert.equal(ingest.args.input.conversations.length, 25);

  // Only what the database says changed is fetched.
  reset();
  state.conversations = [talk(1, 5), talk(2, 6)];
  state.messages['2'] = [said(21, false, 6)];
  state.rpc.workspace_hostaway_conversations_due = { due: ['2'], paused: false };
  await runHostawayMessages('schedule');
  assert.deepEqual(state.fetched, ['conversations:1', 'messages:2']);
  assert.deepEqual(state.calls[1].args.input.conversations.map(c => c.id), ['2']);

  // Nothing changed: no ingest. Paused: nothing fetched beyond the list.
  for (const answer of [{ due: [], paused: false }, { due: ['1'], paused: true }]) {
    reset(); state.conversations = [talk(1, 5)]; state.rpc.workspace_hostaway_conversations_due = answer;
    assert.deepEqual(await runHostawayMessages('schedule'), { added: 0, conversations: 0 });
    assert.deepEqual(state.calls.map(c => c.name), ['workspace_hostaway_conversations_due']);
    assert.deepEqual(state.fetched, ['conversations:1']);
  }
});

test('the minute run keeps what it fetched before a failure, then fails so the next run retries', async () => {
  reset();
  state.conversations = [talk(1, 5), talk(2, 6), talk(3, 7)];
  state.messages = { 1: [said(11, true, 5)], 3: [said(31, true, 7)] };
  state.failOn = '2';
  state.rpc.workspace_hostaway_conversations_due = { due: ['1', '2', '3'], paused: false };
  await assert.rejects(runHostawayMessages('schedule'), /rate limited/);
  assert.deepEqual(state.fetched, ['conversations:1', 'messages:1', 'messages:2']);
  assert.deepEqual(state.calls.map(c => c.name), ['workspace_hostaway_conversations_due', 'workspace_hostaway_messages_ingest']);
  assert.deepEqual(state.calls[1].args.input.conversations.map(c => c.id), ['1']);
  assert.ok(!state.calls.some(c => c.name === 'workspace_hostaway_sync_failed'), 'the reservation sync\'s last error is left alone');

  // Switched off: nothing at all.
  reset({ HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k' });
  assert.equal(await runHostawayMessages('schedule'), null);
  assert.deepEqual([state.fetched, state.calls], [[], []]);
});
