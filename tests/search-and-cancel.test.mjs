import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Searching long property and people lists, and the Hostaway call that cancels a booking.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, requests: [], answer: () => Response.json({ status: 'success', result: {} }) };
globalThis.__searchCancel = state;
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'workers-env', enforce: 'pre',
  resolveId: id => id === 'cloudflare:workers' ? '\0workers-env' : null,
  load: id => id === '\0workers-env' ? 'export const env=globalThis.__searchCancel.env;' : null,
}] });
const { searchOptions, propertyOption, textOfRow, matchesSearch, normalise } = await vite.ssrLoadModule('/lib/search-options.ts');
const { createElement: h } = await import('react');
const { cancelHostawayReservation, hostawayCancelErrorMessage } = await vite.ssrLoadModule('/lib/hostaway.ts');
const { cancelElsewhereMessage, CANCEL_ON_CHANNEL } = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  state.requests.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
  if (String(url).endsWith('/accessTokens')) return Response.json({ access_token: 'token', expires_in: 3600 });
  return state.answer();
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__searchCancel; await vite.close(); });

const properties = [
  { id: 'a', name: '24/5 Jameson Place', address: '24 Jameson Place, Edinburgh EH6 5AB', region: 'Leith' },
  { id: 'b', name: '39 (Lower) Pitt Street', address: '39 Pitt Street, Edinburgh EH6 4BX', region: 'Leith' },
  { id: 'c', name: 'Pittenweem Harbour Cottage', address: '2 Mid Shore, Pittenweem KY10 2NL', region: 'Fife' },
  { id: 'd', name: 'Café Flat', address: '7 Rose Street, Glasgow G3 6RE', region: 'Glasgow' },
].map(propertyOption);
const ids = (query, limit) => searchOptions(properties, query, limit).shown.map(x => x.id);

test('every word typed must match, in any order, ignoring case, accents and punctuation', () => {
  assert.deepEqual(ids('pitt lower'), ['b']);
  assert.deepEqual(ids('JAMESON 24/5'), ['a']);
  assert.deepEqual(ids('cafe'), ['d']);
  assert.deepEqual(ids('nowhere'), []);
});

test('the street, area and postcode find a property too', () => {
  assert.deepEqual(ids('eh6 5ab'), ['a']);
  assert.deepEqual(ids('mid shore'), ['c']);
  assert.deepEqual(ids('leith'), ['a', 'b']);
  assert.deepEqual(ids('rose street'), ['d']);
});

test('names that start with what was typed come first; the count covers every match', () => {
  assert.deepEqual(ids('pitt'), ['c', 'b'], '"Pittenweem…" starts with it, "39 (Lower) Pitt…" has it as a word');
  assert.deepEqual(searchOptions(properties, 'edinburgh', 1), { shown: [properties[0]], matches: 2 });
  assert.deepEqual(searchOptions(properties, '  ', 3), { shown: properties.slice(0, 3), matches: 4 });
});

test('a long list is searched by what each row shows, not its styles or icons', () => {
  const Row = () => null;
  const row = h(Row, { key: 'x', p: { text: '#000' }, icon: 'check-circle', title: 'Deep clean', detail: '24/5 Jameson Place · Tue 14 Oct', onPress: () => {}, item: { reference: 'HA:67409797', nights: 2, nested: { hidden: 'no' } } },
    h('Text', { style: { color: 'red' } }, 'Booking.com'));
  const text = normalise(textOfRow(row));
  for (const query of ['deep jameson', 'booking com', '67409797', 'oct 14']) assert.ok(matchesSearch(text, query), query);
  for (const query of ['check circle', 'red', 'hidden', '#000']) assert.ok(!matchesSearch(text, query), query);
  assert.ok(matchesSearch(text, '   '), 'an empty search shows everything');
});

test('a booking is cancelled in Hostaway with one PUT, and only for a numeric reservation ID', async () => {
  Object.assign(state.env, { HOSTAWAY_ACCOUNT_ID: '12345', HOSTAWAY_API_KEY: 'secret-key' });
  state.requests.length = 0;
  await cancelHostawayReservation('67409797');
  const put = state.requests.find(x => x.method === 'PUT');
  assert.equal(put.url, 'https://api.hostaway.com/v1/reservations/67409797/statuses/cancelled');
  assert.deepEqual(JSON.parse(put.body), { cancelledBy: 'host' });
  state.requests.length = 0;
  for (const bad of ['', '67409797/../listings', '1e9', 'HA:1']) await assert.rejects(cancelHostawayReservation(bad), /Invalid Hostaway reservation/);
  assert.equal(state.requests.length, 0, 'nothing reaches Hostaway');
});

test('a refused cancellation says what to do, without the API key', async () => {
  state.answer = () => Response.json({ status: 'fail', message: 'Reservation from channel cannot be cancelled secret-key' }, { status: 400 });
  const error = await cancelHostawayReservation('1').catch(e => e);
  const text = hostawayCancelErrorMessage(error);
  assert.match(text, /HTTP 400/);
  assert.match(text, /Hostaway dashboard/);
  assert.doesNotMatch(text, /secret-key/);
  assert.match(hostawayCancelErrorMessage(new TypeError('fetch failed')), /Nothing was cancelled/);
  state.answer = () => Response.json({ status: 'success', result: {} });
});

test('Airbnb and Booking.com bookings point to where they can be cancelled', () => {
  assert.match(cancelElsewhereMessage('booking_com'), /Booking\.com bookings can only be cancelled.*Booking\.com extranet/);
  assert.match(cancelElsewhereMessage('airbnb'), /Airbnb reservations/);
  assert.equal(CANCEL_ON_CHANNEL.booking_com.url, 'https://admin.booking.com');
  assert.match(cancelElsewhereMessage(null), /Hostaway dashboard/);
});
