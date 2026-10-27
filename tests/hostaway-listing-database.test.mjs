import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Listings in Hostaway made from onboarding (migration 20261028200000): onboarding fills in a draft; from the set-up form
// onwards the stays team checks it and adds photos; an admin approves; the server's result links the Hostaway listing to the
// property. A property already linked to a listing made elsewhere is never touched. Admins set the starting wording.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const L = await vite.ssrLoadModule('/lib/hostaway-listing.ts');
const MIGRATION = 'supabase/migrations/20261028200000_hostaway_listing.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'accounts'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Other Owner', 'Andy Accounts'];
const users = roles.map((_, i) => `97770000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9777', '9877');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `lst${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
for (const i of [STAYS, OWNER, OTHER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[i]]);
// Accounts keep the finance tools, as on the live site.
await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features on conflict do nothing', [users[ACCOUNTS]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const sweep = async at => { await db.exec('reset role'); return (await db.query('select private.workspace_onboarding_fee_sweep($1) r', [at])).rows[0].r; };
const fee = async prop => (await owner('select f.*,i.status,i.amount_minor,i.client_id,i.created_by,i.title from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const item = async prop => (await owner('select i.id,i.version from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const move = async (prop, status, extra = {}, i = ACCOUNTS) => { const it = await item(prop); await as(i); return rpc('workspace_teams_action', [{ action: 'moveHubItem', requestId: crypto.randomUUID(), id: it.id, version: it.version, status, ...extra }]); };
const stageOf = async prop => (await owner('select stage from private.workspace_journeys where property_id=$1', [prop]))[0].stage;
const messages = async (who = OWNER) => owner("select m.body from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id where c.kind='owner' and c.owner_id=$1 order by m.created_at,m.id", [users[who]]);
const mails = async (who = OWNER) => owner("select o.subject,o.body from private.workspace_email_outbox o where o.to_address=$1 order by o.created_at", [`lst${who}@example.com`]);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const SETUP = { businessName: 'Olive Owner', bankAccountName: 'O Owner', bankAccountNumber: '12345678', bankSortCode: '12-34-56', accessDate: '2026-10-01', accessInfo: 'Keybox by the door',
  utilitiesConnected: true, prepaymentMeters: false, broadbandConnected: true, hasGarden: true, mailPreference: 'photograph', warrantyDetails: '', preferredRepairContact: '', repairLimitMinor: 20000,
  fullRepairPermission: false, furnishingChoice: 'recharge', licensingRequired: true, gasElectricMeters: 'Smart meters', operatingStatus: 'Empty' };
const said = async (pattern, who = OWNER) => assert.ok((await messages(who)).some(m => pattern.test(m.body)), String(pattern));
const tasks = async prop => (await owner("select d.kind from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=$1 and d.kind in ('cleaning_setup','licensing','garden_setup','furnishing_quote','onboarding_invoice') order by d.kind", [prop])).map(r => r.kind);
const hours = (from, h) => new Date(new Date(from).getTime() + h * 3600000);
after(async () => { await db.close(); await vite.close(); });

const versionOf = async prop => (await owner('select version from private.workspace_journeys where property_id=$1', [prop]))[0].version;
async function journey(i, prop, input) {
  const version = await versionOf(prop);
  await as(i);
  return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), propertyId: prop, version, ...input })]);
}
async function proceeded(by = OWNER, name = 'Harbour Flat') {
  await as(by);
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name, address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 })]);
  const prop = created.propertyId;
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], managementFeeBps: 1800, otaFeeBps: 1500 });
  await journey(by, prop, { action: 'decideEstimate', decision: 'proceed' });
  return prop;
}

async function signed(name = 'Harbour Flat') {
  const prop = await proceeded(OWNER, name);
  await owner("insert into private.workspace_onboarding_packages(property_id,answers,submitted_at) values($1,'{}',now())", [prop]);
  await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and the owner.' });
  await journey(OWNER, prop, { action: 'signAgreement', agreementRevision: 1, signedName: names[OWNER], consent: true });
  return prop;
}
const read = async (prop, i = STAYS) => { await as(i); return L.listingViewSchema.parse(await rpc('workspace_listing_read', [prop])); };
const act = async (input, i = STAYS) => { await as(i); return rpc('workspace_listing_action', [{ requestId: crypto.randomUUID(), ...input }]); };
async function addPhoto(prop, name = 'Living room.jpg') {
  const photoId = crypto.randomUUID();
  return act({ action: 'addPhoto', propertyId: prop, photoId, name, mime: 'image/jpeg', bytes: 2048, path: `listings/${prop}/${photoId}.jpg` });
}
async function result(input) {
  await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role');
  try { return await rpc('workspace_listing_publish_result', [input]); } finally { await db.exec('reset role'); }
}

test('the migration runs twice, stays locked down, and its starting wording matches the app', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  await db.exec('reset role'); await db.exec(sql); await db.exec(sql);
  assert.ok(!/—/.test(sql), 'no em dashes');
  for (const t of ['workspace_listing_settings', 'workspace_listing_drafts', 'workspace_listing_photos']) {
    assert.equal((await owner('select relrowsecurity rls from pg_class where oid=$1::regclass', ['private.' + t]))[0].rls, true, t);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await owner('select has_table_privilege($1,$2,$3) ok', [role, 'private.' + t, 'select']))[0].ok, false, role + ' ' + t);
  }
  assert.equal((await owner("select has_function_privilege('authenticated','public.workspace_listing_publish_result(jsonb)','execute') ok"))[0].ok, false, 'only the server records a result');
  assert.equal((await owner("select has_function_privilege('anon','public.workspace_listing_read(uuid)','execute') ok"))[0].ok, false);
  const [d] = await owner('select private.workspace_listing_settings_default() s');
  assert.deepEqual(L.listingSettingsSchema.parse(d.s), L.DEFAULT_LISTING_SETTINGS);
});

test('onboarding fills in the draft, and the team can edit it from the set-up form onwards', async () => {
  const prop = await proceeded(OWNER, 'Shore Flat');
  await owner(`update private.workspace_journeys set enquiry='{"parking":"One space in the residents’ car park"}' where property_id=$1`, [prop]);
  let v = await read(prop);
  const f = v.listing.fields;
  assert.equal(f.name, 'Shore Flat');
  assert.equal(f.address, '8 Shore Road\nLeith, Edinburgh EH6 6RG');
  assert.equal(f.externalName, '2 bed flat in Leith, Edinburgh');
  assert.equal(f.guests, 4);
  assert.equal(f.nightlyMinor, 11000, 'the medium rate from the estimate');
  assert.match(f.description, /^Shore Flat is a 2-bedroom flat in Leith, Edinburgh, sleeping up to 4 guests\./);
  assert.match(f.description, /Parking: One space/);
  assert.ok(!/Outside:/.test(f.description), 'a line with nothing to fill it is left out');
  assert.equal(v.listing.saved, false);
  assert.equal(v.listing.canEdit, false, 'not before the agreement is signed');
  await refused(act({ action: 'saveDraft', propertyId: prop, fields: f, photos: [] }), /from the set-up form onwards/);
  await as(OWNER); await refused(rpc('workspace_listing_read', [prop]), /Client enquiries access required/);
  await as(ACCOUNTS); await refused(rpc('workspace_listing_read', [prop]), /Client enquiries access required/);
});

test('an admin approves; the result links the Hostaway listing; later changes update it', async () => {
  const prop = await signed('Quay Flat');
  let v = await read(prop);
  assert.equal(v.listing.stage, 'form');
  assert.equal(v.listing.canEdit, true);
  assert.equal(v.listing.canPublish, false, 'the stays team prepares, admins approve');
  assert.equal(v.listing.fields.checkInInstructions, '');
  await owner("insert into private.workspace_property_secrets(property_id,access_instructions) values($1,'Keybox by the door, code sent the day before')", [prop]);
  v = await read(prop);
  assert.equal(v.listing.fields.checkInInstructions, 'Keybox by the door, code sent the day before', 'the access details from the set-up form');
  const fields = { ...v.listing.fields, externalName: 'Bright 2 bed flat by the Shore', wifiName: 'QuayFlat', wifiPassword: 'sea-breeze-22' };
  await refused(act({ action: 'saveDraft', propertyId: prop, fields: { ...fields, guests: 0 }, photos: [] }), /Check the listing's guests/);
  await refused(act({ action: 'saveDraft', propertyId: prop, fields: { ...fields, extra: 'x' }, photos: [] }), /./);
  v = L.listingViewSchema.parse(await act({ action: 'saveDraft', propertyId: prop, fields, photos: [] }));
  assert.equal(v.listing.saved, true);
  assert.equal(v.listing.fields.wifiName, 'QuayFlat');
  await refused(act({ action: 'publish', propertyId: prop }), /Only admins/);
  await refused(act({ action: 'publish', propertyId: prop }, ADMIN), /Fill in the listing first: Photos/);
  await refused(act({ action: 'addPhoto', propertyId: prop, photoId: crypto.randomUUID(), name: 'x.jpg', mime: 'image/jpeg', bytes: 10, path: `listings/${prop}/${crypto.randomUUID()}.jpg` }), /Invalid photo/);
  const one = L.listingViewSchema.parse(await addPhoto(prop, 'Living room.jpg'));
  const two = L.listingViewSchema.parse(await addPhoto(prop, 'Bedroom.jpg'));
  const [a, b] = two.listing.photos;
  assert.equal(one.listing.photos.length, 1);
  v = L.listingViewSchema.parse(await act({ action: 'saveDraft', propertyId: prop, fields, photos: [{ id: b.id, caption: 'The main bedroom' }, { id: a.id, caption: 'Living room' }] }));
  assert.deepEqual(v.listing.photos.map(x => x.caption), ['The main bedroom', 'Living room'], 'in the order chosen');

  const requestId = crypto.randomUUID();
  await as(ADMIN);
  const started = await rpc('workspace_listing_action', [{ action: 'publish', requestId, propertyId: prop }]);
  assert.equal(started.send, true);
  assert.equal(started.hostawayListingId, null, 'a new listing');
  assert.deepEqual(started.photos.map(x => x.caption), ['The main bedroom', 'Living room']);
  assert.ok(started.photos.every(x => x.path.startsWith(`listings/${prop}/`)));
  const again = await rpc('workspace_listing_action', [{ action: 'publish', requestId, propertyId: prop }]);
  assert.equal(again.send, false, 'a repeated press does not post twice');
  v = await read(prop);
  assert.equal(v.listing.status, 'publishing');
  assert.equal(v.listing.canEdit, false);
  assert.equal((await result({ requestId: crypto.randomUUID(), propertyId: prop, ok: true, hostawayListingId: '1' })).recorded, false, 'only the press that started it');
  assert.deepEqual(await result({ requestId, propertyId: prop, ok: true, hostawayListingId: '98765', photoIds: started.photos.map(x => x.id) }), { recorded: true, ok: true });
  assert.equal((await owner('select hostaway_listing_id h from public.workspace_properties where id=$1', [prop]))[0].h, '98765');
  v = await read(prop);
  assert.equal(v.listing.status, 'published');
  assert.equal(v.listing.publishedByName, 'Morag');
  assert.ok(v.listing.photos.every(x => x.sent));
  assert.equal(v.listing.linkedElsewhere, false);
  assert.ok(await notified(ADMIN, 'listing.published') > 0, 'the team hears');
  assert.ok((await owner("select a.body from private.workspace_lead_activity a join private.workspace_client_enquiries e on e.id=a.enquiry_id where e.property_id=$1", [prop])).some(r => /Listing created in Hostaway \(listing 98765\)/.test(r.body)));

  v = L.listingViewSchema.parse(await act({ action: 'saveDraft', propertyId: prop, fields: { ...fields, nightlyMinor: 12500 }, photos: v.listing.photos.map(x => ({ id: x.id, caption: x.caption })) }));
  assert.equal(v.listing.status, 'changed');
  const update = await act({ action: 'publish', propertyId: prop }, SUPER);
  assert.equal(update.hostawayListingId, '98765', 'the same listing is updated');
  assert.deepEqual(update.photos, [], 'photos only go with a new listing');
  await result({ requestId: update.requestId, propertyId: prop, ok: false, error: 'Hostaway did not accept the listing: price' });
  v = await read(prop);
  assert.equal(v.listing.status, 'failed');
  assert.match(v.listing.lastError, /price/);
  assert.equal(v.listing.canPublish, false, 'stays never approve');
  assert.equal((await read(prop, ADMIN)).listing.canPublish, true, 'an admin can try again');
});

test('a property already linked to a listing made elsewhere is never touched, and one listing links to one property', async () => {
  const mine = await signed('Linked Flat');
  await owner("update public.workspace_properties set hostaway_listing_id='55555' where id=$1", [mine]);
  let v = await read(mine, ADMIN);
  assert.equal(v.listing.linkedElsewhere, true);
  assert.equal(v.listing.canEdit, false);
  assert.equal(v.listing.canPublish, false);
  await refused(act({ action: 'publish', propertyId: mine }, ADMIN), /already linked to a Hostaway listing/);

  const other = await signed('Clash Flat');
  const f = (await read(other)).listing.fields;
  await addPhoto(other);
  await act({ action: 'saveDraft', propertyId: other, fields: f, photos: [] });
  const started = await act({ action: 'publish', propertyId: other }, ADMIN);
  assert.deepEqual(await result({ requestId: started.requestId, propertyId: other, ok: true, hostawayListingId: '55555' }), { recorded: true, ok: false });
  v = await read(other);
  assert.equal(v.listing.status, 'failed');
  assert.match(v.listing.lastError, /already linked to it/);
  assert.equal((await owner('select hostaway_listing_id h from public.workspace_properties where id=$1', [other]))[0].h, null);
});

test('removing a photo, and a deleted property queues its stored photos', async () => {
  const prop = await signed('Photo Flat');
  const v = L.listingViewSchema.parse(await addPhoto(prop));
  const removed = await act({ action: 'removePhoto', propertyId: prop, photoId: v.listing.photos[0].id });
  assert.match(removed.removedPath, new RegExp(`^listings/${prop}/`));
  assert.equal(removed.listing.photos.length, 0);
  const kept = L.listingViewSchema.parse(await addPhoto(prop, 'Kitchen.jpg')).listing.photos[0];
  await owner('delete from private.workspace_listing_photos where id=$1', [kept.id]);
  assert.equal((await owner("select count(*)::int n from private.workspace_storage_removals where bucket='lead-files' and reason='listing_photo.deleted' and path like $1", [`listings/${prop}/%`]))[0].n, 1);
});

test('admins set the starting wording; drafts not yet saved follow it', async () => {
  await refused(act({ action: 'saveSettings', settings: L.DEFAULT_LISTING_SETTINGS }), /Only admins/);
  const settings = { ...L.DEFAULT_LISTING_SETTINGS, guestsPerBedroom: 3, minNights: 3, descriptionTemplate: 'Welcome to {name}.\nNear {nowhere}.' };
  const v = L.listingViewSchema.parse(await act({ action: 'saveSettings', settings }, ADMIN));
  assert.equal(v.settings.minNights, 3);
  assert.equal(v.settingsUpdatedByName, 'Morag');
  await refused(act({ action: 'saveSettings', settings: { ...settings, checkOut: 24 } }, ADMIN), /checkOut/);
  await refused(act({ action: 'saveSettings', settings: { ...settings, descriptionTemplate: ' ' } }, ADMIN), /Write the description/);
  const prop = await signed('Settings Flat');
  const f = (await read(prop)).listing.fields;
  assert.equal(f.guests, 6);
  assert.equal(f.minNights, 3);
  assert.equal(f.description, 'Welcome to Settings Flat.\nNear {nowhere}.', 'unknown words are left as written');
  await act({ action: 'saveSettings', settings: L.DEFAULT_LISTING_SETTINGS }, ADMIN);
});

test('the address splits into what Hostaway keeps, and the body carries prices in pounds', () => {
  assert.deepEqual(L.splitAddress('8 Shore Road\nLeith, Edinburgh EH6 6RG'), { street: '8 Shore Road', city: 'Edinburgh', postcode: 'EH6 6RG' });
  assert.deepEqual(L.splitAddress('Flat 2, 10 High Street, Glasgow, G1 1AA'), { street: 'Flat 2', city: 'Glasgow', postcode: 'G1 1AA' });
  assert.deepEqual(L.splitAddress('Cottage'), { street: 'Cottage', city: '', postcode: '' });
  const f = { ...L.DEFAULT_LISTING_SETTINGS, name: 'Quay Flat', externalName: 'Bright flat', description: 'x', address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, beds: 2, guests: 4,
    nightlyMinor: 11050, wifiName: '', wifiPassword: '', accessCode: '1234', checkInInstructions: '' };
  delete f.descriptionTemplate; delete f.guestsPerBedroom;
  const body = L.hostawayListingBody(L.listingFieldsSchema.parse(f), [{ url: 'https://x.test/a.jpg', caption: 'A' }]);
  assert.equal(body.price, 110.5);
  assert.equal(body.zipcode, 'EH6 6RG');
  assert.equal(body.personCapacity, 4);
  assert.equal(body.doorSecurityCode, '1234');
  assert.deepEqual(body.listingImages, [{ url: 'https://x.test/a.jpg', caption: 'A', sortOrder: 1 }]);
  assert.ok(!('listingImages' in L.hostawayListingBody(L.listingFieldsSchema.parse(f), null)));
  assert.deepEqual(L.listingMissing(L.listingFieldsSchema.parse(f), 0), ['Description', 'Photos']);
});
