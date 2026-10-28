import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Launch Preparation (Business Plan v1.0; migration 20261029100000): one checklist from the onboarding package to going
// live. Recharge's parts and the owner's, worked out from the package; nothing opens before the onboarding fee is settled;
// the readiness inspection opens once set-up, broadband, utilities, compliance, licensing and the housekeeper are done, is
// filled in by the housekeeper, raises maintenance tickets for anything crossed, and makes the property guest ready.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const L = await vite.ssrLoadModule('/lib/launch-preparation.ts');
const MIGRATION = 'supabase/migrations/20261029100000_launch_preparation.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'cleans', 'cleans'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Hannah Housekeeper', 'Harry Housekeeper'];
const users = roles.map((_, i) => `97880000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, KEEPER, OTHERKEEPER] = roles.map((_, i) => i);
const session = i => users[i].replace('9788', '9888');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `lch${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
for (const i of [STAYS, OWNER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const messages = async () => owner("select m.body from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id where c.kind='owner' and c.owner_id=$1 order by m.created_at,m.id", [users[OWNER]]);
const said = async pattern => assert.ok((await messages()).some(m => pattern.test(m.body)), String(pattern));
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const stageOf = async prop => (await owner('select stage from private.workspace_journeys where property_id=$1', [prop]))[0].stage;
const today = (await owner("select to_char((now() at time zone 'Europe/London')::date,'YYYY-MM-DD') d"))[0].d;
const plus = (days) => new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
after(async () => { await db.close(); await vite.close(); });

const versionOf = async prop => (await owner('select version from private.workspace_journeys where property_id=$1', [prop]))[0].version;
async function journey(i, prop, input) {
  const version = await versionOf(prop);
  await as(i);
  return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), propertyId: prop, version, ...input })]);
}
const ANSWERS = { setUp: 'recharge', broadbandInstalled: true, utilitiesConnected: true, prepaymentMeters: false, utilitiesUnderstood: true, complianceRecharge: ['EICR'],
  licensingContact: false, garden: false, waste: 'communal', operatorName: 'Olive Owner', repairLimitMinor: 25000 };
// An owner who went ahead, built their package and signed; settled = the onboarding fee is paid.
async function signed(name, { answers = ANSWERS, settled = true, pkg = true } = {}) {
  await as(OWNER);
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name, address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 })]);
  const prop = created.propertyId;
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], managementFeeBps: 1800, otaFeeBps: 1500 });
  await journey(OWNER, prop, { action: 'decideEstimate', decision: 'proceed' });
  if (pkg) await owner('insert into private.workspace_onboarding_packages(property_id,answers,submitted_at) values($1,$2,now())', [prop, answers]);
  else await owner("insert into private.workspace_onboarding_packages(property_id,answers,submitted_at) values($1,'{}',now())", [prop]);
  await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and the owner.' });
  await journey(OWNER, prop, { action: 'signAgreement', agreementRevision: 1, signedName: names[OWNER], consent: true });
  if (!pkg) await owner('delete from private.workspace_onboarding_packages where property_id=$1', [prop]);
  if (settled) await owner("update private.workspace_journeys set stage='inspection_to_book' where property_id=$1", [prop]);
  return prop;
}
const read = async (prop, i = STAYS) => { await as(i); return L.launchReadSchema.parse(await rpc('workspace_launch_read', [prop])); };
const act = async (input, i = STAYS) => { await as(i); return L.launchReadSchema.parse(await rpc('workspace_launch_action', [L.launchActionSchema.parse({ requestId: crypto.randomUUID(), ...input })])); };
const stepOf = (v, key) => v.launch.steps.find(s => s.key === key);
const tick = (prop, step, data, i = STAYS) => act({ action: 'tick', propertyId: prop, step, ...(data ? { data } : {}) }, i);
async function preparedForReadiness(prop) {
  await tick(prop, 'setUp.inspection', { on: plus(2), access: 'Keybox by the front door' });
  await tick(prop, 'setUp.inventory');
  const v = await read(prop);
  await tick(prop, 'setUp.condition', { ticks: v.settings.condition.map(c => c.key) });
  await tick(prop, 'setUp.order', { note: 'Ordered from the catalogue' });
  await tick(prop, 'setUp.install');
  for (const s of (await read(prop)).launch.steps.filter(s => s.section === 'compliance')) await tick(prop, s.key, { expiresOn: plus(300) });
  await tick(prop, 'licensing.licence', { required: true, number: 'EH-STL-001' });
  await act({ action: 'allocate', propertyId: prop, housekeeperId: users[KEEPER] });
}
const allTicked = v => v.settings.condition.map(c => ({ key: c.key, ok: true, note: '' }));

test('the migration runs twice, stays locked down, and its starting statements match the app', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  await db.exec('reset role'); await db.exec(sql); await db.exec(sql);
  assert.ok(!/—/.test(sql), 'no em dashes');
  for (const t of ['workspace_launch_settings', 'workspace_launch_steps', 'workspace_launch_readiness']) {
    assert.equal((await owner('select relrowsecurity rls from pg_class where oid=$1::regclass', ['private.' + t]))[0].rls, true, t);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await owner('select has_table_privilege($1,$2,$3) ok', [role, 'private.' + t, 'select']))[0].ok, false, role + ' ' + t);
  }
  assert.equal((await owner("select has_function_privilege('anon','public.workspace_launch_read(uuid)','execute') ok"))[0].ok, false);
  const [d] = await owner('select private.workspace_launch_settings_default() s');
  assert.deepEqual(L.launchSettingsSchema.parse(d.s), L.DEFAULT_LAUNCH_SETTINGS);
  assert.equal(L.DEFAULT_LAUNCH_SETTINGS.condition.length, 16);
  assert.equal(L.DEFAULT_LAUNCH_SETTINGS.condition[0].title, 'Keyboxes');
});

test('the checklist follows the package, and nothing opens before the onboarding fee is settled', async () => {
  const early = await signed('Early Flat', { settled: false });
  let v = await read(early);
  assert.ok(v.launch.steps.every(s => ['locked', 'done', 'na'].includes(s.state)), 'locked before the fee');
  assert.match(stepOf(v, 'setUp.inventory').lockedBecause, /onboarding fee is settled/);
  await refused(tick(early, 'setUp.inventory'), /onboarding fee is settled/);

  const prop = await signed('Shore Flat');
  v = await read(prop);
  assert.equal(stepOf(v, 'setUp.inventory').who, 'recharge', 'Recharge sets up');
  assert.equal(stepOf(v, 'setUp.inventory').state, 'todo');
  assert.equal(stepOf(v, 'broadband.signUp').state, 'done', 'already installed');
  assert.equal(stepOf(v, 'utilities.meter').state, 'done', 'no prepayment meter');
  assert.equal(stepOf(v, 'garden.quote').state, 'na', 'no garden');
  assert.equal(stepOf(v, 'waste.collection').state, 'na', 'communal bins');
  const docs = v.launch.steps.filter(s => s.section === 'compliance');
  assert.equal(docs.length, 6);
  assert.equal(docs.find(s => s.title === 'EICR').who, 'recharge');
  assert.equal(docs.find(s => s.title === 'EPC').who, 'client');
  assert.equal(stepOf(v, 'readiness.inspection').state, 'locked');

  // The owner sees the checklist and ticks their own parts only.
  const mine = await read(prop, OWNER);
  assert.equal(mine.launch.isOwner, true);
  assert.equal(mine.launch.address, null, 'the team and housekeeper see the address and access');
  assert.equal(stepOf(mine, 'setUp.inventory').canTick, false);
  await refused(tick(prop, 'setUp.inventory', null, OWNER), /Recharge ticks this part/);
  await refused(tick(prop, 'licensing.licence', { required: true }, OWNER), /licence number/);
  await tick(prop, 'licensing.licence', { required: false }, OWNER);
  await refused(tick(prop, 'compliance:epc', { expiresOn: plus(-1) }, OWNER), /expired/);
  v = await tick(prop, 'compliance:epc', { expiresOn: plus(400) }, OWNER);
  assert.equal(stepOf(v, 'compliance:epc').state, 'done');
  assert.equal(stepOf(v, 'compliance:epc').doneByName, 'Olive Owner');
  await as(KEEPER); await refused(rpc('workspace_launch_read', [prop]), /Property not found/);

  // A property without a package carries on as before.
  const old = await signed('Old Flat', { pkg: false });
  assert.equal((await read(old)).launch.steps, null);
});

test('readiness opens once everything before it is done; the housekeeper submits it and the property is guest ready', async () => {
  const prop = await signed('Quay Flat');
  await refused(tick(prop, 'setUp.condition', { ticks: ['keyboxes'] }), /Tick every condition statement/);
  await preparedForReadiness(prop);
  await said(/Your set-up inspection is booked for /);
  let v = await read(prop);
  assert.equal(stepOf(v, 'housekeeper.allocate').state, 'done');
  assert.equal(v.launch.housekeeper.name, 'Hannah Housekeeper');
  assert.equal(stepOf(v, 'readiness.inspection').state, 'todo');
  assert.equal(v.launch.canBookReadiness, true);
  assert.ok(v.housekeepers.some(h => h.id === users[OTHERKEEPER]));
  await refused(act({ action: 'bookReadiness', propertyId: prop, date: plus(-1) }), /from today/);
  v = await act({ action: 'bookReadiness', propertyId: prop, date: plus(1) });
  assert.equal(await stageOf(prop), 'inspection_booked');
  assert.equal(v.launch.readiness.housekeeperName, 'Hannah Housekeeper');
  assert.ok(await notified(KEEPER, 'launch.readiness_booked') > 0, 'the housekeeper hears');
  await said(/inspection booked/i);
  const theirs = await read(null, KEEPER);
  assert.deepEqual(theirs.inspections.map(x => x.name), ['Quay Flat']);
  assert.deepEqual((await read(null, OTHERKEEPER)).inspections, []);
  const k = await read(prop, KEEPER);
  assert.equal(k.launch.isHousekeeper, true);
  assert.equal(k.launch.access, null, 'no access instructions were saved for this property');
  assert.equal(k.launch.canSubmitReadiness, false, 'the form opens on the day');
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: true, missing: [] }, condition: allTicked(v), evidence: { video: 'https://video.test/a', note: '' } }, KEEPER), /opens on the inspection day/);
  // Moved to today: the owner hears it moved.
  await act({ action: 'bookReadiness', propertyId: prop, date: today });
  await said(/readiness inspection has moved to/);

  const condition = allTicked(v).map(c => c.key === 'kitchen' ? { ...c, ok: false, note: '' } : c);
  const evidence = { video: 'https://video.test/changeover', note: '' };
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: true, missing: [] }, condition, evidence }, KEEPER), /Say what is wrong/);
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: true, missing: [] }, condition: allTicked(v).slice(1), evidence }, KEEPER), /every condition statement/);
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: false, missing: [] }, condition: allTicked(v), evidence }, KEEPER), /List what is missing/);
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: true, missing: [] }, condition: allTicked(v), evidence: { video: '', note: '' } }, KEEPER), /changeover video/);
  await refused(act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: true, missing: [] }, condition: allTicked(v), evidence }, OTHERKEEPER), /Property not found/);
  const crossed = condition.map(c => c.key === 'kitchen' ? { ...c, note: 'Cupboard door hanging off' } : c);
  v = await act({ action: 'submitReadiness', propertyId: prop, inventory: { allPresent: false, missing: ['Kettle', 'Toaster'] }, condition: crossed, evidence }, KEEPER);
  assert.equal(await stageOf(prop), 'inspection_complete', 'guest ready');
  assert.equal(v.launch.readiness.issues, 2);
  const repairs = await owner("select d.data->>'issue' issue from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=$1 and d.kind='maintenance' order by 1", [prop]);
  assert.deepEqual(repairs.map(r => r.issue), ['Readiness inspection, missing from the inventory: Kettle, Toaster', 'Readiness inspection: Kitchen surfaces and fittings: Cupboard door hanging off']);
  v = await read(prop);
  assert.equal(stepOf(v, 'readiness.inspection').state, 'done');
  assert.equal(stepOf(v, 'guidebook.done').state, 'todo', 'the guidebook opens once guest ready');
  assert.equal(stepOf(v, 'photography.booked').state, 'todo');
  assert.equal(stepOf(v, 'social.comingSoon').state, 'locked', 'after the photos');
  assert.equal(stepOf(v, 'pricing.base').state, 'locked', 'after the listing');
  assert.equal(stepOf(v, 'setUp.inventory').canReopen, false, 'what readiness checked stays ticked');
  assert.equal(stepOf(v, 'guidebook.done').canTick, true);
  v = await tick(prop, 'guidebook.done', { note: 'Guidebook link sent to the team' });
  assert.equal(stepOf(v, 'guidebook.done').canReopen, true);
  v = await act({ action: 'reopen', propertyId: prop, step: 'guidebook.done' });
  assert.equal(stepOf(v, 'guidebook.done').state, 'todo');
  assert.ok(await notified(ADMIN, 'launch.guest_ready') > 0, 'the team hears');
});

test('with a package the old inspection steps are closed: Launch Preparation books and completes it', async () => {
  const prop = await signed('Guard Flat');
  await refused(owner("update private.workspace_journeys set stage='inspection_booked' where property_id=$1", [prop]), /Launch Preparation/);
  await refused(owner("update private.workspace_journeys set stage='inspection_complete' where property_id=$1", [prop]), /Launch Preparation/);
  await refused(act({ action: 'bookReadiness', propertyId: prop, date: plus(1) }), /Allocate the housekeeper first/);
  await act({ action: 'allocate', propertyId: prop, housekeeperId: users[KEEPER] });
  await refused(act({ action: 'bookReadiness', propertyId: prop, date: plus(1) }), /everything above/);
  await refused(act({ action: 'allocate', propertyId: prop, housekeeperId: users[STAYS] }), /active housekeeper/);
});

test('admins edit the condition statements, the notes and whether the video is required', async () => {
  const settings = { ...L.DEFAULT_LAUNCH_SETTINGS, condition: [...L.DEFAULT_LAUNCH_SETTINGS.condition, { key: 'hot_tub', title: 'Hot tub', text: 'The hot tub is clean and at temperature.' }], requireVideo: false };
  await refused(act({ action: 'saveSettings', settings }), /Only admins/);
  const v = await act({ action: 'saveSettings', settings }, ADMIN);
  assert.equal(v.settings.condition.length, 17);
  assert.equal(v.settingsUpdatedByName, 'Morag');
  await refused(act({ action: 'saveSettings', settings: { ...settings, condition: [] } }, ADMIN), /./);
  await act({ action: 'saveSettings', settings: L.DEFAULT_LAUNCH_SETTINGS }, ADMIN);
});
