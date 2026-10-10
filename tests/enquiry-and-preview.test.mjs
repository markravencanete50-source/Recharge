import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The enquiry form's helpers (postcode lookup and quick picks) and what a role preview keeps in Messages.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { findPostcode, partialPostcode, completePostcode, regionForCouncil, lookupPostcode, suggestPostcodes, postcodePositions } = await vite.ssrLoadModule('/lib/postcode-lookup.ts');
const { fillAlso, listingTitle, placeOf, PROPERTY_TYPES } = await vite.ssrLoadModule('/lib/property-listing.ts');
const { previewHasConversation } = await vite.ssrLoadModule('/lib/view-as.ts');
after(() => vite.close());

const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('postcodes are found, finished and completed in what is typed', () => {
  assert.equal(findPostcode('12 Leith Walk, Edinburgh eh6 5ab'), 'EH6 5AB');
  assert.equal(findPostcode('12 Leith Walk, Edinburgh EH65AB'), 'EH6 5AB');
  assert.equal(findPostcode('12 Leith Walk'), null);
  assert.equal(partialPostcode('12 Leith Walk, Edinburgh EH6 5'), 'EH6 5');
  assert.equal(partialPostcode('12 Leith Walk, Edinburgh EH6 5AB'), null, 'a full postcode needs no finishing');
  assert.equal(completePostcode('12 Leith Walk, Edinburgh EH6 5', 'EH6 5AB'), '12 Leith Walk, Edinburgh EH6 5AB');
  assert.equal(completePostcode('12 Leith Walk, Edinburgh', 'EH6 5AB'), '12 Leith Walk, Edinburgh EH6 5AB');
  assert.equal(completePostcode('', 'EH6 5AB'), 'EH6 5AB');
});

test('a council gives the Recharge area; anywhere outside Scotland says so', () => {
  assert.equal(regionForCouncil('City of Edinburgh', 'Scotland'), 'Edinburgh');
  assert.equal(regionForCouncil('Na h-Eileanan Siar', 'Scotland'), 'Scottish islands');
  assert.equal(regionForCouncil('Westminster', 'England'), 'Outside Scotland');
});

test('a postcode is looked up with only the postcode sent', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url); return answer(200, { result: { postcode: 'EH6 5AB', admin_district: 'City of Edinburgh', admin_ward: 'Leith Walk', country: 'Scotland', latitude: 55.97, longitude: -3.17 } })(); };
  const place = await lookupPostcode('12 Leith Walk, Edinburgh EH6 5AB', fetcher);
  assert.deepEqual(place, { postcode: 'EH6 5AB', council: 'City of Edinburgh', ward: 'Leith Walk', country: 'Scotland', region: 'Edinburgh', lat: 55.97, lon: -3.17 });
  assert.deepEqual(urls, ['https://api.postcodes.io/postcodes/EH65AB'], 'the street is never sent');
  assert.equal(await lookupPostcode('EH6 5AB', answer(404, {})), null, 'an unknown postcode is not an error');
  await assert.rejects(lookupPostcode('EH6 5AB', answer(500, {})), /could not be checked/);
  assert.equal(await lookupPostcode('no postcode here', () => assert.fail('nothing to look up')), null);
});

test('postcode suggestions start from three characters and stay short', async () => {
  assert.deepEqual(await suggestPostcodes('EH', () => assert.fail('too short to ask')), []);
  const many = Array.from({ length: 12 }, (_, i) => `EH6 5A${String.fromCharCode(65 + i)}`);
  assert.deepEqual(await suggestPostcodes('EH6 5', answer(200, { result: many })), many.slice(0, 8));
  assert.deepEqual(await suggestPostcodes('EH6 5', answer(500, {})), [], 'a failed lookup suggests nothing');
});

test('map positions come from one bulk request per hundred postcodes', async () => {
  const posts = [];
  const post = async (url, init) => {
    const { postcodes } = JSON.parse(init.body);
    posts.push({ url, count: postcodes.length });
    return { ok: true, json: async () => ({ result: postcodes.map((q, i) => ({ query: q, result: i % 2 ? null : { latitude: 55 + i / 1000, longitude: -3 } })) }) };
  };
  const codes = Array.from({ length: 150 }, (_, i) => `EH${1 + Math.floor(i / 26)} ${i % 10}${String.fromCharCode(65 + (i % 26))}A`);
  const found = await postcodePositions([...codes, codes[0], 'not a postcode'], post);
  assert.deepEqual(posts.map(p => p.count), [100, 50], 'duplicates and text without a postcode are not sent');
  assert.ok(posts.every(p => p.url === 'https://api.postcodes.io/postcodes'));
  assert.equal(Object.keys(found).length, 75, 'postcodes not found are left out');
  assert.deepEqual(found[codes[0]], [55, -3]);
  await assert.rejects(postcodePositions(['EH6 5AB'], async () => ({ ok: false, json: async () => ({}) })), /could not be checked/);
  assert.deepEqual(await postcodePositions([], () => assert.fail('nothing to ask')), {});
});

test('quick picks fill only the fields the form has, and never replace a choice when asked not to', () => {
  const studio = PROPERTY_TYPES.find(t => t.value === 'Studio');
  assert.deepEqual(fillAlso({ propertyType: 'Studio', bedrooms: '' }, studio.also), { propertyType: 'Studio', bedrooms: '0' });
  assert.deepEqual(fillAlso({ propertyType: 'Studio' }, studio.also), { propertyType: 'Studio' }, 'no bedrooms field, nothing added');
  assert.deepEqual(fillAlso({ region: 'Glasgow' }, { region: 'Edinburgh' }, true), { region: 'Glasgow' });
  assert.deepEqual(fillAlso({ region: '' }, { region: 'Edinburgh' }, true), { region: 'Edinburgh' });
  assert.deepEqual(fillAlso({ region: 'Glasgow' }, { region: 'Edinburgh' }), { region: 'Edinburgh' });
});

test('a listing reads the way owners see it', () => {
  assert.equal(listingTitle({ propertyType: 'Flat', bedrooms: 2, place: 'Leith' }), '2-bedroom flat in Leith');
  assert.equal(listingTitle({ propertyType: 'Studio', bedrooms: 0, place: 'Glasgow' }), 'Studio in Glasgow');
  assert.equal(listingTitle({ propertyType: 'Cottage', bedrooms: 3 }), '3-bedroom cottage');
  assert.equal(listingTitle({}), 'Property');
  assert.equal(placeOf('12 Leith Walk, Leith EH6 5AB', 'Edinburgh'), 'Leith');
  assert.equal(placeOf('12 Leith Walk', 'Edinburgh'), 'Edinburgh');
  assert.equal(placeOf('12 Leith Walk', 'Outside Scotland'), '');
});

test('a role preview keeps only the conversations that role could have', () => {
  const channel = department => ({ kind: 'group', department });
  const owner = { kind: 'owner', department: null }, direct = { kind: 'direct', department: null };
  for (const role of ['admin', 'super_admin']) assert.ok(['all', 'management', 'cleaning'].every(d => previewHasConversation(role, channel(d))) && previewHasConversation(role, owner));
  assert.ok(previewHasConversation('cleans', channel('all')));
  assert.ok(previewHasConversation('cleans', channel('cleaning')));
  assert.ok(!previewHasConversation('cleans', channel('management')));
  assert.ok(!previewHasConversation('cleans', channel('accounts')));
  assert.ok(!previewHasConversation('cleans', owner), 'owners talk to Stays and admins');
  assert.ok(previewHasConversation('stays', owner));
  assert.ok(previewHasConversation('stays', channel('guest_relations')) && previewHasConversation('stays', channel('client_relations')));
  assert.ok(!previewHasConversation('ready', channel('cleaning')) && previewHasConversation('ready', channel('ready')));
  assert.ok(previewHasConversation('accounts', channel('accounts')) && !previewHasConversation('accounts', channel('ready')));
  assert.ok(previewHasConversation('ready', direct), "the super admin's own chats stay");
  assert.ok(!previewHasConversation('client', channel('all')) && !previewHasConversation('client', direct), "an owner's Messages is only their conversation with Recharge");
});
