import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The Hostaway mapping, the webhook and the full sync, with Hostaway and the database mocked.
const state = { env: {}, calls: [], fetched: [], fail: null };
globalThis.__hostawaySync = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__hostawaySync.env;`,
  'auth-security': `const s=globalThis.__hostawaySync;export const securityRpc=async(name,args)=>{s.calls.push({name,args});return {createdProperties:0,linkedProperties:0,newReservations:1,changedReservations:0,newCleans:1,movedCleans:0,cancelledCleans:0,problems:[]};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});`,
  'hostaway': `const s=globalThis.__hostawaySync;const go=(what,value)=>{s.fetched.push(what);if(s.fail)throw s.fail;return value;};
    export const isHostawayConfigured=()=>Boolean(s.env.HOSTAWAY_ACCOUNT_ID&&s.env.HOSTAWAY_API_KEY);
    export const hostawaySyncErrorMessage=()=>'Hostaway could not be reached. The next sync will try again.';
    export const fetchHostawayListings=async()=>go('listings',[{id:501,name:'Harbour View Flat',city:'Bristol'}]);
    export const fetchHostawayReservations=async(from)=>go('reservations:'+from,[s.reservation]);
    export const fetchHostawayReservation=async(id)=>go('reservation:'+id,s.reservation);
    export const fetchHostawayListing=async(id)=>go('listing:'+id,{id:Number(id),name:'Harbour View Flat'});`,
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
const { hostawayWebhookRoute, runHostawaySync } = await vite.ssrLoadModule('/lib/hostaway-sync.ts');
after(async () => { delete globalThis.__hostawaySync; await vite.close(); });

const airbnb = { id: 7001, listingMapId: 501, channelName: 'airbnbOfficial', channelReservationId: 'HMABC123', status: 'new', arrivalDate: '2026-11-02', departureDate: '2026-11-05',
  numberOfGuests: 3, currency: 'GBP', totalPrice: 480, airbnbExpectedPayoutAmount: 412.5, channelCommissionAmount: 67.5 };
function reset(env = { HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true', HOSTAWAY_WEBHOOK_SECRET: 'a'.repeat(32) }) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { calls: [], fetched: [], fail: null, reservation: { ...airbnb } });
}
const hook = (body, auth = 'recharge:' + 'a'.repeat(32)) => new Request('https://backend.example/api/hostaway/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth === null ? {} : { Authorization: 'Basic ' + btoa(auth) }) }, body: JSON.stringify(body) });

test('reservations map to the platform, confirmation code, guests and platform payout', () => {
  assert.deepEqual(policy.syncReservation(airbnb), { id: '7001', listingId: '501', checkIn: '2026-11-02', checkOut: '2026-11-05', status: 'confirmed',
    channel: 'airbnb', channelReference: 'HMABC123', guests: 3, payoutMinor: 41250 });
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
