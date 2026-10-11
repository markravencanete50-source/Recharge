// Seeds the devstack database with a fictional Scottish short-let business, "Recharge", through
// the real database functions, each called as the person who would do it in the app (or as the
// backend service where the backend does it: photo uploads, the channel-manager sync).
// Afterwards the timestamps of what was done are moved back to when it "happened", so calendars,
// charts and histories spread over the past six weeks. Dates are relative to today (Europe/London).
// Run on its own to rebuild the cache:  node scripts/demo/seed.mjs
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PEOPLE, ROOT, createPerson, person } from './db.mjs';
import { clearStorage, roomPhoto, storageLink } from './media.mjs';

const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await import(pathToFileURL(path.join(ROOT, 'lib/modules.ts')).href);

const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
export const TODAY = londonToday();
export const day = offset => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const month = offset => { const d = new Date(TODAY.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
// The UTC instant of a London wall-clock time.
export function at(date, time = '12:00') {
  const guess = new Date(`${date}T${time}:00Z`);
  const wall = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const get = type => wall.find(p => p.type === type).value;
  const shown = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`);
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}
// Deterministic randomness, so every seed looks the same.
let rngState = 20261010;
const rand = () => { rngState = (rngState + 0x6D2B79F5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const code = (n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');

export const PROPERTIES = [
  { key: 'leith', name: 'Leith Shore Apartment', address: '14 Commercial Quay, Leith, Edinburgh EH6 6LX', region: 'Edinburgh', bedrooms: 2, lat: 55.9771, lng: -3.1712, owner: 'alasdair', stays: 'fiona', ready: 'rory', cleaner: 'ewan', nightly: 145 },
  { key: 'stockbridge', name: 'Stockbridge Mews House', address: '8 Saxe Coburg Place, Edinburgh EH3 5BR', region: 'Edinburgh', bedrooms: 3, lat: 55.9600, lng: -3.2085, owner: 'catriona', stays: 'fiona', ready: 'rory', cleaner: 'ewan', nightly: 215 },
  { key: 'royalmile', name: 'Royal Mile Old Town Flat', address: '23 Blackfriars Street, Edinburgh EH1 1NB', region: 'Edinburgh', bedrooms: 1, lat: 55.9497, lng: -3.1856, owner: 'alasdair', stays: 'fiona', ready: 'rory', cleaner: 'ewan', nightly: 120 },
  { key: 'merchant', name: 'Merchant City Loft', address: '41 Candleriggs, Glasgow G1 1LE', region: 'Glasgow', bedrooms: 2, lat: 55.8589, lng: -4.2433, owner: 'moira', stays: 'callum', ready: 'rory', cleaner: 'kirsty', nightly: 125 },
  { key: 'westend', name: 'West End Townhouse', address: '12 Park Circus Place, Glasgow G3 6AN', region: 'Glasgow', bedrooms: 4, lat: 55.8679, lng: -4.2797, owner: 'catriona', stays: 'callum', ready: 'rory', cleaner: 'kirsty', nightly: 260 },
  { key: 'standrews', name: 'St Andrews Links Cottage', address: '5 Gibson Place, St Andrews KY16 9JE', region: 'Fife', bedrooms: 3, lat: 56.3410, lng: -2.8030, owner: 'alasdair', stays: 'fiona', ready: 'rory', cleaner: 'jamie', nightly: 235 },
  { key: 'eastneuk', name: 'East Neuk Harbour House', address: '2 Mid Shore, Pittenweem, Fife KY10 2NL', region: 'Fife', bedrooms: 3, lat: 56.2125, lng: -2.7286, owner: 'moira', stays: 'fiona', ready: 'rory', cleaner: 'jamie', nightly: 175 },
  { key: 'inverness', name: 'Inverness Riverside Flat', address: '17 Ness Bank, Inverness IV2 4SF', region: 'Inverness and Highlands', bedrooms: 2, lat: 57.4729, lng: -4.2268, owner: 'catriona', stays: 'callum', ready: 'eilidh', cleaner: 'kirsty', nightly: 110 },
  { key: 'glencoe', name: 'Glencoe Mountain Lodge', address: 'Upper Carnoch, Glencoe, Ballachulish PH49 4HS', region: 'Inverness and Highlands', bedrooms: 4, lat: 56.6826, lng: -5.1023, owner: 'alasdair', stays: 'callum', ready: 'eilidh', cleaner: 'kirsty', nightly: 240 },
  { key: 'aberdeen', name: 'Aberdeen Harbour View', address: '30 Regent Quay, Aberdeen AB11 5BE', region: 'Aberdeen', bedrooms: 2, lat: 57.1457, lng: -2.0928, owner: 'catriona', stays: 'callum', ready: 'eilidh', cleaner: 'jamie', nightly: 105, noDefaultCleaner: true },
];
// Properties still joining Recharge, each at a different step of onboarding.
export const JOURNEYS = [
  { key: 'aviemore', name: 'Aviemore Pine Lodge', address: '9 Dalfaber Drive, Aviemore PH22 1ST', region: 'Inverness and Highlands', propertyType: 'Lodge', bedrooms: 3, bathrooms: 2, lat: 57.1950, lng: -3.8250, owner: 'moira', stays: 'callum', ready: 'eilidh', cleaner: 'kirsty', upTo: 'inspection' },
  { key: 'nairn', name: 'Nairn Beach House', address: '6 Seabank Road, Nairn IV12 4EU', region: 'Inverness and Highlands', propertyType: 'House', bedrooms: 3, bathrooms: 2, lat: 57.5860, lng: -3.8740, owner: 'catriona', stays: 'callum', ready: 'eilidh', cleaner: 'kirsty', upTo: 'invoice' },
  { key: 'skye', name: 'Skye Croft House', address: 'Carbost, Isle of Skye IV47 8SR', region: 'Inverness and Highlands', propertyType: 'Cottage', bedrooms: 2, bathrooms: 1, lat: 57.3030, lng: -6.3570, owner: 'moira', stays: 'callum', ready: 'eilidh', cleaner: 'kirsty', upTo: 'estimate' },
  { key: 'pitlochry', name: 'Pitlochry Riverside Cottage', address: '3 Port-na-Craig, Pitlochry PH16 5ND', region: 'Perth and Kinross', propertyType: 'Cottage', bedrooms: 2, bathrooms: 1, lat: 56.6990, lng: -3.7330, owner: 'alasdair', stays: 'fiona', ready: 'rory', cleaner: 'jamie', upTo: 'enquiry' },
];
const CHECKLIST = ['Kitchen cleaned, dishwasher emptied and restocked', 'Bathrooms cleaned and towels replaced', 'Beds made with fresh linen', 'Floors hoovered and mopped', 'Bins emptied and recycling out', 'Welcome pack and toiletries topped up', 'Wi-Fi and broadband working'];
const GUESTS = ['Olivia Bennett', 'James Whitfield', 'Sophie Laurent', 'Lukas Becker', 'Emma Johansson', "Liam O'Neill", 'Chloe Martin', 'Noah Fischer', 'Ava Thompson', 'Mateo Rossi', 'Isabella Garcia', 'Ethan Clarke', 'Mia Novak', 'Lucas Moreau', 'Hannah Schultz', 'Daniel Okafor', 'Priya Sharma', 'Tom Gallagher', 'Ingrid Larsen', 'Ben Carter', 'Aiko Tanaka', 'Ruth Mackay', 'Pierre Dubois', 'Sarah Lindqvist'];
const CHANNELS = [['airbnb', 0.55], ['booking_com', 0.30], ['vrbo', 0.05], ['direct', 0.10]];
const FEES = { airbnb: 0.155, booking_com: 0.17, vrbo: 0.08, direct: 0 };

class Seeder {
  constructor(dev, log) { Object.assign(this, { dev, log, p: {}, skipped: [], counts: {}, timeline: new Map(), photos: 0, reservations: [] }); }
  async call(key, name, args = {}) {
    await this.dev.sql('delete from private.workspace_write_limits');
    const result = await this.dev.rpc(key === 'service' ? 'service' : person(key), name, args);
    if (result.error) throw new Error(`${name} as ${key}: ${result.error.message}`);
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    return result.data;
  }
  op(key, input) { return this.call(key, 'workspace_operations_action', { input: { requestId: randomUUID(), ...input } }); }
  step_(key, work, step, data) { return this.op(key, { action: 'updateOperation', workId: work.workId, version: work.version, step, data }); }
  teams(key, input) { return this.call(key, 'workspace_teams_action', { input: { requestId: randomUUID(), ...input } }); }
  finance(key, input) { return this.call(key, 'workspace_finance_action', { input: { requestId: randomUUID(), ...input } }); }
  accounts(key, input) { return this.call(key, 'workspace_accounts_action', { input: { requestId: randomUUID(), ...input } }); }
  chat(key, input) { return this.call(key, 'workspace_chat_action', { input }); }
  inbox(key, input) { return this.call(key, 'workspace_guest_inbox_action', { input: { requestId: randomUUID(), ...input } }); }
  journey(key, input) { return this.call(key, 'workspace_journey_action', { input: { requestId: randomUUID(), ...input } }); }
  portfolio(key, input) { return this.call(key, 'workspace_portfolio_action', { input: { requestId: randomUUID(), ...input } }); }
  controls(key, input) { return this.call(key, 'workspace_controls_action', { input: { requestId: randomUUID(), ...input } }); }
  async step(label, task) {
    try { return await task(); }
    catch (error) { this.skipped.push(`${label}: ${error.message}`); this.log(`skipped ${label}: ${error.message}`); return undefined; }
  }
  sql(text, params) { return this.dev.sql(text, params); }
  async work(workId) { const [w] = await this.sql(`select w.id "workId", w.version, w.status, w.assignee_id "assigneeId", d.kind, d.data from public.workspace_work_items w left join private.workspace_domain_details d on d.work_id = w.id where w.id = $1`, [workId]); return w; }
  async version(propertyId) { return (await this.sql('select version from public.workspace_properties where id=$1', [propertyId]))[0].version; }
  // When something happened: [created, finished]. Applied to the records at the end.
  when(workId, created, finished = null) { if (workId) this.timeline.set(workId, { created, finished }); }
  // A photo taken in the app: the real upload intent, the file in (disk) storage, the backend's commit.
  async photo(key, workId, purpose, scene, extra = {}) {
    // A small pool of pictures per scene keeps the seed quick and the storage folder small.
    const variant = ++this.photos % 5;
    this.pool ??= {};
    const bytes = this.pool[scene + variant] ??= roomPhoto(scene, 7919 * (variant + 1), 400, 300);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const intent = await this.call(key, 'workspace_prepare_upload', { input: { requestId: randomUUID(), workId, purpose, contentHash, ...extra } });
    if (intent.evidenceId) return intent.evidenceId;
    const file = `${intent.publicId}.png`;
    await storageLink('workspace-media', file, `${scene}-${variant}.png`, bytes);
    return this.call('service', 'integration_commit_upload', { target_intent: intent.id, asset: { assetId: 'storage:' + file, publicId: intent.publicId, version: 1, format: 'png', bytes: bytes.length } });
  }
}

export async function seed(dev, { log = console.log } = {}) {
  const s = new Seeder(dev, log);
  const t0 = Date.now();
  await clearStorage();
  const sections = [people, settings, properties, journeys, reservations, cleans, repairs, routines, purchases, listings, directBookings, finance, hub, teamTime, clientEnquiries, training, chat, guestInbox, extras, backdate];
  for (const section of sections) {
    const t = Date.now();
    await s.step(section.name, () => section(s));
    log(`${section.name} (${Date.now() - t} ms)`);
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${s.skipped.length} step(s) skipped`);
  const totals = (await dev.sql(`select (select count(*) from public.workspace_profiles)::int people, (select count(*) from public.workspace_properties)::int properties,
    (select count(*) from public.workspace_work_items)::int work, (select count(*) from public.workspace_invoices)::int invoices, (select count(*) from private.workspace_reservations)::int stays,
    (select count(*) from private.chat_messages)::int messages, (select count(*) from private.workspace_media_evidence)::int photos`))[0];
  return { skipped: s.skipped, counts: s.counts, totals, line: `${totals.people} people, ${totals.properties} properties, ${totals.stays} stays, ${totals.work} work items, ${totals.invoices} invoices, ${totals.messages} chat messages, ${totals.photos} photos` };
}

// ---------------------------------------------------------------------------------------------
async function people(s) {
  await s.dev.serialize(async () => {
    for (const p of PEOPLE) await createPerson(s.dev.db, p, p.role === 'admin' || p.role === 'super_admin' ? [...MODULE_IDS] : [...DEFAULT_ROLE_MODULES[p.role]]);
  });
  await s.dev.refreshUsers();
}

async function settings(s) {
  await s.step('booking policy', async () => {
    const [policy] = await s.sql('select version from private.workspace_booking_policy');
    await s.op('sam', { action: 'configureBookingPolicy', version: policy.version, minimumNights: 4, discountBps: 1000, discountCapMinor: 15000, confirmed: true });
  });
  await s.step('finance policy', async () => {
    const policy = await s.call('sam', 'workspace_finance_read', { section: 'policy', target_property: null, period: null, target_id: null, status_filter: null });
    const next = await s.finance('sam', { action: 'setFinancePolicy', version: policy.version, expenseApprovalLimitMinor: 50000 });
    await s.finance('sam', { action: 'setRepairApprovalLimit', version: next?.version ?? policy.version + 1, managementRepairLimitMinor: 75000 });
  });
  await s.step('performance targets', async () => {
    const [t] = await s.sql('select version from private.workspace_performance_targets');
    await s.teams('morag', { action: 'saveTargets', version: t.version, greenMinutes: 10, amberMinutes: 30, passPercent: 85, bonusPercents: [90, 95], workWeight: 40, dailyTargets: { signOffs: 1, listingChecks: 4, pricingDecisions: 2, reviewsLogged: 1 } });
  });
  for (const [item, max, note] of [['Dining chair', 6000, 'Oak or similar, to match the set'], ['Bedside lamp', 2500, 'Warm white bulb'], ['Double duvet', 4500, '10.5 tog, hypoallergenic'], ['Towel set', 1800, 'White, 2 bath + 2 hand'], ['Kettle', 3000, ''], ['Toaster', 2800, ''], ['Hoover', 15000, 'Cordless, with spare battery'], ['Smoke alarm', 2000, 'Interlinked, 10-year battery'], ['Bed linen set', 3500, 'Percale, white']]) {
    await s.step(`budget item ${item}`, () => s.teams('graham', { action: 'saveBudgetItem', item, maxUnitMinor: max, note }));
  }
}

async function properties(s) {
  for (const [i, p] of PROPERTIES.entries()) {
    const id = await s.call('sam', 'workspace_save_property', { input: { requestId: randomUUID(), name: p.name, address: p.address, region: p.region, bedrooms: p.bedrooms, status: 'active' } });
    s.p[p.key] = { ...p, id, listingId: `RC${1001 + i}` };
    await s.call('sam', 'workspace_assign_property', { target_property: id, target_user: person(p.owner).id, assignment_kind: 'client' });
    for (const [key, kind] of [[p.stays, 'staff'], [p.ready, 'staff'], [p.cleaner, 'cleaner'], ['isla', 'cleaning_manager'], ['graham', 'staff']]) await s.call('sam', 'workspace_assign_property', { target_property: id, target_user: person(key).id, assignment_kind: kind });
    // The other Stays member covers days off.
    await s.call('sam', 'workspace_assign_property', { target_property: id, target_user: person(p.stays === 'fiona' ? 'callum' : 'fiona').id, assignment_kind: 'staff' });
    await s.step(`location ${p.key}`, async () => s.portfolio('sam', { action: 'saveLocation', propertyId: id, version: await s.version(id), latitude: p.lat, longitude: p.lng, hostawayListingId: s.p[p.key].listingId }));
    const airbnb = String(between(41000000, 59999999)) + String(between(100, 999));
    await s.step(`listing links ${p.key}`, () => s.portfolio(p.stays, { action: 'saveListingLinks', propertyId: id, links: [
      { platform: 'Airbnb', url: `https://www.airbnb.co.uk/rooms/${airbnb}`, listingId: airbnb },
      { platform: 'Booking.com', url: `https://www.booking.com/hotel/gb/recharge-${p.key}.en-gb.html`, listingId: String(between(8000000, 9999999)) },
      { platform: 'Direct', url: `https://stay.recharge.example/${p.key}`, listingId: '' },
    ] }));
    await s.step(`access details ${p.key}`, async () => s.call('sam', 'workspace_save_property_details', { target_property: id, expected_version: await s.version(id), section: 'access', input: { accessInstructions: `Key safe to the left of the front door, code ${between(1000, 9999)}. Bins are collected on ${pick(['Monday', 'Tuesday', 'Thursday'])} mornings. Stopcock under the kitchen sink; fuse board in the hall cupboard.` } }));
    await s.step(`ota details ${p.key}`, async () => s.call('sam', 'workspace_save_property_details', { target_property: id, expected_version: await s.version(id), section: 'ota', input: { otaInstructions: 'Self check-in from 4pm, check-out by 10am. No parties or events. Up to ' + p.bedrooms * 2 + ' guests. Free street parking after 6pm.' } }));
    await s.step(`finance details ${p.key}`, async () => s.call('sam', 'workspace_save_property_details', { target_property: id, expected_version: await s.version(id), section: 'finance', input: { managementFeeBps: p.nightly > 200 ? 1800 : 2000, paymentNotes: 'Owner payout by bank transfer on the 5th working day of the month.' } }));
    if (!p.noDefaultCleaner) await s.step(`default cleaner ${p.key}`, () => s.teams('isla', { action: 'setDefaultCleaner', propertyId: id, cleanerId: person(p.cleaner).id }));
  }
  for (const [cleaner, rate] of [['ewan', 2800], ['kirsty', 2600], ['jamie', 2500]]) await s.step(`cleaner rate ${cleaner}`, () => s.teams('isla', { action: 'setCleanerRate', cleanerId: person(cleaner).id, rateMinor: rate, version: 0 }));
  // Joined Recharge over the past year.
  await s.dev.serialize(async () => {
    await s.dev.db.exec('set session_replication_role = replica');
    for (const [i, p] of PROPERTIES.entries()) await s.dev.db.query(`update public.workspace_properties set created_at = now() - ($2 || ' days')::interval where id = $1`, [s.p[p.key].id, String(340 - i * 27)]);
    await s.dev.db.exec('set session_replication_role = origin');
  });
}

// Onboarding: the owner's enquiry, Recharge's estimate, agreement, the owner's form, the onboarding
// invoice, the inspection. Each property stops at a different step.
async function journeys(s) {
  const order = ['enquiry', 'estimate', 'agreement', 'form', 'invoice', 'inspection'];
  for (const j of JOURNEYS) {
    const reach = order.indexOf(j.upTo);
    let journey = await s.journey(j.owner, { action: 'createEnquiry', name: j.name, address: j.address, region: j.region, propertyType: j.propertyType, bedrooms: j.bedrooms, bathrooms: j.bathrooms,
      enquiry: { contactName: person(j.owner).fullName, email: person(j.owner).email, phone: '+44 7700 900' + between(100, 999), existingClient: true, wcs: j.bathrooms, parking: 'Private driveway', garden: j.propertyType === 'Flat' ? '' : 'Front and back garden', notes: 'Currently a second home; we would like it let from next season.' } });
    s.p[j.key] = { ...j, id: journey.propertyId, journeyWork: journey.workId };
    s.when(journey.workId, at(day(-30 + reach * 3), '19:40'));
    for (const [key, kind] of [[j.stays, 'staff'], [j.ready, 'staff'], [j.cleaner, 'cleaner'], ['isla', 'cleaning_manager'], ['graham', 'staff']]) await s.step(`assign ${j.key}`, () => s.call('sam', 'workspace_assign_property', { target_property: journey.propertyId, target_user: person(key).id, assignment_kind: kind }));
    await s.step(`location ${j.key}`, async () => s.portfolio('sam', { action: 'saveLocation', propertyId: journey.propertyId, version: await s.version(journey.propertyId), latitude: j.lat, longitude: j.lng, hostawayListingId: '' }));
    if (reach < 1) continue;
    await s.step(`journey ${j.key}`, async () => {
      const nightly = { 2: 11000, 3: 16000 }[j.bedrooms] ?? 14000;
      journey = await s.journey('morag', { action: 'publishEstimate', propertyId: journey.propertyId, version: journey.version, lowRateMinor: nightly - 2500, mediumRateMinor: nightly, highRateMinor: nightly + 4500,
        comparables: [{ name: `${j.propertyType} near ${j.region.split(' ')[0]}, ${j.bedrooms} bedrooms`, url: `https://www.airbnb.co.uk/rooms/${between(30000000, 49999999)}`, adrMinor: nightly + 1200 }],
        comments: 'Strong summer demand; winter weekends hold up well for walkers and skiers.', occupancyBps: 6800, directBookingBps: 1000, otaFeeBps: 1500, managementFeeBps: 2000 });
      if (reach < 2) return;
      journey = await s.journey(j.owner, { action: 'decideEstimate', propertyId: journey.propertyId, version: journey.version, decision: 'proceed', feedback: 'Happy with the medium case.' });
      journey = await s.journey('morag', { action: 'publishAgreement', propertyId: journey.propertyId, version: journey.version, agreement: 'Recharge management agreement (sample). Recharge lets and looks after the property; the management fee is 20% of net rental income; either party may end the agreement with 60 days notice.' });
      if (reach < 3) return;
      journey = await s.journey(j.owner, { action: 'signAgreement', propertyId: journey.propertyId, version: journey.version, agreementRevision: 1, signedName: person(j.owner).fullName, consent: true });
      if (reach < 4) return;
      journey = await s.journey(j.owner, { action: 'submitForm', propertyId: journey.propertyId, version: journey.version, form: {
        businessName: person(j.owner).fullName + ' Holiday Lets', bankAccountName: person(j.owner).fullName, bankAccountNumber: String(between(10000000, 99999999)), bankSortCode: `${between(10, 99)}-${between(10, 99)}-${between(10, 99)}`,
        accessDate: day(-6), accessInfo: 'Spare keys with the neighbour at number 8; alarm code to follow by phone.', utilitiesConnected: true, prepaymentMeters: false, broadbandConnected: false, broadbandInstallDate: day(9),
        hasGarden: true, mailPreference: 'photograph', warrantyDetails: 'Boiler under warranty with the installer until 2028.', preferredRepairContact: 'Highland Heating Services', repairLimitMinor: 25000, fullRepairPermission: false, furnishingChoice: 'recharge', licensingRequired: true } });
      if (reach < 5) return;
      const invoice = await s.call('graham', 'workspace_create_invoice', { input: { requestId: randomUUID(), propertyId: journey.propertyId, moduleId: 'onboarding-invoices', recipientId: person(j.owner).id, reference: `ONB-${j.key.toUpperCase()}-01`, amountMinor: 47500, currency: 'GBP' } });
      journey = await s.journey('morag', { action: 'linkInvoice', propertyId: journey.propertyId, version: journey.version, invoiceId: invoice });
      await s.call('graham', 'workspace_set_invoice_status', { target_invoice: invoice, expected_version: 1, next_status: 'paid' });
      journey = (await s.call('morag', 'workspace_journey_read', { target: journey.propertyId }))[0];
      journey = await s.journey('eilidh', { action: 'bookInspection', propertyId: journey.propertyId, version: journey.version, inspectionOn: day(2) });
    });
  }
}

// Stays arrive from the channel manager (the same database function the Hostaway sync used):
// six weeks back, three weeks ahead, with platform, guests and payout. Future checkouts get a clean.
async function reservations(s) {
  const all = [];
  let n = 100120;
  for (const p of PROPERTIES) {
    let cursor = -52 + between(0, 4);
    while (cursor < 24) {
      const nights = pick([2, 2, 3, 3, 3, 4, 4, 5, 6, 7]);
      const channel = (() => { let r = rand(); for (const [c, w] of CHANNELS) { if ((r -= w) < 0) return c; } return 'airbnb'; })();
      const weekend = [5, 6].includes(new Date(day(cursor) + 'T12:00:00Z').getUTCDay());
      const gross = Math.round(s.p[p.key].nightly * nights * (weekend ? 1.12 : 1) * (0.92 + rand() * 0.16));
      const status = rand() < 0.04 ? 'cancelled' : 'confirmed';
      const ref = channel === 'airbnb' ? 'HM' + code(8) : channel === 'booking_com' ? String(between(3000000000, 4999999999)) : channel === 'vrbo' ? 'HA-' + code(7) : 'RCD-' + between(1000, 9999);
      all.push({ id: 'RC' + n++, listingId: s.p[p.key].listingId, property: p.key, checkIn: day(cursor), checkOut: day(cursor + nights), status, channel, channelReference: ref, guests: between(1, Math.min(8, p.bedrooms * 2)),
        payoutMinor: Math.round(gross * (1 - FEES[channel])) * 100, guest: pick(GUESTS) });
      cursor += nights + (status === 'cancelled' ? 0 : pick([0, 0, 0, 1, 1, 2, 3, 4]));
    }
  }
  s.reservations = all;
  await s.sql('update private.workspace_hostaway_sync_state set paused = false');
  for (let i = 0; i < all.length; i += 40) {
    const batch = all.slice(i, i + 40).map(({ property, guest, ...r }) => r);
    const result = await s.call('service', 'workspace_hostaway_sync', { input: { trigger: 'schedule', reservations: batch } });
    if (result?.problems?.length) s.log(`sync problems: ${JSON.stringify(result.problems).slice(0, 300)}`);
  }
  // Recharge has moved off Hostaway: the sync is left paused, as in production.
  await s.sql('update private.workspace_hostaway_sync_state set paused = true, last_success_at = now() - interval \'3 days\'');
  for (const r of await s.sql(`select id, reference, property_id, check_in::text, status from private.workspace_reservations`)) {
    const mine = all.find(x => 'HA:' + x.id === r.reference);
    if (mine) Object.assign(mine, { reservationId: r.id, propertyId: r.property_id });
  }
  // Booked 1-8 weeks before arrival.
  await s.dev.serialize(async () => {
    await s.dev.db.exec('set session_replication_role = replica');
    await s.dev.db.query(`update private.workspace_reservations set created_at = least(now() - interval '2 days', check_in - ((7 + (abs(hashtext(reference)) % 50)) || ' days')::interval + interval '13 hours'), synced_at = least(now(), check_in - interval '5 days'), updated_at = least(now() - interval '2 days', check_in - interval '6 days')`);
    await s.dev.db.exec('set session_replication_role = origin');
  });
}

// Past checkouts: the clean, its photos, the cleaner's report and the manager's review.
async function cleans(s) {
  const past = s.reservations.filter(r => r.status === 'confirmed' && r.checkOut >= day(-42) && r.checkOut <= day(0)).sort((a, b) => a.checkOut.localeCompare(b.checkOut));
  const reports = ['All rooms turned over, linen changed and the kitchen restocked.', 'Full clean done. Replaced two bulbs in the hall and topped up the welcome pack.', 'Clean finished; extra time on the oven after a long stay.', 'Turnover complete, bins out for collection, heating left on low.', 'Deep clean of the bathroom grout; everything else standard.'];
  const scenes = ['kitchen', 'bedroom', 'bathroom', 'living'];
  let rejected = 0;
  for (const [i, r] of past.entries()) {
    const p = PROPERTIES.find(x => x.key === r.property);
    const cleaner = p.cleaner, recent = r.checkOut >= day(-1);
    await s.step(`clean ${r.property} ${r.checkOut}`, async () => {
      let job = await s.op('isla', { action: 'createOperation', propertyId: s.p[p.key].id, kind: 'cleaning', data: { dueOn: r.checkOut, checklist: CHECKLIST } });
      job = await s.work(job.workId);
      if (!job.assigneeId) { await s.call('isla', 'workspace_assign_work', { target_work: job.workId, expected_version: job.version, target_user: person(cleaner).id }); job = await s.work(job.workId); }
      // Today's later cleans are still to do; this morning's is being reviewed.
      if (r.checkOut === day(0) && i % 2 === 1) { s.when(job.workId, at(day(-3), '09:10')); return; }
      const photos = [];
      for (const scene of scenes.slice(0, 2 + (i % 2))) photos.push(await s.photo(cleaner, job.workId, 'cleaning', scene));
      job = await s.step_(cleaner, job, 'submitCleaning', { checks: CHECKLIST, report: reports[i % reports.length], photoIds: photos, mailAction: 'none' });
      const finished = at(r.checkOut, `${String(13 + (i % 3)).padStart(2, '0')}:${pick(['05', '20', '35', '50'])}`);
      if (recent) { s.when(job.workId, at(day(-3), '09:10'), finished); return; }
      const reject = i % 9 === 4 && rejected < 4;
      if (reject) rejected++;
      job = await s.step_('isla', job, 'reviewCleaning', reject
        ? { accepted: false, guestFeedback: pick(['Guest found hair in the shower tray and crumbs under the sofa.', 'Guest said the oven had not been cleaned.', 'Guest reported a used towel left in the bathroom.']), reviewNote: 'Photos do not show the areas the guest mentioned; please take wider shots.' }
        : { accepted: true, guestFeedback: pick(['Guest said the flat was spotless.', 'Five-star cleanliness review.', 'No issues reported by the guest.', 'Guest loved the welcome pack.']), reviewNote: 'Photos checked, all good.' });
      s.when(job.workId, at(day(daysBetween(TODAY, r.checkOut) - 4), '10:00'), at(r.checkOut, '17:30'));
    });
  }
  // Rejected cleans opened complaints: management overturns one, upholds one; a cleaner answers another.
  await s.step('clean complaints', async () => {
    const complaints = await s.sql(`select w.id "workId", w.version, d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id = w.id where d.kind = 'cleaning_complaint' and w.status not in ('completed','cancelled') order by w.created_at`);
    for (const [i, c] of complaints.entries()) {
      if (i === 0) await s.teams('sam', { action: 'decideComplaint', workId: c.workId, version: c.version, outcome: 'overturned', note: 'The photos show the shower was clean at handover; the guest arrived late with muddy gear.' });
      else if (i === 1) await s.teams('morag', { action: 'decideComplaint', workId: c.workId, version: c.version, outcome: 'upheld', note: 'Oven clearly missed. Agreed with Isla to add it to the checklist photos.' });
      else if (i === 2) await s.teams(c.data?.cleanerId ? PEOPLE.find(x => x.id === c.data.cleanerId)?.key ?? 'kirsty' : 'kirsty', { action: 'addCleanerStatement', workId: c.workId, statement: 'I changed every towel; the guest may have used one after arrival. Photos at 14:02 show the rail empty.' });
    }
  });
}

async function repairs(s) {
  const id = key => s.p[key].id;
  const make = async (who, key, data) => { const created = await s.op(who, { action: 'createOperation', propertyId: id(key), kind: 'maintenance', data }); return s.work(created.workId); };
  const next = async (who, w, step, data) => { const r = await s.step_(who, w, step, data); return s.work(r.workId ?? w.workId); };
  const owner = key => PROPERTIES.find(p => p.key === key).owner;
  const ready = key => PROPERTIES.find(p => p.key === key).ready;
  const plan = [
    { key: 'leith', who: 'fiona', ago: 2, upTo: 'owner_approval', data: { issue: 'Boiler pressure keeps dropping; heating cuts out overnight. Guests have the fan heater for now.', estimatedCostMinor: 18000, hazard: false, repairType: 'heating' } },
    { key: 'stockbridge', who: 'fiona', ago: 5, upTo: 'triage', data: { issue: 'Shower mixer in the main bathroom drips constantly.', estimatedCostMinor: 9500, hazard: false, repairType: 'leak' } },
    { key: 'merchant', who: 'callum', ago: 6, upTo: 'referred', data: { issue: 'Dishwasher not draining; standing water after every cycle.', estimatedCostMinor: 14000, hazard: false, repairType: 'appliance' } },
    { key: 'westend', who: 'callum', ago: 8, upTo: 'booked', repairOn: 2, contractor: 'Park Circus Joinery', data: { issue: 'Sash window cord snapped in bedroom 2; window will not stay open.', estimatedCostMinor: 22000, hazard: false, repairType: 'damage' } },
    { key: 'glencoe', who: 'callum', ago: 4, upTo: 'management_approval', data: { issue: 'Roof leak above the utility room after heavy rain; water staining on the ceiling.', estimatedCostMinor: 145000, hazard: true, repairType: 'leak', urgent: true } },
    { key: 'aberdeen', who: 'callum', ago: 9, upTo: 'owner_declined', data: { issue: 'Bathroom extractor fan not working; condensation on the window each morning.', estimatedCostMinor: 12000, hazard: false, repairType: 'electrics' } },
    { key: 'standrews', who: 'fiona', ago: 16, upTo: 'completed', repairOn: -11, contractor: 'Fife Locksmiths', actual: 8000, data: { issue: 'Front door lock stiff; key sticking in the cylinder.', estimatedCostMinor: 8500, hazard: false, repairType: 'locks_access' } },
    { key: 'inverness', who: 'callum', ago: 12, upTo: 'completed', repairOn: -8, contractor: 'Highland Networks', actual: 6000, data: { issue: 'Wi-Fi router failing; two guests reported dropouts.', estimatedCostMinor: 6000, hazard: false, repairType: 'wifi' } },
    { key: 'royalmile', who: 'fiona', ago: 24, upTo: 'completed', repairOn: -22, contractor: 'Old Town Plumbing', actual: 7500, data: { issue: 'Toilet cistern running continuously.', estimatedCostMinor: 7500, hazard: false, repairType: 'toilet_drain', urgent: true } },
    { key: 'eastneuk', who: 'moira', ago: 3, upTo: 'triage', data: { issue: 'Garden gate latch broken; the gate blows open in the wind.', estimatedCostMinor: 4500, hazard: false, repairType: 'damage' } },
  ];
  for (const r of plan) {
    await s.step(`repair ${r.key}`, async () => {
      let w = await make(r.who, r.key, r.data);
      const created = at(day(-r.ago), '10:15');
      if (w.data.phase === 'owner_approval' && r.upTo !== 'owner_approval') {
        if (r.upTo === 'owner_declined') { w = await next(owner(r.key), w, 'declineBudget', { reason: 'Please get a second quote first; the last electrician was much cheaper.' }); s.when(w.workId, created); return; }
        w = await next(owner(r.key), w, 'approveBudget', { consent: true });
      }
      if (w.data.phase === 'management_approval' && r.upTo !== 'management_approval') w = await next('morag', w, 'approveManagement', { note: 'Approved: needs doing before winter.' });
      if (['referred', 'booked', 'completed'].includes(r.upTo)) w = await next(r.who, w, 'referReady', { troubleshooting: 'Checked with the guest and tried the basics (reset, isolate, photos taken).', guestUpdate: 'We have asked our maintenance team to arrange a repair.' });
      if (['booked', 'completed'].includes(r.upTo)) w = await next(ready(r.key), w, 'bookRepair', { repairOn: day(r.repairOn), contractor: r.contractor, guestUpdate: `A contractor is booked for ${day(r.repairOn)}.` });
      if (r.upTo === 'completed') {
        const photo = await s.step(`repair photo ${r.key}`, () => s.photo(ready(r.key), w.workId, 'maintenance', 'repair'));
        w = await next(ready(r.key), w, 'completeRepair', { report: `Repair completed by ${r.contractor} and tested with the guest out.`, actualCostMinor: r.actual, guestUpdate: 'All fixed, thank you for your patience.', ...(photo ? { photoIds: [photo] } : {}) });
        s.when(w.workId, created, at(day(r.repairOn), '15:40'));
      } else s.when(w.workId, created);
    });
  }
  // A cleaner finds a problem on a clean: it becomes a repair for Stays.
  await s.step('clean problem', async () => {
    const [clean] = await s.sql(`select w.id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning' and w.status='waiting' and w.assignee_id=$1 and w.due_on>=current_date order by w.due_on limit 1`, [person('ewan').id]);
    if (!clean) return;
    const w = await s.work(clean.id);
    await s.step_('ewan', w, 'reportCleanProblem', { issue: 'Kitchen extractor hood light not working and the filter is loose.', urgent: false, repairType: 'appliance' });
  });
  // Owners with a repair waiting are chased; management reminds one owner directly.
  await s.step('owner reminder', async () => {
    const [w] = await s.sql(`select w.id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='maintenance' and d.data->>'phase'='owner_approval' limit 1`);
    if (w) await s.call('sam', 'workspace_oversight_action', { input: { action: 'remindOwner', requestId: randomUUID(), workId: w.id } });
  });
}

// Preventative and routine visits by Ready: plans, this month's visits, some done and signed off.
async function routines(s) {
  const plans = [
    ['leith', 'routine-bin-garden-board', 'Bins and communal stair check', ['Bins out on collection day', 'Stair light working', 'Entry door closes and locks'], 'monthly', 3, 'rory'],
    ['stockbridge', 'routine-bin-garden-board', 'Garden and bins', ['Lawn cut and edges trimmed', 'Bins cleaned', 'Leaves cleared from the path'], 'monthly', 5, 'rory'],
    ['standrews', 'routine-bin-garden-board', 'Garden and bins', ['Lawn cut', 'Hedges trimmed', 'Bins out'], 'monthly', 8, 'rory'],
    ['eastneuk', 'safety-maintenance', 'Quarterly safety check', ['Smoke and CO alarms tested', 'Fire blanket in place', 'Gas appliances visually checked', 'Emergency lighting tested'], 'quarterly', 12, 'rory'],
    ['glencoe', 'safety-maintenance', 'Quarterly safety check', ['Smoke and CO alarms tested', 'Wood burner and flue inspected', 'Fire extinguishers in date'], 'quarterly', 14, 'eilidh'],
    ['inverness', 'ready-schedule', 'Linen and consumables restock', ['Spare linen sets counted', 'Toiletries restocked', 'Cleaning supplies topped up'], 'monthly', 10, 'eilidh'],
    ['aberdeen', 'routine-bin-garden-board', 'Bins and stair check', ['Bins out', 'Stair light working'], 'monthly', 18, 'eilidh'],
    ['westend', 'safety-maintenance', 'Quarterly safety check', ['Smoke and CO alarms tested', 'Boiler pressure checked', 'Emergency exits clear'], 'quarterly', 20, 'rory'],
  ];
  for (const [key, moduleId, title, checklist, frequency, dayOfMonth, who] of plans) {
    await s.step(`routine plan ${key}`, () => s.teams(who, { action: 'saveRoutinePlan', propertyId: s.p[key].id, moduleId, title, checklist, frequency, dayOfMonth, assigneeId: person(who).id, active: true }));
  }
  for (const who of ['rory', 'eilidh']) await s.step(`generate visits ${who}`, () => s.teams(who, { action: 'generateRoutineVisits', period: month(0) }));
  // Visits already due this month are done and signed off; the next one is under way.
  const visits = await s.sql(`select w.id, w.version, w.status, w.due_on::text due, w.property_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='routine_visit' order by w.due_on`);
  for (const v of visits) {
    if (!v.due || v.due > day(0)) continue;
    const prop = Object.values(s.p).find(p => p.id === v.property_id);
    const ready = prop?.ready ?? 'rory', stays = prop?.stays ?? 'fiona';
    await s.step(`visit ${v.due}`, async () => {
      let w = await s.work(v.id);
      const move = async (who, status) => { await s.call(who, 'workspace_transition_work', { target_work: w.workId, expected_version: w.version, next_status: status, note: '', request_id: randomUUID() }); w = await s.work(w.workId); };
      await move(ready, 'in_progress');
      if (v.due === day(0)) { s.when(w.workId, at(day(-9), '08:00')); return; }
      await move(ready, 'in_review');
      if (v.due >= day(-2)) { s.when(w.workId, at(day(-9), '08:00'), at(v.due, '11:30')); return; }
      await move(stays, 'approved');
      await move(stays, 'completed');
      s.when(w.workId, at(day(-9), '08:00'), at(v.due, '16:00'));
    });
  }
}

async function purchases(s) {
  const id = key => s.p[key].id;
  const budget = Object.fromEntries((await s.sql('select id, item from private.workspace_purchase_budget')).map(b => [b.item, b.id]));
  const plan = [
    { key: 'leith', who: 'fiona', ago: 14, requirements: 'Two dining chairs to replace the one broken by a guest and keep the set matching.', budgetMinor: 15000, approve: [11000, 'Dining chair', 2], order: ['ORD-48213', 'Scandi Home Supplies'], deliver: -9, invoice: ['SHS-INV-2291', 10800] },
    { key: 'merchant', who: 'callum', ago: 5, requirements: 'New kettle and toaster; the kettle has scale damage and the toaster burns one side.', budgetMinor: 6000, approve: [5800, null, null], order: ['ORD-48377', 'Glasgow Kitchen Store'] },
    { key: 'glencoe', who: 'eilidh', ago: 7, requirements: 'Replacement hoover; the cordless one no longer holds a charge.', budgetMinor: 15000, approve: [14500, 'Hoover', 1], order: ['ORD-48301', 'Fort William Electrical'], deliver: -2 },
    { key: 'westend', who: 'callum', ago: 2, requirements: 'Four new towel sets for the summer turnover stock.', budgetMinor: 7200 },
    { key: 'stockbridge', who: 'catriona', ago: 1, requirements: 'Quote for a smart lock on the front door so guests can self check in.', budgetMinor: 25000 },
    { key: 'inverness', who: 'eilidh', ago: 4, requirements: 'Two bedside lamps for the second bedroom.', budgetMinor: 5000, approve: [5000, 'Bedside lamp', 2] },
  ];
  for (const p of plan) {
    await s.step(`purchase ${p.key}`, async () => {
      let w = await s.op(p.who, { action: 'createOperation', propertyId: id(p.key), kind: 'purchase', data: { requirements: p.requirements, budgetMinor: p.budgetMinor } });
      w = await s.work(w.workId);
      const created = at(day(-p.ago), '11:20');
      s.when(w.workId, created);
      if (!p.approve) return;
      w = await s.work((await s.step_('graham', w, 'approvePurchase', { approvedAmountMinor: p.approve[0], approvalNote: 'Within the budget chart.', ...(p.approve[1] && budget[p.approve[1]] ? { budgetItemId: budget[p.approve[1]], quantity: p.approve[2] } : {}) })).workId);
      if (!p.order) return;
      w = await s.work((await s.step_('graham', w, 'recordOrder', { orderReference: p.order[0], supplier: p.order[1] })).workId);
      if (p.deliver === undefined) return;
      const ready = PROPERTIES.find(x => x.key === p.key).ready;
      const photo = await s.photo(ready, w.workId, 'delivery', 'delivery');
      w = await s.work((await s.step_(ready, w, 'recordDelivery', { receivedOn: day(p.deliver), evidence: 'Delivered, unboxed and checked; packaging taken to recycling.', photoIds: [photo] })).workId);
      if (!p.invoice) { s.when(w.workId, created, at(day(p.deliver), '14:00')); return; }
      const inv = await s.accounts('graham', { action: 'recordPurchaseInvoice', purchaseId: w.workId, reference: p.invoice[0], amountMinor: p.invoice[1], paid: true });
      w = await s.work(w.workId);
      await s.step_('graham', w, 'reconcilePurchase', { invoiceId: inv.invoiceId, reconciliation: 'Supplier invoice matches the order and the delivery photos.' });
      s.when(w.workId, created, at(day(p.deliver + 2), '10:30'));
    });
  }
}

// Stays: daily listing checks, guest reviews, pricing decisions for empty nights, the daily sign-off.
async function listings(s) {
  const active = PROPERTIES.map(p => p.key);
  for (const offset of [-3, -2, -1, 0]) {
    for (const key of active) {
      const p = PROPERTIES.find(x => x.key === key);
      const suspended = offset === 0 && key === 'aberdeen';
      await s.step(`listing check ${key} ${offset}`, async () => {
        const w = await s.op(p.stays, { action: 'createOperation', propertyId: s.p[key].id, kind: 'listing_health', data: { checkedOn: day(offset), platform: suspended ? 'Booking.com' : 'Airbnb', listingVisible: !suspended, reviewSentiment: offset === -1 && key === 'merchant' ? 'negative' : 'none', reviewAcknowledged: true, suspended, evidence: suspended ? 'Booking.com shows the listing as closed: missing licence number on the extranet.' : 'Listing live, calendar synced, photos and price correct.' } });
        s.when(w.workId, at(day(offset), '09:' + String(10 + active.indexOf(key) * 3).padStart(2, '0')), at(day(offset), '09:' + String(11 + active.indexOf(key) * 3).padStart(2, '0')));
      });
    }
  }
  const reviews = [
    ['leith', 'Airbnb', -12, 5, 5, 'positive', 'Lovely flat by the water, spotless and well equipped.', false],
    ['stockbridge', 'Booking.com', -9, 9, 10, 'positive', 'Beautiful mews house, quiet and close to the village.', false],
    ['merchant', 'Airbnb', -6, 3, 5, 'negative', 'Noisy at night from the bars below; bed was too soft.', true],
    ['standrews', 'Airbnb', -5, 5, 5, 'positive', 'Perfect for golf week, two minutes to the Old Course.', false],
    ['glencoe', 'Booking.com', -4, 10, 10, 'positive', 'Stunning views, wood burner was a highlight.', false],
    ['westend', 'Airbnb', -3, 4, 5, 'neutral', 'Great space for the family; one bedroom blind was broken.', false],
    ['inverness', 'Airbnb', -2, 5, 5, 'positive', 'Walking distance to everything, host team very responsive.', false],
    ['eastneuk', 'Booking.com', -1, 8, 10, 'positive', 'Charming harbour house, fish and chips next door!', false],
  ];
  for (const [key, platform, offset, rating, outOf, sentiment, summary, relist] of reviews) {
    await s.step(`review ${key}`, async () => {
      const w = await s.op(PROPERTIES.find(x => x.key === key).stays, { action: 'createOperation', propertyId: s.p[key].id, kind: 'guest_review', data: { platform, reviewedOn: day(offset), rating, outOf, sentiment, summary, relist, ...(sentiment === 'negative' ? { response: 'Thank you for the feedback; we have fitted secondary glazing in the bedroom and replaced the mattress topper.' } : {}) } });
      s.when(w.workId, at(day(offset), '18:30'), at(day(offset), '18:31'));
    });
  }
  // Pricing decisions for empty nights in the next week.
  let decisions = 0;
  for (const p of PROPERTIES) {
    for (let offset = 0; offset <= 6 && decisions < 9; offset++) {
      const night = day(offset);
      const occupied = s.reservations.some(r => r.property === p.key && r.status === 'confirmed' && r.checkIn <= night && r.checkOut > night);
      if (occupied) continue;
      const current = p.nightly * 100, change = rand() < 0.7;
      await s.step(`pricing ${p.key} ${night}`, async () => {
        const w = await s.op(p.stays, { action: 'createOperation', propertyId: s.p[p.key].id, kind: 'daily_pricing', data: { night, currentRateMinor: current, proposedRateMinor: change ? Math.round(current * 0.88 / 100) * 100 : current, decision: change ? 'change' : 'hold', reason: change ? 'Still empty and nearby listings have dropped their rates.' : 'Event in town; holding the rate for late bookings.' } });
        decisions++;
        if (decisions % 2 === 0) await s.step_(p.stays, await s.work(w.workId), 'recordApplied', { evidence: 'New rate set on Airbnb and Booking.com.' });
      });
      break;
    }
  }
  // The backend opens pricing gaps for empty nights it finds.
  await s.step('pricing gaps', () => s.call('service', 'workspace_open_pricing_gaps', {}));
  await s.step('daily sign-off', () => s.teams('callum', { action: 'signOffDay', allVisible: true, reviewsHandled: true, suspensionsHandled: true, relistingsDone: true, note: 'All Glasgow and north listings live; Aberdeen Booking.com closure passed to Fiona.' }));
}

// Direct enquiries for longer stays: one quoted, one accepted and invoiced, one confirmed.
async function directBookings(s) {
  const plan = [['stockbridge', 'Henderson family', 36, 6, 'quote'], ['standrews', 'Dr K. Ferguson', 40, 5, 'accepted'], ['glencoe', 'Hillwalkers club', 34, 4, 'confirmed'], ['westend', 'Conference team', 45, 4, 'enquiry']];
  for (const [key, ref, start, nights, upTo] of plan) {
    await s.step(`direct booking ${key}`, async () => {
      const p = PROPERTIES.find(x => x.key === key);
      const recorded = await s.op(p.stays, { action: 'recordReservation', propertyId: s.p[key].id, reference: ref, checkIn: day(start), checkOut: day(start + nights), status: 'enquiry' });
      if (!recorded.followUpWorkId) return;
      let w = await s.work(recorded.followUpWorkId);
      s.when(w.workId, at(day(-4), '14:00'));
      if (upTo === 'enquiry') return;
      w = await s.work((await s.step_(p.stays, w, 'prepareQuote', { checkIn: day(start), checkOut: day(start + nights), baseAmountMinor: p.nightly * nights * 100 })).workId);
      if (upTo === 'quote') return;
      w = await s.work((await s.step_(p.stays, w, 'recordGuestAcceptance', { guestEvidence: 'Guest accepted the quote by email and asked for the invoice.' })).workId);
      const invoice = await s.controls('graham', { action: 'issueOperationInvoice', propertyId: s.p[key].id, workId: w.workId, reference: `DIRECT-${key.toUpperCase()}-${start}`, amountMinor: w.data.quoteAmountMinor ?? p.nightly * nights * 90 });
      if (upTo === 'accepted') return;
      w = await s.work(w.workId);
      const invoiceId = invoice?.invoiceId ?? invoice?.id ?? invoice;
      await s.call('graham', 'workspace_set_invoice_status', { target_invoice: invoiceId, expected_version: 1, next_status: 'paid' }).catch(() => undefined);
      await s.step_(p.stays, w, 'confirmBooking', { invoiceId, reference: `DIRECT-${key.toUpperCase()}-${start}` });
    });
  }
}

// Accounts: expenses, payout reports, owner statements, invoices.
async function finance(s) {
  const id = key => s.p[key].id;
  const expenses = [
    ['leith', 'Leith Plumbing & Heating', 'LPH-7731', 'maintenance', 'Boiler service and pressure valve replacement.', 16800, -20, 'approve'],
    ['westend', 'Clyde Electrical', 'CE-2210', 'maintenance', 'Replaced faulty kitchen spur and tested circuits.', 9450, -15, 'approve'],
    ['glencoe', 'Highland Roofing', 'HR-0981', 'maintenance', 'Emergency tarpaulin over the utility room roof.', 62000, -4, 'over'],
    ['merchant', 'CleanCo Supplies', 'CC-55120', 'cleaning_supplies', 'Monthly cleaning supplies for the Glasgow properties.', 18640, -8, 'evidence'],
    ['stockbridge', 'Scottish Water', 'SW-2026-09', 'utilities', 'Water and sewerage charges, September.', 4850, -10, 'query'],
    ['standrews', 'Fife Linen Services', 'FLS-3302', 'cleaning_supplies', 'Linen hire for golf week turnovers.', 21200, -6, 'evidence'],
    ['aberdeen', 'Granite City Locks', 'GCL-118', 'maintenance', 'Lock change after lost key.', 13500, -18, 'reject'],
    ['inverness', 'Ness Furnishings', 'NF-7790', 'furnishing', 'Replacement sofa bed for the living room.', 42900, -3, 'new'],
  ];
  for (const [key, supplier, reference, category, description, amountMinor, offset, outcome] of expenses) {
    await s.step(`expense ${reference}`, async () => {
      let e = await s.finance('graham', { action: 'createExpense', propertyId: id(key), supplier, reference, category, description, amountMinor, receivedOn: day(offset), source: offset % 2 ? 'email' : 'manual', ...(offset % 2 ? { sender: `accounts@${supplier.toLowerCase().replace(/[^a-z]+/g, '')}.example` } : {}) });
      if (outcome === 'new') return;
      if (outcome === 'query') { await s.finance('graham', { action: 'queryExpense', expenseId: e.id, version: e.version, note: 'Is this for the main house or the annexe meter?' }); return; }
      if (outcome === 'reject') { await s.finance('graham', { action: 'rejectExpense', expenseId: e.id, version: e.version, note: 'Duplicate of an invoice already paid by the owner.' }); return; }
      await s.finance('graham', { action: 'addExpenseEvidence', expenseId: e.id, kind: 'invoice', label: 'Supplier invoice', note: 'Invoice PDF checked against the quote and the job.' });
      e = await s.finance('graham', { action: 'addExpenseEvidence', expenseId: e.id, kind: 'photo', label: 'Completion photos', note: 'Ready sent photos of the finished work.' });
      if (outcome === 'evidence' || outcome === 'over') return;
      await s.finance('graham', { action: 'approveExpense', expenseId: e.id, version: e.version, note: 'Matches the job and the quote.' });
    });
  }
  // Statement terms (management), then payouts for last month and this month.
  for (const p of PROPERTIES) await s.step(`statement terms ${p.key}`, () => s.finance('morag', { action: 'setStatementTerms', propertyId: id(p.key), managementFeeBps: p.nightly > 200 ? 1800 : 2000, cleaningCostMinor: { 1: 4000, 2: 4500, 3: 5500, 4: 6500 }[p.bedrooms] }));
  const lastMonth = month(-1), thisMonth = month(0);
  const inMonth = (r, m) => r.status === 'confirmed' && r.checkIn.slice(0, 7) === m && r.checkIn <= day(0);
  // Platform payout reports: most stays paid as expected, a few with adjustments, one code we do not know.
  for (const [channel, m] of [['airbnb', lastMonth], ['booking_com', lastMonth], ['airbnb', thisMonth]]) {
    await s.step(`payout report ${channel} ${m}`, async () => {
      const rows = s.reservations.filter(r => inMonth(r, m) && r.channel === channel && (m === lastMonth || r.checkIn <= day(-3)));
      const lines = rows.map((r, i) => ({ reference: r.channelReference, amountMinor: i % 7 === 3 ? r.payoutMinor - 1500 : r.payoutMinor }));
      if (m === lastMonth) lines.push({ reference: channel === 'airbnb' ? 'HMZZ4KQ2TX' : '4999123456', amountMinor: 18900 });
      if (lines.length) await s.finance('graham', { action: 'importPayoutReport', channel, fileName: `${channel}-payouts-${m}.csv`, lines });
    });
  }
  await s.step('payout reconciliation', async () => {
    const rec = await s.call('graham', 'workspace_finance_read', { section: 'reconciliation', target_property: null, period: lastMonth, target_id: null, status_filter: null });
    const rows = rec?.rows ?? [];
    // Each payout that differs from what was expected is checked and agreed one by one.
    for (const r of rows.filter(r => r.state === 'different')) await s.finance('graham', { action: 'agreePayout', reservationId: r.reservationId, version: r.version, agreedMinor: r.receivedMinor, note: 'Platform resolution fee deducted; confirmed on the payout statement.' }).catch(e => s.skipped.push('agree payout: ' + e.message));
    const unexpected = (rec?.unexpected ?? [])[0];
    if (unexpected) await s.finance('graham', { action: 'setAsidePayoutLine', lineId: unexpected.lineId, note: 'Belongs to a property Recharge no longer manages.' }).catch(e => s.skipped.push('set aside: ' + e.message));
  });
  // Owner statements for last month: most issued and paid, one issued awaiting payment, one draft.
  for (const [i, p] of PROPERTIES.entries()) {
    await s.step(`statement ${p.key}`, async () => {
      let st = await s.finance('graham', { action: 'prepareStatement', propertyId: id(p.key), period: lastMonth });
      if (i === PROPERTIES.length - 1) return;
      st = await s.finance('graham', { action: 'issueStatement', statementId: st.id, version: st.version });
      if (i % 4 === 3) return;
      await s.call('morag', 'workspace_oversight_action', { input: { action: 'approvePayout', requestId: randomUUID(), statementId: st.id, version: st.version, note: 'Checked against the payout report.' } }).then(r => { if (r?.version) st = { ...st, version: r.version }; }).catch(() => undefined);
      const fresh = (await s.sql('select version from private.workspace_owner_statements where id=$1', [st.id]))[0];
      await s.finance('graham', { action: 'recordOwnerPayout', statementId: st.id, version: fresh?.version ?? st.version, method: 'bank_transfer', reference: `BACS-${lastMonth.replace('-', '')}-${String(i + 1).padStart(2, '0')}` });
    });
  }
  // Accepted cleans are invoiced to the owners (the clean itself is the invoiced work).
  await s.step('cleaning invoices', async () => {
    const cleans = await s.sql(`select w.id, w.version, w.property_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' order by w.due_on limit 24`);
    for (const [i, c] of cleans.entries()) {
      if (i % 4 === 3) continue;
      const prop = PROPERTIES.find(p => s.p[p.key].id === c.property_id);
      const inv = await s.controls('graham', { action: 'issueOperationInvoice', propertyId: c.property_id, workId: c.id, version: c.version, recipientId: person(prop.owner).id, reference: `CLN-${month(0).replace('-', '')}-${String(i + 1).padStart(3, '0')}`, amountMinor: { 1: 4000, 2: 4500, 3: 5500, 4: 6500 }[prop?.bedrooms ?? 2] }).catch(e => { s.skipped.push('clean invoice: ' + e.message); return null; });
      if (inv?.invoiceId && i < 14) await s.call('graham', 'workspace_set_invoice_status', { target_invoice: inv.invoiceId, expected_version: 1, next_status: 'paid' }).catch(e => s.skipped.push('invoice paid: ' + e.message));
    }
  });
}

// The hub: to-dos, approval tickets, AirCover claims and invoices to send; the responsibilities register.
async function hub(s) {
  const items = [
    ['morag', { kind: 'todo', title: 'Send the onboarding pack to the Nairn owner', assigneeId: person('callum').id, dueOn: day(1), propertyId: s.p.nairn?.id ?? null }],
    ['morag', { kind: 'todo', title: 'Call back every owner who messaged today', department: 'client_relations', dueOn: day(0) }],
    ['fiona', { kind: 'todo', title: 'Update Edinburgh listings with Hogmanay minimum stays', department: 'guest_relations', dueOn: day(4) }],
    ['isla', { kind: 'todo', title: 'Order spare linen for the Highlands properties', department: 'cleaning', dueOn: day(2), assigneeId: person('isla').id }],
    ['rory', { kind: 'todo', title: 'Collect the spare keys from the Stockbridge neighbour', assigneeId: person('rory').id, dueOn: day(-1), propertyId: s.p.stockbridge.id }],
    ['graham', { kind: 'todo', title: 'Chase Scottish Water about the Stockbridge meter', department: 'accounts', dueOn: day(3) }],
    ['isla', { kind: 'approval', title: 'New steam cleaner for the Glasgow team', amountMinor: 18999, details: 'The old one leaks; this model has a 2-year warranty.' }],
    ['callum', { kind: 'approval', title: 'Welcome hampers for the golf week guests', amountMinor: 24000, details: 'Six hampers at £40 for St Andrews and East Neuk.' }],
    ['fiona', { kind: 'aircover', title: 'Red wine stain on the Leith sofa', amountMinor: 32000, propertyId: s.p.leith.id, reference: 'HM' + code(8), details: 'Guest admitted it; photos and cleaner report attached.' }],
    ['callum', { kind: 'aircover', title: 'Broken glass table top at the West End Townhouse', amountMinor: 45000, propertyId: s.p.westend.id, reference: 'HM' + code(8) }],
    ['graham', { kind: 'invoice', title: 'Invoice the Pitlochry owner for the photography shoot', amountMinor: 15000, reference: 'PHOTO-PIT-01', propertyId: s.p.pitlochry?.id ?? null }],
    ['graham', { kind: 'invoice', title: 'Linen recharge to the St Andrews owner', amountMinor: 8600, reference: 'LIN-STA-09', propertyId: s.p.standrews.id }],
  ];
  const saved = [];
  for (const [who, item] of items) {
    const r = await s.step(`hub ${item.title}`, () => s.teams(who, { action: 'saveHubItem', ...item }));
    if (r) saved.push({ who, item, r });
  }
  const move = async (who, entry, status, extra = {}) => s.step(`hub move ${entry.item.title}`, () => s.teams(who, { action: 'moveHubItem', id: entry.r.id, version: entry.r.version, status, ...extra }));
  const find = title => saved.find(x => x.item.title === title);
  if (find('Collect the spare keys from the Stockbridge neighbour')) await move('rory', find('Collect the spare keys from the Stockbridge neighbour'), 'done');
  if (find('New steam cleaner for the Glasgow team')) await move('morag', find('New steam cleaner for the Glasgow team'), 'approved', { note: 'Approved, order through Graham.' });
  if (find('Red wine stain on the Leith sofa')) await move('fiona', find('Red wine stain on the Leith sofa'), 'claimed', { note: 'Claim submitted to Airbnb with photos.' });
  if (find('Linen recharge to the St Andrews owner')) await move('graham', find('Linen recharge to the St Andrews owner'), 'sent', { note: 'Sent with the September statement.' });
  const responsibilities = [
    ['guest_relations', 'Reply to guest messages within 10 minutes', 'fiona', 'callum', 'daily'],
    ['guest_relations', 'Daily listing checks and sign-off', 'callum', 'fiona', 'daily'],
    ['cleaning', 'Assign and review every clean', 'isla', 'morag', 'daily'],
    ['ready', 'Routine visits and safety checks', 'rory', 'eilidh', 'monthly'],
    ['accounts', 'Owner statements and payouts', 'graham', 'morag', 'monthly'],
    ['management', 'Approve repairs over the limit', 'morag', 'sam', 'as_needed'],
    ['client_relations', 'Owner onboarding calls', 'morag', 'callum', 'weekly'],
  ];
  for (const [department, title, owner, backup, frequency] of responsibilities) await s.step(`responsibility ${title}`, () => s.teams('sam', { action: 'saveResponsibility', department, title, details: '', ownerId: person(owner).id, backupId: person(backup).id, frequency }));
}

// Team time: usual shifts, this week's rota, past shifts (clocked by each person), today's clock-ins.
async function teamTime(s) {
  const staff = [['fiona', 'guest_relations', 'early'], ['callum', 'guest_relations', 'late'], ['isla', 'cleaning', 'early'], ['rory', 'ready', 'early'], ['eilidh', 'ready', 'both'], ['graham', 'accounts', 'early'], ['morag', 'management', 'both']];
  for (const [who, department, usualShift] of staff) await s.step(`rota ${who}`, () => s.teams('morag', { action: 'saveRota', userId: person(who).id, department, usualShift }));
  for (const [who, department, usual] of staff) {
    const days = [];
    for (let o = -1; o <= 12; o++) {
      const dow = new Date(day(o) + 'T12:00:00Z').getUTCDay();
      days.push({ day: day(o), shift: dow === 0 || (dow === 6 && who !== 'callum') ? 'off' : usual, department });
    }
    await s.step(`plan rota ${who}`, () => s.teams('morag', { action: 'planRota', userId: person(who).id, days }));
  }
  for (const [n, [who, department, usual]] of staff.entries()) {
    for (let o = -150; o <= -1; o++) {
      const dow = new Date(day(o) + 'T12:00:00Z').getUTCDay();
      if (dow === 0 || (dow === 6 && who !== 'callum')) continue;
      // A week's holiday each, at different times, and the odd day off.
      if ((o <= -40 - n * 14 && o > -45 - n * 14) || (o * 7 + n * 3) % 23 === 0) continue;
      const start = usual === 'late' ? '13:00' : '08:' + pick(['25', '30', '35', '45']);
      const end = usual === 'late' ? '21:' + pick(['00', '10', '30']) : usual === 'both' ? '18:' + pick(['00', '15', '30']) : '16:' + pick(['30', '45', '55']);
      // As each person clocked in and out (nobody can enter their own hours).
      await s.step(`shift ${who} ${o}`, () => s.sql(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,$2,$3,$4,gen_random_uuid())`, [person(who).id, department, at(day(o), start), at(day(o), end)]));
    }
  }
  // Hours are locked: Morag (admin) asks for corrections, Sam (super admin) decides. Two wait for
  // Sam, one was approved and one declined.
  const weekday = o => { while ([0, 6].includes(new Date(day(o) + 'T12:00:00Z').getUTCDay())) o -= 1; return o; };
  const shiftOn = async (who, o) => (await s.sql(`select id from private.workspace_shifts where user_id=$1 and (clocked_in_at at time zone 'Europe/London')::date=$2`, [person(who).id, day(o)]))[0]?.id;
  const ask = async (who, o, start, end, note) => s.teams('morag', { action: 'editShift', shiftId: await shiftOn(who, o), clockedInAt: at(day(o), start), clockedOutAt: at(day(o), end), note });
  await s.step('shift change approved', async () => { const c = await ask('isla', weekday(-6), '08:00', '17:15', 'Stayed for a late deep clean at Leith Shore'); await s.teams('sam', { action: 'decideShiftChange', changeId: c.id, decision: 'approve', note: 'Matches the clean report' }); });
  await s.step('shift change declined', async () => { const c = await ask('graham', weekday(-5), '07:30', '17:00', 'Started early for month end'); await s.teams('sam', { action: 'decideShiftChange', changeId: c.id, decision: 'decline', note: 'The door log shows 08:30' }); });
  await s.step('shift change waiting 1', () => ask('fiona', weekday(-2), '08:00', '17:30', 'Covered the late check-in at Stockbridge'));
  await s.step('shift change waiting 2', () => ask('rory', weekday(-3), '07:45', '16:45', 'Forgot to clock in at the start of a boiler call-out'));
  await s.step('shift added waiting', () => s.teams('morag', { action: 'addShift', userId: person('callum').id, clockedInAt: at(day(-7), '13:00'), clockedOutAt: at(day(-7), '21:00'), department: 'guest_relations', note: 'Covered the Saturday evening shift but the app was down' }));
  // Today: the early shift has clocked in.
  for (const [who, department] of [['fiona', 'guest_relations'], ['isla', 'cleaning'], ['rory', 'ready'], ['graham', 'accounts'], ['morag', 'management']]) {
    await s.step(`clock in ${who}`, async () => {
      await s.teams(who, { action: 'clockIn', department });
      await s.sql(`update private.workspace_shifts set clocked_in_at = $2 where user_id = $1 and clocked_out_at is null`, [person(who).id, at(day(0), '08:' + pick(['28', '34', '41', '52']))]);
    });
  }
}

// Client enquiries: forms sent to landlords. Two answered and waiting to be valued (one with
// photos), one being valued, one sent and opened, one just sent, one closed.
async function clientEnquiries(s) {
  const hash = t => createHash('sha256').update(t).digest('hex');
  const body = name => `Hi ${name.split(' ')[0]},\n\nThank you for your interest in Recharge. To prepare your free performance estimate, please fill in our short property form using the link below.\n\nKind regards,\nThe Recharge team`;
  const invite = (who, name, email) => s.call(who, 'workspace_teams_action', { input: { action: 'inviteEnquiry', requestId: randomUUID(), tokenHash: hash(name + email), name, email, subject: 'Your free property performance estimate from Recharge', body: body(name), delivery: 'email' } });
  const answer = (name, email, extra) => s.call('service', 'workspace_enquiry_public', { input: { action: 'submit', tokenHash: hash(name + email), answers: {
    fullName: name, correspondenceAddress: extra.home, email, phone: extra.phone, existingClient: 'no', propertyAddress: extra.address, propertyType: extra.type, bedrooms: extra.beds, wcs: extra.wcs ?? 1, bathrooms: extra.baths,
    shortLet: extra.shortLet ?? 'no', furnishQuote: extra.furnish ?? 'yes', compliance: 'yes', enquiryType: extra.kind, ...(extra.more ?? {}) } } });
  const at = (name, email, ago) => s.sql(`update private.workspace_client_enquiries set sent_at=now()-($2||' hours')::interval, opened_at=case when opened_at is not null then now()-($2||' hours')::interval+interval '2 hours' end,
    submitted_at=case when submitted_at is not null then now()-($2||' hours')::interval+interval '5 hours' end where token_hash=$1`, [hash(name + email), String(ago)]);
  const people = [
    ['Eilidh Robertson', 'eilidh.robertson@example.com', 'morag', { home: '22 Marchmont Road\nEdinburgh EH9 1HY', phone: '07700 900412', address: '3F2, 17 Warrender Park Road, Edinburgh EH9 1EU', type: 'Flat', beds: 2, baths: 1, kind: "I'd like a free performance estimate",
      more: { companyName: 'Robertson Property Ltd', parking: 'Permit parking on the street', garden: 'Shared back green', startWhen: 'Within a month', notes: 'Currently let on a long-term lease ending in December.', mediaLink: 'https://photos.example.com/warrender-park' } }, 30, 'answered', true],
    ['Douglas Fraser', 'douglas.fraser@example.com', 'fiona', { home: 'Ardmore Farm\nPitlochry PH16 5JZ', phone: '01796 472 118', address: 'The Bothy, Ardmore Farm, Pitlochry PH16 5JZ', type: 'Cottage', beds: 3, baths: 2, kind: 'My property is already a short-term let and I want a new manager', shortLet: 'yes', furnish: 'no',
      more: { parking: 'Private, two cars', garden: 'Private garden with a view of the hills', startWhen: 'As soon as possible' } }, 6, 'answered'],
    ['Priya Nair', 'priya.nair@example.com', 'morag', { home: '9 Hyndland Road\nGlasgow G12 9UX', phone: '+44 7700 900877', address: '41 Kelvinhaugh Street, Glasgow G3 8NU', type: 'Flat', beds: 1, baths: 1, kind: "I'm thinking about switching from long-term letting", more: { startWhen: 'In 1 to 3 months' } }, 120, 'valuing'],
    ['Callum Reid', 'callum.reid@example.com', 'fiona', null, 50, 'opened'],
    ['Margaret Shaw', 'margaret.shaw@example.com', 'morag', null, 3, 'sent'],
    ['Graeme Wilson', 'graeme.wilson@example.com', 'morag', null, 400, 'closed'],
  ];
  for (const [name, email, who, extra, ago, state, photos] of people) {
    await s.step(`enquiry ${name}`, async () => {
      const sent = await invite(who, name, email);
      await s.call(who, 'workspace_teams_action', { input: { action: 'markEnquiryEmail', requestId: randomUUID(), enquiryId: sent.id, emailStatus: 'sent' } });
      if (state !== 'sent') await s.call('service', 'workspace_enquiry_public', { input: { action: 'open', tokenHash: hash(name + email) } });
      if (photos) for (const [scene, n] of [['living', 1], ['kitchen', 2], ['bedroom', 3]]) {
        const bytes = roomPhoto(scene, 4111 * n, 640, 480), id = randomUUID(), path = `enquiries/${sent.id}/${id}.png`;
        await storageLink('enquiry-files', path, `${scene}-enquiry.png`, bytes);
        await s.call('service', 'workspace_enquiry_public', { input: { action: 'addFile', tokenHash: hash(name + email), file: { id, path, name: `${scene}.png`, mime: 'image/png', bytes: bytes.length } } });
      }
      if (extra) await answer(name, email, extra);
      if (state === 'valuing') {
        const [row] = await s.sql('select version, answers from private.workspace_client_enquiries where id=$1', [sent.id]);
        const a = row.answers;
        await s.teams(who, { action: 'startValuing', enquiryId: sent.id, version: row.version, name: a.propertyAddress.split(',')[0], address: a.propertyAddress, region: 'Glasgow', propertyType: a.propertyType, bedrooms: a.bedrooms, bathrooms: a.bathrooms,
          enquiry: { contactName: a.fullName, email: a.email, phone: a.phone, existingClient: false, wcs: a.wcs, notes: `Enquiry: ${a.enquiryType}` } });
      }
      if (state === 'closed') await s.teams(who, { action: 'closeEnquiry', enquiryId: sent.id, version: 1, note: 'Sold the property before we could value it' });
      await at(name, email, ago);
    });
  }
}

// Staff onboarding: contracts everyone signs and courses (some required), all finished so tools open.
async function training(s) {
  const staff = PEOPLE.filter(p => !['client', 'super_admin', 'admin'].includes(p.role));
  const contracts = [
    ['Recharge team agreement', ['all'], 'Recharge team agreement (sample). You agree to follow Recharge policies, keep guest and owner details private, and use the app to record your work.'],
    ['Cleaning standards agreement', ['cleans', 'cleaning_manager'], 'Cleaning standards (sample). Every clean follows the checklist, photos are taken of each room, and problems are reported the same day.'],
  ];
  for (const [title, audience, body] of contracts) {
    await s.step(`contract ${title}`, async () => {
      const c = await s.teams('sam', { action: 'saveContract', title, audience, body, active: true });
      for (const p of staff.filter(x => audience.includes('all') || audience.includes(x.role))) await s.step(`sign ${title} ${p.key}`, () => s.teams(p.key, { action: 'signContract', contractId: c.id, version: c.version, signedName: p.fullName, agree: true }));
    });
  }
  const courses = [
    ['Welcome to Recharge', ['all'], 'How Recharge works: our properties, the teams, and how the app ties it together.', 20, true],
    ['Fire safety in short lets', ['all'], 'Alarms, escape routes, fire blankets and what to do if an alarm sounds during a stay.', 25, true],
    ['Guest arrival checks', ['stays', 'cleans', 'cleaning_manager'], 'Check the key safe, heating, hot water and Wi-Fi before every arrival, and record anything odd.', 15, true],
    ['Turnover standards', ['cleans', 'cleaning_manager'], 'Strip the beds first, then work top to bottom, room by room. Photograph each room from the doorway.', 30, true],
    ['Handling guest complaints', ['stays'], 'Acknowledge within ten minutes, apologise once, fix or offer a remedy, and log it.', 20, false],
    ['Reading owner statements', ['accounts', 'stays'], 'What goes into a statement: payouts, fees, cleaning and approved expenses.', 15, false],
    ['Working at height', ['ready'], 'Ladders, roof access and when to call a contractor instead.', 20, false],
  ];
  for (const [i, [title, audience, body, minutes, required]] of courses.entries()) {
    await s.step(`course ${title}`, async () => {
      const c = await s.teams('morag', { action: 'saveCourse', title, audience, summary: body.split('.')[0] + '.', body: body + '\n\nThis is sample training content on the devstack.', minutes, published: true });
      if (required) await s.teams('morag', { action: 'setCourseRequired', courseId: c.id, required: true });
      for (const p of staff.filter(x => audience.includes('all') || audience.includes(x.role))) {
        // Optional courses: about half the team has done them.
        if (!required && (p.n + i) % 2) continue;
        await s.step(`complete ${title} ${p.key}`, () => s.teams(p.key, { action: 'completeCourse', courseId: c.id }));
      }
    });
  }
}

// Messages: department channels, direct and group chats, a property team, owners.
async function chat(s) {
  await s.chat('sam', { action: 'openTeams' });
  const list = async who => s.call(who, 'workspace_chat_read', { section: 'list', target: null, before_at: null });
  const channels = Object.fromEntries((await list('sam')).filter(c => c.department).map(c => [c.department, c.id]));
  const sent = [];
  const send = async (who, conversationId, body, when) => {
    const r = await s.step(`chat ${body.slice(0, 30)}`, () => s.chat(who, { action: 'send', requestId: randomUUID(), conversationId, body }));
    if (r) sent.push({ conversationId, when, body });
  };
  const script = [
    ['all', [['sam', -6, '09:02', 'Morning all! Golf week in St Andrews starts Monday: every cottage is full, so expect same-day turnovers.'], ['isla', -6, '09:15', 'Noted. Jamie and Kirsty are both on for the Fife cleans that week.'], ['morag', -2, '17:40', 'Reminder: the new fire safety course is required for everyone by Friday.'], ['fiona', 0, '08:51', 'Heads up: Aberdeen is closed on Booking.com this morning, I am on it.']]],
    ['management', [['morag', -3, '11:20', 'Glencoe roof quote is £1,450; it needs our approval as it is over the limit.'], ['sam', -3, '11:42', 'Let us get a second quote by Thursday, but approve if it is similar.']]],
    ['guest_relations', [['callum', -1, '19:05', 'Merchant City guests complaining about bar noise again; offered a late checkout.'], ['fiona', -1, '19:12', 'Good call. Shall we add earplugs to the welcome pack there?'], ['callum', -1, '19:13', 'Yes, I will ask Isla.']]],
    ['cleaning', [['isla', -1, '18:30', 'Tomorrow: Ewan on Leith and Stockbridge, Kirsty on Merchant City, Jamie on St Andrews.'], ['ewan', -1, '18:44', 'Can I start Stockbridge at 10:30? Guests leave late.'], ['isla', -1, '18:50', 'Yes, it is a 4pm arrival.'], ['kirsty', 0, '07:58', 'Running 15 minutes late, traffic on the M8.']]],
    ['ready', [['rory', -2, '16:10', 'St Andrews lock done, invoice to follow from Fife Locksmiths.'], ['eilidh', 0, '09:30', 'Heading to Glencoe to check the tarpaulin after last night.']]],
    ['accounts', [['graham', -1, '15:00', 'September statements are out; Aberdeen draft waiting on one expense query.'], ['morag', -1, '15:22', 'Thanks Graham, I will look at the Aberdeen one tomorrow.']]],
  ];
  for (const [department, messages] of script) for (const [who, o, time, body] of messages) if (channels[department]) await send(who, channels[department], body, at(day(o), time));
  // Direct, group and property conversations.
  const direct = await s.step('direct chat', () => s.chat('isla', { action: 'startDirect', userId: person('ewan').id }));
  if (direct) for (const [who, o, time, body] of [['isla', -1, '12:01', 'Can you take the 2pm clean at Royal Mile tomorrow as well?'], ['ewan', -1, '12:09', 'Yes, no problem. Is the key safe code the same?'], ['isla', -1, '12:10', 'Same code, it is on the clean.']]) await send(who, direct.id, body, at(day(o), time));
  const dm2 = await s.step('direct chat 2', () => s.chat('sam', { action: 'startDirect', userId: person('morag').id }));
  if (dm2) for (const [who, o, time, body] of [['sam', -4, '08:30', 'Can we review the Highlands onboarding pipeline on Friday?'], ['morag', -4, '08:47', 'Yes. Aviemore is at inspection, Nairn waiting on the invoice, Skye on the estimate.']]) await send(who, dm2.id, body, at(day(o), time));
  const group = await s.step('group chat', () => s.chat('morag', { action: 'startGroup', title: 'Glencoe roof leak', userIds: [person('callum').id, person('eilidh').id], propertyId: s.p.glencoe.id }));
  if (group) for (const [who, o, time, body] of [['morag', -4, '10:40', 'Starting this to keep the roof leak in one place.'], ['eilidh', -4, '13:05', 'Tarpaulin fitted. The roofer can do Thursday.'], ['callum', -3, '09:20', 'Guests checking in Friday have been told; no impact on their room.']]) await send(who, group.id, body, at(day(o), time));
  const team = await s.step('property team chat', () => s.chat('fiona', { action: 'startProperty', propertyId: s.p.leith.id }));
  if (team) for (const [who, o, time, body] of [['fiona', -2, '10:00', 'Boiler pressure issue reported again by the guest.'], ['rory', -2, '10:25', 'I can look on Monday if the owner approves the quote.']]) await send(who, team.id, body, at(day(o), time));
  // Owners and Recharge.
  for (const [owner, lines] of [
    ['alasdair', [['alasdair', -3, '20:15', 'Hi, is the Leith boiler sorted? I saw the repair request.'], ['morag', -2, '09:05', 'Not yet: we need your approval for the £180 quote, it is in your Approvals.']]],
    ['catriona', [['catriona', -5, '18:00', 'Could you send me the September statement for Stockbridge?'], ['morag', -4, '09:40', 'Graham has put it in your statements, and the payout went out on the 5th.'], ['catriona', -4, '10:02', 'Perfect, thank you.']]],
    ['moira', [['moira', -1, '21:30', 'When is the Aviemore inspection? I would like to be there.'], ['callum', 0, '08:55', 'Eilidh is booked for the morning of ' + day(2) + '. 10am suit you?']]],
  ]) {
    const conv = await s.step(`owner chat ${owner}`, () => s.chat(owner, { action: 'startOwner' }));
    if (conv) for (const [who, o, time, body] of lines) await send(who, conv.id, body, at(day(o), time));
  }
  // Back-date each message to when it was sent, and read the older conversations.
  await s.dev.serialize(async () => {
    await s.dev.db.exec('set session_replication_role = replica');
    for (const m of sent) await s.dev.db.query(`update private.chat_messages set created_at = $3 where id = (select id from private.chat_messages where conversation_id = $1 and body = $2 order by created_at desc limit 1)`, [m.conversationId, m.body, m.when]);
    await s.dev.db.query(`update private.chat_conversations c set last_message_at = coalesce((select max(created_at) from private.chat_messages m where m.conversation_id = c.id), c.created_at - interval '7 days'), created_at = coalesce((select min(created_at) from private.chat_messages m where m.conversation_id = c.id), c.created_at - interval '7 days')`);
    // Everyone has read what came before yesterday; newer messages are unread.
    await s.dev.db.query(`insert into private.chat_reads(conversation_id, user_id, last_read_at) select m.conversation_id, p.user_id, now() - interval '1 day' from (select distinct conversation_id from private.chat_messages) m cross join public.workspace_profiles p where exists (select 1 from private.chat_members cm where cm.conversation_id = m.conversation_id and cm.user_id = p.user_id) on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at`).catch(() => undefined);
    await s.dev.db.exec('set session_replication_role = origin');
  });
  await s.step('saved replies', async () => {
    for (const [title, body, audience] of [['Check-in time', 'Check-in is from 4pm. The key safe code and directions are in your booking app the day before arrival.', 'guest'], ['Early bag drop', 'You are welcome to leave bags from 11am if the flat is ready; we will message you once the clean is done.', 'guest'], ['Wi-Fi help', 'The router is in the hall cupboard; switch it off and on at the wall and give it two minutes.', 'guest'], ['Statement sent', 'Your monthly statement is now in the app under Reports, and the payout follows within five working days.', 'owner']]) {
      await s.chat('fiona', { action: 'saveReply', title, body, audience });
    }
  });
}

// The guest inbox: messages logged from the platforms, team replies, some still waiting.
async function guestInbox(s) {
  const upcoming = s.reservations.filter(r => r.status === 'confirmed' && r.checkOut >= day(0) && r.checkIn <= day(5));
  const threads = [
    { r: upcoming[0], msgs: [['guest', -1, '18:20', 'Hi! What time can we check in tomorrow?'], ['team', -1, '18:26', 'Hi! Check-in is from 4pm; the key safe code arrives in the app the morning of arrival.'], ['guest', 0, '07:45', 'Great, and is there parking nearby?']] },
    { r: upcoming[1], msgs: [['guest', 0, '09:12', 'The heating seems to be off in the bedroom, can you help?']] },
    { r: upcoming[2], msgs: [['guest', -2, '14:00', 'Can we leave our bags early on the day we arrive?'], ['team', -2, '14:07', 'Yes, from 11am. We will message when the clean is done.'], ['guest', -2, '14:09', 'Thank you!']], done: true },
    { r: upcoming[3], msgs: [['guest', 0, '10:40', 'Is the flat suitable for a baby? Do you have a travel cot?']] },
    { r: upcoming[4], msgs: [['guest', -3, '20:30', 'We loved our stay, thank you for the welcome pack!'], ['team', -3, '20:45', 'Thank you, glad you enjoyed it! Safe travels.']], done: true },
    { r: upcoming[5], msgs: [['guest', -1, '22:10', 'The Wi-Fi password on the card does not work.'], ['team', -1, '22:18', 'Sorry about that! It is RechargeGuest2026 with a capital R and G.'], ['guest', -1, '22:25', 'Works now, thanks.']] },
  ];
  const channelFor = c => ({ airbnb: 'airbnb', booking_com: 'booking_com', vrbo: 'vrbo', direct: 'direct' })[c] ?? 'other';
  for (const [i, t] of threads.entries()) {
    if (!t.r) continue;
    const p = PROPERTIES.find(x => x.key === t.r.property);
    await s.step(`guest thread ${i}`, async () => {
      let threadId = null;
      for (const [from, o, time, body] of t.msgs) {
        if (from === 'guest') {
          const r = await s.inbox(p.stays, { action: 'logMessage', ...(threadId ? { threadId } : { channel: channelFor(t.r.channel), guestName: t.r.guest, propertyId: s.p[p.key].id, reservationRef: t.r.channelReference }), body, sentAt: at(day(o), time) });
          threadId = threadId ?? r?.threadId ?? r?.thread?.id ?? r?.id;
        } else await s.inbox(p.stays, { action: 'reply', threadId, body, sentAt: at(day(o), time) });
      }
      if (t.done && threadId) await s.inbox(p.stays, { action: 'setStatus', threadId, status: 'done' });
    });
  }
  // An enquiry on WhatsApp about a direct booking.
  await s.step('guest thread whatsapp', async () => {
    const r = await s.inbox('fiona', { action: 'logMessage', channel: 'whatsapp', guestName: 'Ruth Mackay', propertyId: s.p.standrews.id, body: 'Hello, is the St Andrews cottage free for the Dunhill week next year? We would book direct.', sentAt: at(day(0), '11:05') });
    void r;
  });
}

// Favorites, local events, an earnings estimate and notification reads.
async function extras(s) {
  const work = await s.sql(`select w.id, w.title from public.workspace_work_items w join private.workspace_domain_details d on d.work_id = w.id where d.kind = 'maintenance' and w.status not in ('completed','cancelled') order by w.created_at limit 2`);
  const favorites = {
    sam: [['section:inbox', 'Messages'], ['section:analytics', 'Reports'], ['property:' + s.p.glencoe.id, 'Glencoe Mountain Lodge'], ...(work[0] ? [['work:' + work[0].id, work[0].title]] : [])],
    morag: [['property:' + s.p.leith.id, 'Leith Shore Apartment'], ['section:statements', 'Owner statements']],
    fiona: [['property:' + s.p.leith.id, 'Leith Shore Apartment'], ['property:' + s.p.standrews.id, 'St Andrews Links Cottage'], ['section:inbox', 'Messages']],
    callum: [['property:' + s.p.merchant.id, 'Merchant City Loft'], ['section:analytics', 'Reports']],
    isla: [['section:inbox', 'Messages']],
    graham: [['section:statements', 'Owner statements']],
  };
  for (const [who, items] of Object.entries(favorites)) await s.step(`favorites ${who}`, () => s.call(who, 'workspace_save_favorites', { input: { action: 'saveFavorites', items: items.map(([key, label]) => ({ key, label })) } }));
  for (const [key, name, offset, url, opportunity] of [
    ['standrews', 'Alfred Dunhill Links Championship', 0, 'https://www.dunhilllinks.com/', 'Golf week: lift weekend rates and set a 3-night minimum.'],
    ['leith', "Edinburgh's Hogmanay", daysBetween(TODAY, TODAY.slice(0, 4) + '-12-31'), 'https://www.edinburghshogmanay.com/', 'New Year demand: 3-night minimum and premium rate from 29 December.'],
    ['merchant', 'Glasgow Christmas markets', 40, 'https://peoplemakeglasgow.com/', 'Weekend demand from late November; review prices for Friday and Saturday nights.'],
    ['inverness', 'Loch Ness Marathon', -7, 'https://www.lochnessmarathon.com/', 'Race weekend sold out; note for next year.'],
  ]) await s.step(`local event ${name}`, () => s.portfolio(PROPERTIES.find(p => p.key === key).stays, { action: 'recordLocalEvent', propertyId: s.p[key].id, name, eventOn: day(offset), sourceUrl: url, opportunity }));
  // Team feedback to the super admin: two new, one already answered.
  const sent = [];
  for (const [who, category, message] of [
    ['callum', 'idea', 'Could the guest inbox show the check-in time next to each guest? It would save opening every booking.'],
    ['morag', 'problem', 'The weekly report took a long time to load this morning. It came through in the end.'],
    ['fiona', 'praise', 'The new clock card with Lunch and Break is so much easier than messaging the team.'],
  ]) await s.step(`feedback ${who}`, async () => { sent.push(await s.teams(who, { action: 'sendFeedback', category, message })); });
  const praise = sent.find(f => f?.category === 'praise');
  if (praise) await s.step('feedback reply', () => s.teams('sam', { action: 'updateFeedback', feedbackId: praise.id, version: praise.version, status: 'done', reply: 'Thanks Fiona, really glad it helps. Tell me if anything else gets in the way.' }));
  // The backend jobs that run overnight: weekly report notices and owner approval chases.
  await s.step('owner chases', () => s.call('service', 'workspace_chase_owner_approvals', {}));
  await s.step('weekly notices', () => s.call('service', 'workspace_weekly_report_notices', {}));
}

// Move what was just done back to when it happened.
async function backdate(s) {
  await s.dev.serialize(async () => {
    const db = s.dev.db;
    await db.exec('set session_replication_role = replica');
    for (const [workId, { created, finished }] of s.timeline) {
      const end = finished ?? created;
      await db.query(`update public.workspace_work_items set created_at = $2::timestamptz, updated_at = $3::timestamptz, completed_at = case when completed_at is not null then $3::timestamptz end where id = $1`, [workId, created, end]);
      await db.query(`with u as (select id, row_number() over (order by created_at, id) n, count(*) over () c from public.workspace_work_updates where work_id = $1)
        update public.workspace_work_updates w set created_at = $2::timestamptz + ($3::timestamptz - $2::timestamptz) * (u.n::float / (u.c + 1)) from u where w.id = u.id`, [workId, created, end]);
      await db.query(`with a as (select id, row_number() over (order by created_at, id) n, count(*) over () c from public.workspace_activity where work_id = $1)
        update public.workspace_activity x set created_at = $2::timestamptz + ($3::timestamptz - $2::timestamptz) * ((a.n - 1)::float / greatest(a.c - 1, 1)) from a where x.id = a.id`, [workId, created, end]);
      await db.query(`update private.workspace_domain_details set updated_at = $2::timestamptz where work_id = $1`, [workId, end]);
      await db.query(`update private.workspace_cleaning_reviews set created_at = $2::timestamptz where work_id = $1`, [workId, end]);
      await db.query(`update private.workspace_media_evidence set created_at = $2::timestamptz - interval '20 minutes', verified_at = $2::timestamptz - interval '19 minutes' where work_id = $1`, [workId, finished ?? end]);
    }
    // Work the backdated items spawned (complaints, invoices to raise) follows its source.
    await db.query(`update public.workspace_work_items w set created_at = s.updated_at + interval '5 minutes', updated_at = greatest(w.updated_at - (now() - s.updated_at), s.updated_at + interval '5 minutes')
      from private.workspace_domain_details d, public.workspace_work_items s where d.work_id = w.id and d.data ? 'sourceWorkId' and s.id = (d.data->>'sourceWorkId')::uuid and s.updated_at < now() - interval '1 hour' and w.created_at > now() - interval '1 hour'`).catch(() => undefined);
    // Notifications carry the time of the event they announce; older ones have been read.
    await db.query(`update private.workspace_notification_outbox o set next_attempt_at = a.created_at, read_at = case when a.created_at < now() - interval '2 days' then a.created_at + interval '3 hours' else o.read_at end from public.workspace_activity a where a.id = o.event_id`);
    await db.exec('set session_replication_role = origin');
  });
}

// node scripts/demo/seed.mjs: rebuild the cached seed without starting the server.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fs = await import('node:fs/promises');
  const { DevDatabase, freshDatabase, sourceHash, DEVSTACK } = await import('./db.mjs');
  const dev = new DevDatabase(await freshDatabase());
  const summary = await seed(dev);
  console.log(summary.line);
  if (summary.skipped.length) console.log(`Skipped (${summary.skipped.length}):\n  ` + summary.skipped.join('\n  '));
  const blob = await dev.db.dumpDataDir('gzip');
  await fs.writeFile(path.join(DEVSTACK, 'seed.tar.gz'), Buffer.from(await blob.arrayBuffer()));
  await fs.writeFile(path.join(DEVSTACK, 'seed.meta.json'), JSON.stringify({ hash: await sourceHash(), seededOn: TODAY, seededAt: new Date().toISOString(), summary: summary.line }, null, 2));
  await dev.db.close();
}
